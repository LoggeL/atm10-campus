import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {massifProgress} from '../src/erebor-progress.js';

test('unfinished automatic volume includes pending reservations and keeps manual and unassigned work separate',()=>{
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE erebor_urn_jobs(v,site,points); CREATE TABLE erebor_massif_tiles(v,tile,home,site,special,done,blocks);
      INSERT INTO erebor_massif_tiles VALUES
      (12,'SOLID','K01',NULL,0,0,100),(12,'CAVITY_LUFT','K02','K01',0,0,40),
      (12,'TARGET_BE','K01',NULL,1,0,9),(12,'DONE','K01',NULL,0,1,999),(12,'UNASSIGNED',NULL,NULL,0,0,3)`);
    const read=(v=12)=>massifProgress(db,v,['K01','K02']);
    const report=read();
    assert.deepEqual(report.total.workload,{grossBlocks:143,assignedBlocks:40,manualBlocks:9});
    assert.deepEqual(report.stations.K01.workload,{grossBlocks:140,assignedBlocks:40,manualBlocks:9});
    assert.equal(report.stations.K02.workload.grossBlocks,0);
    assert.equal(report.unassigned.workload.grossBlocks,3);
    db.exec("UPDATE erebor_massif_tiles SET site='K01' WHERE tile='SOLID'");
    assert.equal(read().total.workload.grossBlocks,143);
    db.exec("UPDATE erebor_massif_tiles SET done=1 WHERE tile='SOLID'");
    assert.equal(read().total.workload.grossBlocks,43);
    assert.deepEqual(read(13).total.workload,{grossBlocks:0,assignedBlocks:0,manualBlocks:0});
  } finally {db.close();}
});
