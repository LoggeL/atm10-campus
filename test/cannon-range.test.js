import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cannonRange, reachableCannons } from '../src/cannon-range.js';
import { cannonRangeCard, distanceText } from '../public/assets/cannon-range.js';
import { buildServer } from '../src/server.js';
import { writeWorld, structureNbt } from './helpers.js';

const binding = x => ({ dimension: 'minecraft:overworld', x, y: 64, z: 0, owner: 'Campus' });
const idle = () => ({ at: Date.now()/1000, state: 'STOPPED', amountPlaced: 0, amountToPlace: 0, flyingBlocks: 0,
  printer: { DeferredBlocks: [], PrintStage: 'BLOCKS', EntityProgress: -1 }, item: null, components: {}, fileHash: null });

test('strict 256-block range includes height and candidate ranking preserves occupied jobs', () => {
  assert.equal(cannonRange(binding(0), [255, 64, 0]).state, 'inrange');
  assert.equal(cannonRange(binding(0), [256, 64, 0]).state, 'outofrange');
  assert.equal(cannonRange(binding(0), [0, 320, 0]).state, 'outofrange');
  assert.equal(cannonRange(binding(0), [180, 100, 180]).state, 'outofrange');
  assert.equal(cannonRange(null, [1,64,1]).state, 'unbound');
  assert.equal(cannonRange({ ...binding(0), dimension: 'minecraft:the_end' }, [1,64,1]).state, 'dimension');
  const rows = ['source','free','busy','offline','unbound','distant','nether'].map((name, i) => ({ name, assignment: i, blueprint_id: name === 'busy' ? 'already-building' : null, status_json: JSON.stringify({ script: '1.2.0', at: new Date().toISOString() }), last_seen_at: name === 'offline' ? '2000-01-01' : new Date().toISOString() }));
  rows.find(r => r.name === 'free').status_json = JSON.stringify({script:'1.3.0',at:new Date().toISOString()});
  const bindings = { source: binding(-300), free: binding(20), busy: binding(0), offline: binding(3), distant: binding(500), nether: { ...binding(0), dimension: 'minecraft:the_nether' } };
  const found = reachableCannons(rows, 'SOURCE', [0,64,0], n => bindings[n], () => false);
  assert.deepEqual(found.map(c => c.name), ['free','busy','offline']);
  assert.equal(found[0].availability, 'free');
  assert.equal(found[1].availability, 'assigned');
});

test('range UI shows actionable free candidates, empty cases, precise boundary and escaped names', () => {
  const c = { assignment: 5, range: { ...cannonRange(binding(-300), [4,64,4]), version: 2, candidates: [
    { name: '<free>', availability: 'free', position: [0,64,0], distance: 6, assignment: 8 },
    { name: 'busy', availability: 'assigned', position: [1,64,1], distance: 4, assignment: 9 }
  ] } };
  const html = cannonRangeCard(c, true);
  assert.match(html, /Außer Reichweite/);
  assert.match(html, /&lt;free&gt;/);
  assert.equal((html.match(/data-act="transfer"/g) || []).length, 1);
  assert.doesNotMatch(cannonRangeCard(c, false), /data-act="transfer"/);
  assert.match(cannonRangeCard({ ...c, range: { ...c.range, candidates: [] } }), /Keine bestätigte Kanone/);
  assert.match(cannonRangeCard({ ...c, range: { ...c.range, candidates: c.range.candidates.slice(1) } }), /keine dieser Kanonen frei/);
  assert.equal(distanceText(Math.sqrt(65534)), '255,996');
});

