import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildServer} from '../src/server.js';
import {stoneNBT} from '../src/project-stone.js';
import {zipStore} from '../src/zip.js';

const fleet=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
const base='/api/projects/erebor/planfolge';
const printer={PrintStage:'BLOCKS',DeferredBlocks:[],EntityProgress:-1};
const options={replace_mode:0,skip_missing:false,replace_block_entities:false};
const idle=()=>({state:'STOPPED',status:'idle',printer,inputEmpty:true,amountPlaced:0,amountToPlace:0,flyingBlocks:0,outputCount:0,options});

test('a single cannon continues its complete queue after restart, prioritises the next slot and remembers completed work',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-continuous-'));
 const started=[],prepared=[];
 let native=idle(),app;
 const bridge=async(action,b)=>{
  if(action==='erebor-live')return {version:12,at:Date.now(),stations:{}};
  assert.equal(b.site,'K01');
  const d=b.desired;
  if(action==='erebor-prepare'){
   assert.equal(native.inputEmpty,true);prepared.push(d.blueprint);
   native={...idle(),state:'PAUSED',status:'ready',inputEmpty:false,item:'create:schematic',fileHash:d.sha256,
    components:{'create:schematic_file':d.file,'create:schematic_owner':'Erebor','create:schematic_rotation':'none','create:schematic_mirror':'none',
    'create:schematic_anchor':d.anchor,'create:schematic_bounds':b.size,'create:schematic_deployed':1},printer:{...printer,Anchor:d.anchor,CurrentPos:[-1,0,0]}};
  }else if(action==='erebor-start'){
   assert.equal(native.state,'PAUSED');assert.equal(d.file,native.components['create:schematic_file']);started.push(d.blueprint);
   native={...native,state:'RUNNING',status:'placing'};
  }else assert.equal(action,'erebor-inspect');
  return {applied:true,started:true,observed:{...native,at:Date.now()/1000}};
 };
 const boot=()=>buildServer({dataDir:dir,worldSources:{},bootstrapInvite:'finish-queue',publicUrl:'http://test',cookieSecure:false,snapshotIntervalMin:0,cannonBridgeRequest:bridge});
 const close=async()=>{await app.close();app.campus.db.close();};
 try{
  app=await boot();
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'finish-queue',username:'test',password:'finish-local-queue'}});
  const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const send=(path,payload,h=headers)=>app.inject({method:'POST',url:base+path,payload:{site:'K01',version:12,...payload},headers:h});
  const list=async()=>(await app.inject({url:base+'?site=K01',headers})).json().queue;
  const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:fleet.sites.map(s=>({id:s.site,position:s.planned}))}};
  await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}});
  const db=app.campus.db;db.prepare("UPDATE build_projects SET current_version=12 WHERE id='erebor'").run();
  const bytes=stoneNBT([2,2,2],[[0,0,0]]),sha=createHash('sha256').update(bytes).digest('hex');
  const names=[1,2,3].map(i=>'EREBOR_STEIN_K01_X0'+i+'_V12');
  const files=names.map((name,i)=>({fileName:name+'.nbt',cannon:'K01',sha256:sha,size:[2,2,2],origin:[-252+i,32,-11010],blocks:1}));
  db.prepare("INSERT INTO project_stone_packages VALUES('erebor',12,'K01',1,?,?,?,?,NULL)").run('sum',zipStore(files.map(f=>({name:f.fileName,data:bytes}))),JSON.stringify({files,skipped:[]}),new Date().toISOString());
  assert.deepEqual((await list()).pending,names);
  assert.equal((await send('/automatik',{enabled:true},{})).statusCode,401);
  assert.equal((await send('/automatik',{enabled:true},{...headers,origin:'https://foreign.invalid'})).statusCode,403);
  const wait=async(check,ms=3000)=>{const end=Date.now()+ms;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,40));assert.ok(check(),'Zeitlimit: '+JSON.stringify(started));};
  assert.equal((await send('/automatik',{enabled:true})).statusCode,200);
  await wait(()=>started.length===1);assert.deepEqual(started,[names[0]]);
  assert.equal((await send('/vorziehen',{file:names[2],sha256:sha})).statusCode,200);
  assert.deepEqual((await list()).pending,[names[2],names[1]]);assert.deepEqual(prepared,[names[0]]);
  await close();app=await boot();
  native={...idle(),status:'finished',outputItem:'create:empty_schematic',outputCount:1};
  // No connected browser, start button or API wake between completion and the next start.
  await wait(()=>started.length===2,26000);assert.deepEqual(started,[names[0],names[2]]);
  let q=await list();assert.deepEqual(q.done.map(f=>f.name),[names[0]]);assert.deepEqual(q.pending,[names[1]]);
  assert.equal((await send('/vorziehen',{file:names[0],sha256:sha})).statusCode,409);
  native={...idle(),status:'finished',outputItem:'create:empty_schematic',outputCount:1};
  await send('/automatik',{enabled:true});await send('/automatik',{enabled:true});
  await wait(()=>started.length===3);assert.deepEqual(started,[names[0],names[2],names[1]]);
  await send('/automatik',{enabled:false});native={...idle(),status:'finished',outputItem:'create:empty_schematic',outputCount:1};
  await send('/automatik',{enabled:false});await wait(()=>app.campus.db.prepare('SELECT COUNT(*) n FROM erebor_finished_plans').get().n===3);
  q=await list();assert.deepEqual(q.pending,[]);assert.equal(q.done.length,3);assert.deepEqual(prepared,started);
 }finally{await close();rmSync(dir,{recursive:true,force:true});}
});

