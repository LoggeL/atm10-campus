import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {massifProgress} from '../src/erebor-progress.js';
import { dashboardData } from '../src/erebor-dashboard.js';

test('dashboard separates published tasks, reports actual slot/home, and expires all native progress', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE erebor_massif_tiles(v,tile,home,site,slot,special,done,blocks);
      INSERT INTO erebor_massif_tiles VALUES (12,'FIX_R2_LUFT','K01','K02','B',0,0,80),(12,'SOLID','K02','K02','C',0,1,5),
      (12,'MANUAL','K02',NULL,NULL,1,0,2),(12,'X01_Z00_URN_10_2_5_BE','K02',NULL,NULL,1,0,1),
      (12,'FREE','K01',NULL,NULL,0,0,10),(11,'OLD','K01',NULL,NULL,0,0,20)`);
    const report = {
      at: 1000,
      version: 12,
      stations: {
        K01: { state: 'STOPPED', empty: true },
        K02B: { state: 'RUNNING', status: 'placing', upload: 'current', aligned: true, placed: 23, total: 80 },
      },
    };
    const jobs = new Map([['K02B', { loaded: true, desired: { file: 'current', blueprint: 'STONE' } }]]);
    const read = (now) =>
      dashboardData(
        db,
        12,
        ['K01', 'K02'],
        report,
        jobs,
        massifProgress(db,12,['K01','K02']).filling,
        { enabled: () => true, lastBalancedAt: () => null },
        now,
      );
    const before = db.prepare('SELECT total_changes() n').get().n;
    const view = read(1200);
    assert.equal(view.fleet.length, 6);
    assert.equal(view.filling.solid.done, 1);
    assert.equal(view.filling.solid.open, 1);
    assert.equal(view.filling.cavity.inProgress, 1);
    assert.equal(view.filling.manual.open, 1);
    assert.equal(view.filling.urn.open, 1);
    assert.equal(view.fleet[0].state, 'idle');
    assert.equal(view.fleet[1].state, 'unknown');
    const helper = view.fleet.find((r) => r.site === 'K02' && r.slot === 'B');
    assert.equal(helper.home, 'K01');
    assert.equal(helper.placed, 23);
    assert.equal(helper.state, 'placing');
    assert.ok(read(47000).fleet.every((r) => r.state === 'unknown' && r.placed === null));
    report.stations.K02B.upload = 'other';
    assert.equal(read(1200).fleet[4].state, 'unverified');
    assert.equal(db.prepare('SELECT total_changes() n').get().n, before);
  } finally {
    db.close();
  }
});
