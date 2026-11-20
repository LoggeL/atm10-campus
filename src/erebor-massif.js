import {campusPage} from './campus-page.js';
import {planMassifWork} from './erebor-balance.js';
import {Worker} from 'node:worker_threads';
import {randomUUID,createHash} from 'node:crypto';
import {requireActor,HttpError} from './auth.js';
import {tx,logActivity} from './db.js';
import {validateMountain} from './project-stone.js';
import {ereborUploadName} from './erebor-file.js';
import {parseStructure} from './nbt.js';
import {registerUrnPacks} from './erebor-urn-packs.js';
import {manualUrn} from './erebor-manual-urn.js';

const api='/api/projects/erebor/stone/massif';
const filename=(v,site,tile)=>'EREBOR_STEIN_'+site+'_MASSIV_'+tile+'_V'+v;
export function registerMassif(app,campus,stations,availableSlots=()=>[],urnControllerReady=()=>false){
 const {db,config}=campus;
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_massif_runs(v INTEGER PRIMARY KEY,actor INTEGER,created TEXT);
 CREATE TABLE IF NOT EXISTS erebor_massif_control(v INTEGER PRIMARY KEY,stoneOnly INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS erebor_massif_columns(v INTEGER,ix INTEGER,iz INTEGER,priority INTEGER,state TEXT,next INTEGER DEFAULT 0,problem TEXT,protected INTEGER DEFAULT 0,unbreakable INTEGER DEFAULT 0,PRIMARY KEY(v,ix,iz));
 CREATE TABLE IF NOT EXISTS erebor_massif_blobs(sha TEXT PRIMARY KEY,bytes BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS erebor_massif_audits(v INTEGER,ix INTEGER,iz INTEGER,generation INTEGER DEFAULT 0,finishedAt INTEGER,due INTEGER,verified INTEGER,PRIMARY KEY(v,ix,iz));
 CREATE TABLE IF NOT EXISTS erebor_massif_tiles(v INTEGER,tile TEXT,x INTEGER,y INTEGER,z INTEGER,sx INTEGER,sy INTEGER,sz INTEGER,blocks INTEGER,sha TEXT,home TEXT,priority INTEGER,special INTEGER,site TEXT,slot TEXT,done INTEGER DEFAULT 0,PRIMARY KEY(v,tile));
 CREATE UNIQUE INDEX IF NOT EXISTS erebor_massif_busy ON erebor_massif_tiles(v,site,slot) WHERE done=0 AND site IS NOT NULL;
 CREATE INDEX IF NOT EXISTS erebor_massif_assign ON erebor_massif_tiles(v,done,special,site,x,z);`);
 db.exec('CREATE TABLE IF NOT EXISTS erebor_urn_retry(v INTEGER,tile TEXT,after INTEGER,PRIMARY KEY(v,tile))');
 db.exec('CREATE TABLE IF NOT EXISTS erebor_urn_surveys(v INTEGER,ix INTEGER,iz INTEGER,due INTEGER,PRIMARY KEY(v,ix,iz))');
 db.prepare(`INSERT OR IGNORE INTO erebor_massif_audits(v,ix,iz,finishedAt,due)
  SELECT DISTINCT v,CAST(substr(tile,2,2) AS INTEGER),CAST(substr(tile,6,2) AS INTEGER),?,?
  FROM erebor_massif_tiles WHERE done=1`).run(Date.now(),Date.now()+300000);
 const project=()=>db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
 const published=v=>!!db.prepare('SELECT 1 FROM erebor_massif_runs WHERE v=?').get(v);
 const enabled=v=>!!db.prepare('SELECT 1 FROM erebor_massif_runs LEFT JOIN erebor_massif_control USING(v) WHERE v=? AND coalesce(stoneOnly,1)=1').get(v);
 const current=(v)=>project()?.current_version===v;
 const rowFor=db.prepare('SELECT * FROM erebor_massif_tiles WHERE v=? AND tile=?');
 const urnCounts=db.prepare("SELECT count(*) AS found,coalesce(sum(done),0) AS finished,count(CASE WHEN done=0 AND site IS NOT NULL THEN 1 END) AS assigned FROM erebor_massif_tiles WHERE v=? AND special=1 AND tile GLOB '*_URN_*_BE'");
 const nearest=origin=>stations.reduce((best,s)=>{const d=Math.hypot(...origin.map((n,i)=>n-s.main[i]));return d<256&&(!best||d<best.d)?{id:s.site,d}:best;},null)?.id??null;
 const previews=new Map();let working=false,closed=false,worker,workerVersion,nextUrnSurvey=0;
 function getWorker(r){
  if(workerVersion!==r.current_version){worker?.terminate();worker=null;}
  if(!worker){workerVersion=r.current_version;worker=new Worker(new URL('./erebor-massif-worker.js',import.meta.url),{workerData:{world:config.worldSources.live,plan:JSON.parse(r.plan_json),stations}});}
  return worker;
 }
 const blob=db.prepare('INSERT OR IGNORE INTO erebor_massif_blobs VALUES(?,?)');
 const addTile=db.prepare('INSERT OR IGNORE INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
 db.exec('CREATE TABLE IF NOT EXISTS erebor_interior_columns(v INTEGER,ix INTEGER,iz INTEGER,PRIMARY KEY(v,ix,iz))');
 const packs=registerUrnPacks(app,campus,stations,()=>project()?.current_version,urnControllerReady);
 const released=db.prepare('SELECT 1 FROM erebor_interior_columns WHERE v=? AND ix=? AND iz=?');
 const prefix=(ix,iz)=>'X'+String(ix).padStart(2,'0')+'_Z'+String(iz).padStart(2,'0')+'_';
 const later=db.prepare('UPDATE erebor_massif_audits SET due=? WHERE v=? AND ix=? AND iz=?');
 function nextAudit(v){
  const a=db.prepare('SELECT a.*,c.priority FROM erebor_massif_audits a JOIN erebor_massif_columns c USING(v,ix,iz) WHERE a.v=? AND NOT EXISTS (SELECT 1 FROM erebor_interior_columns i WHERE i.v=a.v AND i.ix=a.ix AND i.iz=a.iz) AND a.verified IS NULL AND a.due<=? AND c.state=\'done\' ORDER BY a.due LIMIT 1').get(v,Date.now());
  if(!a)return null;
  const pending=db.prepare('SELECT 1 FROM erebor_massif_tiles WHERE v=? AND tile GLOB ? AND special=0 AND done=0 LIMIT 1').get(v,prefix(a.ix,a.iz)+'*');
  if(pending){later.run(Date.now()+300000,v,a.ix,a.iz);return null;}
  return a;
 }
 async function scan(){
  if(working||closed||!config.worldSources.live)return;
  const r=project(),v=r?.current_version;if(!r||!published(v))return;
  let col=db.prepare("SELECT * FROM erebor_massif_columns WHERE v=? AND state<>'done' AND next<=? ORDER BY priority,iz,ix LIMIT 1").get(v,Date.now());
  if(!col&&v===12&&Date.now()>=nextUrnSurvey){
   nextUrnSurvey=Date.now()+5000;
   col=db.prepare("SELECT c.*,1 AS urnsOnly FROM erebor_massif_columns c LEFT JOIN erebor_urn_surveys u USING(v,ix,iz) WHERE c.v=? AND c.state='done' AND (u.v IS NULL OR u.due>0 AND u.due<=?) ORDER BY c.priority,c.iz,c.ix LIMIT 1").get(v,Date.now());
  }
  col??=nextAudit(v);
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
    if(released.get(v,col.ix,col.iz))return;
    const audit=col.generation!==undefined;
    let rows=data.rows;
    if(audit){
     const still=db.prepare('SELECT * FROM erebor_massif_audits WHERE v=? AND ix=? AND iz=?').get(v,col.ix,col.iz);
     if(still.finishedAt!==col.finishedAt||still.generation!==col.generation)return;
     rows=rows.filter(f=>!f.tile.endsWith('_BE')||f.tile.includes('_URN_'));
     // A completed cannon can precede an Anvil save. Never replay based on a stale target chunk.
     if(data.missing.length||rows.some(f=>!f.tile.endsWith('_BE')&&f.oldestTargetSave<col.finishedAt)){
      later.run(Date.now()+300000,v,col.ix,col.iz);return;
     }
     db.prepare('UPDATE erebor_massif_audits SET generation=generation+1,due=?,verified=? WHERE v=? AND ix=? AND iz=?')
      .run(Date.now()+600000,rows.some(f=>!f.tile.endsWith('_BE'))?null:Date.now(),v,col.ix,col.iz);
    }
    for(const f of rows){
     const tile=audit?f.tile.replace(/(_H\d+[AB]*)/,'$1_R'+(col.generation+1)):f.tile;
     const bytes=Buffer.from(f.bytes);
     if(createHash('sha256').update(bytes).digest('hex')!==f.sha)throw Error('NBT-Prüfsumme stimmt nicht.');
     if(rowFor.get(v,tile))continue;
     blob.run(f.sha,bytes);
     addTile.run(v,tile,...f.origin,...f.size,f.blocks,f.sha,nearest(f.origin),col.priority,Number(f.tile.endsWith('_BE')));
    }
    if(col.urnsOnly){
     db.prepare('INSERT OR REPLACE INTO erebor_urn_surveys VALUES(?,?,?,?)').run(v,col.ix,col.iz,data.missing.length?Date.now()+3600000:0);
     return;
    }
    if(audit)return;
    const missing=data.missing.length>0;
    db.prepare('UPDATE erebor_massif_columns SET state=?,next=?,problem=?,protected=?,unbreakable=? WHERE v=? AND ix=? AND iz=?')
      .run(missing?'unknown':'done',missing?Date.now()+3600000:0,missing?'Ungespeicherte Chunks: '+data.missing.join(' '):null,data.protected,data.unbreakable,v,col.ix,col.iz);
   });
  }catch(e){
   if(!closed){
    if(col.urnsOnly)db.prepare('INSERT OR REPLACE INTO erebor_urn_surveys VALUES(?,?,?,?)').run(v,col.ix,col.iz,Date.now()+300000);
    else if(col.generation!==undefined)later.run(Date.now()+300000,v,col.ix,col.iz);
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
  const controllerVersion=Number(urnControllerReady(v));
  s.urns={controllerReady:controllerVersion>0,controllerVersion,...urnCounts.get(v)};
  for(const row of s.active){
   const packed=packs.recover(v,row.site,row.slot);
   if(packed){const f=packs.materialize(packed);s.urns.assigned+=f.blocks-1;row.tile=f.tile;row.blocks=f.blocks;
    const native=report?.stations?.[row.site+(row.slot==='A'?'':row.slot)];
    if(native?.upload===ereborUploadName(filename(v,row.site,f.tile)+'.nbt',f.sha))row.live={at:report.at,state:native.state,status:native.status,placed:native.placed,options:native.options};continue;}
   const native=report?.stations?.[row.site+(row.slot==='A'?'':row.slot)],r=rowFor.get(v,row.tile);
   const expected=ereborUploadName(filename(v,row.site,row.tile)+'.nbt',r.sha);
   if(native?.upload===expected)row.live={at:report.at,state:native.state,status:native.status,placed:native.placed,options:native.options};
  }
  return reply.header('Cache-Control','no-store').send(s);
 });
 app.post(api,async req=>{
  const actor=requireActor(req,'write'),p=project(),b=req.body,v=p?.current_version;
  if(!p||b?.baseVersion!==v||typeof b.dryRun!=='boolean')throw new HttpError(409,'Aktuelle baseVersion und dryRun erforderlich.');
  if(published(v))return status(v);
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
 app.post(api+'/bauphase',async req=>{
  const actor=requireActor(req,'admin'),v=project()?.current_version,b=req.body;
  if(req.headers.origin&&req.headers.origin!==config.publicUrl)throw new HttpError(403,'Fremder Origin.');
  if(!published(v)||v!==b?.baseVersion||typeof b.stoneOnly!=='boolean')throw new HttpError(409,'Projektversion und Bauphase prüfen.');
  return tx(db,()=>{
   db.prepare('INSERT INTO erebor_massif_control VALUES(?,?) ON CONFLICT(v) DO UPDATE SET stoneOnly=excluded.stoneOnly').run(v,Number(b.stoneOnly));
   logActivity(db,actor,'erebor.massif.phase','erebor',{version:v,stoneOnly:b.stoneOnly});
   return {version:v,stoneOnly:enabled(v)};
  });
 });
 app.get(api+'/plans',async(req,reply)=>{
  const actor=requireActor(req,'read');const v=project()?.current_version,site=req.query.site||'',column=req.query.column||'';
  if(site&&!stations.some(s=>s.site===site))throw new HttpError(400,'Unbekannter Standort.');
  if(column&&!/^X\d\d_Z\d\d$/.test(column))throw new HttpError(400,'Unbekannte Bergspalte.');
  const page=Number(req.query.page||1);if(!Number.isSafeInteger(page)||page<1||page>10000)throw new HttpError(400,'Ungültige Seite.');
  const urns=req.query.urns==='1';
  const rows=db.prepare("SELECT * FROM erebor_massif_tiles WHERE v=? AND (?='' OR coalesce(site,home)=?) AND (?='' OR tile GLOB ?) AND (?=0 OR (special=1 AND tile GLOB '*_URN_*_BE')) ORDER BY priority,tile LIMIT 101 OFFSET ?").all(v,site,site,column,column+'_*',Number(urns),(page-1)*100);
  const link=n=>api+'/plans?page='+n+(site?'&site='+site:'')+(column?'&column='+column:'')+(urns?'&urns=1':'');
  const st=status(v);
  const html=rows.slice(0,100).map(r=>'<tr><td><a download href="'+api+'/'+r.tile+'.nbt?version='+v+'">'+r.tile+'</a></td><td>'+(r.site?r.site+r.slot:r.home||'Außer Reichweite')+'</td><td>'+[r.x,r.y,r.z].join(' / ')+'</td><td>'+r.blocks.toLocaleString('de-DE')+'</td><td>'+(r.done?r.tile.includes('_URN_')?'Stein im Weltstand bestätigt':'Kanone fertig':r.special?'<a href="'+api+'/sonderziele?tile='+r.tile+'">'+(r.tile.includes('_URN_')?'Urnenauftrag ansehen':'Geschützte Einzelziele ansehen')+'</a>':r.site?'Vergeben':'Offen')+'</td></tr>').join('');
  const control=actor.via==='session'&&actor.user.role==='admin'&&published(v)
   ?'<p><button type="button" id="phaseButton" data-version="'+v+'" data-stone="'+(!st.enabled)+'">'+(st.enabled?'Zur regulären Baufolge wechseln':'Nur Cleanstone bauen')+'</button> <span id="phaseResult" role="status"></span></p><script type="module" src="/assets/massif-phase.js"></script>':'';
  const controllerVersion=Number(urnControllerReady(v));
  const counts=urnCounts.get(v);
  const urnInfo='<p><a href="'+api+'/urnenpakete">Urnen-Sammelpläne</a></p><p><a href="?urns=1">Urnen-Einzelziele</a> · '+counts.found.toLocaleString('de-DE')+' erfasst · '+counts.assigned+' vergeben · '+counts.finished+' im Weltstand bestätigt</p><p>'+(controllerVersion>=2?'Zielchunk-Ladehilfe und Zusatzkanonen bereit':controllerVersion===1?'V1 aktiv · Zielchunk-Ladehilfe benötigt V2':'Wartet auf Homebox-Erweiterung')+' · <a download href="/assets/erebor-urnen-v2.py">V2-Update für Logge</a></p>';
  const overview='<p>'+st.tiles.published.toLocaleString('de-DE')+' Baupläne · '+st.tiles.blocks.toLocaleString('de-DE')+' geplante Platzierungen · '+st.tiles.finished+' Kanonenabschlüsse · '+st.worldVerifiedColumns+' Spalten mit geprüften regulären Steinzielen nach Bauabschluss</p>'+urnInfo+control;
  return reply.header('Cache-Control','no-store').type('text/html; charset=utf-8').send(campusPage('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Erebor · Massiver Cleanstone</title><link rel="stylesheet" href="/assets/app.css?v=20261114-status-1"></head><body><!-- campus-navigation --><main><a href="/app?project=erebor#overview">← Erebor-Baupläne</a><h1>Massiver Cleanstone</h1>'+overview+'<p><a href="?site=K35">K35</a> · <a href="?column=X23_Z25">Dungeon bei X 149 / Z −9387</a> · <a href="?">Gesamtes Massiv</a></p><form>'+(urns?'<input type="hidden" name="urns" value="1">':'')+'<label>Standort <select name="site"><option value="">Alle</option>'+stations.map(s=>'<option '+(site===s.site?'selected':'')+'>'+s.site+'</option>').join('')+'</select></label> <button>Filtern</button></form><div class="table-wrap"><table><thead><tr><th>NBT herunterladen</th><th>Kanone</th><th>Anker X / Y / Z</th><th>Stein</th><th>Status</th></tr></thead><tbody>'+html+'</tbody></table></div><p>'+(page>1?'<a href="'+link(page-1)+'">Zurück</a> ':'')+(rows.length>100?'<a href="'+link(page+1)+'">Weiter</a>':'')+'</p></main></body></html>',req.actor,'orders'));
 });
 app.get(api+'/sonderziele',async(req,reply)=>{
  requireActor(req,'read');const v=project()?.current_version,r=rowFor.get(v,String(req.query.tile||''));
  if(!r?.special)throw new HttpError(404,'Kein Einzelzielplan gefunden.');
  const {bytes}=db.prepare('SELECT bytes FROM erebor_massif_blobs WHERE sha=?').get(r.sha);
  const rows=parseStructure(Buffer.from(bytes)).placed.map(p=>'<li>'+[r.x+p.x,r.y+p.y,r.z+p.z].join(' / ')+'</li>').join('');
  return reply.type('text/html; charset=utf-8').send(campusPage('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Erebor · Einzelziele</title><link rel="stylesheet" href="/assets/app.css?v=20261114-status-1"></head><body><!-- campus-navigation --><main><a href="'+api+'/plans?column='+r.tile.slice(0,7)+'">Zur Bergspalte</a><h1>Einzelziele · '+r.tile+'</h1><p>'+(r.tile.includes('_URN_')?'An dieser Position wurde eine Urne erfasst. Mit der Homebox-Erweiterung prüft die Hauptkanone ihr Einzelziel. Der Controller räumt eine vorhandene Urne samt möglicher Beute. Die Kanone füllt den Platz mit einem Stein aus der Materialkiste.':'Diese Positionen enthielten beim Export eine natürliche Block-Entity oder ein Objekt des freigegebenen Dungeons. Die automatische Kanone schützt Block-Entities. Nach dem Abbauen lassen sich die Positionen mit diesem Steinplan schließen.')+'</p><a download href="'+api+'/'+r.tile+'.nbt?version='+v+'">NBT herunterladen</a><h2>Weltkoordinaten X / Y / Z</h2><ul>'+rows+'</ul></main></body></html>',req.actor,'orders'));
 });
 app.get(api+'/:tile.nbt',async(req,reply)=>{
  requireActor(req,'read');const v=Number(req.query.version),r=rowFor.get(v,req.params.tile);
  if(!r)throw new HttpError(404,'Bauplan unbekannt.');
  return reply.type('application/octet-stream').header('X-Campus-SHA256',r.sha).header('X-Campus-Origin',[r.x,r.y,r.z].join(',')).header('Content-Disposition','attachment; filename="'+filename(v,r.site||r.home||'BERG',r.tile)+'.nbt"').send(Buffer.from(db.prepare('SELECT bytes FROM erebor_massif_blobs WHERE sha=?').get(r.sha).bytes));
 });
 function load(v,site,slot,r){
  const name=filename(v,site,r.tile),desired={file:ereborUploadName(name+'.nbt',r.sha),blueprint:name,sha256:r.sha,owner:'Erebor',anchor:[r.x,r.y,r.z],version:v,rotation:'none',mirror:'none',options:{replace_mode:r.special?0:2,skip_missing:false,replace_block_entities:false}};
  return {job:{massif:r.tile,desired,phase:slot==='A'&&!r.special&&!r.tile.endsWith('_LUFT')?'build':'stone',size:[r.sx,r.sy,r.sz],blocks:r.blocks,materials:{'minecraft:stone':r.blocks},loaded:false,seen:0},bytes:r.bytes??Buffer.from(db.prepare('SELECT bytes FROM erebor_massif_blobs WHERE sha=?').get(r.sha).bytes)};
 }
 let balance = null;
 function preferences(v) {
  const slots = availableSlots(v);
  if (!slots.length) return null;
  const capacity = slots.map(s => s.site+s.slot+Number(s.solids)).join(',');
  if (!balance || balance.version !== v || balance.capacity !== capacity || Date.now()-balance.at >= 60000) {
   const tiles = db.prepare('SELECT tile,x,y,z,blocks,site,slot FROM erebor_massif_tiles WHERE v=? AND done=0 AND special=0').all(v);
   balance = {version:v, capacity, at:Date.now(), assignments:planMassifWork(tiles,slots)};
  }
  return balance.assignments;
 }
 function reserve(v,site,slot,allowSolids=slot==='A'){
  if(!enabled(v))return null;
  const pos=stations.find(s=>s.site===site)[slot==='A'?'main':slot];
  return tx(db,()=>{
   const active=packs.recover(v,site,slot);if(active)return load(v,site,slot,packs.materialize(active));
   let r=db.prepare('SELECT * FROM erebor_massif_tiles WHERE v=? AND site=? AND slot=? AND done=0').get(v,site,slot);
   if(!r){
    let candidates=db.prepare(`WITH active_catalog(anchor) AS MATERIALIZED (
        SELECT json_extract(state,'$.job.desired.anchor') FROM erebor_queue_sites WHERE json_type(state,'$.job.desired.anchor')='array' AND json_extract(state,'$.job.massif') IS NULL
        UNION ALL SELECT json_extract(job,'$.desired.anchor') FROM erebor_helpers WHERE version=:v AND json_type(job,'$.desired.anchor')='array' AND json_extract(job,'$.massif') IS NULL)
       SELECT t.tile,t.special,(SELECT m.pack FROM erebor_urn_members m WHERE m.v=t.v AND m.tile=t.tile) AS pack,((x-:x)*(x-:x)+(y-:y)*(y-:y)+(z-:z)*(z-:z)) AS d FROM erebor_massif_tiles t
       WHERE v=:v AND site IS NULL AND done=0 AND (special=0 OR (:urn AND special=1 AND tile GLOB '*_URN_*_BE' AND sx=1 AND sy=1 AND sz=1 AND blocks=1)) AND x BETWEEN :x-255 AND :x+255 AND d<65536
       AND NOT EXISTS(SELECT 1 FROM erebor_urn_members m JOIN erebor_urn_jobs j USING(v,pack) WHERE m.v=t.v AND m.tile=t.tile)
       AND (:solids OR tile GLOB '*_LUFT' OR (special=1 AND :urn))
       AND (special=0 OR NOT EXISTS (SELECT 1 FROM erebor_urn_retry u WHERE u.v=t.v AND u.tile=t.tile AND u.after>:now))
       AND json_array(x,y,z) NOT IN (SELECT anchor FROM active_catalog)
       AND (sy<=16 OR json_array(x,y+16,z) NOT IN (SELECT anchor FROM active_catalog))
       ORDER BY special DESC,(:primary AND tile NOT GLOB '*_LUFT') DESC,(home=:site) DESC,priority,d,tile`).all({x:pos[0],y:pos[1],z:pos[2],v,site,primary:Number(slot==='A'),solids:Number(allowSolids),urn:Number(urnControllerReady(v)>=2||(slot==='A'&&!!urnControllerReady(v))),now:Date.now()});
    if(urnControllerReady(v)>=3&&candidates.some(c=>c.pack)){
     const result=packs.claim(v,site,slot,pos,candidates);
     if(result.row)return load(v,site,slot,result.row);
     candidates=candidates.filter(c=>!c.pack||c.tile===result.single);
    }
    if(!candidates.length)return null;
    const plan=preferences(v), key=site+slot;
    const chosen=candidates.find(candidate=>candidate.special) ?? candidates.find(candidate=>plan?.get(candidate.tile)===key) ?? candidates[0];
    r=rowFor.get(v,chosen.tile);
    db.prepare('UPDATE erebor_massif_tiles SET site=?,slot=? WHERE v=? AND tile=?').run(site,slot,v,r.tile);
   }
   return load(v,site,slot,r);
  });
 }
 const occupied=v=>{
  const anchors=new Set();
  for(const r of db.prepare('SELECT DISTINCT x,y,z,sy FROM erebor_massif_tiles WHERE v=? AND site IS NOT NULL AND done=0').all(v)){
   for(let dy=0;dy<r.sy;dy+=16)anchors.add([r.x,r.y+dy,r.z].join(','));
  }
  return anchors;
 };
 return {enabled,reserve,occupied,lastBalancedAt:v=>balance?.version===v?balance.at:null,restore(v,site,slot,tile){if(tile.includes('_URN_PACK_')){const j=packs.recover(v,site,slot);if(j?.job!==tile)throw Error('Urnenpaket nicht reserviert.');return load(v,site,slot,packs.materialize(j));}const r=rowFor.get(v,tile);if(!r||r.site!==site||r.slot!==slot||r.done)throw Error('Massiv-Auftrag nicht mehr reserviert.');return load(v,site,slot,r);},
  deferUrn(v,site,tile,slot='A'){
   if(tile.includes('_URN_PACK_'))return packs.close(v,tile,site,slot,false);
   const changed=db.prepare("UPDATE erebor_massif_tiles SET site=NULL,slot=NULL WHERE v=? AND tile=? AND site=? AND slot=? AND special=1 AND tile GLOB '*_URN_*_BE' AND done=0").run(v,tile,site,slot);
   if(!changed.changes)throw Error('Urnenauftrag nicht reserviert.');
   db.prepare('INSERT OR REPLACE INTO erebor_urn_retry VALUES(?,?,?)').run(v,tile,Date.now()+300000);
  },
  finish(v,tile,site,slot,urns=[]){
   if(tile.includes('_URN_PACK_'))return packs.close(v,tile,site,slot,true);
   if(urns.length){
    const row=rowFor.get(v,tile),column=/^X\d+_Z\d+/.exec(tile)?.[0];
    if(!column||!row||row.done||row.special||row.site!==site||row.slot!==slot)throw Error('Urnen gehören nicht zu einem aktiven regulären Auftrag.');
    // Called within the same transaction that releases the original job.
    for(const pos of urns){
     const f=manualUrn(column,pos);
     if(pos.some((n,i)=>!Number.isSafeInteger(n)||n<[row.x,row.y,row.z][i]||n>=[row.x+row.sx,row.y+row.sy,row.z+row.sz][i]))throw Error('Urne außerhalb des Bauplans.');
     blob.run(f.sha,f.bytes);
     addTile.run(v,f.tile,...pos,...f.size,1,f.sha,nearest(pos),row.priority,1);
    }
   }
   const updated=db.prepare('UPDATE erebor_massif_tiles SET done=1 WHERE v=? AND tile=? AND site=? AND slot=? AND done=0').run(v,tile,site,slot);
   const m=/^X(\d+)_Z(\d+)_/.exec(tile);
   if(updated.changes&&m)db.prepare(`INSERT INTO erebor_massif_audits(v,ix,iz,finishedAt,due) VALUES(?,?,?,?,?)
    ON CONFLICT(v,ix,iz) DO UPDATE SET finishedAt=excluded.finishedAt,due=excluded.due,verified=NULL`)
    .run(v,Number(m[1]),Number(m[2]),Date.now(),Date.now()+300000);
  }};
}
