import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atmStarStockRequest, buildAtmStarPlan, readAtmStarPlan, saveAtmStarStock } from '../src/atm-star.js';
import { buildServer } from '../src/server.js';

const counts = () => Object.fromEntries(atmStarStockRequest.rules.map(({ key }) => [key, 0]));
const group = (plan, id) => plan.groups.find(g => g.alternatives[0].id === id);

test('atmStarStockRequest revision stays pinned for live CC station compatibility', () => {
  assert.equal(atmStarStockRequest.revision, '0be7fca02c2e861d');
  assert.equal(atmStarStockRequest.rules.length, 109);
});

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
  assert.equal(plan.looseStars, null);
  assert.equal(plan.availableStars, null);
  assert.equal(plan.overGoalStars, null);
  assert.equal(plan.overallReadinessPct, null);
  assert.equal(plan.starsCraftableFromParts, null);
  assert.equal(plan.starsCraftableWithSubParts, null);
  assert.equal(plan.atmStar.icon, 0);
  assert.equal(plan.atmStarBlock.icon, 1);
  assert.deepEqual(plan.netherStars.map(t => t.icon), [2, 3, 4, 5, 6]);
  assert.ok(plan.netherStars.every(t => t.key && t.id && t.inMe === null));
  assert.ok(plan.groups.every(g => g.status === 'unknown' && g.craftableNow === null && g.readinessPct === null));
  assert.ok(plan.shoppingList.length > 0);
  assert.ok(plan.shoppingList.every(item => item.inStock === null && item.missing === item.totalNeeded));
  assert.equal(plan.closestPart, null);
  assert.deepEqual(plan.craftableParts, []);
  assert.equal(plan.history.sampleCount, 0);
  assert.equal(plan.starryBeeRoadmap.steps.length, 4);

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
  assert.equal(plan.availableStars, 12);
  assert.equal(plan.overGoalStars, 12);
  const compressed = group(plan, 'allthecompressed:nether_star_block_3x');
  assert.equal(compressed.missing, 85);
  assert.equal(compressed.ingredients[0].missing, 759);
  const dragon = group(plan, 'allthetweaks:dragon_soul');
  const hearts = dragon.ingredients.find(i => i.alternatives[0].id === 'allthemodium:piglich_heart_block');
  assert.equal(hearts.alternatives[0].allocated, 1);
  assert.equal(hearts.missing, 5);
  assert.equal(hearts.shared, true);
  assert.equal(hearts.sharedPool.totalNeeded, 342);
  const motor = group(plan, 'allthetweaks:nexium_emitter').ingredients.find(i => i.alternatives.length === 2);
  assert.equal(motor.missing, 2);
  assert.equal(group(plan, 'allthetweaks:dimensional_seed').ingredients.find(i => i.alternatives[0].id === 'allthecompressed:obsidian_5x').missing, 0);

  // Shared pool & deduplicated shopping list rollup for piglich_heart_block (56*6 + 1*6 = 342 needed, 337 in ME -> 5 missing)
  assert.equal(plan.sharedPools.length, 1);
  assert.equal(plan.sharedPools[0].key, 'allthemodium:piglich_heart_block');
  assert.equal(plan.sharedPools[0].perStar, 57);
  assert.equal(plan.sharedPools[0].totalNeeded, 342);
  assert.equal(plan.sharedPools[0].inStock, 337);
  assert.equal(plan.sharedPools[0].missing, 5);
  assert.equal(plan.sharedPools[0].consumers.length, 2);

  const piglichRows = plan.shoppingList.filter(i => i.key === 'allthemodium:piglich_heart_block');
  assert.equal(piglichRows.length, 1);
  assert.equal(piglichRows[0].totalNeeded, 342);
  assert.equal(piglichRows[0].inStock, 337);
  assert.equal(piglichRows[0].missing, 5);
  assert.equal(piglichRows[0].shared, true);
  assert.equal(piglichRows[0].usedBy.length, 2);
});

