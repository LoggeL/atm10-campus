import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {productionStore} from '../src/erebor-production.js';
import {DESIGN_REVISION} from '../src/erebor-design.js';

test('counter projection separates catalog history from massif and deduplicates active reservations',async()=>{
 const {projectProgress}=await import('../src/erebor-progress.js');
 const db=new DatabaseSync(':memory:');
 try {
  db.exec(`CREATE TABLE erebor_queue_config(id,version,phase);
   CREATE TABLE project_stone_packages(project_id,version,cannon,part,report_json);
   CREATE TABLE project_architecture_packages(project_id,base_version,revision,package_id,report_json);
   CREATE TABLE erebor_massif_runs(v); CREATE TABLE erebor_massif_tiles(v,tile,home,site,slot,done,special DEFAULT 0,blocks DEFAULT 0);`);
  const production=productionStore(db),project={current_version:12,plan_json:'{}'};
  const files=['ACTIVE_V12','WAIT_V12','DONE_V12','WAIT_V12'].map(name=>({fileName:name+'.nbt',cannon:'K01',origin:[0,0,0]}));
  db.prepare('INSERT INTO project_stone_packages VALUES(?,?,?,?,?)').run('erebor',12,'K01',1,JSON.stringify({files}));
  for(const rev of [DESIGN_REVISION-1,DESIGN_REVISION]) db.prepare('INSERT INTO project_architecture_packages VALUES(?,?,?,?,?)').run('erebor',12,rev,'architecture',JSON.stringify({files:[{fileName:'ARCH'+rev+'.nbt',cannon:'K01',kind:'build',origin:[0,1,0]}]}));
  production.finish(12,'K01','DONE_V11','now');
  production.finish(12,'K01','MASSIF_HISTORY_V12','now');
  db.exec(`INSERT INTO erebor_massif_tiles (v,tile,home,site,slot,done) VALUES(12,'a','K01','K01','A',0),(12,'b','K01',NULL,NULL,0),(12,'c','K01','K02','B',1),(11,'old','K01',NULL,NULL,0);`);
  const job={desired:{version:12,blueprint:'ACTIVE_V12'}};
  const {counts}=projectProgress(db,production,project,['K01','K02'],[{site:'K01',job}, {site:'K01',name:'ACTIVE_V12',version:12,job}]);
  assert.deepEqual(counts.stations.K01.catalog,{open:2,inProgress:1,done:1});
  assert.deepEqual(counts.stations.K01.massif,{open:1,inProgress:1,done:0});
  assert.deepEqual(counts.stations.K02.massif,{open:0,inProgress:0,done:1});
  assert.deepEqual(counts.total.catalog,{open:2,inProgress:1,done:1});
  assert.deepEqual(counts.total.massif,{open:1,inProgress:1,done:1});
  assert.equal(counts.revision,DESIGN_REVISION);
 } finally {db.close();}
});
