import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expandedPlan} from '../src/erebor-expansion.js';
import {compileErebor,readDesignBlock} from '../src/erebor-tiles.js';
import {ereborMesh} from '../src/erebor-mesh.js';
import {ereborViewTarget,navigationCells} from '../src/erebor-view-target.js';
import {Navigation} from '../public/viewer/navigation.js';

test('all new corridor segments resolve to bounded meshes; invalid identifiers cannot select arbitrary data',()=>{
 const plan={zones:[],interiorExpansion:{routes:[{width:14,points:[[-480,0,-816],[480,0,-816]]}]}};
 assert.deepEqual(ereborViewTarget(plan,'G1-1').bounds,[[-489,-2,-825],[490,9,-806]]);
 for(const id of ['G0-1','G1-0','G2-1','G1-2','G999999999-1','__proto__'])assert.equal(ereborViewTarget(plan,id),null);
});

test('walk collision blocks preview edges and safe entries never land on water or a hole',()=>{
 const size=[12,5,12],cells=new Int16Array(12*5*12);cells.fill(0);cells.fill(1,0,144);
 // Remove a central floor cell and add a water column. Entry must stay on a 3x3 dry floor.
 cells[5*12+8]=0;cells[6*12+8]=2;
 const n=navigationCells(cells,size,[0,87,0],[{name:'minecraft:air'},{name:'minecraft:stone'},{name:'minecraft:water'}],[88]);
 assert.equal(n.spawns.length,1);const nav={solid:{...n,bits:Buffer.from(n.bits,'base64')}};
 assert.equal(Navigation.prototype.isSolid.call(nav,-1,88,6),true);
 assert.equal(Navigation.prototype.isSolid.call(nav,8,87,6),0);
 const [x,,z]=n.spawns[0].position;for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)assert.equal(Navigation.prototype.isSolid.call(nav,x+dx,87,z+dz),1);
});

test('room block surfaces and every walking entry use the actual expanded NBT design',()=>{
 const p=JSON.parse(readFileSync(new URL('./fixtures/erebor-plan.json',import.meta.url)));p.envelope||={};p.stoneStart||={};p.packages||=[];
 const plan=expandedPlan(p),scene=compileErebor(plan);plan.interiorExpansion.routes=scene.design.routes.filter(r=>!r.expanded&&Number(r.group.slice(1))>=30);
 for(const id of ['E30','G22-1']){
  const mesh=ereborMesh(scene,plan,id,false,true);assert.ok(mesh.quads.length>0);assert.ok(mesh.navigation.spawns.length>0);
  assert.equal(mesh.navigation.bits.length,Math.ceil(Math.ceil(mesh.size.reduce((a,b)=>a*b)/8)/3)*4);
  for(const spawn of mesh.navigation.spawns){const [x,y,z]=spawn.position.map(Math.floor),floor=spawn.floor;
   assert.notEqual(readDesignBlock(scene,x,floor-1,z)?.name,'minecraft:air');
   assert.equal(readDesignBlock(scene,x,floor,z)?.name,'minecraft:air');assert.equal(readDesignBlock(scene,x,floor+1,z)?.name,'minecraft:air');
   assert.equal(y,floor+1);
  }
 }
});