test('Nether Star compression rolls up lower tiers into 2x/3x craftability and coverage', () => {
  // 15 * 6561 = 98,415 Nether Stars for 1 Star; provide 2x3x directly + lower tiers equal to 13x3x exactly.
  // 13 * 6561 = 85,293 = 100 * 729 (72,900) + 150 * 81 (12,150) + 27 * 9 (243)
  const stock = {
    ...counts(),
    'allthecompressed:nether_star_block_3x': 2,
    'allthecompressed:nether_star_block_2x': 100,
    'allthecompressed:nether_star_block_1x': 150,
    'allthetweaks:nether_star_block': 27,
    'minecraft:nether_star': 0,
  };
  const plan = buildAtmStarPlan({ counts: stock });
  const m1 = plan.milestones['1'];
  assert.equal(m1.netherStarSummary.totalEquivalent, 98415);
  assert.equal(m1.netherStarSummary.neededNetherStars, 98415);
  assert.equal(m1.netherStarSummary.missingNetherStars, 0);
  assert.equal(m1.netherStarSummary.coveragePct, 100);
  // Lower than 2x: 150*81 + 27*9 = 12,393 = 17 * 729 exactly -> compressible2xFromLower = 17
  assert.equal(m1.netherStarSummary.compressible2xFromLower, 17);
  // Total 2x effective = 100 + 17 = 117 = 13 * 9 -> compressible3xFromLower = 13
  assert.equal(m1.netherStarSummary.compressible3xFromLower, 13);
  assert.equal(m1.netherStarSummary.effective3xAvailable, 15);
  assert.equal(m1.netherStarSummary.missing3xEffective, 0);

  const part0 = m1.parts[0];
  assert.equal(part0.missing, 13); // direct 3x still missing 13
  assert.equal(part0.craftableNow, 13); // all 13 compressible right now from lower tiers
  assert.equal(part0.fullyCraftable, true);
  assert.equal(part0.effectiveCovered, 15);
  assert.equal(part0.effectiveMissing, 0);
  assert.equal(part0.status, 'craftable');
  assert.equal(part0.readinessPct, 100);
  // Because 15/15 3x blocks are covered via compression for goal=1, nether_star_block_2x is NOT missing in shoppingList!
  assert.equal(m1.shoppingList.some(i => i.key === 'allthecompressed:nether_star_block_2x'), false);
  // For goal=18 (needs 270 3x = 2430 2x; have 2 direct 3x -> need 268*9=2412 2x; effective2x=117 -> 2295 missing)
  const nsShopping18 = plan.milestones['18'].shoppingList.find(i => i.key === 'allthecompressed:nether_star_block_2x');
  assert.equal(nsShopping18.totalNeeded, 2412);
  assert.equal(nsShopping18.effectiveInStock, 117);
  assert.equal(nsShopping18.missing, 2295);
  assert.equal(nsShopping18.compressibleFromLower, 17);
});

