// Voxel mesher: greedy meshing with per-corner ambient occlusion, one mesh pair (opaque/transparent) per 32³ chunk.
// Every face carries a category so the main thread can combine layers (Bestand, gebaut, offen, Konflikte …) via uniforms.
'use strict';

const CH = 32;
// Categories (aInfo & 31). Context: 0 unberührt, 2 wird abgerissen, 20 + Status = von Bauplan-Zelle überdeckt.
// Blueprint: 10 + Status (low bits). Bit 32 = Überlappung.
const CTX = 0, CTX_DEMOLISH = 2, CTX_COVERED = 20, BP = 10;
const CLEAR = 0xffff;
const AO_CURVE = [0.48, 0.66, 0.84, 1.0];
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

let S = null; // scene state

self.onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'init') { init(m); meshAll(); }
    else if (m.type === 'visibility') { setVisibility(m.visible); }
    else if (m.type === 'pick') self.postMessage({ type: 'pick', id: m.id, hit: pick(m) });
  } catch (err) { self.postMessage({ type: 'error', message: err.message, stack: err.stack }); }
};

function init(m) {
  const styles = m.styles; // [{ color:[r,g,b], top, layers:[side,top,bottom], kind:0 opaque|1 cutout|2 transparent, emissive }]
  // Scene bounds = context box ∪ blueprint boxes.
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const grow = (o, s) => { for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], o[a]); hi[a] = Math.max(hi[a], o[a] + s[a]); } };
  if (m.context) grow(m.context.origin, m.context.size);
  for (const b of m.blueprints) grow(b.origin, b.size);
  if (!isFinite(lo[0])) { lo.fill(0); hi.fill(1); }
  const size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  S = { styles, lo, size, ctx: null, bps: m.blueprints, visible: new Set(m.visible), bpCells: new Map(), chunksCtx: new Map(), chunksBp: new Map() };
  S.translucent = Uint8Array.from(styles, s => s.kind > 0 ? 1 : 0);
  S.styleNames = m.styleNames;

  if (m.context) {
    const { origin, records } = m.context;
    const grid = new Uint16Array(size[0] * size[1] * size[2]);
    const n = records.length / 5;
    const cells = new Int32Array(n), masks = new Uint8Array(n), stl = new Uint16Array(n);
    for (let i = 0, r = 0; r < n; r++, i += 5) {
      const x = records[i] + origin[0] - lo[0], y = records[i + 1] + origin[1] - lo[1], z = records[i + 2] + origin[2] - lo[2];
      const idx = (y * size[2] + z) * size[0] + x;
      const st = m.context.styleOf[records[i + 3]];
      grid[idx] = st + 1; cells[r] = idx; masks[r] = records[i + 4]; stl[r] = st;
      bucket(S.chunksCtx, x, y, z, r);
    }
    S.ctx = { grid, cells, masks, styles: stl };
  }
  // Blueprint cells: positions are local Uint16, statuses per cell.
  S.bps.forEach((b, bi) => {
    b.index = bi; b.styleOf = m.bpStyleOf; b.paletteNames = m.bpPalette;
    b.cellIdx = new Int32Array(b.placed + b.clear);
    for (let i = 0; i < b.placed + b.clear; i++) {
      const x = b.pos[i * 3] + b.origin[0] - lo[0], y = b.pos[i * 3 + 1] + b.origin[1] - lo[1], z = b.pos[i * 3 + 2] + b.origin[2] - lo[2];
      b.cellIdx[i] = (y * size[2] + z) * size[0] + x;
    }
  });
  rebuildBpCells();
  self.postMessage({ type: 'bounds', lo, size });
}

function bucket(map, x, y, z, v) {
  const k = ((y / CH) | 0) * 1e6 + ((z / CH) | 0) * 1e3 + ((x / CH) | 0);
  let a = map.get(k);
  if (!a) { a = []; map.set(k, a); }
  a.push(v);
}
const chunkKeyOfIdx = idx => {
  const sx = S.size[0], sz = S.size[2];
  const x = idx % sx, z = ((idx / sx) | 0) % sz, y = (idx / (sx * sz)) | 0;
  return ((y / CH) | 0) * 1e6 + ((z / CH) | 0) * 1e3 + ((x / CH) | 0);
};

