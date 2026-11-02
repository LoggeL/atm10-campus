import { gzipSync } from 'node:zlib';
import { Region, regionMtime } from './region.js';
import { chunkBlockReader } from './terrain.js';

const ALLOWED=new Set(['minecraft:air','minecraft:cave_air','minecraft:void_air','minecraft:water']);
export function validateMountain(plan) {
 const f=plan.mountainFill;
 if(!f||f.algorithm!=='erebor-massif-v1'||plan.rotationDegrees!==90||!Array.isArray(plan.worldOrigin))throw Error('Ungültige Bergplanung.');
 if(!Array.isArray(f.bounds)||f.bounds.length!==2||f.bounds.some(a=>!Array.isArray(a)||a.length!==3||!a.every(Number.isSafeInteger)))throw Error('Ungültige Berggrenzen.');
 const [a,b]=f.bounds;
 if(a.some((v,i)=>v>=b[i])||b[0]-a[0]>2048||b[2]-a[2]>2048||a[1]<-64||b[1]>320)throw Error('Berg überschreitet erlaubte Grenzen.');
 if(!Array.isArray(f.peak)||f.peak.length!==3||!f.peak.every(Number.isSafeInteger)||f.peak.some((v,i)=>v<a[i]||v>=b[i]))throw Error('Ungültiger Gipfel.');
 if(!Array.isArray(f.protectedBoxes)||f.protectedBoxes.length>100||f.protectedBoxes.some(v=>!Array.isArray(v.bounds)||v.bounds.length!==2||v.bounds.some(a=>!Array.isArray(a)||a.length!==3||!a.every(Number.isSafeInteger))||v.bounds[0].some((n,i)=>n>=v.bounds[1][i])))throw Error('Ungültige Schutzbereiche.');
 if(!Array.isArray(f.roofReserves)||f.roofReserves.length>50||f.roofReserves.some(v=>!Array.isArray(v.bounds)||v.bounds.length!==2||v.bounds.some(a=>!Array.isArray(a)||a.length!==3||!a.every(Number.isSafeInteger))||v.bounds[0].some((n,i)=>n>=v.bounds[1][i])))throw Error('Ungültige Raumreserven.');
}
const inside=(p,b)=>p.every((v,i)=>v>=b[0][i]&&v<b[1][i]);
export function mountainTop(plan,x,z) {
 const f=plan.mountainFill,[lo,hi]=f.bounds,[px,py,pz]=f.peak;
 if(x<lo[0]||x>=hi[0]||z<lo[2]||z>=hi[2])return null;
 const rx=x<px?px-lo[0]:hi[0]-px,rz=z<pz?pz-lo[2]:hi[2]-pz;
 const dx=(x-px)/rx,dz=(z-pz)/rz,r=Math.hypot(dx,dz);
 if(r>=1)return null;
 // Six broad ridges and a faceted core; taper at the rim, not a square stone box.
 const ridge=(1+Math.cos(6*Math.atan2(dz,dx)))*.5;
 const base=62, crown=base+(py-base)*Math.pow(1-r,0.72);
 let top=Math.floor(Math.min(py,crown+34*ridge*Math.sin(Math.PI*r)));
 const [gateX,,gateZ]=plan.worldOrigin;
 // Daylight valley in front of the east-facing gate; all external towns stay out.
 if(x>=gateX && Math.abs(z-gateZ)<220+(x-gateX)*.35){
  if(x<gateX+36&&z>=gateZ-24&&z<gateZ+24)return plan.worldOrigin[1]-1;
  return null;
 }
 // Cover the already designed interior volumes, plus 24 blocks of roof rock.
 for(const roof of f.roofReserves||[]) {
  const [a,b]=roof.bounds;
  if(x>=a[0]&&x<b[0]&&z>=a[2]&&z<b[2])top=Math.max(top,Math.min(py,b[1]+23));
 }
 if(x>=gateX-36&&x<gateX&&Math.abs(z-gateZ)<124)top=Math.max(top,240);
 return top;
}
export function mountainTiles(plan) {
 validateMountain(plan);const f=plan.mountainFill,[lo,hi]=f.bounds,tiles=new Map();let geometryBlocks=0;
 const nx=Math.ceil((hi[0]-lo[0])/64),nz=Math.ceil((hi[2]-lo[2])/64),ny=Math.ceil((hi[1]-lo[1])/16),stride=ny+1;
 const diff=new Int32Array(nx*nz*stride),part=new Int32Array(diff.length);
 for(let z=lo[2];z<hi[2];z++)for(let x=lo[0];x<hi[0];x++){
  const top=mountainTop(plan,x,z);if(top===null)continue;
  const ix=Math.floor((x-lo[0])/64),iz=Math.floor((z-lo[2])/64);
  const count=top-lo[1]+1,full=Math.floor(count/16),rest=count%16,k=(iz*nx+ix)*stride;
  diff[k]+=16;diff[k+full]-=16;part[k+full]+=rest;geometryBlocks+=count;
 }
 for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){let running=0;const k=(iz*nx+ix)*stride;
  for(let iy=0;iy<ny;iy++){running+=diff[k+iy];const count=running+part[k+iy];if(!count)continue;
   const y=lo[1]+iy*16,id=`X${String(ix).padStart(2,'0')}_Z${String(iz).padStart(2,'0')}_H${String(iy).padStart(2,'0')}`;
   tiles.set(id,{id,origin:[lo[0]+ix*64,y,lo[2]+iz*64],size:[Math.min(64,hi[0]-(lo[0]+ix*64)),Math.min(16,hi[1]-y),Math.min(64,hi[2]-(lo[2]+iz*64))],geometryBlocks:count});
  }
 }
 const result=[...tiles.values()];
 // Near the entrance first within each height band; lowest bands before upper ones.
 const [gx,,gz]=plan.worldOrigin;
 result.sort((a,b)=>a.origin[1]-b.origin[1]||Math.hypot(a.origin[0]+32-gx,a.origin[2]+32-gz)-Math.hypot(b.origin[0]+32-gx,b.origin[2]+32-gz));
 return {tiles:result,geometryBlocks,material:'minecraft:stone',note:'Geometrie-Obergrenze vor Bestand/Schutzaussparungen. Downloads enthalten nur aktuell gespeicherte Luft und Wasser; bestehende feste Blöcke bleiben ausgenommen.'};
}

