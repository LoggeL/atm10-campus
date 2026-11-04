import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mountainTiles,mountainTop,stoneNBT,exportMountainTile} from '../src/project-stone.js';
import {parseStructure} from '../src/nbt.js';
import {validPlacement,worldPoint} from '../src/project-placement.js';
import {writeWorld} from './helpers.js';
import {buildServer} from '../src/server.js';

const plan=()=>({title:'Erebor Test',summary:'Standort und Stein',status:'planning',worldOrigin:[100,88,32],rotationDegrees:90,site:{status:'planned'},mountainFill:{algorithm:'erebor-massif-v1',bounds:[[0,0,0],[64,128,64]],peak:[32,120,32],roofReserves:[],protectedBoxes:[]}});
test('coastal forecourt is supported under the full symmetric terrace and stays open above it',()=>{
 const p=plan();p.worldOrigin=[1500,88,1000];p.mountainFill={...p.mountainFill,bounds:[[0,-40,0],[2000,313,2000]],peak:[1000,312,1000],entranceFill:true};
 for(let d=0;d<108;d++){
  const half=d<36?68:24,expected=87+(d<36?0:Math.min(24,1+Math.floor((d-36)/3)));
  for(let x=-half;x<half;x++)assert.equal(mountainTop(p,1500+d,1000-x),expected);
  assert.equal(mountainTop(p,1500+d,1000-half),null,'outside terrace remains open');
 }
 assert.equal(mountainTop(p,1608,1000),null);
});
test('planned placement is explicit; rotation changes points without changing world state',()=>{
 assert.equal(validPlacement({worldOrigin:null}),true);assert.equal(validPlacement({worldOrigin:[0,64,0]}),false);assert.equal(validPlacement(plan()),true);assert.deepEqual(worldPoint(plan(),[10,5,-20]),[80,93,22]);
});
test('mountain tiling covers the exact target volume once and NBT stays below upload limit',()=>{
 const p=plan(),m=mountainTiles(p);let count=0;for(let z=0;z<64;z++)for(let x=0;x<64;x++){const h=mountainTop(p,x,z);if(h!==null)count+=h+1;}
 assert.equal(count,m.geometryBlocks);assert.equal(m.tiles.reduce((n,t)=>n+t.geometryBlocks,0),count);assert.equal(new Set(m.tiles.map(t=>t.origin.join())).size,m.tiles.length);
 const cells=[];for(let y=0;y<16;y++)for(let z=0;z<64;z++)for(let x=0;x<64;x++)cells.push([x,y,z]);
 const bytes=stoneNBT([64,16,64],cells);assert.ok(bytes.length<250*1024);const nbt=parseStructure(bytes);assert.equal(nbt.placed.length,65536);assert.equal(nbt.clear.length,0);assert.deepEqual(nbt.materials,{'minecraft:stone':65536});
});
test('stone export fills air/water only, preserves blocks and protected work space, rejects unknown chunks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-stone-'));try{
  writeWorld(dir,[{cx:1,cz:1,blocks:[{x:17,y:5,z:17,name:'minecraft:water'},{x:18,y:5,z:17,name:'minecraft:glass'},{x:19,y:5,z:17,name:'minecraft:lava'},{x:25,y:5,z:25,name:'mekanism:steel_casing'}],blockEntities:[{x:25,y:5,z:25,id:'mekanism:machine'}]}]);
  const p=plan();p.mountainFill.protectedBoxes=[{bounds:[[16,0,16],[17,16,32]]}];
  const tile={origin:[16,0,16],size:[16,16,16]},out=exportMountainTile(dir,p,tile),n=parseStructure(out.bytes),coords=new Set(n.placed.map(b=>[b.x,b.y,b.z].join(',')));
  assert.equal(out.stats.water,1);assert.ok(coords.has('1,5,1'));assert.ok(!coords.has('2,5,1'));assert.ok(!coords.has('3,5,1'));assert.ok(!coords.has('0,5,1'));assert.ok(!coords.has('8,5,9'));assert.equal(n.clear.length,0);
  assert.throws(()=>exportMountainTile(dir,p,{origin:[32,0,16],size:[16,16,16]}),/nicht gespeicherten Chunks/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('project exports require authentication and exact plan version; save remains dryRun/versioned',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-stone-api-'));const app=await buildServer({dataDir:join(dir,'db'),worldSources:{live:join(dir,'world')},snapshotIntervalMin:0,maxUploadBytes:1024*1024,publicUrl:'http://test',bootstrapInvite:'stone-test-bootstrap',cookieSecure:false});
 try{
  assert.equal((await app.inject('/api/projects/erebor/stone/manifest?version=1')).statusCode,401);
  const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'stone-test-bootstrap',username:'planner',password:'stone-test-password'}});const headers={cookie:'campus_session='+reg.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const p=plan();p.cannonLayout={stations:[{id:'K01',position:[32,64,32]}]};let r=await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,dryRun:true,plan:p}});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().worldPlacement,false);
  assert.equal((await app.inject({url:'/api/projects/erebor',headers})).statusCode,404);
  r=await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan:p}});assert.equal(r.statusCode,200,r.body);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/manifest?version=0',headers})).statusCode,409);
  r=await app.inject({url:'/api/projects/erebor/stone/manifest?version=1',headers});assert.equal(r.statusCode,200,r.body);assert.ok(r.json().tiles.length);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/missing.nbt?version=1',headers})).statusCode,404);
  assert.match(r.json().tiles[0].fileName,/^EREBOR_STEIN_K01_/);
  assert.equal((await app.inject('/api/projects/erebor/stone/batch.zip?version=1&cannon=K01&part=1')).statusCode,401);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/batch.zip?version=0&cannon=K01&part=1',headers})).statusCode,409);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/batch.zip?version=1&cannon=K99&part=1',headers})).statusCode,400);
  const batch=await app.inject({url:'/api/projects/erebor/stone/batch.zip?version=1&cannon=K01&part=1',headers});assert.equal(batch.statusCode,200,batch.body);assert.equal(batch.headers['x-campus-schematic-count'],'0');assert.ok(Number(batch.headers['x-campus-unknown-tiles'])>0);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/count?version=1&region=0,0'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/count?version=0&region=0,0',headers})).statusCode,409);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/count?version=1&region=100,100',headers})).statusCode,400);
  r=await app.inject({url:'/api/projects/erebor/stone/count?version=1&region=0,0',headers});assert.equal(r.statusCode,200,r.body);assert.equal(r.json().remaining,0);assert.ok(r.json().unknownCells>0);
  assert.deepEqual(app.campus.listBlueprints(),[]);assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM cannons').get().n,0);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
