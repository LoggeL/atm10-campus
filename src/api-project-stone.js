import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {requireActor,HttpError} from './auth.js';

export function registerProjectStoneRoutes(app,campus){
 const cache=new Map();let active=0;
 const run=async(data)=>{
  if(active>=2)throw new HttpError(429,'Zwei Bergexporte laufen bereits. Bitte kurz warten.');active++;
  try{return await new Promise((resolve,reject)=>{
   const w=new Worker(new URL('./project-stone-worker.js',import.meta.url),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:256}});
   const t=setTimeout(()=>{w.terminate();reject(new HttpError(503,'Bergexport hat das Zeitlimit erreicht.'));},60000);
   w.once('message',m=>{clearTimeout(t);m.ok?resolve(m.result):reject(new HttpError(409,m.error));});
   w.once('error',()=>{clearTimeout(t);reject(new HttpError(503,'Bergexport konnte nicht gelesen werden.'));});
   w.once('exit',c=>{clearTimeout(t);if(c!==0)reject(new HttpError(503,'Bergexport abgebrochen.'));});
  });}finally{active--;}
 };
 const project=req=>{
  requireActor(req,'read');const row=campus.db.prepare('SELECT * FROM build_projects WHERE id=?').get(req.params.id);
  if(!row)throw new HttpError(404,'Projekt nicht gefunden.');
  if(String(row.current_version)!==String(req.query.version))throw new HttpError(409,'Projektversion geändert. Projektseite neu laden.');
  const plan=JSON.parse(row.plan_json);if(!plan.mountainFill)throw new HttpError(404,'Keine Steinfüllung geplant.');
  return{plan,version:row.current_version,id:row.id};
 };
 const manifest=async p=>{const key=p.id+':'+p.version;if(cache.has(key))return cache.get(key);const m=await run({plan:p.plan});cache.set(key,m);while(cache.size>3)cache.delete(cache.keys().next().value);return m;};
 app.get('/api/projects/:id/stone/manifest',async(req,reply)=>{
  const p=project(req),m=await manifest(p);
  return reply.header('Cache-Control','private, no-store').send({project:p.id,version:p.version,...m,export:'NBT enthält nur gespeicherte Luft/Wasser. Bestehende Blöcke, Schutzbereiche und Platz um Block-Entities werden ausgelassen. Unbekannte Chunks verhindern den Download.',cannon:{replaceMode:0,replaceBlockEntities:false,rotation:'NONE',mirror:'NONE'}});
 });
 app.get('/api/projects/:id/stone/:tile.nbt',async(req,reply)=>{
  const p=project(req),m=await manifest(p),tile=m.tiles.find(t=>t.id===req.params.tile);
  if(!tile)throw new HttpError(404,'Bergabschnitt nicht gefunden.');
  if(!campus.config.worldSources.live)throw new HttpError(503,'Live-Welt nicht verfügbar.');
  const r=await run({plan:p.plan,worldDir:campus.config.worldSources.live,tile});
  if(!r.stats.blocks)throw new HttpError(409,'Dieser Abschnitt enthält derzeit keine zu füllende Luft oder Wasserfläche außerhalb der Schutzbereiche.',{stats:r.stats});
  const bytes=Buffer.from(r.bytes),hash=createHash('sha256').update(bytes).digest('hex');
  return reply.type('application/octet-stream').header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename="EREBOR_STEIN_${tile.id}_V${p.version}.nbt"`)
   .header('X-Campus-Origin',tile.origin.join(',')).header('X-Campus-Stone-Blocks',r.stats.blocks).header('X-Campus-Water-Blocks',r.stats.water).header('X-Campus-Protected-Cells',r.stats.protectedCells).header('X-Campus-SHA256',hash).header('X-Campus-Captured-At',r.stats.capturedAt).send(bytes);
 });
}
