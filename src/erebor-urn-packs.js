import {Worker} from 'node:worker_threads';
import {createHash, randomUUID} from 'node:crypto';
import {stoneNBT} from './project-stone.js';
import {HttpError,requireActor} from './auth.js';
import {logActivity,tx} from './db.js';
import {ASSET_VERSION,campusPage} from './campus-page.js';

const api='/api/projects/erebor/stone/massif/urnenpakete';
const axes=[0,1,2];
const coords=r=>[r.x,r.y,r.z];
const hash=b=>createHash('sha256').update(b).digest('hex');
const distance=(a,b)=>axes.reduce((s,i)=>s+(a[i]-b[i])**2,0);
const inRange=(a,b)=>distance(a,b)<256**2;
function bounds(lo,hi){
 const size=axes.map(i=>hi[i]-lo[i]+1),volume=size.reduce((a,b)=>a*b);
 const chunks=((hi[0]>>4)-(lo[0]>>4)+1)*((hi[2]>>4)-(lo[2]>>4)+1);
 return {size,volume,valid:volume<=65536&&Math.max(...size)<=128&&chunks<=16};
}
function box(a,b){
 return [axes.map(i=>Math.min(a.lo[i],b.lo[i])),axes.map(i=>Math.max(a.hi[i],b.hi[i]))];
}
function join(a,b,slots){
 if(a.rows.length+b.rows.length>256)return;
 const [lo,hi]=box(a,b),g=bounds(lo,hi);
 if(!g.valid)return;
 const reachable=a.reachable.filter(k=>b.reachable.includes(k)&&inRange(lo,slots[k].pos));
 if(!reachable.length)return;
 return {lo,hi,reachable,volume:g.volume};
}
export function groupUrns(rows,slots){
 const nodes=rows.map(r=>{
  const p=coords(r);
  return {lo:p,hi:p,rows:[r],volume:1,reachable:slots.flatMap((s,i)=>inRange(s.pos,p)?[i]:[])};
 });
 const unserved=nodes.filter(n=>!n.reachable.length).map(n=>n.rows[0].tile);
 let best,score=Infinity;
 // Different sweep directions avoid making a fixed grid seam into a plan boundary.
 for(const order of [[0,2,1],[2,0,1],[1,2,0]]){
  const groups=[];
  for(const n of nodes.filter(n=>n.reachable.length).sort((a,b)=>order.map(i=>a.lo[i]-b.lo[i]).find(Boolean)||0)){
   let selected,merged,cost=Infinity;
   for(const g of groups){
    const j=join(g,n,slots);
    if(j&&j.volume-g.volume<cost){cost=j.volume-g.volume;selected=g;merged=j;}
   }
   if(selected){Object.assign(selected,merged);selected.rows.push(...n.rows);}
   else groups.push({...n,rows:[...n.rows]});
  }
  for(let i=0;i<groups.length;i++)for(let k=i+1;k<groups.length;){
   const g=groups[i],h=groups[k],j=join(g,h,slots);
   if(!j){k++;continue;}
   Object.assign(g,j);g.rows.push(...h.rows);groups.splice(k,1);
  }
  const total=groups.reduce((s,g)=>s+g.volume,0);
  if(!best||groups.length<best.length||groups.length===best.length&&total<score){best=groups;score=total;}
 }
 return {groups:best.map(g=>{
  const center=axes.map(i=>(g.lo[i]+g.hi[i])/2);
  const slot=g.reachable.reduce((a,b)=>distance(slots[a].pos,center)<=distance(slots[b].pos,center)?a:b);
  return {rows:g.rows,home:slots[slot].site};
 }),unserved};
}
function build(rows){
 const sorted=rows.slice().sort((a,b)=>a.tile.localeCompare(b.tile));
 const points=sorted.map(coords),lo=axes.map(i=>Math.min(...points.map(p=>p[i]))),hi=axes.map(i=>Math.max(...points.map(p=>p[i])));
 const {size}=bounds(lo,hi),bytes=stoneNBT(size,points.map(p=>p.map((n,i)=>n-lo[i])));
 const id=hash(JSON.stringify(points)).slice(0,24);
 return {tile:'M_URN_PACK_'+id,origin:lo,size,blocks:rows.length,sha:hash(bytes),bytes};
}
export function registerUrnPacks(app,campus,stations,version,capability){
 const {db}=campus,slots=stations.flatMap(s=>Object.entries(s).filter(([k])=>k==='main'||/^[B-R]$/.test(k)).map(([,pos])=>({site:s.site,pos})));
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_urn_packs(v INTEGER,pack TEXT,home TEXT,points TEXT,PRIMARY KEY(v,pack));
 CREATE TABLE IF NOT EXISTS erebor_urn_members(v INTEGER,tile TEXT,pack TEXT,PRIMARY KEY(v,tile));
 CREATE INDEX IF NOT EXISTS erebor_urn_by_pack ON erebor_urn_members(v,pack);
 CREATE TABLE IF NOT EXISTS erebor_urn_jobs(v INTEGER,job TEXT,pack TEXT,lead TEXT,site TEXT,slot TEXT,points TEXT,PRIMARY KEY(v,job),UNIQUE(v,pack),UNIQUE(v,site,slot));`);
 const open=db.prepare(`SELECT t.tile,t.x,t.y,t.z FROM erebor_massif_tiles t WHERE t.v=? AND t.special=1 AND t.done=0 AND t.site IS NULL AND t.tile GLOB '*_URN_*_BE'
 AND NOT EXISTS(SELECT 1 FROM erebor_urn_members m WHERE m.v=t.v AND m.tile=t.tile)
 AND NOT EXISTS(SELECT 1 FROM erebor_interior_columns c WHERE c.v=t.v AND c.ix=CAST(substr(t.tile,2,2) AS INTEGER) AND c.iz=CAST(substr(t.tile,6,2) AS INTEGER)) ORDER BY t.tile`);
 const catalogs=db.prepare('SELECT * FROM erebor_urn_packs WHERE v=? ORDER BY home,pack');
 const insert=db.prepare('INSERT OR IGNORE INTO erebor_urn_packs VALUES(?,?,?,?)');
 const member=db.prepare('INSERT INTO erebor_urn_members VALUES(?,?,?)');
 const assignment=db.prepare('SELECT * FROM erebor_urn_jobs WHERE v=? AND site=? AND slot=?');
 const pending=db.prepare('SELECT t.tile,t.x,t.y,t.z,t.site FROM erebor_urn_members m JOIN erebor_massif_tiles t USING(v,tile) WHERE m.v=? AND m.pack=? AND t.done=0 ORDER BY t.tile');
 const previews=new Map();
 const stats=groups=>({plans:groups.length,targets:groups.reduce((s,g)=>s+g.rows.length,0),largest:Math.max(0,...groups.map(g=>g.rows.length))});
 app.post(api,async req=>{
  const actor=requireActor(req,'write'),v=version(),b=req.body;
  if(!v||v!==12||b?.baseVersion!==v||typeof b.dryRun!=='boolean')throw new HttpError(409,'Erebor-Version und dryRun prüfen.');
  if(b.dryRun){
   const rows=open.all(v);
   const {groups,unserved}=await new Promise((resolve,reject)=>{
    const w=new Worker(new URL('./erebor-urn-pack-worker.js',import.meta.url),{workerData:{rows,slots}});
    w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{if(code)reject(Error('Paketplanung abgebrochen.'));});
   });
   const preview=randomUUID();
   previews.set(actor.user.id,{v,preview,groups,until:Date.now()+300000});
   return {dryRun:true,version:v,preview,...stats(groups),unreachable:unserved.length};
  }
  const p=previews.get(actor.user.id);
  if(!p||p.v!==v||p.preview!==b.preview||p.until<Date.now())throw new HttpError(409,'Aktuelle Vorschau erforderlich.');
  return tx(db,()=>{
   const free=new Set(open.all(v).map(r=>r.tile)),saved=[];
   for(const g of p.groups){
    const rows=g.rows.filter(r=>free.has(r.tile));
    if(!rows.length)continue;
    // Removing a newly occupied point can move the minimum corner: recompute reachability.
    const groups=rows.length===g.rows.length?[g]:groupUrns(rows,slots).groups;
    for(const part of groups){
     const f=build(part.rows);
     insert.run(v,f.tile,part.home,JSON.stringify(part.rows));
     for(const r of part.rows)member.run(v,r.tile,f.tile);
     saved.push(part);
    }
   }
   const result=stats(saved);logActivity(db,actor,'erebor.urnpacks.publish','erebor',result);
   previews.delete(actor.user.id);return {version:v,...result};
  });
 });
 app.get(api,async(req,reply)=>{
  requireActor(req,'read');const v=version(),rows=catalogs.all(v).map(r=>({id:r.pack,home:r.home,targets:JSON.parse(r.points).length,url:api+'/'+r.pack+'.nbt?version='+v}));
  const controller=capability(v);reply.header('Cache-Control','no-store');
  if(req.query.format==='json')return {version:v,controller,plans:rows.length,targets:rows.reduce((n,r)=>n+r.targets,0),rows};
  const totalTargets=rows.reduce((n,r)=>n+r.targets,0);
  const tableRows=rows.length
   ?rows.map(r=>'<tr><td>'+r.home+'</td><td class="num">'+r.targets.toLocaleString('de-DE')+'</td><td class="c-mono"><a download href="'+r.url+'">'+r.id+'</a></td></tr>').join('')
   :'<tr><td colspan="3" class="muted">Aktuell keine veröffentlichten Urnen-Sammelpläne.</td></tr>';
  return reply.type('text/html; charset=utf-8').send(campusPage('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Urnen-Sammelpläne · ATM10 Campus</title><link rel="stylesheet" href="/assets/app.css?v='+ASSET_VERSION+'"></head><body><a class="skip-link" href="#main">Zum Inhalt</a><!-- campus-navigation --><main id="main" class="c-shell"><div class="c-page-head"><div class="c-page-head-main"><p class="c-eyebrow">Bauprojekt Erebor · Massiv</p><h1>Urnen-Sammelpläne</h1><p class="c-page-sub">'+rows.length.toLocaleString('de-DE')+' Vorlagen · '+totalTargets.toLocaleString('de-DE')+' Urnenziele · <span class="c-badge '+(controller>=3?'c-badge--ok':'c-badge--warn')+'">'+(controller>=3?'Sammelbetrieb auf der Homebox bereit':'Einzelbetrieb aktiv')+'</span></p></div><div class="c-page-actions"><a class="c-btn c-btn--sm" href="/api/projects/erebor/stone/massif/plans">← Massiver Cleanstone</a><a class="c-btn c-btn--sm" href="/app?project=erebor#overview">Bauaufträge</a><a class="c-btn c-btn--primary c-btn--sm" href="/assets/erebor-urnen-v3.py" download>Homebox-Installer V3</a></div></div>'+(controller>=3?'':'<p class="c-notice c-notice--warn">Einzelbetrieb aktiv. Für den Sammelbetrieb das Homebox-Update V3 einspielen.</p>')+'<div class="c-table-wrap table-wrap" role="region" aria-label="Urnen-Sammelpläne" tabindex="0"><table><thead><tr><th scope="col">Empfohlener Standort</th><th scope="col" class="num">Urnen bei Veröffentlichung</th><th scope="col">Vorlage (NBT)</th></tr></thead><tbody>'+tableRows+'</tbody></table></div></main></body></html>',req.actor,'orders'));
 });
 app.get(api+'/:id.nbt',async(req,reply)=>{
  requireActor(req,'read');const v=Number(req.query.version),r=db.prepare('SELECT home,points FROM erebor_urn_packs WHERE v=? AND pack=? UNION ALL SELECT site,points FROM erebor_urn_jobs WHERE v=? AND job=? LIMIT 1').get(v,req.params.id,v,req.params.id);
  if(!r)throw new HttpError(404,'Kein solches Urnenpaket.');
  const rows=JSON.parse(r.points),f=build(rows);return reply.type('application/octet-stream').header('X-Campus-Origin',f.origin.join(',')).header('X-Campus-SHA256',f.sha).header('Content-Disposition','attachment; filename="EREBOR_STEIN_'+r.home+'_MASSIV_'+(rows.length===1?rows[0].tile:f.tile)+'_V'+v+'.nbt"').send(f.bytes);
 });
 function recover(v,site,slot){return assignment.get(v,site,slot);}
 function materialize(j){
  const f=build(JSON.parse(j.points));
  return {...f,x:f.origin[0],y:f.origin[1],z:f.origin[2],sx:f.size[0],sy:f.size[1],sz:f.size[2],special:1,site:j.site,slot:j.slot};
 }
 function claim(v,site,slot,pos,candidates){
  const options=new Set(candidates.filter(c=>c.special).map(c=>c.tile)),seen=new Set();
  const owners=db.prepare('SELECT pack FROM erebor_urn_members WHERE v=? AND tile=?');
  for(const c of candidates){
   if(!c.special)break;
   const pack=owners.get(v,c.tile)?.pack;
   if(!pack||seen.has(pack))continue;
   seen.add(pack);const rows=pending.all(v,pack);
   if(rows.some(r=>r.site))continue;
   if(rows.length&&!rows.every(r=>options.has(r.tile))){
    const points=rows.map(coords),lo=axes.map(i=>Math.min(...points.map(p=>p[i])));
    if(slots.some(s=>inRange(s.pos,lo)&&points.every(p=>inRange(s.pos,p))))continue;
    // A finished edge target can shift the remaining minimum corner out of range.
    // Fall back to this reachable target instead of stranding the entire group.
    return {single:c.tile};
   }
   if(rows.length===1)return {single:rows[0].tile};
   const f=build(rows);
   if(!inRange(pos,f.origin)){
    if(slots.some(s=>inRange(s.pos,f.origin)&&rows.every(r=>inRange(s.pos,coords(r)))))continue;
    return {single:c.tile};
   }
   db.prepare('INSERT INTO erebor_urn_jobs VALUES(?,?,?,?,?,?,?)').run(v,f.tile,pack,rows[0].tile,site,slot,JSON.stringify(rows));
   db.prepare('UPDATE erebor_massif_tiles SET site=?,slot=? WHERE v=? AND tile=?').run(site,slot,v,rows[0].tile);
   return {row:materialize(recover(v,site,slot))};
  }
  return {};
 }
 function close(v,tile,site,slot,success){
  const j=recover(v,site,slot);if(j?.job!==tile)throw Error('Urnenpaket gehört nicht zu dieser Kanone.');
  db.prepare('UPDATE erebor_massif_tiles SET site=NULL,slot=NULL WHERE v=? AND tile=? AND site=? AND slot=?').run(v,j.lead,site,slot);
  for(const r of JSON.parse(j.points)){
   if(success){
    db.prepare('UPDATE erebor_massif_tiles SET done=1 WHERE v=? AND tile=? AND done=0 AND site IS NULL').run(v,r.tile);
    db.prepare('INSERT INTO erebor_massif_audits(v,ix,iz,finishedAt,due) VALUES(?,?,?,?,?) ON CONFLICT(v,ix,iz) DO UPDATE SET finishedAt=excluded.finishedAt,due=excluded.due,verified=NULL').run(v,Number(r.tile.slice(1,3)),Number(r.tile.slice(5,7)),Date.now(),Date.now()+300000);
   }else{
    db.prepare('DELETE FROM erebor_urn_members WHERE v=? AND tile=?').run(v,r.tile);
    db.prepare('INSERT OR REPLACE INTO erebor_urn_retry VALUES(?,?,?)').run(v,r.tile,Date.now()+300000);
   }
  }
  db.prepare('DELETE FROM erebor_urn_jobs WHERE v=? AND job=?').run(v,tile);
 }
 return {claim,recover,materialize,close};
}
