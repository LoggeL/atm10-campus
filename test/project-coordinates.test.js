import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withWorldCoordinates} from '../public/assets/project-coordinates.js';
test('expanded and new Erebor rooms display without cached worldBounds',()=>{
 const p={worldOrigin:[-964,88,466],rotationDegrees:90,zones:[{id:'E05',bounds:[[-75,-8,-294],[75,80,-24]],floors:[0,32],worldBounds:[[0,0,0],[1,1,1]]},{id:'E30',bounds:[[-664,-4,-400],[-536,48,-256]],floors:[0,24]}]};
 const normalized=withWorldCoordinates(p);
 assert.deepEqual(normalized.zones[0].worldBounds,[[-1258,80,391],[-988,168,541]]);
 assert.deepEqual(normalized.zones[1].worldBounds,[[-1364,84,1002],[-1220,136,1130]]);
 assert.deepEqual(normalized.zones[1].worldFloors,[88,112]);
 assert.equal(p.zones[1].worldBounds,undefined);assert.deepEqual(p.zones[0].worldBounds,[[0,0,0],[1,1,1]]);
});
test('rotation preserves half-open boxes and unplaced or invalid input remains validated by the caller',()=>{
 for(const rotationDegrees of [0,90,180,270]){const p=withWorldCoordinates({worldOrigin:[10,64,20],rotationDegrees,zones:[{bounds:[[0,0,0],[4,8,6]],floors:[0]}]});assert.deepEqual(p.zones[0].worldBounds[1].map((v,i)=>v-p.zones[0].worldBounds[0][i]),rotationDegrees%180?[6,8,4]:[4,8,6]);}
 const p={worldOrigin:null};assert.equal(withWorldCoordinates(p),p);
});
