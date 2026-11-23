// Offline staging only. Not imported by queue/controller: no native release or receipt.
import {createHash} from 'node:crypto';
import {parseStructure} from './nbt.js';
import {tileNBT,TILE} from './erebor-tiles.js';
import {ereborUploadName} from './erebor-file.js';
import {zipStore} from './zip.js';

export const DEFERRED_GOLD_IDS=Object.freeze([
 'minecraft:gold_block','minecraft:raw_gold_block','rechiseled:gold_block_polished_connecting'
]);
const hash=b=>createHash('sha256').update(b).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function prepareGoldDeferral({bytes,job,version,site,slot}){
 bytes=Buffer.from(bytes);
 const originalHash=hash(bytes),d=job?.desired;
 if(!Number.isSafeInteger(version)||version<1||!/^K(?:0[1-9]|[12]\d|3[0-7])$/.test(site)||! /^[A-R]$/.test(slot))throw Error('Invalid project or slot identity');
 if(!d||!/^EREBOR_[A-Za-z0-9_-]+$/.test(d.blueprint)||d.sha256!==originalHash||d.file!==ereborUploadName(d.blueprint+'.nbt',originalHash))throw Error('Original upload/hash mismatch');
 if(!Array.isArray(d.anchor)||d.anchor.length!==3||!d.anchor.every(Number.isSafeInteger))throw Error('Invalid exact anchor');
 if(job.phase!=='build'||job.loaded!==true||job.tainted||!job.interior||job.surface||job.massif||job.selection||
    ![0,2].includes(d.options?.replace_mode)||d.options.skip_missing!==false||d.options.replace_block_entities!==false)throw Error('Unsupported or unsafe original job');
 if(job.source?.name!==d.blueprint||job.source.sha256!==originalHash||job.source.stage!=='build'||
    !same(job.source.origin,d.anchor)||!same(job.source.size,job.size))throw Error('Published source mapping mismatch');
 const parsed=parseStructure(bytes,true);
 if(parsed.entities||parsed.blockEntities||parsed.clear.length||!parsed.size.every(n=>n===TILE)||!same(job.size,parsed.size)||job.blocks!==parsed.placed.length)throw Error('Unsupported structure geometry');
 const seen=new Set();
 for(const p of parsed.placed){const key=[p.x,p.y,p.z].join(',');if(seen.has(key))throw Error('Duplicate target position');seen.add(key);}
 const gold=parsed.placed.filter(p=>DEFERRED_GOLD_IDS.includes(p.name));
 const rest=parsed.placed.filter(p=>!DEFERRED_GOLD_IDS.includes(p.name));
 if(!gold.length||!rest.length)throw Error('Both gold and non-gold targets required');
 function encode(points){
  const palette=[{name:'minecraft:structure_void'}],cells=new Uint16Array(TILE**3);
  for(const p of points){palette.push({name:p.name,props:p.properties});cells[p.x+TILE*(p.z+TILE*p.y)]=palette.length-1;}
  return tileNBT(palette,cells).bytes;
 }
 const continuation=encode(rest),deferred=encode(gold);
 const artifact=(name,data,points)=>({name,sha256:hash(data),upload:ereborUploadName(name,hash(data)),blocks:points.length});
 const targets=gold.map(p=>({local:[p.x,p.y,p.z],world:[p.x+d.anchor[0],p.y+d.anchor[1],p.z+d.anchor[2]],name:p.name,properties:p.properties??{}}));
 const manifest={schema:1,state:'prepared-only',activationAllowed:false,originalFinished:false,
  version,site,slot,original:{name:'original.nbt',sha256:originalHash,job:structuredClone(job)},
  continuation:artifact(d.blueprint+'_NON_GOLD.nbt',continuation,rest),
  deferred:{...artifact(d.blueprint+'_DEFERRED_GOLD.nbt',deferred,gold),resume:'explicit-user-request-only',targets},
  dependencies:{originalRemainsOpen:true,blockOriginalSuccessors:true,fullOriginalWorldCheckRequired:true,
   continuationPrerequisites:['fresh exact paused upload/anchor/options/progress/missing-gold proof','no flying blocks','native backup and atomic guarded replacement','exact world/protection/range check','non-gold support independent of deferred gold'],
   resumePrerequisites:['explicit user reactivation','continuation verified complete','exact original targets and properties verified in current world','normal supply only','original completion only after both partitions and full-original world check']}};
 return {manifest,zip:zipStore([{name:'original.nbt',data:bytes},{name:'continuation.nbt',data:continuation},{name:'deferred-gold.nbt',data:deferred},{name:'gold-deferral.json',data:Buffer.from(JSON.stringify(manifest,null,2))}])};
}
