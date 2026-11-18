import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ereborFeeder} from '../src/erebor-feeder.js';

// Exercise the production feeder with persisted mixed-slot jobs: preparing D–I
// reservations must neither enlarge nor block the original A/B/C supply lease.
test('legacy feeder isolates A/B/C from persisted new-group reservations',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE erebor_queue_sites(site TEXT,state TEXT);
   CREATE TABLE erebor_queue_config(id INTEGER,version INTEGER);
   CREATE TABLE build_projects(id TEXT,current_version INTEGER);
   CREATE TABLE cannons(name TEXT,status_json TEXT,options_json TEXT);
   CREATE TABLE erebor_helpers(site TEXT,version INTEGER,slot TEXT,job TEXT);
   INSERT INTO erebor_queue_config VALUES(1,12);
   INSERT INTO build_projects VALUES('erebor',12);`);
  const job=slot=>({loaded:true,phase:'stone',blocks:64,size:[1,1,1],desired:{
   owner:'Erebor',blueprint:'EREBOR_STEIN_K12_'+slot+'_V12',file:'upload-'+slot,
   sha256:'a'.repeat(64),anchor:[0,0,0],options:{replace_mode:2,skip_missing:false,replace_block_entities:false}}});
  db.prepare('INSERT INTO erebor_queue_sites VALUES(?,?)').run('K12',JSON.stringify({job:job('A')}));
  for(const slot of ['B','C','D','E','F','G','H','I'])db.prepare('INSERT INTO erebor_helpers VALUES(?,?,?,?)').run('K12',12,slot,JSON.stringify(job(slot)));
  const row={name:'erebor-K12',assignment:1,options_json:'{}',status_json:JSON.stringify({computerId:23,chestSide:'front',at:new Date().toISOString()})};
  db.prepare('INSERT INTO cannons VALUES(?,?,?)').run(row.name,row.status_json,row.options_json);
  let requested;
  const feeder=ereborFeeder(db,async(action,args)=>{
   assert.equal(action,'erebor-supply');requested=Object.keys(args.targets);
   return {at:Date.now()/1000,confirmed:Object.fromEntries(requested.map(slot=>[slot,{file:'upload-'+slot,placed:0}]))};
  },12,async()=>({version:12,sharedChest:4,at:Date.now(),stations:{}}));
  const plan=await feeder(row,{options:{paused:false},intervals:{}});
  assert.deepEqual(requested,['A','B','C']);
  assert.equal(plan.state,'feeding');
  assert.equal(plan.items.find(i=>i.item==='minecraft:stone').needed,192);
  assert.equal(db.prepare("SELECT count(*) n FROM erebor_helpers WHERE slot IN ('D','E','F','G','H','I')").get().n,6);
 }finally{db.close();}
});
