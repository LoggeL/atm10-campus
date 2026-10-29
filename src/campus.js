// Domain service: blueprints with versions, world snapshots, analyses and the overview status.
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { parseStructure } from './nbt.js';
import { loadGrid, worldStamp } from './snapshot.js';
import { analyzeBlueprint, findOverlaps, statusOf } from './analysis.js';
import { now, tx, logActivity } from './db.js';
import { HttpError } from './auth.js';

const sha = b => createHash('sha256').update(b).digest('hex');
export const blueprintIdFromFile = f => String(f).replace(/\.nbt$/i, '').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 120);

export function parseOrigin(v) {
  const o = Array.isArray(v) ? v.map(Number) : String(v ?? '').split(',').map(s => Number(s.trim()));
  if (o.length !== 3 || !o.every(Number.isInteger) || o.some(n => Math.abs(n) > 30_000_000)) throw new HttpError(400, 'origin muss drei ganze Zahlen x,y,z sein.');
  return o;
}

const META_FIELDS_OWNED = new Set(['file', 'name', 'origin', 'size', 'placed_blocks', 'gzip_bytes', 'sha256', 'category', 'description']);

export class Campus {
  constructor(db, config) {
    this.db = db; this.config = config;
    this.structures = new Map(); // version id -> parsed structure
    this.grids = new Map();      // snapshot id -> grid (small LRU)
    this.statusCache = null;
    this.capturing = null;
    mkdirSync(join(config.dataDir, 'blueprints'), { recursive: true });
    mkdirSync(join(config.dataDir, 'snapshots'), { recursive: true });
    mkdirSync(join(config.dataDir, 'package'), { recursive: true });
  }

  invalidate() { this.statusCache = null; this.viewerCache = null; this.binCache = null; this.knownNamesCache = null; }

  // ---------- blueprints ----------
  versionPath(bpId, version) { return join(this.config.dataDir, 'blueprints', bpId, `v${version}.nbt`); }

  rowToBlueprint(r) {
    return {
      id: r.id, fileName: r.file_name, name: r.name, category: r.category, description: r.description,
      currentVersion: r.current_version, archived: !!r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
      meta: JSON.parse(r.meta_json || '{}'),
    };
  }

  rowToVersion(v) {
    return {
      id: v.id, version: v.version, sha256: v.sha256, bytes: v.bytes, origin: JSON.parse(v.origin_json), size: JSON.parse(v.size_json),
      stats: JSON.parse(v.stats_json), note: v.note, baseSnapshotId: v.base_snapshot_id, uploadedBy: v.username ?? null,
      uploadedVia: v.uploaded_via, createdAt: v.created_at,
    };
  }

  listBlueprints({ includeArchived = false } = {}) {
    const rows = this.db.prepare(`SELECT * FROM blueprints ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY file_name`).all();
    return rows.map(r => ({ ...this.rowToBlueprint(r), current: this.currentVersion(r.id) }));
  }

  getBlueprint(id) {
    const r = this.db.prepare('SELECT * FROM blueprints WHERE id = ?').get(id);
    if (!r) throw new HttpError(404, 'Bauplan nicht gefunden: ' + id);
    return this.rowToBlueprint(r);
  }

  versions(bpId) {
    return this.db.prepare(`SELECT v.*, u.username FROM blueprint_versions v LEFT JOIN users u ON u.id = v.uploaded_by
      WHERE v.blueprint_id = ? ORDER BY v.version DESC`).all(bpId).map(v => this.rowToVersion(v));
  }

  version(bpId, version) {
    const v = this.db.prepare(`SELECT v.*, u.username FROM blueprint_versions v LEFT JOIN users u ON u.id = v.uploaded_by
      WHERE v.blueprint_id = ? AND v.version = ?`).get(bpId, version);
    if (!v) throw new HttpError(404, `Version ${version} von ${bpId} nicht gefunden.`);
    return this.rowToVersion(v);
  }

  currentVersion(bpId) {
    const v = this.db.prepare(`SELECT v.*, u.username FROM blueprints b JOIN blueprint_versions v ON v.blueprint_id = b.id AND v.version = b.current_version
      LEFT JOIN users u ON u.id = v.uploaded_by WHERE b.id = ?`).get(bpId);
    return v ? this.rowToVersion(v) : null;
  }

  readVersionBytes(bpId, version) { return readFileSync(this.versionPath(bpId, version)); }

  structureFor(bpId, v) {
    let s = this.structures.get(v.id);
    if (!s) { s = parseStructure(this.readVersionBytes(bpId, v.version)); this.structures.set(v.id, s); }
    return s;
  }