// Compact fixed-record writer avoids creating hundreds of thousands of JS tag objects.
export function stoneNBT(size, positions) {
 const str=s=>{const b=Buffer.from(s);const h=Buffer.alloc(2);h.writeUInt16BE(b.length);return Buffer.concat([h,b]);};
 const int=n=>{const b=Buffer.alloc(4);b.writeInt32BE(n);return b;};
 const named=(type,name,data)=>Buffer.concat([Buffer.from([type]),str(name),data]);
 const list=(name,type,count,data)=>named(9,name,Buffer.concat([Buffer.from([type]),int(count),data]));
 const head=Buffer.concat([Buffer.from([10,0,0]),named(3,'DataVersion',int(3955)),list('size',3,3,Buffer.concat(size.map(int))),list('palette',10,1,Buffer.concat([named(8,'Name',str('minecraft:stone')),Buffer.from([0])]))]);
 const prefix=Buffer.concat([Buffer.from([9]),str('pos'),Buffer.from([3]),int(3)]), suffix=Buffer.concat([named(3,'state',int(0)),Buffer.from([0])]);
 const record=prefix.length+12+suffix.length, data=Buffer.alloc(record*positions.length);
 positions.forEach((p,i)=>{let o=i*record;prefix.copy(data,o);o+=prefix.length;for(const v of p){data.writeInt32BE(v,o);o+=4;}suffix.copy(data,o);});
 return gzipSync(Buffer.concat([head,list('blocks',10,positions.length,data),list('entities',10,0,Buffer.alloc(0)),Buffer.from([0])]),{level:6});
}

export function exportMountainTile(worldDir,plan,tile) {
 validateMountain(plan);const f=plan.mountainFill,regions=new Map(),chunks=new Map(),stamps=new Map(),buffers=[];
 const getChunk=(cx,cz)=>{
  const k=`${cx},${cz}`;if(chunks.has(k))return chunks.get(k);
  const rk=`${cx>>5},${cz>>5}`;
  if(!regions.has(rk)){stamps.set(rk,regionMtime(worldDir,cx>>5,cz>>5));regions.set(rk,Region.open(worldDir,cx>>5,cz>>5));}
  const chunk=regions.get(rk)?.chunk(cx&31,cz&31);
  const value=chunk?.sections&&['full','minecraft:full'].includes(chunk.Status)?{chunk,at:chunkBlockReader(chunk)}:null;
  chunks.set(k,value);return value;
 };
 const [ox,oy,oz]=tile.origin,[sx,sy,sz]=tile.size;
 // Keep working space around block entities, including those just outside this tile.
 for(let cx=Math.floor((ox-4)/16);cx<=Math.floor((ox+sx+3)/16);cx++)for(let cz=Math.floor((oz-4)/16);cz<=Math.floor((oz+sz+3)/16);cz++){
  const c=getChunk(cx,cz);
  for(const b of c?.chunk.block_entities||[])if(b.y>=oy-4&&b.y<oy+sy+4&&!/^(minecraft:sculk_|evilcraft:blood_stain|naturesaura:aura_bloom|productivetrees:pollinated_leaves)/.test(b.id||''))buffers.push([[b.x-4,b.y-4,b.z-4],[b.x+5,b.y+5,b.z+5]]);
 }
 const positions=[];let solid=0,protectedCells=0,unknown=0,water=0;
 for(let z=oz;z<oz+sz;z++)for(let x=ox;x<ox+sx;x++){
  const top=mountainTop(plan,x,z);if(top===null||top<oy)continue;
  const c=getChunk(Math.floor(x/16),Math.floor(z/16));
  for(let y=oy;y<Math.min(oy+sy,top+1);y++){
   const p=[x,y,z];if(f.protectedBoxes.some(b=>inside(p,b.bounds))||buffers.some(b=>inside(p,b))){protectedCells++;continue;}
   if(!c){unknown++;continue;}
   const name=c.at(x,y,z);
   if(!ALLOWED.has(name)){solid++;continue;}
   positions.push([x-ox,y-oy,z-oz]);if(name==='minecraft:water')water++;
  }
 }
 const sourceRegions=[...stamps].map(([k,time])=>{const [rx,rz]=k.split(',').map(Number);return{region:[rx,rz],savedAt:time?new Date(time).toISOString():null,changedDuringRead:time!==regionMtime(worldDir,rx,rz)};});
 if(sourceRegions.some(r=>r.changedDuringRead))throw Error('Welt wurde während der Abfrage gespeichert. Download erneut anfordern.');
 if(unknown)throw Error(`${unknown} Zielzellen liegen in nicht gespeicherten Chunks. Gebiet zuerst im Spiel laden und Speichern abwarten.`);
 const bytes=stoneNBT(tile.size,positions);
 if(bytes.length>250*1024)throw Error('Diese Datei überschreitet das sichere Create-Uploadlimit.');
 return{bytes,stats:{blocks:positions.length,water,existingSkipped:solid,protectedCells,unknown,sourceRegions,capturedAt:new Date().toISOString()}};
}
