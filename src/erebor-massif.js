import {Worker} from 'node:worker_threads';
import {randomUUID,createHash} from 'node:crypto';
import {requireActor,HttpError} from './auth.js';
import {tx,logActivity} from './db.js';
import {validateMountain} from './project-stone.js';
import {ereborUploadName} from './erebor-file.js';
import {parseStructure} from './nbt.js';

const api='/api/projects/erebor/stone/massif';
const filename=(v,site,tile)=>'EREBOR_STEIN_'+site+'_MASSIV_'+tile+'_V'+v;
export function registerMassif(app,campus,stations){
 const {db,config}=campus;
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_massif_runs(v INTEGER PRIMARY KEY,actor INTEGER,created TEXT);
 CREATE TABLE IF NOT EXISTS erebor_massif_columns(v INTEGER,ix INTEGER,iz INTEGER,priority INTEGER,state TEXT,next INTEGER DEFAULT 0,problem TEXT,protected INTEGER DEFAULT 0,unbreakable INTEGER DEFAULT 0,PRIMARY KEY(v,ix,iz));
 CREATE TABLE IF NOT EXISTS erebor_massif_blobs(sha TEXT PRIMARY KEY,bytes BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS erebor_massif_audits(v INTEGER,ix INTEGER,iz INTEGER,generation INTEGER DEFAULT 0,finishedAt INTEGER,due INTEGER,verified INTEGER,PRIMARY KEY(v,ix,iz));
 CREATE TABLE IF NOT EXISTS erebor_massif_tiles(v INTEGER,tile TEXT,x INTEGER,y INTEGER,z INTEGER,sx INTEGER,sy INTEGER,sz INTEGER,blocks INTEGER,sha TEXT,home TEXT,priority INTEGER,special INTEGER,site TEXT,slot TEXT,done INTEGER DEFAULT 0,PRIMARY KEY(v,tile));
 CREATE UNIQUE INDEX IF NOT EXISTS erebor_massif_busy ON erebor_massif_tiles(v,site,slot) WHERE done=0 AND site IS NOT NULL;
 CREATE INDEX IF NOT EXISTS erebor_massif_assign ON erebor_massif_tiles(v,done,special,site,x,z);`);
 db.prepare(`INSERT OR IGNORE INTO erebor_massif_audits(v,ix,iz,finishedAt,due)
  SELECT DISTINCT v,CAST(substr(tile,2,2) AS INTEGER),CAST(substr(tile,6,2) AS INTEGER),?,?
  FROM erebor_massif_tiles WHERE done=1`).run(Date.now(),Date.now()+300000);
 const project=()=>db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
 const enabled=v=>!!db.prepare('SELECT 1 FROM erebor_massif_runs WHERE v=?').get(v);
 const current=(v)=>project()?.current_version===v;
 const rowFor=db.prepare('SELECT * FROM erebor_massif_tiles WHERE v=? AND tile=?');
 const nearest=origin=>stations.reduce((best,s)=>{const d=Math.hypot(...origin.map((n,i)=>n-s.main[i]));return d<256&&(!best||d<best.d)?{id:s.site,d}:best;},null)?.id??null;
 const previews=new Map();let working=false,closed=false,worker,workerVersion;
 function getWorker(r){
  if(workerVersion!==r.current_version){worker?.terminate();worker=null;}
  if(!worker){workerVersion=r.current_version;worker=new Worker(new URL('./erebor-massif-worker.js',import.meta.url),{workerData:{world:config.worldSources.live,plan:JSON.parse(r.plan_json),stations}});}
  return worker;
 }
 const blob=db.prepare('INSERT OR IGNORE INTO erebor_massif_blobs VALUES(?,?)');
 const addTile=db.prepare('INSERT OR IGNORE INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const prefix=(ix,iz)=>'X'+String(ix).padStart(2,'0')+'_Z'+String(iz).padStart(2,'0')+'_';
 const later=db.prepare('UPDATE erebor_massif_audits SET due=? WHERE v=? AND ix=? AND iz=?');
 function nextAudit(v){
  const a=db.prepare('SELECT a.*,c.priority FROM erebor_massif_audits a JOIN erebor_massif_columns c USING(v,ix,iz) WHERE a.v=? AND a.verified IS NULL AND a.due<=? AND c.state=\'done\' ORDER BY a.due LIMIT 1').get(v,Date.now());
  if(!a)return null;
  const pending=db.prepare('SELECT 1 FROM erebor_massif_tiles WHERE v=? AND tile GLOB ? AND special=0 AND done=0 LIMIT 1').get(v,prefix(a.ix,a.iz)+'*');
  if(pending){later.run(Date.now()+300000,v,a.ix,a.iz);return null;}
  return a;
 }
 async function scan(){
  if(working||closed||!config.worldSources.live)return;
  const r=project(),v=r?.current_version;if(!r||!enabled(v))return;
  const col=db.prepare("SELECT * FROM erebor_massif_columns WHERE v=? AND state<>'done' AND next<=? ORDER BY priority,iz,ix LIMIT 1").get(v,Date.now())??nextAudit(v);
  if(!col)return;
  working=true;
  try{
   const w=getWorker(r);
   const data=await new Promise((resolve,reject)=>{
    const clean=()=>{clearTimeout(timer);w.off('message',message);w.off('error',fail);w.off('exit',exit);};
    const message=m=>{clean();m.error?reject(Error(m.error)):resolve(m);};
    const fail=e=>{clean();worker=null;void w.terminate();reject(e);};
    const exit=()=>fail(Error('Exportprozess beendet.'));
    const timer=setTimeout(()=>fail(Error('Zeitlimit beim Weltabgleich.')),120000);
    w.once('message',message);w.once('error',fail);w.once('exit',exit);w.postMessage(col);
   });
   if(closed||!current(v))return;
   tx(db,()=>{
    const audit=col.generation!==undefined;
    let rows=data.rows;
    if(audit){
     const still=db.prepare('SELECT * FROM erebor_massif_audits WHERE v=? AND ix=? AND iz=?').get(v,col.ix,col.iz);
     if(still.finishedAt!==col.finishedAt||still.generation!==col.generation)return;
     rows=rows.filter(f=>!f.tile.endsWith('_BE'));
     // A completed cannon can precede an Anvil save. Never replay based on a stale target chunk.
     if(data.missing.length||rows.some(f=>f.oldestTargetSave<col.finishedAt)){
      later.run(Date.now()+300000,v,col.ix,col.iz);return;
     }
     db.prepare('UPDATE erebor_massif_audits SET generation=generation+1,due=?,verified=? WHERE v=? AND ix=? AND iz=?')
      .run(Date.now()+600000,rows.length?null:Date.now(),v,col.ix,col.iz);
    }
    for(const f of rows){
     const tile=audit?f.tile.replace(/(_H\d+[AB]*)/,'$1_R'+(col.generation+1)):f.tile;
     const bytes=Buffer.from(f.bytes);
     if(createHash('sha256').update(bytes).digest('hex')!==f.sha)throw Error('NBT-Prüfsumme stimmt nicht.');
     if(rowFor.get(v,tile))continue;
     blob.run(f.sha,bytes);
     addTile.run(v,tile,...f.origin,...f.size,f.blocks,f.sha,nearest(f.origin),col.priority,Number(f.tile.endsWith('_BE')));
    }
    if(audit)return;
    const missing=data.missing.length>0;
    db.prepare('UPDATE erebor_massif_columns SET state=?,next=?,problem=?,protected=?,unbreakable=? WHERE v=? AND ix=? AND iz=?')
      .run(missing?'unknown':'done',missing?Date.now()+3600000:0,missing?'Ungespeicherte Chunks: '+data.missing.join(' '):null,data.protected,data.unbreakable,v,col.ix,col.iz);
   });
  }catch(e){
   if(!closed){
    if(col.generation!==undefined)later.run(Date.now()+300000,v,col.ix,col.iz);
    else db.prepare("UPDATE erebor_massif_columns SET state='retry',next=?,problem=? WHERE v=? AND ix=? AND iz=?").run(Date.now()+60000,e.message,v,col.ix,col.iz);
   }
  }finally{working=false;if(!closed){const pause=setTimeout(scan,200);pause.unref();}}
 }
 const timer=setInterval(scan,5000);timer.unref();
 app.addHook('onClose',async()=>{closed=true;clearInterval(timer);if(worker)await worker.terminate();});
 const status=v=>({version:v,enabled:enabled(v),columns:db.prepare('SELECT state,count(*) AS count FROM erebor_massif_columns WHERE v=? GROUP BY state').all(v),
  worldVerifiedColumns:db.prepare('SELECT count(*) AS n FROM erebor_massif_audits WHERE v=? AND verified IS NOT NULL').get(v).n,
  exceptions:db.prepare('SELECT coalesce(sum(protected),0) AS protected,coalesce(sum(unbreakable),0) AS unbreakable FROM erebor_massif_columns WHERE v=?').get(v),
  problems:db.prepare("SELECT ix,iz,state,problem FROM erebor_massif_columns WHERE v=? AND state IN ('retry','unknown') ORDER BY priority LIMIT 25").all(v),
  tiles:db.prepare('SELECT count(*) AS published,coalesce(sum(blocks),0) AS blocks,coalesce(sum(done),0) AS finished,coalesce(sum(special),0) AS blockEntityPlans,coalesce(sum(CASE WHEN special THEN blocks ELSE 0 END),0) AS specialBlocks,coalesce(sum(home IS NULL),0) AS outsideMainRange FROM erebor_massif_tiles WHERE v=?').get(v),
  active:db.prepare('SELECT tile,site,slot,blocks FROM erebor_massif_tiles WHERE v=? AND site IS NOT NULL AND done=0 ORDER BY site,slot').all(v)});
 app.get(api,async(req,reply)=>{
  requireActor(req,'read');const v=project()?.current_version??0,s=status(v);
  const report=await campus.ereborLiveReport?.(v);
  for(const row of s.active){
   const native=report?.stations?.[row.site+(row.slot==='A'?'':row.slot)],r=rowFor.get(v,row.tile);
   const expected=ereborUploadName(filename(v,row.site,row.tile)+'.nbt',r.sha);
   if(native?.upload===expected)row.live={at:report.at,state:native.state,status:native.status,placed:native.placed,options:native.options};
  }
  return reply.header('Cache-Control','no-store').send(s);
 });
 app.post(api,async req=>{
  const actor=requireActor(req,'write'),p=project(),b=req.body,v=p?.current_version;
  if(!p||b?.baseVersion!==v||typeof b.dryRun!=='boolean')throw new HttpError(409,'Aktuelle baseVersion und dryRun erforderlich.');
  if(enabled(v))return status(v);
  const plan=JSON.parse(p.plan_json);validateMountain(plan);
  if(!config.worldSources.live)throw new HttpError(503,'Gespeicherte Serverwelt fehlt.');
  const [lo,hi]=plan.mountainFill.bounds,nx=Math.ceil((hi[0]-lo[0])/64),nz=Math.ceil((hi[2]-lo[2])/64);
  if(b.dryRun){
   const preview=randomUUID();previews.set(actor.user.id,{v,preview,until:Date.now()+300000});
   return {dryRun:true,version:v,preview,bounds:plan.mountainFill.bounds,columns:nx*nz,material:'minecraft:stone',protected:plan.mountainFill.protectedBoxes.length};
  }
  const checked=previews.get(actor.user.id);
  if(!checked||checked.v!==v||checked.preview!==b.preview||checked.until<Date.now())throw new HttpError(409,'Aktuellen dryRun vor dem Speichern ausführen.');
  return tx(db,()=>{
   db.prepare('INSERT INTO erebor_massif_runs VALUES(?,?,?)').run(v,actor.user.id,new Date().toISOString());
   const add=db.prepare("INSERT INTO erebor_massif_columns(v,ix,iz,priority,state) VALUES(?,?,?,?,'pending')");
   const k35=stations.find(s=>s.site==='K35').main;
   for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
    const x=lo[0]+ix*64,z=lo[2]+iz*64;
    const inside=(a,b)=>a>=x&&a<x+64&&b>=z&&b<z+64;
    const rank=inside(149,-9387)?0:inside(k35[0],k35[2])?1:2+Math.floor(Math.hypot(x+32-149,z+32+9387)/64);
    add.run(v,ix,iz,rank);
   }
   logActivity(db,actor,'erebor.massif.publish','erebor',{version:v,columns:nx*nz});previews.delete(actor.user.id);return status(v);
  });
 });
 app.get(api+'/plans',async(req,reply)=>{
  requireActor(req,'read');const v=project()?.current_version,site=req.query.site||'',column=req.query.column||'';
  if(site&&!stations.some(s=>s.site===site))throw new HttpError(400,'Unbekannter Standort.');
  if(column&&!/^X\d\d_Z\d\d$/.test(column))throw new HttpError(400,'Unbekannte Bergspalte.');
  const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>10000)throw new HttpError(400,'Ungültige Seite.');
  const rows=db.prepare("SELECT * FROM erebor_massif_tiles WHERE v=? AND (?='' OR coalesce(site,home)=?) AND (?='' OR tile GLOB ?) ORDER BY priority,tile LIMIT 101 OFFSET ?").all(v,site,site,column,column+'_*',(page-1)*100);
  const link=n=>api+'/plans?page='+n+(site?'&site='+site:'')+(column?'&column='+column:'');
  const st=status(v);
  const html=rows.slice(0,100).map(r=>'<tr><td><a download href="'+api+'/'+r.tile+'.nbt?version='+v+'">'+r.tile+'</a></td><td>'+(r.site?r.site+r.slot:r.home||'Außer Reichweite')+'</td><td>'+[r.x,r.y,r.z].join(' / ')+'</td><td>'+r.blocks.toLocaleString('de-DE')+'</td><td>'+(r.done?'Kanone fertig':r.special?'<a href="'+api+'/sonderziele?tile='+r.tile+'">Geschützte Einzelziele ansehen</a>':r.site?'Vergeben':'Offen')+'</td></tr>').join('');
  const overview='<p>'+st.tiles.published.toLocaleString('de-DE')+' Baupläne · '+st.tiles.blocks.toLocaleString('de-DE')+' geplante Platzierungen · '+st.tiles.finished+' Kanonenabschlüsse · '+st.worldVerifiedColumns+' im Weltstand geprüfte Spalten nach Bauabschluss</p>';
  return reply.header('Cache-Control','no-store').type('text/html; charset=utf-8').send('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Erebor · Massiver Cleanstone</title><link rel="stylesheet" href="/assets/app.css"><main><a href="/app?project=erebor#blueprints">← Erebor-Baupläne</a><h1>Massiver Cleanstone</h1>'+overview+'<p><a href="?site=K35">K35</a> · <a href="?column=X23_Z25">Dungeon bei X 149 / Z −9387</a> · <a href="?">Gesamtes Massiv</a></p><form><label>Standort <select name="site"><option value="">Alle</option>'+stations.map(s=>'<option '+(site===s.site?'selected':'')+'>'+s.site+'</option>').join('')+'</select></label> <button>Filtern</button></form><table><thead><tr><th>NBT herunterladen</th><th>Kanone</th><th>Anker X / Y / Z</th><th>Stein</th><th>Status</th></tr></thead><tbody>'+html+'</tbody></table><p>'+(page>1?'<a href="'+link(page-1)+'">Zurück</a> ':'')+(rows.length>100?'<a href="'+link(page+1)+'">Weiter</a>':'')+'</p></main></html>');
 });
 app.get(api+'/sonderziele',async(req,reply)=>{
  requireActor(req,'read');const v=project()?.current_version,r=rowFor.get(v,String(req.query.tile||''));
  if(!r?.special)throw new HttpError(404,'Kein Einzelzielplan gefunden.');
  const {bytes}=db.prepare('SELECT bytes FROM erebor_massif_blobs WHERE sha=?').get(r.sha);
  const rows=parseStructure(Buffer.from(bytes)).placed.map(p=>'<li>'+[r.x+p.x,r.y+p.y,r.z+p.z].join(' / ')+'</li>').join('');
  return reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="de"><meta charset="utf-8"><title>Erebor · Einzelziele</title><link rel="stylesheet" href="/assets/app.css"><main><a href="'+api+'/plans?column='+r.tile.slice(0,7)+'">Zur Bergspalte</a><h1>Einzelziele · '+r.tile+'</h1><p>Diese Positionen enthielten beim Export eine natürliche Block-Entity oder ein Objekt des freigegebenen Dungeons. Die automatische Kanone schützt Block-Entities. Nach dem Abbauen lassen sich die Positionen mit diesem Steinplan schließen.</p><a download href="'+api+'/'+r.tile+'.nbt?version='+v+'">NBT herunterladen</a><h2>Weltkoordinaten X / Y / Z</h2><ul>'+rows+'</ul></main></html>');
 });
 app.get(api+'/:tile.nbt',async(req,reply)=>{
  requireActor(req,'read');const v=Number(req.query.version),r=rowFor.get(v,req.params.tile);
  if(!r)throw new HttpError(404,'Bauplan unbekannt.');
  return reply.type('application/octet-stream').header('X-Campus-SHA256',r.sha).header('X-Campus-Origin',[r.x,r.y,r.z].join(',')).header('Content-Disposition','attachment; filename="'+filename(v,r.site||r.home||'BERG',r.tile)+'.nbt"').send(Buffer.from(db.prepare('SELECT bytes FROM erebor_massif_blobs WHERE sha=?').get(r.sha).bytes));
 });
 function load(v,site,slot,r){
  const name=filename(v,site,r.tile),desired={file:ereborUploadName(name+'.nbt',r.sha),blueprint:name,sha256:r.sha,owner:'Erebor',anchor:[r.x,r.y,r.z],version:v,rotation:'none',mirror:'none',options:{replace_mode:2,skip_missing:false,replace_block_entities:false}};
  return {job:{massif:r.tile,desired,phase:slot==='A'&&!r.tile.endsWith('_LUFT')?'build':'stone',size:[r.sx,r.sy,r.sz],blocks:r.blocks,materials:{'minecraft:stone':r.blocks},loaded:false,seen:0},bytes:Buffer.from(db.prepare('SELECT bytes FROM erebor_massif_blobs WHERE sha=?').get(r.sha).bytes)};
 }
 function reserve(v,site,slot,allowSolids=slot==='A'){
  if(!enabled(v))return null;
  const pos=stations.find(s=>s.site===site)[slot==='A'?'main':slot];
  return tx(db,()=>{
   let r=db.prepare('SELECT * FROM erebor_massif_tiles WHERE v=? AND site=? AND slot=? AND done=0').get(v,site,slot);
   if(!r){
    r=db.prepare(`SELECT t.*,((x-:x)*(x-:x)+(y-:y)*(y-:y)+(z-:z)*(z-:z)) AS d FROM erebor_massif_tiles t
       WHERE v=:v AND site IS NULL AND done=0 AND special=0 AND x BETWEEN :x-255 AND :x+255 AND d<65536
       AND (:primary OR home=:site)
       AND (:solids OR tile GLOB '*_LUFT')
       AND json_array(x,y,z) NOT IN (
        SELECT json_extract(state,'$.job.desired.anchor') FROM erebor_queue_sites WHERE json_type(state,'$.job.desired.anchor')='array' AND json_extract(state,'$.job.massif') IS NULL
        UNION ALL SELECT json_extract(job,'$.desired.anchor') FROM erebor_helpers WHERE version=:v AND json_type(job,'$.desired.anchor')='array' AND json_extract(job,'$.massif') IS NULL)
       ORDER BY (:primary AND tile NOT GLOB '*_LUFT') DESC,priority,(home=:site) DESC,d,tile LIMIT 1`).get({x:pos[0],y:pos[1],z:pos[2],v,site,primary:Number(slot==='A'),solids:Number(allowSolids)});
    if(!r)return null;
    db.prepare('UPDATE erebor_massif_tiles SET site=?,slot=? WHERE v=? AND tile=?').run(site,slot,v,r.tile);
   }
   return load(v,site,slot,r);
  });
 }
 return {enabled,reserve,restore(v,site,slot,tile){const r=rowFor.get(v,tile);if(!r||r.site!==site||r.slot!==slot||r.done)throw Error('Massiv-Auftrag nicht mehr reserviert.');return load(v,site,slot,r);},
  finish(v,tile,site,slot){
   const updated=db.prepare('UPDATE erebor_massif_tiles SET done=1 WHERE v=? AND tile=? AND site=? AND slot=? AND done=0').run(v,tile,site,slot);
   const m=/^X(\d+)_Z(\d+)_/.exec(tile);
   if(updated.changes&&m)db.prepare(`INSERT INTO erebor_massif_audits(v,ix,iz,finishedAt,due) VALUES(?,?,?,?,?)
    ON CONFLICT(v,ix,iz) DO UPDATE SET finishedAt=excluded.finishedAt,due=excluded.due,verified=NULL`)
    .run(v,Number(m[1]),Number(m[2]),Date.now(),Date.now()+300000);
  }};
}
