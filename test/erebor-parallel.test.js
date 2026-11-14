import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildServer} from '../src/server.js';
import {parallelLayout} from '../src/erebor-parallel.js';
import {stoneNBT} from '../src/project-stone.js';
import {zipStore,storedZipEntry} from '../src/zip.js';

const fleet=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
test('all 111 cannons touch their existing chest and all additional placements stay in the original chunk',()=>{
  assert.equal(parallelLayout.sites.length,37);
  for(const pair of parallelLayout.sites){
    const main=fleet.sites.find(s=>s.site===pair.site);
    assert.deepEqual(pair.main,main.cannon);
    assert.deepEqual(pair.chest,main.chest);
    for(const p of [pair.B,pair.C]){
      assert.deepEqual([p[0]>>4,p[2]>>4],[main.cannon[0]>>4,main.cannon[2]>>4]);
      for(const k of ['chest','computer','bridge','connector','cannon'])assert.notDeepEqual(p,main[k]);
    }
    assert.notDeepEqual(pair.B,pair.C);
    for(const s of [pair.main,pair.B,pair.C])assert.equal(s.reduce((d,n,i)=>d+Math.abs(n-pair.chest[i]),0),1);
  }
});

test('three real queue entries start once, survive restart and reconcile the assistant receipt',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'erebor-triple-'));
  const options={replace_mode:0,skip_missing:false,replace_block_entities:false};
  const printer={DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'};
  const idle=()=>({state:'STOPPED',status:'idle',inputEmpty:true,amountPlaced:0,amountToPlace:0,flyingBlocks:0,options,printer,outputCount:0});
  const machines=Object.fromEntries(['K01','K01B','K01C'].map(k=>[k,idle()]));
  const started=[],receipts={},inspected=[];
  const bridge=async(action,b)=>{
    if(action==='erebor-live')return {version:12,sharedChest:4,at:Date.now(),stations:{K02:{},...Object.fromEntries(Object.entries(machines).map(([key,o])=>[key,{
      state:o.state,status:o.status,upload:o.components?.['create:schematic_file']||'',ready:true,placed:o.amountPlaced,total:100,finish:receipts[key]||null,
      aligned:!o.inputEmpty,owner:'Erebor',target:null,chunks:[],anchor:o.printer?.Anchor,size:o.components?.['create:schematic_bounds'],options:[0,false,false]
    }]))}};
    if(action==='erebor-supply'){
      const confirmed={};
      for(const [slot,t] of Object.entries(b.targets)){
        const o=machines[slot==='A'?b.site:b.site+slot];
        if(o.inputEmpty)continue;
        assert.equal(t.file,o.components['create:schematic_file']);
        confirmed[slot]={file:t.file,placed:o.amountPlaced};
      }
      return {confirmed,at:Date.now()/1000};
    }
    if(action==='erebor-inspect')inspected.push(b.site);
    let o=machines[b.site];
    assert.ok(o,b.site);
    if(action==='erebor-prepare'){
      assert.equal(o.inputEmpty,true);
      const d=b.desired;
      o={...idle(),state:'PAUSED',status:'ready',inputEmpty:false,item:'create:schematic',fileHash:d.sha256,printer:{...printer,Anchor:d.anchor,CurrentPos:[-1,0,0]},
        components:{'create:schematic_file':d.file,'create:schematic_owner':'Erebor','create:schematic_anchor':d.anchor,'create:schematic_bounds':b.size,'create:schematic_deployed':1,'create:schematic_mirror':'none','create:schematic_rotation':'none'}};
    }else if(action==='erebor-start'){
      assert.equal(o.components['create:schematic_file'],b.desired.file);
      o={...o,state:'RUNNING',status:'placing'};
      started.push([b.site,b.desired.blueprint]);
    }else assert.equal(action,'erebor-inspect');
    machines[b.site]=o;
    return {observed:{...o,at:Date.now()/1000},applied:true,started:true};
  };
  const boot=()=>buildServer({dataDir:directory,worldSources:{},publicUrl:'http://test',bootstrapInvite:'triple-test',cookieSecure:false,snapshotIntervalMin:0,cannonBridgeRequest:bridge});
  let app=await boot();
  async function close(){await app.close();app.campus.db.close();}
  async function until(check){const end=Date.now()+6000;while(!check()&&Date.now()<end)await new Promise(r=>setTimeout(r,25));assert.ok(check(),JSON.stringify(started));}
  const path='/api/projects/erebor/planfolge';
  try{
    const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'triple-test',username:'test',password:'erebor-triple-test'}});
    const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
    const post=(url,payload)=>app.inject({method:'POST',url,headers,payload});
    const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:fleet.sites.map(s=>({id:s.site,position:s.planned}))}};
    assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}})).statusCode,200);
    const db=app.campus.db;db.prepare("UPDATE build_projects SET current_version=12 WHERE id='erebor'").run();
    const bytes=stoneNBT([1,1,1],[[0,0,0]]),sha=createHash('sha256').update(bytes).digest('hex');
    const files=Array.from({length:5},(_,i)=>({fileName:'EREBOR_STEIN_K01_X0'+i+'_V12.nbt',cannon:'K01',origin:[-252+i,32,-11010],size:[1,1,1],blocks:1,sha256:sha}));
    db.prepare("INSERT INTO project_stone_packages VALUES('erebor',12,'K01',1,?,?,?,?,NULL)").run('ok',zipStore(files.map(f=>({name:f.fileName,data:bytes}))),JSON.stringify({files,skipped:[]}),new Date().toISOString());
    const mode=()=>post(path+'/automatik',{site:'K01',version:12,enabled:true});
    assert.equal((await mode()).statusCode,200);
    await until(()=>started.length===3);
    assert.deepEqual(started.map(([k])=>k),['K01','K01B','K01C']);
    assert.equal(new Set(started.map(([,n])=>n)).size,3);
    const supply=async()=>(await app.inject({url:'/api/cannons/erebor-K01/plan',headers})).json();
    await post('/api/cannons/erebor-K01/status',{computerId:17,chestSide:'right'});
    const three=await supply();
    assert.equal(three.alignment.probeMode,'shared');assert.equal(three.items[0].needed,3);
    const main=machines.K01;
    machines.K01=idle();
    const two=await supply();
    assert.equal(two.items[0].needed,2);assert.notEqual(two.assignment,three.assignment);
    machines.K01=main;
    assert.equal((await post(path+'/laden',{site:'K01',version:12,sourceVersion:12,part:1,file:files[1].fileName,sha256:sha})).statusCode,409);
    const dash='/api/projects/erebor/cannon-sites/dreierbetrieb';
    assert.equal((await app.inject({url:dash})).statusCode,401);
    const view=(await app.inject({headers,url:dash+'?format=json'})).json();
    assert.equal(view.stations.length,37);assert.equal(view.stations[0].helpers[0].job.name,started[1][1]);
    const before=Date.now(),file=machines.K01B.components['create:schematic_file'];
    await close();app=await boot();
    receipts.K01B={file,at:before+1,before,oldCount:0,newCount:1};
    machines.K01B={...idle(),status:'finished',outputItem:'create:empty_schematic',outputCount:1};
    await mode();
    await until(()=>app.campus.ereborHelpers.list(12).find(r=>r.slot==='B')?.completed===1);
    await until(()=>started.length===4);
    await post(path+'/dreierbetrieb',{version:12,enabled:false});
    assert.equal(app.campus.ereborHelpers.isEnabled(12),false);
    await new Promise(r=>setTimeout(r,1600));
    await post(path+'/dreierbetrieb',{version:12,enabled:true});
    await until(()=>started.length===4);
    assert.equal(started[3][0],'K01B');assert.equal(new Set(started.map(([,n])=>n)).size,4);
    assert.equal(app.campus.db.prepare('SELECT count(*) n FROM erebor_finished_plans').get().n,1);
    const fleetStart=await post(path+'/dreierbetrieb',{version:12,enabled:true,allMains:true});
    assert.equal(fleetStart.statusCode,200);
    assert.equal(app.campus.db.prepare('SELECT count(*) n FROM erebor_automatic WHERE enabled=1 AND version=12').get().n,37);
    await until(()=>inspected.includes('K03')); // Missing tracker entry falls back to the native check.
    assert.equal(inspected.includes('K02'),false); // Explicitly reported absent or sleeping.
    const liveDb=app.campus.db;
    liveDb.prepare("UPDATE erebor_queue_sites SET state=json_set(state,'$.job.tainted',json('true')) WHERE site='K01'").run();
    const threeAgain=await supply();
    assert.equal(threeAgain.items[0].needed,3);
    assert.equal(liveDb.prepare("SELECT json_extract(state,'$.job.tainted') t FROM erebor_queue_sites WHERE site='K01'").get().t,1);
    for(const key of ['K01','K01C'])Object.assign(machines[key],{state:'PAUSED',status:'ready'});
    await new Promise(r=>setTimeout(r,1600));
    const resumeUrl=path+'/fortsetzen';
    assert.equal((await app.inject({method:'POST',url:resumeUrl,payload:{version:12}})).statusCode,401);
    const resume=await post(resumeUrl,{version:12});
    assert.equal(resume.statusCode,202);assert.deepEqual(resume.json().queued,['K01A','K01C']);
    await until(()=>started.length===6);
    assert.deepEqual(started.slice(4).map(([key])=>key),['K01','K01C']);
    await new Promise(r=>setTimeout(r,1600));
    assert.deepEqual((await post(resumeUrl,{version:12})).json().queued,[]);
    const download=path+'/drucker-reparatur.zip';
    assert.equal((await app.inject({url:download})).statusCode,401);
    machines.K01C.status='searching';
    await new Promise(r=>setTimeout(r,1600));
    const pack=await app.inject({url:download,headers});
    assert.equal(pack.statusCode,200);
    const command=storedZipEntry(pack.rawPayload,'data/campus/function/erebor_drucker.mcfunction').toString().trim();
    assert.equal(command.split('\n').length,1);
    assert.ok(command.includes(machines.K01C.components['create:schematic_file']));
    assert.ok(command.includes('MissingItem:{id:"minecraft:stone"}'));
    assert.ok(command.includes('CurrentPos:[I;-1,0,0]'));
    assert.ok(command.endsWith(' MissingItem'));
  }finally{await close();rmSync(directory,{recursive:true,force:true});}
});
