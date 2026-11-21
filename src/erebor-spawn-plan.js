import {buildEreborDesign} from './erebor-design.js';
import {worldBox} from './erebor-tiles.js';
import {drawGoldHalls} from './erebor-gold-halls.js';
import {drawHillsideGroves} from './erebor-hillside-groves.js';
import {mountainTop} from './project-stone.js';
import {summitHeight} from './erebor-surface.js';
import {Region} from './region.js';
import {chunkBlockReader} from './terrain.js';
import {emptyModel,serializeModel} from './structure-edit.js';
import {zipStore} from './zip.js';
import {createHash} from 'node:crypto';

export const torch='torchmaster:megatorch';
// Leave a block of tolerance at the edge of Torchmaster's 64-block cube.
const reach=63, tile=16, axis=[0,1,2];
const rock=new Set(['stone','deepslate','andesite','diorite','granite','tuff','calcite','dirt'].map(id=>'minecraft:'+id));
const cover=new Set([...rock,'minecraft:grass_block','minecraft:coarse_dirt','minecraft:podzol','minecraft:snow_block']);
const key=(x,z)=>x+','+z;
const digest=b=>createHash('sha256').update(b).digest('hex');
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const bounds=points=>[axis.map(i=>Math.min(...points.map(p=>p[i]))),axis.map(i=>Math.max(...points.map(p=>p[i])))];
const middle=(a,b)=>a.map((v,i)=>(v+b[i])/2);
const floor=n=>Math.floor(n/tile);
const cellKey=c=>c.join(',');
const outward=(lo,hi,step,base,ideal)=>{
 const values=[];for(let n=Math.ceil((lo-base)/step)*step+base;n<=hi;n+=step)values.push(n);
 return values.sort((a,b)=>Math.abs(a-ideal)-Math.abs(b-ideal)||a-b);
};
function geometry(plan,draft,surfaceFiles){
 const targets=new Map(),columns=new Map();
 function add(cx,cy,cz){const p=[cx,cy,cz];targets.set(cellKey(p),p);}
 function mark(x,z,low,high){for(let y=floor(Math.max(-64,low));y<=floor(Math.min(319,high));y++)add(x,y,z);}
 const [lo,hi]=plan.mountainFill.bounds;
 for(let cx=floor(lo[0]);cx<=floor(hi[0]-1);cx++)for(let cz=floor(lo[2]);cz<=floor(hi[2]-1);cz++){
  let top=-Infinity;
  for(let x=cx*16;x<cx*16+16;x++)for(let z=cz*16;z<cz*16+16;z++){
   const base=mountainTop(plan,x,z);
   if(base!==null)top=Math.max(top,summitHeight(draft,x,z,base)+4);
  }
  if(Number.isFinite(top))mark(cx,cz,lo[1],top);
 }
 // Actual published landscape tiles may sit above the theoretical profile on existing terrain.
 for(const [x,y,z] of surfaceFiles)for(let cx=floor(x);cx<=floor(x+31);cx++)for(let cz=floor(z);cz<=floor(z+31);cz++)mark(cx,cz,y,y+32);
 const design=buildEreborDesign(plan,d=>{drawGoldHalls(d);drawHillsideGroves(d);});
 for(const op of design.ops){
  const [a,b]=worldBox(plan,op.a,op.b);
  if(op.g==='PROTECTED')continue;
  const name=design.palette[op.s].name;
  // Reserve both placed architecture and future air. One lookup per candidate column.
  for(let cx=floor(a[0]-4);cx<=floor(b[0]+3);cx++)for(let cz=floor(a[2]-4);cz<=floor(b[2]+3);cz++){
   const x=cx*16+8,z=cz*16+8;
   if(x<a[0]-4||x>=b[0]+4||z<a[2]-4||z>=b[2]+4)continue;
   const k=key(cx,cz);if(!columns.has(k))columns.set(k,[]);
   columns.get(k).push([a[1]-4,b[1]+3]);
  }
  if(['minecraft:air','minecraft:structure_void','minecraft:water','minecraft:lava'].includes(name))continue;
  for(let cx=floor(a[0]);cx<=floor(b[0]-1);cx++)for(let cz=floor(a[2]);cz<=floor(b[2]-1);cz++)mark(cx,cz,b[1],b[1]+1);
 }
 return {targets,columns};
}
function hiddenColumns(world,plan,reserved){
 const regions=new Map(),cache=new Map(),saved=[];
 function chunk(cx,cz){
  const rk=key(cx>>5,cz>>5);
  if(!regions.has(rk)){
   if(regions.size>=2)regions.delete(regions.keys().next().value);
   regions.set(rk,Region.open(world,cx>>5,cz>>5));
  }
  const r=regions.get(rk),c=r?.chunk(cx,cz);
  if(!c?.sections?.length||c.xPos!==cx||c.zPos!==cz||!['full','minecraft:full'].includes(c.Status))return null;
  saved.push(r.buf.readUInt32BE(4096+4*((cx&31)+(cz&31)*32)));
  return c;
 }
 function get(x,z){
  const cx=floor(x),cz=floor(z),k=key(cx,cz);if(cache.has(k))return cache.get(k);
  const found=new Map();cache.set(k,found);
  const banned=[...(reserved.get(k)??[])];
  for(const p of plan.mountainFill.protectedBoxes){
   const [a,b]=p.bounds;if(x<a[0]-4||x>=b[0]+4||z<a[2]-4||z>=b[2]+4)continue;
   // The lake is excluded from mountain fill. Its bed, water and timber town
   // stay intact: only fully enclosed rock below the lowest lake works can be used.
   banned.push([p.id==='P-SEE'?38:a[1]-4,b[1]+3]);
  }
  for(const s of plan.cannonLayout.stations){
   const [sx,sy,sz]=s.position;if(Math.abs(sx-x)<=15&&Math.abs(sz-z)<=15)banned.push([sy-15,sy+15]);
  }
  const c=chunk(cx,cz);if(!c)return found;
  for(const e of c.block_entities??[])if(Math.abs(x-e.x)<=7&&Math.abs(z-e.z)<=7)banned.push([e.y-7,e.y+7]);
  const at=chunkBlockReader(c),blocked=new Uint8Array(384);
  for(const [a,b] of banned)blocked.fill(1,Math.max(0,Math.min(384,a+64)),Math.max(0,Math.min(384,b+65)));
  for(let y=-60;y<=316;y++){
   if(blocked[y+64])continue;
   const old=at(x,y,z);if(!rock.has(old))continue;
   if([[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0],[0,1,0],[0,2,0]].every(([dx,dy,dz])=>cover.has(at(x+dx,y+dy,z+dz))))found.set(y,old);
  }
  return found;
 }
 return {get,saved};
}
export function placeProtection(targets,readColumn){
 const cells=[...targets.values()],groups=new Map(),sites=[],covered=new Set(),uncovered=[];
 for(const c of cells){const k=c.map(v=>Math.floor(v/7)).join(',');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
 function visit(pending){
  pending=pending.filter(c=>!covered.has(cellKey(c)));if(!pending.length)return;
  const [a,b]=bounds(pending),low=b.map(v=>v*tile+15-reach),high=a.map(v=>v*tile+reach),mid=middle(low,high);
  const xs=outward(low[0],high[0],16,8,mid[0]),zs=outward(low[2],high[2],16,8,mid[2]);
  const ys=outward(Math.max(-60,low[1]),Math.min(316,high[1]),1,0,mid[1]);
  const cols=xs.flatMap(x=>zs.map(z=>[x,z])).sort((a,b)=>Math.hypot(a[0]-mid[0],a[1]-mid[2])-Math.hypot(b[0]-mid[0],b[1]-mid[2]));
  for(const [x,z] of cols){
   const column=readColumn(x,z),y=ys.find(v=>column.has(v));if(y===undefined)continue;
   const pos=[x,y,z];sites.push({pos,old:column.get(y)});
   const first=pos.map(v=>Math.ceil((v-reach)/16)),last=pos.map(v=>floor(v+reach-15));
   for(let ix=first[0];ix<=last[0];ix++)for(let iy=first[1];iy<=last[1];iy++)for(let iz=first[2];iz<=last[2];iz++)covered.add(cellKey([ix,iy,iz]));
   return;
  }
  if(pending.length===1){uncovered.push(pending[0]);return;}
  const dim=axis.reduce((i,j)=>b[j]-a[j]>b[i]-a[i]?j:i,0),cut=(a[dim]+b[dim])/2;
  visit(pending.filter(c=>c[dim]<=cut));visit(pending.filter(c=>c[dim]>cut));
 }
 for(const g of groups.values())visit(g);
 return {sites,uncovered:uncovered.filter(c=>!covered.has(cellKey(c))),cells:cells.length};
}

export function spawnBundles(sites,stations){
 const groups=new Map(),runs=[],files=new Map();
 function mobile([x,,z]){const sx=Math.floor(x/192)*192+96,sz=Math.floor(z/192)*192+96;return {id:'Mobil_'+sx+'_'+sz,position:[sx,144,sz]};}
 for(const site of sites){
  const best=stations.filter(s=>distance(s.position,site.pos)<255&&distance(s.position,site.pos)>2)
   .sort((a,b)=>distance(a.position,site.pos)-distance(b.position,site.pos))[0]??mobile(site.pos);
  const k=best.id+' '+site.phase;if(!groups.has(k))groups.set(k,{station:best,phase:site.phase,points:[]});
  groups.get(k).points.push(site.pos);
 }
 function pack(station,phase,points){
  const [origin,end]=bounds(points),size=end.map((v,i)=>v-origin[i]+1);
  if(points.length>1&&(size.some(v=>v>512)||size.reduce((a,b)=>a*b)>1048576||distance(origin,station.position)>=255)){
   const i=axis.reduce((a,b)=>size[b]>size[a]?b:a,0);points.sort((a,b)=>a[i]-b[i]);const half=Math.ceil(points.length/2);
   pack(station,phase,points.slice(0,half));pack(station,phase,points.slice(half));return;
  }
  if(distance(origin,station.position)>=255||points.some(p=>distance(p,station.position)>=255))throw Error('Kanonenreichweite überschritten');
  const model=emptyModel(size);for(const p of points)model.cells.set(p.map((v,i)=>v-origin[i]).join(','),{name:torch,props:{}});
  const bytes=serializeModel(model),sha=digest(bytes),file='EREBOR_MEGATORCH_'+(points.length===1?'EINZEL':points.length+'_'+sha.slice(0,12))+'.nbt';
  files.set(file,bytes);runs.push({station:station.id,cannon:station.position,phase,origin,size,file,count:points.length,sha256:sha});
 }
 for(const {station,phase,points} of groups.values())pack(station,phase,points);
 return {files,runs};
}
export function spawnPackage({world,plan,draft,surfaceFiles,released}){
 const {targets,columns}=geometry(plan,draft,surfaceFiles);
 const hidden=hiddenColumns(world,plan,columns);
 const result=placeProtection(targets,hidden.get);
 if(!result.sites.length)throw Error('Keine im Weltstand bestätigten Einbauorte.');
 const done=new Set(released),[base]=plan.mountainFill.bounds;
 for(const s of result.sites){
  const [x,y,z]=s.pos,top=mountainTop(plan,x,z);
  s.phase=top!==null&&y>=base[1]&&y<=top&&!done.has(key(Math.floor((x-base[0])/64),Math.floor((z-base[2])/64)))?'nach Steinfüllung':'bereit';
 }
 const {files,runs}=spawnBundles(result.sites,plan.cannonLayout.stations);
 const single=emptyModel([1,1,1]);single.cells.set('0,0,0',{name:torch,props:{}});
 files.set('EREBOR_MEGATORCH_EINZEL.nbt',serializeModel(single));
 const csv=(header,rows)=>Buffer.from('\uFEFF'+[header,...rows].map(r=>r.join(';')).join('\r\n')+'\r\n');
 const report={plannedAt:new Date().toISOString(),radius:64,plannedCells:result.cells,uncovered:result.uncovered,sites:result.sites,runs,
  oldestChunk:new Date(Math.min(...hidden.saved)*1000).toISOString(),newestChunk:new Date(Math.max(...hidden.saved)*1000).toISOString()};
 const entries=[...files].map(([name,data])=>({name,data}));
 entries.push({name:'Baufolge.csv',data:csv(['Freigabe','Kanone','Kanone X','Kanone Y','Kanone Z','Datei','Anker X','Anker Y','Anker Z','Mega Torches'],runs.map(r=>[r.phase,r.station,...r.cannon,r.file,...r.origin,r.count]))},
  {name:'Einzelpositionen.csv',data:csv(['X','Y','Z','Bestandsblock','Freigabe'],result.sites.map(s=>[...s.pos,s.old,s.phase]))},
  {name:'Offene_Bereiche.csv',data:csv(['Chunk X','Sektion Y','Chunk Z'],result.uncovered)},
  {name:'Einbau.txt',data:Buffer.from('Gebündelt bauen: In Baufolge.csv stehen pro Einsatz Datei und Anker X/Y/Z. Alternativ EREBOR_MEGATORCH_EINZEL.nbt auf jede Koordinate in Einzelpositionen.csv setzen. Beide Wege ergeben dieselben Fackeln.\r\nCreate: Replace Solid with Any (Modus 2), Block-Entities ersetzen AUS, Drehung 0, keine Spiegelung. Die Zwischenräume der Sammelpläne sind leer. Nie mit Luft ersetzen. Zielchunks während des Drucks laden. Stationen mit Mobil sind vorgeschlagene temporäre Kanonenpositionen.\r\nNur an freigegebenen Positionen auf dem unveränderten Untergrund bauen. Die zweite Gruppe folgt nach Abschluss der jeweiligen Steinfüllung. Zielblock und umgebender Fels wurden in der gespeicherten Welt geprüft.\r\nAuslegung: 64 Blöcke Würfelradius. Schutz gegen natürliche Feindspawns. Offene_Bereiche.csv enthält konservative 16³-Prüfzellen ohne vollständigen Reichweitennachweis.\r\n')});
 return {report,zip:zipStore(entries)};
}
