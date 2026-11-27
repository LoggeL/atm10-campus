import {interiorColumns,interiorFrontier,interiorGroup,interiorRelease,inRange,insideMassif} from './erebor-interior.js';
import {landscapeQueue,readySurface,releasedSurface,oldTreeInput} from './erebor-landscape-work.js';
import {mountainTop} from './project-stone.js';
import {groupOf,slotsFor} from './erebor-groups.js';
import {cannonProgressRows} from './cannon-progress-rows.js';
import {publishedPlan,selectionStore,unstarted} from './erebor-selection.js';
import {productionStore} from './erebor-production.js';
import {projectProgress,massifForecast,overallProgress} from './erebor-progress.js';
import {availableMassifSlots} from './erebor-balance.js';
import {surfaceOverview} from './api-erebor-surface.js';
import {dashboardData} from './erebor-dashboard.js';
import {placementThroughput} from './erebor-throughput.js';
import {registerMassif} from './erebor-massif.js';
import {witnessedUrn,readyUrnPack} from './erebor-manual-urn.js';
import {parallelFleet,parallelLayout} from './erebor-parallel.js';
import {Region} from './region.js';
import {zipStore} from './zip.js';
import {ereborFeeder,isStationStone,needsSolidReplacement,observedEreborOptions,completedStoneOptions,verifyEreborAlignment as verifyAlignment} from './erebor-feeder.js';
import {Worker} from 'node:worker_threads';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {isDeepStrictEqual as same} from 'node:util';
import {bridgeClient,cannonReset,emptyStopped} from './alignment.js';
import {DESIGN_REVISION} from './erebor-design.js';
import {requireActor,HttpError} from './auth.js';
import {logActivity,tx} from './db.js';
import {hallPackage,hallParents} from './erebor-hall-split.js';