  // Creates the blueprint if needed and stores a new version.
  // baseVersion enables optimistic locking: if someone else uploaded in between, 409 with both versions.
  saveVersion({ fileName, bytes, origin, name, category, description, meta, note, baseVersion, baseSnapshotId, actor, via }) {
    if (!fileName || !/\.nbt$/i.test(fileName)) throw new HttpError(400, 'fileName muss auf .nbt enden.');
    const id = blueprintIdFromFile(fileName);
    let structure;
    try { structure = parseStructure(bytes); } catch (e) { throw new HttpError(422, 'NBT ungültig: ' + e.message); }
    const hash = sha(bytes);
    const existing = this.db.prepare('SELECT * FROM blueprints WHERE id = ?').get(id);
    const current = existing ? this.currentVersion(id) : null;
    if (baseVersion !== undefined && baseVersion !== null && baseVersion !== '' && current && Number(baseVersion) !== current.version) {
      throw new HttpError(409, `Bearbeitungskonflikt: ${id} ist inzwischen bei Version ${current.version} (du hast auf ${baseVersion} aufgebaut).`,
        { blueprint: id, currentVersion: current.version, baseVersion: Number(baseVersion), currentUploadedBy: current.uploadedBy, currentCreatedAt: current.createdAt });
    }
    const finalOrigin = origin ? parseOrigin(origin) : current?.origin;
    if (!finalOrigin) throw new HttpError(400, 'Für einen neuen Bauplan ist origin (x,y,z) Pflicht.');
    if (current && current.sha256 === hash && current.origin.join() === finalOrigin.join() && !existing.archived_at) {
      if (name || category || description || meta) this.updateMeta(id, { name, category, description, meta }, actor, false);
      return { blueprint: this.getBlueprint(id), version: current, unchanged: true };
    }
    const stats = { placed: structure.placed.length, clear: structure.clear.length / 3, blockEntities: structure.blockEntities, entities: structure.entities, dataVersion: structure.dataVersion, materials: structure.materials };
    const baseSnap = baseSnapshotId ?? this.latestSnapshot('live')?.id ?? null;
    const result = tx(this.db, () => {
      const t = now();
      if (!existing) {
        this.db.prepare('INSERT INTO blueprints (id, file_name, name, category, description, meta_json, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
          .run(id, fileName, name || id, category ?? null, description ?? null, JSON.stringify(meta || {}), t, t);
      } else if (name || category !== undefined || description !== undefined || meta) {
        this.db.prepare('UPDATE blueprints SET name = COALESCE(?, name), category = COALESCE(?, category), description = COALESCE(?, description), meta_json = COALESCE(?, meta_json) WHERE id = ?')
          .run(name ?? null, category ?? null, description ?? null, meta ? JSON.stringify(meta) : null, id);
      }
      const version = (current?.version ?? 0) + 1;
      mkdirSync(join(this.config.dataDir, 'blueprints', id), { recursive: true });
      writeFileSync(this.versionPath(id, version), bytes);
      this.db.prepare(`INSERT INTO blueprint_versions (blueprint_id, version, sha256, bytes, origin_json, size_json, stats_json, note, base_snapshot_id, uploaded_by, uploaded_via, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, version, hash, bytes.length, JSON.stringify(finalOrigin), JSON.stringify(structure.size), JSON.stringify(stats), note ?? null, baseSnap, actor?.user?.id ?? null, via, t);
      this.db.prepare('UPDATE blueprints SET current_version = ?, updated_at = ?, archived_at = NULL WHERE id = ?').run(version, t, id);
      return version;
    });
    logActivity(this.db, actor, existing ? 'blueprint.version' : 'blueprint.create', id, { version: result, note, via });
    this.invalidate();
    return { blueprint: this.getBlueprint(id), version: this.version(id, result), unchanged: false };
  }

  updateMeta(id, { name, category, description, meta }, actor, log = true) {
    const bp = this.getBlueprint(id);
    const merged = meta ? { ...bp.meta, ...meta } : null;
    this.db.prepare('UPDATE blueprints SET name = COALESCE(?, name), category = COALESCE(?, category), description = COALESCE(?, description), meta_json = COALESCE(?, meta_json), updated_at = ? WHERE id = ?')
      .run(name ?? null, category ?? null, description ?? null, merged ? JSON.stringify(merged) : null, now(), id);
    if (log) logActivity(this.db, actor, 'blueprint.meta', id, { name, category, description });
    this.invalidate();
    return this.getBlueprint(id);
  }

  archive(id, actor) {
    this.getBlueprint(id);
    this.db.prepare('UPDATE blueprints SET archived_at = ?, updated_at = ? WHERE id = ?').run(now(), now(), id);
    logActivity(this.db, actor, 'blueprint.archive', id);
    this.invalidate();
  }

  revert(id, toVersion, actor, via) {
    const bp = this.getBlueprint(id), v = this.version(id, toVersion);
    return this.saveVersion({ fileName: bp.fileName, bytes: this.readVersionBytes(id, v.version), origin: v.origin, note: `Zurückgesetzt auf Version ${v.version}`, baseVersion: bp.currentVersion, baseSnapshotId: v.baseSnapshotId, actor, via });
  }

  // ---------- snapshots ----------
  rowToSnapshot(r) {
    return r && { id: r.id, source: r.source, label: r.label, capturedAt: r.captured_at, worldStamp: r.world_stamp, pinned: !!r.pinned, ...JSON.parse(r.summary_json) };
  }
  latestSnapshot(source = 'live') {
    return this.rowToSnapshot(this.db.prepare('SELECT * FROM snapshots WHERE source = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(source));
  }
  getSnapshot(id) {
    const r = this.db.prepare('SELECT * FROM snapshots WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!r) throw new HttpError(404, 'Snapshot nicht gefunden: ' + id);
    return this.rowToSnapshot(r);
  }
  listSnapshots(limit = 100) {
    return this.db.prepare('SELECT * FROM snapshots WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ?').all(limit).map(r => this.rowToSnapshot(r));
  }
  snapshotDir(id) { return join(this.config.dataDir, 'snapshots', String(id)); }

  grid(id) {
    if (this.grids.has(id)) { const g = this.grids.get(id); this.grids.delete(id); this.grids.set(id, g); return g; }
    const g = loadGrid(this.snapshotDir(id));
    this.grids.set(id, g);
    while (this.grids.size > 3) this.grids.delete(this.grids.keys().next().value);
    return g;
  }

  // Captures in a worker thread so HTTP stays responsive. force=false skips when region files are unchanged.
  async capture({ source = 'live', label, force = false, pinned = false, actor } = {}) {
    const worldDir = this.config.worldSources[source];
    if (!worldDir) throw new HttpError(400, `Unbekannte Weltquelle "${source}". Verfügbar: ${Object.keys(this.config.worldSources).join(', ')}`);
    if (!existsSync(join(worldDir, 'region'))) throw new HttpError(503, `Welt nicht gefunden unter ${worldDir}.`);
    if (this.capturing) return this.capturing;
    const { contextOrigin: origin, contextSize: size } = this.config;
    const stamp = worldStamp(worldDir, origin, size);
    const last = this.latestSnapshot(source);
    if (!force && last && last.worldStamp === stamp) return { skipped: true, snapshot: last };
    this.capturing = (async () => {
      const t = now();
      const id = Number(this.db.prepare(`INSERT INTO snapshots (source, label, captured_at, world_stamp, dir, summary_json, pinned, deleted_at)
        VALUES (?, ?, ?, ?, '', '{}', ?, ?)`).run(source, label || (source === 'live' ? 'Live' : source), t, stamp, pinned ? 1 : 0, t).lastInsertRowid);
      const dir = this.snapshotDir(id);
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const context = await runSnapshotWorker({ worldDir, origin, size, dir, info: { source, label: label || (source === 'live' ? 'Live' : source), capturedAt: t } });
          const summary = { recordCount: context.recordCount, blockEntityCount: context.blockEntityCount, chunksLoaded: context.chunksLoaded, chunksMissing: context.chunksMissing, durationMs: context.durationMs, worldTime: new Date(stamp).toISOString() };
          this.db.prepare('UPDATE snapshots SET dir = ?, summary_json = ?, deleted_at = NULL WHERE id = ?').run(dir, JSON.stringify(summary), id);
          logActivity(this.db, actor, 'snapshot.capture', String(id), { source, attempt, ...summary });
          this.invalidate();
          this.prune();
          return { skipped: false, snapshot: this.getSnapshot(id) };
        } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 2000 * attempt)); }
      }
      rmSync(dir, { recursive: true, force: true });
      throw new HttpError(500, 'Snapshot fehlgeschlagen: ' + lastErr?.message);
    })();
    try { return await this.capturing; } finally { this.capturing = null; }
  }

  // Keep pinned, base snapshots of current versions, the newest N and one per day.
  prune() {
    const keep = new Set(this.db.prepare('SELECT DISTINCT base_snapshot_id AS id FROM blueprint_versions WHERE base_snapshot_id IS NOT NULL').all().map(r => r.id));
    const rows = this.db.prepare("SELECT * FROM snapshots WHERE deleted_at IS NULL AND source = 'live' ORDER BY id DESC").all();
    const days = new Set();
    rows.forEach((r, i) => {
      const day = r.captured_at.slice(0, 10);
      if (r.pinned || keep.has(r.id) || i < this.config.snapshotKeepRecent) { days.add(day); return; }
      if (!days.has(day)) { days.add(day); return; }
      rmSync(this.snapshotDir(r.id), { recursive: true, force: true });
      this.db.prepare('UPDATE snapshots SET deleted_at = ? WHERE id = ?').run(now(), r.id);
      this.db.prepare('DELETE FROM analyses WHERE snapshot_id = ?').run(r.id);
    });
  }

  // ---------- analysis ----------
  analysis(bpId, v, snapshotId) {
    const cached = this.db.prepare('SELECT result_json FROM analyses WHERE version_id = ? AND snapshot_id = ?').get(v.id, snapshotId);
    if (cached) return JSON.parse(cached.result_json);
    const structure = this.structureFor(bpId, v);
    const live = this.grid(snapshotId);
    let base = null;
    if (v.baseSnapshotId && v.baseSnapshotId !== snapshotId) {
      try { base = this.grid(v.baseSnapshotId); } catch { base = null; }
    }
    const result = { snapshotId, baseSnapshotId: base ? v.baseSnapshotId : null, version: v.version, ...analyzeBlueprint(structure, v.origin, live, base) };
    this.db.prepare('INSERT OR REPLACE INTO analyses (version_id, snapshot_id, result_json, created_at) VALUES (?, ?, ?, ?)').run(v.id, snapshotId, JSON.stringify(result), now());
    return result;
  }

  overlaps() {
    const entries = this.listBlueprints().filter(b => b.current).map(b => ({ id: b.id, origin: b.current.origin, structure: this.structureFor(b.id, b.current) }));
    return findOverlaps(entries);
  }

  // Overview for humans and agents: what's live, what's in the edition, where it conflicts.
  status() {
    const live = this.latestSnapshot('live');
    const key = (live?.id ?? 0) + ':' + (this.db.prepare('SELECT COALESCE(MAX(id),0) AS m FROM blueprint_versions').get().m) + ':' + this.db.prepare("SELECT COALESCE(MAX(updated_at),'') AS m FROM blueprints").get().m;
    if (this.statusCache?.key === key) return this.statusCache.value;
    const overlaps = this.overlaps();
    const overlapCells = new Map();
    for (const o of overlaps) for (const id of o.blueprints) overlapCells.set(id, (overlapCells.get(id) || 0) + o.cells);
    const blueprints = this.listBlueprints().map(b => {
      const a = live && b.current ? this.analysis(b.id, b.current, live.id) : null;
      const oc = overlapCells.get(b.id) || 0;
      return {
        id: b.id, fileName: b.fileName, name: b.name, category: b.category, version: b.currentVersion, origin: b.current?.origin, size: b.current?.size,
        updatedAt: b.updatedAt, uploadedBy: b.current?.uploadedBy, status: statusOf(a, oc), overlapCells: oc,
        progress: a ? Math.round(a.progress * 1000) / 10 : null,
        counts: a && { placed: a.placed, clear: a.clear, built: a.built, cleared: a.cleared, toPlace: a.toPlace, toReplace: a.toReplace, toClear: a.toClear, outsideSnapshot: a.outsideSnapshot },
        conflicts: a && { ...a.conflicts, overlapCells: oc }, baseSnapshotId: a?.baseSnapshotId ?? null,
      };
    });
    const totals = { blueprints: blueprints.length, conflict: 0, warning: 0, ok: 0, built: 0, unknown: 0 };
    for (const b of blueprints) totals[b.status]++;
    const value = {
      generatedAt: now(), live, edition: { versionsKey: key, totals }, blueprints,
      overlaps: overlaps.map(o => ({ blueprints: o.blueprints, cells: o.cells, samples: o.samples.slice(0, 20) })),
    };
    this.statusCache = { key, value };
    return value;
  }
}

function runSnapshotWorker(data) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./snapshot-worker.js', import.meta.url), { workerData: data, resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    w.once('message', m => m.ok ? resolve(m.context) : reject(new Error(m.error)));
    w.once('error', reject);
    w.once('exit', code => { if (code !== 0) reject(new Error('Snapshot-Worker beendet mit Code ' + code)); });
  });
}
