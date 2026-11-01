import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';

test('alignment routes require browser admin, CSRF and same origin; unbound defaults stay disabled', async () => {
  const tmp=mkdtempSync(join(tmpdir(),'alignment-'));
  const app=await buildServer({dataDir:tmp,worldSources:{},contextOrigin:[0,0,0],contextSize:[1,1,1],publicUrl:'http://test',cookieSecure:false,bootstrapInvite:'alignment-bootstrap',maxUploadBytes:1024});
  try {
    assert.equal((await app.inject({method:'GET',url:'/api/cannons/one/alignment'})).statusCode,401);
    const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'alignment-bootstrap',username:'admin',password:'test-password-long'}});
    const cookie=reg.headers['set-cookie'].split(';')[0];
    const headers={cookie,'x-campus-csrf':'1',origin:'http://test'};
    await app.inject({method:'PUT',url:'/api/cannons/one',headers,payload:{}});
    const r=await app.inject({method:'GET',url:'/api/cannons/one/alignment',headers});
    assert.equal(r.statusCode,200,r.body); assert.equal(r.json().state,'disabled');
    for (const h of [{cookie},{...headers,origin:'https://evil.test'}]) {
      const r=await app.inject({method:'POST',url:'/api/cannons/one/alignment/probe',headers:h,payload:{binding:{}}});
      assert.equal(r.statusCode,403,r.body);
    }
    const tok=(await app.inject({method:'POST',url:'/api/tokens',headers,payload:{name:'admin-token',scope:'write'}})).json().token;
    assert.equal((await app.inject({method:'POST',url:'/api/cannons/one/alignment/probe',headers:{authorization:'Bearer '+tok},payload:{binding:{}}})).statusCode,403);
  } finally { await app.close();app.campus.db.close();rmSync(tmp,{recursive:true,force:true}); }
});

test('only fresh exact selected revision and applied receipt release supply; cached running printer checked', async () => {
  const m=await import('../src/alignment.js');
  assert.equal(typeof m.verifyAlignment,'function','trusted matcher missing');
  const desired={file:'one.nbt',sha256:'a'.repeat(64),owner:'Owner',anchor:[1,64,3],rotation:'none',mirror:'none',blueprint:'one',version:2,assignment:7};
  const observed={at:Date.now()/1000,state:'STOPPED',amountPlaced:0,printer:{},item:'create:schematic',fileHash:desired.sha256,components:{'create:schematic_file':'one.nbt','create:schematic_owner':'Owner','create:schematic_anchor':[1,64,3],'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}};
  assert.equal(m.verifyAlignment(desired,observed,desired),null);
  for(const change of [{at:0},{fileHash:'b'.repeat(64)},{components:{...observed.components,'create:schematic_owner':'Fake'}},{state:'RUNNING',printer:{Anchor:[9,9,9]}},{state:'RUNNING',printer:{}},{state:'UNKNOWN'}]) assert.ok(m.verifyAlignment(desired,{...observed,...change},desired));
  assert.ok(m.verifyAlignment(desired,observed,null));
  assert.ok(m.verifyAlignment(desired,observed,{...desired,version:1}));
  assert.ok(m.verifyAlignment(desired,observed,{...desired,assignment:6}));
  assert.equal(m.verifyAlignment(desired,{...observed,state:'RUNNING',printer:{Anchor:desired.anchor}},desired),null);
});

test('explicit admin binding enables fail-closed plans, selection queues safe apply, failed bridge revokes release',async()=>{
  const {structureNbt}=await import('./helpers.js');
  const tmp=mkdtempSync(join(tmpdir(),'alignment-flow-'));let desired=null,offline=false,mode='inspect';const calls=[];
  const binding={dimension:'minecraft:overworld',x:94,y:64,z:21,owner:'Owner'};
  const observed=()=>({at:Date.now()/1000,state:'STOPPED',amountPlaced:0,amountToPlace:0,printer:{},item:'create:schematic',fileHash:desired?.sha256,components:desired?{'create:schematic_file':desired.file,'create:schematic_owner':'Owner','create:schematic_anchor':desired.anchor,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}:{}});
  const app=await buildServer({dataDir:tmp,worldSources:{},contextOrigin:[0,0,0],contextSize:[1,1,1],publicUrl:'http://test',cookieSecure:false,bootstrapInvite:'alignment-bootstrap',maxUploadBytes:4096,cannonBridgeRequest:async(action,obj)=>{calls.push(action);if(offline)throw Error('offline');if(action==='apply'){desired=obj.desired;mode='applied';}return {binding,observed:observed(),nonce:'probe-nonce',applied:mode==='applied'};}});
  try{
    const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'alignment-bootstrap',username:'admin',password:'test-password-long'}});const cookie=reg.headers['set-cookie'].split(';')[0];const headers={cookie,'x-campus-csrf':'1',origin:'http://test'};
    const req=(method,url,payload)=>app.inject({method,url,headers,payload});
    await req('PUT','/api/cannons/one',{});
    const bp=app.campus.saveVersion({fileName:'one.nbt',bytes:structureNbt([1,1,1],[{pos:[0,0,0],name:'minecraft:stone'}]),origin:[1,64,3],via:'test'}).blueprint;
    await req('PUT','/api/cannons/one',{blueprint:bp.id});assert.equal(calls.length,0,'unbound selection never calls host');
    await req('POST','/api/cannons/one/alignment/probe',{binding});
    assert.equal((await req('POST','/api/cannons/one/alignment/bind',{binding,nonce:'probe-nonce',confirm:true})).statusCode,409,'legacy feeders cannot enable alignment');
    await req('POST','/api/cannons/one/status',{script:'1.1.0'});
    const bound=await req('POST','/api/cannons/one/alignment/bind',{binding,nonce:'probe-nonce',confirm:true});assert.equal(bound.statusCode,200,bound.body);
    const blocked=await req('GET','/api/cannons/one/plan');assert.equal(blocked.json().state,'alignment');assert.deepEqual(blocked.json().items,[]);assert.equal(blocked.json().options.gunpowder,0);assert.equal(blocked.json().options.paused,true);
    const applied=await req('POST','/api/cannons/one/alignment/apply',{});assert.equal(applied.statusCode,200,applied.body);assert.equal(applied.json().state,'aligned');
    assert.ok(calls.includes('apply'));assert.equal((await req('GET','/api/cannons/one/alignment')).json().desired.version,1);
    offline=true;const unavailable=await req('GET','/api/cannons/one/plan');assert.equal(unavailable.json().state,'alignment');assert.equal(unavailable.json().options.paused,true);
    assert.equal((await req('DELETE','/api/cannons/one')).statusCode,409,'cannot delete/recreate to evade enabled gate');
    assert.ok(app.campus.db.prepare("SELECT count(*) n FROM activity WHERE action LIKE 'cannon.alignment.%'").get().n>=3);
  }finally{await app.close();app.campus.db.close();rmSync(tmp,{recursive:true,force:true});}
});
