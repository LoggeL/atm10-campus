import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {buildServer} from '../src/server.js';
import {createApiToken,HttpError} from '../src/auth.js';
import {writeWorld,structureNbt} from './helpers.js';

async function fixture(t) {
  const dir=mkdtempSync(join(tmpdir(),'campus-discovery-'));
  writeWorld(join(dir,'world'),[{cx:0,cz:0,blocks:[]}]);
  const native={state:'STOPPED',binding:{dimension:'minecraft:overworld',x:1,y:64,z:1,owner:'Campus'},scanState:'found',calls:[],registry:new Map(),plans:new Map(),holdInspect:null};
  const observed=name=>{
    const plan=native.plans.get(name);
    return {at:Date.now()/1000,state:native.state,amountPlaced:0,amountToPlace:0,flyingBlocks:0,
      printer:native.state==='STOPPED'?{DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'}:{Anchor:plan?.desired.anchor},
      item:plan?'create:schematic':null,fileHash:plan?.desired.sha256,options:plan?.options,
      components:plan?{'create:schematic_file':plan.desired.file,'create:schematic_owner':plan.desired.owner,'create:schematic_anchor':plan.desired.anchor,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}:{}};
  };
  const app=await buildServer({dataDir:join(dir,'data'),worldSources:{live:join(dir,'world')},contextOrigin:[0,48,0],contextSize:[16,32,16],snapshotKeepRecent:10,
    bootstrapInvite:'discovery-bootstrap-123',publicUrl:'http://test',cookieSecure:false,maxUploadBytes:1024*1024,cannonDiscoveryIntervalMs:60_000,
    cannonDiscoveryScan:async(config,status)=>{
      if(native.scanState!=='found')return {state:native.scanState,message:'Keine eindeutige Kanone am Computer.',candidate:null};
      return {state:'found',candidate:{computer:{id:status.computerId,x:0,y:64,z:0,block:'computercraft:computer_advanced',facing:'north'},
        chest:{x:1,y:64,z:0,block:'minecraft:chest',side:status.chestSide},binding:{...native.binding}}};
    },
    cannonBridgeRequest:async(action,payload)=>{
      native.calls.push({action,payload:structuredClone(payload)});
      const name=payload.station;
      if(action==='discover'){
        native.enterDiscover?.();if(native.holdDiscover)await native.holdDiscover;
        const old=native.registry.get(name),next=payload.candidate.binding;
        if(old&&!isDeepStrictEqual(old,next)&&native.state!=='STOPPED')throw new HttpError(409,'Alte oder neue Kanone ist aktiv. Vollständig stoppen.');
        native.registry.set(name,{...next});
        return {binding:next,observed:observed(name),discovered:true};
      }
      if(action==='prepare'){
        if(native.state!=='STOPPED')throw new HttpError(409,'Kanone läuft.');
        native.plans.set(name,{desired:payload.desired,options:payload.options});
      }else if(action==='inspect'&&native.holdInspect){native.enterInspect?.();await native.holdInspect;}
      else if(action==='start'){native.state='RUNNING';return {binding:native.registry.get(name),observed:observed(name),started:true};}
      else if(action==='bind'){native.registry.set(name,payload.binding);}
      return {binding:native.registry.get(name),observed:observed(name),nonce:'discovery-probe'};
    }});
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});});
  const registered=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'discovery-bootstrap-123',username:'admin',password:'discovery-pass-123'}});
  const headers={cookie:registered.cookies[0].name+'='+registered.cookies[0].value,'x-campus-csrf':'1',origin:'http://test'};
  const user=registered.json().user;
  const writer=createApiToken(app.campus.db,user.id,'writer','write').token;
  const station=createApiToken(app.campus.db,user.id,'station','station').token;
  const req=(method,url,payload,extra={})=>app.inject({method,url,payload,headers:{...headers,...extra}});
  const base='/api/cannons/auto';
  const bytes=structureNbt([1,1,1],[{pos:[0,0,0],name:'minecraft:stone'}]);
  assert.equal((await req('POST','/api/blueprints',{fileName:'House.nbt',origin:[4,64,4],nbtBase64:bytes.toString('base64')})).statusCode,200);
  assert.equal((await req('POST','/api/snapshots',{force:true})).statusCode,200);
  assert.equal((await req('PUT',base,{blueprint:'House'})).statusCode,200);
  const report=(changes={},name='auto')=>req('POST','/api/cannons/'+name+'/status',{script:'1.4.0',computerId:4,chestSide:'left',chest:{name:'left',used:0,slots:27},...changes},{authorization:'Bearer '+station});
  const view=async()=>{const r=await req('GET',base);assert.equal(r.statusCode,200,r.body);return r.json();};
  const discover=async()=>{const r=await req('POST',base+'/discover',{});assert.equal(r.statusCode,200,r.body);return r.json();};
  return {app,native,req,base,headers,writer,station,report,view,discover};
}

