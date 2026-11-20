import {isDeepStrictEqual as same} from 'node:util';
import {parseStructure} from './nbt.js';
import {Region} from './region.js';
import {chunkBlockReader} from './terrain.js';
import {lootUrn} from './erebor-manual-urn.js';

// A lost controller receipt can be recovered from the exact published targets.
// A missing chunk cannot attest to a completed build.
export function stoneTargetsFilled(world,{bytes,anchor,size,blocks,collectUrns=false}) {
  const plan=parseStructure(bytes);
  if(!same(plan.size,size)||!blocks||plan.materials['minecraft:stone']!==blocks||
     plan.placed.length!==blocks||plan.clear.length||plan.entities||plan.blockEntities)
    throw Error('Steinziele stimmen nicht mit dem veröffentlichten Bauplan überein.');
  const regions=new Map(), chunks=new Map(),urns=[];
  for(const pos of plan.placed){
    const x=anchor[0]+pos.x,y=anchor[1]+pos.y,z=anchor[2]+pos.z;
    const cx=x>>4,cz=z>>4,key=cx+','+cz;
    if(!chunks.has(key)){
      const rx=cx>>5,rz=cz>>5,rk=rx+','+rz;
      if(!regions.has(rk))regions.set(rk,Region.open(world,rx,rz));
      const chunk=regions.get(rk)?.chunk(cx,cz);
      if(!chunk?.sections||chunk.xPos!==cx||chunk.zPos!==cz||!['full','minecraft:full'].includes(chunk.Status))throw Error('Zielchunk noch nicht gespeichert.');
      chunks.set(key,chunkBlockReader(chunk));
    }
    const material=chunks.get(key)(x,y,z);
    if(material==='minecraft:stone')continue;
    if(collectUrns&&material===lootUrn){urns.push([x,y,z]);continue;}
    return false;
  }
  return urns.length?{urns}:true;
}
