import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expandedPlan,expandPoint} from '../src/erebor-expansion.js';
import {compileErebor,readDesignBlock} from '../src/erebor-tiles.js';
import {mountainTop} from '../src/project-stone.js';
const old=JSON.parse(readFileSync(new URL('./fixtures/erebor-plan.json',import.meta.url)));
old.envelope||={};old.stoneStart||={};old.packages||=[];
const plan=expandedPlan(old),scene=compileErebor(plan);
const at=(x,y,z)=>readDesignBlock(scene,plan.worldOrigin[0]+z,plan.worldOrigin[1]+y,plan.worldOrigin[2]-1-x)?.name;
const walk=(x,y,z,label)=>{const floor=at(x,y-1,z);assert.ok(floor&&floor!=='minecraft:air'&&floor!=='minecraft:structure_void','floor '+label);assert.equal(at(x,y,z),'minecraft:air','feet '+label);assert.equal(at(x,y+1,z),'minecraft:air','head '+label);};
test('rooms expand 50 percent horizontally while gate, heights, exterior and stone layout stay fixed',()=>{
 const a=plan.zones.find(z=>z.id==='E05');assert.deepEqual(a.bounds,[[-75,-8,-294],[75,80,-24]]);
 for(const id of ['E02','E03','E20','E25'])assert.deepEqual(plan.zones.find(z=>z.id===id),old.zones.find(z=>z.id===id));
 assert.deepEqual(plan.mountainFill,old.mountainFill);assert.deepEqual(plan.cannonLayout,old.cannonLayout);
 assert.equal(plan.zones.filter(z=>/^E3[0-8]$/.test(z.id)).length,9);
});
test('new corridors and inherited routes remain walkable after all intersections',()=>{
 for(const r0 of scene.design.routes){const r=r0.sourceRoute||r0;
  for(let k=1;k<r.points.length;k++){const a=r.points[k-1],b=r.points[k],n=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[2]-a[2]));
   for(let i=0;i<=n;i++){const t=i/Math.max(1,n),rise=Math.max(0,Math.min(1,(i-Math.floor(r.width/2))/Math.max(1,n-r.width)));let q=[Math.round(a[0]+(b[0]-a[0])*t),Math.round(a[1]+(b[1]-a[1])*rise),Math.round(a[2]+(b[2]-a[2])*t)];if(r0.expanded)q=expandPoint(q);walk(...q,r.group+' '+q.join('/'));}
  }
 }
});
test('nine new halls have usable entrances, stair flights and upper-room doors',()=>{
 for(const zone of plan.zones.filter(z=>/^E3[0-8]$/.test(z.id))){const [[x,,z],[X,,Z]]=zone.bounds;
  for(let i=0;i<24;i++){assert.match(at(x+10,i,Z-9-i),/stairs$/);for(let h=1;h<=3;h++)assert.equal(at(x+10,i+h,Z-9-i),'minecraft:air',zone.id+' stair');}
  const offsets=X-x===128?[19,49,79,109]:X-x===160?[20,60,100,140]:[19,81,143,205];
  for(const offset of offsets){const xx=x+offset;walk(xx,24,z+27,zone.id+' room door');walk(xx,24,z+29,zone.id+' gallery');}
  for(let i=0;i<24;i++){assert.match(at(X-11,i,Z-9-i),/stairs$/);for(let h=1;h<=3;h++)assert.equal(at(X-11,i+h,Z-9-i),'minecraft:air',zone.id+' paired stair');}
 }
});
test('the expanded envelopes stay within the existing mountain silhouette',()=>{
 assert.ok(plan.mountainFill);
 for(const zone of plan.zones.filter(z=>/^E3[0-8]$/.test(z.id)||plan.interiorExpansion.sourceZones.some(s=>s.id===z.id))){const [a,b]=zone.bounds;
  for(let x=a[0];x<b[0];x+=4)for(let z=a[2];z<b[2];z+=4){const top=mountainTop(plan,plan.worldOrigin[0]+z,plan.worldOrigin[2]-x);assert.ok(top!==null&&top>=plan.worldOrigin[1]+b[1]+7,zone.id+' roof '+[x,z,top]);}
 }
});