test('new1.4 stations fail closed, then automatically bind and prepare the actual rest NBT without starting',async t=>{
  const f=await fixture(t),{app,native,report,req,base}=f;
  await report();
  const pending=(await req('GET',base+'/plan')).json();
  assert.equal(pending.state,'alignment');assert.deepEqual(pending.items,[]);assert.equal(pending.options.autoCraft,false);
  assert.equal(pending.alignment.discovery.state,'pending');
  const deadline=Date.now()+2500;
  let ready;
  do {ready=await f.view();if(ready.schematic.job?.state==='ready')break;await new Promise(r=>setTimeout(r,20));}while(Date.now()<deadline);
  assert.equal(ready.schematic.job?.state,'ready',JSON.stringify(ready.alignment));
  assert.equal(ready.alignment.discovery.state,'bound');assert.equal(ready.alignment.discovery.computerId,4);
  assert.equal(ready.schematic.settings.enabled,true);
  assert.equal(ready.alignment.state,'aligned');
  assert.deepEqual(ready.schematic.job.origin,[4,64,4]);
  assert.equal(ready.schematic.job.blocks,1);
  assert.equal(native.calls.filter(c=>c.action==='prepare').length,1);
  assert.equal(native.calls.some(c=>c.action==='start'),false,'discovery/preparation never starts construction');
  const before=app.campus.db.prepare('SELECT applied_json,binding_json FROM cannon_alignment WHERE name=?').get('auto');
  native.state='RUNNING';
  const again=await f.discover();
  assert.equal(again.discovery.state,'bound');assert.equal(again.observed.state,'RUNNING');
  assert.deepEqual(app.campus.db.prepare('SELECT applied_json,binding_json FROM cannon_alignment WHERE name=?').get('auto'),before);
  const after=await f.view();assert.equal(after.schematic.job.id,ready.schematic.job.id);assert.equal(after.assignment,ready.assignment);
  assert.equal(native.calls.filter(c=>c.action==='prepare').length,1,'same-binding running job stays untouched');
});

test('pending automatic stations require browser admin; an explicit disabled schematic remains disabled',async t=>{
  const f=await fixture(t),{req,base,report,writer,native}=f;
  await report();
  for(const [method,url,payload] of [['PUT',base,{options:{paused:true}}],['DELETE',base,undefined],['POST',base+'/discover',{}]]) {
    const r=await req(method,url,payload,{authorization:'Bearer '+writer});assert.equal(r.statusCode,403,r.body);
  }
  assert.equal((await f.app.inject({method:'POST',url:base+'/discover',payload:{}})).statusCode,401);
  assert.equal((await f.app.inject({method:'POST',url:base+'/discover',headers:{cookie:f.headers.cookie},payload:{}})).statusCode,403);
  assert.equal((await req('PUT',base,{schematic:{enabled:false}})).statusCode,200);
  assert.equal((await f.discover()).discovery.state,'bound');
  const v=await f.view();assert.equal(v.schematic.settings.enabled,false);assert.equal(v.schematic.job,null);
  assert.equal(native.calls.some(c=>c.action==='prepare'||c.action==='start'),false);
  await f.discover();assert.equal((await f.view()).schematic.settings.enabled,false);
});

test('ambiguous maps, duplicate computer IDs and stale reports remain blocked without replacing stored binding',async t=>{
  const f=await fixture(t),{app,native,report,req,base}=f;
  await report();native.scanState='ambiguous';
  assert.equal((await f.discover()).discovery.state,'ambiguous');
  assert.equal(native.calls.some(c=>c.action==='discover'),false);
  assert.deepEqual((await req('GET',base+'/plan')).json().items,[]);
  native.scanState='found';await report({},'duplicate');
  const duplicate=await f.discover();assert.equal(duplicate.discovery.state,'ambiguous');assert.match(duplicate.discovery.message,/auch als duplicate/);
  await req('DELETE','/api/cannons/duplicate');
  await f.discover();
  const before=app.campus.db.prepare('SELECT binding_json,applied_json FROM cannon_alignment WHERE name=?').get('auto');
  const s=JSON.parse(app.campus.db.prepare('SELECT status_json FROM cannons WHERE name=?').get('auto').status_json);
  app.campus.db.prepare('UPDATE cannons SET status_json=? WHERE name=?').run(JSON.stringify({...s,at:'2000-01-01T00:00:00Z'}),'auto');
  assert.equal((await f.discover()).discovery.state,'offline');
  assert.deepEqual(app.campus.db.prepare('SELECT binding_json,applied_json FROM cannon_alignment WHERE name=?').get('auto'),before);
  assert.deepEqual((await req('GET',base+'/plan')).json().items,[]);
});

