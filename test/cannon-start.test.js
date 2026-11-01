import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { writeWorld, structureNbt } from './helpers.js';

test('web start requires admin and exact ready assignment, detects drift and serializes changes', async t => {
  const tmp=mkdtempSync(join(tmpdir(),'campus-start-'));
  writeWorld(join(tmp,'world'),[{cx:0,cz:0,blocks:[]}]);
  const binding={dimension:'minecraft:overworld',x:0,y:64,z:0,owner:'Campus'};
  let applied=null,options=null,native='STOPPED',drift=false,hold,entered,counter=0,advanceCounter=false;
  const calls=[];
  const observed=()=>({at:Date.now()/1000,state:native,status:'ready',amountPlaced:advanceCounter?++counter:counter,amountToPlace:0,flyingBlocks:0,
    printer:native==='STOPPED'?{DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'}:{Anchor:applied.anchor},
    item:'create:schematic',fileHash:applied?.sha256,options:drift?{...options,skip_missing:true}:options,
    components:applied?{'create:schematic_file':applied.file,'create:schematic_owner':applied.owner,'create:schematic_anchor':applied.anchor,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}:{}});
  const app=await buildServer({dataDir:join(tmp,'data'),worldSources:{live:join(tmp,'world')},contextOrigin:[0,48,0],contextSize:[16,32,16],snapshotKeepRecent:10,
    bootstrapInvite:'start-bootstrap-test',publicUrl:'http://test',cookieSecure:false,maxUploadBytes:1024*1024,
    cannonBridgeRequest:async(action,payload)=>{
      calls.push(action);
      if(action==='prepare'){applied=payload.desired;options=payload.options;}
      if(action==='start'){
        entered?.();if(hold)await hold;
        assert.deepEqual(payload.desired,applied);assert.deepEqual(payload.options,options);
        const alreadyRunning=native==='RUNNING';native='RUNNING';
        return {binding,observed:observed(),started:true,alreadyRunning};
      }
      return {binding,observed:observed(),nonce:'probe-start'};
    }});
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(tmp,{recursive:true,force:true});});
  const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'start-bootstrap-test',username:'admin',password:'password-test-123'}});
  const cookie=reg.cookies[0].name+'='+reg.cookies[0].value;
  const headers={cookie,'x-campus-csrf':'1',origin:'http://test'};
  const req=(method,url,payload,extra)=>app.inject({method,url,payload,headers:{...headers,...extra}});
  const url='/api/cannons/one', start=url+'/start';
  const bytes=structureNbt([1,1,1],[{pos:[0,0,0],name:'minecraft:stone'}]);
  await req('POST','/api/blueprints',{fileName:'house.nbt',origin:[4,64,4],nbtBase64:bytes.toString('base64')});
  await req('POST','/api/snapshots',{force:true});
  await req('PUT',url,{blueprint:'house'});
  const body=()=>{const r=app.campus.db.prepare('SELECT assignment,version FROM cannons WHERE name=?').get('one');return {...r};};
  assert.equal((await req('POST',start,{assignment:1,version:1})).statusCode,409,'unbound start refused');
  await req('POST',url+'/status',{script:'1.3.0'});
  assert.equal((await req('POST',url+'/alignment/bind',{binding,nonce:'probe-start',confirm:true})).statusCode,200);
  await req('PUT',url,{schematic:{enabled:true}});
  assert.equal((await req('GET',url)).json().schematic.job.state,'ready');
  const before=calls.filter(c=>c==='start').length;
  assert.equal((await app.inject({method:'POST',url:start,payload:body()})).statusCode,401);
  assert.equal((await app.inject({method:'POST',url:start,payload:body(),headers:{cookie}})).statusCode,403);
  assert.equal((await req('POST',start,body(),{origin:'http://evil.test'})).statusCode,403);
  const token=(await req('POST','/api/tokens',{name:'writer',scope:'write'})).json().token;
  assert.equal((await app.inject({method:'POST',url:start,payload:body(),headers:{authorization:'Bearer '+token}})).statusCode,403);
  for(const payload of [{...body(),assignment:0},{...body(),version:99}])assert.equal((await req('POST',start,payload)).statusCode,409);
  assert.equal((await req('POST',start,{...body(),command:'anything'})).statusCode,400);
  assert.equal(calls.filter(c=>c==='start').length,before,'invalid callers never issue native start');
  drift=true;
  assert.equal((await req('POST',start,body())).statusCode,409,'native settings drift refuses start');
  drift=false;
  let release;hold=new Promise(r=>release=r);const arrived=new Promise(r=>entered=r);
  const pending=Promise.resolve(req('POST',start,body()));await arrived;
  assert.equal((await req('POST',start,body())).statusCode,409,'concurrent start serialized');
  assert.equal((await req('PUT',url,{options:{paused:true}})).statusCode,409,'settings cannot change during native start');
  assert.equal((await req('PATCH','/api/blueprints/house',{origin:[5,64,4],baseVersion:1})).statusCode,409,'blueprint changes cannot race start');
  release();const result=await pending;assert.equal(result.statusCode,200,result.body);assert.equal(result.json().observed.state,'RUNNING');
  hold=null;entered=null;
  assert.equal((await req('POST',start,body())).json().alreadyRunning,true);
  assert.ok(app.campus.db.prepare("SELECT COUNT(*) n FROM activity WHERE action='cannon.start'").get().n>=2);
  assert.ok(app.campus.db.prepare("SELECT COUNT(*) n FROM activity WHERE action='cannon.start.blocked'").get().n>=1);
  await t.test('browser reads never publish changing native counters; feeder observations do',async()=>{
    const published=[],original=app.updates.publish;
    app.updates.publish=(...args)=>published.push(args);advanceCounter=true;
    try{
      for(const endpoint of [url,url+'/alignment','/api/cannons',url])assert.equal((await req('GET',endpoint)).statusCode,200);
      assert.deepEqual(published,[],'SSE-triggered UI reads cannot generate more SSE events');
      assert.equal((await req('GET',url+'/plan')).statusCode,200);
      assert.deepEqual(published,[['cannons','one']],'feeder poll publishes new native progress');
      published.length=0;advanceCounter=false;
      await req('GET',url+'/plan');
      assert.deepEqual(published,[],'unchanged scheduled observation is quiet');
    }finally{app.updates.publish=original;advanceCounter=false;}
  });
  await req('PUT',url,{options:{paused:true}});
  assert.equal((await req('POST',start,body())).statusCode,409,'paused supply is not silently re-enabled');
});
