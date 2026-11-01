import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCannonPickerDialog } from '../public/assets/cannon-picker-dialog.js';

const plan = { id: 'open', name: 'Nordhaus', version: 3, origin: [4, 64, 4], progress: 62.5, built: 5, total: 8, remaining: 3, distance: 12, blocked: 0, unsupported: 0 };
const station = (over = {}) => ({ name: 'kanone', assignment: 42, online: true, options: { paused: false }, blueprint: null, done: false,
  alignment: { enabled: true, binding: { x: 0, y: 64, z: 0 }, observed: { state: 'STOPPED' } }, schematic: { settings: { enabled: true } },
  blueprintChoices: { items: [plan, { ...plan, id: 'fresh', name: 'Südhaus', built: 0, progress: 0 }], snapshot: null, excluded: {} }, ...over });
const flush = () => new Promise(resolve => setImmediate(resolve));

// The real controller against a small stand-in for the dialog's DOM.
function harness({ read, build } = {}) {
  const element = () => ({ textContent: '', innerHTML: '', value: '', disabled: false, scrollTop: 0, focus() {}, contains: () => false, querySelectorAll: () => [],
    addEventListener(type, fn) { this[type] = fn; } });
  const parts = Object.fromEntries(['cannon', 'title', 'search', 'status', 'list', 'meta', 'close'].map(key => [key, element()]));
  const listeners = {}, settled = [], reads = [], builds = [];
  const dialog = { open: false, ownerDocument: { activeElement: {} }, showModal() { this.open = true; }, close() { this.open = false; listeners.close?.(); },
    querySelector: selector => parts[/data-picker-(\w+)/.exec(selector)[1]], addEventListener: (type, fn) => { listeners[type] = fn; } };
  const picker = createCannonPickerDialog({ dialog, ago: () => 'gerade eben',
    read: read || (name => { reads.push(name); return Promise.resolve(station()); }),
    build: build || ((name, body) => { builds.push([name, body]); return Promise.resolve({ started: true, message: 'Bau gestartet.' }); }),
    onSettled: (...args) => settled.push(args) });
  const click = (id = 'open', version = '3') => listeners.click({ target: { closest: () => ({ disabled: false, dataset: { build: id, version }, matches: selector => selector === '[data-build]' }) } });
  return { picker, dialog, parts, listeners, settled, reads, builds, click };
}

test('opening, polling, typing and focusing read only; only the row button builds', async () => {
  const h = harness();
  h.picker.open('kanone', station({ assignment: 41 }));
  assert.equal(h.dialog.open, true); assert.deepEqual(h.reads, ['kanone'], 'fresh catalog on open');
  assert.match(h.parts.list.innerHTML, /data-build="open"[^>]* disabled/, 'no selection before the fresh catalog arrived');
  h.click(); await flush();
  assert.equal(h.builds.length, 0, 'cached data cannot start anything');
  h.picker.update(station()); h.parts.search.value = 'nord'; h.parts.search.input(); await flush();
  assert.equal(h.builds.length, 0);
  assert.doesNotMatch(h.parts.list.innerHTML, /Südhaus/); assert.match(h.parts.list.innerHTML, /Nordhaus/);
  assert.equal(h.reads.length, 1, 'polling and search cause no extra requests');
});

test('a poll keeps the search, drops a stale row and leaves unrelated cannons alone', async () => {
  const h = harness();
  h.picker.open('kanone', station()); await flush();
  h.parts.search.value = 'haus'; h.parts.search.input();
  h.picker.update(station({ name: 'other', blueprintChoices: { items: [], excluded: {} } }));
  assert.match(h.parts.list.innerHTML, /Nordhaus/);
  h.picker.update(station({ blueprintChoices: { items: [plan], excluded: {} } }));
  assert.equal(h.parts.search.value, 'haus'); assert.doesNotMatch(h.parts.list.innerHTML, /Südhaus/);
  h.picker.update(station({ blueprintChoices: { items: [], excluded: {}, message: 'Kein freier Bauplan.' } }));
  assert.match(h.parts.list.innerHTML, /Kein freier Bauplan/);
  h.click(); await flush(); assert.equal(h.builds.length, 0, 'a row gone from the list cannot be built');
});

