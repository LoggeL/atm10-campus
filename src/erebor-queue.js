import {publishedPlan,selectionStore,unstarted} from './erebor-selection.js';
import {productionStore} from './erebor-production.js';
import {parallelFleet,parallelLayout} from './erebor-parallel.js';
import {Region} from './region.js';
import {zipStore} from './zip.js';
import {ereborFeeder,isStationStone} from './erebor-feeder.js';
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
export function recordedFinish(o,j,r,now=Date.now(),witness=null){
 // KubeJS retains only the most recent input -> finished transition at this
 // physical station. Seeing another input clears it. After an outage, accept
 // an older event only when the current signed report still witnesses it,
 // and a separate native inspection confirms the reset and output count.
 const retained=!!witness&&Number.isFinite(witness.at)&&now>=witness.at&&now-witness.at<45000&&
  witness.at>=r?.at&&witness.signal?.upload===''&&witness.signal.state==='STOPPED'&&witness.signal.status==='finished'&&
  same(witness.signal.finish,r)&&Number.isFinite(o.at)&&now>=o.at*1000-1000&&Math.abs(now-o.at*1000)<15000;
 return !!r && r.file===j.desired.file && Number.isFinite(r.at) && Number.isFinite(r.before) &&
  r.before<=r.at && r.at-r.before<=10000 && r.at>=j.seen*1000 && now>=r.at && (now-r.at<600000||retained) &&
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
 db.exec('CREATE TABLE IF NOT EXISTS erebor_resume(version INTEGER,site TEXT,slot TEXT,upload TEXT,expires INTEGER,result TEXT,PRIMARY KEY(version,site,slot))');
 const helpers=parallelFleet(db,production,choices,request,recordedFinish,resumePaused);
 campus.ereborHelpers=helpers;
 function available(p,site){
  const busy=helpers.reserved(p.current_version,site);
  const {open,done}=production.ordered(p,site);
  const geometry=name=>name.replace(/_V\d+$/,'');
  const taken=new Set([...busy,...done.keys()].map(geometry));
  return open.filter(e=>!taken.has(geometry(e.name))&&(!busy.size||e.stage==='stone'));
 }
 const cfg=()=>db.prepare('SELECT * FROM erebor_queue_config WHERE id=1').get();
 const project=()=>db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
 const read=site=>JSON.parse(db.prepare('SELECT state FROM erebor_queue_sites WHERE site=?').get(site).state);
 const persist=(site,s)=>db.prepare('UPDATE erebor_queue_sites SET state=? WHERE site=?').run(JSON.stringify(s),site);
 campus.ereborStationBinding=name=>{
  const [x,y,z]=layout.sites.find(s=>s.site===name.slice(-3).toUpperCase()).cannon;
  return {x,y,z,dimension:'minecraft:overworld',owner:'Erebor'};
 };
 campus.ereborFeeder=ereborFeeder(db,request,layout.version,liveReport);
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
 function observe(site,s,o,witness){
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
  if(confirmedFinish(o,j)||recordedFinish(o,j,witness?.signal?.finish,Date.now(),witness)){
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
 const resumeRow=db.prepare('SELECT upload,expires FROM erebor_resume WHERE version=? AND site=? AND slot=? AND result IS NULL');
 const finishResume=db.prepare('UPDATE erebor_resume SET result=? WHERE version=? AND site=? AND slot=? AND upload=? AND result IS NULL');
 async function resumePaused(site,slot,version,job,observed){
  const row=resumeRow.get(version,site,slot);
  if(!row)return false;
  const finish=message=>finishResume.run(message,version,site,slot,row.upload);
  if(row.expires<=Date.now()||job.desired.file!==row.upload){finish('Auftrag abgelaufen oder Bauplan gewechselt');return false;}
  if(observed.state==='RUNNING'){finish('Läuft bereits');return false;}
  if(observed.state!=='PAUSED'||!['ready','searching','placing'].includes(observed.status)||observed.flyingBlocks!==0)return false;
  if(!current(version)||!isStationStone(job,site)||verifyAlignment(job.desired,observed,job.desired)||
     !same(observed.components?.['create:schematic_bounds'],job.size))return false;
  try{
   const result=await startJob(slot==='A'?site:site+slot,version,job);
   finish(result.observed.state==='RUNNING'?'Fortgesetzt':'Create wartet nach dem Start auf '+result.observed.status);
  }catch(e){finish(e.message);}
  return true;
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
 async function station(site,s,c,p,archive,report){
  let choice=choices.next(c.version,site);
  const automatic=()=>!!production.mode(c.version,site).enabled;
  if(!automatic()&&!choice&&(s.exhausted||!c.enabled)&&!s.job?.loaded&&!s.job?.selection)return;
  const data={site,version:c.version};
  const signal=report?.stations?.[site],tracked=s.job;
  if(!choice&&tracked?.loaded&&signal&&Date.now()-report.at<15000){
   if(signal.state==='STOPPED'&&signal.status==='finished'&&signal.empty&&!signal.finish&&Date.now()/1000-tracked.seen>=90){
    s.inserted=false;s.status='Wartet auf bestätigten Abschluss';return;
   }
   if(isStationStone(tracked,site)&&signal.upload===tracked.desired.file&&signal.state==='RUNNING'&&signal.aligned&&
      signal.owner===tracked.desired.owner&&same(signal.anchor,tracked.desired.anchor)&&same(signal.size,tracked.size)&&
      same(signal.options,[0,false,false])&&Number.isSafeInteger(signal.placed)&&report.at>=tracked.seen*1000){
    if(signal.status==='skipping'||signal.placed<(tracked.placed||0))tracked.tainted=true;
    tracked.placed=signal.placed;tracked.seen=report.at/1000;tracked.started=true;s.inserted=true;s.status='Baut';
    if(automatic()&&production.mode(c.version,site).started_upload!==signal.upload)production.started(c.version,site,signal.upload);
    return;
   }
  }
  const sample=!choice&&s.job?.loaded?campus.ereborFeeder.sample(site):null;
  const o=sample&&sample.at>=s.job.seen?sample:(await request('erebor-inspect',data)).observed;
  if(!current(c.version))return;
  const old=s.job;
  const aligned=old&&!verifyAlignment(old.desired,o,old.desired)&&same(o.components?.['create:schematic_bounds'],old.size);
  if(old){
   const report=o.inputEmpty===true&&o.status==='finished'?await liveReport(c.version):null;
   if(!current(c.version))return;
   observe(site,s,o,report?{at:report.at,signal:report.stations?.[site]}:null);
  }
  if(!choice&&aligned&&s.job&&await resumePaused(site,'A',c.version,s.job,o))return;
  if(automatic()&&old&&s.job&&aligned){
   const completed=production.done(c.version,site,old.desired.blueprint);
   if(!completed || !unstarted(old,o)){
    if(!completed)await startAutomatic(site,s,c.version,o);
    return;
   }
   if(!choice){
    const next=available(p,site)[0];
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
    readAt=0;
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
   const next=available(p,site)[0];
   if(!next){s.status='Baufolge erledigt';s.exhausted=true;return;}
   const {job,bytes}=published(p,site,next);
   s.job={...job,next:s.cursor};
   db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(s),bytes,site);
  }
  if(!s.job){
   if(c.phase!=='stone'&&helpers.reserved(c.version,site).size)return;
   const selected=await generate(p,{site,phase:c.phase,cursor:s.cursor,architecture:archive?.[c.phase]?.[site]?.[s.cursor]});
   if(!current(c.version)||automatic()||production.priority(c.version,site)||choices.next(c.version,site))return;
   if(!selected.file){s.cursor=selected.next;s.exhausted=!!selected.exhausted;s.status=s.exhausted?'Phase erledigt':'Nächster Abschnitt wird geprüft';return;}
   const name=selected.file.slice(0,-4),geometry=name.replace(/_V\d+$/,'');
   const carried=production.ordered(p,site).done;
   if([...helpers.reserved(c.version,site),...carried.keys()].some(n=>n.replace(/_V\d+$/,'')===geometry)){
    s.cursor=selected.next;s.status='Abschnitt bereits vergeben oder fertig';return;
   }
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
  readAt=0;
  if(!res.applied||!observe(site,s,res.observed))throw Error('Einlegen noch nicht bestätigt.');
  persist(site,s);
  await startAutomatic(site,s,c.version,res.observed);
 }
 async function tick(){
  const c=cfg(),p=project();
  if(!c||!p||c.version!==p.current_version||closed)return;
  const tracking=db.prepare("SELECT site FROM erebor_queue_sites WHERE json_extract(state,'$.job.loaded')=1").all().map(r=>r.site);
  const active=[...production.enabled(c.version),...choices.active(c.version),...tracking];
  const pendingHelpers=helpers.list(c.version).some(r=>r.name);
  if((!c.enabled||c.phase==='finished')&&!active.length&&!pendingHelpers&&!(c.phase==='stone'&&helpers.isEnabled(c.version)))return;
  const acquired=db.prepare('UPDATE erebor_queue_config SET lease=?,expires=? WHERE id=1 AND (lease IS NULL OR expires<? OR lease=?)').run(owner,Date.now()+120000,Date.now(),owner);
  if(!acquired.changes)return;
  try{
   const archive=c.archive?JSON.parse(c.archive):null;
   let report=await liveReport(c.version);
   for(const site of new Set([...active,...(c.enabled&&c.phase!=='finished'?sites:[])])){
    if(!current(c.version))return;
    if(report&&Date.now()-report.at>=30000)report=await liveReport(c.version);
    // V4 emits an empty row when the station chunk is asleep or the cannon is absent.
    // A missing row is inconclusive. Keep the native check in that case.
    const signal=report?.stations?.[site];
    if(report?.sharedChest===4&&signal&&Object.keys(signal).length===0)continue;
    db.prepare('UPDATE erebor_queue_config SET expires=? WHERE id=1 AND lease=?').run(Date.now()+120000,owner);
    const s=read(site);
    try{await station(site,s,c,p,archive,report);}catch(e){s.status=e.message;s.inserted=false;}
    if(current(c.version)){s.checked=new Date().toISOString();persist(site,s);}
   }
   const renew=()=>{
    if(!current(c.version))return false;
    db.prepare('UPDATE erebor_queue_config SET expires=? WHERE id=1 AND lease=?').run(Date.now()+120000,owner);
    return true;
   };
   if(current(c.version)){
    const report=await liveReport(c.version);
    await helpers.tick(p,report,()=>c.phase==='stone'&&helpers.isEnabled(c.version),read,renew,()=>liveReport(c.version));
   }
   if(current(c.version)&&cfg().enabled&&c.phase!=='finished'&&!helpers.list(c.version).some(r=>r.name)&&sites.every(site=>{const s=read(site);return s.exhausted&&!s.job;})){
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
 campus.ereborLiveReport=liveReport;
 function status(report=null,focus=null){
  const c=cfg(),v=project()?.current_version;
  let queue=null;
  if(v&&sites.includes(focus)){
   const {open,done,preferred}=production.ordered(project(),focus),state=c?read(focus):readyState(),job=state.job;
   const waiting=choices.waiting(v).filter(r=>r.site===focus&&!done.has(r.name));
   const nextNames=new Set(waiting.map(r=>r.name));
   const promoted=[...new Set([...preferred,...nextNames])];
   const busy=helpers.reserved(v,focus);
   const pending=[...new Set([...promoted,...open.map(e=>e.name)])].filter(name=>name!==job?.desired.blueprint&&!busy.has(name));
   queue={site:focus,pending,preferred:promoted,done:[...done].map(([name,at])=>({name,at}))};
  }
  return {queue,helpers:c?helpers.list(c.version):[],waiting:c?choices.waiting(c.version):[],enabled:!!c?.enabled,version:c?.version??v,stale:!!c&&c.version!==v,phase:c?(stages[c.phase]||'Fertig'):'Steinfüllung',stations:db.prepare('SELECT site,state FROM erebor_queue_sites ORDER BY site').all().map(r=>{
   const s=JSON.parse(r.state),j=s.job,signal=report?.stations?.[r.site];
   const live=j?.loaded&&signal?.upload===j.desired.file?{state:signal.state,status:signal.status,placed:signal.placed,total:signal.total,fuel:signal.fuel,target:signal.target,chunks:signal.chunks?.length||0,at:report.at}:null;
   return {site:r.site,automatic:!!production.mode(c.version,r.site).enabled,status:s.status,live,upload:j?.desired.file??null,kind:j?.phase??null,inserted:!!s.inserted,sha256:j?.desired.sha256||null,file:j?.desired.blueprint||null,anchor:j?.desired.anchor||null,blocks:j?.blocks??null,completed:s.completed,checked:s.checked||null};
  })};
 }
 app.get(base,async(req,reply)=>{requireActor(req,'read');const report=await liveReport(cfg()?.version);return reply.header('Cache-Control','private, no-store').send(status(report,req.query.site));});
 app.get(base+'/drucker-reparatur.zip',async(req,reply)=>{
  requireActor(req,'admin');
  const version=cfg()?.version,report=await liveReport(version);
  if(!report||version!==project()?.current_version||report.version!==layout.version)throw new HttpError(503,'Keine aktuelle Erebor-Weltmeldung.');
  const commands=[];
  const ints=v=>'[I;'+v.join(',')+']';
  for(const p of parallelLayout.sites)for(const slot of ['A','B','C']){
   const s=report.stations?.[slot==='A'?p.site:p.site+slot];
   if(s?.state!=='RUNNING'||s.status!=='searching'||!s.aligned||s.target!==null||s.chunks?.length!==0)continue;
   const job=slot==='A'?read(p.site).job:helpers.jobAt(version,p.site,slot);
   if(!job?.loaded||!isStationStone(job,p.site)||job.desired.file!==s.upload||!/^campus_[a-f0-9-]{36}\.nbt$/.test(s.upload)||
      s.owner!=='Erebor'||!same(s.options,[0,false,false])||!same(job.desired.anchor,s.anchor)||!same(job.size,s.size)||
      !Number.isSafeInteger(s.placed)||s.placed<0)continue;
   const pos=p[slot==='A'?'main':slot].join(' '),anchor=ints(s.anchor);
   const components='"create:schematic_file":"'+s.upload+'","create:schematic_owner":"Erebor","create:schematic_anchor":'+anchor+
    ',"create:schematic_bounds":'+ints(s.size)+',"create:schematic_deployed":1b,"create:schematic_rotation":"none","create:schematic_mirror":"none"';
   const guard='State:"RUNNING",Status:"searching",MissingItem:{id:"minecraft:stone"},AmountPlaced:'+s.placed+
    ',FlyingBlocks:[],Options:{replace_mode:0,skip_missing:0b,replace_block_entities:0b},Printer:{Anchor:'+anchor+
    ',CurrentPos:[I;-1,0,0],PrintStage:"BLOCKS",EntityProgress:-1,DeferredBlocks:[]},Inventory:{Items:[{Slot:0,id:"create:schematic",components:{'+components+'}}]}';
   commands.push('execute in minecraft:overworld if block '+pos+' create:schematicannon{'+guard+'} run data remove block '+pos+' MissingItem');
  }
  if(!commands.length)throw new HttpError(409,'Aktuell keine passenden suchenden Cleanstone-Kanonen.');
  const bytes=zipStore([{name:'pack.mcmeta',data:Buffer.from(JSON.stringify({pack:{pack_format:48,description:'Erebor · blockierte Cleanstone-Drucker'}}))},
   {name:'data/campus/function/erebor_drucker.mcfunction',data:Buffer.from(commands.join('\n')+'\n')}]);
  return reply.header('Cache-Control','private, no-store').header('Content-Disposition','attachment; filename="erebor-drucker.zip"').type('application/zip').send(bytes);
 });
 let inspecting=false;
 const inspections=new Map();
 app.get(base+'/drucker/:slot',async(req,reply)=>{
  requireActor(req,'read');
  const key=req.params.slot,site=key.slice(0,3),slot=key.slice(3),version=cfg()?.version;
  if(!sites.includes(site)||!['A','B','C'].includes(slot)||version!==project()?.current_version)throw new HttpError(404,'Unbekannter Erebor-Drucker.');
  const liveKey=slot==='A'?site:key;
  const signal=(await liveReport(version))?.stations?.[liveKey];
  if(signal?.state!=='RUNNING'||signal.status!=='searching')throw new HttpError(409,'Die Kanone sucht gerade nicht.');
  const job=slot==='A'?read(site).job:helpers.jobAt(version,site,slot);
  if(!isStationStone(job,site)||!job.loaded||job.desired.file!==signal.upload)throw new HttpError(409,'Kein passender Cleanstone-Auftrag.');
  reply.header('Cache-Control','no-store');
  const saved=inspections.get(key);
  if(saved?.file===signal.upload&&Date.now()/1000-saved.at<20)return saved;
  if(inspecting)throw new HttpError(429,'Eine Druckerprüfung läuft bereits.');
  inspecting=true;
  try{
   const {observed:o}=await request('erebor-inspect',{site:liveKey,version});
   const error=verifyAlignment(job.desired,o,job.desired);
   if(error||!same(o.components?.['create:schematic_bounds'],job.size))throw new HttpError(409,error||'Bauplanmaße abweichend.');
   const result={site,slot,file:job.desired.file,at:o.at,state:o.state,status:o.status,
    anchor:job.desired.anchor,size:job.size,position:o.printer.CurrentPos,stage:o.printer.PrintStage,entity:o.printer.EntityProgress,
    deferred:o.printer.DeferredCount??o.printer.DeferredBlocks?.length,placed:o.amountPlaced,total:o.amountToPlace,flights:o.flyingBlocks};
   // V5's live bridge omits MissingItem. Only show the saved hint for the exact
   // same upload, state, counter and cursor as the independent native inspection.
   const coordinates=parallelLayout.sites.find(s=>s.site===site)[slot==='A'?'main':slot];
   const [x,y,z]=coordinates;
   try{
    const region=config.worldSources.live&&Region.open(config.worldSources.live,x>>9,z>>9);
    const chunk=region?.chunk(x>>4,z>>4);
    const be=chunk?.block_entities?.find(b=>b.x===x&&b.y===y&&b.z===z&&b.id==='create:schematicannon');
    const input=be?.Inventory?.Items?.find(i=>i.Slot===0);
    if(input?.components?.['create:schematic_file']===signal.upload&&be.State===o.state&&be.Status===o.status&&
       be.AmountPlaced===o.amountPlaced&&be.Printer?.CurrentPos&&same(Array.from(be.Printer.CurrentPos),result.position)){
     result.savedMissingItem=be.MissingItem?.id??null;
    }
   }catch{/* A missing or concurrently saved region is inconclusive. */}
   inspections.set(key,result);return result;
  }finally{inspecting=false;}
 });
 app.post(base+'/fortsetzen',async(req,reply)=>{
  const actor=requireActor(req,'admin'),v=req.body?.version;
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(v!==layout.version||project()?.current_version!==v||cfg()?.version!==v)throw new HttpError(409,'Projektversion geändert.');
  const report=await liveReport(v);
  if(report?.sharedChest!==4||!report.stations)throw new HttpError(503,'Keine aktuelle Weltmeldung.');
  const expires=Date.now()+10*60000;
  const save=db.prepare('INSERT INTO erebor_resume VALUES(?,?,?,?,?,NULL) ON CONFLICT(version,site,slot) DO UPDATE SET upload=excluded.upload, expires=excluded.expires,result=NULL');
  const queued=tx(db,()=>{
   const slots=[];
   for(const site of sites)for(const slot of ['A','B','C']){
    const signal=report.stations[slot==='A'?site:site+slot];
    if(!signal?.ready||signal.state!=='PAUSED'||!signal.upload)continue;
    const job=slot==='A'?read(site).job:helpers.jobAt(v,site,slot);
    if(!job?.loaded||!isStationStone(job,site)||signal.upload!==job.desired.file||slot==='A'&&choices.next(v,site))continue;
    save.run(v,site,slot,signal.upload,expires);slots.push(site+slot);
   }
   logActivity(db,actor,'erebor.resume','erebor',{version:v,slots});
   return slots;
  });
  wake();
  return reply.code(202).send({queued,expires});
 });
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
 app.post(base+'/dreierbetrieb',async req=>{
  const actor=requireActor(req,'admin'),b=req.body;
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(b?.version!==layout.version||project()?.current_version!==b.version||typeof b.enabled!=='boolean')
   throw new HttpError(409,'Projektversion oder Betriebszustand prüfen.');
  if(!cfg())configureEreborQueue(db,{action:'pause',version:b.version},actor);
  if(b.allMains!==undefined&&b.allMains!==true)throw new HttpError(400,'Ungültige Flottenauswahl.');
  tx(db,()=>{
   helpers.switchAll(b.version,b.enabled);
   if(b.allMains)for(const site of sites)production.switch(b.version,site,b.enabled);
   logActivity(db,actor,'erebor.helpers.mode','erebor',{version:b.version,enabled:b.enabled,allMains:!!b.allMains});
  });
  wake();return {enabled:b.enabled};
 });
 app.post(base+'/automatik',async req=>{
  const {actor,b}=productionContext(req);
  if(typeof b.enabled!=='boolean')throw new HttpError(400,'Automatikzustand fehlt.');
  tx(db,()=>{production.switch(b.version,b.site,b.enabled);logActivity(db,actor,'erebor.automatic.mode',b.site,{enabled:b.enabled,version:b.version});});
  wake();return {site:b.site,enabled:b.enabled};
 });
 app.post(base+'/vorziehen',async req=>{
  const {actor,b,p}=productionContext(req);
  if(helpers.reserved(b.version,b.site).has(b.file))throw new HttpError(409,'Dieser Abschnitt liegt bei einer Zusatzkanone.');
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
  const reserved=helpers.reserved(b.version,b.site);
  if(reserved.has(job.desired.blueprint)||(reserved.size&&job.phase!=='stone'))throw new HttpError(409,'Zusatzkanonen bearbeiten noch die Steinfüllung.');
  if(!cfg())configureEreborQueue(db,{action:'pause',version:b.version},actor);
  if(cfg().version!==b.version)throw new HttpError(409,'Planfolge gehört zu einer anderen Projektversion.');
  const s=read(b.site),old=s.job;
  if(old?.desired.blueprint===job.desired.blueprint&&old.desired.sha256===job.desired.sha256){
   const {observed}=await request('erebor-inspect',{site:b.site,version:b.version});
   if(!verifyAlignment(old.desired,observed,old.desired)&&same(observed.components?.['create:schematic_bounds'],job.size))return {status:'loaded',site:b.site};
  }
  const receipt=tx(db,()=>{
   if(helpers.reserved(b.version,b.site).has(job.desired.blueprint))throw new HttpError(409,'Dieser Abschnitt wurde inzwischen einer Zusatzkanone zugeteilt.');
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