test('out-of-range plans stay visible and blocked; a guarded transfer preserves version, coordinates and settings', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'campus-range-'));
  writeWorld(join(dir, 'world'), [{ cx: 0, cz: 0, blocks: [] }]);
  const bindings = {}, observations = {}, calls = [];
  let inspectHook;
  const app = await buildServer({ dataDir: join(dir, 'data'), worldSources: { live: join(dir, 'world') },
    contextOrigin: [0,48,0], contextSize: [16,32,16], snapshotKeepRecent: 10, publicUrl: 'http://test', cookieSecure: false,
    bootstrapInvite: 'range-bootstrap-code', maxUploadBytes: 1048576,
    cannonBridgeRequest: async (action, b) => {
      calls.push([action, b.station]);
      if (action === 'bind') { bindings[b.station] = b.binding; observations[b.station] = idle(); }
      if (action === 'inspect' && inspectHook) await inspectHook(b.station);
      if (action === 'prepare') {
        const d = b.desired;
        observations[b.station] = { ...idle(), item: 'create:schematic', fileHash: d.sha256, options: b.options, components: {
          'create:schematic_file': d.file, 'create:schematic_owner': d.owner, 'create:schematic_anchor': d.anchor,
          'create:schematic_rotation': 'none', 'create:schematic_mirror': 'none', 'create:schematic_deployed': 1 } };
      }
      return { binding: b.binding || bindings[b.station], observed: { ...observations[b.station], at: Date.now()/1000 }, nonce: 'fixture' };
    } });
  t.after(async () => { await app.close(); app.campus.db.close(); rmSync(dir, { recursive: true, force: true }); });
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: 'range-bootstrap-code', username: 'admin', password: 'range-test-password' } });
  const cookie = reg.headers['set-cookie'].split(';')[0];
  const req = (method, url, payload, headers = { cookie, 'x-campus-csrf': '1' }) => app.inject({ method, url, payload, headers });
  for (const [name, x] of [['source',-300], ['free',0], ['occupied',4], ['offline',8]]) {
    await req('PUT', '/api/cannons/' + name, {});
    await req('POST', '/api/cannons/' + name + '/status', { script: '1.2.0' });
    await req('POST', '/api/cannons/' + name + '/alignment/bind', { confirm: true, binding: binding(x), nonce: 'fixture' });
  }
  const bytes = structureNbt([1,1,1], [{ pos: [0,0,0], name: 'minecraft:stone' }]);
  await req('POST', '/api/blueprints', { fileName: 'Build.nbt', origin: [4,64,4], nbtBase64: bytes.toString('base64') });
  await req('POST', '/api/snapshots', { force: true });
  await req('PUT', '/api/cannons/occupied', { blueprint: 'Build' });
  app.campus.db.prepare("UPDATE cannons SET last_seen_at='2000-01-01' WHERE name='offline'").run();
  let r = await req('PUT', '/api/cannons/source', { blueprint: 'Build', schematic: { enabled: true }, options: { autoCraft: true, bufferStacks: 4 } });
  assert.equal(r.statusCode, 200, r.body);
  const source = r.json();
  assert.equal(source.state, 'outofrange');
  assert.equal(source.schematic.job.state, 'outofrange');
  assert.equal(source.blueprint.id, 'Build');
  assert.equal(source.range.candidates[0].name, 'free');
  assert.equal(source.range.candidates.find(c => c.name === 'occupied').availability, 'assigned');
  assert.equal(source.range.candidates.find(c => c.name === 'offline').availability, 'offline');
  const plan = (await req('GET', '/api/cannons/source/plan')).json();
  assert.equal(plan.state, 'outofrange');
  assert.deepEqual(plan.items, []);
  assert.equal(plan.options.autoCraft, false);
  assert.equal(plan.options.gunpowder, 0);
  assert.equal(plan.alignment.state, 'outofrange');
  assert.equal(calls.some(([a]) => a === 'prepare'), false, 'out-of-range preparation never writes to host');
  const target = (await req('GET', '/api/cannons/free')).json();
  const body = { target: 'free', sourceAssignment: source.assignment, targetAssignment: target.assignment, baseVersion: 1 };
  const endpoint = '/api/cannons/source/transfer';
  const token = (await req('POST', '/api/tokens', { name: 'writer', scope: 'write' })).json().token;
  assert.equal((await req('POST', endpoint, body, { authorization: 'Bearer ' + token })).statusCode, 403);
  assert.equal((await req('POST', endpoint, body, { cookie })).statusCode, 403);
  assert.equal((await req('POST', endpoint, { ...body, sourceAssignment: 0 })).statusCode, 409);
  assert.equal((await req('POST', endpoint, { ...body, target: 'occupied' })).statusCode, 409);
  assert.equal((await req('POST', endpoint, { ...body, target: 'offline' })).statusCode, 409);
  for (const change of [{ state: 'RUNNING' }, { state: 'PAUSED' }, { flyingBlocks: 1 }, { printer: { ...idle().printer, Anchor: [4,64,4] } }]) {
    observations.source = { ...idle(), ...change };
    assert.equal((await req('POST', endpoint, body)).statusCode, 409);
    assert.equal((await req('GET', '/api/cannons/source')).json().assignment, source.assignment);
    assert.equal((await req('GET', '/api/cannons/free')).json().blueprint, null);
  }
  observations.source = idle();
  observations.free = { ...idle(), item: 'create:schematic', components: { 'create:schematic_owner': 'Someone' } };
  assert.equal((await req('POST', endpoint, body)).statusCode, 409);
  observations.free = idle();
  assert.equal((await req('PATCH', '/api/blueprints/Build', { baseVersion: 1, origin: [5,64,4] })).statusCode, 200);
  assert.equal((await req('POST', endpoint, body)).statusCode, 409, 'a transfer must select the current version');
  let release, arrived;
  const hold = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { arrived = resolve; });
  inspectHook = async name => { if (name === 'free') { arrived(); await hold; } };
  const inflight = Promise.resolve(req('POST', endpoint, { ...body, baseVersion: 2 }));
  await entered;
  assert.equal((await req('PATCH', '/api/blueprints/Build', { baseVersion: 2, origin: [6,64,4] })).statusCode, 409, 'version drift is rejected during the live transfer probe');
  assert.equal(app.campus.getBlueprint('Build').currentVersion, 2);
  assert.equal((await req('PUT', '/api/cannons/source', { blueprint: null })).statusCode, 409);
  assert.equal((await req('PUT', '/api/cannons/free', { blueprint: 'Build' })).statusCode, 409);
  release(); inspectHook = null;
  r = await inflight;
  assert.equal(r.statusCode, 200, r.body);
  const moved = r.json();
  assert.equal(moved.source.blueprint, null);
  assert.equal(moved.source.schematic.job, null);
  assert.equal(moved.target.blueprint.id, 'Build');
  assert.equal(moved.target.blueprint.version, 2);
  assert.deepEqual(moved.target.blueprint.origin, [5,64,4]);
  assert.equal(moved.target.options.bufferStacks, 4);
  assert.equal(moved.target.options.autoCraft, true);
  assert.equal(moved.target.schematic.settings.protectBlockEntities, true);
  assert.equal(moved.target.schematic.job.state, 'ready');
  assert.notEqual(moved.source.assignment, source.assignment);
  assert.equal(calls.filter(([a]) => a === 'prepare').length, 1);
  assert.equal((await req('POST', endpoint, body)).statusCode, 409, 'repeat clicks cannot duplicate the assignment');
});
