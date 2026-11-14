import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expandedPlan,interiorBasis,expandPoint,expandCorePoint} from '../src/erebor-expansion.js';
import {compileErebor,readDesignBlock} from '../src/erebor-tiles.js';
import {auditRoomSymmetry,SYMMETRIC_ROOMS,reflectState,hallColumns,tuffStripes} from '../src/erebor-symmetry.js';
const original=JSON.parse(readFileSync(new URL('./fixtures/erebor-plan.json',import.meta.url),'utf8'));
original.envelope||={};original.stoneStart||={};original.packages||=[];
const plan=expandedPlan(original),scene=compileErebor(plan);
const at=(x,y,z)=>readDesignBlock(scene,plan.worldOrigin[0]+z,plan.worldOrigin[1]+y,plan.worldOrigin[2]-1-x);

test('every freestanding hall plinth fits between both sets of tuff stripes',()=>{
 const oldHalls=new Set(['E05','E06','E07','E09','E10','E12','E19']);
 const halls=[...interiorBasis(plan).zones.filter(z=>oldHalls.has(z.id)),...plan.zones.filter(z=>/^E3[0-8]$/.test(z.id))];
 assert.equal(halls.length,16);
 for(const hall of halls){
  const layout=hallColumns(hall),radius=layout.width/2+2;
  for(const [axis,centers] of [[0,layout.xs],[2,layout.zs]]){
   const lo=hall.bounds[0][axis],hi=hall.bounds[1][axis],stripes=tuffStripes(lo,hi,layout.step);
   for(const c of centers){
    const left=stripes.filter(s=>s+2<=c).at(-1)+2,right=stripes.find(s=>s>c);
    assert.equal(c-left,right-c,hall.id);
    assert.ok(c-radius>left && c+radius<right,hall.id+' plinth over stripe');
    assert.ok(centers.includes(lo+hi-c),hall.id+' missing mirrored pillar');
   }
  }
  if(hall.id==='E07'){
   assert.equal(layout.xs.length*layout.zs.length,8);
   for(const x of layout.xs)for(const z of layout.zs){
    const a=expandPoint([x-radius,0,z-radius]),b=expandPoint([x+radius,0,z+radius]);
    // The expanded design mirrors the canonical left wing after integer scaling.
    if(x>0){a[0]=-expandPoint([-x+radius,0,z])[0];b[0]=-expandPoint([-x-radius,0,z])[0];}
    for(let i=a[0];i<b[0];i++)for(let k=a[2];k<b[2];k++){
     assert.equal(at(i,-1,k)?.name,'rechiseled:blackstone_tiles_connecting');
     assert.equal(at(i,0,k)?.name,'rechiseled:blackstone_tiles_connecting',[x,z,i,k].join('/'));
    }
   }
  }
 }
});

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

test('all four expanded stair cores have equally wide mirrored flights and four blocks headroom',()=>{
 for(const zone of interiorBasis(plan).zones.filter(z=>z.id.startsWith('S'))){
  const [[x,,z],[X,,Z]]=zone.bounds,ex=p=>expandCorePoint(zone,p),sum=ex([x,0,0])[0]+ex([X,0,0])[0],sumZ=ex([0,0,z])[2]+ex([0,0,Z])[2];
  let checked=0;
  for(let y=zone.floors[0];y<zone.floors.at(-1);y+=16)for(let i=0;i<8;i++){
   const a=ex([x+2,y+i,Z-5-i]),b=ex([x+5,y+i+1,Z-4-i]);
   const c=ex([X-5,y+8+i,z+4+i]),d=ex([X-2,y+9+i,z+5+i]);
   assert.equal(b[0]-a[0],d[0]-c[0],zone.id+' flight width');assert.equal(b[2]-a[2],d[2]-c[2],zone.id+' tread depth');
   assert.equal(c[0],sum-b[0]);assert.equal(c[2],sumZ-b[2]);
   for(const [lo,hi]of [[a,b],[c,d]])for(let xx=lo[0];xx<hi[0];xx++)for(let zz=lo[2];zz<hi[2];zz++){
    assert.match(at(xx,lo[1],zz)?.name||'',/_stairs$/,`${zone.id} ${xx}/${lo[1]}/${zz}`);
    for(let dy=1;dy<=4;dy++)assert.equal(at(xx,lo[1]+dy,zz)?.name,'minecraft:air',`${zone.id} head ${xx}/${lo[1]+dy}/${zz}`);
    checked++;
   }
  }
  assert.ok(checked>500);
 }
});
