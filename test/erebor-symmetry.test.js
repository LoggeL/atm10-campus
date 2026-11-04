import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expandedPlan,interiorBasis,expandPoint} from '../src/erebor-expansion.js';
import {compileErebor,readDesignBlock} from '../src/erebor-tiles.js';
import {auditRoomSymmetry,SYMMETRIC_ROOMS,reflectState} from '../src/erebor-symmetry.js';
const original=JSON.parse(readFileSync(new URL('./fixtures/erebor-plan.json',import.meta.url),'utf8'));
original.envelope||={};original.stoneStart||={};original.packages||=[];
const plan=expandedPlan(original),scene=compileErebor(plan);
const at=(x,y,z)=>readDesignBlock(scene,plan.worldOrigin[0]+z,plan.worldOrigin[1]+y,plan.worldOrigin[2]-1-x);

test('persisted expansion round-trips without scaling its source zones twice',()=>{
 const saved=JSON.parse(JSON.stringify(plan));
 assert.deepEqual(interiorBasis(saved).zones[0].bounds,original.zones.find(z=>z.id==='E05').bounds);
 assert.deepEqual(scene.design.rooms.find(z=>z.id==='E05').bounds,plan.zones.find(z=>z.id==='E05').bounds);
 const legacy=structuredClone(saved);legacy.interiorExpansion.sourceZones=legacy.interiorExpansion.sourceZones.map(s=>structuredClone(saved.zones.find(z=>z.id===s.id)));
 assert.deepEqual(interiorBasis(legacy).zones.map(z=>z.bounds),saved.interiorExpansion.sourceZones.map(z=>z.bounds));
 for(const z of saved.interiorExpansion.sourceZones)assert.deepEqual(z.bounds.map(expandPoint),saved.zones.find(s=>s.id===z.id).bounds);
});

test('all 24 architectural rooms match every mirrored block and stair state',()=>{
 const architecture={...scene.design,ops:scene.design.ops.filter(o=>o.role==='symmetric-room')};
 const rooms=plan.zones.filter(z=>SYMMETRIC_ROOMS.has(z.id));assert.equal(rooms.length,24);
 for(const z of rooms){const result=auditRoomSymmetry(architecture,z);assert.ok(result.occupied>1000,z.id+' has architecture');assert.equal(result.mismatches,0,JSON.stringify(result));}
 assert.deepEqual(reflectState({name:'minecraft:stone_brick_stairs',props:{facing:'east',shape:'inner_left',half:'bottom'}}).props,{facing:'west',shape:'inner_right',half:'bottom'});
});

test('every paired hall staircase survives all connecting routes with standing headroom',()=>{
 let cells=0;const failures=[];
 for(const c of scene.design.stairChecks)for(let x=c.a[0];x<c.b[0];x++)for(let z=c.a[2];z<c.b[2];z++){
  const y=c.a[1],label=`${c.g} ${x}/${y}/${z}`;cells++;
  if(!at(x,y,z)?.name.endsWith('_stairs'))failures.push('tread '+label+' '+at(x,y,z)?.name);
  for(let h=1;h<=3;h++)if(at(x,y+h,z)?.name!=='minecraft:air')failures.push('head '+label+' +'+h+' '+at(x,y+h,z)?.name);
 }
 assert.ok(cells>4000);assert.equal(failures.length,0,JSON.stringify(failures.slice(0,20)));
});

test('the corrected side stair and gallery in the treasure hall meet without a gap',()=>{
 for(const x of [-132,-130,129,131])for(const z of [-900,-901,-902]){
  assert.notEqual(at(x,-65,z)?.name,'minecraft:air');assert.equal(at(x,-64,z)?.name,'minecraft:air');
 }
});
