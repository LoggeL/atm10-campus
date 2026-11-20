import test from 'node:test';
import assert from 'node:assert/strict';
import { freshFleet, slotDetail, stationCounts, workloadDetails } from '../public/assets/erebor-progress-view.js';

test('dashboard distinguishes fresh and unknown per-slot progress, expires speed and escapes plan names', () => {
  const fleet = ['A', 'B', 'C'].map((slot, i) => ({
    site: 'K01',
    slot,
    file: '<plan>',
    placed: 10 * (i + 1),
    total: 100 + i,
    state: 'placing',
  }));
  const data = { fleet, telemetryAt: 1000 };
  const speed = {
    cannons: [{ station: 'K01B', file: '<plan>', blocksPerSecond: 2, blocksPerHour: 7200, etaSeconds: 430 }],
  };
  const html = freshFleet(data, 1200)
    .rows.map((r) => slotDetail(r, speed))
    .join('');
  for (const t of ['10 / 100', '20 / 101', '30 / 102', '&lt;plan&gt;', '2 Blöcke/s', '7.200 Blöcke/h', '8 min'])
    assert.ok(html.includes(t), t);
  assert.equal(html.split('<progress').length - 1, 3);
  assert.equal(html.split('Blöcke/s').length - 1, 1);
  for (const at of [null, 0, 46001]) {
    const stale = freshFleet({ ...data, telemetryAt: at }, 46000);
    assert.equal(stale.fresh, false);
    for (const r of stale.rows) {
      assert.equal(r.state, 'unknown');
      assert.doesNotMatch(slotDetail(r, null), /<progress|Blöcke\/s|NaN|Infinity/);
    }
  }
  assert.doesNotMatch(slotDetail({ ...fleet[0], total: 0 }, null), /<progress|NaN|Infinity/);
});

test('dashboard keeps station remainder, separate stage totals, assigned block volume and manual scope', () => {
  const stone = { open: 100, inProgress: 3, done: 7, total: 110 };
  const massif = {
    open: 9,
    inProgress: 2,
    done: 4,
    total: 15,
    workload: { grossBlocks: 140, assignedBlocks: 40, manualBlocks: 9 },
  };
  const read = (m) => stationCounts({ massif: m, stages: { stone } });
  for (const [value, expected] of [
    [massif, 11],
    [{ ...massif, inProgress: 1, done: 5 }, 10],
    [{ ...massif, open: 0, inProgress: 0, done: 15 }, 0],
  ]) {
    assert.match(read(value), new RegExp(expected + ' ausstehend'));
    assert.match(read(value), /103 ausstehend/);
  }
  assert.match(read(null), /Massiv · Unbekannt/);
  const html = workloadDetails(massif, { total: 2 });
  for (const t of [
    '140',
    'davon 40',
    '9 Zielblöcke außerhalb der automatischen Urnenaufträge',
    '2 veröffentlichte Teile ohne Stationszuordnung',
  ])
    assert.ok(html.includes(t), t);
  assert.match(workloadDetails(null, null), /unbekannt/);
});