// bpCells: idx -> packed (bi << 20 | cellIndex). Later blueprints win on overlap (they are flagged anyway).
function rebuildBpCells() {
  S.bpCells = new Map();
  S.chunksBp = new Map();
  for (const b of S.bps) {
    if (!S.visible.has(b.id)) continue;
    for (let i = 0; i < b.placed + b.clear; i++) S.bpCells.set(b.cellIdx[i], (b.index << 20) | i);
  }
  for (const [idx] of S.bpCells) {
    const sx = S.size[0], sz = S.size[2];
    bucket(S.chunksBp, idx % sx, (idx / (sx * sz)) | 0, ((idx / sx) | 0) % sz, idx);
  }
}

function setVisibility(visible) {
  const before = new Set(S.visible);
  S.visible = new Set(visible);
  const touched = new Set();
  for (const b of S.bps) {
    if (before.has(b.id) === S.visible.has(b.id)) continue;
    for (let i = 0; i < b.cellIdx.length; i += 1) touched.add(chunkKeyOfIdx(b.cellIdx[i]));
  }
  rebuildBpCells();
  meshChunks([...touched]);
  sendSolid();
}

// Style at a blueprint cell, CLEAR for demolition cells, 0 if none.
function bpStyleAt(idx) {
  const p = S.bpCells.get(idx);
  if (p === undefined) return 0;
  const b = S.bps[p >>> 20], i = p & 0xfffff;
  return i < b.placed ? b.styleOf[b.pal[i]] + 1 : CLEAR;
}

function meshAll() {
  const keys = new Set([...S.chunksCtx.keys(), ...S.chunksBp.keys()]);
  meshChunks([...keys]);
  sendSolid();
  self.postMessage({ type: 'done' });
}

function meshChunks(keys) {
  let n = 0;
  for (const k of keys) {
    const out = { type: 'chunk', key: k, ctx: meshContextChunk(k), bp: meshBlueprintChunk(k) };
    const transfer = [];
    for (const part of [out.ctx, out.bp]) for (const g of [part?.opaque, part?.transparent]) if (g) transfer.push(g.position.buffer, g.normal.buffer, g.color.buffer, g.uv.buffer, g.layer.buffer, g.info.buffer, g.ao.buffer, g.index.buffer);
    self.postMessage(out, transfer);
    if (++n % 8 === 0) self.postMessage({ type: 'progress', done: n, total: keys.length });
  }
  self.postMessage({ type: 'progress', done: keys.length, total: keys.length });
}

// ---------- face collection + greedy merge ----------
function newCollector() { return { opaque: new Map(), transparent: new Map() }; }

// face: d (0..5), cell coords (x,y,z scene-local), key packs style/category/ao.
function addFace(col, transparent, d, x, y, z, key) {
  const a = d >> 1, ua = (a + 1) % 3, va = (a + 2) % 3;
  const c = [x, y, z];
  const slice = c[a];
  const sk = d * 1e6 + slice;
  const map = transparent ? col.transparent : col.opaque;
  let s = map.get(sk);
  if (!s) { s = { d, slice, cells: new Map() }; map.set(sk, s); }
  s.cells.set(c[ua] * 4096 + c[va], key);
}

function aoAt(occ, x, y, z, d) {
  const a = d >> 1, ua = (a + 1) % 3, va = (a + 2) % 3, n = DIRS[d];
  const p = [x + n[0], y + n[1], z + n[2]];
  const res = [0, 0, 0, 0];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let c = 0; c < 4; c++) {
    const [du, dv] = corners[c];
    const q1 = p.slice(); q1[ua] += du;
    const q2 = p.slice(); q2[va] += dv;
    const q3 = p.slice(); q3[ua] += du; q3[va] += dv;
    const s1 = occ(q1[0], q1[1], q1[2]), s2 = occ(q2[0], q2[1], q2[2]), s3 = occ(q3[0], q3[1], q3[2]);
    res[c] = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
  }
  return res;
}
const packAo = ao => ao[0] | ao[1] << 2 | ao[2] << 4 | ao[3] << 6;

