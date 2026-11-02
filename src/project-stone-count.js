// Read-only exact cell counts, one saved Anvil region per request. No NBT exports.
import {Region,regionMtime,unpackBlockStates} from './region.js';
import {validateMountain,mountainTop} from './project-stone.js';

const air=new Set(['minecraft:air','minecraft:cave_air','minecraft:void_air']);
const category=n=>air.has(n)?1:n==='minecraft:water'?2:0;
const naturalEntity=/^(minecraft:sculk_|evilcraft:blood_stain|naturesaura:aura_bloom|productivetrees:pollinated_leaves)/;
const full=c=>c?.sections&&['full','minecraft:full'].includes(c.Status);
export function countRegionQuery(plan,value){
 validateMountain(plan);
 if(!/^-?\d+,-?\d+$/.test(String(value)))throw Error('region muss rx,rz sein.');
 const r=String(value).split(',').map(Number),[a,b]=plan.mountainFill.bounds;
 if(!r.every(Number.isSafeInteger)||r.some((v,i)=>v<Math.floor(a[i*2]/512)||v>Math.floor((b[i*2]-1)/512)))throw Error('Region liegt außerhalb des Bergplans.');
 return r;
}
export function countMountainRegion(worldDir,plan,regionCoords){
 const started=Date.now(),[rx,rz]=countRegionQuery(plan,regionCoords.join(','));
 const [a,b]=plan.mountainFill.bounds,x0=Math.max(a[0],rx*512),x1=Math.min(b[0],(rx+1)*512),z0=Math.max(a[2],rz*512),z1=Math.min(b[2],(rz+1)*512);
 const cx0=Math.floor(x0/16),cx1=Math.floor((x1-1)/16),cz0=Math.floor(z0/16),cz1=Math.floor((z1-1)/16);
 const stamps=new Map(),entityBoxes=new Map();
 const open=(x,z)=>{const key=x+','+z;if(!stamps.has(key))stamps.set(key,regionMtime(worldDir,x,z));return Region.open(worldDir,x,z);};
 // Read each neighboring region once for entity buffers, retaining metadata only.
 for(let rz2=(cz0-1)>>5;rz2<=((cz1+1)>>5);rz2++)for(let rx2=(cx0-1)>>5;rx2<=((cx1+1)>>5);rx2++){
  const r=open(rx2,rz2);if(!r)continue;
  for(let cz=Math.max(cz0-1,rz2*32);cz<=Math.min(cz1+1,rz2*32+31);cz++)for(let cx=Math.max(cx0-1,rx2*32);cx<=Math.min(cx1+1,rx2*32+31);cx++){
   const c=r.chunk(cx&31,cz&31);if(!full(c))continue;
   for(const be of c.block_entities||[]){
    if(naturalEntity.test(be.id||'')||be.y<a[1]-4||be.y>=b[1]+4)continue;
    const box=[[be.x-4,be.y-4,be.z-4],[be.x+5,be.y+5,be.z+5]];
    for(let ez=Math.floor((be.z-4)/16);ez<=Math.floor((be.z+4)/16);ez++)for(let ex=Math.floor((be.x-4)/16);ex<=Math.floor((be.x+4)/16);ex++){
     const key=ex+','+ez;if(!entityBoxes.has(key))entityBoxes.set(key,[]);entityBoxes.get(key).push(box);
    }
   }
  }
 }
 const r=open(rx,rz),indices=new Uint16Array(4096),missingChunks=[];
 const counts={geometryBlocks:0,protectedCells:0,existingSkipped:0,air:0,water:0,unknownCells:0,knownColumns:0,unknownColumns:0,chunksLoaded:0,chunksMissing:0};
 for(let cz=cz0;cz<=cz1;cz++)for(let cx=cx0;cx<=cx1;cx++){
  const columns=[],boxes=[...plan.mountainFill.protectedBoxes.map(v=>v.bounds),...(entityBoxes.get(cx+','+cz)||[])];
  let unprotected=0;
  for(let z=Math.max(z0,cz*16);z<Math.min(z1,cz*16+16);z++)for(let x=Math.max(x0,cx*16);x<Math.min(x1,cx*16+16);x++){
   const top=mountainTop(plan,x,z);if(top===null)continue;
   const end=Math.min(b[1],top+1);if(end<=a[1])continue;
   counts.geometryBlocks+=end-a[1];
   const intervals=boxes.filter(v=>x>=v[0][0]&&x<v[1][0]&&z>=v[0][2]&&z<v[1][2]).map(v=>[Math.max(a[1],v[0][1]),Math.min(end,v[1][1])]).filter(v=>v[0]<v[1]).sort((u,v)=>u[0]-v[0]);
   const segments=[];let cursor=a[1];
   for(const [lo,hi] of intervals){if(lo>cursor)segments.push([cursor,lo]);cursor=Math.max(cursor,hi);}
   if(cursor<end)segments.push([cursor,end]);
   const size=segments.reduce((sum,v)=>sum+v[1]-v[0],0);counts.protectedCells+=end-a[1]-size;
   if(size){columns.push({x,z,segments});unprotected+=size;}
  }
  if(!unprotected)continue;
  const c=r?.chunk(cx&31,cz&31);
  if(!full(c)){counts.chunksMissing++;counts.unknownCells+=unprotected;counts.unknownColumns+=columns.length;missingChunks.push({chunk:[cx,cz],cells:unprotected});continue;}
  counts.chunksLoaded++;counts.knownColumns+=columns.length;
  const sections=new Map(c.sections.map(s=>[s.Y,s.block_states]));
  for(let sy=Math.floor(a[1]/16);sy<=Math.floor((b[1]-1)/16);sy++){
   const bs=sections.get(sy),palette=bs?.palette?.length?bs.palette:[{Name:'minecraft:air'}],kinds=palette.map(v=>category(v.Name));
   const uniform=kinds.every(k=>k===kinds[0]);
   if(!uniform){
    const bits=Math.max(4,Math.ceil(Math.log2(palette.length))),words=Math.ceil(4096/Math.floor(64/bits))*2;
    if(!bs.data?.words||bs.data.words.length<words)throw Error('Blockzustände unvollständig; Region erneut lesen.');
    unpackBlockStates(bs.data,palette.length,indices);
    for(const v of indices)if(v>=palette.length)throw Error('Ungültiger Palettenindex.');
   }
   for(const col of columns)for(const [lo,hi] of col.segments){
    const y0=Math.max(lo,sy*16),y1=Math.min(hi,sy*16+16);if(y0>=y1)continue;
    if(uniform){counts[kinds[0]===1?'air':kinds[0]===2?'water':'existingSkipped']+=y1-y0;continue;}
    for(let y=y0;y<y1;y++){
     const kind=kinds[indices[((y&15)*16+(col.z&15))*16+(col.x&15)]];
     counts[kind===1?'air':kind===2?'water':'existingSkipped']++;
    }
   }
  }
 }
 const sourceRegions=[...stamps].map(([key,time])=>{const [x,z]=key.split(',').map(Number);return{region:[x,z],savedAt:time?new Date(time).toISOString():null,changedDuringRead:time!==regionMtime(worldDir,x,z)};});
 const remaining=counts.air+counts.water;
 if(counts.geometryBlocks!==remaining+counts.protectedCells+counts.existingSkipped+counts.unknownCells)throw Error('Zählung ist nicht ausgeglichen.');
 return{region:[rx,rz],bounds:[[x0,a[1],z0],[x1,b[1],z1]],...counts,remaining,maximumRemaining:remaining+counts.unknownCells,complete:counts.unknownCells===0,stable:sourceRegions.every(r=>!r.changedDuringRead),missingChunks,sourceRegions,capturedAt:new Date().toISOString(),durationMs:Date.now()-started,source:'saved-region-files',note:'Blockgenau für gespeicherte volle Chunks. Unbekannte Zellen sind keine Luft. Teilabfragen bilden keine atomare Gesamtaufnahme.'};
}
