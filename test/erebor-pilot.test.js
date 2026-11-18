import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {registerMassif} from '../src/erebor-massif.js';

function fixture(){
 const db=new DatabaseSync(':memory:'),hooks=[];
 db.exec(`CREATE TABLE erebor_queue_sites(state TEXT); CREATE TABLE erebor_helpers(version INTEGER,site TEXT,slot TEXT,name TEXT,job TEXT,message TEXT,PRIMARY KEY(version,site,slot)); CREATE TABLE build_projects(id TEXT,current_version INTEGER,plan_json TEXT); INSERT INTO build_projects VALUES('erebor',12,'{}');`);
 const mass=registerMassif({get(){},post(){},addHook:(n,h)=>hooks.push(h)},{db,config:{worldSources:{}}},[{site:'K12',main:[0,20,0],B:[1,20,0],C:[2,20,0]}]);
 db.exec(`INSERT INTO erebor_massif_runs VALUES(12,1,'now'); INSERT INTO erebor_massif_blobs VALUES('hash',x'00');`);
 const add=(tile,x=10,sx=1)=>db.prepare(`INSERT INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(12,?,?,20,0,?,1,1,1,'hash','K12',1,0)`).run(tile,x,sx);
 return {db,mass,add,close:async()=>{for(const h of hooks)await h();db.close();}};
}
import {pilotScheduler} from '../src/erebor-pilot.js';

