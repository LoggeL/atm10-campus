// Compares blueprint versions with a live snapshot (and the snapshot they were planned on).
const SAMPLE_LIMIT = 200;

function gridLookup(snap) {
  if (!snap) return null;
  const [ox, oy, oz] = snap.origin, [sx, sy, sz] = snap.size, grid = snap.grid, names = snap.names;
  const be = new Map();
  for (const [x, y, z, id] of snap.blockEntities || []) be.set(x + ',' + y + ',' + z, id);
  return {
    inside: (x, y, z) => x >= ox && x < ox + sx && y >= oy && y < oy + sy && z >= oz && z < oz + sz,
    name: (x, y, z) => names[grid[((y - oy) * sz + (z - oz)) * sx + (x - ox)]],
    blockEntity: (x, y, z) => be.get(x + ',' + y + ',' + z) || null,
  };
}

const AIR = 'minecraft:air';

// One blueprint against live (+ optional base). `structure` comes from parseStructure.
export function analyzeBlueprint(structure, origin, liveSnap, baseSnap) {
  const live = gridLookup(liveSnap), base = gridLookup(baseSnap);
  const [ox, oy, oz] = origin;
  const r = {
    placed: structure.placed.length, clear: structure.clear.length / 3,
    outsideSnapshot: 0, built: 0, toPlace: 0, toReplace: 0, cleared: 0, toClear: 0,
    conflicts: { protectedBlockEntities: 0, changedSinceBase: 0 },
    samples: { protectedBlockEntities: [], changedSinceBase: [], toReplace: [] },
    baseCompared: !!base,
  };
  const push = (list, item) => { if (list.length < SAMPLE_LIMIT) list.push(item); };
  const check = (x, y, z, want) => {
    if (!live || !live.inside(x, y, z)) { r.outsideSnapshot++; return; }
    const now = live.name(x, y, z);
    const done = now === want;
    if (want === AIR) { if (done) r.cleared++; else r.toClear++; }
    else if (done) r.built++;
    else if (now === AIR) r.toPlace++;
    else { r.toReplace++; push(r.samples.toReplace, { pos: [x, y, z], live: now, planned: want }); }
    if (!done) {
      const be = live.blockEntity(x, y, z);
      if (be) { r.conflicts.protectedBlockEntities++; push(r.samples.protectedBlockEntities, { pos: [x, y, z], live: now, blockEntity: be, planned: want }); }
      if (base && base.inside(x, y, z)) {
        const then = base.name(x, y, z);
        if (then !== now) { r.conflicts.changedSinceBase++; push(r.samples.changedSinceBase, { pos: [x, y, z], base: then, live: now, planned: want }); }
      }
    }
  };
  for (const b of structure.placed) check(ox + b.x, oy + b.y, oz + b.z, b.name);
  const c = structure.clear;
  for (let i = 0; i < c.length; i += 3) check(ox + c[i], oy + c[i + 1], oz + c[i + 2], AIR);
  const total = r.placed + r.clear - r.outsideSnapshot;
  r.progress = total > 0 ? (r.built + r.cleared) / total : 0;
  return r;
}

// Cells claimed by more than one current blueprint with different target blocks.
export function findOverlaps(entries) {
  const claims = new Map(), overlaps = new Map();
  const add = (id, x, y, z, want) => {
    const k = x + ',' + y + ',' + z, prev = claims.get(k);
    if (!prev) { claims.set(k, { id, want }); return; }
    if (prev.id === id || prev.want === want) return;
    const pair = [prev.id, id].sort().join('|');
    let o = overlaps.get(pair);
    if (!o) { o = { blueprints: pair.split('|'), cells: 0, samples: [] }; overlaps.set(pair, o); }
    o.cells++;
    if (o.samples.length < SAMPLE_LIMIT) o.samples.push({ pos: [x, y, z], [prev.id]: prev.want, [id]: want });
  };
  for (const { id, structure, origin: [ox, oy, oz] } of entries) {
    for (const b of structure.placed) add(id, ox + b.x, oy + b.y, oz + b.z, b.name);
    const c = structure.clear;
    for (let i = 0; i < c.length; i += 3) add(id, ox + c[i], oy + c[i + 1], oz + c[i + 2], AIR);
  }
  return [...overlaps.values()];
}

export function statusOf(analysis, overlapCells) {
  if (!analysis) return 'unknown';
  if (analysis.conflicts.protectedBlockEntities > 0 || overlapCells > 0) return 'conflict';
  if (analysis.conflicts.changedSinceBase > 0) return 'warning';
  if (analysis.progress >= 0.999) return 'built';
  return 'ok';
}

// Per-cell status for the viewer, in structure order (placed cells, then clear cells).
// Low bits: 0 gebaut/frei, 1 in Luft setzen, 2 ersetzen, 3 Maschine im Weg, 4 seit Planung geändert, 5 außerhalb Bestand.
// Bit 0x10: Überlappung mit anderem Bauplan.
export const CELL = { DONE: 0, PLACE: 1, REPLACE: 2, BLOCKED: 3, CHANGED: 4, UNKNOWN: 5, OVERLAP: 0x10 };

export function cellStatuses(structure, origin, liveSnap, baseSnap, overlapKeys) {
  const live = gridLookup(liveSnap), base = gridLookup(baseSnap);
  const [ox, oy, oz] = origin;
  const n = structure.placed.length + structure.clear.length / 3;
  const out = new Uint8Array(n);
  let i = 0;
  const status = (x, y, z, want) => {
    let s;
    if (!live || !live.inside(x, y, z)) s = CELL.UNKNOWN;
    else {
      const now = live.name(x, y, z);
      if (now === want) s = CELL.DONE;
      else if (live.blockEntity(x, y, z)) s = CELL.BLOCKED;
      else if (base && base.inside(x, y, z) && base.name(x, y, z) !== now) s = CELL.CHANGED;
      else s = now === AIR ? (want === AIR ? CELL.DONE : CELL.PLACE) : CELL.REPLACE;
    }
    if (overlapKeys && overlapKeys.has(x + ',' + y + ',' + z)) s |= CELL.OVERLAP;
    out[i++] = s;
  };
  for (const b of structure.placed) status(ox + b.x, oy + b.y, oz + b.z, b.name);
  const c = structure.clear;
  for (let j = 0; j < c.length; j += 3) status(ox + c[j], oy + c[j + 1], oz + c[j + 2], AIR);
  return out;
}

export function overlapCellKeys(entries) {
  const claims = new Map(), keys = new Set();
  const add = (id, k, want) => {
    const prev = claims.get(k);
    if (!prev) claims.set(k, { id, want });
    else if (prev.id !== id && prev.want !== want) keys.add(k);
  };
  for (const { id, structure, origin: [ox, oy, oz] } of entries) {
    for (const b of structure.placed) add(id, (ox + b.x) + ',' + (oy + b.y) + ',' + (oz + b.z), b.name);
    const c = structure.clear;
    for (let i = 0; i < c.length; i += 3) add(id, (ox + c[i]) + ',' + (oy + c[i + 1]) + ',' + (oz + c[i + 2]), AIR);
  }
  return keys;
}