test('effective craftability, starsCraftable, closestPart, bottlenecks, and 1/9/18 milestones', () => {
  const stock = counts();
  // Give 1 existing ATM Star + 1 ATM Star Block (= 10 availableStars -> milestone 9 done, milestone 18 needs 8, milestone 1 needs 1)
  stock['allthetweaks:atm_star'] = 1;
  stock['allthetweaks:atm_star_block'] = 1;
  // Make Patrick Star craftable x3 from concrete (no finished Patrick Star in ME)
  stock['minecraft:magenta_concrete'] = 39;
  stock['minecraft:pink_concrete'] = 33;
  stock['minecraft:green_concrete'] = 24;
  stock['minecraft:green_concrete_powder'] = 24;
  stock['minecraft:magenta_concrete_powder'] = 24;
  stock['minecraft:pink_concrete_powder'] = 15;
  stock['minecraft:lime_concrete'] = 6;
  // Make Dimensional Seed 8/9 ingredients ready for 1 Star (missing only teleposer)
  stock['allthecompressed:netherrack_6x'] = 1;
  stock['allthecompressed:obsidian_5x'] = 1;
  stock['allthetweaks:mini_exit'] = 1;
  stock['allthetweaks:mini_nether'] = 1;
  stock['allthetweaks:mini_end'] = 1;
  stock['allthecompressed:end_stone_5x'] = 1;
  stock['allthecompressed:emerald_block_4x'] = 1;
  stock['allthecompressed:diamond_block_4x'] = 1;

  const plan = buildAtmStarPlan({ counts: stock });
  assert.equal(plan.availableStars, 10);
  assert.equal(plan.milestones['1'].mode, 'next');
  assert.equal(plan.milestones['1'].remainingStars, 1);
  assert.equal(plan.milestones['9'].remainingStars, 0);
  assert.equal(plan.milestones['9'].overallReadinessPct, 100);
  assert.equal(plan.milestones['9'].shoppingList.length, 0);
  assert.equal(plan.milestones['18'].remainingStars, 8);

  const patrick1 = plan.milestones['1'].parts.find(p => p.id === 'allthetweaks:patrick_star');
  assert.equal(patrick1.craftableNow, 1);
  assert.equal(patrick1.fullyCraftable, true);
  assert.equal(patrick1.status, 'craftable');
  assert.equal(patrick1.station, 'Mechanical Crafter');
  assert.equal(plan.milestones['1'].craftableParts.some(p => p.id === 'allthetweaks:patrick_star'), true);

  const patrick18 = plan.milestones['18'].parts.find(p => p.id === 'allthetweaks:patrick_star');
  assert.equal(patrick18.needed, 8);
  assert.equal(patrick18.craftableNow, 3);
  assert.equal(patrick18.effectiveMissing, 5);
  assert.equal(patrick18.fullyCraftable, false);
  assert.equal(patrick18.status, 'craftable');

  // Closest non-craftable part for Next Star is Dimensional Seed (8/9 ready)
  assert.equal(plan.milestones['1'].closestPart.id, 'allthetweaks:dimensional_seed');
  assert.equal(plan.milestones['1'].closestPart.ingredientsReadyCount, 8);
  assert.equal(plan.milestones['1'].closestPart.ingredientsTotalCount, 9);

  // Top 6 bottlenecks exist and surface shared/zero-stock/special-NBT items
  assert.equal(plan.milestones['18'].bottlenecks.length, 6);
  assert.ok(plan.milestones['18'].bottlenecks.some(b => b.key === 'allthemodium:piglich_heart_block'));
  assert.ok(plan.milestones['18'].bottlenecks[0].reasons.length > 0);

  // Full starsCraftableFromParts vs starsCraftableWithSubParts test
  const fullStock = counts();
  for (const part of plan.groups) {
    fullStock[part.key] = part.perRecipe * 2; // 2 stars directly from finished parts
  }
  // Plus enough sub-ingredients for 1 more star (including 98,415 raw Nether Stars & 57 piglich heart blocks)
  fullStock['minecraft:nether_star'] = 98415;
  for (const part of plan.groups.slice(1)) {
    for (const ing of part.ingredients) {
      fullStock[ing.alternatives[0].key] = (fullStock[ing.alternatives[0].key] ?? 0) + part.perRecipe * ing.perRecipe;
    }
  }
  const craftPlan = buildAtmStarPlan({ counts: fullStock });
  assert.equal(craftPlan.starsCraftableFromParts, 2);
  assert.equal(craftPlan.starsCraftableWithSubParts, 3);
});

test('over-goal stock preserves uncapped totals and marks all 18-star goals complete', () => {
  const stock = { ...counts(), 'allthetweaks:atm_star': 4, 'allthetweaks:atm_star_block': 2 }; // 22 stars
  const plan = buildAtmStarPlan({ counts: stock });
  assert.equal(plan.looseStars, 4);
  assert.equal(plan.blocks, 2);
  assert.equal(plan.availableStars, 22);
  assert.equal(plan.overGoalStars, 22);
  assert.equal(plan.surplusStars, 4);
  assert.equal(plan.remainingStars, 0);
  assert.equal(plan.overallReadinessPct, 100);
  assert.equal(plan.milestones['9'].remainingStars, 0);
  assert.equal(plan.milestones['18'].remainingStars, 0);
  assert.equal(plan.milestones['1'].remainingStars, 1); // Next Star always plans 1 additional Star
  assert.ok(plan.starryBeeRoadmap.steps.slice(0, 3).every(s => s.done));
});

