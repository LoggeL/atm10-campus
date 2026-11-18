import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { massifForecast, massifProgress } from '../src/erebor-progress.js';
import { forecastView } from '../public/assets/erebor-progress-view.js';

test('fleet ETA compares outstanding automatic volume to recent receipts and survives stopped production without a false deadline', () => {
  const db = new DatabaseSync(':memory:');
  const now = Date.parse('2026-11-18T15:00:00Z');
  try {
    db.exec(`CREATE TABLE erebor_massif_runs(v,created);
      CREATE TABLE erebor_massif_tiles(v,tile,home,site,special,done,blocks);
      CREATE TABLE erebor_finished_plans(version,site,name,finished_at);
      INSERT INTO erebor_massif_runs VALUES(12,'2026-11-17T00:00:00.000Z');
      INSERT INTO erebor_massif_tiles VALUES
        (12,'SOLID','K01','K01',0,1,200),(12,'HOLE_LUFT','K02','K01',0,1,100),
        (12,'OLD','K01','K01',0,1,1000),(12,'BE','K01','K01',1,1,2000),
        (12,'OPEN','K01',NULL,0,0,500),(12,'BUSY','K02','K01',0,0,100);
      INSERT INTO erebor_finished_plans VALUES
        (12,'K01','EREBOR_STEIN_K01_MASSIV_SOLID_V12','2026-11-18T13:01:00.000Z'),
        (12,'K01','EREBOR_STEIN_K01_MASSIV_HOLE_LUFT_V12','2026-11-18T14:59:00.000Z'),
        (12,'K01','EREBOR_STEIN_K01_MASSIV_OLD_V12','2026-11-18T11:00:00.000Z'),
        (12,'K01','EREBOR_STEIN_K01_MASSIV_BE_V12','2026-11-18T14:59:00.000Z'),
        (12,'K01','CATALOG_V12','2026-11-18T14:59:00.000Z'),
        (11,'K01','EREBOR_STEIN_K01_MASSIV_OLD_V11','2026-11-18T14:59:00.000Z');`);
    const filling = () => massifProgress(db, 12, ['K01', 'K02']).filling;
    const read = (enabled = true, at = now) => massifForecast(db, 12, filling(), enabled, at);
    const forecast = read();
    assert.deepEqual(forecast, {
      state: 'estimated',
      remainingBlocks: 600,
      completedParts: 2,
      windowSeconds: 7200,
      blocksPerHour: 150,
      seconds: 14400,
      finishAt: now + 14400000,
    });
    assert.match(forecastView(forecast), /Noch ca. 4 Std./);
    assert.match(forecastView(forecast), /20:00 Uhr \(Berlin\)/);
    assert.equal(read(false).state, 'paused');
    db.exec("UPDATE erebor_finished_plans SET finished_at='2026-11-18T14:20:00.000Z' WHERE name LIKE '%HOLE%'");
    assert.equal(read().state, 'inactive');
    db.exec("UPDATE erebor_massif_runs SET created='2026-11-18T14:55:00.000Z'");
    assert.equal(read().state, 'sampling');
    assert.equal(massifForecast(db, 12, null, true, now).state, 'unknown');
    db.exec('UPDATE erebor_massif_tiles SET done=1');
    assert.equal(read(false).state, 'complete');
    assert.doesNotMatch(forecastView({ state: 'offline' }), /Uhr|Noch ca/);
  } finally {
    db.close();
  }
});
