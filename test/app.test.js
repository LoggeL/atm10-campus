import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeWorld, structureNbt } from './helpers.js';
import { buildServer } from '../src/server.js';

const tmp = mkdtempSync(join(tmpdir(), 'campus-test-'));
const worldDir = join(tmp, 'world');
writeWorld(worldDir, [{
  cx: 0, cz: 0,
  blocks: [
    { x: 1, y: 64, z: 1, name: 'minecraft:stone' },
    { x: 2, y: 64, z: 1, name: 'minecraft:glass' },
    { x: 3, y: 64, z: 1, name: 'minecraft:glass' },
    { x: 5, y: 64, z: 5, name: 'minecraft:chest' },
  ],
  blockEntities: [{ id: 'minecraft:chest', x: 5, y: 64, z: 5 }],
}]);

const config = {
  port: 0, host: '127.0.0.1', dataDir: join(tmp, 'data'), worldSources: { live: worldDir },
  contextOrigin: [0, 48, 0], contextSize: [16, 32, 16], snapshotIntervalMin: 0, snapshotKeepRecent: 10,
  bootstrapInvite: 'bootstrap-invite-code-123', publicUrl: 'http://test', cookieSecure: false, maxUploadBytes: 32 * 1024 * 1024,
};
const app = await buildServer(config);
let cookie = '';
const req = async (method, url, { body, headers = {}, token, raw } = {}) => {
  const h = { ...headers };
  if (token) h.authorization = 'Bearer ' + token;
  else if (cookie) { h.cookie = cookie; h['x-campus-csrf'] = '1'; }
  let payload = body;
  if (body && !Buffer.isBuffer(body) && typeof body !== 'string') { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
  const r = await app.inject({ method, url, payload, headers: h });
  return { status: r.statusCode, json: raw ? null : (r.headers['content-type']?.includes('json') ? r.json() : null), body: r.rawPayload, headers: r.headers, cookies: r.cookies };
};

test.after(async () => { await app.close(); rmSync(tmp, { recursive: true, force: true }); });

test('bootstrap admin, snapshot, blueprints, tokens, conflicts, import', async t => {
  assert.equal((await req('GET', '/api/status')).status, 401);

  const reg = await req('POST', '/api/auth/register', { body: { code: config.bootstrapInvite, username: 'logge', password: 'sehr-geheim-123' } });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  assert.equal(reg.json.user.role, 'admin');
  cookie = `campus_session=${reg.cookies.find(c => c.name === 'campus_session').value}`;
  // bootstrap code is single use once a user exists
  assert.equal((await app.inject({ method: 'GET', url: '/api/auth/invite/' + config.bootstrapInvite })).json().valid, false);

  // CSRF header required for cookie-auth mutations
  const noCsrf = await app.inject({ method: 'POST', url: '/api/tokens', headers: { cookie, 'content-type': 'application/json' }, payload: '{"name":"x"}' });
  assert.equal(noCsrf.statusCode, 403);

  await t.test('snapshot', async () => {
    const s = await req('POST', '/api/snapshots', { body: { force: true } });
    assert.equal(s.status, 200, JSON.stringify(s.json));
    assert.equal(s.json.snapshot.recordCount, 4);
    assert.equal(s.json.snapshot.blockEntityCount, 1);
    const again = await req('POST', '/api/snapshots', { body: {} });
    assert.equal(again.json.skipped, true, 'unchanged world is skipped');
  });

  // Blueprint at origin 1,64,1: stone at 0,0,0 (already built), planks at 1,0,0 (replaces glass), air at 4,0,4 (chest!)
  const bp1 = structureNbt([5, 1, 5], [
    { pos: [0, 0, 0], name: 'minecraft:stone' },
    { pos: [1, 0, 0], name: 'minecraft:oak_planks' },
    { pos: [0, 0, 2], name: 'minecraft:oak_planks' },
    { pos: [4, 0, 4], name: 'minecraft:air' },
    { pos: [3, 0, 3], name: 'minecraft:structure_void' },
  ]);

  await t.test('create + analyse', async () => {
    const r = await req('PUT', '/api/blueprints/10_Test/nbt?fileName=10_Test.nbt&origin=1,64,1&name=Test', { body: bp1, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.version.version, 1);
    const st = await req('GET', '/api/status');
    const b = st.json.blueprints.find(x => x.id === '10_Test');
    assert.equal(b.status, 'conflict');
    assert.equal(b.conflicts.protectedBlockEntities, 1);
    assert.deepEqual([b.counts.built, b.counts.toReplace, b.counts.toPlace, b.counts.toClear], [1, 1, 1, 1]);
    const same = await req('PUT', '/api/blueprints/10_Test/nbt', { body: bp1, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(same.json.unchanged, true);
  });

  let readToken, writeToken;
  await t.test('tokens', async () => {
    readToken = (await req('POST', '/api/tokens', { body: { name: 'reader', scope: 'read' } })).json.token;
    writeToken = (await req('POST', '/api/tokens', { body: { name: 'agent', scope: 'write' } })).json.token;
    assert.match(writeToken, /^atc_/);
    const dl = await req('GET', '/api/blueprints/10_Test/download', { token: readToken, raw: true });
    assert.equal(dl.status, 200);
    assert.deepEqual(Buffer.from(dl.body), bp1);
    const denied = await req('PUT', '/api/blueprints/10_Test/nbt?origin=1,64,1', { token: readToken, body: bp1, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(denied.status, 403);
    assert.equal((await req('GET', '/api/tokens', { token: writeToken })).status, 403, 'tokens cannot manage tokens');
  });

  await t.test('optimistic locking', async () => {
    const v2 = structureNbt([5, 1, 5], [{ pos: [0, 0, 0], name: 'minecraft:stone' }, { pos: [1, 0, 0], name: 'minecraft:glass' }]);
    const ok = await req('PUT', '/api/blueprints/10_Test/nbt?baseVersion=1&note=glas', { token: writeToken, body: v2, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.version.version, 2);
    assert.equal(ok.json.version.uploadedBy, 'logge');
    const stale = await req('PUT', '/api/blueprints/10_Test/nbt?baseVersion=1', { token: writeToken, body: bp1, headers: { 'content-type': 'application/octet-stream' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.currentVersion, 2);
    const rev = await req('POST', '/api/blueprints/10_Test/revert', { token: writeToken, body: { version: 1 } });
    assert.equal(rev.json.version.version, 3);
  });

  await t.test('overlaps + changed since base', async () => {
    const other = structureNbt([1, 1, 1], [{ pos: [0, 0, 0], name: 'minecraft:diamond_block' }]);
    const r = await req('POST', '/api/blueprints', { token: writeToken, body: { fileName: '11_Other.nbt', origin: [1, 64, 1], nbtBase64: other.toString('base64') } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const st = (await req('GET', '/api/status')).json;
    assert.equal(st.overlaps.length, 1);
    assert.equal(st.overlaps[0].cells, 1);
    // someone builds in the field: world changes, new snapshot -> changedSinceBase on 11_Other
    writeWorld(worldDir, [{ cx: 0, cz: 0, blocks: [{ x: 1, y: 64, z: 1, name: 'minecraft:dirt' }, { x: 5, y: 64, z: 5, name: 'minecraft:chest' }], blockEntities: [{ id: 'minecraft:chest', x: 5, y: 64, z: 5 }] }]);
    const s2 = await req('POST', '/api/snapshots', { body: { force: true } });
    assert.equal(s2.status, 200);
    const st2 = (await req('GET', '/api/status')).json;
    const o = st2.blueprints.find(x => x.id === '11_Other');
    assert.equal(o.conflicts.changedSinceBase, 1);
    const detail = (await req('GET', '/api/blueprints/11_Other')).json;
    assert.deepEqual(detail.analysis.samples.changedSinceBase[0], { pos: [1, 64, 1], base: 'minecraft:stone', live: 'minecraft:dirt', planned: 'minecraft:diamond_block' });
  });

  await t.test('import viewer html', async () => {
    const nbt = structureNbt([1, 1, 1], [{ pos: [0, 0, 0], name: 'minecraft:gold_block' }]);
    const pkg = { manifest: { version: 7, source_world_date: '2026-10-18', modules: [{ file: '20_Gold.nbt', name: '20 · Gold', origin: [8, 64, 8], category: 'test' }, { file: '10_Test.nbt', name: 'Test', origin: [1, 64, 1] }] },
      files: [{ name: '20_Gold.nbt', base64: nbt.toString('base64') }, { name: '10_Test.nbt', base64: nbt.toString('base64') }], displays: [], uiVersion: 'V9', context: { base64: 'xx' } };
    const html = `<!doctype html><html><head><title>x</title></head><body><header><h1>Campus</h1><span class="badge">LOKAL · OFFLINE</span></header>
<script id="nbt-core">var core=1;</script><script>
const EMBEDDED_PACKAGE = ${JSON.stringify(pkg)};
async function loadContext(meta){ $('contextNoticeTitle').textContent='Bestand vom 18.10.2026'; note('Lade Bestand vom 18.10.2026 …'); }
</script></body></html>`;
    const r = await req('POST', '/api/import/html', { body: html, headers: { 'content-type': 'text/html' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual(r.json.created.map(x => x.blueprint), ['20_Gold']);
    assert.equal(r.json.skippedConflicts.length, 1, '10_Test was edited in the app -> not overwritten');
    assert.deepEqual(r.json.warnings, []);
    const v = await req('GET', '/viewer', { raw: true });
    const page = Buffer.from(v.body).toString();
    assert.match(page, /<script src="\/api\/viewer\/package\.js\?snapshot=\d+"><\/script>\n<script id="nbt-core">/);
    assert.match(page, /const EMBEDDED_PACKAGE = window\.CAMPUS_PACKAGE;/);
    assert.match(page, /LIVE · /);
    assert.doesNotMatch(page, /18\.10\.2026/);
    assert.doesNotMatch(page, /\{\{CAMPUS_/);
    const sid = page.match(/snapshot=(\d+)/)[1];
    const js = await req('GET', '/api/viewer/package.js?snapshot=' + sid, { raw: true });
    const text = Buffer.from(js.body).toString();
    const parsed = JSON.parse(text.slice('window.CAMPUS_PACKAGE='.length, -2));
    assert.deepEqual(parsed.files.map(f => f.name).sort(), ['10_Test.nbt', '11_Other.nbt', '20_Gold.nbt']);
    assert.equal(parsed.context.format, 'minecraft-block-surfaces-v1');
    assert.ok(parsed.context.base64.length > 10);
    assert.deepEqual(parsed.manifest.modules.find(m => m.file === '20_Gold.nbt').origin, [8, 64, 8]);
  });

  await t.test('zip + invites + activity', async () => {
    const z = await req('GET', '/api/blueprints.zip', { token: readToken, raw: true });
    assert.equal(z.status, 200);
    assert.equal(Buffer.from(z.body).readUInt32LE(0), 0x04034b50);
    const inv = await req('POST', '/api/invites', { body: { note: 'Jonny', role: 'member' } });
    const code = inv.json.url.split('/').pop();
    const saved = cookie; cookie = '';
    const jonny = await req('POST', '/api/auth/register', { body: { code, username: 'Jonny', password: 'auch-geheim-456' } });
    assert.equal(jonny.json.user.role, 'member');
    assert.equal((await req('POST', '/api/auth/register', { body: { code, username: 'Jonny2', password: 'auch-geheim-456' } })).status, 400);
    cookie = saved;
    const act = (await req('GET', '/api/activity')).json;
    assert.ok(act.some(a => a.action === 'blueprint.version' && a.via === 'token'));
  });
});

test('seed: baseline snapshot and first import on an empty instance', async () => {
  const { seed } = await import('../src/server.js');
  const { writeFileSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'campus-seed-'));
  const htmlPath = join(dir, 'campus.html');
  const nbt = structureNbt([1, 1, 1], [{ pos: [0, 0, 0], name: 'minecraft:gold_block' }]);
  const pkg = { manifest: { source_world_date: '2026-10-18', modules: [{ file: '20_Gold.nbt', name: 'Gold', origin: [1, 64, 1] }] }, files: [{ name: '20_Gold.nbt', base64: nbt.toString('base64') }] };
  writeFileSync(htmlPath, `<html><body><script>const EMBEDDED_PACKAGE = ${JSON.stringify(pkg)};</script></body></html>`);
  const cfg = { ...config, dataDir: join(dir, 'data'), worldSources: { live: worldDir, backup: worldDir }, seedBaselineSource: 'backup', seedBaselineLabel: 'Backup', seedHtml: htmlPath };
  const app2 = await buildServer(cfg);
  try {
    await seed(app2, cfg);
    await seed(app2, cfg); // idempotent
    const snaps = app2.campus.listSnapshots();
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0].pinned, true);
    const bp = app2.campus.listBlueprints();
    assert.equal(bp.length, 1);
    assert.equal(bp[0].current.baseSnapshotId, snaps[0].id);
    assert.equal(app2.campus.db.prepare('SELECT COUNT(*) AS n FROM packages').get().n, 1);
  } finally { await app2.close(); rmSync(dir, { recursive: true, force: true }); }
});