const layout=JSON.parse(readFileSync(new URL('./erebor-fleet/stations.json',import.meta.url)));
const sites=layout.sites.map(s=>s.site);
const base='/api/projects/erebor/planfolge';
const modes={stone:2,clear:3,build:2};
const stages={stone:'Steinfüllung',clear:'Aushub',build:'Bau'};
const readyState=()=>({cursor:0,completed:0,exhausted:false,job:null,status:'Wartet auf Prüfung'});
export function awaitingNextPrint(row,signal){
 if(!(row.completed>0)||!signal?.ready||signal.empty!==true||signal.upload||
    signal.state!=='STOPPED'||signal.status!=='finished')return false;
 const j=row.job;
 if(j)return (j.surface===true||j.interior===true)&&j.loaded===false&&!j.started&&!j.tainted&&!j.placed&&
   !j.selection&&!!j.desired?.file&&j.desired.owner==='Erebor';
 return row.slot==='A'?row.status==='Abschluss bestätigt, nächster Bauabschnitt folgt':
   !row.name&&row.message==='Abschnitt fertig';
}
export function confirmedFinish(o,job,now=Date.now()/1000){
 return !job.tainted&&job.seen>0&&now-job.seen<90&&o.inputEmpty===true&&o.state==='STOPPED'&&o.status==='finished'&&cannonReset(o)&&
  o.outputItem==='create:empty_schematic'&&Number.isSafeInteger(job.baseline)&&o.outputCount===job.baseline+1&&
  same(o.options,observedEreborOptions(job.desired,o.options));
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
 const {db,config}=campus,transport=config.cannonBridgeRequest||bridgeClient(config);
 async function request(action,args){
  const result=await transport(action,args);
  if(action!=='erebor-prepare'||!result?.urnWarming||result.applied!==false||
     !args.desired?.blueprint?.includes('_URN_'))return result;
  // The tracker reads its target registry every 40 game ticks. Finish this
  // handshake while its ten-minute ticket is valid, even on long fleet passes.
  await new Promise(resolve=>setTimeout(resolve,3500));
  const site=args.site.slice(0,3),slot=args.site.slice(3)||'A',v=args.version;
  if(!current(v)||!massif.enabled(v))return result;
  const enabled=slot==='A'?production.mode(v,site).enabled:cfg().phase==='stone'&&helpers.isEnabled(v);
  const job=slot==='A'?read(site).job:helpers.jobAt(v,site,slot);
  if(!enabled||job?.desired.file!==args.desired.file)return result;
  return transport(action,args);
 }
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_queue_config(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL,enabled INTEGER NOT NULL,phase TEXT NOT NULL,archive TEXT,lease TEXT,expires INTEGER);
 CREATE TABLE IF NOT EXISTS erebor_queue_sites(site TEXT PRIMARY KEY,state TEXT NOT NULL,payload BLOB);`);
 const choices=selectionStore(db);
 const production=productionStore(db);
 const massif=registerMassif(app,campus,parallelLayout.sites,version=>
  availableMassifSlots(parallelLayout.sites,liveCache,version,new Set(production.enabled(version)),
   cfg()?.phase==='stone' && helpers.isEnabled(version)),version=>
   liveCache?.version===version&&[1,2].includes(liveCache.urnPreparation)&&Math.abs(Date.now()-liveCache.at)<45000?(liveCache.urnPreparation===2&&liveCache.urnPacks===3?3:liveCache.urnPreparation):0);
 db.exec('CREATE TABLE IF NOT EXISTS erebor_resume(version INTEGER,site TEXT,slot TEXT,upload TEXT,expires INTEGER,result TEXT,PRIMARY KEY(version,site,slot))');
 const verifyStone=config.worldSources.live?(p,verifyStone)=>generate(p,{verifyStone}):null;
 const landscape=landscapeQueue(db);
 const helpers=parallelFleet(db,production,choices,request,recordedFinish,resumePaused,verifyStone,massif,{candidate:interiorCandidate,landscape,blockStone:blockedStone});
 const releases=interiorRelease(db),deferredInterior=new Map();
 const blockedColumnRows=db.prepare('SELECT ix,iz FROM erebor_interior_columns WHERE v=?');
 function blockedStone(p){
  const rows=blockedColumnRows.all(p.current_version);
  if(!rows.length)return ()=>false;
  const base=JSON.parse(p.plan_json).mountainFill.bounds[0],released=new Set(rows.map(r=>r.ix+','+r.iz));
  return e=>e.stage==='stone'&&e.origin&&interiorColumns(e.origin,[64,16,64],base).some(k=>released.has(k.join(',')));
 }
 async function interiorCandidate(p,site,position,taken,projectWork=false,slot='A'){
  if(!config.worldSources.live||!massif.enabled(p.current_version))return null;
  const v=p.current_version,plan=JSON.parse(p.plan_json),base=plan.mountainFill.bounds[0];
  const {open}=production.ordered(p,site),busy=releases.busy(v,base);
  const checks=new Map();let worldChecks=0;
  for(const e of interiorFrontier(open,taken,projectWork||slot==='A',slot)){
   if(e.finishing&&(!projectWork||open.some(other=>other.group===e.group&&(!other.finishing||e.stage==='build'&&other.stage==='clear'))))continue;
   if(e.unknownCells!==0||e.clearOmitted!==0||
      (deferredInterior.get(e.name)||0)>Date.now()||!inRange(e.origin,e.size,position))continue;
   const outdoors=!insideMassif(plan,e.origin,e.size);
   if(outdoors){
    if(slot!=='A'&&!projectWork&&!interiorGroup(e.group))continue;
    // Published architecture intentionally includes the bridge/Esgaroth in P-SEE.
    // Keep every other protection and the exact outdoor world check below.
    if(plan.mountainFill.protectedBoxes.some(({id,bounds:[lo,hi]})=>id!=='P-SEE'&&lo.every((n,i)=>e.origin[i]+e.size[i]>n&&e.origin[i]<hi[i])))continue;
   }
   const cols=interiorColumns(e.origin,e.size,base).filter(([ix,iz])=>{
    if(!outdoors)return true;
    const x0=Math.max(e.origin[0],base[0]+64*ix),z0=Math.max(e.origin[2],base[2]+64*iz);
    for(let x=x0;x<Math.min(e.origin[0]+e.size[0],base[0]+64*(ix+1));x++)
     for(let z=z0;z<Math.min(e.origin[2]+e.size[2],base[2]+64*(iz+1));z++){const top=mountainTop(plan,x,z);if(top!=null&&top>=e.origin[1])return true;}
    return false;
   });
   if(cols.some(k=>busy.has(k.join(','))))continue;
   if(!cols.every(k=>{const id=k.join(',');if(!checks.has(id))checks.set(id,releases.allows(v,[k]));return checks.get(id);}))continue;
   if(++worldChecks>3)break;
   const pkg=published(p,site,e);
   if(!await generate(p,{interiorCheck:{bytes:pkg.bytes,anchor:e.origin,kind:e.stage,outdoor:outdoors}})){
    deferredInterior.set(e.name,Date.now()+600000);continue;
   }
   const after=releases.busy(v,base);
   if(!current(v)||!massif.enabled(v)||!releases.allows(v,cols)||cols.some(k=>after.has(k.join(','))))return null;
   return {...pkg,entry:e,job:{...pkg.job,interior:true,source:e},release:()=>{
    if(hallParents.includes(e.name)&&hasHallSplit(v))throw Error('Der ursprüngliche Aushub wurde aufgeteilt.');
    releases.mark(v,cols);
   }};
  }
  if(projectWork&&liveCache?.surfaceModeTracker===1)return landscape.candidate(p,site,slot,position,async pkg=>generate(p,{interiorCheck:{bytes:pkg.bytes,anchor:pkg.job.desired.anchor,kind:'surface'}}));
  return null;
 }
 campus.ereborHelpers=helpers;
 function available(p,site){
  const busy=helpers.reserved(p.current_version,site);
  const {open,done}=production.ordered(p,site);
  const geometry=name=>name.replace(/_V\d+$/,'');
  const taken=new Set([...busy,...done.keys()].map(geometry));
  const stoneOnly=busy.size||massif.enabled(p.current_version);
  const occupied=massif.occupied(p.current_version);
  const blocked=blockedStone(p);
  return open.filter(e=>!e.slot&&!blocked(e)&&!taken.has(geometry(e.name))&&!occupied.has(e.origin?.join(','))&&(!stoneOnly||e.stage==='stone'));
 }
 const cfg=()=>db.prepare('SELECT * FROM erebor_queue_config WHERE id=1').get();
 const project=()=>db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
 const read=site=>JSON.parse(db.prepare('SELECT state FROM erebor_queue_sites WHERE site=?').get(site).state);
 const hasHallSplit=v=>!!db.prepare("SELECT 1 FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? AND package_id=?").get(v,DESIGN_REVISION,hallPackage);
 campus.checkHallSplit=v=>{
  const p=project(),c=cfg();
  if(!p||p.current_version!==v||!c?.enabled||c.version!==v||c.phase!=='stone'||!helpers.isEnabled(v)||!massif.enabled(v))
   throw new HttpError(409,'Die automatische Innenbaufolge ist aktuell nicht freigegeben.');
  const {open}=production.ordered(p,'K19');
  const assigned=[read('K19').job?.desired.blueprint,...helpers.reserved(v,'K19'),...choices.waiting(v).filter(r=>r.site==='K19').map(r=>r.name)];
  if(hallParents.some(name=>!open.some(e=>e.name===name)||assigned.includes(name)))throw new HttpError(409,'Ein Originalplan ist inzwischen vergeben oder abgeschlossen.');
 };
 campus.hallSplitPublished=()=>{production.invalidate();queueMicrotask(wake);};
 const persist=(site,s)=>db.prepare('UPDATE erebor_queue_sites SET state=? WHERE site=?').run(JSON.stringify(s),site);
 campus.ereborStationBinding=name=>{
  const extra=groupOf(name);
  const [x,y,z]=extra?Object.values(extra.slots)[0]:layout.sites.find(s=>s.site===name.slice(-3).toUpperCase()).cannon;
  return {x,y,z,dimension:'minecraft:overworld',owner:'Erebor'};
 };
 campus.ereborFeeder=ereborFeeder(db,request,layout.version,liveReport,savedMissingItems);
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
  const rows=db.prepare("SELECT package_id,report_json FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? AND coalesce(json_extract(report_json,'$.finishing'),0)=0 ORDER BY package_id").all(v,DESIGN_REVISION);
  for(const row of rows)for(const f of JSON.parse(row.report_json).files){
   if(sites.includes(f.cannon)&&result[f.kind]&&row.package_id!==hallPackage&&!(hallParents.includes(f.id)&&hasHallSplit(v)))(result[f.kind][f.cannon]??=[]).push({pack:row.package_id,fileName:f.fileName,origin:f.origin});
  }
  for(const group of Object.values(result))for(const files of Object.values(group))files.sort((a,b)=>a.origin[1]-b.origin[1]||a.fileName.localeCompare(b.fileName));
  return result;
 }
 const current=v=>!closed&&db.prepare('SELECT 1 FROM erebor_queue_config q JOIN build_projects p ON p.id=\'erebor\' WHERE q.id=1 AND q.version=p.current_version AND q.version=? AND q.lease=? AND q.expires>?').get(v,owner,Date.now());
 function observe(site,s,o,witness){
  const j=s.job;
  s.inserted=false;
  if(!verifyAlignment(j.desired,o,j.desired)&&same(o.components['create:schematic_bounds'],j.size)){
   j.desired.options=observedEreborOptions(j.desired,o.options);
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
  if(!j.massif?.includes('_URN_')&&(confirmedFinish(o,j)||recordedFinish(o,j,witness?.signal?.finish,Date.now(),witness))){
   s.cursor=j.next;s.completed++;s.job=null;s.status='Fertig, nächster Plan folgt';
   tx(db,()=>{
    production.finish(j.desired.version??cfg().version,site,j.desired.blueprint,new Date().toISOString());
    if(j.massif)massif.finish(j.desired.version,j.massif,site,'A');
    if(j.surface)landscape.finish(j.desired.version,site,'A',j);
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
  const result=await request('erebor-start',{site,version,desired,kind:job.surface?'surface':job.phase,size:job.size});
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
  if(!mode.enabled||!job||job.tainted||(massif.enabled(version)&&!job.massif&&!job.interior&&!job.surface&&job.phase!=='stone'))return;
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
  if(choice&&massif.enabled(c.version)&&JSON.parse(choice.job).phase!=='stone')choice=null;
  const automatic=()=>!!production.mode(c.version,site).enabled;
  if(!automatic()&&!choice&&(s.exhausted||!c.enabled)&&!s.job?.loaded&&!s.job?.selection)return;
  const data={site,version:c.version};
  const signal=report?.stations?.[site],tracked=s.job;
  if(!choice&&tracked?.loaded&&signal&&Date.now()-report.at<15000){
   const urn=tracked.massif?.includes('_URN_');
   if(!tracked.interior&&!tracked.surface&&signal.state==='STOPPED'&&['finished','schematicInvalid'].includes(signal.status)&&signal.empty&&(!signal.finish||tracked.tainted||massif.enabled(c.version))&&Date.now()/1000-tracked.seen>=(urn?4:90)){
    s.inserted=false;s.status='Wartet auf bestätigten Abschluss';
    if(!automatic()||!massif.enabled(c.version)||!verifyStone||!isStationStone(tracked,site)||signal.upload||
       Date.now()-(tracked.lastWorldCheck||0)<(urn?15000:120000))return;
    tracked.lastWorldCheck=Date.now();
    const entry=tracked.massif?null:production.catalog(p,site).find(e=>e.stage==='stone'&&e.name===tracked.desired.blueprint);
    if(!entry&&!tracked.massif)return;
    const original=tracked.massif?massif.restore(c.version,site,'A',tracked.massif):published(p,site,entry);
    if(!same(tracked.desired.anchor,original.job.desired.anchor)||!same(tracked.size,original.job.size))return;
    const revised=original.job.desired.sha256!==tracked.desired.sha256;
    if(revised&&tracked.massif)return;
     const filled=await verifyStone(p,{bytes:original.bytes,anchor:tracked.desired.anchor,size:tracked.size,blocks:original.job.blocks,collectUrns:!!tracked.massif&&!urn&&!tracked.massif.endsWith('_BE')});
    const {observed}=await request('erebor-inspect',data);
    if(!current(c.version)||!automatic()||choices.next(c.version,site)||!emptyStopped(observed)||observed.status!==signal.status||
       !same(observed.options,completedStoneOptions(tracked.desired,observed.options)))return;
    if(filled){
     tx(db,()=>{
      production.finish(c.version,site,tracked.desired.blueprint,new Date().toISOString());
      if(tracked.massif)massif.finish(c.version,tracked.massif,site,'A',filled.urns);
      choices.mark(tracked.selection,revised?'replaced':'finished');s.cursor=tracked.next;s.completed++;s.job=null;
      s.status=filled.urns?'Reguläre Ziele bestätigt, Urnen als Einzelziele erfasst':'Alle Steinziele im Weltstand bestätigt';persist(site,s);
     });
    }else if(tracked.massif?.includes('_URN_')){
     if(witnessedUrn(tracked,signal,report.at)&&report.at-signal.finish.at<360000){s.status='Urne gebaut · wartet auf gespeicherten Zielblock';return;}
     tx(db,()=>{massif.deferUrn(c.version,site,tracked.massif);production.started(c.version,site,null);s.job=null;s.status='Urnenziel noch offen, nächster Auftrag folgt';persist(site,s);});
    }else{
     tx(db,()=>{
      if(revised)choices.mark(tracked.selection,'replaced');
      s.job={...original.job,next:tracked.next,selection:revised?null:tracked.selection,lastWorldCheck:Date.now()};
      s.status='Offene Steinziele erneut eingeplant';
      db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(s),original.bytes,site);
      production.started(c.version,site,null);
     });
    }
    return;
   }
   const waiting=signal.state==='PAUSED'&&['targetNotLoaded','missingBlock','missingItem','noGunpowder'].includes(signal.status);
   // Create resumes resource waits itself. Leave the controller available for physical chest checks.
   if(waiting&&(tracked.interior||tracked.surface)&&!tracked.tainted&&signal.ready&&signal.aligned&&
      signal.upload===tracked.desired.file&&signal.owner===tracked.desired.owner&&same(signal.anchor,tracked.desired.anchor)&&
      same(signal.size,tracked.size)&&same(signal.options,[tracked.desired.options.replace_mode,tracked.desired.options.skip_missing,tracked.desired.options.replace_block_entities])&&
      Number.isSafeInteger(signal.placed)&&signal.placed>=(tracked.placed||0)&&report.at>=tracked.seen*1000){
    tracked.placed=signal.placed;tracked.seen=report.at/1000;s.inserted=true;s.status='Pausiert: '+signal.status;return;
   }
   if(isStationStone(tracked,site)&&signal.upload===tracked.desired.file&&(signal.state==='RUNNING'||waiting)&&signal.aligned&&
      signal.owner===tracked.desired.owner&&same(signal.anchor,tracked.desired.anchor)&&same(signal.size,tracked.size)&&
      ((!needsSolidReplacement(tracked.desired)&&same(signal.options,[0,false,false]))||same(signal.options,[2,false,false]))&&Number.isSafeInteger(signal.placed)&&report.at>=tracked.seen*1000){
    if(signal.status==='skipping'||signal.placed<(tracked.placed||0))tracked.tainted=true;
    tracked.placed=signal.placed;tracked.seen=report.at/1000;s.inserted=true;
    if(waiting){s.status='Pausiert: '+signal.status;return;}
    tracked.started=true;s.status='Baut';
    if(automatic()&&production.mode(c.version,site).started_upload!==signal.upload)production.started(c.version,site,signal.upload);
    return;
   }
  }
  const sample=!choice&&s.job?.loaded?campus.ereborFeeder.sample(site):null;
  const o=sample&&sample.at>=s.job.seen?sample:(await request('erebor-inspect',data)).observed;
  if(!current(c.version))return;
  const old=s.job;
  const aligned=old&&!verifyAlignment(old.desired,o,old.desired)&&same(o.components?.['create:schematic_bounds'],old.size);
  // The old tracker could taint the initial input before its first shot.
  // Clear that historical flag only after the native printer proves it is still at its initial cursor.
  if(aligned&&automatic()&&report?.urnPreparation===2&&old.massif?.includes('_URN_')&&old.tainted&&
     !old.started&&!old.placed&&unstarted({...old,tainted:false},o)){
   old.tainted=false;
  }
  // V1 may already have inserted this exact file before the tracker changed its mode.
  if(!aligned&&automatic()&&report?.urnPreparation===2&&old?.massif?.includes('_URN_')&&
     o.state==='PAUSED'&&o.status==='ready'&&o.amountPlaced===0&&o.flyingBlocks===0&&same(old.size,[1,1,1])&&
     same(o.components?.['create:schematic_bounds'],old.size)&&o.options?.replace_mode===2){
   const legacy={...old.desired,options:{...old.desired.options,replace_mode:2}};
   if(!verifyAlignment(legacy,o,legacy)){
    const {options,...desired}=old.desired;
    const {bytes}=massif.restore(c.version,site,'A',old.massif);
    await request('erebor-prepare',{...data,desired,kind:'stone',size:old.size,nbtBase64:bytes.toString('base64')});
    s.status='Urnenplan wird im sicheren Baumodus übernommen';return;
   }
  }
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
   const mass=automatic()?massif.reserve(c.version,site,'A'):null;
   const next=mass?null:available(p,site)[0];
   const inside=!mass&&!next&&automatic()?await interiorCandidate(p,site,parallelLayout.sites.find(s=>s.site===site).main,helpers.reserved(c.version,site),report?.ereborProjectWork===1):null;
   if(inside&&(!automatic()||!current(c.version)||choices.next(c.version,site)))return;
   if(!next&&!mass&&!inside){s.status=massif.enabled(c.version)?'Wartet auf den nächsten erreichbaren, freigegebenen Bauabschnitt':'Baufolge erledigt';s.exhausted=true;return;}
   const {job,bytes}=mass??inside??published(p,site,next);
   s.job={...job,next:s.cursor};
   tx(db,()=>{inside?.release();db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(s),bytes,site);});
  }
  if(!s.job){
   if(c.phase!=='stone'&&(massif.enabled(c.version)||helpers.reserved(c.version,site).size))return;
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
  const res=await request('erebor-prepare',{...data,desired,kind:j.surface?'surface':j.phase,size:j.size,nbtBase64:Buffer.from(bytes).toString('base64')});
  if(j.massif?.includes('_URN_')&&res.urnWarming===true&&res.applied===false){
   s.status='Urnenziel reserviert · Zielchunk lädt';return;
  }
  if(j.massif?.includes('_URN_')&&res.urnDeferred===true&&res.applied===false){
   tx(db,()=>{massif.deferUrn(c.version,site,j.massif);s.job=null;s.status='Urnenziel zurückgestellt · '+res.reason;persist(site,s);});
   return;
  }
  readAt=0;
  if(!res.applied||!observe(site,s,res.observed))throw Error('Einlegen noch nicht bestätigt.');
  persist(site,s);
  await startAutomatic(site,s,c.version,res.observed);
 }
 // Reconcile fast single-block prints between dispatch batches. A full fleet pass
 // can take minutes; an empty input is normal even if the start reply was lost.
 const lastUrnCheck=new Map(),lastPackStart=new Map();
 // A failed first-start read leaves a valid prepared main waiting through the helper rotation.
 // On the same queue lease, retry one eligible main at each fresh fleet report.
 async function startPreparedMain(v,report){
  if(!report||!current(v)||!massif.enabled(v)||Date.now()-report.at>=15000)return;
  const eligible=production.enabled(v).flatMap(site=>{
   const state=read(site),job=state.job;
   if(!(readySurface(job,report,site)||report.urnPacks===3&&readyUrnPack(job,report.stations?.[site]))||choices.next(v,site)||
      production.mode(v,site).started_upload===job.desired.file)return [];
   const last=lastPackStart.get(site);
   if(last?.file===job.desired.file&&Date.now()-last.at<30000)return [];
   return [{site,state,job,at:last?.at??0}];
  }).sort((a,b)=>a.at-b.at);
  if(!eligible.length)return;
  const {site,state,job}=eligible[0];
  lastPackStart.set(site,{file:job.desired.file,at:Date.now()});
  const still=()=>current(v)&&massif.enabled(v)&&production.mode(v,site).enabled&&
   !choices.next(v,site)&&read(site).job?.desired.file===job.desired.file;
  try{
   const {observed}=await request('erebor-inspect',{site,version:v});
   if(!still()||verifyAlignment(job.desired,observed,job.desired)||
      !same(observed.components?.['create:schematic_bounds'],job.size)||
      observed.state!=='PAUSED'||observed.status!=='ready'||!unstarted(job,observed))return;
   observe(site,state,observed);
   await startAutomatic(site,state,v,observed);
  }catch(e){state.status=e.message;}
  if(still()){state.checked=new Date().toISOString();persist(site,state);}
 }
 async function reconcileUrns(p,report){
  const v=p.current_version;
  if(!verifyStone||report?.urnPreparation!==2||!massif.enabled(v)||!current(v)||Date.now()-report.at>=15000)return;
  const {mains,helperJobs}=assignments(v);
  const ready=[...mains.map(r=>({...r,slot:'A'})),...helperJobs].filter(({site,slot,job})=>
   witnessedUrn(job,report.stations[slot==='A'?site:site+slot],report.at));
  const last=r=>{const e=lastUrnCheck.get(r.site+r.slot);return e?.file===r.job.desired.file?e.at:0;};
  for(const row of ready.filter(r=>Date.now()-last(r)>=15000).sort((a,b)=>last(a)-last(b)).slice(0,16)){
   if(!current(v)||Date.now()-report.at>=20000)return;
   const {site,slot,job}=row;
   lastUrnCheck.set(site+slot,{at:Date.now(),file:job.desired.file});
   const original=massif.restore(v,site,slot,job.massif);
   if(!same(original.job.desired,job.desired)||!same(job.size,original.job.size)||job.blocks!==original.job.blocks)continue;
   let stone;
   try{stone=await verifyStone(p,{bytes:original.bytes,anchor:job.desired.anchor,size:job.size,blocks:original.job.blocks});}
   catch(e){app.log.warn({site,slot,err:e.message},'Urnenziel im Weltstand noch nicht lesbar');continue;}
   if(stone!==true||!current(v))continue;
   const state=slot==='A'?read(site):null;
   if((state?.job??helpers.jobAt(v,site,slot))?.desired.file!==job.desired.file)continue;
   tx(db,()=>{
    if(slot!=='A'){helpers.complete(v,site,slot,job);return;}
    production.finish(v,site,job.desired.blueprint,new Date().toISOString());
    massif.finish(v,job.massif,site,slot);
    choices.mark(job.selection,'finished');
    state.cursor=job.next;state.completed++;state.job=null;state.inserted=false;
    state.status='Cleanstone am Urnenziel bestätigt';persist(site,state);
   });
  }
 }
 // A full fleet rotation can outlast short excavations. Pick up their actual
 // native finishes between batches and offer the same empty cannon its next job.
 const roomChecks=new Map(),surfaceRepairStatus=new Map(),refillChecks=new Map();
 let lastRefill=0;
 // A full fleet pass can take minutes. Revisit one acknowledged, still empty
 // printer between batches. Assignment and all world checks stay on the normal path.
 async function refillFinished(p,report){
  const v=p.current_version,c=cfg(),now=Date.now();
  if(!c?.enabled||c.version!==v||c.phase!=='stone'||!massif.enabled(v)||!current(v)||
     report?.version!==v||report.sharedChest!==4||report.ereborProjectWork!==1||!report.stations||
     report.at>now||now-report.at>=15000||now-lastRefill<15000)return;
  const {mains,helperJobs}=assignments(v),helpersOn=helpers.isEnabled(v);
  const candidates=[...mains.map(r=>({...r,slot:'A'})),...helperJobs].filter(r=>{
   const main=r.slot==='A',key=r.site+(main?'':r.slot),s=report.stations[key];
   if(!awaitingNextPrint(r,s))return false;
   if(main?(!production.mode(v,r.site).enabled||choices.next(v,r.site)):!helpersOn)return false;
   return now-(refillChecks.get(r.site+r.slot)??0)>=120000;
  });
  // Put a reserved plan back into its printer before scanning for unassigned work.
  candidates.sort((a,b)=>Number(!!b.job)-Number(!!a.job)||
   (refillChecks.get(a.site+a.slot)??0)-(refillChecks.get(b.site+b.slot)??0)||
   Number(b.slot==='A')-Number(a.slot==='A'));
  if(!candidates.length)return;
  const {site,slot}=candidates[0];
  lastRefill=now;refillChecks.set(site+slot,now);
  if(slot!=='A'){
   try{await helpers.refill(p,site,slot,report,()=>helpers.isEnabled(v),read(site),()=>current(v));}
   catch(e){app.log.warn({station:site+slot,err:e.message},'Erneute Prüfung des Folgeplans vertagt');}
   return;
  }
  const state=read(site);
  try{await station(site,state,c,p,null,report);}
  catch(e){state.status=e.message;state.inserted=false;}
  if(current(v)){state.checked=new Date().toISOString();persist(site,state);}
 }
 function treeSource(p,site,slot,job){
  if(job.surface)return landscape.idleRevision(p.current_version,site,slot,job);
  if(!oldTreeInput(site+slot,job))return null;
  return production.catalog(p,site).find(e=>e.part==='E01_901'&&e.name===job.desired.blueprint&&e.sha256!==job.desired.sha256&&same(e.origin,job.desired.anchor));
 }
 async function finishRooms(p,report){
  const v=p.current_version;
  if(!report?.stations||Date.now()-report.at>=15000||!current(v))return;
  const {mains,helperJobs}=assignments(v);
  const waiting=[];
  for(const row of [...mains.map(s=>({...s,slot:'A'})),...helperJobs]){
   const {site,slot,job}=row,key=slot==='A'?site:site+slot,s=report.stations[key];
   const released=releasedSurface(site,slot,job,s);
   if(!(job?.loaded&&(job.interior||job.surface))||s?.state!=='STOPPED'||(!released&&s.status!=='finished')||!s.empty||s.upload)continue;
   const last=roomChecks.get(key),when=last?.file===job.desired.file?last.at:0;
   if(Date.now()-when>=25000)waiting.push({site,slot,key,job,s,when,released});
  }
  for(const {site,slot,key,job,s,released} of waiting.sort((a,b)=>a.when-b.when).slice(0,4)){
   if(!current(v)||Date.now()-report.at>=20000)return;
   roomChecks.set(key,{file:job.desired.file,at:Date.now()});
   const active=()=>current(v)&&(slot==='A'?production.mode(v,site).enabled:cfg().phase==='stone'&&helpers.isEnabled(v));
   const matches=()=>(slot==='A'?read(site).job:helpers.jobAt(v,site,slot))?.desired.file===job.desired.file;
   try{
    if(released){
     const note=message=>surfaceRepairStatus.set(site+slot,{file:job.desired.blueprint,at:Date.now(),message});
     const allowed=()=>active()&&cfg().enabled&&!choices.next(v,site)&&!job.selection;
     if(!allowed()||!config.worldSources.live||report.surfaceModeTracker!==1||report.ereborProjectWork!==1){note('Wartet auf Automatikfreigabe, Weltstand und Außenhaut-Controller');continue;}
     const ref=oldTreeInput(site+slot,job);
     const grove=ref&&job.interior===true;
     const getSource=()=>treeSource(p,site,slot,job);
     const source=getSource();
     if(!source){note('Veröffentlichte Revision passt nicht zur offenen Reservierung');continue;}
     const pkg=grove?published(p,site,source):landscape.restore(v,source);
     if(ref&&(pkg.job.desired.sha256!==source.sha256||pkg.job.desired.options.replace_mode!==0||
        !same(pkg.job.size,job.size)||!same(pkg.job.desired.anchor,job.desired.anchor)||
        Object.keys(pkg.job.materials).some(id=>id.endsWith('_leaves')))){
      note('Setzlingsrevision passt nicht zum ursprünglichen Bauplatz');continue;
     }
     const check={bytes:pkg.bytes,anchor:pkg.job.desired.anchor,kind:'surface'};
     const done=await generate(p,{interiorCheck:{...check,completed:true,minimumSave:Math.floor(job.seen||0)*1000}});
     if(!done){
      const safe=await generate(p,{interiorCheck:{...check,details:true,resumeSurface:true}});
      if(safe!==true){note(typeof safe==='string'?safe:'Weltprüfung offen');continue;}
     }
     const {observed}=await request('erebor-inspect',{site:key,version:v});
     if(!emptyStopped(observed)||observed.status!=='idle'||!allowed()||!matches()||
        !same(source,getSource())){note('Wartet auf zurückgesetzten Drucker und unveränderte Reservierung');continue;}
     const next={...pkg.job,...grove&&{interior:true,source},next:job.next,replayedAfterRelease:true};
     tx(db,()=>{
      if(job.surface&&job.source.sha256!==source.sha256)landscape.releasePrevious(v,site,slot,job);
      if(slot!=='A'){
       if(done)helpers.complete(v,site,slot,next);
       else helpers.replaySurface(v,site,slot,next);
       return;
      }
      const state=read(site);
      state.inserted=false;
      production.started(v,site,null);
      if(done){
       production.finish(v,site,next.desired.blueprint,new Date().toISOString());
       if(next.surface)landscape.finish(v,site,slot,next);
       state.cursor=job.next;state.completed++;state.job=null;
       state.status='Außenhaut vollständig im Weltstand bestätigt';
      }else{
       state.job=next;state.status='Aktueller Außenhautplan zum Einlegen bereit';
      }
      db.prepare('UPDATE erebor_queue_sites SET state=?,payload=? WHERE site=?').run(JSON.stringify(state),done?null:pkg.bytes,site);
     });
     note(done?'Vollständig im Weltstand bestätigt':'Aktuelle Revision zum Einlegen bereit');continue;
    }
    const {observed:o}=await request('erebor-inspect',{site:key,version:v});
    if(!current(v)||!matches()||!emptyStopped(o)||o.status!=='finished')continue;
    const receipt=recordedFinish(o,job,s.finish,Date.now(),{signal:s,at:report.at});
    if(!receipt){
     if(!config.worldSources.live||!job.seen)continue;
     const entry=job.source??production.catalog(p,site).find(e=>e.name===job.desired.blueprint);
     if(!entry)continue;
     const pkg=job.surface?landscape.restore(v,entry):published(p,site,entry);
     if(pkg.job.desired.sha256!==job.desired.sha256||!same(pkg.job.desired.anchor,job.desired.anchor)||!same(pkg.job.size,job.size))continue;
     if(!await generate(p,{interiorCheck:{bytes:pkg.bytes,anchor:job.desired.anchor,kind:job.surface?'surface':job.phase,completed:true,minimumSave:Math.floor(job.seen)*1000}}))continue;
     const {observed:after}=await request('erebor-inspect',{site:key,version:v});
     if(!emptyStopped(after)||after.status!=='finished'||!same(after.options,o.options)||after.outputCount!==o.outputCount)continue;
    }
    if(!current(v)||!matches())continue;
    tx(db,()=>{
     if(slot!=='A'){helpers.complete(v,site,slot,job);return;}
     const state=read(site);
     production.finish(v,site,job.desired.blueprint,new Date().toISOString());
     if(job.surface)landscape.finish(v,site,slot,job);
     choices.mark(job.selection,'finished');
     state.cursor=job.next;state.completed++;state.job=null;state.inserted=false;state.status='Abschluss bestätigt, nächster Bauabschnitt folgt';persist(site,state);
    });
    if(slot!=='A'&&active()){
     refillChecks.set(key,Date.now());
     await helpers.refill(p,site,slot,report,active,read(site),()=>current(v));
    }
   }catch(e){
    if(released)surfaceRepairStatus.set(site+slot,{file:job.desired.blueprint,at:Date.now(),message:e.message});
    app.log.warn({station:key,err:e.message},'Baufolge wartet auf bestätigten Planwechsel');
   }
  }
 }
 async function tick(){
  const c=cfg(),p=project();
  if(!c||!p||c.version!==p.current_version||closed)return;
  const tracking=db.prepare("SELECT site FROM erebor_queue_sites WHERE json_extract(state,'$.job.loaded')=1").all().map(r=>r.site);
  // Subprojects such as Watercity persist their selections in the same store,
  // but have their own slot bindings and scheduler. Leave those rows untouched.
  const active=[...production.enabled(c.version),...choices.active(c.version),...tracking].filter(site=>sites.includes(site));
  const pendingHelpers=helpers.list(c.version).some(r=>r.name);
  if((!c.enabled||c.phase==='finished')&&!active.length&&!pendingHelpers&&!(c.phase==='stone'&&helpers.isEnabled(c.version)))return;
  const acquired=db.prepare('UPDATE erebor_queue_config SET lease=?,expires=? WHERE id=1 AND (lease IS NULL OR expires<? OR lease=?)').run(owner,Date.now()+120000,Date.now(),owner);
  if(!acquired.changes)return;
  try{
   const archive=c.archive?JSON.parse(c.archive):null;
   let report=await liveReport(c.version);
   await refillFinished(p,report);
   await startPreparedMain(c.version,report);
   await reconcileUrns(p,report);
   await finishRooms(p,report);
   for(const site of new Set([...active,...(c.enabled&&c.phase!=='finished'?sites:[])])){
    if(!current(c.version))return;
    if(report&&Date.now()-report.at>=15000){
     report=await liveReport(c.version);
     await refillFinished(p,report);
     await startPreparedMain(c.version,report);
     if(report?.surfaceModeTracker===1)await helpers.startFueledExtras(p,report,()=>c.phase==='stone'&&helpers.isEnabled(c.version),read,()=>current(c.version));
     await finishRooms(p,report);
    }
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
    await helpers.tick(p,report,()=>c.phase==='stone'&&helpers.isEnabled(c.version),read,renew,async()=>{
     const fresh=await liveReport(c.version);
     await refillFinished(p,fresh);
     await startPreparedMain(c.version,fresh);
     await reconcileUrns(p,fresh);
     await finishRooms(p,fresh);
     return fresh;
    });
   }
   if(current(c.version)&&cfg().enabled&&!massif.enabled(c.version)&&c.phase!=='finished'&&!helpers.list(c.version).some(r=>r.name)&&sites.every(site=>{const s=read(site);return s.exhausted&&!s.job;})){
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
 const throughput=placementThroughput();
 let liveFetch=null,liveCache=null,readAt=0;
 async function liveReport(version){
  if(!Number.isInteger(version))return null;
  if(Date.now()-readAt<1500)return liveCache;
  if(!liveFetch)liveFetch=request('erebor-live',{version}).then(r=>r.version===version&&Math.abs(Date.now()-r.at)<45000?r:null).catch(()=>null).then(r=>{readAt=Date.now();liveCache=r;throughput.observe(r);return r;}).finally(()=>{liveFetch=null;});
  return liveFetch;
 }
 campus.ereborLiveReport=liveReport;
 function assignments(version) {
  const mains=db.prepare('SELECT site,state FROM erebor_queue_sites ORDER BY site').all().map(r=>({site:r.site,...JSON.parse(r.state)}));
  return {mains,helperJobs:version?helpers.jobs(version):[]};
 }
 function stationSummary(s,c,report){
   const j=s.job,signal=report?.stations?.[s.site];
   const live=j?.loaded&&signal?.upload===j.desired.file?{state:signal.state,status:signal.status,placed:signal.placed,total:signal.total,fuel:signal.fuel,target:signal.target,chunks:signal.chunks?.length||0,at:report.at}:null;
   const native=signal?.state?{state:signal.state,status:signal.status,empty:signal.empty,placed:signal.placed,at:report.at}:null;
   return {site:s.site,automatic:c?!!production.mode(c.version,s.site).enabled:false,status:s.status,live,native,nativeOptions:signal?.options??null,upload:j?.desired.file??null,kind:j?.phase??null,inserted:!!s.inserted,sha256:j?.desired.sha256||null,file:j?.desired.blueprint||null,anchor:j?.desired.anchor||null,blocks:j?.blocks??null,completed:s.completed,checked:s.checked||null};
 }
 function stationQueue(p,focus,state,waiting){
  const version=p.current_version;
  const {open,done,preferred}=production.ordered(p,focus);
  const promoted=[...new Set([...preferred,...waiting.filter(r=>r.site===focus&&!done.has(r.name)).map(r=>r.name)])];
  const busy=helpers.reserved(version,focus);
  const pending=[...new Set([...promoted,...open.map(e=>e.name)])].filter(name=>name!==state?.job?.desired.blueprint&&!busy.has(name));
  return {site:focus,pending,preferred:promoted,done:[...done].map(([name,at])=>({name,at}))};
 }
 function status(report=null,focus=null,ordersOnly=false){
  const c=cfg(),p=project(),v=p?.current_version;
  const header={enabled:!!c?.enabled,version:c?.version??v,stale:!!c&&c.version!==v,phase:c?(stages[c.phase]||'Fertig'):'Steinfüllung'};
  const waiting=c?choices.waiting(c.version):[];
  const hasSite=sites.includes(focus);
  if(ordersOnly&&!hasSite)throw new HttpError(400,'Unbekannte Station.');
  const state=hasSite&&c?read(focus):null;
  const projectWaiting=c&&c.version===v?waiting:v?choices.waiting(v):[];
  const queue=v&&hasSite?stationQueue(p,focus,state,projectWaiting):null;
  if(ordersOnly){
   const surfaceRepair=Object.fromEntries([...surfaceRepairStatus].filter(([key])=>key.slice(0,3)===focus));
   for(const slot of slotsFor(focus)){
    const job=slot==='A'?state?.job:helpers.jobAt(v,focus,slot);
    if(!job?.surface)continue;
    const key=focus+slot,signal=report?.stations?.[slot==='A'?focus:key];
    if(!signal?.empty||signal.status!=='idle')continue;
    const last=surfaceRepair[key];
    surfaceRepair[key]={...(last?.file===job.desired.blueprint?last:{}),file:job.desired.blueprint,
     loaded:job.loaded,phase:job.phase,replayed:!!job.replayedAfterRelease,ready:signal.ready,
     eligible:releasedSurface(focus,slot,job,signal),receipt:!!signal.finish,owner:job.desired.owner};
   }
   return {...header,queue,waiting:waiting.filter(r=>r.site===focus),stations:state?[stationSummary({...state,site:focus},c,report)]:[],surfaceRepair};
  }
  const {mains,helperJobs}=assignments(v);
  const counts=p?projectProgress(db,production,p,sites,[...(c?.version===v?mains:[]),...helperJobs]).counts:null;
  if(queue)queue.counts=counts.stations[focus];
  return {...header,queue,counts,waiting,stations:mains.map(s=>stationSummary(s,c,report)),
   cannons:c?.version===v?cannonProgressRows(mains,helperJobs,report):[],
   helpers:c?.version===v?helperJobs.map(({job,...row})=>row):c?helpers.list(c.version):[]};
 }
 function buildingProgress(req,reply,dashboard){
  requireActor(req,'read');
  const p=project();if(!p)throw new HttpError(404,'Erebor nicht verfügbar.');
  const assignmentsNow=assignments(p.current_version),helperJobs=assignmentsNow.helperJobs;
  const mains=cfg()?.version===p.current_version?assignmentsNow.mains:[];
  const {counter,filling}=projectProgress(db,production,p,sites,[...mains,...helperJobs]);
  // Only consume existing signed telemetry cache: this GET issues no controller commands.
  const report=liveCache?.version===p.current_version?liveCache:null;
  const jobs=new Map([...mains.map(r=>[r.site,r.job]),...helperJobs.map(r=>[r.site+r.slot,r.job])]);
  const rows=cannonProgressRows(mains,helperJobs,report).map(r=>{
   const job=jobs.get(r.station);
   return {...r,live:job?.tainted?null:r.live,workloadBlocks:['stone','build'].includes(job?.phase)?job.blocks:null};
  });
  counter.throughput=throughput.read(report,rows);
  if(dashboard){
   Object.assign(counter,dashboardData(db,p.current_version,sites,report,jobs,filling,massif));
   counter.surface=surfaceOverview(db,p);
   counter.overall=overallProgress(db,p.current_version,production,filling,counter.stages.stone,counter.surface?.task,jobs);
   counter.forecast=massifForecast(db,p.current_version,filling,counter.balance.enabled);
  }
  return reply.header('Cache-Control','private, no-store').send(counter);
 }
 app.get('/api/projects/erebor/bauzaehler',(req,reply)=>buildingProgress(req,reply,false));
 let missingRead=null,missingAt=0;
 function waitingPrinters(report){
  const rows=[];
  for(const site of parallelLayout.sites)for(const slot of slotsFor(site.site)){
   const key=slot==='A'?site.site:site.site+slot,s=report.stations?.[key];
   if(s?.ready&&s.aligned&&s.upload&&s.state==='PAUSED'&&['missingBlock','missingItem'].includes(s.status))
    rows.push({key,file:s.upload,placed:s.placed,status:s.status,pos:site[slot==='A'?'main':slot]});
  }
  return rows;
 }
 async function savedMissingItems(report){
  if(!config.worldSources.live||!report||Math.abs(Date.now()-report.at)>45000)return new Map();
  if(!missingRead||Date.now()-missingAt>30000){
   missingAt=Date.now();
   const rows=waitingPrinters(report);
   missingRead=new Promise((resolve,reject)=>{
    const w=new Worker(new URL('./erebor-missing-worker.js',import.meta.url),{workerData:{world:config.worldSources.live,rows}});
    w.once('message',found=>resolve(new Map(found.map(row=>[row.key,row]))));w.once('error',reject);w.once('exit',code=>{if(code)reject(Error('Weltprüfung unterbrochen.'));});
   });
  }
  return missingRead;
 }
 app.get('/api/projects/erebor/materialengpaesse',async(req,reply)=>{
  requireActor(req,'read');
  const p=project(),report=liveCache;
  if(!config.worldSources.live||!p||report?.version!==p.current_version||Math.abs(Date.now()-report.at)>45000)
   throw new HttpError(503,'Aktuelle Kanonenmeldung fehlt.');
  const saved=await savedMissingItems(report);
  const materials=waitingPrinters(report).map(({key,file,placed,status})=>{
   const r=saved.get(key);
   return {cannon:key.length===3?key+'A':key,item:r?.file===file&&r.placed===placed&&r.status===status?r.item:null};
  });
  return reply.header('Cache-Control','private, no-store').send({at:report.at,materials});
 });
 async function saplingCandidates(onlySlot){
  const p=project(),v=p?.current_version,report=await liveReport(v);
  if(!report||!config.worldSources.live||!cfg()?.enabled||cfg().version!==v||cfg().phase!=='stone'||report.ereborProjectWork!==1||report.surfaceModeTracker!==1)
   throw new HttpError(409,'Aktuelle Freigabe für die Erebor-Baufolge fehlt.');
  const saved=await savedMissingItems(report),rows=[];
  for(const {key,file,placed,status:reason,pos} of waitingPrinters(report)){
   const site=key.slice(0,3),slot=key.slice(3)||'A',signal=report.stations[key],missing=saved.get(key);
   if(onlySlot&&site+slot!==onlySlot)continue;
   const job=slot==='A'?read(site).job:helpers.jobAt(v,site,slot);
   if(!job?.loaded||!oldTreeInput(site+slot,job)||choices.next(v,site)||job.selection||
      !(slot==='A'?production.mode(v,site).enabled:helpers.isEnabled(v))||
      missing?.file!==file||missing.placed!==placed||missing.status!==reason||
      !/^minecraft:(oak|birch|spruce)_leaves$/.test(missing.item)||file!==job.desired.file||
      !same(signal.anchor,job.desired.anchor)||!same(signal.size,job.size)||signal.owner!=='Erebor')continue;
   const source=treeSource(p,site,slot,job);
   if(!source)continue;
   const {job:next,bytes}=job.surface?landscape.restore(v,source):published(p,site,source);
   if(next.desired.options.replace_mode!==0||!same(next.desired.anchor,signal.anchor)||
      !same(next.size,signal.size)||Object.keys(next.materials).some(id=>id.endsWith('_leaves')))continue;
   const entry={slot:site+slot,pos,anchor:signal.anchor,old:file,name:job.desired.blueprint,sha:next.desired.sha256,leaf:missing.item,reason};
   rows.push({entry,bytes,upload:next.desired.file,minimumSave:Math.floor(job.seen||0)*1000,reserved:!!job.surface});
  }
  return {at:report.at,rows};
 }
 let checkingSapling=false;
 app.get(base+'/setzlingswechsel/pruefung/:slot',async(req,reply)=>{
  requireActor(req,'read');
  const {slot}=req.params;
  if(!/^K(?:0[1-9]|[12]\d|3[0-7])[A-I]$/.test(slot))throw new HttpError(400,'Ungültiger Kanonenplatz.');
  if(checkingSapling)throw new HttpError(429,'Eine Weltprüfung läuft bereits.');
  checkingSapling=true;
  try{
   const candidate=(await saplingCandidates(slot)).rows[0];
   if(!candidate)throw new HttpError(409,'Kein bestätigter Altplan mit passendem Ersatz für diese Kanone.');
   const {entry,upload,bytes,minimumSave,reserved}=candidate;
   const world=await new Promise((resolve,reject)=>{
    // The production queue worker has its own request/response stream.
    const w=new Worker(new URL('./erebor-sapling-check-worker.js',import.meta.url),{workerData:{world:config.worldSources.live,bytes,anchor:entry.anchor,minimumSave}});
    const timeout=setTimeout(()=>{void w.terminate();reject(new HttpError(503,'Weltprüfung hat das Zeitlimit erreicht.'));},30000);
    w.once('message',resolve);w.once('error',reject);w.once('exit',()=>{clearTimeout(timeout);reject(new HttpError(503,'Weltprüfung beendet.'));});
   });
   const fresh=await saplingCandidates(slot),latest=fresh.rows[0];
   if(!latest||!same(latest.entry,entry)||latest.upload!==upload||latest.reserved!==reserved)throw new HttpError(409,'Belegung oder Revision hat sich während der Prüfung geändert.');
   return reply.header('Cache-Control','private, no-store').send({at:fresh.at,checkedAt:Date.now(),slot,old:entry.old,sha:entry.sha,upload,anchor:entry.anchor,reserved,world});
  }finally{checkingSapling=false;}
 });
 app.get(base+'/setzlingswechsel.pyz',async(req,reply)=>{
  requireActor(req,'read');
  const {rows:candidates}=await saplingCandidates();
  const rows=candidates.map(c=>c.entry);
  if(!rows.length)throw new HttpError(409,'Keine bestätigten belegten Laubpläne mit passender neuer Fassung.');
  const file=(path)=>readFileSync(new URL(path,import.meta.url));
  const bytes=zipStore([{name:'__main__.py',data:file('./erebor-fleet/sapling-exchange.py')},
   {name:'campus_grove_setup.py',data:file('../public/assets/erebor-k10-hangmodus.py')},
   {name:'revisions.json',data:Buffer.from(JSON.stringify(rows))}]);
  return reply.header('Cache-Control','private, no-store').header('X-Erebor-Plans',String(rows.length))
   .header('Content-Disposition','attachment; filename="erebor-setzlingswechsel.pyz"').type('application/octet-stream').send(bytes);
 });
 app.get('/api/projects/erebor/dashboard',(req,reply)=>buildingProgress(req,reply,true));
 app.get(base,async(req,reply)=>{requireActor(req,'read');const report=await liveReport(cfg()?.version);return reply.header('Cache-Control','private, no-store').send(status(report,req.query.site,req.query.view==='orders'));});
 app.get(base+'/drucker-reparatur.zip',async(req,reply)=>{
  requireActor(req,'admin');
  const version=cfg()?.version,report=await liveReport(version);
  if(!report||version!==project()?.current_version||report.version!==layout.version)throw new HttpError(503,'Keine aktuelle Erebor-Weltmeldung.');
  const commands=[];
  const ints=v=>'[I;'+v.join(',')+']';
  for(const p of parallelLayout.sites)for(const slot of slotsFor(p.site)){
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
  if(!sites.includes(site)||!slotsFor(site).includes(slot)||version!==project()?.current_version)throw new HttpError(404,'Unbekannter Erebor-Drucker.');
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
   for(const site of sites)for(const slot of slotsFor(site)){
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
  if(!entry||entry.slot||entry.name===read(b.site).job?.desired.blueprint)throw new HttpError(409,'Nur einen offenen Abschnitt dieser Kanone vorziehen.');
  tx(db,()=>{production.promote(b.version,b.site,entry.name);logActivity(db,actor,'erebor.plan.priority',b.site,{file:entry.name,version:b.version});});
  wake();return {site:b.site,file:entry.name};
 });
 app.post(base+'/laden',async(req,reply)=>{
  const actor=requireActor(req,'admin'),b=req.body,p=project();
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(!p||!sites.includes(b?.site)||b.version!==layout.version||b.version!==p.current_version)throw new HttpError(409,'Kanonenplatz oder Projektversion nicht aktuell.');
  const {job,bytes}=publishedPlan(db,p,b);
  if(b.part===hallPackage||(hallParents.includes(job.desired.blueprint)&&hasHallSplit(b.version)))throw new HttpError(409,'Dieser Aushub ist den fünf Zusatzkanonen zugeordnet.');
  if(job.phase==='stone'&&blockedStone(p)({stage:'stone',origin:job.desired.anchor}))throw new HttpError(409,'Diese Spalte ist bereits an den Innenausbau übergeben.');
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
