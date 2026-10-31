import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { materialsHtml } from '../src/materials-html.js';

const item = (id, needed = 2) => ({ item: id, needed, planned: 5, built: 3, stacks: 0, stack: 64, rest: needed });
const report = items => ({ items, removed: [], totals: { needed: 2, kinds: 1, stacks: 1 }, snapshot: { id: 12, worldTime: '2026-10-31T14:49:36Z' } });

test('material HTML escapes user-supplied titles/unknown item names, without broken icons', () => {
  const html = materialsHtml(report([item('<img src=x onerror=alert(1)>')]), 'Hall <script>alert(1)</script>', '/api/materials?ids=hall%22%3E&format=html');
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x'));
  assert.match(html, /Hall &lt;script&gt;/);
  assert.match(html, /Kein Blockbild verfügbar/);
  assert.match(html, /ids=hall%22%3E&amp;format=csv/);
});

test('material links keep the blueprint version, snapshot and ME selection', () => {
  const html = materialsHtml(report([item('rechiseled:obsidian_bordered_connecting')]), 'Test', '/api/blueprints/hall/materials?version=2&snapshot=12&me=0&all=true&format=html');
  assert.match(html, /version=2&amp;snapshot=12&amp;me=0&amp;all=true&amp;format=text/);
  assert.match(html, /all=false&amp;format=html/);
  assert.match(html, /Connecting AN/);
  assert.match(html, /Weltstand:.*15:49.*Berlin/);
  assert.match(html, /Kein Echtzeitstand/);
  assert.match(html, /Kein ME-Bestand berücksichtigt/);
});

test('catalog thumbnails exist and distinguish connected and regular planned variants', () => {
  const cat = JSON.parse(readFileSync(new URL('../public/assets/material-icons/catalog.json', import.meta.url)));
  for (const [id, entry] of Object.entries(cat)) {
    assert.match(entry.icon, /^\/assets\/material-icons\/[a-z0-9_.-]+__[a-z0-9_.-]+\.png$/);
    const file = new URL('../public' + entry.icon, import.meta.url);
    assert.ok(existsSync(file), id);
    assert.equal(readFileSync(file).subarray(1, 4).toString(), 'PNG', id);
  }
  assert.equal(cat['rechiseled:obsidian_bordered_connecting'].connecting, true);
  assert.equal(cat['connectedglass:clear_glass_black'].connecting, true);
  assert.equal(cat['rechiseled:quartz_block_small_tiles'].connecting, false);
  assert.equal(cat['rechiseledcreate:calcite_cut_polished_connecting'].connecting, true);
  assert.equal(cat['create:polished_cut_calcite'].connecting, false);
});

test('ME columns show stock/shortage and retain empty-list feedback', () => {
  const r = report([{...item('minecraft:gold_block'), me:1, short:1, craftable:true}]);
  r.totals.me = {at:'2026-10-31T15:12:00Z',source:'kanone-1',short:1};
  const html = materialsHtml(r, 'Test', '/api/materials?format=html');
  assert.match(html, /Im ME craftbar/);
  assert.match(html, /<td>Ja<\/td>/);
  assert.match(materialsHtml(report([]), 'Leer', '/api/materials?format=html'), /fehlen keine Materialien/);
});
