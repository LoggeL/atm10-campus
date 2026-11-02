import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {countMountainRegion,countRegionQuery} from '../src/project-stone-count.js';
import {exportMountainTile,mountainTiles} from '../src/project-stone.js';
import {writeWorld} from './helpers.js';

const plan=()=>({worldOrigin:[100,88,24],rotationDegrees:90,mountainFill:{algorithm:'erebor-massif-v1',bounds:[[16,0,16],[32,16,32]],peak:[24,14,24],roofReserves:[],protectedBoxes:[]}});
test('material count equals actual NBT export, including water and overlapping entity/area protection',()=>{
 const dir=mkdtempSync(join(tmpdir(),'stone-count-'));try{
  writeWorld(dir,[{cx:1,cz:1,blocks:[{x:21,y:1,z:21,name:'minecraft:water'},{x:22,y:1,z:21,name:'minecraft:stone'},{x:23,y:1,z:21,name:'minecraft:glass'},{x:24,y:1,z:21,name:'minecraft:lava'}],blockEntities:[{x:25,y:12,z:25,id:'mekanism:machine'}]},
   {cx:2,cz:1,blocks:[],blockEntities:[{x:32,y:1,z:20,id:'minecraft:chest'}]}]);
  const p=plan();p.mountainFill.protectedBoxes=[{bounds:[[20,4,20],[26,10,26]]},{bounds:[[23,7,23],[27,13,27]]}];
  const actual=exportMountainTile(dir,p,{origin:[16,0,16],size:[16,16,16]}),count=countMountainRegion(dir,p,[0,0]);
  assert.equal(count.remaining,actual.stats.blocks);assert.equal(count.water,actual.stats.water);assert.equal(count.water,1);
  assert.equal(count.existingSkipped,actual.stats.existingSkipped);assert.equal(count.protectedCells,actual.stats.protectedCells);
  assert.equal(count.geometryBlocks,mountainTiles(p).geometryBlocks);assert.equal(count.complete,true);assert.equal(count.stable,true);assert.equal(count.unknownCells,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('unknown saved-world cells remain separate from known required stone; negative regions and heights work',()=>{
 const dir=mkdtempSync(join(tmpdir(),'stone-count-negative-'));try{
  const p=plan();p.worldOrigin=[100,88,-16];p.mountainFill.bounds=[[-32,-8,-32],[0,8,0]];p.mountainFill.peak=[-16,7,-16];
  writeWorld(dir,[{cx:-1,cz:-1,blocks:[{x:-8,y:-4,z:-8,name:'minecraft:water'},{x:-9,y:-4,z:-8,name:'minecraft:stone'}]}]);
  renameSync(join(dir,'region/r.0.0.mca'),join(dir,'region/r.-1.-1.mca'));
  const c=countMountainRegion(dir,p,[-1,-1]);assert.equal(c.complete,false);assert.ok(c.remaining>0);assert.ok(c.unknownCells>0);assert.equal(c.water,1);assert.equal(c.existingSkipped,1);
  assert.equal(c.geometryBlocks,mountainTiles(p).geometryBlocks);assert.equal(c.remaining+c.unknownCells+c.existingSkipped+c.protectedCells,c.geometryBlocks);
  assert.equal(c.maximumRemaining,c.remaining+c.unknownCells);assert.equal(c.chunksMissing,3);
  assert.throws(()=>countRegionQuery(p,'0,0'),/außerhalb/);assert.throws(()=>countRegionQuery(p,'../x'),/rx,rz/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
