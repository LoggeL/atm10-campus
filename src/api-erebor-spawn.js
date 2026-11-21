import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {requireActor,HttpError} from './auth.js';
import {tx,logActivity} from './db.js';
import {storedZipEntry} from './zip.js';
import {DESIGN_REVISION} from './erebor-design.js';

export function registerSpawnPlans(app,{db,config}){
 const path='/api/projects/erebor/mobschutz';
 db.exec('CREATE TABLE IF NOT EXISTS erebor_spawn_plans(v INTEGER PRIMARY KEY,r INTEGER NOT NULL,version INTEGER NOT NULL,summary TEXT NOT NULL,zip BLOB NOT NULL)');
 const row=v=>db.prepare('SELECT version,summary FROM erebor_spawn_plans WHERE v=?').get(v);
 const project=()=>db.prepare("SELECT current_version AS v,plan_json FROM build_projects WHERE id='erebor'").get();
 let pending=null;
 app.get(path,async(req,reply)=>{
  requireActor(req,'read');const p=project(),r=p&&row(p.v);
  return reply.header('Cache-Control','private, no-store').send(r?JSON.parse(r.summary):{published:false});
 });
 app.get(path+'/:file',async(req,reply)=>{
  requireActor(req,'read');const {file}=req.params,p=project();
  const r=p&&db.prepare('SELECT zip,version FROM erebor_spawn_plans WHERE v=?').get(p.v);
  if(!r)throw new HttpError(404,'Spawnschutz noch nicht veröffentlicht.');
  const zip=Buffer.from(r.zip),bundle=file==='Erebor-Mobschutz.zip';
  const data=bundle?zip:/^(?:EREBOR_MEGATORCH_(?:EINZEL|[0-9]+_[0-9a-f]{12})\.nbt|Baufolge\.csv|Einzelpositionen\.csv|Offene_Bereiche\.csv|Einbau\.txt)$/.test(file)&&storedZipEntry(zip,file);
  if(!data)throw new HttpError(404,'Datei fehlt.');
  return reply.header('Cache-Control','private, no-cache').header('Content-Disposition','attachment; filename="'+file+'"').type(bundle?'application/zip':file.endsWith('csv')?'text/csv; charset=utf-8':'application/octet-stream').send(data);
 });
 app.put(path,async(req,reply)=>{
  const actor=requireActor(req,'write'),b=req.body,p=project();
  if(!p||!b||b.projectVersion!==p.v||typeof b.dryRun!=='boolean'||!Number.isInteger(b.baseVersion))throw new HttpError(409,'Aktuelle Projekt- und Paketversion erforderlich.');
  const landscape=db.prepare('SELECT revision AS r,draft FROM erebor_landscape WHERE project_version=?').get(p.v);
  if(!landscape||!config.worldSources.live)throw new HttpError(409,'Landschaft und gespeicherte Welt erforderlich.');
  const r=landscape.r,version=row(p.v)?.version??0,signature=[p.v,r,DESIGN_REVISION,version].join('/');
  if(b.baseVersion!==version)throw new HttpError(409,'Paket wurde geändert.');
  if(b.dryRun){
   if(pending?.running&&pending.signature!==signature)throw new HttpError(429,'Eine Weltprüfung läuft.');
   if(!pending||pending.signature!==signature||Date.now()-pending.at>900000&&!pending.running){
    const done=db.prepare("SELECT ix,iz FROM erebor_interior_columns WHERE v=? UNION SELECT c.ix,c.iz FROM erebor_massif_columns c JOIN erebor_massif_audits a USING(v,ix,iz) JOIN erebor_urn_surveys u USING(v,ix,iz) WHERE c.v=? AND c.state='done' AND a.verified IS NOT NULL AND u.due=0").all(p.v,p.v);
    const surfaceFiles=db.prepare("SELECT DISTINCT json_extract(f.value,'$.origin') AS pos FROM erebor_surface_parts s,json_each(s.report,'$.files') f WHERE s.v=? AND s.r=?").all(p.v,r).map(f=>JSON.parse(f.pos));
    const job=pending={signature,at:Date.now(),running:true};
    const worker=new Worker(new URL('./erebor-spawn-worker.js',import.meta.url),{workerData:{world:config.worldSources.live,plan:JSON.parse(p.plan_json),draft:JSON.parse(landscape.draft),surfaceFiles,released:done.map(c=>c.ix+','+c.iz)}});
    worker.once('message',m=>{
     job.running=false;
     if(m.error){job.error=m.error;return;}
     const z=job.zip=Buffer.from(m.zip),report=m.report;
     job.preview=createHash('sha256').update(z).digest('hex');
     job.summary={published:true,version:version+1,projectVersion:p.v,landscapeRevision:r,designRevision:DESIGN_REVISION,sha256:job.preview,
      plannedAt:report.plannedAt,oldestChunk:report.oldestChunk,newestChunk:report.newestChunk,radius:report.radius,torches:report.sites.length,
      ready:report.sites.filter(s=>s.phase==='bereit').length,runs:report.runs.length,files:new Set(report.runs.map(a=>a.file)).size,
      coveredCells:report.plannedCells-report.uncovered.length,openCells:report.uncovered.length};
    });
    worker.once('error',e=>{job.running=false;job.error=e.message;});
    worker.once('exit',code=>{if(code||job.running){job.running=false;job.error='Weltprüfung unterbrochen.';}});
   }
   if(pending.running)return reply.code(202).send({dryRun:true,state:'prüft'});
   if(pending.error){const why=pending.error;pending=null;throw new HttpError(409,why);}
   return {dryRun:true,preview:pending.preview,summary:pending.summary};
  }
  if(!pending?.zip||pending.signature!==signature||pending.preview!==b.preview||Date.now()-pending.at>900000)throw new HttpError(409,'Aktuelle Vorprüfung erforderlich.');
  const result=pending.summary;
  tx(db,()=>{
   if((row(p.v)?.version??0)!==version||project().v!==p.v)throw new HttpError(409,'Stand hat sich geändert.');
   db.prepare('INSERT OR REPLACE INTO erebor_spawn_plans VALUES(?,?,?,?,?)').run(p.v,r,version+1,JSON.stringify(result),pending.zip);
   logActivity(db,actor,'project.spawn.publish','erebor',{version:version+1,projectVersion:p.v,sha256:result.sha256});
  });
  pending=null;return result;
 });
}
