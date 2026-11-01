import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createCannonProgress} from '../src/cannon-progress.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {writeWorld,structureNbt} from './helpers.js';

const fixture=()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE cannon_schematics(job_json TEXT)');
  const events=[],service=createCannonProgress(db,()=>events.push('all-cannons'));
  const desired={blueprint:'house',version:1,assignment:7,file:'house.nbt',anchor:[4,64,4],sha256:'abc',options:{skip_missing:false,replace_mode:2,replace_block_entities:false}};
  const context={name:'one',job:{id:'job-1',state:'ready',blueprint:'house',version:1,fileName:desired.file,sha256:desired.sha256,origin:desired.anchor,createdAt:new Date().toISOString()},desired,receipt:desired,binding:{x:1,y:64,z:1}};
  let at=Date.now()/1000-10;
  const active=(changes={})=>({at:at+=0.1,state:'RUNNING',status:'placing',amountPlaced:50,amountToPlace:100,outputItem:null,outputCount:0,options:desired.options,...changes});
  const finish=(changes={})=>({at:at+=0.1,state:'STOPPED',status:'finished',amountPlaced:0,amountToPlace:0,inputEmpty:true,outputItem:'create:empty_schematic',outputCount:1,options:desired.options,
    printer:{DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'},flyingBlocks:0,...changes});
  const observe=(o,aligned=true,c=context)=>service.observe({...c,observed:o,aligned});
  return {db,events,service,context,active,finish,observe};
};

test('live job counts survive native reset, wait for landing and persist completion with one global update',()=>{
  const f=fixture();try{
    assert.equal(f.observe(f.active()).percent,50);
    assert.equal(f.observe(f.active({amountPlaced:100})).percent,99.9,'launch count alone never finishes');
    const finishing=f.observe(f.finish({flyingBlocks:3}),false);
    assert.equal(finishing.state,'finishing');assert.equal(finishing.total,100);
    const done=f.observe(f.finish(),false);
    assert.equal(done.state,'completed');assert.equal(done.percent,100);assert.equal(done.total,100);
    assert.deepEqual(f.events,['all-cannons']);
    f.observe(f.finish(),false);assert.equal(f.events.length,1,'browser GET completion emits only once');
    const reloaded=createCannonProgress(f.db);
    assert.equal(reloaded.forVersion('house',1).state,'completed','completion survives service recreation/unassignment');
    assert.equal(reloaded.forVersion('house',2),null,'new versions remain selectable');
    f.db.prepare('INSERT INTO cannon_schematics VALUES(?)').run(JSON.stringify({...f.context.job,id:'new-job',createdAt:new Date(Date.now()+1000).toISOString()}));
    assert.equal(reloaded.forVersion('house',1),null,'explicit rest-plan rebuild supersedes completion');
  }finally{f.db.close();}
});

test('ambiguous, skipped, expired and changed jobs never become completed',()=>{
  const changes=[{status:'idle'},{status:'schematicErrored'},{status:'schematicExpired'},{state:'PAUSED'},
    {inputEmpty:null},{inputEmpty:false},{outputItem:'minecraft:stone'},{outputCount:0},{outputCount:2},
    {printer:{}},{printer:{Anchor:[1,64,1],DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'}},
    {flyingBlocks:null},{amountPlaced:1},{options:{skip_missing:true}},{at:0}];
  for(const change of changes){const f=fixture();try{
    f.observe(f.active());assert.notEqual(f.observe(f.finish(change),false)?.state,'completed',JSON.stringify(change));
    assert.deepEqual(f.events,[]);
  }finally{f.db.close();}}
  for(const stage of ['skip','reset','foreign','stale-gap']){const f=fixture();try{
    f.observe(f.active());
    if(stage==='skip')f.observe(f.active({options:{...f.context.desired.options,skip_missing:true}}),false);
    if(stage==='reset')f.observe(f.active({amountPlaced:0}));
    if(stage==='foreign')f.observe(f.active({item:'other'}),false);
    if(stage==='stale-gap')f.db.prepare("UPDATE cannon_progress SET progress_json=json_set(progress_json,'$.lastTrusted',0)").run();
    if(stage!=='stale-gap')f.observe(f.active());
    assert.notEqual(f.observe(f.finish(),false)?.state,'completed',stage);
  }finally{f.db.close();}}
  const f=fixture();try{
    assert.equal(f.observe(f.finish(),false),null,'untracked finish cannot identify a blueprint');
    f.observe(f.active());
    for(const context of [{...f.context,binding:{x:2,y:64,z:1}}, {...f.context,desired:{...f.context.desired,assignment:8}}, {...f.context,receipt:null}, {...f.context,job:{...f.context.job,id:'other'}}, {...f.context,job:{...f.context.job,fileName:'new.nbt'}}, {...f.context,job:{...f.context.job,sha256:'def'}}, {...f.context,job:{...f.context.job,origin:[5,64,4]}}])
      assert.equal(f.observe(f.finish(),false,context),null,'exact job, binding, receipt and assignment required');
  }finally{f.db.close();}
});

test('older concurrent replies cannot roll back progress or fabricate a finish',()=>{
  const f=fixture();try{
    const old=f.active(),latest=f.active({amountPlaced:75});
    f.observe(latest);assert.equal(f.observe(old).sent,75);
    assert.equal(f.observe(f.finish({at:old.at}),false).state,'active');
    assert.equal(f.service.forVersion('house',1).sent,75);
  }finally{f.db.close();}
});

test('native completion removes stale-world choices, stops supply and rejects stale picker assignments',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'native-progress-')),world=join(dir,'world');
  writeWorld(world,[{cx:0,cz:0,blocks:[]}]);
  const binding={dimension:'minecraft:overworld',x:0,y:64,z:0,owner:'Campus'};
  let desired=null,options=null,mode='ready',at=Date.now()/1000-5;
  const observed=()=>({at:at+=0.01,state:mode==='running'?'RUNNING':'STOPPED',status:mode==='finished'?'finished':'placing',
    amountPlaced:mode==='running'?1:0,amountToPlace:mode==='running'?2:0,options,
    printer:mode==='running'?{Anchor:desired.anchor}:{DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'},
    flyingBlocks:0,inputEmpty:mode==='finished',outputItem:mode==='finished'?'create:empty_schematic':null,outputCount:mode==='finished'?1:0,
    item:mode==='finished'?null:'create:schematic',fileHash:mode==='finished'?null:desired?.sha256,
    components:desired&&mode!=='finished'?{'create:schematic_file':desired.file,'create:schematic_owner':desired.owner,'create:schematic_anchor':desired.anchor,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}:{}});
  const app=await buildServer({dataDir:join(dir,'data'),worldSources:{live:world},contextOrigin:[0,48,0],contextSize:[16,32,16],bootstrapInvite:'progress-bootstrap',publicUrl:'http://test',cookieSecure:false,maxUploadBytes:1024*1024,
    cannonBridgeRequest:async(action,payload)=>{if(action==='prepare'){desired=payload.desired;options=payload.options;mode='ready';}return{binding,observed:observed(),nonce:'test'};}});
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});});
  const registration=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'progress-bootstrap',username:'admin',password:'progress-password-long'}});
  const headers={cookie:registration.headers['set-cookie'].split(';')[0],'x-campus-csrf':'1'};
  const req=(method,url,payload)=>app.inject({method,url,payload,headers});
  app.campus.saveVersion({fileName:'house.nbt',origin:[4,64,4],bytes:structureNbt([2,1,1],[{pos:[0,0,0],name:'minecraft:stone'},{pos:[1,0,0],name:'minecraft:stone'}]),via:'test'});
  await app.campus.capture({source:'live',force:true});const snapshot=app.campus.latestSnapshot('live').id;
  await req('PUT','/api/cannons/one',{blueprint:'house'});
  await req('POST','/api/cannons/one/status',{script:'1.4.0'});
  await req('POST','/api/cannons/one/alignment/bind',{binding,nonce:'test',confirm:true});
  const ready=await req('PUT','/api/cannons/one',{schematic:{enabled:true}});assert.equal(ready.statusCode,200,ready.body);
  assert.equal(ready.json().alignment.state,'aligned',ready.body);
  mode='running';
  const running=(await req('GET','/api/cannons/one')).json();
  assert.equal(running.nativeProgress.percent,50);assert.equal(running.done,false);
  assert.equal(running.blueprintChoices.items[0].built,0,'no double counting against snapshot');
  assert.equal(running.blueprintChoices.items[0].nativeProgress.percent,50);
  const updates=[],publish=app.updates.publish;app.updates.publish=(...args)=>{updates.push(args);return publish(...args);};
  mode='finished';
  const completed=(await req('GET','/api/cannons/one')).json();
  assert.equal(completed.done,true);assert.equal(completed.state,'done');assert.equal(completed.nativeProgress.percent,100);
  assert.equal(completed.blueprintChoices.items.length,0);assert.equal(completed.blueprintChoices.excluded.finished,1);
  assert.equal(app.campus.latestSnapshot('live').id,snapshot,'no new world snapshot needed');
  assert.deepEqual(updates,[['cannons']],'one completion edge invalidates every picker');
  const plan=(await req('GET','/api/cannons/one/plan')).json();
  assert.equal(plan.done,true);assert.equal(plan.alignment.state,'aligned');assert.equal(plan.alignment.leaseSeconds,10);
  assert.deepEqual(plan.items,[]);assert.equal(plan.options.autoCraft,false);assert.equal(plan.options.gunpowder,0);
  const rejected=await req('PUT','/api/cannons/one',{blueprint:'house',version:1,selection:{assignment:running.assignment,version:1}});
  assert.equal(rejected.statusCode,409,rejected.body);
  await req('PUT','/api/cannons/one',{blueprint:null});
  assert.equal((await req('GET','/api/cannons/one')).json().blueprintChoices.items.length,0,'unassignment retains completion');
  app.campus.saveVersion({fileName:'house.nbt',origin:[4,64,4],bytes:structureNbt([2,1,1],[{pos:[0,0,0],name:'minecraft:glass'}]),via:'test'});
  assert.equal((await req('GET','/api/cannons/one')).json().blueprintChoices.items[0].version,2,'new version becomes selectable');
});
