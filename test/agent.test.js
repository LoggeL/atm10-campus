import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorld, structureNbt } from './helpers.js';
import { buildServer } from '../src/server.js';
import { parseStructure } from '../src/nbt.js';
import { itemsFor, remainingModel } from '../src/materials.js';
import { nbtList, nbtCompound, nbtString } from '../src/nbt.js';

const tmp = mkdtempSync(join(tmpdir(), 'campus-agent-'));
const worldDir = join(tmp, 'world');
writeWorld(worldDir, [{
  cx: 0, cz: 0,
  blocks: [
    { x: 1, y: 64, z: 1, name: 'minecraft:stone' },
    { x: 2, y: 64, z: 1, name: 'minecraft:oak_planks' },
    { x: 5, y: 64, z: 5, name: 'minecraft:chest' },
  ],
  blockEntities: [{ id: 'minecraft:chest', x: 5, y: 64, z: 5 }],
}]);
const config = {
  port: 0, host: '127.0.0.1', dataDir: join(tmp, 'data'), worldSources: { live: worldDir },
  contextOrigin: [0, 48, 0], contextSize: [16, 32, 16], snapshotIntervalMin: 0, snapshotKeepRecent: 10,
  bootstrapInvite: 'bootstrap-invite-code-agent', publicUrl: 'http://test', cookieSecure: false, maxUploadBytes: 32 * 1024 * 1024,
};
const app = await buildServer(config);
let cookie = '';
const req = async (method, url, { body, token } = {}) => {
  const h = {};
  if (token) h.authorization = 'Bearer ' + token;
  else if (cookie) { h.cookie = cookie; h['x-campus-csrf'] = '1'; }
  const r = await app.inject({ method, url, payload: body && JSON.stringify(body), headers: body ? { ...h, 'content-type': 'application/json' } : h });
  return { status: r.statusCode, json: r.headers['content-type']?.includes('json') ? r.json() : null, text: r.body, headers: r.headers, raw: r.rawPayload };
};
test.after(async () => { await app.close(); app.campus.db.close(); rmSync(tmp, { recursive: true, force: true }); });

