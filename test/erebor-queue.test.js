import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {confirmedFinish} from '../src/erebor-queue.js';

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
  assert.equal((await post('pause')).json().enabled,false);assert.ok(calls.every(a=>a==='erebor-inspect'));
 }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