function inBounds(x, y, z) { return x >= 0 && y >= 0 && z >= 0 && x < S.size[0] && y < S.size[1] && z < S.size[2]; }
const idxOf = (x, y, z) => (y * S.size[2] + z) * S.size[0] + x;

function meshContextChunk(k) {
  const list = S.chunksCtx.get(k);
  if (!list || !S.ctx) return null;
  const { grid, cells, masks, styles: stl } = S.ctx;
  const sx = S.size[0], sz = S.size[2];
  const occ = (x, y, z) => { if (!inBounds(x, y, z)) return 0; const s = grid[idxOf(x, y, z)]; return s && !S.translucent[s - 1] ? 1 : 0; };
  const col = newCollector();
  for (const r of list) {
    const idx = cells[r], st = stl[r], mask = masks[r];
    const x = idx % sx, z = ((idx / sx) | 0) % sz, y = (idx / (sx * sz)) | 0;
    const p = S.bpCells.get(idx);
    let cat = CTX;
    if (p !== undefined) {
      const b = S.bps[p >>> 20], i = p & 0xfffff;
      cat = i >= b.placed ? CTX_DEMOLISH : CTX_COVERED + (b.status[i] & 15);
    }
    const transparent = S.styles[st].kind === 2;
    for (let d = 0; d < 6; d++) {
      if (!(mask & (1 << d))) continue;
      const ao = transparent ? [3, 3, 3, 3] : aoAt(occ, x, y, z, d);
      addFace(col, transparent, d, x, y, z, st | cat << 12 | packAo(ao) << 18);
    }
  }
  return build(col, k);
}

function meshBlueprintChunk(k) {
  const list = S.chunksBp.get(k);
  if (!list) return null;
  const sx = S.size[0], sz = S.size[2];
  const ctxGrid = S.ctx?.grid;
  // Combined solid style at idx for the design scene (blueprint overrides context).
  const styleAt = idx => {
    const b = bpStyleAt(idx);
    if (b === CLEAR) return 0;
    if (b) return b;
    return ctxGrid ? ctxGrid[idx] : 0;
  };
  const occ = (x, y, z) => { if (!inBounds(x, y, z)) return 0; const s = styleAt(idxOf(x, y, z)); return s && !S.translucent[s - 1] ? 1 : 0; };
  const col = newCollector();
  for (const idx of list) {
    const p = S.bpCells.get(idx);
    const b = S.bps[p >>> 20], i = p & 0xfffff;
    if (i >= b.placed) continue; // demolition cells have no geometry of their own
    const st = b.styleOf[b.pal[i]], status = b.status[i];
    const cat = BP + (status & 15), info = cat | (status & 0x10 ? 32 : 0);
    const x = idx % sx, z = ((idx / sx) | 0) % sz, y = (idx / (sx * sz)) | 0;
    const transparent = S.styles[st].kind === 2;
    for (let d = 0; d < 6; d++) {
      const n = DIRS[d], nx = x + n[0], ny = y + n[1], nz = z + n[2];
      let show = true;
      if (inBounds(nx, ny, nz)) {
        const nIdx = idxOf(nx, ny, nz), np = S.bpCells.get(nIdx);
        let ns;
        if (np !== undefined) {
          const nb = S.bps[np >>> 20], ni = np & 0xfffff;
          if (ni >= nb.placed) ns = 0;
          else {
            ns = nb.styleOf[nb.pal[ni]] + 1;
            // Different category → keep both faces so either layer can be hidden without holes.
            if ((BP + (nb.status[ni] & 15)) !== cat) ns = 0;
          }
        } else ns = ctxGrid ? ctxGrid[nIdx] : 0;
        if (ns && (!S.translucent[ns - 1] || ns - 1 === st)) show = false;
      }
      if (!show) continue;
      const ao = transparent ? [3, 3, 3, 3] : aoAt(occ, x, y, z, d);
      addFace(col, transparent, d, x, y, z, st | info << 12 | packAo(ao) << 18);
    }
  }
  return build(col, k);
}