test('a moved active cannon is refused, while a later idle move gets a new immutable prepared job',async t=>{
  const f=await fixture(t),{native,report,req,base}=f;
  await report();await f.discover();const first=await f.view();
  native.state='RUNNING';native.binding={...native.binding,x:6};
  const refused=await f.discover();assert.equal(refused.discovery.state,'blocked');assert.match(refused.discovery.message,/aktiv/);
  const blocked=await f.view();assert.equal(blocked.alignment.binding.x,1);assert.equal(blocked.schematic.job.id,first.schematic.job.id);
  assert.deepEqual((await req('GET',base+'/plan')).json().items,[]);
  native.state='STOPPED';await f.discover();
  const moved=await f.view();assert.equal(moved.alignment.binding.x,6);assert.equal(moved.schematic.job.state,'ready');assert.notEqual(moved.schematic.job.id,first.schematic.job.id);
  assert.equal(native.calls.some(c=>c.action==='start'),false);
});

test('computer identity changes while inspect is pending cannot release an old material lease',async t=>{
  const f=await fixture(t),{native,report,req,base}=f;
  await report();await f.discover();
  let release;native.holdInspect=new Promise(r=>release=r);const entered=new Promise(r=>native.enterInspect=r);
  const pending=Promise.resolve(req('GET',base+'/plan'));await entered;
  await report({computerId:5,chestSide:null});
  release();const result=await pending;native.holdInspect=null;native.enterInspect=null;
  assert.equal(result.statusCode,200,result.body);
  assert.equal(result.json().state,'alignment');assert.deepEqual(result.json().items,[]);
  assert.notEqual(result.json().alignment.state,'aligned');assert.equal(result.json().alignment.discovery.computerId,5);
});

test('an identity change during live discovery is not acknowledged and concurrent assignment is locked',async t=>{
  const f=await fixture(t),{app,native,report,req,base}=f;
  await report();await f.discover();const before=await f.view();
  let release;native.holdDiscover=new Promise(r=>release=r);const entered=new Promise(r=>native.enterDiscover=r);
  const pending=Promise.resolve(req('POST',base+'/discover',{}));await entered;
  assert.equal((await req('PUT',base,{blueprint:null})).statusCode,409);
  await report({computerId:8});
  release();const result=await pending;native.holdDiscover=null;native.enterDiscover=null;
  assert.equal(result.statusCode,200,result.body);assert.notEqual(result.json().discovery.state,'bound');
  assert.equal(app.campus.db.prepare('SELECT assignment FROM cannons WHERE name=?').get('auto').assignment,before.assignment);
  assert.equal((await f.view()).schematic.job.id,before.schematic.job.id);
});

test('adopting a previous binding preserves its owner and serialized key order',async t=>{
  const f=await fixture(t),{app,native,report,req,base}=f;
  // Older installations did not store discovery metadata. Keep their owner and
  // receipt intact when the upgraded computer proves the same physical chain.
  const previous={owner:'ExistingOwner',z:1,y:64,x:1,dimension:'minecraft:overworld'};
  native.registry.set('auto',previous);
  app.campus.db.prepare('INSERT INTO cannon_alignment(name,binding_json,updated_at) VALUES(?,?,?)').run('auto',JSON.stringify(previous),new Date().toISOString());
  await report();
  assert.equal((await f.discover()).discovery.state,'bound');
  const record=app.campus.db.prepare('SELECT binding_json FROM cannon_alignment WHERE name=?').get('auto');
  assert.equal(record.binding_json,JSON.stringify(previous));
  assert.equal(native.calls.find(c=>c.action==='discover').payload.candidate.binding.owner,'ExistingOwner');
  const prepared=await req('POST',base+'/schematic/prepare',{});
  assert.equal(prepared.statusCode,200,prepared.body);assert.equal(prepared.json().job.state,'ready');
  assert.equal(prepared.json().job.owner,'ExistingOwner');
});
