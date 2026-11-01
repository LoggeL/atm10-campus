import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { writeWorld, structureNbt } from './helpers.js';

const refused = message => Object.assign(new Error(message), { statusCode: 409 });
const glass = [{ pos: [0, 0, 0], name: 'minecraft:glass' }];

// A controlled host bridge: every test decides the native state and sees each action.
async function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cannon-build-')), calls = [], hooks = {}, native = new Map();
  writeWorld(join(dir, 'world'), [{ cx: 0, cz: 0, blocks: [{ x: 4, y: 64, z: 4, name: 'minecraft:stone' }, { x: 4, y: 65, z: 4, name: 'minecraft:stone' }] }]);
  const bindings = { one: { dimension: 'minecraft:overworld', x: 0, y: 64, z: 0, owner: 'Campus' }, two: { dimension: 'minecraft:overworld', x: 15, y: 64, z: 15, owner: 'Campus' } };
  const cannon = name => { if (!native.has(name)) native.set(name, { state: 'STOPPED', amountPlaced: 0, amountToPlace: 0, flyingBlocks: 0, item: null, components: {}, fileHash: null, options: null, anchor: null }); return native.get(name); };
  const observed = name => {
    const n = cannon(name);
    return { at: Date.now() / 1000, status: 'idle', inputEmpty: !n.item, printer: n.anchor ? { Anchor: n.anchor } : { DeferredBlocks: [], EntityProgress: -1, PrintStage: 'BLOCKS' }, ...n };
  };
  const app = await buildServer({ dataDir: join(dir, 'data'), worldSources: { live: join(dir, 'world') }, contextOrigin: [0, 48, 0], contextSize: [16, 32, 16], snapshotKeepRecent: 10,
    bootstrapInvite: 'build-bootstrap-test', publicUrl: 'http://test', cookieSecure: false, maxUploadBytes: 4 * 1024 * 1024,
    cannonBridgeRequest: async (action, payload) => {
      const name = payload.station || 'one';
      calls.push(action + ':' + name);
      await hooks[action]?.(name, payload);
      if (action === 'prepare') {
        const n = cannon(name), { desired: d } = payload;
        if (n.state !== 'STOPPED') throw refused('Kanone vollständig stoppen.');
        Object.assign(n, { item: 'create:schematic', fileHash: d.sha256, options: payload.options, components: { 'create:schematic_file': d.file, 'create:schematic_owner': d.owner, 'create:schematic_anchor': d.anchor, 'create:schematic_rotation': 'none', 'create:schematic_mirror': 'none', 'create:schematic_deployed': 1 } });
      }
      if (action === 'start') {
        const n = cannon(name), alreadyRunning = n.state === 'RUNNING';
        Object.assign(n, { state: 'RUNNING', anchor: payload.desired.anchor });
        return { binding: bindings[name], observed: observed(name), started: true, alreadyRunning };
      }
      return { binding: bindings[name], observed: observed(name), nonce: 'probe-build' };
    } });
  t.after(async () => { await app.close(); app.campus.db.close(); rmSync(dir, { recursive: true, force: true }); });
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { code: 'build-bootstrap-test', username: 'admin', password: 'password-test-123' } });
  const cookie = reg.cookies[0].name + '=' + reg.cookies[0].value, headers = { cookie, 'x-campus-csrf': '1', origin: 'http://test' };
  const req = (method, url, payload, extra) => app.inject({ method, url, payload, headers: { ...headers, ...extra } });
  const add = (id, origin, cells, size = [2, 1, 1]) => app.campus.saveVersion({ fileName: id + '.nbt', origin, bytes: structureNbt(size, cells), via: 'test' });
  add('started', [4, 64, 4], [{ pos: [0, 0, 0], name: 'minecraft:stone' }, { pos: [1, 0, 0], name: 'minecraft:glass' }]);
  add('near', [6, 64, 6], glass); add('other', [8, 64, 8], glass);
  await app.campus.capture({ source: 'live', force: true });
  for (const name of ['one', 'two']) {
    await req('POST', `/api/cannons/${name}/status`, { script: '1.3.0' });
    const bound = await req('POST', `/api/cannons/${name}/alignment/bind`, { binding: bindings[name], nonce: 'probe-build', confirm: true });
    assert.equal(bound.statusCode, 200, bound.body);
    await req('PUT', `/api/cannons/${name}`, { schematic: { enabled: true } });
  }
  const row = (name = 'one') => ({ ...app.campus.db.prepare('SELECT * FROM cannons WHERE name=?').get(name) });
  const build = (blueprint, name = 'one', body = {}) => req('POST', `/api/cannons/${name}/build`, { blueprint, version: 1, assignment: row(name).assignment, ...body });
  const count = action => calls.filter(c => c.startsWith(action + ':')).length;
  const activity = action => app.campus.db.prepare('SELECT COUNT(*) n FROM activity WHERE action=?').get(action).n;
  return { app, req, build, row, count, calls, hooks, cannon, add, activity, headers, cookie };
}

