import {createHash,randomUUID} from 'node:crypto';
import {requireActor,HttpError} from './auth.js';
import {tx,logActivity} from './db.js';
import {regionMtime} from './region.js';
import {stoneBatchTiles} from '../public/assets/stone-placement.js';
import {storedZipEntry} from './zip.js';

// Immutable, authenticated server downloads. Preparing never changes Minecraft or the plan.
export function registerPreparedStoneRoutes(app,campus,{project,manifest,run}) {
 const previews=new Map(),db=campus.db;
 const find=(p,cannon,part)=>db.prepare('SELECT * FROM project_stone_packages WHERE project_id=? AND version=? AND cannon=? AND part=?').get(p.id,p.version,cannon,part);
 const summary=row=>{const r=JSON.parse(row.report_json);return {cannon:row.cannon,part:row.part,version:row.version,savedAt:row.saved_at,sha256:row.sha256,fileCount:r.files.length,blocks:r.blocks,empty:r.skipped.filter(s=>s.reason==='empty').length,unknown:r.skipped.filter(s=>s.reason==='unknown').length,capturedFrom:r.capturedFrom,capturedTo:r.capturedTo,sourceRegions:r.sourceRegions,files:r.files,skipped:r.skipped};};
 const expire=()=>{for(const [key,value] of previews)if(value.expires<Date.now())previews.delete(key);};
 app.get('/api/projects/:id/stone/prepared/:cannon/:part/:tile.nbt',async(req,reply)=>{
  const p=project(req),cannon=req.params.cannon,part=Number(req.params.part);
  if(!/^K[0-9]{2}$/.test(cannon)||!Number.isSafeInteger(part)||part<1)throw new HttpError(400,'Ungültiges Paket.');
  const row=find(p,cannon,part);if(!row)throw new HttpError(404,'Paket nicht gefunden.');
  const report=JSON.parse(row.report_json),file=report.files.find(f=>f.tile===req.params.tile);
  if(!file)throw new HttpError(404,'Schematic ist nicht in diesem Paket enthalten.');
  const bytes=storedZipEntry(row.zip,file.fileName);
  if(!bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new HttpError(503,'Gespeicherte Schematic konnte nicht geprüft werden.');
  return reply.type('application/octet-stream').header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename="${encodeURIComponent(file.fileName)}"`).header('X-Campus-SHA256',file.sha256).header('X-Campus-Origin',file.origin.join(',')).header('X-Campus-Cannon',cannon).header('X-Campus-Prepared-At',row.saved_at).send(bytes);
 });
 app.get('/api/projects/:id/stone/prepared',async(req,reply)=>{
  const p=project(req);
  const rows=db.prepare('SELECT project_id,version,cannon,part,sha256,report_json,saved_at FROM project_stone_packages WHERE project_id=? AND version=? ORDER BY cannon,part').all(p.id,p.version);
  return reply.header('Cache-Control','private, no-store').send({project:p.id,version:p.version,packages:rows.map(summary)});
 });
 app.post('/api/projects/:id/stone/prepared',async req=>{
  const actor=requireActor(req,'write'),p=project(req),b=req.body;
  if(!b||!Number.isSafeInteger(b.baseVersion)||typeof b.dryRun!=='boolean')throw new HttpError(400,'baseVersion und dryRun sind erforderlich.');
  if(b.baseVersion!==p.version)throw new HttpError(409,'Projekt wurde inzwischen geändert. Aktuelle baseVersion verwenden.');
  const m=await manifest(p);let batch;
  try{batch=stoneBatchTiles(m.tiles,p.plan,b.cannon,b.part);}catch(e){throw new HttpError(400,e.message);}
  const existing=find(p,b.cannon,b.part);
  if(existing)return {unchanged:true,package:summary(existing),worldPlacement:false};
  expire();
  if(b.dryRun){
   if(!campus.config.worldSources.live)throw new HttpError(503,'Gespeicherte Welt nicht verfügbar.');
   const out=await run({worldDir:campus.config.worldSources.live,project:p,batch:{tiles:batch.tiles,cannon:b.cannon,part:b.part}});
   // Recheck after the asynchronous world read, before issuing a preview for this plan.
   project(req);
   const bytes=Buffer.from(out.bytes),sha256=createHash('sha256').update(bytes).digest('hex'),preview=randomUUID();
   while(previews.size>=2)previews.delete(previews.keys().next().value);
   previews.set(preview,{project:p.id,version:p.version,cannon:b.cannon,part:b.part,user:actor.user.id,expires:Date.now()+300000,bytes,sha256,report:out.report});
   return {dryRun:true,preview,sha256,report:out.report,worldPlacement:false};
  }
  const pending=previews.get(b.preview);
  if(!pending||pending.project!==p.id||pending.version!==p.version||pending.cannon!==b.cannon||pending.part!==b.part||pending.user!==actor.user.id)throw new HttpError(409,'Zuerst dryRun ausführen; Vorschau fehlt, ist abgelaufen oder gehört zu einem anderen Paket.');
  for(const r of pending.report.sourceRegions){const stamp=regionMtime(campus.config.worldSources.live,...r.region);if((stamp?new Date(stamp).toISOString():null)!==r.savedAt)throw new HttpError(409,'Welt wurde seit dryRun gespeichert. dryRun wiederholen.');}
  return tx(db,()=>{
   project(req);
   const prior=find(p,b.cannon,b.part);
   if(prior)return {unchanged:true,package:summary(prior),worldPlacement:false};
   const at=new Date().toISOString();
   db.prepare('INSERT INTO project_stone_packages(project_id,version,cannon,part,sha256,zip,report_json,saved_at,user_id) VALUES(?,?,?,?,?,?,?,?,?)').run(p.id,p.version,b.cannon,b.part,pending.sha256,pending.bytes,JSON.stringify(pending.report),at,actor.user.id);
   logActivity(db,actor,'project.stone.prepare',p.id,{version:p.version,cannon:b.cannon,part:b.part,files:pending.report.files.length,blocks:pending.report.blocks,sha256:pending.sha256});
   previews.delete(b.preview);
   return {saved:true,package:summary(find(p,b.cannon,b.part)),worldPlacement:false};
  });
 });
 app.get('/api/projects/:id/stone/prepared/:cannon/:part.zip',async(req,reply)=>{
  const p=project(req),cannon=req.params.cannon,part=Number(req.params.part);
  if(!/^K[0-9]{2}$/.test(cannon)||!Number.isSafeInteger(part)||part<1)throw new HttpError(400,'Ungültiges Paket.');
  const row=find(p,cannon,part);if(!row)throw new HttpError(404,'Dieses Paket ist noch nicht vorbereitet.');
  return reply.type('application/zip').header('Cache-Control','private, no-store').header('X-Campus-SHA256',row.sha256).header('X-Campus-Prepared-At',row.saved_at).header('Content-Disposition',`attachment; filename="${p.id.toUpperCase()}_STEIN_${cannon}_PAKET_${String(part).padStart(2,'0')}_V${p.version}.zip"`).send(Buffer.from(row.zip));
 });
}