test('agent edits, readable views and viewer data', async t => {
  const reg = await req('POST', '/api/auth/register', { body: { code: config.bootstrapInvite, username: 'agentadmin', password: 'sehr-geheim-123' } });
  cookie = 'campus_session=' + (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'agentadmin', password: 'sehr-geheim-123' } })).cookies.find(c => c.name === 'campus_session').value;
  assert.equal(reg.status, 200);
  assert.equal((await req('POST', '/api/snapshots', { body: { force: true } })).status, 200);
  const read = (await req('POST', '/api/tokens', { body: { name: 'r', scope: 'read' } })).json.token;
  const write = (await req('POST', '/api/tokens', { body: { name: 'w', scope: 'write' } })).json.token;
  const nbt = structureNbt([2, 1, 2], [{ pos: [0, 0, 0], name: 'minecraft:stone' }, { pos: [1, 0, 0], name: 'minecraft:gold_block' }]);
  assert.equal((await req('POST', '/api/blueprints', { token: write, body: { fileName: '20_Hut.nbt', origin: [1, 64, 1], nbtBase64: nbt.toString('base64') } })).status, 200);
  const edits = id => `/api/blueprints/${id}/edits`;

  await t.test('dry run is read-only and previews growth + analysis', async () => {
    const r = await req('POST', edits('20_Hut'), { token: read, body: { dryRun: true, grow: true, edits: [{ op: 'fill', from: [0, 0, 0], to: [2, 1, 2], block: 'minecraft:stone', mode: 'hollow' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.dryRun, true);
    assert.deepEqual(r.json.size, [3, 2, 3]);
    assert.ok(r.json.changes.set > 0);
    assert.equal(typeof r.json.analysis.progress, 'number');
    assert.equal((await req('GET', '/api/blueprints/20_Hut', { token: read })).json.currentVersion, 1, 'nothing stored');
    assert.equal((await req('POST', edits('20_Hut'), { token: read, body: { baseVersion: 1, edits: [{ op: 'clear', from: [0, 0, 0], to: [0, 0, 0] }] } })).status, 403);
  });

  await t.test('validation: baseVersion, bounds, typos, bad ops', async () => {
    const one = [{ op: 'set', pos: [0, 0, 0], block: 'minecraft:oak_planks' }];
    assert.equal((await req('POST', edits('20_Hut'), { token: write, body: { edits: one } })).status, 400, 'baseVersion required');
    const stale = await req('POST', edits('20_Hut'), { token: write, body: { baseVersion: 7, edits: one } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.currentVersion, 1);
    const out = await req('POST', edits('20_Hut'), { token: write, body: { dryRun: true, edits: [{ op: 'set', pos: [5, 0, 0], block: 'minecraft:stone' }] } });
    assert.equal(out.status, 400);
    assert.match(out.json.error, /grow/);
    const typo = await req('POST', edits('20_Hut'), { token: write, body: { dryRun: true, edits: [{ op: 'set', pos: [0, 0, 0], block: 'minecraft:stne' }] } });
    assert.equal(typo.json.warnings.length, 1);
    assert.match(typo.json.warnings[0], /Tippfehler/);
    assert.equal((await req('POST', edits('20_Hut'), { token: write, body: { dryRun: true, edits: [{ op: 'explode' }] } })).status, 400);
    assert.equal((await req('POST', edits('20_Hut'), { token: write, body: { dryRun: true, edits: [{ op: 'set', pos: [0, 0, 0], block: 'Stone!' }] } })).status, 400);
  });

  await t.test('grow towards negative shifts the origin; world coordinates work', async () => {
    const r = await req('POST', edits('20_Hut'), { token: write, body: { dryRun: true, grow: true, coords: 'world', edits: [{ op: 'set', pos: [0, 64, 1], block: 'minecraft:stone' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.origin, [0, 64, 1]);
    assert.deepEqual(r.json.size, [3, 1, 2]);
  });

  await t.test('save a version with set/fill/replace/clear/copy', async () => {
    const r = await req('POST', edits('20_Hut'), { token: write, body: { baseVersion: 1, grow: true, note: 'Hütte', edits: [
      { op: 'set', pos: [0, 0, 0], block: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' } },
      { op: 'fill', from: [0, 0, 0], to: [2, 1, 2], block: 'minecraft:cobblestone', mode: 'keep' },
      { op: 'replace', match: 'minecraft:*_block', block: 'minecraft:emerald_block' },
      { op: 'clear', from: [1, 1, 1], to: [1, 1, 1] },
      { op: 'copy', from: [0, 0, 0], to: [0, 0, 0], dest: [2, 1, 2] },
    ] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.version.version, 2);
    assert.equal(r.json.version.uploadedBy, 'agentadmin');
    const b = (await req('GET', '/api/blueprints/20_Hut/blocks', { token: read })).json;
    assert.deepEqual(b.size, [3, 2, 3]);
    const at = (x, y, z) => { const row = b.blocks.find(c => c[0] === x && c[1] === y && c[2] === z); return row && b.palette[row[3]]; };
    assert.deepEqual(at(0, 0, 0), { name: 'minecraft:oak_stairs', properties: { facing: 'north', half: 'bottom' } });
    assert.equal(at(1, 0, 0).name, 'minecraft:emerald_block');
    assert.equal(at(1, 1, 1).name, 'minecraft:air');
    assert.equal(at(2, 1, 2).name, 'minecraft:oak_stairs');
    assert.equal(at(2, 0, 2).name, 'minecraft:cobblestone');
    const world = (await req('GET', '/api/blueprints/20_Hut/blocks?coords=world', { token: read })).json;
    assert.ok(world.blocks.some(c => c[0] === 1 && c[1] === 64 && c[2] === 1));
    const layers = await req('GET', '/api/blueprints/20_Hut/layers?y=65', { token: read });
    assert.equal(layers.status, 200);
    assert.match(layers.headers['content-type'], /text\/plain/);
    assert.match(layers.text, /--- y=65/);
    assert.match(layers.text, /= minecraft:oak_stairs/);
    assert.doesNotMatch(layers.text, /--- y=64/);
  });

  await t.test('create from scratch', async () => {
    const r = await req('POST', '/api/blueprints/new', { token: write, body: { fileName: '30_Kiosk.nbt', origin: [8, 64, 8], size: [2, 2, 2], name: 'Kiosk', category: 'test',
      edits: [{ op: 'fill', from: [0, 0, 0], to: [1, 1, 1], block: 'minecraft:oak_planks' }] } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.version.version, 1);
    assert.equal(r.json.placed, 8);
    assert.equal(r.json.analysis.toPlace, 8);
    assert.equal((await req('POST', '/api/blueprints/new', { token: write, body: { fileName: '30_Kiosk.nbt', origin: [0, 0, 0], size: [1, 1, 1], edits: [{ op: 'clear', from: [0, 0, 0], to: [0, 0, 0] }] } })).status, 409);
    assert.equal((await req('POST', '/api/blueprints/new', { token: write, body: { fileName: '../x.nbt', origin: [0, 0, 0], size: [1, 1, 1], edits: [] } })).status, 400);
  });

  await t.test('real world view', async () => {
    const j = (await req('GET', '/api/world/blocks?from=0,64,0&to=6,64,6', { token: read })).json;
    const names = j.blocks.map(b => j.palette[b[3]]);
    assert.deepEqual(names.sort(), ['minecraft:chest', 'minecraft:oak_planks', 'minecraft:stone']);
    assert.deepEqual(j.blockEntities, [{ pos: [5, 64, 5], id: 'minecraft:chest' }]);
    const text = await req('GET', '/api/world/blocks?from=0,64,0&to=6,64,6&format=layers', { token: read });
    assert.match(text.text, /Block-Entities/);
    assert.equal((await req('GET', '/api/world/blocks?from=0,0,0&to=999,300,999', { token: read })).status, 400);
  });

  await t.test('materials + remaining NBT', async () => {
    const c = await req('POST', '/api/blueprints/new', { token: write, body: { fileName: '40_Mat.nbt', origin: [4, 64, 4], size: [3, 2, 3], edits: [
      { op: 'set', pos: [0, 0, 0], block: 'minecraft:oak_door', properties: { half: 'lower', facing: 'north' } },
      { op: 'set', pos: [0, 1, 0], block: 'minecraft:oak_door', properties: { half: 'upper', facing: 'north' } },
      { op: 'set', pos: [1, 0, 1], block: 'minecraft:stone' },                       // chest at 5,64,5 in the way
      { op: 'set', pos: [2, 0, 0], block: 'minecraft:wall_torch', properties: { facing: 'east' } },
      { op: 'set', pos: [2, 0, 2], block: 'minecraft:stone_slab', properties: { type: 'double' } },
      { op: 'clear', from: [0, 0, 2], to: [0, 0, 2] },                                // already air
    ] } });
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const m = (await req('GET', '/api/blueprints/40_Mat/materials', { token: read })).json;
    const need = Object.fromEntries(m.items.map(r => [r.item, r.needed]));
    assert.deepEqual(need, { 'minecraft:oak_door': 1, 'minecraft:stone': 1, 'minecraft:torch': 1, 'minecraft:stone_slab': 2 });
    assert.equal(m.totals.needed, 5);
    assert.equal(m.totals.kinds, 4);
    assert.equal(m.totals.blocked, 1);
    assert.deepEqual(m.removed, [{ block: 'minecraft:chest', count: 1 }]);
    const text = await req('GET', '/api/blueprints/40_Mat/materials?format=text', { token: read });
    assert.match(text.text, /fehlt: 5 Items in 4 Sorten/);
    const csv = await req('GET', '/api/materials?ids=40_Mat&format=csv', { token: read });
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.ok(csv.text.startsWith('\ufeffItem;Fehlt'));
    assert.match(csv.text, /minecraft:torch;1;/);
    const illustrated = await req('GET', '/api/materials?ids=40_Mat&format=html', { token: read });
    assert.equal(illustrated.status, 200);
    assert.match(illustrated.headers['content-type'], /text\/html/);
    assert.equal(illustrated.headers['cache-control'], 'no-store');
    assert.match(illustrated.text, /Materialliste/);
    assert.match(illustrated.text, /minecraft:torch/);
    const singleHtml = await req('GET', '/api/blueprints/40_Mat/materials?format=html', { token: read });
    assert.match(singleHtml.headers['content-type'], /text\/html/);
    assert.match(singleHtml.text, /40_Mat/);
    const multi = (await req('GET', '/api/materials?ids=40_Mat,30_Kiosk', { token: read })).json;
    assert.deepEqual(multi.blueprints, ['40_Mat', '30_Kiosk']);
    assert.deepEqual(multi.items.find(r => r.item === 'minecraft:oak_planks').by, { '30_Kiosk': 8 });
    assert.equal((await req('GET', '/api/materials?ids=nope', { token: read })).status, 404);

    const rest = await req('GET', '/api/blueprints/40_Mat/remaining.nbt', { token: read });
    assert.equal(rest.status, 200);
    assert.equal(rest.headers['x-campus-origin'], '4,64,4');
    const stats = JSON.parse(rest.headers['x-campus-remaining']);
    assert.equal(stats.kept, 4);
    assert.equal(stats.skippedBlocked, 1);
    assert.equal(stats.done, 1, 'the demolition cell is already air');
    const parsed = parseStructure(rest.raw);
    assert.deepEqual(parsed.size, [3, 2, 3]);
    assert.equal(parsed.placed.length, 4);
    assert.ok(!parsed.placed.some(b => b.name === 'minecraft:stone'), 'blocked cell left out');
    const all = JSON.parse((await req('GET', '/api/blueprints/40_Mat/remaining.nbt?skipBlocked=0', { token: read })).headers['x-campus-remaining']);
    assert.equal(all.kept, 5);
    const withClear = JSON.parse((await req('GET', '/api/blueprints/40_Mat/remaining.nbt?clear=1', { token: read })).headers['x-campus-remaining']);
    assert.equal(withClear.clear, 0, 'demolition cell is already air either way');
    // a second blueprint planning the same torch cell: counted once across the selection
    assert.equal((await req('POST', '/api/blueprints/new', { token: write, body: { fileName: '41_Share.nbt', origin: [6, 64, 4], size: [1, 1, 1],
      edits: [{ op: 'set', pos: [0, 0, 0], block: 'minecraft:wall_torch', properties: { facing: 'east' } }] } })).status, 200);
    const shared = (await req('GET', '/api/materials?ids=40_Mat,41_Share', { token: read })).json;
    assert.deepEqual(shared.items.find(r => r.item === 'minecraft:torch'), { ...shared.items.find(r => r.item === 'minecraft:torch'), needed: 1, by: { '40_Mat': 1 } });
    assert.equal((await req('GET', '/api/blueprints/41_Share/materials', { token: read })).json.totals.needed, 1, 'alone it still needs its torch');
    const zip = await req('GET', '/api/remaining.zip?ids=40_Mat,30_Kiosk', { token: read });
    assert.equal(zip.status, 200);
    assert.equal(zip.raw.readUInt32LE(0), 0x04034b50);
    assert.ok(zip.raw.includes(Buffer.from('40_Mat_rest.nbt')) && zip.raw.includes(Buffer.from('30_Kiosk_rest.nbt')));
  });

  await t.test('ME stock, cannons and CC scripts', async () => {
    const station = (await req('POST', '/api/tokens', { body: { name: 'cc-nord', scope: 'station' } })).json;
    assert.equal(station.scope, 'station');
    const st = station.token;
    // station tokens report, but never edit blueprints; read tokens cannot report
    assert.equal((await req('POST', '/api/blueprints/new', { token: st, body: { fileName: 'x.nbt', origin: [0, 64, 0], size: [1, 1, 1] } })).status, 403);
    assert.equal((await req('POST', '/api/me/stock', { token: read, body: { items: [] } })).status, 403);
    assert.equal((await req('GET', '/api/cannons/nord-1/plan', { token: read })).status, 403);
    assert.equal((await req('GET', '/api/cannons/bad%20name/plan', { token: st })).status, 400);

    // first contact registers the cannon, still without blueprint
    const p0 = (await req('GET', '/api/cannons/nord-1/plan', { token: st })).json;
    assert.equal(p0.state, 'unassigned');
    assert.equal(p0.blueprint, null);
    assert.deepEqual(p0.items, []);
    assert.match(p0.script, /^\d+\.\d+\.\d+$/);
    assert.equal((await req('PUT', '/api/cannons/nord-1', { token: st, body: { blueprint: '40_Mat' } })).status, 403);

    const a = await req('PUT', '/api/cannons/nord-1', { token: write, body: { blueprint: '40_Mat' } });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    const job1 = a.json.assignment;
    assert.ok(job1 > p0.assignment, 'assigning starts a new job');
    const p1 = (await req('GET', '/api/cannons/nord-1/plan', { token: st })).json;
    assert.equal(p1.state, 'feeding');
    assert.equal(p1.blueprint.id, '40_Mat');
    assert.deepEqual(Object.fromEntries(p1.items.map(i => [i.item, i.needed])), { 'minecraft:oak_door': 1, 'minecraft:torch': 1, 'minecraft:stone_slab': 2 });
    assert.ok(p1.items.every(i => i.minY === 0 && i.stack === 64));
    assert.equal(p1.totals.needed, 4);
    assert.equal(p1.totals.start, 4);
    assert.equal(p1.skipped.blocked, 1);
    assert.match(p1.restNbt, /remaining\.nbt\?version=\d+&skipBlocked=1$/);
    assert.equal((await req('GET', p1.restNbt, { token: st })).status, 200);
    // without skipping machine cells the stone in front of the chest is wanted too
    const p2 = (await req('PUT', '/api/cannons/nord-1', { token: write, body: { options: { skipBlocked: false, autoCraft: true } } })).json;
    assert.equal(p2.assignment, job1, 'options alone keep the assignment');
    assert.equal(p2.options.autoCraft, true);
    assert.equal(p2.totals.needed, 5);
    assert.equal(p2.totals.start, 5, 'progress baseline follows the skipBlocked option');
    assert.equal((await req('PUT', '/api/cannons/nord-1', { token: write, body: { options: { bufferStacks: 99 } } })).status, 400);
    assert.equal((await req('PUT', '/api/cannons/nord-1', { token: write, body: { blueprint: '40_Mat' } })).json.assignment, job1, 'same blueprint + version is no new job');
    assert.equal((await req('PUT', '/api/cannons/nord-1', { token: write, body: { blueprint: 'nope' } })).status, 404);

    // status as the Lua script sends it (empty Lua tables arrive as {})
    const s1 = await req('POST', '/api/cannons/nord-1/status', { token: st, body: { assignment: job1, state: 'waiting', script: '1.0.0', chest: { slots: 27, used: 3, name: 'left' },
      delivered: { 'minecraft:oak_door': 1 }, shortages: { 1: { item: 'minecraft:stone_slab', missing: 2, inME: 0, craftable: true, crafting: true } } } });
    assert.equal(s1.status, 200);
    assert.equal((await req('POST', '/api/cannons/nord-1/status', { token: st, body: { assignment: job1, state: 'feeding', shortages: {}, delivered: {} } })).status, 200);
    await req('POST', '/api/cannons/nord-1/status', { token: st, body: s1.json && { assignment: job1, state: 'waiting', shortages: [{ item: 'minecraft:stone_slab', missing: 2, crafting: true }] } });
    const list = (await req('GET', '/api/cannons', { token: read })).json;
    assert.equal(list.length, 1);
    assert.equal(list[0].online, true);
    assert.equal(list[0].status.state, 'waiting');
    assert.equal(list[0].status.shortages[0].crafting, true);
    assert.ok(!list[0].status.stale);

    // ME stock: wanted list, report (array or Lua-style object), merged into the material list
    const wanted = (await req('GET', '/api/me/wanted', { token: st })).json;
    assert.ok(wanted.items.includes('minecraft:oak_door') && wanted.items.includes('minecraft:gunpowder'));
    assert.equal((await req('POST', '/api/me/stock', { token: st, body: { items: 'x' } })).status, 400);
    assert.equal((await req('POST', '/api/me/stock', { token: st, body: { source: 'nord-1', items: {} } })).status, 200);
    const rep = await req('POST', '/api/me/stock', { token: st, body: { source: 'nord-1', items: [
      { name: 'minecraft:oak_door', amount: 5 }, { name: 'minecraft:stone_slab', count: 1, isCraftable: true }, { name: 'minecraft:stone_slab', amount: 0 }, { name: 'not an id', amount: 9 }] } });
    assert.deepEqual({ kinds: rep.json.kinds, total: rep.json.total }, { kinds: 2, total: 6 });
    const inf = await app.inject({ method: 'POST', url: '/api/me/stock', headers: { authorization: 'Bearer ' + st, 'content-type': 'application/json' }, payload: '{"items":[{"name":"minecraft:gold_block","count":1e400}]}' });
    assert.equal(inf.json().total, 0, 'non-finite amounts count as 0');
    await req('POST', '/api/me/stock', { token: st, body: { source: 'nord-1', items: [{ name: 'minecraft:oak_door', amount: 5 }, { name: 'minecraft:stone_slab', count: 1, isCraftable: true }] } });
    const stock = (await req('GET', '/api/me/stock?items=1', { token: read })).json.stock;
    assert.equal(stock.source, 'nord-1');
    assert.deepEqual(stock.items['minecraft:stone_slab'], [1, 1]);
    const m = (await req('GET', '/api/blueprints/40_Mat/materials', { token: read })).json;
    const row = item => m.items.find(r => r.item === item);
    assert.deepEqual([row('minecraft:oak_door').me, row('minecraft:oak_door').short], [5, 0]);
    assert.deepEqual([row('minecraft:stone_slab').me, row('minecraft:stone_slab').short, row('minecraft:stone_slab').craftable], [1, 1, true]);
    assert.deepEqual([row('minecraft:torch').me, row('minecraft:torch').short], [0, 1]);
    assert.equal(m.totals.me.short, 3);
    assert.equal(m.totals.me.craftableKinds, 1);
    assert.equal((await req('GET', '/api/blueprints/40_Mat/materials?me=0', { token: read })).json.totals.me, undefined);
    assert.match((await req('GET', '/api/blueprints/40_Mat/materials?format=text', { token: read })).text, /im ME +fehlt +Item/);
    assert.match((await req('GET', '/api/materials?ids=40_Mat&format=csv', { token: read })).text, /;Im ME;Fehlt im ME;Craftbar\r\n/);

    // a new blueprint version is a new job only when assigned explicitly
    const up = await req('POST', '/api/blueprints/40_Mat/edits', { token: write, body: { baseVersion: 1, edits: [{ op: 'set', pos: [1, 1, 1], block: 'minecraft:glass' }] } });
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const before = (await req('GET', '/api/cannons/nord-1', { token: read })).json;
    assert.equal(before.blueprint.version, 1);
    assert.equal(before.blueprint.currentVersion, 2);
    const upgraded = (await req('PUT', '/api/cannons/nord-1', { token: write, body: { blueprint: '40_Mat', version: null } })).json;
    assert.ok(upgraded.assignment > job1);
    assert.equal(upgraded.blueprint.version, 2);
    assert.equal(upgraded.status.stale, true, 'status of the old job is marked stale');

    // the cannon never places fluids, so no buckets are delivered (the material list still counts them)
    const w = await req('POST', '/api/blueprints/new', { token: write, body: { fileName: '42_Wasser.nbt', origin: [8, 64, 8], size: [2, 1, 1], edits: [
      { op: 'set', pos: [0, 0, 0], block: 'minecraft:water', properties: { level: '0' } }, { op: 'set', pos: [1, 0, 0], block: 'minecraft:stone' }] } });
    assert.equal(w.status, 200, JSON.stringify(w.json));
    const wp = (await req('PUT', '/api/cannons/sued-1', { token: write, body: { blueprint: '42_Wasser' } })).json;
    assert.deepEqual(wp.items.map(i => i.item), ['minecraft:stone']);
    assert.ok((await req('GET', '/api/blueprints/42_Wasser/materials', { token: read })).json.items.some(r => r.item === 'minecraft:water_bucket'));
    assert.equal((await req('DELETE', '/api/cannons/sued-1', { token: write })).status, 200);
    assert.equal((await req('DELETE', '/api/blueprints/42_Wasser', { token: write })).status, 200);

    // scripts for the computers are public and carry the public URL
    const inst = await req('GET', '/cc/install.lua');
    assert.equal(inst.status, 200);
    assert.ok(inst.text.includes('local URL = "http://test"') && !inst.text.includes('{{URL}}'));
    const lua = await req('GET', '/cc/campus.lua');
    assert.ok(lua.text.includes(`local VERSION = "${p0.script}"`));
    assert.ok(!/[^\x00-\x7f]/.test(lua.text.replace(/--[^\n]*/g, '')), 'Lua code outside comments stays ASCII (CC font is Latin-1)');

    // delete + recreate never reuses a job number (the computer would keep the old job's counters)
    assert.equal((await req('DELETE', '/api/cannons/nord-1', { token: write })).status, 200);
    assert.equal((await req('GET', '/api/cannons', { token: read })).json.length, 0);
    const again = (await req('GET', '/api/cannons/nord-1/plan', { token: st })).json;
    const re = (await req('PUT', '/api/cannons/nord-1', { token: write, body: { blueprint: '40_Mat' } })).json;
    assert.ok(again.assignment !== upgraded.assignment && re.assignment > again.assignment);
    // archiving the blueprint ends the job, so the computer returns the leftovers
    assert.equal((await req('DELETE', '/api/blueprints/40_Mat', { token: write })).status, 200);
    const ended = (await req('GET', '/api/cannons/nord-1/plan', { token: st })).json;
    assert.equal(ended.blueprint, null);
    assert.ok(ended.assignment > re.assignment);
    assert.equal(ended.state, 'unassigned');
    assert.equal((await req('POST', '/api/blueprints/40_Mat/revert', { token: write, body: { version: 2 } })).status, 200, 'a new version brings it back');
    assert.equal((await req('DELETE', '/api/cannons/nord-1', { token: write })).status, 200);
  });

  await t.test('block → item mapping', () => {
    assert.deepEqual(itemsFor('minecraft:oak_door', { half: 'upper' }), []);
    assert.deepEqual(itemsFor('minecraft:soul_wall_torch'), [['minecraft:soul_torch', 1]]);
    assert.deepEqual(itemsFor('minecraft:oak_wall_hanging_sign'), [['minecraft:oak_hanging_sign', 1]]);
    assert.deepEqual(itemsFor('minecraft:red_bed', { part: 'foot' }), [['minecraft:red_bed', 1]]);
    assert.deepEqual(itemsFor('minecraft:potted_flowering_azalea_bush'), [['minecraft:flower_pot', 1], ['minecraft:flowering_azalea', 1]]);
    assert.deepEqual(itemsFor('minecraft:water', { level: '0' }), [['minecraft:water_bucket', 1]]);
    assert.deepEqual(itemsFor('minecraft:water', { level: '4' }), []);
    assert.deepEqual(itemsFor('minecraft:sea_pickle', { pickles: '3' }), [['minecraft:sea_pickle', 3]]);
    assert.deepEqual(itemsFor('minecraft:cobblestone_wall'), [['minecraft:cobblestone_wall', 1]]);
    assert.deepEqual(itemsFor('minecraft:piston_head'), []);
    assert.deepEqual(itemsFor('minecraft:water_cauldron', { level: '3' }), [['minecraft:cauldron', 1], ['minecraft:water_bucket', 1]]);
    assert.deepEqual(itemsFor('minecraft:white_candle_cake'), [['minecraft:cake', 1], ['minecraft:white_candle', 1]]);
    assert.deepEqual(itemsFor('minecraft:candle_cake'), [['minecraft:cake', 1], ['minecraft:candle', 1]]);
    assert.deepEqual(itemsFor('biomesoplenty:potted_origin_sapling'), [['minecraft:flower_pot', 1], ['biomesoplenty:origin_sapling', 1]]);
    assert.deepEqual(itemsFor('create:belt', { part: 'start' }), [['create:belt_connector', 1], ['create:shaft', 1]]);
    assert.deepEqual(itemsFor('create:belt', { part: 'middle' }), []);
    assert.deepEqual(itemsFor('create:brass_encased_shaft'), [['create:shaft', 1], ['create:brass_casing', 1]]);
    assert.deepEqual(itemsFor('create:mechanical_piston_head'), []);
  });

  await t.test('remaining model drops entities and ignores light/void cells', () => {
    const model = { rootName: '', size: [2, 1, 1], rest: { entities: nbtList(10, [nbtCompound({ id: nbtString('minecraft:item_frame') })]) },
      cells: new Map([['0,0,0', { name: 'minecraft:light', props: {} }], ['1,0,0', { name: 'minecraft:stone', props: {} }]]) };
    const r = remainingModel(model, [100, 64, 100], null, null);
    assert.deepEqual([...r.model.cells.keys()], ['1,0,0']);
    assert.equal(r.stats.droppedEntities, 1);
    assert.equal(r.model.rest.entities.v.items.length, 0);
    assert.equal(model.rest.entities.v.items.length, 1, 'original untouched');
  });

  await t.test('viewer scene + binary', async () => {
    const scene = (await req('GET', '/api/viewer/scene', { token: read })).json;
    assert.equal(scene.blueprints.length, 4);
    assert.ok(scene.context.recordCount > 0);
    assert.ok(scene.styles['minecraft:oak_stairs'].material);
    assert.ok(scene.materials.includes('glass'));
    const bin = await req('GET', scene.blueprintsUrl, { token: read });
    assert.equal(bin.status, 200);
    const buf = bin.raw, hlen = buf.readUInt32LE(0);
    const header = JSON.parse(buf.subarray(4, 4 + hlen).toString());
    const base = 4 + hlen + ((4 - ((4 + hlen) % 4)) % 4);
    const hut = header.blueprints.find(b => b.id === '20_Hut');
    const statuses = buf.subarray(base + hut.status, base + hut.status + hut.placed + hut.clear);
    assert.equal(statuses.length, hut.placed + hut.clear);
    assert.ok(statuses.includes(0), 'stone at 1,64,1 is built');
    const again = await app.inject({ method: 'GET', url: scene.blueprintsUrl, headers: { authorization: 'Bearer ' + read, 'if-none-match': bin.headers.etag } });
    assert.equal(again.statusCode, 304);
    const page = await req('GET', '/viewer');
    assert.equal(page.status, 200);
    assert.match(page.text, /importmap/);
    assert.equal((await app.inject({ method: 'GET', url: '/vendor/three/build/three.module.min.js' })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/vendor/three/package.json' })).statusCode, 404);
  });
});

test('old databases get the station token scope without losing tokens', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { openDb } = await import('../src/db.js');
  const dir = mkdtempSync(join(tmpdir(), 'campus-migrate-'));
  try {
    const old = new DatabaseSync(join(dir, 'campus.sqlite'));
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, disabled_at TEXT);
      CREATE TABLE api_tokens (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('read','write')), created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT);
      INSERT INTO users VALUES (1, 'a', 'x', 'admin', 't', NULL);
      INSERT INTO api_tokens VALUES (7, 1, 'alt', 'h', 'atc_', 'write', 't', NULL, NULL);`);
    old.close();
    const db = openDb(dir);
    assert.deepEqual({ ...db.prepare('SELECT id, name, scope FROM api_tokens').get() }, { id: 7, name: 'alt', scope: 'write' });
    db.prepare("INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, created_at) VALUES (1, 'cc', 'h2', 'atc_', 'station', 't')").run();
    assert.throws(() => db.prepare("INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, created_at) VALUES (1, 'x', 'h3', 'atc_', 'root', 't')").run());
    db.close();
    openDb(dir).close();   // idempotent
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
