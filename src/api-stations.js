// ME stock and Schematicannon feeders: CC:Tweaked computers with an Advanced Peripherals ME Bridge
// report AE2 stock and fetch per cannon what still has to go into the chest next to it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requireActor, HttpError } from './auth.js';
import { now, logActivity, tx } from './db.js';
import { normalizeStockItems, saveStock, latestStock } from './me-stock.js';
import { cannonRange, cannonTarget, reachableCannons } from './cannon-range.js';

const ccDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'cc');
const NAME = /^[A-Za-z0-9_-]{1,40}$/;
const ONLINE_MS = 3 * 60e3;
export const INTERVALS = { plan: 60, status: 30, stock: 300 };

export const DEFAULT_OPTIONS = { paused: false, bufferStacks: 2, gunpowder: 16, autoCraft: false, craftBatch: 256, returnLeftovers: true, skipBlocked: true };
const LIMITS = { bufferStacks: [1, 16], gunpowder: [0, 64], craftBatch: [1, 4096] };

export function normalizeOptions(input, base = DEFAULT_OPTIONS) {
  const o = { ...DEFAULT_OPTIONS, ...base };
  if (!input || typeof input !== 'object') return o;
  for (const k of ['paused', 'autoCraft', 'returnLeftovers', 'skipBlocked']) if (input[k] !== undefined) o[k] = !!input[k];
  for (const [k, [lo, hi]] of Object.entries(LIMITS)) {
    if (input[k] === undefined) continue;
    const n = Math.floor(Number(input[k]));
    if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${k}: ${lo}–${hi} erwartet.`);
    o[k] = n;
  }
  return o;
}

// The Schematicannon skips fluids and places cauldrons empty, so buckets never leave the chest.
const cannonItems = items => items.filter(i => !/_bucket$/.test(i.item));

// Job numbers never repeat for a name, also after delete + recreate: the computer resets on any change.
const nextAssignment = prev => Math.max((prev || 0) + 1, Math.floor(Date.now() / 1000));

const scriptVersion = () => /local VERSION = "([^"]+)"/.exec(readFileSync(join(ccDir, 'campus.lua'), 'utf8'))?.[1] ?? '0';
const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
const int = v => Math.max(0, Math.floor(Number(v) || 0));
const asList = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);

// What a computer reports about its cannon; only known fields are kept.
export function normalizeStatus(b = {}) {
  const delivered = Object.create(null);
  for (const [k, v] of Object.entries(b.delivered && typeof b.delivered === 'object' ? b.delivered : {}).slice(0, 300)) delivered[clip(k, 120)] = int(v);
  return {
    at: now(), state: clip(b.state, 20) || 'unknown', message: clip(b.message, 300), assignment: int(b.assignment), script: clip(b.script, 20),
    chest: b.chest && typeof b.chest === 'object' ? { slots: int(b.chest.slots), used: int(b.chest.used), name: clip(b.chest.name, 60) } : null,
    delivered,
    shortages: asList(b.shortages).slice(0, 100).filter(s => s && typeof s === 'object').map(s => ({
      item: clip(s.item, 120), missing: int(s.missing), inME: int(s.inME), craftable: !!s.craftable, crafting: !!s.crafting, error: clip(s.error, 200),
    })),
  };
}

// Archiving a blueprint ends the jobs of the cannons building it (new job number → computer returns leftovers).
export function endCannonJobs(db, bpId, actor) {
  const rows = db.prepare('SELECT name, assignment FROM cannons WHERE blueprint_id = ?').all(bpId);
  for (const r of rows) {
    db.prepare('UPDATE cannons SET blueprint_id = NULL, version = NULL, start_json = NULL, assignment = ?, updated_at = ? WHERE name = ?').run(nextAssignment(r.assignment), now(), r.name);
    logActivity(db, actor, 'cannon.assign', r.name, { blueprint: null, reason: 'archived', was: bpId });
  }
  return rows.length;
}

export function registerStationRoutes(app, campus, mat, alignment, schematics) {
  const db = campus.db;
  const getRow = name => db.prepare('SELECT * FROM cannons WHERE name = ?').get(name);
  const checkName = name => {
    if (!NAME.test(name || '')) throw new HttpError(400, 'Kanonen-Name: 1–40 Zeichen, nur Buchstaben, Zahlen, _ und -.');
    return name;
  };
  // Computers register themselves on first contact; the assignment happens in the web app.
  const ensureRow = name => {
    let r = getRow(checkName(name));
    if (!r) {
      db.prepare('INSERT INTO cannons (name, assignment, created_at, updated_at) VALUES (?, ?, ?, ?)').run(name, nextAssignment(0), now(), now());
      r = getRow(name);
    }
    return r;
  };
  const seen = name => db.prepare('UPDATE cannons SET last_seen_at = ? WHERE name = ?').run(now(), name);
  const rangeFor = row => {
    const target = cannonTarget(campus, row, schematics.settingsFor(row.name));
    const range = cannonRange(alignment.binding(row.name), target?.origin);
    return { ...range, blueprint: target?.id ?? null, version: target?.version ?? null,
      candidates: target ? reachableCannons(db.prepare('SELECT * FROM cannons ORDER BY name').all(), row.name, target.origin, alignment.binding, alignment.busy) : [] };
  };

  // Progress baseline: what was missing when the job started (with the skipBlocked option in force).
  const startFor = (bpId, version, options, snap) => {
    const r = mat.remainingOf(campus.getBlueprint(bpId), campus.version(bpId, version), snap, { skipBlocked: options.skipBlocked });
    return JSON.stringify({ at: now(), snapshot: snap.id, skipBlocked: options.skipBlocked, needed: cannonItems(r.items).reduce((s, e) => s + e.needed, 0) });
  };

  const planFor = (row, snap) => {
    const schematic = schematics.sync(row, snap, alignment.binding(row.name));
    const range = rangeFor(row);
    const options = normalizeOptions(JSON.parse(row.options_json || '{}'));
    const base = {
      cannon: row.name, assignment: row.assignment, options, schematic, range, script: scriptVersion(), intervals: INTERVALS,
      snapshot: snap ? { id: snap.id, capturedAt: snap.capturedAt, worldTime: snap.worldTime } : null,
    };
    const idle = (state, message) => ({ ...base, state, message, blueprint: null, items: [], totals: { needed: 0, kinds: 0, start: 0 }, done: false });
    if (!row.blueprint_id) return idle('unassigned', 'Kein Bauplan zugewiesen. In der Web-App unter „Kanonen“ einen wählen.');
    let bp;
    try { bp = campus.getBlueprint(row.blueprint_id); } catch { return idle('missing', 'Zugewiesener Bauplan existiert nicht mehr.'); }
    if (bp.archived) return idle('missing', 'Zugewiesener Bauplan ist archiviert.');
    if (!snap) return idle('nosnapshot', 'Noch kein Live-Snapshot.');
    const v = campus.version(bp.id, schematic.settings.enabled && schematic.job?.state === 'ready' ? schematic.job.version : row.version);
    const r = mat.remainingOf(bp, v, snap, { skipBlocked: options.skipBlocked });
    const items = cannonItems(r.items);
    const needed = items.reduce((a, e) => a + e.needed, 0);
    let start = JSON.parse(row.start_json || 'null');
    if (!start) {   // assigned before the first live snapshot
      const json = startFor(bp.id, v.version, options, snap);
      db.prepare('UPDATE cannons SET start_json = ? WHERE name = ? AND assignment = ? AND start_json IS NULL').run(json, row.name, row.assignment);
      start = JSON.parse(json);
    }
    return {
      ...base, state: ['outofrange','dimension'].includes(range.state) ? 'outofrange' : options.paused ? 'paused' : schematic.settings.enabled && schematic.job?.state !== 'ready' && needed ? 'preparing' : needed ? 'feeding' : 'done', message: ['outofrange','dimension'].includes(range.state) ? range.message : null,
      blueprint: { id: bp.id, name: bp.name, version: v.version, currentVersion: bp.currentVersion, origin: v.origin, size: v.size },
      items,
      totals: { needed, kinds: items.length, start: Math.max(start.needed, needed) },
      skipped: { blocked: r.stats.skippedBlocked, changed: r.stats.skippedChanged, unknown: r.stats.unknown },
      done: needed === 0 && !['outofrange','dimension'].includes(range.state),
      restNbt: `/api/blueprints/${encodeURIComponent(bp.id)}/remaining.nbt?version=${v.version}&skipBlocked=${options.skipBlocked ? 1 : 0}`,
    };
  };

  const cannonView = async (row, snap) => {
    let plan = null;
    try { plan = planFor(row, snap); } catch (e) { plan = { state: 'error', message: e.message }; }
    const status = JSON.parse(row.status_json || 'null');
    const alignmentView = await alignment.view(row.name);
    const blocked = alignmentView.enabled && alignmentView.state !== 'aligned';
    return {
      name: row.name, assignment: row.assignment, alignment: alignmentView, createdAt: row.created_at, updatedAt: row.updated_at, lastSeenAt: row.last_seen_at,
      online: !!row.last_seen_at && Date.now() - new Date(row.last_seen_at) < ONLINE_MS,
      options: normalizeOptions(JSON.parse(row.options_json || '{}')),
      blueprint: plan.blueprint ?? null, state: plan.state === 'outofrange' ? 'outofrange' : blocked ? 'alignment' : plan.state, message: plan.state === 'outofrange' ? plan.message : blocked ? alignmentView.message : plan.message ?? null, totals: plan.totals ?? null, done: !blocked && !!plan.done,
      restNbt: plan.restNbt ?? null, items: plan.items ?? [],
      schematic: plan.schematic ?? schematics.view(row.name),
      range: plan.range ?? rangeFor(row),
      status: status && status.assignment === row.assignment ? status : status && { ...status, stale: true },
    };
  };
  const liveSnap = () => campus.latestSnapshot('live');

  // ---------- cannons ----------
  app.get('/api/cannons', async req => {
    requireActor(req, 'read');
    const snap = liveSnap();
    return Promise.all(db.prepare('SELECT * FROM cannons ORDER BY name').all().map(r => cannonView(r, snap)));
  });

  app.get('/api/cannons/:name', async req => {
    requireActor(req, 'read');
    const r = getRow(req.params.name);
    if (!r) throw new HttpError(404, 'Kanone nicht gefunden: ' + req.params.name);
    return cannonView(r, liveSnap());
  });

  app.post('/api/cannons/:name/transfer', async req => {
    const actor = alignment.admin(req), b = req.body || {};
    const source = getRow(checkName(req.params.name)), target = getRow(checkName(b.target));
    if (!source || !target) throw new HttpError(404, 'Kanone nicht gefunden.');
    if (source.name === target.name) throw new HttpError(400, 'Eine andere Kanone wählen.');
    if (![b.sourceAssignment, b.targetAssignment, b.baseVersion].every(Number.isSafeInteger)) throw new HttpError(400, 'Auftragsnummern und Bauplanversion fehlen. Bitte neu laden.');
    const fingerprint = r => JSON.stringify([r.blueprint_id, r.version, r.assignment, r.options_json, alignment.binding(r.name)]);
    const sourceBefore = fingerprint(source), targetBefore = fingerprint(target);
    const selection = () => {
      const s = getRow(source.name), t = getRow(target.name);
      if (fingerprint(s) !== sourceBefore || fingerprint(t) !== targetBefore || s.assignment !== b.sourceAssignment || t.assignment !== b.targetAssignment) throw new HttpError(409, 'Auftrag oder Blockbindung wurde geändert. Bitte neu laden.');
      const bp = cannonTarget(campus, s, schematics.settingsFor(s.name));
      if (!bp || bp.version !== b.baseVersion) throw new HttpError(409, 'Bauplanversion wurde geändert. Bitte neu laden.');
      if (t.blueprint_id) throw new HttpError(409, 'Die Zielkanone hat bereits einen Auftrag.');
      const status = JSON.parse(t.status_json || 'null');
      if (!Number.isFinite(Date.parse(t.last_seen_at)) || Date.now() - Date.parse(t.last_seen_at) >= ONLINE_MS || !['1.1.0','1.2.0','1.3.0'].includes(status?.script) || !Number.isFinite(Date.parse(status?.at)) || Date.now() - Date.parse(status.at) >= ONLINE_MS) throw new HttpError(409, 'Ziel-Computer ist offline oder sein Status ist veraltet.');
      if (!alignment.binding(s.name) || cannonRange(alignment.binding(t.name), bp.origin).state !== 'inrange') throw new HttpError(409, 'Bestätigte Kanonen in der Oberwelt und ein Ziel in Reichweite sind erforderlich.');
      return { s, t, bp };
    };
    const idle = (observed, name) => {
      const p = observed?.printer;
      if (observed?.state !== 'STOPPED' || observed.amountPlaced !== 0 || observed.amountToPlace !== 0 || observed.flyingBlocks !== 0 || !p || p.Anchor || p.CurrentPos || !Array.isArray(p.DeferredBlocks) || p.DeferredBlocks.length || p.EntityProgress !== -1 || p.PrintStage !== 'BLOCKS') {
        throw new HttpError(409, `${name} vollständig stoppen und den Bau zurücksetzen. Eine pausierte oder noch aktive Kanone kann keinen Auftrag übergeben oder übernehmen.`);
      }
    };
    await alignment.withStationsLocked([source.name, target.name], async () => {
      selection();
      const snap = liveSnap();
      if (!snap) throw new HttpError(503, 'Noch kein Live-Snapshot.');
      const [from, to] = await Promise.all([alignment.inspect(source.name), alignment.inspect(target.name)]);
      idle(from, source.name); idle(to, target.name);
      const binding = alignment.binding(target.name), components = to.components || {};
      if (to.item && !(to.item === 'create:schematic' && components['create:schematic_owner'] === binding.owner && /^campus_[0-9a-f-]{36}\.nbt$/.test(components['create:schematic_file'] || ''))) throw new HttpError(409, 'Das manuelle Schematic zuerst aus der Zielkanone nehmen.');
      const { s, t, bp } = selection();
      tx(db, () => {
        const settings = schematics.settingsFor(s.name);
        schematics.configure(t.name, { ...settings, enabled: true, autoUpdate: settings.enabled && settings.autoUpdate });
        db.prepare('UPDATE cannons SET blueprint_id=NULL,version=NULL,assignment=?,start_json=NULL,updated_at=? WHERE name=?').run(nextAssignment(s.assignment), now(), s.name);
        db.prepare('UPDATE cannons SET blueprint_id=?,version=?,assignment=?,options_json=?,start_json=NULL,updated_at=? WHERE name=?').run(bp.id, bp.version, nextAssignment(t.assignment), s.options_json, now(), t.name);
        schematics.clear(s.name);
        alignment.revoke(s.name); alignment.revoke(t.name);
        schematics.sync(getRow(t.name), snap, alignment.binding(t.name));
        logActivity(db, actor, 'cannon.transfer', s.name, { target: t.name, blueprint: bp.id, version: bp.version, origin: bp.origin });
      });
    });
    try { await alignment.prepare(target.name, actor); } catch { /* Assignment is queued; a stopped target is retried by the scheduler. */ }
    return { source: await cannonView(getRow(source.name), liveSnap()), target: await cannonView(getRow(target.name), liveSnap()) };
  });

  // Assign a blueprint (pinned to a version) and/or change options. A new blueprint or version starts a new assignment,
  // which tells the computer to return leftovers and reset its counters.
  app.put('/api/cannons/:name', async req => {
    const a = requireActor(req, 'write');
    const name = checkName(req.params.name), b = req.body || {};
    const row = getRow(name) || ensureRow(name);
    if (alignment.enabled(name)) alignment.admin(req);
    if (b.schematic !== undefined) {
      alignment.admin(req);
      if (b.schematic.enabled && !alignment.enabled(name)) throw new HttpError(400, 'Zuerst unter Ausrichtung den Kanonen-Block bestätigen.');
    }
    if (alignment.busy(name)) throw new HttpError(409, 'Apply läuft. Auftrag bleibt unverändert; danach erneut wählen.');
    const options = normalizeOptions(b.options, JSON.parse(row.options_json || '{}'));
    let { blueprint_id: bpId, version, assignment, start_json: start } = row;
    const prevSkip = normalizeOptions(JSON.parse(row.options_json || '{}')).skipBlocked;
    if (b.blueprint !== undefined) {
      const nextId = b.blueprint || null;
      let nextVersion = null;
      if (nextId) {
        const bp = campus.getBlueprint(nextId);
        if (bp.archived) throw new HttpError(400, 'Bauplan ist archiviert.');
        nextVersion = b.version ? campus.version(bp.id, Number(b.version)).version : bp.currentVersion;
      }
      if (nextId !== bpId || nextVersion !== version) {
        bpId = nextId; version = nextVersion; assignment = nextAssignment(assignment); start = null;
        logActivity(db, a, 'cannon.assign', name, { blueprint: bpId, version });
      }
    }
    if (options.skipBlocked !== prevSkip) start = null;
    const snap = liveSnap();
    if (bpId && !start && snap) start = startFor(bpId, version, options, snap);
    tx(db, () => {
      if (b.schematic !== undefined) schematics.configure(row.name, b.schematic);
      db.prepare('UPDATE cannons SET blueprint_id = ?, version = ?, assignment = ?, options_json = ?, start_json = ?, updated_at = ? WHERE name = ?')
        .run(bpId, version, assignment, JSON.stringify(options), start, now(), name);
      schematics.sync(getRow(name), snap, alignment.binding(name));
    });
    if (alignment.enabled(name) && (assignment !== row.assignment || b.schematic !== undefined) && bpId) {
      try { await alignment.apply(name, a); } catch { /* Queued: UI shows exact live refusal; never reset a printer. */ }
    }
    return cannonView(getRow(name), snap);
  });

  app.delete('/api/cannons/:name', async req => {
    const a = requireActor(req, 'write');
    if (alignment.enabled(req.params.name)) throw new HttpError(409, 'Gebundene Station kann nicht gelöscht werden; Materialschutz bleibt aktiv.');
    const r = db.prepare('DELETE FROM cannons WHERE name = ?').run(req.params.name);
    if (!r.changes) throw new HttpError(404, 'Kanone nicht gefunden.');
    logActivity(db, a, 'cannon.delete', req.params.name);
    return { ok: true };
  });

  // Polled by the computer.
  app.get('/api/cannons/:name/plan', async req => {
    requireActor(req, 'station');
    const row = ensureRow(req.params.name);
    seen(row.name);
    return alignment.gate(row.name, planFor(row, liveSnap()));
  });

  app.post('/api/cannons/:name/status', async req => {
    requireActor(req, 'station');
    const row = ensureRow(req.params.name);
    const status = normalizeStatus(req.body || {});
    db.prepare('UPDATE cannons SET status_json = ?, last_seen_at = ? WHERE name = ?').run(JSON.stringify(status), status.at, row.name);
    return { ok: true, assignment: row.assignment };
  });

  // ---------- ME stock ----------
  // Item ids the campus still needs (plus gunpowder for the cannons): computers only report these.
  let wantedCache = null;
  app.get('/api/me/wanted', async req => {
    requireActor(req, 'read');
    const snap = mat.snapshotOf(req.query);
    const bps = mat.selection({});
    const key = snap.id + ':' + bps.map(b => b.current?.id).join(',');
    if (wantedCache?.key !== key) {
      const merged = mat.aggregate(bps, snap);
      const items = [...merged.items].filter(([, e]) => e.needed > 0).map(([item]) => item);
      if (!items.includes('minecraft:gunpowder')) items.push('minecraft:gunpowder');
      wantedCache = { key, items: items.sort() };
    }
    return { snapshot: snap.id, items: wantedCache.items };
  });

  app.post('/api/me/stock', async req => {
    const a = requireActor(req, 'station');
    const b = req.body || {};
    const source = clip(b.source || a.tokenName || a.user.username, 60);
    const items = normalizeStockItems(b.items);
    const s = saveStock(db, a, source, items);
    return { ok: true, at: s.at, kinds: s.kinds, total: s.total };
  });

  app.get('/api/me/stock', async req => {
    requireActor(req, 'read');
    const s = latestStock(db);
    if (!s) return { stock: null };
    const { items, id, ...info } = s;
    return { stock: { ...info, ageMin: Math.round((Date.now() - new Date(s.at)) / 6e4), ...(mat.flag(req.query.items, false) ? { items } : {}) } };
  });

  // ---------- scripts for the computers (no secrets inside, the token is entered on the computer) ----------
  const lua = (reply, body) => reply.type('text/plain; charset=utf-8').header('Cache-Control', 'no-cache').send(body);
  app.get('/cc/campus.lua', async (req, reply) => lua(reply, readFileSync(join(ccDir, 'campus.lua'), 'utf8')));
  app.get('/cc/install.lua', async (req, reply) => lua(reply, readFileSync(join(ccDir, 'install.lua'), 'utf8').replaceAll('{{URL}}', campus.config.publicUrl)));
}
