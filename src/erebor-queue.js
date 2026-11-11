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
 const cfg=()=>db.prepare('SELECT * FROM erebor_queue_config WHERE id=1').get();
 const project=()=>db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
 const read=site=>JSON.parse(db.prepare('SELECT state FROM erebor_queue_sites WHERE site=?').get(site).state);
 const persist=(site,s)=>db.prepare('UPDATE erebor_queue_sites SET state=? WHERE site=?').run(JSON.stringify(s),site);
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
 const current=v=>!closed&&db.prepare('SELECT 1 FROM erebor_queue_config q JOIN build_projects p ON p.id=\'erebor\' WHERE q.id=1 AND q.enabled=1 AND q.version=p.current_version AND q.version=? AND q.lease=? AND q.expires>?').get(v,owner,Date.now());
 function observe(site,s,o){
  const j=s.job;
  s.inserted=false;
  if(!verifyAlignment(j.desired,o,j.desired)&&same(o.components['create:schematic_bounds'],j.size)){
   if(o.status==='skipping'||o.amountPlaced<(j.placed||0))j.tainted=true;
   j.placed=o.amountPlaced;j.seen=o.at;j.loaded=true;s.inserted=true;
   j.baseline=o.outputItem==='create:empty_schematic'||o.outputCount===0?o.outputCount:null;
   db.prepare('UPDATE erebor_queue_sites SET payload=NULL WHERE site=? AND payload IS NOT NULL').run(site);
   s.status='Eingelegt';
   if(o.state==='RUNNING')s.status='Baut';
   else if(o.status==='noGunpowder')s.status='Eingelegt · Schießpulver fehlt';
   else if(o.state==='PAUSED'&&o.status!=='ready')s.status='Pausiert: '+o.status;
   return true;
  }
  if(confirmedFinish(o,j)){
   s.cursor=j.next;s.completed++;s.job=null;s.status='Fertig, nächster Plan folgt';return true;
  }
  if(j.loaded){
   if(o.item||o.state!=='STOPPED'||o.status!=='finished')j.tainted=true;
   s.status='Wartet auf bestätigten Abschluss';return true;
  }
  return false;
 }
 async function station(site,s,c,p,archive){
  if(s.exhausted)return;
  const data={site,version:c.version};
  const {observed:o}=await request('erebor-inspect',data);
  if(!current(c.version))return;
  if(s.job&&observe(site,s,o))return;
  if(o.inputEmpty!==true||!cannonReset(o)){s.status='Kanone belegt';return;}
  if(!s.job){
   const selected=await generate(p,{site,phase:c.phase,cursor:s.cursor,architecture:archive?.[c.phase]?.[site]?.[s.cursor]});
   if(!current(c.version))return;
   if(!selected.file){s.cursor=selected.next;s.exhausted=!!selected.exhausted;s.status=s.exhausted?'Phase erledigt':'Nächster Abschnitt wird geprüft';return;}
   const bytes=Buffer.from(selected.bytes),file='campus_'+randomUUID()+'.nbt';
   const desired={file,sha256:createHash('sha256').update(bytes).digest('hex'),blueprint:selected.file.slice(0,-4),owner:'Erebor',anchor:selected.origin,version:c.version,rotation:'none',mirror:'none',options:{replace_mode:modes[c.phase],skip_missing:false,replace_block_entities:false}};
   s.job={desired,size:selected.size,blocks:selected.blocks,next:selected.next,phase:c.phase,loaded:false,seen:0};
   db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(s),bytes,site);
  }
  if(!current(c.version))return;
  const j=s.job,{options,...desired}=j.desired;
  const bytes=db.prepare('SELECT payload FROM erebor_queue_sites WHERE site=?').get(site).payload;
  if(!bytes)throw Error('Vorbereitete Datei fehlt.');
  const res=await request('erebor-prepare',{...data,desired,kind:j.phase,size:j.size,nbtBase64:Buffer.from(bytes).toString('base64')});
  if(!res.applied||!observe(site,s,res.observed))throw Error('Einlegen noch nicht bestätigt.');
 }
 async function tick(){
  const c=cfg(),p=project();
  if(!c?.enabled||!p||c.version!==p.current_version||closed||c.phase==='finished')return;
  const acquired=db.prepare('UPDATE erebor_queue_config SET lease=?,expires=? WHERE id=1 AND (lease IS NULL OR expires<? OR lease=?)').run(owner,Date.now()+120000,Date.now(),owner);
  if(!acquired.changes)return;
  try{
   const archive=c.archive?JSON.parse(c.archive):null;
   for(const site of sites){
    if(!current(c.version))return;
    db.prepare('UPDATE erebor_queue_config SET expires=? WHERE id=1 AND lease=?').run(Date.now()+120000,owner);
    const s=read(site);if(s.exhausted)continue;
    try{await station(site,s,c,p,archive);}catch(e){s.status=e.message;s.inserted=false;}
    if(current(c.version)){s.checked=new Date().toISOString();persist(site,s);}
   }
   if(current(c.version)&&sites.every(site=>read(site).exhausted)){
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
 function status(){
  const c=cfg(),v=project()?.current_version;
  return {enabled:!!c?.enabled,version:c?.version??v,stale:!!c&&c.version!==v,phase:c?(stages[c.phase]||'Fertig'):'Steinfüllung',stations:db.prepare('SELECT site,state FROM erebor_queue_sites ORDER BY site').all().map(r=>{
   const s=JSON.parse(r.state),j=s.job;return {site:r.site,status:s.status,inserted:!!s.inserted,sha256:j?.desired.sha256||null,file:j?.desired.blueprint||null,anchor:j?.desired.anchor||null,blocks:j?.blocks??null,completed:s.completed,checked:s.checked||null};
  })};
 }
 app.get(base,async(req,reply)=>{requireActor(req,'read');return reply.header('Cache-Control','private, no-store').send(status());});
 app.post(base,async req=>{
  const actor=requireActor(req,'admin');
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  const b=req.body;
  configureEreborQueue(db,b,actor);
  if(b.action==='prepare')wake();
  return status();
 });
}
