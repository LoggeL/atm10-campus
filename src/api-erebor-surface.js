import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {requireActor,HttpError} from './auth.js';
import {tx,logActivity} from './db.js';
import {surfaceParts} from './erebor-surface.js';
import {storedZipEntry} from './zip.js';

export function registerSurface(app,campus){
 const {db,config}=campus,path='/api/projects/erebor/landschaft/bauplaene';
 db.exec('CREATE TABLE IF NOT EXISTS erebor_surface_parts(v INTEGER,r INTEGER,id TEXT,version INTEGER,summary TEXT,report TEXT,zip BLOB,PRIMARY KEY(v,r,id))');
 const select=(fields)=>db.prepare('SELECT '+fields+' FROM erebor_surface_parts WHERE v=? AND r=? AND id=?');
 const summary=select('version,summary'),detail=select('report'),download=select('zip');
 function source(){
  const p=db.prepare("SELECT current_version v,plan_json FROM build_projects WHERE id='erebor'").get();
  const d=p&&db.prepare('SELECT revision r,draft FROM erebor_landscape WHERE project_version=?').get(p.v);
  if(!d)throw new HttpError(404,'Kein veröffentlichter Landschaftsentwurf.');
  return {v:p.v,r:d.r,plan:JSON.parse(p.plan_json),draft:JSON.parse(d.draft)};
 }
 let preparing=false,latest=null;
 function partFor(src,id){
  const part=surfaceParts(src.plan,src.draft).find(p=>p.id===id);
  if(!part)throw new HttpError(404,'Region fehlt.');return part;
 }
 app.get(path,async req=>{
  requireActor(req,'read');const s=source();
  return {projectVersion:s.v,revision:s.r,parts:surfaceParts(s.plan,s.draft).map(p=>{
   const r=summary.get(s.v,s.r,p.id);return {id:p.id,published:!!r,...r&&JSON.parse(r.summary)};
  })};
 });
 app.get(path+'/:id',async req=>{
  requireActor(req,'read');const s=source(),row=detail.get(s.v,s.r,req.params.id);
  if(!row)throw new HttpError(404,'Paket noch nicht veröffentlicht.');return JSON.parse(row.report);
 });
 app.get(path+'/:id/:file',async(req,reply)=>{
  requireActor(req,'read');const s=source(),{id,file}=req.params;
  const row=download.get(s.v,s.r,id);
  if(!row)throw new HttpError(404,'Paket nicht gefunden.');
  const packed=file===id+'.zip',data=packed?Buffer.from(row.zip):/^EREBOR_HAUT_[A-Za-z0-9_-]+\.nbt$/.test(file)&&storedZipEntry(row.zip,file);
  if(!data)throw new HttpError(404,'Datei nicht gefunden.');
  return reply.type(packed?'application/zip':'application/octet-stream').header('Content-Disposition','attachment; filename="'+file+'"').send(data);
 });
 app.put(path+'/:id',async req=>{
  const actor=requireActor(req,'write'),s=source(),id=req.params.id,b=req.body,part=partFor(s,id);
  if(s.v!==b?.projectVersion||s.r!==b.revision||typeof b.dryRun!=='boolean'||!Number.isInteger(b.baseVersion))throw new HttpError(409,'Versionsstand prüfen.');
  const keys=[s.v,s.r,id],version=()=>summary.get(...keys)?.version??0;
  if(version()!==b.baseVersion)throw new HttpError(409,'Paket inzwischen geändert.');
  if(!s.draft.placement?.surfaceOnly||s.draft.placement.excavation!==false||!config.worldSources.live)throw new HttpError(409,'Additiver Entwurf und gespeicherte Welt erforderlich.');
  if(b.dryRun){
   if(preparing)throw new HttpError(429,'Ein Landschaftspaket wird geprüft.');
   preparing=true;
   try{
    const result=await new Promise((resolve,reject)=>{
     const w=new Worker(new URL('./erebor-surface-worker.js',import.meta.url),{workerData:{plan:s.plan,draft:s.draft,world:config.worldSources.live,part}});
     w.once('message',m=>m.error?reject(Error(m.error)):resolve(m));w.once('error',reject);w.once('exit',c=>{if(c)reject(Error('Landschaftsexport unterbrochen.'));});
    });
    const {report,zip}=result,preview=createHash('sha256').update(zip).digest('hex');
    latest={keys,baseVersion:b.baseVersion,report,zip,preview};
    return {dryRun:true,preview,files:report.files.length,blocks:report.blocks};
   }finally{preparing=false;}
  }
  const check=latest;
  if(!check||check.preview!==b.preview||check.keys.join('/')!==keys.join('/')||check.baseVersion!==b.baseVersion)throw new HttpError(409,'Vorprüfung erneut ausführen.');
  return tx(db,()=>{
   if(version()!==b.baseVersion)throw new HttpError(409,'Paket inzwischen geändert.');
   const report=check.report,stats={files:report.files.length,blocks:report.blocks,trees:report.trees,unknown:report.unknown.length,supportedLater:report.supportedLater,savedAt:report.savedAt};
   db.prepare('INSERT OR REPLACE INTO erebor_surface_parts VALUES(?,?,?,?,?,?,?)').run(...keys,b.baseVersion+1,JSON.stringify(stats),JSON.stringify(report),check.zip);
   logActivity(db,actor,'project.landscape.publish',id,{projectVersion:s.v,revision:s.r,...stats});latest=null;return stats;
  });
 });
}