for(const mode of ['success','stale-start-inspection','future-start-inspection','prepare-denied','lease-denied','supply-denied','physical-proof-denied','paused-during-inspect','credential-revoked','job-changed','claim-stolen'])test('scheduler guarded dispatch: '+mode,async()=>{
 const f=fixture();try{
  f.db.exec(`CREATE TABLE erebor_queue_config(id INTEGER,version INTEGER,enabled INTEGER,phase TEXT); INSERT INTO erebor_queue_config VALUES(1,12,1,'stone'); CREATE TABLE cannons(name TEXT,options_json TEXT); INSERT INTO cannons VALUES('erebor-K12','{}');`);
  for(const t of ['ONE','TWO','THREE'])f.add(t);
  const calls=[],observed={};
  const request=async(action,args)=>{
   calls.push(action);
   if(mode==='paused-during-inspect')f.db.exec(`UPDATE cannons SET options_json='{"paused":true}'`);
   if(mode==='credential-revoked')f.db.exec('DELETE FROM erebor_group_feeders');
   if(mode==='job-changed')f.db.exec("UPDATE erebor_helpers SET job='null' WHERE slot='D'");
   if(mode==='claim-stolen')f.db.exec("UPDATE erebor_pilot_claim SET owner='other'");
   if(mode==='prepare-denied'&&action==='erebor-prepare')throw Error('observe-only controller');
   if(action==='erebor-inspect'&&observed[args.site]&&mode.endsWith('start-inspection'))return {observed:{...observed[args.site],at:Date.now()/1000+(mode==='future-start-inspection'?1:-11)}};
   if(action==='erebor-inspect')return {observed:observed[args.site]||{inputEmpty:true,state:'STOPPED',amountPlaced:0,amountToPlace:0,flyingBlocks:0,printer:{DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'},at:Date.now()/1000}};
   if(action==='erebor-prepare'){
    const d=args.desired;
    observed[args.site]={state:'STOPPED',amountPlaced:0,flyingBlocks:0,outputCount:0,at:Date.now()/1000,inputEmpty:false,
      fileHash:d.sha256,item:'create:schematic',printer:{},options:{replace_mode:2,skip_missing:false,replace_block_entities:false},components:{
       'create:schematic_file':d.file,'create:schematic_owner':d.owner,'create:schematic_anchor':d.anchor,'create:schematic_rotation':d.rotation,'create:schematic_mirror':d.mirror,'create:schematic_deployed':1,'create:schematic_bounds':args.size}};
    return {applied:true,observed:observed[args.site]};
   }
   if(action==='erebor-group-proof')return {verified:mode!=='physical-proof-denied',jobs:args.jobs,at:Date.now()};
   if(action==='erebor-target-leases')return {published:mode!=='lease-denied',lease:args};
   if(action==='erebor-start')return {started:true,observed:{...observed[args.site],state:'RUNNING',printer:{Anchor:args.desired.anchor}}};
   throw Error(action);
  };
  const supply=async()=>({state:mode==='supply-denied'?'alignment':'feeding',options:{paused:false}});
  const scheduler=pilotScheduler(f.db,f.mass,request,supply);
  assert.deepEqual(await scheduler.tick(),{state:'disabled'});assert.deepEqual(calls,[]);
  f.db.exec(`CREATE TABLE erebor_group_feeders(site TEXT,group_id TEXT,version INTEGER,computer_id INTEGER,chest_side TEXT,token_hash TEXT); INSERT INTO erebor_group_feeders VALUES('K12','DEF',12,50,'front','test-only-hash');`);
  await assert.rejects(scheduler.tick({site:'K12',version:12,group:'DEF',positions,computerId:99,chestSide:'front'}),/Pilotbindung/);
  assert.deepEqual(calls,[]);
  if(mode!=='success'){
   await assert.rejects(scheduler.tick({site:'K12',version:12,group:'DEF',positions,computerId:50,chestSide:'front'}));
   assert.ok(!calls.includes('erebor-start'));
   return;
  }
  const result=await scheduler.tick({site:'K12',version:12,group:'DEF',positions,computerId:50,chestSide:'front'});
  assert.equal(result.state,'started');assert.equal(result.started.length,3);
  assert.ok(calls.indexOf('erebor-target-leases')<calls.indexOf('erebor-start'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM erebor_helpers WHERE json_extract(job,\'$.started\')=1').get().n,3);
 }finally{await f.close();}
});
test('pilot allocation rejects other sites, stale versions, occupied catalog anchors and unreachable volume',async()=>{
 const f=fixture();try{
  for(const t of ['ONE','TWO','THREE'])f.add(t);
  assert.throws(()=>f.mass.reserveGroup(12,'K12','DEF',{...positions,F:positions.D}));
  assert.throws(()=>f.mass.reserveGroup(12,'K13','DEF',positions));
  assert.equal(f.mass.reserveGroup(11,'K12','DEF',positions),null);
  f.db.exec('UPDATE erebor_massif_tiles SET sx=256');
  assert.equal(f.mass.reserveGroup(12,'K12','DEF',positions),null);
  f.db.exec('UPDATE erebor_massif_tiles SET sx=1');
  f.db.prepare('INSERT INTO erebor_queue_sites VALUES(?)').run(JSON.stringify({job:{desired:{anchor:[10,20,0]}}}));
  assert.equal(f.mass.reserveGroup(12,'K12','DEF',positions),null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM erebor_helpers').get().n,0);
 }finally{await f.close();}
});
const positions={D:[0,20,1],E:[0,20,2],F:[0,20,3]};
test('pilot atomically reserves a full group into real helper rows or no tiles',async()=>{
 const f=fixture();try{
  f.add('ONE');f.add('TWO');
  assert.equal(f.mass.reserveGroup(12,'K12','DEF',positions),null);
  assert.equal(f.db.prepare('SELECT count(*) n FROM erebor_massif_tiles WHERE site IS NOT NULL').get().n,0);
  f.add('THREE');const jobs=f.mass.reserveGroup(12,'K12','DEF',positions);
  assert.deepEqual(Object.keys(jobs),['D','E','F']);
  assert.equal(new Set(Object.values(jobs).map(r=>r.job.desired.file)).size,3);
  assert.equal(f.db.prepare('SELECT count(*) n FROM erebor_helpers').get().n,3);
  assert.deepEqual(f.mass.reserveGroup(12,'K12','DEF',positions),jobs);
 }finally{await f.close();}
});
