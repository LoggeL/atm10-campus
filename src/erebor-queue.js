import {publishedPlan,selectionStore,unstarted} from './erebor-selection.js';
import {productionStore} from './erebor-production.js';
import {ereborFeeder} from './erebor-feeder.js';
import {Worker} from 'node:worker_threads';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual as same} from 'node:util';
import {bridgeClient,cannonReset,verifyAlignment} from './alignment.js';
import {DESIGN_REVISION} from './erebor-design.js';
import {requireActor,HttpError} from './auth.js';
import {logActivity,tx} from './db.js';

const layout=JSON.parse(readFileSync(new URL('./erebor-fleet/stations.json',import.meta.url)));
const sites=layout.sites.map(s=>s.site);
const base='/api/projects/erebor/planfolge';
const modes={stone:0,clear:3,build:2};
const stages={stone:'Steinfüllung',clear:'Aushub',build:'Bau'};
const readyState=()=>({cursor:0,completed:0,exhausted:false,job:null,status:'Wartet auf Prüfung'});
export function confirmedFinish(o,job,now=Date.now()/1000){
 return !job.tainted&&job.seen>0&&now-job.seen<90&&o.inputEmpty===true&&o.state==='STOPPED'&&o.status==='finished'&&cannonReset(o)&&
  o.outputItem==='create:empty_schematic'&&Number.isSafeInteger(job.baseline)&&o.outputCount===job.baseline+1&&
  same(o.options,job.desired.options);
}
export function recordedFinish(o,j,r,now=Date.now()){
 return !!r && r.file===j.desired.file && Number.isFinite(r.at) && Number.isFinite(r.before) &&
  r.before<=r.at && r.at-r.before<=10000 && r.at>=j.seen*1000 && now>=r.at && now-r.at<600000 &&
  r.oldCount===j.baseline && r.newCount===o.outputCount &&
  confirmedFinish(o,{...j,seen:r.before/1000},r.at/1000);
}
export function configureEreborQueue(db,b,actor=null){
  const p=db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
  const cfg=()=>db.prepare("SELECT version FROM erebor_queue_config WHERE id=1").get();
  if(!p||b?.version!==p.current_version||p.current_version!==layout.version)throw new HttpError(409,'Erebor-Version und bestätigte Kanonenplätze prüfen.');
  if(!['prepare','pause'].includes(b.action))throw new HttpError(400,'Unbekannte Aktion.');
  const planned=JSON.parse(p.plan_json).cannonLayout?.stations;
  if(!layout.sites.every(s=>planned?.some(r=>r.id===s.site&&same(r.position,s.planned))))throw new HttpError(409,'Kanonenstandorte geändert.');
  if(cfg()&&cfg().version!==p.current_version)throw new HttpError(409,'Vorhandene Planfolge gehört zu einer anderen Version.');
  tx(db,()=>{
   if(!cfg()){
    db.prepare("INSERT INTO erebor_queue_config VALUES(1,?,0,'stone',NULL,NULL,NULL)").run(p.current_version);
    for(const site of sites)db.prepare('INSERT INTO erebor_queue_sites VALUES(?,?,NULL)').run(site,JSON.stringify(readyState()));
   }
   db.prepare('UPDATE erebor_queue_config SET enabled=? WHERE id=1').run(b.action==='prepare'?1:0);
   logActivity(db,actor,'erebor.queue.'+b.action,'erebor',{version:p.current_version});
  });
}
export function registerEreborQueue(app,campus){
 const {db,config}=campus,request=config.cannonBridgeRequest||bridgeClient(config);
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_queue_config(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,enabled INTEGER NOT NULL,phase TEXT NOT NULL,archive TEXT,lease TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS erebor_queue_sites(site TEXT PRIMARY KEY,state TEXT NOT NULL,payload BLOB);`);
 const choices=selectionStore(db);
 const production=productionStore(db);
 const cfg=()=>db.prepare('SELECT * FROM erebor_queue_config WHERE id=1').get();
 const project=()=>db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
 const read=site=>JSON.parse(db.prepare('SELECT state FROM erebor_queue_sites WHERE site=?').get(site).state);
 const persist=(site,s)=>db.prepare('UPDATE erebor_queue_sites SET state=? WHERE site=?').run(JSON.stringify(s),site);
 campus.ereborStationBinding=name=>{
  const [x,y,z]=layout.sites.find(s=>s.site===name.slice(-3).toUpperCase()).cannon;
  return {x,y,z,dimension:'minecraft:overworld',owner:'Erebor'};
 };
 campus.ereborFeeder=ereborFeeder(db,request,layout.version);
 const owner=randomUUID();let worker=null,working=null,closed=false,queued=false;
 function stopWorker(){if(worker){void worker.terminate();worker=null;}}
 function generate(p,input){
  worker??=new Worker(new URL('./erebor-queue-worker.js',import.meta.url),{workerData:{project:{id:'erebor',version:p.current_version,plan:JSON.parse(p.plan_json)},world:config.worldSources.live},resourceLimits:{maxOldGenerationSizeMb:512}});
  const w=worker;
  return new Promise((resolve,reject)=>{
   const clean=()=>{clearTimeout(timer);w.off('message',message);w.off('error',fail);w.off('exit',exit);};
   const fail=e=>{clean();stopWorker();reject(e);};
   const exit=()=>fail(Error('Exportprozess beendet.'));
   const message=m=>{clean();m.error?reject(Error(m.error)):resolve(m.result);};
   const timer=setTimeout(()=>fail(Error('Zeitlimit beim Planexport.')),60000);
   w.once('message',message);w.once('error',fail);w.once('exit',exit);w.postMessage(input);
  });
 }
 function snapshotArchive(v){
  const result={clear:{},build:{}};
  const rows=db.prepare("SELECT package_id,report_json FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? ORDER BY package_id").all(v,DESIGN_REVISION);
  for(const row of rows)for(const f of JSON.parse(row.report_json).files){
   if(sites.includes(f.cannon)&&result[f.kind])(result[f.kind][f.cannon]??=[]).push({pack:row.package_id,fileName:f.fileName,origin:f.origin});
  }
  for(const group of Object.values(result))for(const files of Object.values(group))files.sort((a,b)=>a.origin[1]-b.origin[1]||a.fileName.localeCompare(b.fileName));
  return result;
 }
 const current=v=>!closed&&db.prepare('SELECT 1 FROM erebor_queue_config q JOIN build_projects p ON p.id=\'erebor\' WHERE q.id=1 AND q.version=p.current_version AND q.version=? AND q.lease=? AND q.expires>?').get(v,owner,Date.now());
 function observe(site,s,o,finish){
  const j=s.job;
  s.inserted=false;
  if(!verifyAlignment(j.desired,o,j.desired)&&same(o.components['create:schematic_bounds'],j.size)){
   if(o.status==='skipping'||o.amountPlaced<(j.placed||0))j.tainted=true;
   if(o.state==='RUNNING'||o.amountPlaced>0)j.started=true;
   j.placed=o.amountPlaced;j.seen=o.at;j.loaded=true;s.inserted=true;
   j.baseline=o.outputItem==='create:empty_schematic'||o.outputCount===0?o.outputCount:null;
   db.prepare('UPDATE erebor_queue_sites SET payload=NULL WHERE site=? AND payload IS NOT NULL').run(site);
   s.status='Eingelegt';
   if(o.state==='RUNNING')s.status='Baut';
   else if(o.status==='noGunpowder')s.status='Eingelegt · Schießpulver fehlt';
   else if(o.state==='PAUSED'&&o.status!=='ready')s.status='Pausiert: '+o.status;
   return true;
  }
  if(confirmedFinish(o,j)||recordedFinish(o,j,finish)){
   s.cursor=j.next;s.completed++;s.job=null;s.status='Fertig, nächster Plan folgt';
   tx(db,()=>{
    production.finish(j.desired.version??cfg().version,site,j.desired.blueprint,new Date().toISOString());
    choices.mark(j.selection,'finished');persist(site,s);
   });return true;
  }
  if(j.loaded){
   if(o.item||o.state!=='STOPPED'||o.status!=='finished')j.tainted=true;
   s.status='Wartet auf bestätigten Abschluss';return true;
  }
  return false;
 }
 async function startJob(site,version,job){
  const {options,...desired}=job.desired;
  const result=await request('erebor-start',{site,version,desired,kind:job.phase,size:job.size});
  if(!result.started||verifyAlignment(job.desired,result.observed,job.desired)||!same(result.observed?.components?.['create:schematic_bounds'],job.size))
   throw new HttpError(409,'Der Start wurde nicht bestätigt. Kanonenstatus prüfen.');
  return result;
 }
 function published(project,site,entry){
  return publishedPlan(db,project,{...entry,version:project.current_version,site,file:entry.name+'.nbt'});
 }
 async function startAutomatic(site,s,version,observed){
  const mode=production.mode(version,site),job=s.job;
  if(!mode.enabled||!job||job.tainted)return;
  if(observed.state==='RUNNING'){
   if(mode.started_upload!==job.desired.file)production.started(version,site,job.desired.file);
   return;
  }
  if(mode.started_upload===job.desired.file||observed.flyingBlocks!==0||
     !['STOPPED','PAUSED'].includes(observed.state)||['noGunpowder','targetNotLoaded','missingBlock','missingItem'].includes(observed.status))return;
  const result=await startJob(site,version,job);
  production.started(version,site,job.desired.file);
  job.started=true;observe(site,s,result.observed);
  logActivity(db,null,'erebor.automatic.start',site,{version,file:job.desired.blueprint});
 }
 async function station(site,s,c,p,archive){
  let choice=choices.next(c.version,site);
  const automatic=()=>!!production.mode(c.version,site).enabled;
  if(!automatic()&&!choice&&(s.exhausted||!c.enabled)&&!s.job?.loaded&&!s.job?.selection)return;
  const data={site,version:c.version};
  const sample=!choice&&s.job?.loaded?campus.ereborFeeder.sample(site):null;
  const o=sample&&sample.at>=s.job.seen?sample:(await request('erebor-inspect',data)).observed;
  if(!current(c.version))return;
  const old=s.job;
  const aligned=old&&!verifyAlignment(old.desired,o,old.desired)&&same(o.components?.['create:schematic_bounds'],old.size);
  if(old){
   const finish=o.inputEmpty===true&&o.status==='finished'?(await liveReport(c.version))?.stations?.[site]?.finish:null;
   if(!current(c.version))return;
   observe(site,s,o,finish);
  }
  if(automatic()&&old&&s.job&&aligned){
   const completed=production.done(c.version,site,old.desired.blueprint);
   if(!completed || !unstarted(old,o)){
    if(!completed)await startAutomatic(site,s,c.version,o);
    return;
   }
   if(!choice){
    const next=production.ordered(p,site).open[0];
    if(!next){s.status='Baufolge erledigt';return;}
    const {job,bytes}=published(p,site,next);
    choices.add(c.version,site,job,bytes,old.desired.file);
    choice=choices.next(c.version,site);
   }
  }
  if(automatic()&&s.job?.loaded&&!aligned)return;
  const priority=production.priority(c.version,site);
  if(priority&&choice&&!s.job&&o.inputEmpty&&JSON.parse(choice.job).desired.blueprint!==priority)choice=null;
  if(choice){
   if(automatic()&&production.done(c.version,site,JSON.parse(choice.job).desired.blueprint)){
    choices.mark(choice.id,'redundant');return;
   }
   const selected=JSON.parse(choice.job),oldFile=old?.desired.file;
   const matches=!verifyAlignment(selected.desired,o,selected.desired)&&same(o.components?.['create:schematic_bounds'],selected.size);
   const empty=o.inputEmpty===true&&cannonReset(o);
   const previousMatches=choice.previous===oldFile||(!choice.previous&&!old?.selection);
   const alreadyFinished=automatic()&&old&&production.done(c.version,site,old.desired.blueprint);
   const replace=aligned&&(previousMatches||alreadyFinished)&&unstarted(old,o);
   if(!matches&&!empty&&!replace)return;
   // The durable selection survives a response lost after Minecraft committed the item.
   const {options,...desired}=selected.desired;
   let observed=o;
   if(!matches){
    const args={...data,kind:selected.phase,size:selected.size,desired,nbtBase64:Buffer.from(choices.bytes(choice.id)).toString('base64')};
    if(replace)args.previous={file:oldFile,sha256:old.desired.sha256,anchor:old.desired.anchor};
    const result=await request('erebor-prepare',args);
    observed=result.observed;
    if(!result.applied||verifyAlignment(selected.desired,observed,selected.desired)||!same(observed.components?.['create:schematic_bounds'],selected.size))throw Error('Einlegen noch nicht bestätigt.');
   }
   const displaced=s.job;
   selected.selection=choice.id;selected.next=displaced?.desired.blueprint===selected.desired.blueprint?displaced.next:s.cursor;
   s.job=selected;
   tx(db,()=>{
    choices.mark(displaced?.selection,'replaced');choices.mark(choice.id,'loaded');
    observe(site,s,observed);persist(site,s);
   });
   await startAutomatic(site,s,c.version,observed);return;
  }
  if(old&&(s.job?.loaded||(!s.job&&!automatic())))return;
  if(!automatic()&&(!cfg().enabled||s.exhausted||c.phase==='finished'))return;
  if(o.inputEmpty!==true||!cannonReset(o)){s.status='Kanone belegt';return;}
  if(!s.job&&(automatic()||production.priority(c.version,site))){
   const next=production.ordered(p,site).open[0];
   if(!next){s.status='Baufolge erledigt';s.exhausted=true;return;}
   const {job,bytes}=published(p,site,next);
   s.job={...job,next:s.cursor};
   db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(s),bytes,site);
  }
  if(!s.job){
   const selected=await generate(p,{site,phase:c.phase,cursor:s.cursor,architecture:archive?.[c.phase]?.[site]?.[s.cursor]});
   if(!current(c.version)||automatic()||production.priority(c.version,site)||choices.next(c.version,site))return;
   if(!selected.file){s.cursor=selected.next;s.exhausted=!!selected.exhausted;s.status=s.exhausted?'Phase erledigt':'Nächster Abschnitt wird geprüft';return;}
   if(production.done(c.version,site,selected.file.slice(0,-4))||choices.completed(c.version,site,selected.file.slice(0,-4))){s.cursor=selected.next;s.status='Gewählter Abschnitt bereits abgeschlossen';return;}
   const bytes=Buffer.from(selected.bytes),file='campus_'+randomUUID()+'.nbt';
   const desired={file,sha256:createHash('sha256').update(bytes).digest('hex'),blueprint:selected.file.slice(0,-4),owner:'Erebor',anchor:selected.origin,version:c.version,rotation:'none',mirror:'none',options:{replace_mode:modes[c.phase],skip_missing:false,replace_block_entities:false}};
   s.job={desired,size:selected.size,blocks:selected.blocks,materials:selected.materials,next:selected.next,phase:c.phase,loaded:false,seen:0};
   db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(s),bytes,site);
  }
  if(!current(c.version)||(!automatic()&&!cfg().enabled))return;
  const j=s.job,{options,...desired}=j.desired;
  const bytes=db.prepare('SELECT payload FROM erebor_queue_sites WHERE site=?').get(site).payload;
  if(!bytes)throw Error('Vorbereitete Datei fehlt.');
  const res=await request('erebor-prepare',{...data,desired,kind:j.phase,size:j.size,nbtBase64:Buffer.from(bytes).toString('base64')});
  if(!res.applied||!observe(site,s,res.observed))throw Error('Einlegen noch nicht bestätigt.');
  persist(site,s);
  await startAutomatic(site,s,c.version,res.observed);
 }
 async function tick(){
  const c=cfg(),p=project();
  if(!c||!p||c.version!==p.current_version||closed)return;
  const tracking=db.prepare("SELECT site FROM erebor_queue_sites WHERE json_extract(state,'$.job.loaded')=1").all().map(r=>r.site);
  const active=[...production.enabled(c.version),...choices.active(c.version),...tracking];
  if((!c.enabled||c.phase==='finished')&&!active.length)return;
  const acquired=db.prepare('UPDATE erebor_queue_config SET lease=?,expires=? WHERE id=1 AND (lease IS NULL OR expires<? OR lease=?)').run(owner,Date.now()+120000,Date.now(),owner);
  if(!acquired.changes)return;
  try{
   const archive=c.archive?JSON.parse(c.archive):null;
   for(const site of new Set([...active,...(c.enabled&&c.phase!=='finished'?sites:[])])){
    if(!current(c.version))return;
    db.prepare('UPDATE erebor_queue_config SET expires=? WHERE id=1 AND lease=?').run(Date.now()+120000,owner);
    const s=read(site);
    try{await station(site,s,c,p,archive);}catch(e){s.status=e.message;s.inserted=false;}
    if(current(c.version)){s.checked=new Date().toISOString();persist(site,s);}
   }
   if(current(c.version)&&cfg().enabled&&c.phase!=='finished'&&sites.every(site=>{const s=read(site);return s.exhausted&&!s.job;})){
    const phase=({stone:'clear',clear:'build',build:'finished'})[c.phase];
    tx(db,()=>{
     const files=c.phase==='stone'?JSON.stringify(snapshotArchive(c.version)):c.archive;
     db.prepare('UPDATE erebor_queue_config SET phase=?,archive=? WHERE id=1').run(phase,files);
     for(const site of sites){const s=read(site);s.cursor=0;s.exhausted=phase==='finished';s.status=s.exhausted?'Fertig':'Wartet auf Prüfung';persist(site,s);}
    });
   }
  }finally{db.prepare('UPDATE erebor_queue_config SET lease=NULL,expires=NULL WHERE id=1 AND lease=?').run(owner);}
 }
 function wake(){
  if(closed)return;
  if(working){queued=true;return;}
  working=tick().catch(e=>app.log.error(e)).finally(()=>{working=null;if(queued){queued=false;wake();}});
 }
 const timer=setInterval(()=>{if(!working)wake();},10000);timer.unref();
 app.addHook('onClose',async()=>{closed=true;clearInterval(timer);stopWorker();await working;});
 let liveFetch=null,liveCache=null,readAt=0;
 async function liveReport(version){
  if(!Number.isInteger(version))return null;
  if(Date.now()-readAt<1500)return liveCache;
  if(!liveFetch)liveFetch=request('erebor-live',{version}).then(r=>r.version===version&&Math.abs(Date.now()-r.at)<45000?r:null).catch(()=>null).then(r=>{readAt=Date.now();liveCache=r;return r;}).finally(()=>{liveFetch=null;});
  return liveFetch;
 }
 function status(report=null,focus=null){
  const c=cfg(),v=project()?.current_version;
  let queue=null;
  if(v&&sites.includes(focus)){
   const {open,done,preferred}=production.ordered(project(),focus),state=c?read(focus):readyState(),job=state.job;
   const waiting=choices.waiting(v).filter(r=>r.site===focus&&!done.has(r.name));
   const nextNames=new Set(waiting.map(r=>r.name));
   const promoted=[...new Set([...preferred,...nextNames])];
   const pending=[...new Set([...promoted,...open.map(e=>e.name)])].filter(name=>name!==job?.desired.blueprint);
   queue={site:focus,pending,preferred:promoted,done:[...done].map(([name,at])=>({name,at}))};
  }
  return {queue,waiting:c?choices.waiting(c.version):[],enabled:!!c?.enabled,version:c?.version??v,stale:!!c&&c.version!==v,phase:c?(stages[c.phase]||'Fertig'):'Steinfüllung',stations:db.prepare('SELECT site,state FROM erebor_queue_sites ORDER BY site').all().map(r=>{
   const s=JSON.parse(r.state),j=s.job,signal=report?.stations?.[r.site];
   const live=j?.loaded&&signal?.upload===j.desired.file?{state:signal.state,status:signal.status,placed:signal.placed,total:signal.total,fuel:signal.fuel,target:signal.target,chunks:signal.chunks?.length||0,at:report.at}:null;
   return {site:r.site,automatic:!!production.mode(c.version,r.site).enabled,status:s.status,live,upload:j?.desired.file??null,kind:j?.phase??null,inserted:!!s.inserted,sha256:j?.desired.sha256||null,file:j?.desired.blueprint||null,anchor:j?.desired.anchor||null,blocks:j?.blocks??null,completed:s.completed,checked:s.checked||null};
  })};
 }
 app.get(base,async(req,reply)=>{requireActor(req,'read');const report=await liveReport(cfg()?.version);return reply.header('Cache-Control','private, no-store').send(status(report,req.query.site));});
 app.post(base+'/start',async req=>{
  const actor=requireActor(req,'admin'),b=req.body;
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(!b||!sites.includes(b.site)||b.version!==layout.version||b.version!==project()?.current_version||b.version!==cfg()?.version)throw new HttpError(409,'Kanonenplatz oder Projektversion geändert.');
  const j=read(b.site).job;
  if(!j?.loaded||j.desired.file!==b.upload||j.desired.blueprint!==b.file||j.desired.sha256!==b.sha256)throw new HttpError(409,'Der eingelegte Bauplan hat gewechselt. Bitte neu auswählen.');
  if(choices.next(b.version,b.site))throw new HttpError(409,'Ein anderer Bauplan ist vorgemerkt. Bitte den Wechsel abwarten.');
  const result=await startJob(b.site,b.version,j);
  const s=read(b.site);if(s.job?.desired.file===b.upload){
   observe(b.site,s,result.observed);s.job.started=true;s.checked=new Date().toISOString();persist(b.site,s);
  }
  logActivity(db,actor,'erebor.plan.start',b.site,{file:b.file,version:b.version,alreadyRunning:!!result.alreadyRunning});
  return {started:true,alreadyRunning:!!result.alreadyRunning,waiting:!!result.waiting,site:b.site};
 });
 function productionContext(req){
  const actor=requireActor(req,'admin'),b=req.body,p=project();
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(!p||!sites.includes(b?.site)||b.version!==layout.version||b.version!==p.current_version)throw new HttpError(409,'Kanonenplatz oder Projektversion geändert.');
  if(!cfg())configureEreborQueue(db,{action:'pause',version:b.version},actor);
  if(cfg().version!==b.version)throw new HttpError(409,'Veraltete Planfolge.');
  return {actor,b,p};
 }
 app.post(base+'/automatik',async req=>{
  const {actor,b}=productionContext(req);
  if(typeof b.enabled!=='boolean')throw new HttpError(400,'Automatikzustand fehlt.');
  tx(db,()=>{production.switch(b.version,b.site,b.enabled);logActivity(db,actor,'erebor.automatic.mode',b.site,{enabled:b.enabled,version:b.version});});
  wake();return {site:b.site,enabled:b.enabled};
 });
 app.post(base+'/vorziehen',async req=>{
  const {actor,b,p}=productionContext(req);
  const entry=production.ordered(p,b.site).open.find(f=>f.name===b.file&&f.sha256===b.sha256);
  if(!entry||entry.name===read(b.site).job?.desired.blueprint)throw new HttpError(409,'Nur einen offenen Abschnitt dieser Kanone vorziehen.');
  tx(db,()=>{production.promote(b.version,b.site,entry.name);logActivity(db,actor,'erebor.plan.priority',b.site,{file:entry.name,version:b.version});});
  wake();return {site:b.site,file:entry.name};
 });
 app.post(base+'/laden',async(req,reply)=>{
  const actor=requireActor(req,'admin'),b=req.body,p=project();
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(!p||!sites.includes(b?.site)||b.version!==layout.version||b.version!==p.current_version)throw new HttpError(409,'Kanonenplatz oder Projektversion nicht aktuell.');
  const {job,bytes}=publishedPlan(db,p,b);
  if(!cfg())configureEreborQueue(db,{action:'pause',version:b.version},actor);
  if(cfg().version!==b.version)throw new HttpError(409,'Planfolge gehört zu einer anderen Projektversion.');
  const s=read(b.site),old=s.job;
  if(old?.desired.blueprint===job.desired.blueprint&&old.desired.sha256===job.desired.sha256){
   const {observed}=await request('erebor-inspect',{site:b.site,version:b.version});
   if(!verifyAlignment(old.desired,observed,old.desired)&&same(observed.components?.['create:schematic_bounds'],job.size))return {status:'loaded',site:b.site};
  }
  const receipt=tx(db,()=>{
   const r=choices.add(b.version,b.site,job,bytes,old?.desired.file??null);
   logActivity(db,actor,'erebor.plan.laden',b.site,{file:b.file,version:b.version,id:r.id});return r;
  });
  wake();return reply.code(202).send({...receipt,site:b.site});
 });
 app.post(base,async req=>{
  const actor=requireActor(req,'admin');
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  const b=req.body;
  configureEreborQueue(db,b,actor);
  if(b.action==='prepare')wake();
  return status();
 });
}
