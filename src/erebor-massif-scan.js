import {createHash} from 'node:crypto';
import {Region} from './region.js';
import {chunkBlockReader} from './terrain.js';
import {mountainTop,stoneNBT,validateMountain} from './project-stone.js';

const naturalEntity=/^(minecraft:(?:sculk_.*|beehive)|evilcraft:blood_stain|naturesaura:aura_bloom|productivetrees:pollinated_leaves)$/;
const dungeonEntity=/^(lootr:lootr_(?:chest|barrel|trapped_chest)|minecraft:mob_spawner|apotheosis:boss_spawner)$/;
const dungeonFittings=/^minecraft:(?:bed|skull|campfire)$/;
const cavities=new Set(['minecraft:air','minecraft:cave_air','minecraft:void_air','minecraft:water']);
const technical=/(?:^ae2:|^appflux:|^fluxnetworks:|^advancedperipherals:|^computercraft:|^laserio:|^pipez:|(?:^|[:_])(?:cable|pipe|conduit|tunnel|transporter|transmitter|controller|waystone|connector)(?:_|$))/;
const immutable=new Set(['minecraft:bedrock','minecraft:end_portal','minecraft:end_portal_frame','minecraft:barrier']);
const dungeon=(x,z)=>Math.abs(x-149)<=44&&Math.abs(z+9387)<=45;
const pad=n=>String(n).padStart(2,'0');
const inBox=(x,y,z,[a,b])=>x>=a[0]&&x<b[0]&&y>=a[1]&&y<b[1]&&z>=a[2]&&z<b[2];

export function scanMassifColumn(world,plan,ix,iz,stations){
 validateMountain(plan);
 const [lo,hi]=plan.mountainFill.bounds,ox=lo[0]+64*ix,oz=lo[2]+64*iz;
 const sx=Math.min(64,hi[0]-ox),sz=Math.min(64,hi[2]-oz);
 const rows=[],regions=new Map(),chunks=new Map(),boxes=[...plan.mountainFill.protectedBoxes.map(b=>b.bounds)];
 for(const site of stations)for(const p of [site.main,site.B,site.C,site.chest]){
  boxes.push([p.map(n=>n-4),p.map(n=>n+5)]);
 }
 const cx0=(ox-4)>>4,cx1=(ox+sx+3)>>4,cz0=(oz-4)>>4,cz1=(oz+sz+3)>>4;
 const tops=new Int16Array(sx*sz);let high=lo[1]-1;
 for(let z=0;z<sz;z++)for(let x=0;x<sx;x++){
  const top=Math.min(hi[1]-1,mountainTop(plan,ox+x,oz+z)??lo[1]-1);
  tops[z*sx+x]=top;high=Math.max(high,top);
 }
 if(high<lo[1])return {rows,missing:[],protected:0,unbreakable:0};
 const special=new Set(),missing=new Set(),unknownColumns=new Set(),saved=new Map();
 const index=(x,y,z)=>((y-lo[1])*sz+(z-oz))*sx+x-ox;
 for(let cz=cz0;cz<=cz1;cz++)for(let cx=cx0;cx<=cx1;cx++){
  const rk=(cx>>5)+','+(cz>>5);
  if(!regions.has(rk))regions.set(rk,Region.open(world,cx>>5,cz>>5));
  const region=regions.get(rk),chunk=region?.chunk(cx,cz);
  if(!chunk?.sections||chunk.xPos!==cx||chunk.zPos!==cz||!['full','minecraft:full'].includes(chunk.Status)){
   unknownColumns.add(cx+','+cz);continue;
  }
  const chunkKey=cx+','+cz;
  chunks.set(chunkKey,chunkBlockReader(chunk));
  saved.set(chunkKey,region.buf.readUInt32BE(4096+4*((cx&31)+(cz&31)*32))*1000);
  for(const b of chunk.block_entities||[]){
   if(naturalEntity.test(b.id)||dungeon(b.x,b.z)&&dungeonEntity.test(b.id)||
      Math.abs(b.x-149)<=3&&Math.abs(b.z+9387)<=5&&b.y>=61&&b.y<=89&&dungeonFittings.test(b.id)){
    if(b.x>=ox&&b.x<ox+sx&&b.z>=oz&&b.z<oz+sz)special.add(index(b.x,b.y,b.z));
   }
   else boxes.push([[b.x-4,b.y-4,b.z-4],[b.x+5,b.y+5,b.z+5]]);
  }
 }
 const relevant=boxes.filter(([a,b])=>a[0]<ox+sx&&b[0]>ox&&a[2]<oz+sz&&b[2]>oz);
 let protectedCount=0,unbreakable=0;
 for(let y0=lo[1],iy=0;y0<=high;y0+=16,iy++){
  const size=[sx,Math.min(16,hi[1]-y0),sz],positions=[],specialPositions=[],cavityPositions=[];
  const touching=relevant.filter(([a,b])=>a[1]<y0+size[1]&&b[1]>y0);
  const tile='X'+pad(ix)+'_Z'+pad(iz)+'_H'+pad(iy);let incomplete=false,oldestTargetSave=Infinity;
  for(let z=0;z<sz;z++)for(let x=0;x<sx;x++){
   const wx=ox+x,wz=oz+z,top=Math.min(y0+size[1]-1,tops[z*sx+x]);
   if(top<y0)continue;
   const key=(wx>>4)+','+(wz>>4),at=chunks.get(key);
   if(!at){missing.add(key);incomplete=true;continue;}
   // A missing neighbour may contain a machine whose four-block buffer
   // crosses the chunk border. Defer the tile until that fringe is known.
   if(unknownColumns.size){
    let uncertain=false;
    for(let cz=(wz-4)>>4;cz<=(wz+4)>>4;cz++)for(let cx=(wx-4)>>4;cx<=(wx+4)>>4;cx++){
     const neighbour=cx+','+cz;if(unknownColumns.has(neighbour)){missing.add(neighbour);uncertain=true;}
    }
    if(uncertain){incomplete=true;continue;}
   }
   for(let y=y0;y<=top;y++){
    if(touching.some(box=>inBox(wx,y,wz,box))){protectedCount++;continue;}
    const block=at(wx,y,wz);
    if(block==='minecraft:stone')continue;
    if(technical.test(block)){protectedCount++;continue;}
    if(immutable.has(block)){unbreakable++;continue;}
    const targeted=special.size&&special.has(index(wx,y,wz));
    const cells=targeted?specialPositions:cavities.has(block)?cavityPositions:positions;
    if(!targeted)oldestTargetSave=Math.min(oldestTargetSave,saved.get(key));
    cells.push([x,y-y0,z]);
   }
  }
  if(incomplete)continue;
  for(const [suffix,cells] of [['',positions],['_LUFT',cavityPositions],['_BE',specialPositions]]){
   if(!cells.length)continue;
   function write(part,tag){
    const bytes=stoneNBT(size,part);
    if(bytes.length>250*1024){
     const middle=Math.ceil(part.length/2);
     write(part.slice(0,middle),tag+'A');write(part.slice(middle),tag+'B');
    }else rows.push({tile:tile+tag+suffix,origin:[ox,y0,oz],size,blocks:part.length,bytes,oldestTargetSave,sha:createHash('sha256').update(bytes).digest('hex')});
   }
   write(cells,'');
  }
 }
 return {rows,missing:[...missing],protected:protectedCount,unbreakable};
}
