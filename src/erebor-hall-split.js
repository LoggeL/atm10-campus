import {createHash} from 'node:crypto';
import {parseStructure} from './nbt.js';
import {Region,regionMtime} from './region.js';
import {chunkBlockReader} from './terrain.js';
import {tileNBT} from './erebor-tiles.js';
import {zipStore} from './zip.js';

export const hallPackage='E05_902';
export const hallSlots=['C','D','E','G','I'];
export const hallParents=[64,96].flatMap(y=>[-10048,-10016].map(z=>`EREBOR_E05_AUSHUB_K19_X192_Y${y}_Z${z}_R5`));
const sha=b=>createHash('sha256').update(b).digest('hex');
const air=new Set(['minecraft:air','minecraft:cave_air','minecraft:void_air']);
const point=i=>[i%32,i>>10,(i>>5)%32];

// The platform has a continuous foundation. Also retain four blocks in all
// directions around block entities, including infrastructure outside this box.
export function stationSupport(x,y,z){return x>=191&&x<=206&&z>=-10026&&z<=-10010&&y<=102;}

function readHallWorld(dir){
 const regions=new Map(),stamps=new Map(),chunks=new Map(),equipment=[];
 for(let cx=188>>4;cx<=227>>4;cx++)for(let cz=-10052>>4;cz<=-9981>>4;cz++){
  const rx=cx>>5,rz=cz>>5,key=[rx,rz].join(',');
  if(!regions.has(key)){stamps.set(key,regionMtime(dir,rx,rz));regions.set(key,Region.open(dir,rx,rz));}
  const chunk=regions.get(key)?.chunk(cx,cz);
  if(!chunk?.sections?.length||chunk.xPos!==cx||chunk.zPos!==cz||!['minecraft:full','full'].includes(chunk.Status))
   throw Error('Gespeicherter Chunk fehlt bei '+[cx,cz].join(' / '));
  chunks.set([cx,cz].join(','),chunkBlockReader(chunk));
  for(const b of chunk.block_entities??[])if(b.y>=60&&b.y<=131)equipment.push(b);
 }
 return {
  at:(x,y,z)=>chunks.get((x>>4)+','+(z>>4))(x,y,z),
  protected:(x,y,z)=>stationSupport(x,y,z)||equipment.some(b=>Math.max(Math.abs(x-b.x),Math.abs(y-b.y),Math.abs(z-b.z))<=4),
  stamps:()=>Array.from(stamps,([key,time])=>{const region=key.split(',').map(Number);return {region,savedAt:new Date(time).toISOString(),changedDuringRead:regionMtime(dir,...region)!==time};})
 };
}

export function splitHall(sources,world){
 if(sources.length!==4||new Set(sources.map(s=>s.f.id)).size!==4)throw Error('Vier verschiedene Originalpläne erforderlich.');
 const groups=[],account=[];
 for(const {f,bytes} of sources){
  const plan=parseStructure(bytes);
  if(!hallParents.includes(f.id)||f.id!==`EREBOR_E05_AUSHUB_K19_X${f.origin[0]}_Y${f.origin[1]}_Z${f.origin[2]}_R5`||
     f.cannon!=='K19'||f.kind!=='clear'||f.group!=='E05'||sha(bytes)!==f.sha256||plan.size.join()!=='32,32,32'||
     plan.entities||plan.blockEntities||plan.placed.length||plan.clear.length!==3*f.blocks)throw Error('Quellplan oder Prüfsumme abweichend.');
  const indices=[],seen=new Set(),row={parent:f.id,original:f.blocks,station:0,alreadyAir:0,other:{},stone:0};
  for(let j=0;j<plan.clear.length;j+=3){
   const [lx,ly,lz]=plan.clear.slice(j,j+3),i=(ly*32+lz)*32+lx;
   if(seen.has(i))throw Error('Doppeltes Aushubziel im Original.');
   seen.add(i);
   const x=lx+f.origin[0],y=ly+f.origin[1],z=lz+f.origin[2];
   if(world.protected(x,y,z)){row.station++;continue;}
   const block=world.at(x,y,z);
   if(block==='minecraft:stone'){indices.push(i);row.stone++;}
   else if(air.has(block))row.alreadyAir++;
   else row.other[block]=(row.other[block]||0)+1;
  }
  account.push(row);
  if(indices.length)groups.push({f,indices});
 }
 if(account.reduce((n,a)=>n+a.stone,0)<5)throw Error('Weniger als fünf offene Steinblöcke im gespeicherten Zielgebiet.');
 while(groups.length<5){
  groups.sort((a,b)=>b.indices.length-a.indices.length);
  const largest=groups.shift();
  // Split spatially along the widest axis. Every original cell has one owner.
  const extent=[0,1,2].map(k=>{let min=32,max=-1;for(const i of largest.indices){const v=point(i)[k];min=Math.min(v,min);max=Math.max(v,max);}return max-min;});
  const axis=extent.indexOf(Math.max(...extent));
  largest.indices.sort((a,b)=>point(a)[axis]-point(b)[axis]||a-b);
  const middle=Math.floor(largest.indices.length/2);
  groups.push({f:largest.f,indices:largest.indices.slice(0,middle)},{f:largest.f,indices:largest.indices.slice(middle)});
 }
 const entries=[],files=[];
 for(const [k,{f,indices}] of groups.entries()){
  const cells=new Int16Array(32**3).fill(-1);
  for(const i of indices)cells[i]=0;
  const out=tileNBT([{name:'minecraft:air'}],cells,'clear'),slot=hallSlots[k];
  const id=f.id.replace(/_R5$/,'_R'+(6+k)),fileName=id+'.nbt';
  entries.push({name:fileName,data:out.bytes});
  files.push({...f,id,fileName,title:'Eingangshalle · Aushub K19'+slot,slot,parent:f.id,
    blocks:out.air,materials:{},protectedCells:0,unknownCells:0,clearOmitted:0,sha256:sha(out.bytes),bytes:out.bytes.length});
 }
 return {files,entries,account};
}

export function hallExport(sources,worldDir){
 const world=readHallWorld(worldDir),{entries,files,account}=splitHall(sources,world);
 const clearBlocks=files.reduce((n,f)=>n+f.blocks,0);
 const report={id:hallPackage,project:'erebor',version:12,revision:5,group:'E05',title:'Eingangshalle · fünf Aushubpläne K19',
  files,account,supersedes:hallParents,sourceHashes:sources.map(s=>s.f.sha256),clearBlocks,blocks:0,materials:{},
  protectedCells:account.reduce((n,a)=>n+a.station+Object.values(a.other).reduce((x,y)=>x+y,0),0),unknownCells:0,skipped:[],
  sourceRegions:world.stamps(),capturedAt:new Date().toISOString(),worldPlacement:false,notes:['Nur bestätigter Stein in den vier veröffentlichten Aushubmasken. Stationssockel und Technik ausgespart.']};
 entries.push({name:'AUFTEILUNG.json',data:Buffer.from(JSON.stringify(report,null,2))});
 return {bytes:zipStore(entries),report};
}