function build(col, k) {
  const out = {};
  for (const kind of ['opaque', 'transparent']) {
    const slices = col[kind];
    if (!slices.size) continue;
    const quads = [];
    for (const s of slices.values()) greedy(s, quads);
    out[kind] = toGeometry(quads, k);
  }
  return out.opaque || out.transparent ? out : null;
}

function greedy(s, quads) {
  const cells = s.cells;
  const done = new Set();
  const keys = [...cells.keys()].sort((a, b) => a - b);
  for (const start of keys) {
    if (done.has(start)) continue;
    const key = cells.get(start);
    const u0 = Math.floor(start / 4096), v0 = start % 4096;
    let w = 1;
    while (cells.get((u0 + w) * 4096 + v0) === key && !done.has((u0 + w) * 4096 + v0) && w < CH) w++;
    let h = 1;
    grow: while (h < CH) {
      for (let du = 0; du < w; du++) { const kk = (u0 + du) * 4096 + v0 + h; if (cells.get(kk) !== key || done.has(kk)) break grow; }
      h++;
    }
    for (let du = 0; du < w; du++) for (let dv = 0; dv < h; dv++) done.add((u0 + du) * 4096 + v0 + dv);
    quads.push({ d: s.d, slice: s.slice, u0, v0, w, h, key });
  }
}

function toGeometry(quads, k) {
  const n = quads.length;
  const position = new Float32Array(n * 12), normal = new Int8Array(n * 12), color = new Uint8Array(n * 12), uv = new Float32Array(n * 8);
  const layer = new Uint8Array(n * 4), info = new Uint8Array(n * 4), ao4 = new Uint8Array(n * 4), index = new Uint32Array(n * 6);
  const cx = (k % 1e3) * CH, cz = (Math.floor(k / 1e3) % 1e3) * CH, cy = Math.floor(k / 1e6) * CH;
  const base = [cx, cy, cz];
  quads.forEach((q, qi) => {
    const st = q.key & 0xfff, inf = (q.key >> 12) & 63, ao = (q.key >> 18) & 255;
    const style = S.styles[st];
    const d = q.d, a = d >> 1, ua = (a + 1) % 3, va = (a + 2) % 3, sign = d & 1 ? -1 : 1;
    const plane = q.slice + (sign > 0 ? 1 : 0);
    const corners = [[q.u0, q.v0], [q.u0 + q.w, q.v0], [q.u0 + q.w, q.v0 + q.h], [q.u0, q.v0 + q.h]];
    const faceKind = a === 1 ? (sign > 0 ? 1 : 2) : 0;
    const tint = faceKind === 1 && style.top ? style.top : style.color;
    for (let c = 0; c < 4; c++) {
      const v = qi * 4 + c, p = [0, 0, 0];
      p[a] = plane; p[ua] = corners[c][0]; p[va] = corners[c][1];
      for (let j = 0; j < 3; j++) position[v * 3 + j] = p[j] - base[j];
      normal[v * 3 + a] = sign * 127;
      for (let j = 0; j < 3; j++) color[v * 3 + j] = tint[j];
      ao4[v] = Math.round(AO_CURVE[(ao >> (c * 2)) & 3] * 255);
      // Texture axes: sides use (horizontal, y), top/bottom use (x, z).
      let tu, tv;
      if (a === 0) { tu = p[2] * -sign; tv = p[1]; }
      else if (a === 2) { tu = p[0] * sign; tv = p[1]; }
      else { tu = p[0]; tv = p[2] * sign; }
      uv[v * 2] = tu; uv[v * 2 + 1] = tv;
      layer[v] = style.layers[faceKind];
      info[v] = inf;
    }
    // Flip the diagonal where AO would otherwise interpolate the wrong way.
    const a0 = (ao & 3) + ((ao >> 4) & 3), a1 = ((ao >> 2) & 3) + ((ao >> 6) & 3);
    const o = qi * 4, ix = qi * 6;
    const flip = a1 > a0;
    const order = sign > 0 ? (flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3]) : (flip ? [1, 3, 2, 1, 0, 3] : [0, 2, 1, 0, 3, 2]);
    for (let j = 0; j < 6; j++) index[ix + j] = o + order[j];
  });
  return { position, normal, color, uv, layer, info, ao: ao4, index, offset: [base[0] + S.lo[0], base[1] + S.lo[1], base[2] + S.lo[2]] };
}

