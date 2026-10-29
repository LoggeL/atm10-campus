// Data for the generic viewer: one scene JSON and one binary with all blueprint cells + per-cell status.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { cellStatuses, overlapCellKeys } from './analysis.js';
import { blockStyle, MATERIALS } from './blockstyle.js';
import { loadViewerExtras } from './importer.js';

export function sceneJson(campus, snapshotId) {
  const status = campus.status();
  const snap = snapshotId ? campus.getSnapshot(snapshotId) : null;
  let context = null;
  if (snap && existsSync(join(campus.snapshotDir(snap.id), 'context.json'))) {
    const c = JSON.parse(readFileSync(join(campus.snapshotDir(snap.id), 'context.json'), 'utf8'));
    context = { origin: c.origin, size: c.size, palette: c.palette, recordCount: c.recordCount, url: `/api/snapshots/${snap.id}/surfaces.bin.gz` };
  }
  const names = new Set(context?.palette || []);
  const blueprints = campus.listBlueprints().filter(b => b.current).map(b => {
    const s = status.blueprints.find(x => x.id === b.id);
    for (const n of Object.keys(b.current.stats.materials || {})) names.add(n);
    return {
      id: b.id, name: b.name, fileName: b.fileName, category: b.category || 'Ohne Kategorie', description: b.description,
      version: b.currentVersion, origin: b.current.origin, size: b.current.size, uploadedBy: b.current.uploadedBy, updatedAt: b.updatedAt,
      status: s?.status ?? 'unknown', progress: s?.progress ?? null, counts: s?.counts ?? null, conflicts: s?.conflicts ?? null,
    };
  });
  const styles = {};
  for (const n of names) styles[n] = blockStyle(n);
  const extras = loadViewerExtras(campus.config.dataDir);
  const pois = (extras?.walkDestinations?.destinations || []).filter(d => Array.isArray(d.position)).map(d => ({
    id: String(d.id), label: d.label || String(d.id), position: d.position, direction: d.direction || [0, 0, -1],
  }));
  return {
    generatedAt: new Date().toISOString(),
    snapshot: snap && { id: snap.id, label: snap.label, source: snap.source, capturedAt: snap.capturedAt, worldTime: snap.worldTime },
    snapshots: campus.listSnapshots(40).map(s => ({ id: s.id, label: s.label, source: s.source, capturedAt: s.capturedAt, worldTime: s.worldTime, pinned: s.pinned })),
    live: campus.latestSnapshot('live')?.id ?? null,
    context, blueprints, styles, materials: MATERIALS, pois,
    overlaps: status.overlaps.map(o => ({ blueprints: o.blueprints, cells: o.cells })),
    blueprintsUrl: `/api/viewer/blueprints.bin?snapshot=${snap?.id ?? 'none'}`,
  };
}

// Layout: u32 header length, header JSON, padding to 4, then per blueprint:
// Uint16 positions (placed+clear)*3 (local), Uint16 palette index per placed cell, Uint8 status per cell.
export function blueprintsBinary(campus, snapshotId) {
  const key = campus.status().edition.versionsKey + ':' + snapshotId;
  if (campus.binCache?.key === key) return campus.binCache.value;
  const bps = campus.listBlueprints().filter(b => b.current);
  const entries = bps.map(b => ({ id: b.id, origin: b.current.origin, structure: campus.structureFor(b.id, b.current), base: b.current.baseSnapshotId }));
  const overlaps = overlapCellKeys(entries);
  const live = snapshotId ? campus.grid(snapshotId) : null;
  const palette = [], palIndex = new Map();
  const parts = [], index = [];
  let offset = 0;
  const push = arr => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (b.length % 4)) % 4;
    parts.push(b); if (pad) parts.push(Buffer.alloc(pad));
    const at = offset; offset += b.length + pad; return at;
  };
  for (const e of entries) {
    const { placed, clear } = e.structure;
    const P = placed.length, C = clear.length / 3;
    const pos = new Uint16Array((P + C) * 3), pal = new Uint16Array(P);
    placed.forEach((b, i) => {
      pos[i * 3] = b.x; pos[i * 3 + 1] = b.y; pos[i * 3 + 2] = b.z;
      let p = palIndex.get(b.name);
      if (p === undefined) { p = palette.length; palette.push(b.name); palIndex.set(b.name, p); }
      pal[i] = p;
    });
    pos.set(clear, P * 3);
    let base = null;
    if (e.base && e.base !== snapshotId) { try { base = campus.grid(e.base); } catch { base = null; } }
    const st = cellStatuses(e.structure, e.origin, live, base, overlaps);
    index.push({ id: e.id, placed: P, clear: C, pos: push(pos), pal: push(pal), status: push(st) });
  }
  const header = Buffer.from(JSON.stringify({ palette, blueprints: index }));
  const hlen = Buffer.alloc(4); hlen.writeUInt32LE(header.length);
  const headPad = (4 - ((4 + header.length) % 4)) % 4;
  const body = Buffer.concat([hlen, header, Buffer.alloc(headPad), ...parts]);
  const value = { body, gzip: gzipSync(body, { level: 6 }), etag: '"' + createHash('sha1').update(body).digest('hex') + '"' };
  campus.binCache = { key, value };
  return value;
}
