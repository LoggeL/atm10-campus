import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atmStarStockRequest, buildAtmStarPlan, readAtmStarPlan, saveAtmStarStock } from '../src/atm-star.js';
import { buildServer } from '../src/server.js';

const counts = () => Object.fromEntries(atmStarStockRequest.rules.map(({ key }) => [key, 0]));
const group = (plan, id) => plan.groups.find(g => g.alternatives[0].id === id);

test('the two-level startup recipe lists 18 Stars and the unobserved stock stays unknown', () => {
  const plan = buildAtmStarPlan(null);
  assert.equal(plan.goal, 18);
  assert.equal(plan.groups.length, 13);
  const renderedRows = plan.groups.flatMap(row => [row, ...row.ingredients]);
  const icons = renderedRows.flatMap(row => row.alternatives.map(option => option.icon));
  assert.ok(icons.every(index => Number.isInteger(index) && index >= 0 && index < plan.iconGrid.columns * plan.iconGrid.rows));
  assert.ok(renderedRows.filter(row => row.alternatives.length > 1).every(row => new Set(row.alternatives.map(option => option.icon)).size === row.alternatives.length));
  assert.equal(plan.stock, null);
  assert.equal(plan.stars, null);
  const compressed = group(plan, 'allthecompressed:nether_star_block_3x');
  assert.equal(compressed.needed, 270);
  assert.equal(compressed.ingredients[0].needed, 2430);
  const seed = group(plan, 'allthetweaks:dimensional_seed');
  const obsidian = seed.ingredients.find(i => i.alternatives[0].id === 'allthecompressed:obsidian_5x');
  assert.equal(obsidian.needed, 18);
  assert.equal(obsidian.alternatives[0].inMe, null);
});

test('stock reduces the remaining batches and shared materials are allocated once', () => {
  const plan = buildAtmStarPlan({ counts: {
    ...counts(), 'allthetweaks:atm_star': 3, 'allthetweaks:atm_star_block': 1,
    'allthecompressed:nether_star_block_3x': 5, 'allthecompressed:nether_star_block_2x': 6,
    'allthemodium:piglich_heart_block': 337, 'allthetweaks:dimensional_seed': 5,
    'allthecompressed:obsidian_5x': 1, 'create:mechanical_arm': 4,
  }});
  assert.equal(plan.remainingStars, 6);
  const compressed = group(plan, 'allthecompressed:nether_star_block_3x');
  assert.equal(compressed.missing, 85);
  assert.equal(compressed.ingredients[0].missing, 759);
  const dragon = group(plan, 'allthetweaks:dragon_soul');
  const hearts = dragon.ingredients.find(i => i.alternatives[0].id === 'allthemodium:piglich_heart_block');
  assert.equal(hearts.alternatives[0].allocated, 1);
  assert.equal(hearts.missing, 5);
  const motor = group(plan, 'allthetweaks:nexium_emitter').ingredients.find(i => i.alternatives.length === 2);
  assert.equal(motor.missing, 2);
  assert.equal(group(plan, 'allthetweaks:dimensional_seed').ingredients.find(i => i.alternatives[0].id === 'allthecompressed:obsidian_5x').missing, 0);
});

test('the Campus checklist requires a session and rejects incomplete and obsolete stock reports', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-atm-star-'));
  const app = await buildServer({
    dataDir: dir, worldSources: {}, bootstrapInvite: 'atm-star-test',
    publicUrl: 'http://test', cookieSecure: false, snapshotIntervalMin: 0,
  });
  try {
    assert.equal((await app.inject('/atm-star')).statusCode, 302);
    assert.equal((await app.inject('/api/atm-star')).statusCode, 401);
    const login = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      code: 'atm-star-test', username: 'player', password: 'atm-star-test-password',
    }});
    const headers = { cookie: login.headers['set-cookie'].split(';')[0] };
    const page = await app.inject({ url: '/atm-star', headers });
    assert.match(page.body, /data-section="atm-star" aria-current="page"/);
    const stock = counts();
    stock['allthetweaks:atm_star'] = 2;
    saveAtmStarStock(app.campus.db, 'old', { revision: 'old', counts: stock });
    saveAtmStarStock(app.campus.db, 'incomplete', { revision: atmStarStockRequest.revision, counts: {} });
    assert.equal(readAtmStarPlan(app.campus.db).stock, null);
    saveAtmStarStock(app.campus.db, 'ME test', { revision: atmStarStockRequest.revision, counts: stock });
    const api = await app.inject({ url: '/api/atm-star', headers });
    assert.equal(api.statusCode, 200);
    assert.match(api.headers['cache-control'], /no-store/);
    assert.equal(api.json().remainingStars, 16);
    assert.equal(api.json().stock.source, 'ME test');
  } finally {
    await app.close();
    app.campus.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
