import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import Fastify from 'fastify';
import {registerGroupFeeders} from '../src/erebor-group-feeders.js';

test('group credentials bind one physical feeder; in-flight claims serialize and changed jobs revoke lease',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE erebor_helpers(version INTEGER,site TEXT,slot TEXT,job TEXT);
 CREATE TABLE erebor_queue_sites(site TEXT,state TEXT);
 CREATE TABLE cannons(name TEXT,options_json TEXT);
 INSERT INTO cannons VALUES('erebor-K12','{}');
 CREATE TABLE erebor_queue_config(id INTEGER,version INTEGER,enabled INTEGER);
 CREATE TABLE build_projects(id TEXT,current_version INTEGER);
 INSERT INTO erebor_queue_config VALUES(1,12,1);
 INSERT INTO build_projects VALUES('erebor',12);`);
 for(const slot of ['D','E','F'])db.prepare('INSERT INTO erebor_helpers VALUES(12,?,?,?)').run('K12',slot,JSON.stringify({loaded:true,desired:{file:'upload-'+slot}}));
 const app=Fastify();let finish,calls=0;
 const service=registerGroupFeeders(app,{db,ereborFeeder:async(row,opts,binding)=>{calls++;assert.equal(binding.group,'DEF');await new Promise(r=>finish=r);return {state:'feeding',alignment:{state:'aligned',leaseSeconds:10},items:[{item:'minecraft:stone',needed:192}]};}});
 const token=service.register({site:'K12',group:'DEF',version:12,computerId:50,chestSide:'front'});
 const poll=(credential=token,body={computerId:50,chestSide:'front'})=>app.inject({method:'POST',url:'/api/erebor/groups/K12/DEF/plan',headers:{authorization:'Bearer '+credential},payload:body});
 try{
  assert.equal((await poll('wrong')).statusCode,401);
  assert.equal((await poll(token,{computerId:51,chestSide:'front'})).statusCode,403);
  const first=poll();while(!finish)await new Promise(r=>setTimeout(r,1));
  assert.equal((await poll()).statusCode,409);assert.equal(calls,1);
  db.prepare("UPDATE erebor_helpers SET job=NULL WHERE slot='F'").run();finish();
  assert.equal((await first).statusCode,409);
  assert.equal((await poll()).statusCode,409); // incomplete group never grants a lease
  assert.equal(calls,1);
 }finally{await app.close();db.close();}
});
