import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorld, structureNbt } from './helpers.js';
import { buildServer } from '../src/server.js';

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
test.after(async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); });

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

  await t.test('viewer scene + binary', async () => {
    const scene = (await req('GET', '/api/viewer/scene', { token: read })).json;
    assert.equal(scene.blueprints.length, 2);
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
