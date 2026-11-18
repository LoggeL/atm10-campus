import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {DatabaseSync} from 'node:sqlite';
import {registerGroupFeeders} from '../src/erebor-group-feeders.js';

test('dedicated DEF auth binds native delivery relay to persisted jobs and rejects changed snapshot',async()=>{
 const db=new DatabaseSync(':memory:'),app=Fastify();
 db.exec(`CREATE TABLE erebor_helpers(site TEXT,version INTEGER,slot TEXT,job TEXT);
 CREATE TABLE erebor_queue_sites(site TEXT,state TEXT);
 CREATE TABLE erebor_queue_config(id INTEGER,version INTEGER,enabled INTEGER,phase TEXT);
 CREATE TABLE build_projects(id TEXT,current_version INTEGER);
 CREATE TABLE cannons(name TEXT,options_json TEXT);
 INSERT INTO erebor_queue_config VALUES(1,12,1,'stone');
 INSERT INTO build_projects VALUES('erebor',12);
 INSERT INTO cannons VALUES('erebor-K12','{}');`);
 for(const s of 'DEF')db.prepare('INSERT INTO erebor_helpers VALUES(?,?,?,?)').run('K12',12,s,JSON.stringify({loaded:true,desired:{file:s,anchor:[1,2,3]},size:[1,1,1]}));
 const mapping={site:'K12',group:'DEF',version:12,computerId:50,chestSide:'front',dispatchProtocol:1};
 const calls=[];let mutate=false;
 const campus={db,config:{ereborPilot:mapping},ereborFeeder:async()=>({state:'feeding',options:{paused:false},items:[{item:'minecraft:stone',needed:64}]}),ereborGroupRequest:async(action,args)=>{
  calls.push([action,args]);
  if(mutate)db.exec("UPDATE erebor_helpers SET job='{}' WHERE slot='F'");
  return action==='erebor-dispatch-grant'?{authorized:true,expiresAt:args.expiresAt}:{id:'challenge',before:0,cap:64,expiresAt:Date.now()+5000};
 }};
 const service=registerGroupFeeders(app,campus),token=service.register(mapping);
 const post=(group='DEF',payload={computerId:50,chestSide:'front',cap:64})=>app.inject({method:'POST',url:`/api/erebor/groups/K12/${group}/delivery/begin`,headers:{authorization:'Bearer '+token},payload});
 try{
  assert.equal((await post('GHI')).statusCode,401);
  const response=await post();assert.equal(response.statusCode,200);assert.equal(response.json().id,'challenge');
  assert.deepEqual(calls.map(c=>c[0]),['erebor-dispatch-grant','erebor-group-delivery']);
  assert.deepEqual(Object.keys(calls[0][1].jobs),['K12D','K12E','K12F']);
  assert.equal((await post('DEF',{computerId:51,chestSide:'front',cap:64})).statusCode,403);
  assert.equal((await post('DEF',{computerId:50,chestSide:'front',cap:193})).statusCode,400);
  mutate=true;assert.equal((await post()).statusCode,409);
 }finally{await app.close();db.close();}
});
