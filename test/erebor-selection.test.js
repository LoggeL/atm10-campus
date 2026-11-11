import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildServer} from '../src/server.js';
import {stoneNBT} from '../src/project-stone.js';
import {zipStore} from '../src/zip.js';
import {unstarted} from '../src/erebor-selection.js';

const layout=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
const printer={DeferredBlocks:[],PrintStage:'BLOCKS',EntityProgress:-1};
const options={replace_mode:0,skip_missing:false,replace_block_entities:false};
const empty=()=>({inputEmpty:true,state:'STOPPED',status:'idle',amountPlaced:0,amountToPlace:0,flyingBlocks:0,printer,outputCount:0,options});
test('manual plan button changes an unstarted job and queues behind a running job with auto refill paused',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-pick-')),commands=[];
 let native=empty();
 const bridge=async(action,args)=>{
  assert.equal(args.site,'K01');if(action==='erebor-prepare'){
   const d=args.desired;
   if(!native.inputEmpty){assert.ok(unstarted({desired:{anchor:native.printer.Anchor}},native));assert.equal(args.previous.file,native.components['create:schematic_file']);}
   commands.push(args);
   native={...empty(),inputEmpty:false,state:'PAUSED',status:'noGunpowder',item:'create:schematic',fileHash:d.sha256,printer:{...printer,Anchor:d.anchor,CurrentPos:[-1,0,0]},
    components:{'create:schematic_file':d.file,'create:schematic_owner':'Erebor','create:schematic_anchor':d.anchor,'create:schematic_bounds':args.size,'create:schematic_rotation':'none','create:schematic_mirror':'none','create:schematic_deployed':1}};
  }else if(action==='erebor-supply'){assert.equal(args.computerId,12);assert.equal(args.chestSide,'right');}else assert.equal(action,'erebor-inspect');
  return {applied:true,observed:{...native,at:Date.now()/1000}};
 };
 const app=await buildServer({dataDir:dir,worldSources:{},bootstrapInvite:'selection-ui',snapshotIntervalMin:0,cookieSecure:false,publicUrl:'http://test',cannonBridgeRequest:bridge});
 const db=app.campus.db,base='/api/projects/erebor/planfolge';
 try{
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'selection-ui',username:'tester',password:'selection-local-test'}});
  const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:layout.sites.map(s=>({id:s.site,position:s.planned}))}};
  assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}})).statusCode,200);
  db.prepare("UPDATE build_projects SET current_version=12 WHERE id='erebor'").run();
  const bytes=stoneNBT([2,2,2],[[0,0,0]]),sha=createHash('sha256').update(bytes).digest('hex');
  const files=[1,2,3].map(i=>({fileName:'EREBOR_STEIN_K01_X0'+i+'_Z01_H00_V12.nbt',sha256:sha,cannon:'K01',origin:[-250+i,32,-11010],size:[2,2,2],blocks:1}));
  db.prepare("INSERT INTO project_stone_packages VALUES('erebor',12,'K01',1,?,?,?, ?,NULL)").run('package',zipStore(files.map(f=>({name:f.fileName,data:bytes}))),JSON.stringify({files}),new Date().toISOString());
  const pick=(i,overrides={},h=headers)=>app.inject({url:base+'/laden',method:'POST',headers:h,payload:{site:'K01',version:12,sourceVersion:12,part:1,file:files[i].fileName,sha256:sha,...overrides}});
  const wait=async fn=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Zeitlimit');};
  assert.equal((await pick(0,{},{})).statusCode,401);assert.equal((await pick(0,{sha256:'0'.repeat(64)})).statusCode,409);
  assert.equal((await pick(0,{}, {...headers,origin:'https://other.invalid'})).statusCode,403);
  assert.equal((await pick(0)).statusCode,202);await wait(()=>commands.length===1);
  const feederUrl='/api/cannons/erebor-K01/plan';
  const supply=async()=>{const r=await app.inject({url:feederUrl,headers});assert.equal(r.statusCode,200);return r.json();};
  assert.equal((await supply()).options.gunpowder,0);
  const report=await app.inject({url:'/api/cannons/erebor-K01/status',method:'POST',headers,payload:{computerId:12,chestSide:'right'}});
  assert.equal(report.statusCode,200);
  const approved=await supply();assert.equal(approved.alignment.state,'aligned');assert.equal(approved.options.gunpowder,16);
  assert.deepEqual(approved.items,[{item:'minecraft:stone',needed:1,stack:64}]);
  const currentHash=native.fileHash;native.fileHash='0'.repeat(64);const rejected=await supply();
  assert.equal(rejected.options.gunpowder,0);assert.equal(rejected.options.paused,true);native.fileHash=currentHash;
  assert.equal((await pick(0)).json().status,'loaded');assert.equal(commands.length,1);
  assert.equal((await pick(1)).statusCode,202);await wait(()=>commands.length===2);assert.equal(commands[1].previous.file,commands[0].desired.file);
  native={...native,state:'RUNNING',status:'placing',amountPlaced:1,amountToPlace:2};
  const a=await pick(2),b=await pick(2);assert.equal(a.json().id,b.json().id);assert.equal(commands.length,2);
  native={...empty(),status:'finished',outputItem:'create:empty_schematic',outputCount:1};
  await pick(2);await wait(()=>commands.length===3);assert.equal(commands[2].previous,undefined);assert.equal(commands[2].desired.blueprint,files[2].fileName.slice(0,-4));
  assert.equal((await app.inject({url:base,headers})).json().enabled,false);
 }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
