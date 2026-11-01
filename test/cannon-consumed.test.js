import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {writeWorld,structureNbt} from './helpers.js';

// Production 2026-11-01: finished or emptied cannons kept a "ready" job whose
// schematic was gone, so every station stayed "Material gesperrt" forever.
const binding={dimension:'minecraft:overworld',x:0,y:64,z:0,owner:'Campus'};
const stone=x=>({x,y:64,z:4,name:'minecraft:stone'});

async function fixture(t,{mode:initial='ready'}={}) {
  const dir=mkdtempSync(join(tmpdir(),'cannon-consumed-')),world=join(dir,'world');
  writeWorld(world,[{cx:0,cz:0,blocks:[]}]);
  const s={desired:null,options:null,mode:initial,calls:[]};
  const reset={DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'};
  const observed=()=>{
    const loaded=s.mode==='ready'||s.mode==='running',d=s.desired;
    return {at:Date.now()/1000,state:s.mode==='running'?'RUNNING':'STOPPED',status:s.mode==='finished'?'finished':s.mode==='running'?'placing':'idle',
      amountPlaced:s.mode==='running'?1:0,amountToPlace:s.mode==='running'?2:0,flyingBlocks:0,options:s.options,
      printer:s.mode==='running'?{Anchor:d.anchor,DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'}:reset,
      inputEmpty:!loaded,outputItem:s.mode==='finished'?'create:empty_schematic':null,outputCount:s.mode==='finished'?1:0,
      item:loaded?'create:schematic':null,fileHash:loaded?d?.sha256:null,
      components:loaded&&d?{'create:schematic_file':d.file,'create:schematic_owner':d.owner,'create:schematic_anchor':d.anchor,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}:{}};
  };
  const app=await buildServer({dataDir:join(dir,'data'),worldSources:{live:world},contextOrigin:[0,48,0],contextSize:[16,32,16],bootstrapInvite:'consumed-bootstrap',publicUrl:'http://test',cookieSecure:false,maxUploadBytes:1024*1024,
    cannonBridgeRequest:async(action,payload)=>{
      s.calls.push(action);
      if(action==='prepare'){s.desired=payload.desired;s.options=payload.options;s.mode='ready';}
      return {binding,observed:observed(),nonce:'test'};
    }});
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});});
  const registration=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'consumed-bootstrap',username:'admin',password:'consumed-password-long'}});
  const headers={cookie:registration.headers['set-cookie'].split(';')[0],'x-campus-csrf':'1'};
  const req=(method,url,payload)=>app.inject({method,url,payload,headers});
  app.campus.saveVersion({fileName:'house.nbt',origin:[4,64,4],bytes:structureNbt([2,1,1],[{pos:[0,0,0],name:'minecraft:stone'},{pos:[1,0,0],name:'minecraft:stone'}]),via:'test'});
  await app.campus.capture({source:'live',force:true});
  await req('PUT','/api/cannons/one',{blueprint:'house'});
  await req('POST','/api/cannons/one/status',{script:'1.4.0'});
  await req('POST','/api/cannons/one/alignment/bind',{binding,nonce:'test',confirm:true});
  const ready=await req('PUT','/api/cannons/one',{schematic:{enabled:true}});
  assert.equal(ready.json().alignment.state,'aligned',ready.body);
  const cannon=async()=>(await req('GET','/api/cannons/one')).json();
  // A world saved after the cannon was observed empty.
  const saveWorld=async blocks=>{await new Promise(r=>setTimeout(r,20));writeWorld(world,[{cx:0,cz:0,blocks}]);await app.campus.capture({source:'live',force:true});};
  const receipt=()=>app.campus.db.prepare('SELECT applied_json FROM cannon_alignment WHERE name=?').get('one').applied_json;
  return {app,s,req,cannon,saveWorld,receipt};
}

test('an emptied cannon voids its receipt without a lock, and waits for a newer world before a rest plan',async t=>{
  const f=await fixture(t);
  const firstJob=(await f.cannon()).schematic.job;
  f.s.mode='emptied';
  const c=await f.cannon();
  assert.equal(c.schematic.job.state,'consumed');assert.equal(c.schematic.job.id,firstJob.id);
  assert.equal(c.state,'preparing','an empty cannon is not an alignment fault');
  assert.match(c.message,/nicht mehr in der Kanone/);
  assert.doesNotMatch(c.message,/Hash|Bridge/);
  assert.equal(f.receipt(),null,'the receipt of the removed schematic is void');
  const plan=(await f.req('GET','/api/cannons/one/plan')).json();
  assert.notEqual(plan.alignment.state,'aligned','no material lease while nothing is loaded');
  assert.deepEqual(plan.items,[]);
  // A capture without a new world save must not rebuild the plan from stale blocks.
  await f.app.campus.capture({source:'live',force:true});
  assert.equal((await f.cannon()).schematic.job.state,'consumed');
  assert.equal(f.s.calls.filter(a=>a==='prepare').length,1,'no automatic write before a newer world exists');
  const start=await f.req('POST','/api/cannons/one/start',{assignment:c.assignment,version:1});
  assert.equal(start.statusCode,409,'a consumed job cannot be started');
  // One block was built before the schematic was taken out.
  await f.saveWorld([stone(4)]);
  const next=(await f.cannon()).schematic.job;
  assert.notEqual(next.id,firstJob.id);assert.equal(next.state,'queued');assert.equal(next.blocks,1);
});

test('an untracked finish (no native history) becomes done once the newer world shows the plan built',async t=>{
  const f=await fixture(t);
  // As in production: the job finished before any progress record existed.
  f.app.campus.db.prepare('DELETE FROM cannon_progress').run();
  f.s.mode='finished';
  assert.equal((await f.cannon()).nativeProgress,null,'no completion is fabricated');
  assert.equal((await f.cannon()).schematic.job.state,'consumed');
  await f.saveWorld([stone(4),stone(5)]);
  const c=await f.cannon();
  assert.equal(c.state,'done');assert.equal(c.done,true);
  assert.equal(c.schematic.job.state,'empty');
  assert.equal(f.s.calls.filter(a=>a==='prepare').length,1,'nothing left to prepare');
  assert.equal(c.blueprintChoices.items.length,0,'built plan is not offered again');
});

test('a world-confirmed finished plan is done even while its schematic is still loaded',async t=>{
  const f=await fixture(t);
  await f.saveWorld([stone(4),stone(5)]);
  const c=await f.cannon();
  assert.equal(c.state,'done');assert.equal(c.done,true);
  assert.equal(c.alignment.state,'aligned');
});

test('the current mismatch replaces an older stored bridge failure',async t=>{
  const f=await fixture(t);
  f.app.campus.db.prepare("UPDATE cannon_alignment SET last_error='Live-Bridge offline oder Zeitüberschreitung; Material gesperrt.' WHERE name='one'").run();
  f.s.mode='running';f.s.options={...f.s.options,skip_missing:true};
  const c=await f.cannon();
  assert.equal(c.state,'alignment');
  assert.match(c.message,/Einstellungen/);
  assert.doesNotMatch(c.message,/Bridge/);
  assert.equal(c.schematic.job.state,'ready','a running cannon is never treated as emptied');
  assert.ok(f.receipt(),'receipt stays while a schematic is loaded');
});
