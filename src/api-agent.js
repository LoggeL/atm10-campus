// Fine-grained blueprint editing and readable views for agents (and the web UI).
import { loadModel, serializeModel, emptyModel, applyEdits, layersText } from './structure-edit.js';
import { parseStructure } from './nbt.js';
import { analyzeBlueprint } from './analysis.js';
import { requireActor, HttpError } from './auth.js';
import { parseOrigin } from './campus.js';

const MAX_VIEW_CELLS = 2_000_000;

function parseRange(s, label) {
  if (s === undefined || s === '') return null;
  const m = /^(-?\d+)(?:(?:\.\.|-|:)(-?\d+))?$/.exec(String(s));
  if (!m) throw new HttpError(400, `${label} als Zahl oder Bereich "a..b" angeben.`);
  const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
  return [Math.min(a, b), Math.max(a, b)];
}
const triple = (s, label) => {
  if (s === undefined) return null;
  try { return parseOrigin(s); } catch { throw new HttpError(400, `${label} muss x,y,z sein.`); }
};

export function registerAgentRoutes(app, campus) {
  const via = a => (a.via === 'token' ? 'api' : 'web');

  const knownNames = () => {
    if (campus.knownNamesCache) return campus.knownNamesCache;
    const names = new Set();
    const live = campus.latestSnapshot('live');
    if (live) for (const n of campus.grid(live.id).names) names.add(n);
    for (const b of campus.listBlueprints({ includeArchived: true })) if (b.current) for (const n of Object.keys(b.current.stats.materials || {})) names.add(n);
    campus.knownNamesCache = names;
    return names;
  };

  // Shared by edit + create: apply ops, optionally store a version, always return a preview analysis.
  function runEdits({ bp, model, origin, body, actor }) {
    const { stats, warnings, originShift } = applyEdits(model, origin, body.edits, { coords: body.coords === 'world' ? 'world' : 'local', grow: !!body.grow, knownNames: knownNames() });
    const newOrigin = origin.map((v, i) => v + originShift[i]);
    const bytes = serializeModel(model);
    const structure = parseStructure(bytes);
    const live = campus.latestSnapshot('live');
    const analysis = live ? analyzeBlueprint(structure, newOrigin, campus.grid(live.id), null) : null;
    const preview = {
      changes: stats, warnings, origin: newOrigin, size: model.size, placed: structure.placed.length, clear: structure.clear.length / 3,
      analysis: analysis && { progress: Math.round(analysis.progress * 1000) / 10, built: analysis.built, toPlace: analysis.toPlace, toReplace: analysis.toReplace, toClear: analysis.toClear,
        protectedBlockEntities: analysis.conflicts.protectedBlockEntities, samples: { protectedBlockEntities: analysis.samples.protectedBlockEntities.slice(0, 20) } },
    };
    if (body.dryRun) return { dryRun: true, ...preview };
    const r = campus.saveVersion({ fileName: bp.fileName, bytes, origin: newOrigin, name: body.name, category: body.category, description: body.description,
      note: body.note || `${stats.set} gesetzt, ${stats.cleared} Abriss, ${stats.voided} freigegeben`, baseVersion: body.baseVersion, actor, via: via(actor) });
    campus.knownNamesCache = null;
    return { dryRun: false, ...preview, blueprint: r.blueprint, version: r.version, unchanged: r.unchanged };
  }

  app.post('/api/blueprints/:id/edits', async req => {
    const a = requireActor(req, req.body?.dryRun ? 'read' : 'write');
    const body = req.body || {};
    const bp = campus.getBlueprint(req.params.id);
    const cur = campus.currentVersion(bp.id);
    if (!body.dryRun && (body.baseVersion === undefined || body.baseVersion === null)) {
      throw new HttpError(400, `baseVersion fehlt. Aktuell ist Version ${cur.version}; mitschicken, damit parallele Änderungen nicht überschrieben werden.`, { currentVersion: cur.version });
    }
    if (body.baseVersion !== undefined && body.baseVersion !== null && Number(body.baseVersion) !== cur.version) {
      throw new HttpError(409, `Bearbeitungskonflikt: ${bp.id} ist inzwischen bei Version ${cur.version} (du hast auf ${body.baseVersion} aufgebaut).`,
        { blueprint: bp.id, currentVersion: cur.version, baseVersion: Number(body.baseVersion), currentUploadedBy: cur.uploadedBy, currentCreatedAt: cur.createdAt });
    }
    const model = loadModel(campus.readVersionBytes(bp.id, cur.version));
    return runEdits({ bp, model, origin: cur.origin, body, actor: a });
  });

  // New blueprint from scratch: size + origin + edits.
  app.post('/api/blueprints/new', async req => {
    const a = requireActor(req, req.body?.dryRun ? 'read' : 'write');
    const body = req.body || {};
    const fileName = String(body.fileName || '');
    if (!/^[A-Za-z0-9_.-]+\.nbt$/.test(fileName)) throw new HttpError(400, 'fileName wie "40_Pavillon.nbt" angeben (Buchstaben, Zahlen, _ . -).');
    const id = fileName.replace(/\.nbt$/i, '');
    if (campus.db.prepare('SELECT 1 FROM blueprints WHERE id = ? AND archived_at IS NULL').get(id)) throw new HttpError(409, `Bauplan ${id} existiert schon. Für Änderungen POST /api/blueprints/${id}/edits nutzen.`);
    const origin = parseOrigin(body.origin);
    const model = emptyModel(body.size);
    return runEdits({ bp: { fileName }, model, origin, body: { ...body, name: body.name || id, baseVersion: undefined }, actor: a });
  });

  // All cells of a blueprint as JSON (positions local or world).
  app.get('/api/blueprints/:id/blocks', async req => {
    requireActor(req, 'read');
    const bp = campus.getBlueprint(req.params.id);
    const v = req.query.version ? campus.version(bp.id, Number(req.query.version)) : campus.currentVersion(bp.id);
    const model = loadModel(campus.readVersionBytes(bp.id, v.version));
    const world = req.query.coords === 'world', off = world ? v.origin : [0, 0, 0];
    const palette = [], pIndex = new Map(), blocks = [];
    for (const [k, c] of model.cells) {
      const key = c.name + JSON.stringify(c.props || {});
      let p = pIndex.get(key);
      if (p === undefined) { p = palette.length; pIndex.set(key, p); palette.push({ name: c.name, properties: c.props || {} }); }
      const [x, y, z] = k.split(',').map(Number);
      const row = [x + off[0], y + off[1], z + off[2], p];
      if (c.nbt) row.push(1);
      blocks.push(row);
    }
    blocks.sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
    return { id: bp.id, version: v.version, coords: world ? 'world' : 'local', origin: v.origin, size: model.size,
      legend: 'blocks: [x, y, z, paletteIndex, hasBlockEntityData?]. Nicht aufgeführte Zellen werden nicht angefasst; minecraft:air = abreißen.', palette, blocks };
  });

  // ASCII layers: easy to read for LLMs.
  app.get('/api/blueprints/:id/layers', async (req, reply) => {
    requireActor(req, 'read');
    const bp = campus.getBlueprint(req.params.id);
    const v = req.query.version ? campus.version(bp.id, Number(req.query.version)) : campus.currentVersion(bp.id);
    const model = loadModel(campus.readVersionBytes(bp.id, v.version));
    const world = req.query.coords !== 'local';
    const yr = parseRange(req.query.y, 'y');
    let y0 = 0, y1 = model.size[1] - 1;
    if (yr) { const o = world ? v.origin[1] : 0; y0 = Math.max(0, yr[0] - o); y1 = Math.min(model.size[1] - 1, yr[1] - o); }
    if (model.size[0] * model.size[2] * (y1 - y0 + 1) > MAX_VIEW_CELLS) throw new HttpError(400, 'Zu groß – mit ?y=a..b eingrenzen.');
    const text = layersText({ title: `${bp.name} (${bp.id}) v${v.version}`, origin: v.origin, size: model.size, yFrom: y0, yTo: y1, coords: world ? 'world' : 'local',
      get: (x, y, z) => model.cells.get(`${x},${y},${z}`)?.name });
    return reply.type('text/plain; charset=utf-8').send(text);
  });

  // The real world (a snapshot) in a box: JSON or layers. Plan against what is actually there.
  app.get('/api/world/blocks', async (req, reply) => {
    requireActor(req, 'read');
    const snap = req.query.snapshot ? campus.getSnapshot(Number(req.query.snapshot)) : campus.latestSnapshot('live');
    if (!snap) throw new HttpError(503, 'Noch kein Snapshot.');
    const from = triple(req.query.from, 'from'), to = triple(req.query.to, 'to');
    if (!from || !to) throw new HttpError(400, 'from=x,y,z und to=x,y,z angeben (Weltkoordinaten).');
    const lo = from.map((v, i) => Math.min(v, to[i])), hi = from.map((v, i) => Math.max(v, to[i]));
    const size = hi.map((h, i) => h - lo[i] + 1);
    if (size[0] * size[1] * size[2] > MAX_VIEW_CELLS) throw new HttpError(400, `Bereich zu groß (max. ${MAX_VIEW_CELLS} Zellen).`);
    const g = campus.grid(snap.id);
    const inside = (x, y, z) => x >= g.origin[0] && y >= g.origin[1] && z >= g.origin[2] && x < g.origin[0] + g.size[0] && y < g.origin[1] + g.size[1] && z < g.origin[2] + g.size[2];
    const nameAt = (x, y, z) => inside(x, y, z) ? g.names[g.grid[((y - g.origin[1]) * g.size[2] + (z - g.origin[2])) * g.size[0] + (x - g.origin[0])]] : null;
    const bes = g.blockEntities.filter(([x, y, z]) => x >= lo[0] && x <= hi[0] && y >= lo[1] && y <= hi[1] && z >= lo[2] && z <= hi[2]).map(([x, y, z, id]) => ({ pos: [x, y, z], id }));
    if (req.query.format === 'layers') {
      const text = layersText({ title: `Welt-Snapshot #${snap.id} (${snap.label}, ${snap.worldTime || snap.capturedAt})`, origin: lo, size, yFrom: 0, yTo: size[1] - 1, coords: 'world',
        get: (x, y, z) => nameAt(lo[0] + x, lo[1] + y, lo[2] + z) });
      return reply.type('text/plain; charset=utf-8').send(text + (bes.length ? '\n# Block-Entities (Maschinen, Kisten …):\n' + bes.map(b => `# ${b.pos.join(',')} ${b.id}`).join('\n') + '\n' : ''));
    }
    const palette = [], pIndex = new Map(), blocks = [];
    for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) {
      const n = nameAt(x, y, z);
      if (!n || n === 'minecraft:air') continue;
      let p = pIndex.get(n);
      if (p === undefined) { p = palette.length; pIndex.set(n, p); palette.push(n); }
      blocks.push([x, y, z, p]);
    }
    return { snapshot: { id: snap.id, label: snap.label, worldTime: snap.worldTime }, from: lo, to: hi, legend: 'blocks: [x,y,z,paletteIndex], Luft weggelassen', palette, blocks, blockEntities: bes };
  });
}