test('all 12 special-NBT/name rules expose structured requirements and rawRule metadata', () => {
  const plan = buildAtmStarPlan(null);
  const allOptions = plan.groups.flatMap(g => [
    ...g.alternatives,
    ...g.ingredients.flatMap(i => i.alternatives),
  ]);
  const withReq = new Set(allOptions.filter(o => o.requirements.length > 0).map(o => o.key));
  assert.equal(withReq.size, 12);
  for (const opt of allOptions) {
    if (withReq.has(opt.key)) {
      assert.ok(opt.rawRule !== null, `${opt.key} should expose rawRule`);
      assert.ok(opt.requirements.every(r => r.kind && r.badge && r.label && r.detail));
    }
  }
  const wut = allOptions.find(o => o.key === 'ae2wtlib:wireless_universal_terminal');
  assert.equal(wut.requirements.length, 2);
  assert.equal(wut.rawRule.components['ae2:stored_energy'], 6400000);
});

test('the Campus checklist requires a session, tracks stock history deltas/ETA, and rejects invalid reports', async () => {
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

    const s1 = counts();
    s1['allthetweaks:atm_star'] = 2;
    s1['minecraft:nether_star'] = 10000;
    saveAtmStarStock(app.campus.db, 'old', { revision: 'old', counts: s1 });
    saveAtmStarStock(app.campus.db, 'incomplete', { revision: atmStarStockRequest.revision, counts: {} });
    assert.equal(readAtmStarPlan(app.campus.db).stock, null);

    // Save sample 1 at T0, identical sample 2 min later (deduplicated), sample 2 at T0+1h (+20,000 Nether Stars)
    saveAtmStarStock(app.campus.db, 'ME test', { revision: atmStarStockRequest.revision, counts: s1 }, { at: '2026-11-24T20:00:00.000Z' });
    saveAtmStarStock(app.campus.db, 'ME test', { revision: atmStarStockRequest.revision, counts: s1 }, { at: '2026-11-24T20:02:00.000Z' });
    assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM atm_star_stock_history').get().n, 1);

    const s2 = { ...s1, 'minecraft:nether_star': 30000, 'allthemodium:piglich_heart_block': 5 };
    saveAtmStarStock(app.campus.db, 'ME test', { revision: atmStarStockRequest.revision, counts: s2 }, { at: '2026-11-24T21:00:00.000Z' });
    assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM atm_star_stock_history').get().n, 2);

    const api = await app.inject({ url: '/api/atm-star', headers });
    assert.equal(api.statusCode, 200);
    assert.match(api.headers['cache-control'], /no-store/);
    const body = api.json();
    assert.equal(body.remainingStars, 16);
    assert.equal(body.stock.source, 'ME test');
    assert.equal(body.history.sampleCount, 2);
    assert.equal(body.history.deltas['minecraft:nether_star'], 20000);
    assert.equal(body.history.deltas['allthemodium:piglich_heart_block'], 5);
    assert.equal(body.history.netherStarDelta, 20000);
    assert.equal(body.history.netherStarRatePerHour, 20000);
    // Remaining 16 stars = 1,574,640 Nether Stars; 30,000 in ME -> 1,544,640 missing -> 77.2h at 20k/h
    assert.equal(body.history.netherStarEtaHours, 77.2);
    assert.equal(body.milestones['1'].netherStarSummary.etaHours, 3.4); // (98415 - 30000) / 20000 = 3.42 -> 3.4
    assert.equal(body.history.points.length, 2);
  } finally {
    await app.close();
    app.campus.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
