import {Worker} from 'node:worker_threads';
import {requireActor,HttpError} from './auth.js';
import {tx} from './db.js';
import {publishedPlan} from './erebor-selection.js';
import {DESIGN_REVISION} from './erebor-design.js';
import {inRange} from './erebor-interior.js';

// Three western pier sections. Coordinates here are cannon positions and tile origins respectively.
export const P02 = [
  ['A',[768,191,-9280],'E25_002',[704,64,-9408]],
  ['B',[769,191,-9281],'E25_007',[704,64,-9184]],
  ['C',[769,191,-9279],'E25_008',[768,64,-9120]],
];
const reject = message => {throw new HttpError(409,message);};
function terrain(world,check) {
  return new Promise((resolve,rejectPromise)=>{
    const w=new Worker(new URL('./erebor-queue-worker.js',import.meta.url),{workerData:{world}});
    const timer=setTimeout(()=>{void w.terminate();rejectPromise(new HttpError(503,'Zeitlimit bei der Geländeprüfung.'));},25000);
    const stop=()=>{clearTimeout(timer);void w.terminate();};
    w.once('error',e=>{stop();rejectPromise(e);});
    w.once('message',m=>{stop();m.error?rejectPromise(new Error(m.error)):resolve(m.result);});
    w.postMessage({interiorCheck:check});
  });
}
export function registerP02(app,campus,checkTerrain=terrain) {
  const db=campus.db;
  let busy=false;
  app.post('/api/projects/erebor/wasserstadt/p02/meldung',async req=>{
    requireActor(req,'write');
    const b=req.body??{};
    if(!['A','B','C'].includes(b.slot)||!['clear','build'].includes(b.phase)||
      !['loaded','working','finished','world-complete'].includes(b.stage)||!Number.isSafeInteger(b.placed)||b.placed<0||
      !Number.isSafeInteger(b.computer)||b.computer<0||typeof b.sha!=='string')throw new HttpError(400,'Ungültige P02-Meldung.');
    return tx(db,()=>{
      const row=db.prepare("SELECT id,job FROM erebor_selections WHERE version=12 AND sha=? AND json_extract(job,'$.p02.slot')=? AND json_extract(job,'$.phase')=?").get(b.sha,'P02'+b.slot,b.phase);
      if(!row)reject('Keine passende P02-Reservierung.');
      const j=JSON.parse(row.job),finished=['finished','world-complete'].includes(b.stage);
      if(j.p02.computer!=null&&j.p02.computer!==b.computer)reject('Computer-ID geändert.');
      if(j.p02.finished&&!finished)return {retained:true};
      j.p02={...j.p02,computer:b.computer,at:Date.now(),stage:b.stage,finished,placed:Math.max(j.p02.placed??0,b.placed)};
      j.loaded ||= b.stage!=='world-complete'; j.started ||= b.placed>0;
      db.prepare('UPDATE erebor_selections SET job=?,status=? WHERE id=?').run(JSON.stringify(j),finished?'finished':'loaded',row.id);
      return {ok:true};
    });
  });
  app.post('/api/projects/erebor/wasserstadt/p02/reservierung',async(req,reply)=>{
    requireActor(req,'write');
    const {baseVersion,dryRun}=req.body??{};
    if(baseVersion!==12||typeof dryRun!=='boolean'||DESIGN_REVISION!==5)reject('P02 benötigt den geprüften Projektstand 12 / R5.');
    if(busy)throw new HttpError(429,'P02 wird gerade geprüft.');
    busy=true;
    try {
      const project=()=>db.prepare("SELECT * FROM build_projects WHERE id='erebor'").get();
      if(project()?.current_version!==baseVersion)reject('Projektversion geändert.');
      const rows=[];
      for(const [slot,position,part,anchor] of P02) {
        const pack=db.prepare("SELECT report_json FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? AND package_id=?").get(baseVersion,DESIGN_REVISION,part);
        const files=pack?JSON.parse(pack.report_json).files.filter(f=>String(f.origin)===String(anchor)):[];
        for(const phase of ['clear','build']) {
          const [f,...rest]=files.filter(f=>f.kind===phase);
          if(!f||rest.length||f.group!=='E25'||f.protectedCells!==0||f.unknownCells!==0||f.clearOmitted!==0||!inRange(f.origin,f.size,position))reject('P02'+slot+' hat keinen passenden veröffentlichten Plan.');
          const {job,bytes}=publishedPlan(db,project(),{version:baseVersion,sourceVersion:baseVersion,site:f.cannon,part,revision:DESIGN_REVISION,file:f.fileName,sha256:f.sha256});
          const check={bytes,anchor,kind:phase,watercity:true,details:true};
          const result=await checkTerrain(campus.config.worldSources.live,check);
          if(result!==true)reject('P02'+slot+' '+phase+' · '+(typeof result==='string'?result:'Ziel enthält fremde Blöcke oder ist nicht lesbar.'));
          const done=await checkTerrain(campus.config.worldSources.live,{...check,completed:true,details:false});
          rows.push({slot,position,part,phase,job,source:f.cannon,worldComplete:done===true});
        }
      }
      tx(db,()=>{
        if(project()?.current_version!==baseVersion)reject('Projektversion geändert.');
        for(const r of rows){
          const d=r.job.desired, key='P02'+r.slot;
          const records=db.prepare('SELECT id,name,sha,job,status FROM erebor_selections WHERE version=? AND (name=? OR (json_extract(job,\'$.p02.slot\')=? AND json_extract(job,\'$.phase\')=?))').all(baseVersion,d.blueprint,key,r.phase);
          const own=records.length===1&&records[0].name===d.blueprint&&records[0].sha===d.sha256&&JSON.parse(records[0].job).p02?.slot===key;
          if((records.length&&!own)||db.prepare('SELECT 1 FROM erebor_helpers WHERE version=? AND name=?').get(baseVersion,d.blueprint)||
             db.prepare("SELECT 1 FROM erebor_queue_sites WHERE json_extract(state,'$.job.desired.blueprint')=?").get(d.blueprint)||
             (!r.worldComplete&&db.prepare('SELECT 1 FROM erebor_finished_plans WHERE version=? AND name=?').get(baseVersion,d.blueprint)))reject(key+' · Bauplan anderweitig vergeben oder bereits abgeschlossen.');
          if(!dryRun&&!own)db.prepare("INSERT INTO erebor_selections(version,site,name,sha,job,status) VALUES(?,?,?,?,?,'waiting')").run(baseVersion,r.source,d.blueprint,d.sha256,JSON.stringify({...r.job,p02:{slot:key,position:r.position},loaded:false}));
        }
      });
      return reply.header('Cache-Control','private, no-store').send({version:baseVersion,revision:DESIGN_REVISION,dryRun,rows});
    } finally {busy=false;}
  });
}
