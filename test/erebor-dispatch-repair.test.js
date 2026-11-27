import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tileNBT} from '../src/erebor-tiles.js';
import {parseStructure} from '../src/nbt.js';
import {storedZipEntry} from '../src/zip.js';
import {dispatchRepair,gateSnowEligible,replacementParents} from '../src/erebor-dispatch-repair.js';
import {interiorWorldCheck} from '../src/erebor-interior.js';
import {Region} from '../src/region.js';
function source(id,cells){
  const [,group,type,cannon,x,y,z]=id.match(/^EREBOR_(E\d+)_(BAU|AUSHUB)_(K\d+)_X(-?\d+)_Y(-?\d+)_Z(-?\d+)_R5$/);
  const kind=type==='BAU'?'build':'clear';
  const {bytes,air,placed,materials}=tileNBT([{name:'minecraft:air'},{name:'minecraft:stone_bricks'}],cells,kind);
  return {bytes,f:{id,group,cannon,kind,origin:[x,y,z].map(Number),sha256:createHash('sha256').update(bytes).digest('hex'),
    fileName:id+'.nbt',size:[32,32,32],blocks:kind==='clear'?air:placed,materials,clearOmitted:0,unknownCells:0}};
}
test('K10 replacement removes only the reviewed cells and keeps its original anchor',()=>{
  const cells=new Int16Array(32768).fill(-1);
  // Exactly 18 original cells in the four-block bloom clearance; use distant layers for the rest.
  let n=0;
  for(let y=18;y<=26&&n<18;y++)for(let z=0;z<=1&&n<18;z++)for(let x=0;x<=1&&n<18;x++){cells[y*1024+z*32+x]=0;n++;}
  for(let i=0;n<7656;i++,n++)cells[i]=0;
  const s=source(replacementParents('E38_903')[0],cells);
  const {report,bytes}=dispatchRepair('E38_903',[s],[-924,79,-10402]);
  const target=report.files[0],clear=parseStructure(storedZipEntry(bytes,target.fileName)).clear;
  assert.deepEqual(target.origin,s.f.origin);assert.equal(clear.length,7638*3);
  for(let i=0;i<clear.length;i+=3)assert.equal(cells[clear[i]+32*clear[i+2]+1024*clear[i+1]],0);
  assert.throws(()=>dispatchRepair('E38_903',[{...s,f:{...s.f,blocks:1}}],[-924,79,-10402]));
});
test('K22 receives all six related E36 files with exactly the published payloads',()=>{
  const sources=replacementParents('E36_903').map(id=>{const c=new Int16Array(32768).fill(-1);c[990]=id.includes('_BAU_')?1:0;return source(id,c);});
  const {report,bytes}=dispatchRepair('E36_903',sources,[-732,96,-9858]);
  for(const [i,f] of report.files.entries()){assert.equal(f.cannon,'K22');assert.deepEqual(storedZipEntry(bytes,f.fileName),sources[i].bytes);}
  assert.throws(()=>dispatchRepair('E36_903',sources,[0,0,0]));
});
test('snow exception is limited to the six published gate files, permits placement only',t=>{
  const entry={group:'E03',stage:'build',name:'EREBOR_E03_BAU_K37_X448_Y64_Z-10048_R5'};
  assert.ok(gateSnowEligible(12,entry));assert.equal(gateSnowEligible(13,entry),false);
  assert.equal(gateSnowEligible(12,{...entry,name:entry.name.replace('448','449')}),false);
  const cells=new Int16Array(32768).fill(-1);cells[0]=1;
  const {bytes}=tileNBT([{name:'minecraft:air'},{name:'minecraft:stone_bricks'}],cells,'build');
  let block='minecraft:snow',entities=[];
  t.mock.method(Region,'open',()=>({chunk:(x,z)=>({xPos:x,zPos:z,Status:'minecraft:full',sections:[{Y:0,block_states:{palette:[{Name:block}]}}],block_entities:entities})}));
  const args={bytes,anchor:[0,0,0],kind:'build',outdoor:true};
  assert.equal(interiorWorldCheck('.',args),false);
  assert.ok(interiorWorldCheck('.',{...args,gateSnow:true}));
  block='minecraft:snow_block';assert.ok(interiorWorldCheck('.',{...args,gateSnow:true}));
  assert.equal(interiorWorldCheck('.',{...args,gateSnow:true,completed:true}),false);
  entities=[{x:1,y:1,z:1}];assert.equal(interiorWorldCheck('.',{...args,gateSnow:true}),false);
});