test('legacy history identifies confirmed sections once and never labels an ambiguous prefix as built',async()=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {productionStore}=await import('../src/erebor-production.js');
 const {DESIGN_REVISION}=await import('../src/erebor-design.js');
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE erebor_queue_config(id,version,phase);
   INSERT INTO erebor_queue_config VALUES(1,12,'stone');
   CREATE TABLE erebor_queue_sites(site,state);
   CREATE TABLE erebor_selections(version,site,name,status);
   CREATE TABLE activity(at,action,target,detail_json);
   CREATE TABLE project_stone_packages(project_id,version,cannon,part,report_json);
   CREATE TABLE project_architecture_packages(project_id,base_version,revision,package_id,report_json);`);
  const prefix=site=>['ONE','TWO','THREE'].map(part=>'EREBOR_STEIN_'+site+'_'+part+'_V12');
  for(const site of ['K01','K02','K03']){
   const names=prefix(site);
   db.prepare('INSERT INTO project_stone_packages VALUES(?,?,?,?,?)').run('erebor',12,site,1,JSON.stringify({files:names.map(name=>({fileName:name+'.nbt',cannon:site})),skipped:[]}));
   db.prepare('INSERT INTO erebor_queue_sites VALUES(?,?)').run(site,JSON.stringify(site==='K01'?{completed:2,cursor:1}:{completed:1,cursor:site==='K02'?1:2}));
  }
  const k1=prefix('K01');
  db.prepare('INSERT INTO erebor_selections VALUES(12,?,?,?)').run('K01',k1[0],'finished');
  db.prepare('INSERT INTO activity VALUES(?,?,?,?)').run('2026-11-12T00:00:00Z','erebor.plan.reconcile','K01',JSON.stringify({file:k1[0]}));
  const files=[['BUILD','build',1],['CLEAR_HIGH','clear',32],['CLEAR_LOW','clear',0]].map(([name,kind,y])=>({fileName:name+'.nbt',kind,origin:[0,y,0],cannon:'K01'}));
  db.prepare('INSERT INTO project_architecture_packages VALUES(?,?,?,?,?)').run('erebor',12,DESIGN_REVISION,'pack',JSON.stringify({files}));
  const prod=productionStore(db),project={current_version:12,plan_json:'{}'};
  assert.deepEqual([...prod.ordered(project,'K01').done.keys()],[k1[0]]);
  assert.deepEqual(prod.ordered(project,'K01').open.map(f=>f.name),[k1[1],k1[2],'CLEAR_LOW','CLEAR_HIGH','BUILD']);
  assert.deepEqual([...prod.ordered(project,'K02').done.keys()],[prefix('K02')[0]]);
  assert.equal(prod.ordered(project,'K03').done.size,0);
  productionStore(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM erebor_finished_plans').get().n,2);
 }finally{db.close();}
});