test('one selection assigns, prepares and starts exactly the chosen plan', async t => {
  const f = await setup(t), before = f.row();
  const result = await f.build('near');
  assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual({ started: result.json().started, state: result.json().state, message: result.json().message, blueprint: result.json().blueprint }, { started: true, state: 'RUNNING', message: 'Bau gestartet.', blueprint: 'near' });
  assert.equal(f.count('prepare'), 1); assert.equal(f.count('start'), 1);
  assert.ok(f.calls.indexOf('prepare:one') < f.calls.indexOf('start:one'));
  const after = f.row();
  assert.equal(after.blueprint_id, 'near'); assert.ok(after.assignment > before.assignment); assert.equal(result.json().assignment, after.assignment);
  const view = (await f.req('GET', '/api/cannons/one')).json();
  assert.equal(view.schematic.job.state, 'ready'); assert.equal(view.schematic.job.blueprint, 'near');
  assert.equal(f.activity('cannon.assign'), 1); assert.equal(f.activity('cannon.start'), 1);
});

test('only a browser admin with same origin and CSRF header may build, and the body is strict', async t => {
  const f = await setup(t), payload = { blueprint: 'near', version: 1, assignment: f.row().assignment }, url = '/api/cannons/one/build';
  assert.equal((await f.app.inject({ method: 'POST', url, payload })).statusCode, 401);
  assert.equal((await f.app.inject({ method: 'POST', url, payload, headers: { cookie: f.cookie } })).statusCode, 403, 'CSRF header');
  assert.equal((await f.req('POST', url, payload, { origin: 'http://evil.test' })).statusCode, 403);
  const token = (await f.req('POST', '/api/tokens', { name: 'writer', scope: 'write' })).json().token;
  assert.equal((await f.app.inject({ method: 'POST', url, payload, headers: { authorization: 'Bearer ' + token } })).statusCode, 403);
  for (const bad of [{ ...payload, command: 'x' }, { ...payload, version: 0 }, { blueprint: 'near', version: 1 }, { ...payload, blueprint: '' }]) assert.equal((await f.req('POST', url, bad)).statusCode, 400);
  assert.equal((await f.req('POST', '/api/cannons/none/build', payload)).statusCode, 404);
  assert.equal(f.calls.filter(c => /^(prepare|start)/.test(c)).length, 0); assert.equal(f.row().blueprint_id, null);
});

test('a busy or foreign native state is refused before the running job is touched', async t => {
  const f = await setup(t);
  assert.equal((await f.build('near')).statusCode, 200);
  const job = (await f.req('GET', '/api/cannons/one')).json().schematic.job, running = f.row();
  const prepares = f.count('prepare'), starts = f.count('start');
  const states = [{ state: 'RUNNING' }, { state: 'PAUSED' }, { state: 'STOPPED', anchor: null, amountPlaced: 3 }, { state: 'STOPPED', anchor: null, amountPlaced: 0, flyingBlocks: 2 }, { state: 'STOPPED', anchor: [1, 2, 3], flyingBlocks: 0 }];
  for (const state of states) {
    Object.assign(f.cannon('one'), state);
    const refusedBuild = await f.build('other');
    assert.equal(refusedBuild.statusCode, 409, JSON.stringify(state)); assert.equal(refusedBuild.json().stage, 'check');
    assert.match(refusedBuild.json().error, /Auftrag bleibt unverändert/);
  }
  Object.assign(f.cannon('one'), { state: 'STOPPED', anchor: null, components: { 'create:schematic_file': 'handmade.nbt', 'create:schematic_owner': 'Spieler' } });
  const foreign = await f.build('other');
  assert.equal(foreign.statusCode, 409); assert.match(foreign.json().error, /manuell eingesetztes Schematic/);
  assert.equal(f.count('prepare'), prepares); assert.equal(f.count('start'), starts);
  const after = f.row();
  assert.deepEqual([after.blueprint_id, after.version, after.assignment, after.start_json], [running.blueprint_id, running.version, running.assignment, running.start_json]);
  assert.equal((await f.req('GET', '/api/cannons/one')).json().schematic.job.id, job.id);
});