test('one click sends the pinned selection once, stays open while running and closes on success', async () => {
  let finish; const h = harness({ build: (name, body) => { h.builds.push([name, body]); return new Promise(resolve => finish = resolve); } });
  h.picker.open('kanone', station()); await flush();
  h.click(); h.click(); await flush();
  assert.deepEqual(h.builds, [['kanone', { blueprint: 'open', version: 3, assignment: 42 }]]);
  assert.match(h.parts.status.innerHTML, /vorbereitet und gestartet/); assert.match(h.parts.list.innerHTML, /Startet …/);
  assert.equal(h.parts.close.disabled, true);
  let prevented = false; h.listeners.cancel({ preventDefault: () => prevented = true }); assert.equal(prevented, true, 'Escape cannot abandon a running request');
  h.listeners.click({ target: h.dialog }); assert.equal(h.dialog.open, true, 'backdrop neither');
  h.picker.update(station({ assignment: 99 })); assert.equal(h.builds.length, 1);
  finish({ started: true, message: 'Bau gestartet.' }); await flush();
  assert.equal(h.dialog.open, false); assert.equal(h.settled.length, 1); assert.equal(h.settled[0][1].started, true);
});

test('Escape and the backdrop close an idle dialog without any request', async () => {
  const h = harness();
  h.picker.open('kanone', station()); await flush();
  let prevented = false; h.listeners.cancel({ preventDefault: () => prevented = true }); assert.equal(prevented, false);
  h.listeners.click({ target: h.dialog }); assert.equal(h.dialog.open, false); assert.equal(h.builds.length, 0);
});

test('a failed step stays visible with its stage, reloads and only retries on a new click', async () => {
  const failures = [Object.assign(new Error('Bücher entfernen.'), { status: 409, data: { stage: 'prepare' } })];
  const h = harness({ build: async (name, body) => { h.builds.push(body); if (failures.length) throw failures.shift(); return { started: true, message: 'Bau gestartet.' }; } });
  h.picker.open('kanone', station()); await flush();
  h.click(); await flush();
  assert.equal(h.dialog.open, true); assert.match(h.parts.status.innerHTML, /Bauplan zugewiesen, aber nicht gestartet: Bücher entfernen\./);
  assert.match(h.parts.list.innerHTML, /Erneut versuchen/); assert.equal(h.reads.length, 2, 'state is reloaded once after the failure');
  await flush(); assert.equal(h.builds.length, 1, 'no automatic retry');
  h.click(); await flush();
  assert.equal(h.builds.length, 2); assert.equal(h.dialog.open, false);
});

test('a lost connection says the outcome is open and a failed read offers an explicit reload', async () => {
  let readFails = false;
  const h = harness({ read: async () => { if (readFails) throw new Error('Zeitüberschreitung'); return station(); }, build: async () => { throw new Error('Failed to fetch'); } });
  h.picker.open('kanone', station()); await flush();
  readFails = true; h.click(); await flush();
  assert.match(h.parts.status.innerHTML, /Ob die Kanone gestartet wurde, ist offen/);
  assert.match(h.parts.status.innerHTML, /data-picker-reload/); assert.match(h.parts.list.innerHTML, /data-build="open"[^>]* disabled/);
});

test('a blocked cannon explains why and keeps every row disabled', async () => {
  for (const [over, text] of [
    [{ schematic: { settings: { enabled: false } } }, /automatische Vorbereitung ist ausgeschaltet/],
    [{ online: false }, /offline/],
    [{ options: { paused: true } }, /Materialzufuhr ist pausiert/],
    [{ alignment: { enabled: true, binding: {}, observed: { state: 'RUNNING' } } }, /baut gerade/],
    [{ alignment: { enabled: true, binding: {}, observed: { state: 'PAUSED' } } }, /ist pausiert/],
    [{ alignment: { enabled: false } }, /Position/],
  ]) {
    const h = harness({ read: async () => station(over) });
    h.picker.open('kanone', station()); await flush();
    assert.match(h.parts.status.innerHTML, text); assert.match(h.parts.list.innerHTML, /data-build="open"[^>]* disabled/);
    h.click(); await flush(); assert.equal(h.builds.length, 0);
  }
});
