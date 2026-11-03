import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { projectScene } from '../src/project-viewer.js';
import { columnGeometry } from '../public/viewer/project-geometry.js';
import { structureNbt } from './helpers.js';

const plan = {
  title:'Erebor',summary:'Planung',status:'planning',worldOrigin:[-964,88,466],rotationDegrees:90,site:{status:'planned'},
  zones:[{id:'gate',title:'Tor',bounds:[[-120,-8,-24],[120,128,0]],floors:[0],features:['Tor nach Osten']}],
};

test('planning coordinates transform at all four rotations, local plans stay local',()=>{
  const expected=[
    [[-1084,80,442],[-844,216,466]],
    [[-988,80,346],[-964,216,586]],
    [[-1084,80,466],[-844,216,490]],
    [[-964,80,346],[-940,216,586]],
  ];
  for(const [i,rotationDegrees] of [0,90,180,270].entries()) {
    const scene=projectScene({id:'erebor',version:6,plan:{...plan,rotationDegrees}});
    assert.deepEqual(scene.zones[0].bounds,expected[i]);
    assert.deepEqual(scene.zones[0].floors,[88]);
  }
  const local=projectScene({id:'draft',version:1,plan:{...plan,worldOrigin:null,rotationDegrees:0}});
  assert.equal(local.placed,false);assert.deepEqual(local.zones[0].bounds,plan.zones[0].bounds);
  assert.throws(()=>projectScene({plan:{...plan,zones:[]}}),/keine räumliche Planung/);
});

test('mountain scene stays bounded and excludes protected columns',()=>{
  const p={...plan,mountainFill:{algorithm:'erebor-massif-v1',bounds:[[-1200,-40,200],[-900,313,700]],peak:[-1100,312,450],roofReserves:[],protectedBoxes:[{bounds:[[-1120,-64,400],[-1080,320,480]]}]}};
  const scene=projectScene({id:'erebor',version:6,plan:p});
  assert.equal(scene.mountain.step,16);
  assert.ok(scene.mountain.columns.length<1000);
  assert.ok(scene.mountain.columns.length>0);
  for(const [x,y,z,w,h,d] of scene.mountain.columns) {
    assert.ok(h>0&&y+h<=313);
    assert.ok(x+w<=-1120||x>=-1080||z+d<=400||z>=480,'protected footprint remains empty');
  }
});

test('column surface removes interior faces and retains exposed height changes',()=>{
  const one=columnGeometry([[0,0,0,16,10,16]]);
  assert.equal(one.attributes.position.count,36);
  const two=columnGeometry([[0,0,0,16,10,16],[16,0,0,16,10,16]]);
  assert.equal(two.attributes.position.count,60);
  const stepped=columnGeometry([[0,0,0,16,10,16],[16,0,0,16,20,16]]);
  assert.equal(stepped.attributes.position.count,66);
  assert.ok([...stepped.attributes.normal.array].every(Number.isFinite));
  one.dispose();two.dispose();stepped.dispose();
});

test('viewer serves isolated project scenes and filters both scene and binary without world changes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'campus-viewer-'));
  const app=await buildServer({dataDir:dir,worldSources:{},snapshotIntervalMin:0,maxUploadBytes:1024*1024,publicUrl:'http://test',bootstrapInvite:'viewer-test',cookieSecure:false});
  try {
    assert.equal((await app.inject('/api/viewer/scene?project=erebor')).statusCode,401);
    const registration=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'viewer-test',username:'tester',password:'viewer-test-password'}});
    const headers={cookie:'campus_session='+registration.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
    const request=(method,url,payload)=>app.inject({method,url,payload,headers});
    const nbtBase64=structureNbt([1,1,1],[{pos:[0,0,0],name:'minecraft:stone'}]).toString('base64');
    for(const fileName of ['one.nbt','two.nbt'])assert.equal((await request('POST','/api/blueprints',{fileName,origin:[0,64,0],nbtBase64})).statusCode,200);
    const before=(await request('GET','/api/blueprints')).json(),id=before[0].id;
    const collection={title:'Campus',summary:'Base',status:'existing',kind:'blueprint_collection',worldOrigin:null,blueprintIds:[id]};
    for(const [key,p] of [['campus',collection],['erebor',plan]])assert.equal((await request('PUT','/api/projects/'+key,{baseVersion:0,plan:p})).statusCode,200);
    const planning=(await request('GET','/api/viewer/scene?project=erebor')).json();
    assert.equal(planning.project.id,'erebor');assert.equal(planning.projects.length,2);
    assert.equal(planning.snapshot,null);assert.equal(planning.context,null);assert.deepEqual(planning.blueprints,[]);
    assert.deepEqual(planning.planning.zones[0].bounds,[[-988,80,346],[-964,216,586]]);
    assert.equal(planning.blueprintsUrl,undefined,'no giant NBT or Campus snapshot fetch for planning');
    const selected=(await request('GET','/api/viewer/scene?project=campus')).json();
    assert.deepEqual(selected.blueprints.map(b=>b.id),[id]);assert.match(selected.blueprintsUrl,/project=campus/);
    const binary=async url=>{const r=await request('GET',url),b=r.rawPayload;return {etag:r.headers.etag,header:JSON.parse(b.subarray(4,4+b.readUInt32LE(0)))};};
    const subset=await binary(selected.blueprintsUrl),all=await binary('/api/viewer/blueprints.bin?snapshot=none');
    assert.deepEqual(subset.header.blueprints.map(b=>b.id),[id]);assert.equal(all.header.blueprints.length,2);assert.notEqual(subset.etag,all.etag);
    const empty=await binary('/api/viewer/blueprints.bin?project=erebor');assert.equal(empty.header.blueprints.length,0);
    assert.equal((await request('GET','/api/viewer/scene?project=missing')).statusCode,404);
    assert.equal((await request('GET','/api/viewer/blueprints.bin?project=missing')).statusCode,404);
    assert.equal((await request('GET','/api/viewer/scene')).json().blueprints.length,2,'legacy viewer remains available');
    assert.deepEqual((await request('GET','/api/blueprints')).json(),before);
    assert.equal(app.campus.db.prepare('SELECT count(*) n FROM cannons').get().n,0);
    assert.equal(app.campus.listSnapshots().length,0);
  } finally {await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
