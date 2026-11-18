import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { availableMassifSlots, planMassifWork } from '../src/erebor-balance.js';
import { registerMassif } from '../src/erebor-massif.js';

const stations = ['K01', 'K02'].map((site, i) => ({
  site,
  main: [i * 200, 0, 0],
  B: [i * 200, 0, 1],
  C: [i * 200, 0, -1],
}));
const mains = new Set(['K01', 'K02']);
const ready = { ready: true, state: 'STOPPED', options: [2, false, false] };
test('capacity uses fresh observed, enabled slots and their replacement modes', () => {
  const report = {
    at: 1000,
    version: 12,
    stations: {
      K01: ready,
      K01B: { ...ready, options: [0, false, false] },
      K01C: { ...ready, ready: false },
      K02: ready,
    },
  };
  const slots = availableMassifSlots(stations, report, 12, new Set(['K01']), true, 2000);
  assert.deepEqual(
    slots.map((s) => [s.site + s.slot, s.solids]),
    [
      ['K01A', true],
      ['K01B', false],
    ],
  );
  assert.deepEqual(availableMassifSlots(stations, report, 12, mains, true, 46000), []);
  assert.deepEqual(availableMassifSlots(stations, report, 13, mains, true, 2000), []);
  const tiles = [
    { tile: 'SOLID', x: -12, y: 0, z: 0, blocks: 100 },
    { tile: 'CAVITY_LUFT', x: 3, y: 0, z: 0, blocks: 50 },
    { tile: 'EDGE', x: -256, y: 0, z: 0, blocks: 1 },
  ];
  const plan = planMassifWork(tiles, slots);
  assert.equal(plan.get('SOLID'), 'K01A');
  assert.equal(plan.get('CAVITY_LUFT'), 'K01B');
  assert.ok(!plan.has('EDGE'));
});
test('a free cannon takes a neighboring plan even with its own work available and keeps its claim on retry', async () => {
  const db = new DatabaseSync(':memory:'),
    hooks = [];
  const app = { addHook: (name, fn) => hooks.push(fn), get() {}, post() {} };
  db.exec('CREATE TABLE erebor_queue_sites(state TEXT); CREATE TABLE erebor_helpers(version INTEGER,job TEXT)');
  const slots = availableMassifSlots(
    stations,
    { at: 2000, version: 12, stations: { K01: ready, K02: ready } },
    12,
    mains,
    false,
    2000,
  );
  const massif = registerMassif(app, { db, config: { worldSources: {} } }, stations, () => slots);
  try {
    db.exec("INSERT INTO erebor_massif_runs(v) VALUES(12); INSERT INTO erebor_massif_blobs VALUES('hash',x'01')");
    const add = db.prepare(
      "INSERT INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(12,?,?,0,0,1,1,1,?,'hash',?,1,0)",
    );
    add.run('ONLY_K01', -100, 100, 'K01');
    add.run('LOCAL_K02', 160, 15, 'K02');
    add.run('SHARED', 90, 130, 'K01');
    const first = massif.reserve(12, 'K02', 'A');
    // The pre-existing native home preference would choose LOCAL_K02.
    assert.equal(first.job.massif, 'SHARED');
    assert.deepEqual(massif.reserve(12, 'K02', 'A'), first);
    assert.equal(massif.reserve(12, 'K01', 'A').job.massif, 'ONLY_K01');
    assert.ok(massif.lastBalancedAt(12));
    massif.finish(12, 'SHARED', 'K02', 'A');
    assert.equal(massif.reserve(12, 'K02', 'A').job.massif, 'LOCAL_K02');
  } finally {
    for (const close of hooks) await close();
    db.close();
  }
});
