import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileErebor,paintTile,tileNBT,readDesignBlock,worldBox,rotateState} from '../src/erebor-tiles.js';
import {parseStructure,parseTyped,decodeMaybeCompressed} from '../src/nbt.js';
import {architectureBlueprints,filterPreparedBlueprints} from '../public/assets/project-blueprints.js';
const plan=JSON.parse(readFileSync(new URL('./fixtures/erebor-plan.json',import.meta.url))),scene=compileErebor(plan);
const local=(x,y,z)=>readDesignBlock(scene,plan.worldOrigin[0]+z,plan.worldOrigin[1]+y,plan.worldOrigin[2]-1-x)?.name;

test('Erebor has unique tile ownership, every architectural zone and bounded upload files',()=>{
 const all=scene.packages.flatMap(p=>p.tiles);assert.equal(all.length,new Set(all.map(t=>t.id)).size);assert.equal(all.length,scene.tiles.size);
 const groups=new Set(scene.packages.map(p=>p.group));for(const z of plan.zones)assert.ok(groups.has(z.id),'missing '+z.id);assert.ok(!groups.has('PROTECTED'));
 assert.deepEqual(worldBox(plan,[-120,-8,-24],[120,128,0]),[[-988,80,346],[-964,216,586]]);
 assert.equal(rotateState({name:'minecraft:stone_brick_stairs',props:{facing:'north',half:'bottom'}}).props.facing,'west');
 const t=all.find(t=>t.group==='E02'),cells=paintTile(scene,t),nbt=tileNBT(scene.palette,cells),parsed=parseStructure(nbt.bytes);
 assert.ok(nbt.bytes.length<250*1024);assert.equal(parsed.clear.length,0);assert.equal(parsed.placed.length,nbt.placed);
 const typed=parseTyped(decodeMaybeCompressed(nbt.bytes)).root;assert.equal(typed.v.blocks.v.items.length,32**3,'non-target cells must explicitly be structure_void');
 const airTile=all.find(t=>t.group==='E05'&&t.origin[1]===96),clear=parseStructure(tileNBT(scene.palette,paintTile(scene,airTile),'clear').bytes);assert.equal(clear.placed.length,0);assert.ok(clear.clear.length>0);
});
test('main gate is level at Y88, connected to the first hall, and keeps a 30 by 48 opening',()=>{
 for(let z=-32;z<=0;z++)for(const x of [-14,0,14]){assert.notEqual(local(x,-1,z),'minecraft:air');for(const y of [0,1,4,20,47])assert.equal(local(x,y,z),'minecraft:air',`${x}/${y}/${z}`);}
 for(let z=-200;z<=-30;z++)for(const y of [0,1,2])assert.equal(local(0,y,z),'minecraft:air',`entry ${z}/${y}`);
 assert.equal(local(35,23,-8),'minecraft:red_concrete','accepted gauntlet cells survive the facade');
});
test('route endpoints have floors and headroom; protected village and waystone remain untouched',()=>{
 for(const r of scene.design.routes)for(const [x,y,z]of r.points){assert.ok(local(x,y-1,z)&&local(x,y-1,z)!=='minecraft:air',`floor ${r.group} ${x}/${y}/${z}`);for(const h of [0,1])assert.equal(local(x,y+h,z),'minecraft:air',`route ${r.group} ${x}/${y+h}/${z}`);}
 for(const q of plan.site.protectedAreas.filter(q=>q.id!=='P-SEE')){const [a,b]=q.bounds;for(let x=a[0];x<b[0];x+=8)for(let z=a[2];z<b[2];z+=8){const n=readDesignBlock(scene,x,90,z)?.name;assert.ok(!n||n==='minecraft:structure_void',`protection ${q.id}`);}}
});
test('every stair flight has four blocks headroom and a reachable landing',()=>{
 for(const zone of plan.zones.filter(z=>z.id.startsWith('S'))){const [[x,,z],[X,,Z]]=zone.bounds;for(let y=zone.floors[0];y<zone.floors.at(-1);y+=16){for(let i=0;i<8;i++){for(let dy=1;dy<=4;dy++){assert.equal(local(x+3,y+i+dy,Z-5-i),'minecraft:air',zone.id+' first flight');assert.equal(local(X-4,y+8+i+dy,z+4+i),'minecraft:air',zone.id+' return flight');}}assert.equal(local(x+6,y+8,z+2),'minecraft:air');assert.notEqual(local(x+6,y+7,z+2),'minecraft:air');}}
});
test('roads and tunnels remain continuous through intersections and elevation changes',()=>{
 for(const r of scene.design.routes)for(let k=1;k<r.points.length;k++){
  const a=r.points[k-1],b=r.points[k],n=Math.max(Math.abs(b[0]-a[0]),Math.abs(b[2]-a[2]));
  for(let i=0;i<=n;i++){const t=i/Math.max(1,n),x=Math.round(a[0]+(b[0]-a[0])*t),z=Math.round(a[2]+(b[2]-a[2])*t),rise=Math.max(0,Math.min(1,(i-Math.floor(r.width/2))/Math.max(1,n-r.width))),y=Math.round(a[1]+(b[1]-a[1])*rise),label=`${r.group} ${x}/${y}/${z}`;
   assert.ok(local(x,y-1,z)&&local(x,y-1,z)!=='minecraft:air','floor '+label);assert.equal(local(x,y,z),'minecraft:air','feet '+label);assert.equal(local(x,y+1,z),'minecraft:air','head '+label);
  }
 }
});
test('architecture listing retains exact anchors and separates excavation from build',()=>{
 const f={id:'EREBOR_E02_BAU_K19_X-992_Y64_Z448_R1',fileName:'x.nbt',kind:'build',origin:[-992,64,448],cannon:'K19',cannonPosition:[-1152,96,448],blocks:12};
 const items=architectureBlueprints({id:'erebor'},[{id:'E02_001',group:'E02',title:'Großes Tor',version:6,revision:1,files:[f],sourceRegions:[]}]);
 assert.deepEqual(items[0].origin,f.origin);assert.equal(filterPreparedBlueprints(items,'Tor','architecture:E02').length,1);assert.match(items[0].download,/architecture\/E02_001\/EREBOR_.*\.nbt\?version=6&revision=1$/);
});
