import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeWorld} from './helpers.js';
import {parseStructure} from '../src/nbt.js';
import {exportStoneBatch} from '../src/project-stone-batch.js';
import {nearestStoneCannon,stoneBatchTiles,stoneFileName} from '../public/assets/stone-placement.js';

test('stone assignment uses all three axes, strict range, and stable non-overlapping batches',()=>{
 const plan={cannonLayout:{stations:[{id:'K01',position:[0,0,0]},{id:'K02',position:[0,200,0]}]}};
 assert.equal(nearestStoneCannon(plan,[0,190,0]).id,'K02');
 assert.equal(nearestStoneCannon(plan,[256,0,0]),null);
 const tiles=Array.from({length:35},(_,i)=>({id:'T'+i,origin:[i,0,0]}));
 const batches=[1,2,3].map(i=>stoneBatchTiles(tiles,plan,'K01',i));
 assert.deepEqual(batches.flatMap(b=>b.tiles),tiles);assert.deepEqual(batches.map(b=>b.tiles.length),[16,16,3]);
 assert.throws(()=>stoneBatchTiles(tiles,plan,'K01',4));assert.throws(()=>stoneBatchTiles(tiles,plan,'K03',1));
 assert.equal(stoneFileName('erebor',6,tiles[0],plan),'EREBOR_STEIN_K01_T0_V6.nbt');
});

test('batch ZIP contains safe stone NBT, exact coordinates and reports empty/unknown tiles',()=>{
 const dir=mkdtempSync(join(tmpdir(),'stone-batch-'));
 try{
  writeWorld(dir,[{cx:1,cz:1,blocks:[{x:17,y:5,z:17,name:'minecraft:water'},{x:18,y:5,z:17,name:'minecraft:glass'},{x:25,y:5,z:25,name:'minecraft:chest'}],blockEntities:[{x:25,y:5,z:25,id:'minecraft:chest'}]}]);
  const plan={worldOrigin:[100,88,32],rotationDegrees:90,mountainFill:{algorithm:'erebor-massif-v1',bounds:[[0,0,0],[64,128,64]],peak:[32,120,32],roofReserves:[],protectedBoxes:[{bounds:[[16,0,16],[32,1,32]]}]},cannonLayout:{stations:[{id:'K01',position:[16,16,16]}]}};
  const tiles=[{id:'filled',origin:[16,1,16],size:[16,15,16]},{id:'protected',origin:[16,0,16],size:[16,1,16]},{id:'unknown',origin:[32,1,16],size:[16,15,16]}];
  const result=exportStoneBatch(dir,{id:'erebor',version:6,plan},tiles,'K01',1);
  assert.equal(result.report.files.length,1);assert.deepEqual(result.report.files[0].origin,[16,1,16]);
  assert.deepEqual(result.report.skipped.map(s=>s.reason),['empty','unknown']);
  const entries=new Map(),zip=result.bytes;let p=0;
  while(zip.readUInt32LE(p)===0x04034b50){const size=zip.readUInt32LE(p+18),len=zip.readUInt16LE(p+26),extra=zip.readUInt16LE(p+28),start=p+30+len+extra;entries.set(zip.subarray(p+30,p+30+len).toString(),zip.subarray(start,start+size));p=start+size;}
  const file=result.report.files[0],nbt=parseStructure(entries.get(file.fileName));
  assert.equal(nbt.placed.length,file.blocks);assert.equal(nbt.clear.length,0);assert.deepEqual(nbt.materials,{'minecraft:stone':file.blocks});
  const positions=new Set(nbt.placed.map(b=>[b.x+16,b.y+1,b.z+16].join(',')));
  assert.ok(positions.has('17,5,17'));assert.ok(!positions.has('18,5,17'));assert.ok(!positions.has('25,5,25'));
  assert.equal(JSON.parse(entries.get('MANIFEST.json')).blocks,file.blocks);
  assert.ok(entries.get('KOORDINATEN.csv').toString().includes('EREBOR_STEIN_K01_filled_V6.nbt;16;1;16;K01;16;16;16;'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