test('a refused prerequisite is explained and never overridden', async t => {
  const f = await setup(t), { db } = f.app.campus;
  const check = async (pattern, undo) => {
    const result = await f.build('near');
    assert.equal(result.statusCode, 409); assert.match(result.json().error, pattern);
    assert.equal(f.row().blueprint_id, null); assert.equal(f.count('prepare'), 0); undo();
  };
  await f.req('PUT', '/api/cannons/one', { schematic: { enabled: false } });
  await check(/Automatische Vorbereitung ist für diese Kanone ausgeschaltet/, () => {});
  assert.equal(f.app.campus.db.prepare('SELECT settings_json FROM cannon_schematics WHERE cannon=?').get('one').settings_json.includes('"enabled":false'), true, 'explicit opt-out stays');
  await f.req('PUT', '/api/cannons/one', { schematic: { enabled: true } });
  const seen = f.row().last_seen_at;
  db.prepare('UPDATE cannons SET last_seen_at=? WHERE name=?').run(new Date(Date.now() - 10 * 60e3).toISOString(), 'one');
  await check(/offline/, () => db.prepare('UPDATE cannons SET last_seen_at=? WHERE name=?').run(seen, 'one'));
  await f.req('PUT', '/api/cannons/one', { options: { paused: true } });
  await check(/pausiert/, () => {});
});

test('stale, claimed, archived and changed selections are rejected at the moment of commit', async t => {
  const f = await setup(t), { db } = f.app.campus;
  assert.equal((await f.build('near', 'one', { assignment: 1 })).statusCode, 409, 'stale assignment');
  assert.equal((await f.build('near', 'one', { version: 2 })).statusCode, 409, 'unknown version');
  assert.equal((await f.build('missing')).statusCode, 404);
  const race = async change => {
    f.hooks.inspect = async () => { f.hooks.inspect = null; change(); };
    const result = await f.build('near');
    assert.equal(result.statusCode, 409, result.body); assert.equal(result.json().stage, 'check');
    assert.equal(f.row().blueprint_id, null);
  };
  await race(() => db.prepare('UPDATE cannons SET assignment=assignment+1 WHERE name=?').run('one'));
  await race(() => db.prepare('UPDATE cannons SET blueprint_id=? WHERE name=?').run('near', 'two'));
  db.prepare('UPDATE cannons SET blueprint_id=NULL WHERE name=?').run('two');
  await race(() => db.prepare('UPDATE cannons SET options_json=? WHERE name=?').run(JSON.stringify({ skipBlocked: false }), 'one'));
  await race(() => f.add('near', [6, 64, 6], [{ pos: [0, 0, 0], name: 'minecraft:dirt' }]));
  assert.equal(f.count('prepare'), 0); assert.equal(f.count('start'), 0);
});

test('two cannons racing for one plan and repeated clicks start it exactly once', async t => {
  const f = await setup(t);
  let release; const gate = new Promise(r => release = r);
  const arrived = []; f.hooks.inspect = () => new Promise(r => { arrived.push(r); if (arrived.length === 2) release(); gate.then(r); });
  const first = f.build('near', 'one'), second = f.build('near', 'two');
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409], results.map(r => r.body).join(' / '));
  assert.equal(f.count('start'), 1);
  assert.equal(f.app.campus.db.prepare('SELECT COUNT(*) n FROM cannons WHERE blueprint_id=?').get('near').n, 1);
  f.hooks.inspect = null;

  const free = results[0].statusCode === 200 ? 'two' : 'one', starts = f.count('start'), prepares = f.count('prepare');
  let hold; const held = new Promise(r => hold = r), entered = new Promise(r => { f.hooks.prepare = async () => { r(); await held; }; });
  const assignment = f.row(free).assignment, click = f.build('other', free, { assignment });
  await entered;
  assert.equal((await f.build('other', free, { assignment })).statusCode, 409, 'second click while running');
  assert.equal((await f.build('started', free, { assignment })).statusCode, 409, 'other plan while running');
  assert.equal((await f.req('PUT', `/api/cannons/${free}`, { options: { bufferStacks: 3 } })).statusCode, 409, 'settings cannot change mid-flight');
  hold();
  assert.equal((await click).statusCode, 200);
  assert.equal((await f.build('other', free, { assignment })).statusCode, 409, 'repeat after success carries a stale assignment');
  assert.equal(f.count('start'), starts + 1); assert.equal(f.count('prepare'), prepares + 1);
});

