import {mountainTop} from './project-stone.js';
import {Region} from './region.js';
import {chunkBlockReader} from './terrain.js';
import {parseStructure} from './nbt.js';

export const interiorGroup=id=>/^(?:E(?:0[5-9]|1[0-46-9]|21[AB]|3[0-9])|S[1-4])$/.test(id);
export function interiorColumns(origin,size,base){
 const out=[];
 for(let ix=Math.floor((origin[0]-base[0])/64);ix<=Math.floor((origin[0]+size[0]-1-base[0])/64);ix++)
  for(let iz=Math.floor((origin[2]-base[2])/64);iz<=Math.floor((origin[2]+size[2]-1-base[2])/64);iz++)out.push([ix,iz]);
 return out;
}
export function inRange(origin,size,at){
 return Math.hypot(...origin.map((n,i)=>Math.max(Math.abs(n-at[i]),Math.abs(n+size[i]-1-at[i]))))<256;
}
export function insideMassif(plan,origin,size){
 const [x,y,z]=origin,[w,h,d]=size;
 if(x+w>plan.worldOrigin[0]-36||y<plan.mountainFill.bounds[0][1])return false;
 const intersects=([a,b])=>origin.every((v,i)=>v<b[i]&&v+size[i]>a[i]);
 if(plan.mountainFill.protectedBoxes.some(p=>intersects(p.bounds))||plan.zones.some(s=>!interiorGroup(s.id)&&s.worldBounds&&intersects(s.worldBounds)))return false;
 for(let i=x;i<x+w;i++)for(let k=z;k<z+d;k++){const top=mountainTop(plan,i,k);if(top==null||y+h>top)return false;}
 return true;
}
export function interiorWorldCheck(world,{bytes,anchor,kind}){
 const plan=parseStructure(bytes);
 if(plan.entities||plan.blockEntities||!['build','clear'].includes(kind))return false;
 const points=kind==='clear'?[]:plan.placed;
 if(kind==='clear'){
  if(plan.placed.length)return false;
  for(let i=0;i<plan.clear.length;i+=3)points.push({x:plan.clear[i],y:plan.clear[i+1],z:plan.clear[i+2],name:'minecraft:air'});
 }else if(plan.clear.length)return false;
 if(!points.length)return false;
 const regions=new Map(),readers=new Map(),tech=[];
 const [ox,oy,oz]=anchor,[sx,sy,sz]=plan.size;
 for(let cx=(ox-4)>>4;cx<=(ox+sx+3)>>4;cx++)for(let cz=(oz-4)>>4;cz<=(oz+sz+3)>>4;cz++){
  const rk=(cx>>5)+','+(cz>>5);
  if(!regions.has(rk))regions.set(rk,Region.open(world,cx>>5,cz>>5));
  const chunk=regions.get(rk)?.chunk(cx,cz);
  if(!chunk?.sections?.length||chunk.xPos!==cx||chunk.zPos!==cz||!['full','minecraft:full'].includes(chunk.Status))return false;
  readers.set(cx+','+cz,chunkBlockReader(chunk));
  for(const b of chunk.block_entities||[])if(b.y>=oy-4&&b.y<oy+sy+4)tech.push(b);
 }
 for(const pt of points){
  const x=pt.x+anchor[0],y=pt.y+anchor[1],z=pt.z+anchor[2],cx=x>>4,cz=z>>4,key=cx+','+cz;
  const name=readers.get(key)(x,y,z);
  if(tech.some(b=>Math.abs(b.x-x)<=4&&Math.abs(b.y-y)<=4&&Math.abs(b.z-z)<=4)||!(name===pt.name||name==='minecraft:stone'||['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(name)))return false;
 }
 return true;
}
export function interiorRelease(db){
 db.exec('CREATE TABLE IF NOT EXISTS erebor_interior_columns(v INTEGER,ix INTEGER,iz INTEGER,PRIMARY KEY(v,ix,iz))');
 const verified=db.prepare("SELECT 1 FROM erebor_massif_columns c JOIN erebor_massif_audits a USING(v,ix,iz) JOIN erebor_urn_surveys u USING(v,ix,iz) WHERE c.v=? AND c.ix=? AND c.iz=? AND c.state='done' AND a.verified IS NOT NULL AND u.due=0");
 const pending=db.prepare("SELECT 1 FROM erebor_massif_tiles WHERE v=? AND tile GLOB ? AND done=0 AND (special=0 OR tile GLOB '*_URN_*') LIMIT 1");
 const active=db.prepare("SELECT json_extract(state,'$.job.desired.anchor') a,json_extract(state,'$.job.size') s FROM erebor_queue_sites WHERE json_type(state,'$.job.desired.anchor')='array' AND json_extract(state,'$.job.desired.blueprint') LIKE 'EREBOR_STEIN_%' UNION ALL SELECT json_extract(job,'$.desired.anchor'),json_extract(job,'$.size') FROM erebor_helpers WHERE version=? AND name LIKE 'EREBOR_STEIN_%' UNION ALL SELECT json_extract(job,'$.desired.anchor'),json_extract(job,'$.size') FROM erebor_selections WHERE version=? AND status='waiting' AND name LIKE 'EREBOR_STEIN_%'");
 const released=db.prepare('SELECT 1 FROM erebor_interior_columns WHERE v=? AND ix=? AND iz=?');
 const mark=db.prepare('INSERT OR IGNORE INTO erebor_interior_columns VALUES(?,?,?)');
 const key=(x,z)=>'X'+String(x).padStart(2,'0')+'_Z'+String(z).padStart(2,'0')+'_*';
 const isReleased=(v,x,z)=>!!released.get(v,x,z);
 return {isReleased,allows(v,cols){
  return cols.every(([x,z])=>isReleased(v,x,z)||verified.get(v,x,z)&&!pending.get(v,key(x,z)));
 },busy(v,base){return new Set(active.all(v,v).flatMap(r=>interiorColumns(JSON.parse(r.a),JSON.parse(r.s),base).map(p=>p.join(','))));},
 mark(v,cols){for(const [x,z] of cols)mark.run(v,x,z);}};
}
