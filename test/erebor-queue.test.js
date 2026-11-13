import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,renameSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeWorld} from './helpers.js';
import {buildServer} from '../src/server.js';
import {confirmedFinish,recordedFinish} from '../src/erebor-queue.js';

const layout=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
const options={replace_mode:0,skip_missing:false,replace_block_entities:false};
const printer={DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'};
const stopped={state:'STOPPED',status:'finished',amountPlaced:0,amountToPlace:0,flyingBlocks:0,inputEmpty:true,printer,options,outputCount:1,outputItem:'create:empty_schematic'};
test('a removed plan, missed observation, foreign output or flights do not advance the queue',()=>{
 const job={seen:1000,baseline:0,desired:{options}};
 assert.equal(confirmedFinish(stopped,job,1001),true);
 for(const change of [{status:'idle'},{inputEmpty:false},{outputCount:2},{flyingBlocks:1},{options:{...options,skip_missing:true}}])assert.equal(confirmedFinish({...stopped,...change},job,1001),false);
 assert.equal(confirmedFinish(stopped,job,2000),false);
 assert.equal(confirmedFinish(stopped,{...job,tainted:true},1001),false);
});
test('a delayed poll accepts only the witnessed finish of the very same input and output increment',()=>{
 const job={desired:{file:'exact',options},loaded:true,seen:1000,baseline:0};
 const r={file:'exact',before:1010000,at:1010500,oldCount:0,newCount:1};
 assert.equal(confirmedFinish(stopped,job,1200),false);
 assert.equal(recordedFinish(stopped,job,r,1200000),true);
 for(const wrong of [{file:'other'},{oldCount:1},{newCount:2},{before:900000}])assert.equal(recordedFinish(stopped,job,{...r,...wrong},1200000),false);
 assert.equal(recordedFinish(stopped,{...job,tainted:true},r,1200000),false);
 const now=2200000,o={...stopped,at:now/1000};
 const witness={at:now-1000,signal:{upload:'',state:'STOPPED',status:'finished',finish:r}};
 assert.equal(recordedFinish(o,job,r,now,witness),true);
 assert.equal(recordedFinish(o,job,r,now),false);
 assert.equal(recordedFinish(o,job,r,now,{...witness,at:now-60000}),false);
 assert.equal(recordedFinish(o,job,r,now,{...witness,signal:{...witness.signal,upload:'other'}}),false);
 assert.equal(recordedFinish({...o,outputCount:2},job,r,now,witness),false);
});
test('the Campus action arms the persisted fleet and advances an observed finish exactly once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-queue-')),calls=[];
 const app=await buildServer({dataDir:dir,worldSources:{},snapshotIntervalMin:0,publicUrl:'http://test',bootstrapInvite:'queue-test',cookieSecure:false,
  cannonBridgeRequest:async(action,data)=>{calls.push(action);return {observed:data.site==='K01'?{...stopped,at:Date.now()/1000}:{...stopped,inputEmpty:false}};}});
 const db=app.campus.db,url='/api/projects/erebor/planfolge';
 try{
  assert.equal((await app.inject({method:'POST',url,payload:{action:'prepare',version:12}})).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'queue-test',username:'admin-user',password:'fleet-test-password'}});
  const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:layout.sites.map(s=>({id:s.site,position:s.planned}))}};
  const add=await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}});assert.equal(add.statusCode,200,add.body);
  db.prepare("UPDATE build_projects SET current_version=12 WHERE id='erebor'").run();
  const post=(action,h=headers)=>app.inject({method:'POST',url,headers:h,payload:{action,version:12}});
  assert.equal((await post('prepare',{...headers,origin:'https://foreign.invalid'})).statusCode,403);
  assert.equal((await post('pause')).statusCode,200);
  const state={cursor:0,completed:0,exhausted:false,job:{loaded:true,phase:'stone',next:1,seen:Date.now()/1000,baseline:0,size:[1,1,1],desired:{file:'test',sha256:'hash',options}}};
  db.prepare('UPDATE erebor_queue_sites SET state=? WHERE site=?').run(JSON.stringify(state),'K01');
  assert.equal((await post('prepare')).statusCode,200);
  for(let i=0;i<50&&calls.length<37;i++)await new Promise(r=>setTimeout(r,10));
  const status=(await app.inject({url,headers})).json();assert.equal(status.enabled,true);assert.equal(status.stations.length,37);
  assert.equal(status.stations[0].completed,1);assert.equal(status.stations[0].file,null);assert.equal(status.stations[1].status,'Kanone belegt');
  assert.equal((await post('pause')).json().enabled,false);assert.ok(calls.every(a=>['erebor-inspect','erebor-live'].includes(a)));
 }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('two real exported layers enter an empty slot in order; manual removal holds the second plan',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-layers-')),world=join(dir,'world'),pos=[-240,0,-11008];
 const cx=pos[0]>>4,cz=pos[2]>>4;
 writeWorld(world,[{cx:cx&31,cz:cz&31,blocks:[]}]);
 renameSync(join(world,'region/r.0.0.mca'),join(world,'region','r.'+(cx>>5)+'.'+(cz>>5)+'.mca'));
 let native={...stopped,outputItem:null,outputCount:0,status:'idle'},commands=[];
 const request=async(action,b)=>{
  if(b.site!=='K01')return {observed:{...stopped,inputEmpty:false}};
  if(action==='erebor-prepare'){
   assert.equal(native.inputEmpty,true);const d=b.desired;commands.push(d);
   native={...stopped,status:'ready',state:'PAUSED',inputEmpty:false,item:'create:schematic',outputItem:null,outputCount:0,fileHash:d.sha256,
    printer:{...printer,Anchor:d.anchor},components:{'create:schematic_owner':d.owner,'create:schematic_file':d.file,'create:schematic_anchor':d.anchor,'create:schematic_bounds':b.size,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}};
  }else assert.equal(action,'erebor-inspect');
  return {applied:true,observed:{...native,at:Date.now()/1000}};
 };
 const app=await buildServer({dataDir:join(dir,'db'),worldSources:{live:world},bootstrapInvite:'layers-test',snapshotIntervalMin:0,cookieSecure:false,publicUrl:'http://test',cannonBridgeRequest:request});
 const db=app.campus.db,url='/api/projects/erebor/planfolge';
 try{
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'layers-test',username:'test-layers',password:'layers-test-password'}});
  const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:[0,16,-11008],site:{status:"planned"},rotationDegrees:90,cannonLayout:{stations:layout.sites.map(s=>({id:s.site,position:s.planned}))},
   mountainFill:{algorithm:'erebor-massif-v1',bounds:[pos,[-232,48,-11000]],peak:[-236,40,-11004],roofReserves:[],protectedBoxes:[]}};
  // Pin the fixture to the installed v12 survey after the normal project insertion.
  const add=await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}});assert.equal(add.statusCode,200,add.body);
  db.prepare("UPDATE build_projects SET current_version=12 WHERE id='erebor'").run();
  const wake=()=>app.inject({method:'POST',url,headers,payload:{action:'prepare',version:12}});
  const row=()=>JSON.parse(db.prepare("SELECT state FROM erebor_queue_sites WHERE site='K01'").get().state);
  const wait=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}assert.fail(JSON.stringify(row()));};
  assert.equal((await wake()).statusCode,200);await wait(()=>row().inserted);
  native={...stopped};await wake();await wait(()=>row().completed===1);
  await wake();await wait(()=>commands.length===2&&row().inserted);
  assert.deepEqual(commands.map(d=>d.anchor[1]),[0,16]);
  native={...stopped,status:'idle',outputCount:0,outputItem:null};await wake();await wait(()=>row().status==='Wartet auf bestätigten Abschluss');
  assert.equal(row().completed,1);assert.equal(commands.length,2);
 }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
