import {createHash} from 'node:crypto';
import {parseStructure} from './nbt.js';
import {tileNBT} from './erebor-tiles.js';
import {zipStore} from './zip.js';
import {inRange} from './erebor-interior.js';

// These corrections refer to the published R5 plans at the version 12 site.
const archive = {
  E38_903: ['EREBOR_E38_AUSHUB_K10_X-1024_Y64_Z-10304_R5'],
  E36_903: [64,96,128].flatMap(y=>['AUSHUB','BAU'].map(kind=>
    `EREBOR_E36_${kind}_K15_X-960_Y${y}_Z-9824_R5`))
};
export const replacementParents = id => archive[id] ?? [];
export const replacementFor = name => Object.keys(archive).find(id=>archive[id].includes(name));
export function gateTerrainEligible(version, entry) {
  return version===12 && entry.group==='E03' && entry.stage==='build' &&
    /^EREBOR_E03_BAU_K37_X(?:448|480)_Y(?:64_Z-10048|96_Z-(?:10048|10016))_R5$/.test(entry.name);
}

const digest = b=>createHash('sha256').update(b).digest('hex');
const protectedBlooms = [[-1027,86,-10307],[-1028,86,-10305]];
export function dispatchRepair(id,sources,destination) {
  const parents=replacementParents(id);
  if(!parents.length||sources.length!==parents.length||new Set(sources.map(s=>s.f.id)).size!==parents.length)
    throw Error('Originalpläne unvollständig.');
  const files=[],entries=[],materials={};
  for(const {f,bytes} of sources){
    const m=f.id.match(/^EREBOR_(E36|E38)_(BAU|AUSHUB)_(K15|K10)_X(-?\d+)_Y(-?\d+)_Z(-?\d+)_R5$/);
    if(!m||!parents.includes(f.id)||f.fileName!==f.id+'.nbt'||digest(bytes)!==f.sha256||
      f.group!==m[1]||f.cannon!==m[3]||f.kind!==(m[2]==='BAU'?'build':'clear')||
      String(f.origin)!==m.slice(4).map(Number).join(',')||String(f.size)!=='32,32,32'||f.clearOmitted!==0||f.unknownCells!==0)
      throw Error('Quelle oder Prüfsumme stimmt nicht: '+f.id);
    const plan=parseStructure(bytes);
    if(plan.entities||plan.blockEntities||String(plan.size)!=='32,32,32'||
       (f.kind==='clear'?plan.placed.length!==0||plan.clear.length!==3*f.blocks:plan.clear.length!==0||plan.placed.length!==f.blocks))
      throw Error('NBT-Inhalt weicht von der Veröffentlichung ab.');
    let result=Buffer.from(bytes),removed=0;
    const site=id==='E36_903'?'K22':'K10';
    if(id==='E38_903'){
      const cells=new Int16Array(32**3).fill(-1);
      for(let j=0;j<plan.clear.length;j+=3){
        const [x,y,z]=plan.clear.slice(j,j+3),pos=[x+f.origin[0],y+f.origin[1],z+f.origin[2]];
        if(protectedBlooms.some(b=>pos.every((v,i)=>Math.abs(v-b[i])<=4))){removed++;continue;}
        cells[x+32*z+1024*y]=0;
      }
      const trimmed=tileNBT([{name:'minecraft:air'}],cells,'clear');
      if(f.blocks!==7656||removed!==18||trimmed.air!==f.blocks-removed)throw Error('Schutzmaske hat sich geändert.');
      result=trimmed.bytes;
    }
    if(!destination||!inRange(f.origin,f.size,destination))throw Error('Zielstation außer Reichweite.');
    const name=f.id.replace('_'+f.cannon+'_','_'+site+'_').replace(/_R5$/,'_R6');
    const file={...f,id:name,fileName:name+'.nbt',title:f.title?.replaceAll(f.cannon,site)??name,cannon:site,
      cannonPosition:destination,blocks:f.blocks-removed,protectedCells:(f.protectedCells||0)+removed,
      sha256:digest(result),bytes:result.length};
    for(const [block,n] of Object.entries(file.materials||{}))materials[block]=(materials[block]||0)+n;
    files.push(file);entries.push({name:file.fileName,data:result});
  }
  const total=kind=>files.filter(f=>f.kind===kind).reduce((n,f)=>n+f.blocks,0);
  const report={id,version:12,revision:5,project:'erebor',group:files[0].group,
    title:id==='E38_903'?'K10 · Aushub mit Schutzabstand':'K22 · Bauabschnitte aus K15',
    files,supersedes:parents,sourceHashes:sources.map(s=>s.f.sha256),blocks:total('build'),clearBlocks:total('clear'),
    protectedCells:files.reduce((n,f)=>n+f.protectedCells,0),unknownCells:0,materials,sourceRegions:[],skipped:[],
    capturedAt:new Date().toISOString(),worldPlacement:false,notes:['Die automatische Vergabe prüft jede Zieldatei gegen den gespeicherten Weltstand.']};
  entries.push({name:'BAUPLAENE.json',data:Buffer.from(JSON.stringify(report,null,2))});
  return {bytes:zipStore(entries),report};
}
