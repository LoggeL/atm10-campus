import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {ereborFeeder} from '../src/erebor-feeder.js';
import {registerGroupFeeders} from '../src/erebor-group-feeders.js';

test('authenticated DEF poll uses only D/E/F persisted demand and exact controller group identity',async()=>{
 const db=new DatabaseSync(':memory:');const app=Fastify();
 db.exec(`CREATE TABLE erebor_helpers(site TEXT,version INTEGER,slot TEXT,job TEXT);
 CREATE TABLE erebor_queue_sites(site TEXT,state TEXT);
 CREATE TABLE erebor_queue_config(id INTEGER,version INTEGER,enabled INTEGER);
 CREATE TABLE build_projects(id TEXT,current_version INTEGER);
 CREATE TABLE cannons(name TEXT,status_json TEXT,options_json TEXT);
 INSERT INTO erebor_queue_config VALUES(1,12,1);
 INSERT INTO build_projects VALUES('erebor',12);`);
 const job=slot=>({loaded:true,phase:'stone',blocks:64,size:[1,1,1],desired:{owner:'Erebor',blueprint:'EREBOR_STEIN_K12_'+slot,file:'upload-'+slot,sha256:'a'.repeat(64),anchor:[0,0,0],options:{replace_mode:2,skip_missing:false,replace_block_entities:false}}});
 db.prepare('INSERT INTO erebor_queue_sites VALUES(?,?)').run('K12',JSON.stringify({job:job('A')}));
 for(const slot of 'BCDEFGHI')db.prepare('INSERT INTO erebor_helpers VALUES(?,?,?,?)').run('K12',12,slot,JSON.stringify(job(slot)));
 db.exec(`INSERT INTO cannons VALUES('erebor-K12','{}','{}')`);
 let requested,partial=false,offline=false;
 const feeder=ereborFeeder(db,async(action,args)=>{
  if(offline)throw new Error('group controller unavailable');
  requested=args;assert.equal(action,'erebor-supply');
  return {at:Date.now()/1000,confirmed:Object.fromEntries(Object.keys(args.targets).filter(slot=>!partial||slot==='D').map(slot=>[slot,{file:'upload-'+slot,placed:0}]))};
 },12,async()=>({version:12,sharedChest:4,stations:{}}));
 const service=registerGroupFeeders(app,{db,ereborFeeder:feeder});
 const token=service.register({site:'K12',group:'DEF',version:12,computerId:50,chestSide:'front'});
 try{
  const response=await app.inject({method:'POST',url:'/api/erebor/groups/K12/DEF/plan',headers:{authorization:'Bearer '+token},payload:{computerId:50,chestSide:'front'}});
  assert.equal(response.statusCode,200);const plan=response.json();
  assert.equal(plan.state,'feeding');assert.equal(plan.items[0].needed,192);
  assert.deepEqual(Object.keys(requested.targets),['D','E','F']);
  assert.equal(requested.group,'DEF');assert.equal(requested.computerId,50);
  assert.equal(plan.options.autoCraft,false);assert.equal(plan.options.returnLeftovers,false);
  const other=await app.inject({method:'POST',url:'/api/erebor/groups/K12/GHI/plan',headers:{authorization:'Bearer '+token},payload:{computerId:50,chestSide:'front'}});
  assert.equal(other.statusCode,401);
  const poll=()=>app.inject({method:'POST',url:'/api/erebor/groups/K12/DEF/plan',headers:{authorization:'Bearer '+token},payload:{computerId:50,chestSide:'front'}});
  partial=true;
  const incomplete=(await poll()).json();assert.equal(incomplete.state,'alignment');assert.deepEqual(incomplete.items,[]);
  partial=false;offline=true;
  const failed=(await poll()).json();assert.equal(failed.options.paused,true);assert.deepEqual(failed.items,[]);
  offline=false;
  const duplicate=job('G');duplicate.desired.file='upload-D';
  db.prepare("UPDATE erebor_helpers SET job=? WHERE slot='G'").run(JSON.stringify(duplicate));
  assert.equal((await poll()).statusCode,409);
  db.prepare("UPDATE erebor_helpers SET job=? WHERE slot='G'").run(JSON.stringify(job('G')));
  db.exec(`UPDATE cannons SET options_json='{"paused":true}'`);
  assert.equal((await poll()).statusCode,409);
  db.exec(`UPDATE cannons SET options_json='{}'`);
  db.exec('UPDATE erebor_queue_config SET enabled=0');
  assert.equal((await poll()).statusCode,409);
 }finally{await app.close();db.close();}
});
