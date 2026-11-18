import test from 'node:test';
import assert from 'node:assert/strict';
import {massifWorkload} from '../src/erebor-bauzaehler.js';

test('published unfinished Massiv stone blocks include reservations, exclude done, separate manual targets',()=>{
 const tiles=[{blocks:100,done:0,special:0,home:'K01',site:null,tile:'SOLID'},
 {blocks:40,done:0,special:0,home:'K02',site:'K01',tile:'CAVITY_LUFT'},
 {blocks:9,done:0,special:1,home:'K01',site:null,tile:'TARGET_BE'},
 {blocks:999,done:1,special:0,home:'K01'},
 {blocks:3,done:0,special:0,home:null,site:null}];
 assert.deepEqual(massifWorkload(tiles),{grossBlocks:143,assignedBlocks:40,manualBlocks:9});
 assert.deepEqual(massifWorkload(tiles,'K01'),{grossBlocks:140,assignedBlocks:40,manualBlocks:9});
 assert.equal(massifWorkload(tiles,'K02').grossBlocks,0);
 const assigned=tiles.map(t=>t.tile==='SOLID'?{...t,site:'K01'}:t);
 assert.equal(massifWorkload(assigned).grossBlocks,143);
 assigned[0].done=1;assert.equal(massifWorkload(assigned).grossBlocks,43);
 assert.deepEqual(massifWorkload([]),{grossBlocks:0,assignedBlocks:0,manualBlocks:0});
 assert.equal(massifWorkload(null),null);
});