test('failed preparation never starts; preparing alone never starts; retrying is an explicit selection', async t => {
  const f = await setup(t);
  f.hooks.prepare = () => { throw refused('Bücher aus dem Kanonen-Inventar nehmen.'); };
  const failed = await f.build('near');
  assert.equal(failed.statusCode, 409); assert.equal(failed.json().stage, 'prepare'); assert.match(failed.json().error, /Bücher/);
  assert.equal(f.count('start'), 0);
  const assigned = f.row(); assert.equal(assigned.blueprint_id, 'near', 'the choice stays visible for an explicit retry');
  assert.equal((await f.req('GET', '/api/cannons/one')).json().schematic.job.state, 'waiting');
  f.hooks.prepare = null;
  assert.equal((await f.req('POST', '/api/cannons/one/schematic/prepare', {})).statusCode, 200);
  for (let i = 0; i < 3; i++) await f.req('GET', '/api/cannons/one');
  assert.equal((await f.req('GET', '/api/cannons/one')).json().schematic.job.state, 'ready');
  assert.equal(f.count('start'), 0, 'no stored intent: a later preparation does not start anything');
  const prepares = f.count('prepare'), retry = await f.build('near');
  assert.equal(retry.statusCode, 200, retry.body); assert.equal(f.count('start'), 1);
  assert.equal(f.count('prepare'), prepares, 'an already prepared selection only starts');
});

test('a refused start after preparation names the stage and leaves the prepared job', async t => {
  const f = await setup(t);
  f.hooks.inspect = name => { if (f.count('prepare')) f.cannon(name).fileHash = 'drifted'; };
  const failed = await f.build('near');
  assert.equal(failed.statusCode, 409); assert.equal(failed.json().stage, 'start'); assert.equal(f.count('start'), 0);
  assert.equal(f.activity('cannon.start.blocked'), 1); assert.equal(f.activity('cannon.build.blocked'), 0);
});

test('re-selecting a consumed plan waits for a newer world instead of replanning placed blocks', async t => {
  const f = await setup(t), { db } = f.app.campus;
  await f.build('near');
  const job = JSON.parse(db.prepare('SELECT job_json FROM cannon_schematics WHERE cannon=?').get('one').job_json);
  db.prepare('UPDATE cannon_schematics SET job_json=? WHERE cannon=?').run(JSON.stringify({ ...job, state: 'consumed', message: 'Abgearbeitet.', consumedAt: Date.now() + 60e3 }), 'one');
  Object.assign(f.cannon('one'), { state: 'STOPPED', anchor: null, item: null, components: {} });
  const prepares = f.count('prepare'), result = await f.build('near');
  assert.equal(result.statusCode, 409); assert.equal(result.json().stage, 'prepare'); assert.match(result.json().error, /Abgearbeitet/);
  assert.equal(f.count('prepare'), prepares); assert.equal(f.count('start'), 1);
});

test('choices list started plans first by real block counts, then by distance and name', async t => {
  const f = await setup(t), cells = [];
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 7; y++) cells.push({ pos: [x, y, z], name: x === 4 && y === 0 && z === 4 ? 'minecraft:stone' : 'minecraft:glass' });
  f.add('huge', [0, 65, 0], cells, [16, 7, 16]);
  await f.app.campus.capture({ source: 'live', force: true });
  const { items } = (await f.req('GET', '/api/cannons/one')).json().blueprintChoices;
  const huge = items.find(b => b.id === 'huge');
  assert.equal(huge.progress, 0, 'rounds to zero'); assert.equal(huge.built, 1);
  assert.deepEqual(items.map(b => b.id), ['started', 'huge', 'near', 'other']);
  assert.equal((await f.req('GET', '/api/cannons/two')).json().blueprintChoices.items.map(b => b.id).indexOf('other'), 2, 'nearest unstarted first per cannon');
});
