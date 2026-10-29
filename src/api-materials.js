// Material lists and "remaining" NBTs (only what is still missing) for one or many blueprints.
import { loadModel, serializeModel } from './structure-edit.js';
import { blueprintMaterials, mergeMaterials, materialsReport, materialsText, materialsCsv, remainingModel, remainingItems, withStock } from './materials.js';
import { latestStock } from './me-stock.js';
import { requireActor, HttpError } from './auth.js';
import { zipStore } from './zip.js';
import { now } from './db.js';

const flag = (v, dflt) => (v === undefined || v === '' ? dflt : !/^(0|false|no|nein)$/i.test(String(v)));

// Returns helpers the cannon/ME routes reuse (same caches).
export function registerMaterialRoutes(app, campus) {
  campus.materialsCache ??= new Map();
  campus.remainingCache ??= new Map();
  const remember = (map, key, max, fn) => {
    let v = map.get(key);
    if (!v) { v = fn(); map.set(key, v); while (map.size > max) map.delete(map.keys().next().value); }
    return v;
  };

  const snapshotOf = q => {
    const snap = q.snapshot ? campus.getSnapshot(Number(q.snapshot)) : campus.latestSnapshot('live');
    if (!snap) throw new HttpError(503, 'Noch kein Live-Snapshot vorhanden.');
    return snap;
  };
  const baseGrid = (v, snapId) => {
    if (!v.baseSnapshotId || v.baseSnapshotId === snapId) return null;
    try { return campus.grid(v.baseSnapshotId); } catch { return null; }
  };
  const model = (bp, v) => loadModel(campus.readVersionBytes(bp.id, v.version));

  // ids=a,b · category=x · default: all current blueprints.
  const selection = q => {
    const all = campus.listBlueprints().filter(b => b.current);
    if (q.ids) {
      const ids = String(q.ids).split(',').map(s => s.trim()).filter(Boolean);
      return ids.map(id => { const b = all.find(x => x.id === id); if (!b) campus.getBlueprint(id); return b; }).filter(Boolean);
    }
    if (q.category) return all.filter(b => b.category === q.category);
    return all;
  };

  // Base grids first by id, so the small grid LRU loads each planning snapshot only once per request.
  const byBase = bps => [...bps].sort((a, b) => (a.current.baseSnapshotId ?? 0) - (b.current.baseSnapshotId ?? 0));

  const materialsOf = (bp, v, snap, skip = null) => {
    const run = () => blueprintMaterials(model(bp, v), v.origin, campus.grid(snap.id), baseGrid(v, snap.id), skip);
    return skip ? run() : remember(campus.materialsCache, `${v.id}:${snap.id}`, 300, run);
  };

  // World cells planned by several selected blueprints (shared walls) are counted once, for the first one.
  const sharedCells = bps => {
    const owner = new Map(), skips = new Map();
    for (const b of bps) {
      const st = campus.structureFor(b.id, b.current), [ox, oy, oz] = b.current.origin;
      const visit = (x, y, z) => {
        const k = (ox + x) + ',' + (oy + y) + ',' + (oz + z), o = owner.get(k);
        if (o === undefined) owner.set(k, b.id);
        else if (o !== b.id) { if (!skips.has(b.id)) skips.set(b.id, new Set()); skips.get(b.id).add(k); }
      };
      for (const c of st.placed) visit(c.x, c.y, c.z);
      for (let i = 0; i < st.clear.length; i += 3) visit(st.clear[i], st.clear[i + 1], st.clear[i + 2]);
    }
    return skips;
  };

  const aggregate = (bps, snap) => {
    const skips = bps.length > 1 ? sharedCells(bps) : new Map();
    const order = new Map(bps.map((b, i) => [b.id, i]));
    const results = byBase(bps).map(b => ({ id: b.id, result: materialsOf(b, b.current, snap, skips.get(b.id)) }))
      .sort((a, b) => order.get(a.id) - order.get(b.id));
    return mergeMaterials(results);
  };
  const stockFor = q => (flag(q.me, true) ? latestStock(campus.db) : null);

  const send = (reply, q, report, title, fileBase) => {
    if (q.format === 'text') return reply.type('text/plain; charset=utf-8').send(materialsText(report, title));
    if (q.format === 'csv') {
      return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${fileBase}-material.csv"`).send(materialsCsv(report));
    }
    return report;
  };

  app.get('/api/blueprints/:id/materials', async (req, reply) => {
    requireActor(req, 'read');
    const bp = campus.getBlueprint(req.params.id);
    const v = req.query.version ? campus.version(bp.id, Number(req.query.version)) : campus.currentVersion(bp.id);
    const snap = snapshotOf(req.query);
    const report = withStock(materialsReport(mergeMaterials([{ id: bp.id, result: materialsOf(bp, v, snap) }]), { includeBuilt: flag(req.query.all, false) }), stockFor(req.query));
    for (const r of report.items) delete r.by;
    const out = { blueprint: bp.id, name: bp.name, version: v.version, snapshot: { id: snap.id, label: snap.label, worldTime: snap.worldTime }, ...report };
    return send(reply, req.query, out, `${bp.name} (${bp.id} v${v.version}) · Snapshot #${snap.id}`, bp.id);
  });

  app.get('/api/materials', async (req, reply) => {
    requireActor(req, 'read');
    const snap = snapshotOf(req.query);
    const bps = selection(req.query);
    const report = withStock(materialsReport(aggregate(bps, snap), { includeBuilt: flag(req.query.all, false) }), stockFor(req.query));
    const out = { blueprints: bps.map(b => b.id), snapshot: { id: snap.id, label: snap.label, worldTime: snap.worldTime }, ...report };
    const title = bps.length === 1 ? bps[0].name : `${bps.length} Baupläne`;
    return send(reply, req.query, out, `${title} · Snapshot #${snap.id}`, bps.length === 1 ? bps[0].id : 'campus');
  });

  const remainingOpts = q => ({ clear: flag(q.clear, false), skipBlocked: flag(q.skipBlocked, true), skipChanged: flag(q.skipChanged, false) });
  const remainingOf = (bp, v, snap, q) => {
    const opts = remainingOpts(q);
    return remember(campus.remainingCache, `${v.id}:${snap.id}:${+opts.clear}${+opts.skipBlocked}${+opts.skipChanged}`, 200, () => {
      const r = remainingModel(model(bp, v), v.origin, campus.grid(snap.id), baseGrid(v, snap.id), opts);
      return { bytes: serializeModel(r.model), stats: r.stats, items: remainingItems(r.model) };
    });
  };

  app.get('/api/blueprints/:id/remaining.nbt', async (req, reply) => {
    requireActor(req, 'read');
    const bp = campus.getBlueprint(req.params.id);
    const v = req.query.version ? campus.version(bp.id, Number(req.query.version)) : campus.currentVersion(bp.id);
    const snap = snapshotOf(req.query);
    const { bytes, stats } = remainingOf(bp, v, snap, req.query);
    return reply.type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${bp.id}_rest.nbt"`)
      .header('X-Campus-Origin', v.origin.join(','))
      .header('X-Campus-Remaining', JSON.stringify({ ...stats, snapshot: snap.id, version: v.version }))
      .send(bytes);
  });

  app.get('/api/remaining.zip', async (req, reply) => {
    requireActor(req, 'read');
    const snap = snapshotOf(req.query);
    const entries = [], modules = [];
    for (const b of byBase(selection(req.query))) {
      const { bytes, stats } = remainingOf(b, b.current, snap, req.query);
      const left = stats.skippedBlocked + stats.skippedChanged + stats.skippedClear;
      if (!stats.kept) { modules.push({ blueprint: b.id, file: null, done: left === 0, ...(left ? { onlySkippedLeft: left } : {}), stats }); continue; }
      entries.push({ name: `${b.id}_rest.nbt`, data: bytes });
      modules.push({ blueprint: b.id, file: `${b.id}_rest.nbt`, name: b.name, version: b.currentVersion, origin: b.current.origin, size: b.current.size, stats });
    }
    entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify({
      exportedAt: now(), snapshot: { id: snap.id, label: snap.label, worldTime: snap.worldTime }, options: remainingOpts(req.query),
      hint: 'Jede *_rest.nbt hat dieselbe Größe und denselben origin wie der volle Bauplan und enthält nur Blöcke, die noch fehlen (keine Entities). Schematicannon im normalen Modus nutzen: dann bleibt alles andere stehen. Nicht „Replace Solid with Empty“ – der Modus räumt alle nicht enthaltenen Zellen leer. Abriss (clear=1) ist für den Vanilla-Strukturblock gedacht.',
      modules }, null, 2)) });
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="campus-rest-${now().slice(0, 10)}.zip"`).send(zipStore(entries));
  });

  return { snapshotOf, selection, aggregate, remainingOf, flag };
}