// Solid bitset for walking (design scene: blueprints override context).
function sendSolid() {
  const n = S.size[0] * S.size[1] * S.size[2];
  const bits = new Uint8Array((n + 7) >> 3);
  if (S.ctx) { const g = S.ctx.grid; for (const idx of S.ctx.cells) if (g[idx] && S.styles[g[idx] - 1].kind !== 1) bits[idx >> 3] |= 1 << (idx & 7); }
  for (const [idx] of S.bpCells) {
    const s = bpStyleAt(idx);
    if (s === CLEAR) bits[idx >> 3] &= ~(1 << (idx & 7));
    else if (S.styles[s - 1].kind !== 1) bits[idx >> 3] |= 1 << (idx & 7);
  }
  self.postMessage({ type: 'solid', bits, lo: S.lo, size: S.size }, [bits.buffer]);
}

// DDA ray pick. shown: bool per category (index = category), mirrors what is drawn.
function pick({ origin, dir, maxDist = 600, shown, clipY }) {
  const o = [origin[0] - S.lo[0], origin[1] - S.lo[1], origin[2] - S.lo[2]];
  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
  const step = dir.map(v => (v > 0 ? 1 : -1));
  const tDelta = dir.map(v => (v === 0 ? Infinity : Math.abs(1 / v)));
  const tMax = [0, 1, 2].map(a => {
    if (dir[a] === 0) return Infinity;
    const c = [x, y, z][a];
    return ((dir[a] > 0 ? c + 1 : c) - o[a]) / dir[a];
  });
  let t = 0, face = -1;
  for (let i = 0; i < 4000 && t < maxDist; i++) {
    if (inBounds(x, y, z) && (clipY == null || y + S.lo[1] <= clipY)) {
      const idx = idxOf(x, y, z), p = S.bpCells.get(idx);
      const world = [x + S.lo[0], y + S.lo[1], z + S.lo[2]];
      const live = S.ctx?.grid[idx] ? S.styleNames[S.ctx.grid[idx] - 1] : null;
      if (p !== undefined) {
        const b = S.bps[p >>> 20], ci = p & 0xfffff, status = b.status[ci];
        if (ci < b.placed && shown[BP + (status & 15)]) return { pos: world, face, source: 'blueprint', blueprint: b.id, name: b.paletteNames[b.pal[ci]], live, status };
        if (ci >= b.placed && live && shown[CTX_DEMOLISH]) return { pos: world, face, source: 'context', blueprint: b.id, name: live, live, status, demolish: true };
        if (ci < b.placed && live && shown[CTX_COVERED + (status & 15)]) return { pos: world, face, source: 'context', blueprint: b.id, name: live, live, planned: b.paletteNames[b.pal[ci]], status };
      } else if (live && shown[CTX]) {
        return { pos: world, face, source: 'context', name: live, live };
      }
    }
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
    t = tMax[a]; tMax[a] += tDelta[a];
    if (a === 0) x += step[0]; else if (a === 1) y += step[1]; else z += step[2];
    face = a * 2 + (step[a] > 0 ? 1 : 0);
  }
  return null;
}
