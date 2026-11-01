import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildServer } from '../src/server.js';
import { writeWorld, structureNbt } from './helpers.js';
import { parseStructure } from '../src/nbt.js';

test('bound automatic Schematic preparation, immutable rest plan, settings, safe retry and version handoff', async t => {
  const tmp = mkdtempSync(join(tmpdir(), 'campus-schematic-'));
  writeWorld(join(tmp, 'world'), [{ cx: 0, cz: 0, blocks: [] }]);
  const binding = { dimension: 'minecraft:overworld', x: 0, y: 64, z: 0, owner: 'Owner' };
  let applied = null, appliedOptions, allow = false, held, entered;
  const observed = () => ({ at: Date.now()/1000, state: 'STOPPED', amountPlaced: 0, amountToPlace: 0, printer: {},
    item: 'create:schematic', fileHash: applied?.sha256, options: appliedOptions,
    components: applied ? { 'create:schematic_file': applied.file, 'create:schematic_owner': applied.owner,
      'create:schematic_anchor': applied.anchor, 'create:schematic_rotation': 'none', 'create:schematic_mirror': 'none', 'create:schematic_deployed': 1 } : {} });
  const app = await buildServer({ dataDir: join(tmp, 'data'), worldSources: { live: join(tmp, 'world') },
    contextOrigin: [0, 48, 0], contextSize: [16, 32, 16], snapshotKeepRecent: 10, bootstrapInvite: 'schematic-bootstrap-test',
    publicUrl: 'http://test', cookieSecure: false, maxUploadBytes: 1024 * 1024,
    cannonBridgeRequest: async (action, payload) => {
      if (action === 'prepare') {
        if (entered) entered();
        if (held) await held;
        if (!allow) throw new Error('Kanone läuft. Vollständig stoppen.');
        const bytes = Buffer.from(payload.nbtBase64, 'base64');
        assert.equal(createHash('sha256').update(bytes).digest('hex'), payload.desired.sha256);
        assert.equal(parseStructure(bytes).placed.length, 1);
        applied = payload.desired; appliedOptions = payload.options;
      }
      return { binding, observed: observed(), nonce: 'test-probe' };
    } });
  t.after(async () => { await app.close(); app.campus.db.close(); rmSync(tmp, { recursive: true, force: true }); });
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: 'schematic-bootstrap-test', username: 'admin', password: 'password-test-123' } });
  const cookie = reg.cookies[0].name + '=' + reg.cookies[0].value;
  const request = (method, url, payload, token) => app.inject({ method, url, payload,
    headers: token ? { authorization: 'Bearer ' + token } : { cookie, 'x-campus-csrf': '1' } });
  const station = (await request('POST', '/api/tokens', { name: 'station', scope: 'station' })).json().token;
  const write = (await request('POST', '/api/tokens', { name: 'writer', scope: 'write' })).json().token;
  const source = structureNbt([2, 1, 1], [{ pos: [0, 0, 0], name: 'minecraft:stone' }]);
  await request('POST', '/api/blueprints', { fileName: 'Build.nbt', origin: [4, 64, 4], nbtBase64: source.toString('base64') });
  await request('POST', '/api/snapshots', { force: true });
  const name = '/api/cannons/test';
  await request('PUT', name, { blueprint: 'Build' });
  assert.equal((await request('PUT', name, { schematic: { enabled: true } })).statusCode, 400, 'binding required');
  assert.equal((await request('PUT', name, { schematic: { enabled: true } }, write)).statusCode, 403, 'browser admin required');
  await request('POST', name + '/status', { script: '1.2.0' });
  await request('POST', name + '/alignment/probe', { binding });
  assert.equal((await request('POST', name + '/alignment/bind', { binding, nonce: 'test-probe', confirm: true })).statusCode, 200);
  const waiting = await request('PUT', name, { schematic: { enabled: true } });
  assert.equal(waiting.statusCode, 200, waiting.body);
  const first = waiting.json().schematic.job;
  assert.equal(first.state, 'waiting');
  assert.deepEqual(first.origin, [4, 64, 4]);
  assert.match(first.message, /stoppen/);
  assert.equal(waiting.json().state, 'preparing', 'a waiting rest plan is shown as such, not as an alignment fault');
  assert.match(waiting.json().message, /stoppen/);
  const blocked = (await request('GET', name + '/plan', undefined, station)).json();
  assert.deepEqual(blocked.items, []);
  assert.equal(blocked.options.autoCraft, false);
  assert.equal((await request('POST', name + '/schematic/prepare', {}, station)).statusCode, 403);
  for (const schematic of [{ replaceMode: 3 }, { skipMissing: 'false' }]) {
    assert.equal((await request('PUT', name, { schematic })).statusCode, 400);
    assert.equal((await request('GET', name)).json().schematic.job.id, first.id);
  }
  allow = true;
  const prepared = (await request('POST', name + '/schematic/prepare', {})).json();
  assert.equal(prepared.job.state, 'ready');
  const ready = (await request('GET', name)).json();
  assert.equal(ready.alignment.state, 'aligned');
  assert.equal(ready.state, 'feeding');
  assert.equal((await request('GET', name)).json().schematic.job.id, prepared.job.id, 'polling does not regenerate plans');
  assert.deepEqual(appliedOptions, { replace_mode: 2, skip_missing: false, replace_block_entities: false });

  await request('PATCH', '/api/blueprints/Build', { origin: [5, 64, 4], baseVersion: 1 });
  const next = (await request('GET', name)).json();
  assert.equal(next.blueprint.version, 1, 'feeder version waits for physical handoff');
  assert.equal(next.schematic.job.version, 2);
  assert.equal(next.state, 'preparing');
  assert.equal((await request('GET', name + '/plan', undefined, station)).json().items.length, 0, 'old schematic gets no material for the new version');
  let release;
  held = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { entered = resolve; });
  const inflight = request('POST', name + '/schematic/prepare', {});
  // Fastify inject is lazy until its thenable is consumed.
  const completion = Promise.resolve(inflight);
  await arrived;
  assert.equal((await request('PUT', name, { options: { paused: true } })).statusCode, 409);
  assert.equal((await request('DELETE', '/api/blueprints/Build')).statusCode, 409);
  release();
  assert.equal((await completion).json().job.state, 'ready');
  const updated = (await request('GET', name)).json();
  assert.equal(updated.blueprint.version, 2);
  assert.notEqual(updated.assignment, ready.assignment);
  appliedOptions = { ...appliedOptions, skip_missing: true };
  assert.equal((await request('GET', name + '/plan', undefined, station)).json().state, 'alignment', 'native option drift blocks supply');
});
