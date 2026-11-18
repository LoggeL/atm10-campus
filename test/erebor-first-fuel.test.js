import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parallelFleet} from '../src/erebor-parallel.js';

test('an acknowledged fuel wait is retried after refilling, ahead of the full survey, while existing pauses stay paused',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const options={replace_mode:2,skip_missing:false,replace_block_entities:false};
  const anchor=[-316,63,-10250],size=[8,8,8];
  const native=new Map(),signals={},calls=[];
  let starts=0;
  const request=async(action,{site})=>{
   const state=native.get(site);
   calls.push([action,site]);
   if(action==='erebor-start'){
    assert.equal(site,'K12D');
    if(++starts===1)Object.assign(state,{state:'PAUSED',status:'noGunpowder'});
    else Object.assign(state,{state:'RUNNING',status:'placing'});
   }else assert.equal(action,'erebor-inspect');
   return {started:true,observed:{...state,at:Date.now()/1000}};
  };
  const fleet=parallelFleet(db,{}, {},request,()=>false,()=>false);
  for(const [site,slot,started] of [['K04','B',true],['K12','D',false]]){
   const desired={file:'campus_'+site+slot+'.nbt',owner:'Erebor',anchor,rotation:'none',mirror:'none',version:12,
    blueprint:'EREBOR_STEIN_'+site+'_TEST_V12',sha256:'test-hash',options};
   const job={loaded:true,started,placed:0,baseline:0,seen:0,phase:'stone',desired,size};
   db.prepare('INSERT INTO erebor_helpers(version,site,slot,name,job) VALUES(12,?,?,?,?)')
     .run(site,slot,desired.blueprint,JSON.stringify(job));
   native.set(site+slot,{state:'PAUSED',status:'ready',item:'create:schematic',inputEmpty:false,fileHash:desired.sha256,
    printer:{Anchor:anchor},options,amountPlaced:0,amountToPlace:15,outputCount:0,flyingBlocks:0,
    components:{'create:schematic_file':desired.file,'create:schematic_owner':'Erebor','create:schematic_anchor':anchor,
     'create:schematic_bounds':size,'create:schematic_mirror':'none','create:schematic_rotation':'none','create:schematic_deployed':1}});
   signals[site+slot]={ready:true,aligned:true,state:'PAUSED',status:'ready',placed:0,upload:desired.file,owner:'Erebor',anchor,size};
  }
  const tick=()=>fleet.tick({current_version:12},{version:12,at:Date.now(),sharedChest:4,stations:signals},
    ()=>true,()=>({}),()=>true);
  await tick();
  assert.deepEqual(calls[0],['erebor-inspect','K12D']);
  assert.equal(fleet.jobAt(12,'K12','D').started,false);
  native.get('K12D').status='ready';
  await tick();
  assert.equal(fleet.jobAt(12,'K12','D').started,true);
  Object.assign(native.get('K12D'),{state:'PAUSED',status:'ready'});
  await tick();
  assert.equal(starts,2);
 }finally{db.close();}
});
