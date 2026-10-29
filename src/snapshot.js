// Builds a "Bestand" snapshot of the campus box from region files:
// a full block grid (for conflict analysis) and the visible-surface records the viewer renders
// (format minecraft-block-surfaces-v1, identical to Jonny's embedded context).
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Region, regionMtime, unpackBlockStates } from './region.js';

export const IGNORED_NAMES = ['minecraft:air', 'minecraft:cave_air', 'minecraft:light', 'minecraft:void_air'];
const IGNORED = new Set(IGNORED_NAMES);
const WORLD_TOP_Y = 319;

export function opticalClass(name) {
  return /glass|leaves|bubble_column|(^|:)water$|(^|:)ice$/.test(name) ? 'translucent' : 'opaque';
}

function chunkRange(origin, size) {
  return {
    cx0: Math.floor(origin[0] / 16), cx1: Math.floor((origin[0] + size[0] - 1) / 16),
    cz0: Math.floor(origin[2] / 16), cz1: Math.floor((origin[2] + size[2] - 1) / 16),
  };
}

// Newest region-file mtime covering the box; used to skip snapshots when nothing was saved.
export function worldStamp(worldDir, origin, size) {
  const { cx0, cx1, cz0, cz1 } = chunkRange(origin, size);
  let newest = 0;
  for (let rx = cx0 >> 5; rx <= cx1 >> 5; rx++) for (let rz = cz0 >> 5; rz <= cz1 >> 5; rz++) newest = Math.max(newest, regionMtime(worldDir, rx, rz));
  return newest;
}

export function buildGrid(worldDir, origin, size) {
  const [ox, oy, oz] = origin, [sx, sy, sz] = size;
  const grid = new Uint16Array(sx * sy * sz);
  const names = ['minecraft:air'], nameIndex = new Map([['minecraft:air', 0]]);
  const blockEntities = [];
  const { cx0, cx1, cz0, cz1 } = chunkRange(origin, size);
  const regions = new Map();
  const unpacked = new Uint16Array(4096);
  let chunksLoaded = 0, sectionsLoaded = 0, chunksMissing = 0;
  const idOf = name => {
    if (IGNORED.has(name)) return 0;
    let i = nameIndex.get(name);
    if (i === undefined) { i = names.length; names.push(name); nameIndex.set(name, i); }
    return i;
  };
  for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
    const rk = (cx >> 5) + ',' + (cz >> 5);
    if (!regions.has(rk)) regions.set(rk, Region.open(worldDir, cx >> 5, cz >> 5));
    const region = regions.get(rk);
    const chunk = region && region.chunk(cx & 31, cz & 31);
    if (!chunk || !Array.isArray(chunk.sections)) { chunksMissing++; continue; }
    chunksLoaded++;
    for (const sec of chunk.sections) {
      const bs = sec.block_states;
      if (!bs || !Array.isArray(bs.palette)) continue;
      const baseY = sec.Y * 16;
      if (baseY + 15 < oy || baseY > oy + sy - 1) continue;
      const pal = bs.palette.map(s => idOf(s.Name));
      if (pal.length === 1 && pal[0] === 0) continue;
      sectionsLoaded++;
      if (pal.length === 1 || !bs.data) unpacked.fill(0);
      else unpackBlockStates(bs.data, pal.length, unpacked);
      for (let i = 0; i < 4096; i++) {
        const wx = cx * 16 + (i & 15), wz = cz * 16 + ((i >> 4) & 15), wy = baseY + (i >> 8);
        const x = wx - ox, y = wy - oy, z = wz - oz;
        if (x < 0 || x >= sx || y < 0 || y >= sy || z < 0 || z >= sz) continue;
        const id = pal[unpacked[i]];
        if (id) grid[(y * sz + z) * sx + x] = id;
      }
    }
    for (const be of chunk.block_entities || []) {
      const x = be.x - ox, y = be.y - oy, z = be.z - oz;
      if (x >= 0 && x < sx && y >= 0 && y < sy && z >= 0 && z < sz) blockEntities.push([be.x, be.y, be.z, String(be.id || '')]);
    }
  }
  return { origin: [...origin], size: [...size], grid, names, blockEntities, stats: { chunksLoaded, chunksMissing, sectionsLoaded } };
}

// Visible surfaces with the same rules as the original viewer export:
// air exposes faces, translucent blocks expose neighbours, identical translucent names hide internal faces,
// no synthetic faces at crop boundaries except the world top.
export function computeSurfaces({ origin, size, grid, names }) {
  const [sx, sy, sz] = size;
  const translucent = Uint8Array.from(names, (n, i) => i > 0 && opticalClass(n) === 'translucent' ? 1 : 0);
  const topIsWorldLimit = origin[1] + sy - 1 >= WORLD_TOP_Y;
  const cells = [];
  const used = new Map();
  const at = (x, y, z) => grid[(y * sz + z) * sx + x];
  const exposed = (self, nb) => nb === 0 || (translucent[nb] === 1 && nb !== self);
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const self = at(x, y, z);
    if (!self) continue;
    let mask = 0;
    if (x + 1 < sx && exposed(self, at(x + 1, y, z))) mask |= 1;
    if (x > 0 && exposed(self, at(x - 1, y, z))) mask |= 2;
    if (y + 1 < sy ? exposed(self, at(x, y + 1, z)) : topIsWorldLimit) mask |= 4;
    if (y > 0 && exposed(self, at(x, y - 1, z))) mask |= 8;
    if (z + 1 < sz && exposed(self, at(x, y, z + 1))) mask |= 16;
    if (z > 0 && exposed(self, at(x, y, z - 1))) mask |= 32;
    if (!mask) continue;
    cells.push(x, y, z, self, mask);
    used.set(self, (used.get(self) || 0) + 1);
  }
  const palette = [...used.keys()].map(i => names[i]).sort();
  const remap = new Map(palette.map((n, i) => [n, i]));
  const records = new Uint16Array(cells.length);
  const facesByDir = { '+X': 0, '-X': 0, '+Y': 0, '-Y': 0, '+Z': 0, '-Z': 0 };
  const dirs = Object.keys(facesByDir);
  const counts = {};
  for (let i = 0; i < cells.length; i += 5) {
    const name = names[cells[i + 3]];
    records[i] = cells[i]; records[i + 1] = cells[i + 1]; records[i + 2] = cells[i + 2];
    records[i + 3] = remap.get(name); records[i + 4] = cells[i + 4];
    for (let b = 0; b < 6; b++) if (cells[i + 4] & (1 << b)) facesByDir[dirs[b]]++;
    counts[name] = (counts[name] || 0) + 1;
  }
  return {
    records, palette, paletteOpticalClasses: palette.map(opticalClass),
    visibleFaceCount: Object.values(facesByDir).reduce((a, b) => a + b, 0), visibleFacesByDirection: facesByDir,
    mostCommonVisibleBlocks: Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 30)),
  };
}

const sha = b => createHash('sha256').update(b).digest('hex');
const le16 = arr => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength); // all supported hosts are little endian

// Writes snapshot files atomically into dir and returns the viewer context metadata.
export function writeSnapshotFiles(dir, built, surfaces, info) {
  const tmp = dir + '.tmp';
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const raw = le16(surfaces.records), gz = gzipSync(raw, { level: 9 });
  writeFileSync(join(tmp, 'surfaces.bin.gz'), gz);
  writeFileSync(join(tmp, 'grid.bin.gz'), gzipSync(le16(built.grid), { level: 6 }));
  writeFileSync(join(tmp, 'grid.json'), JSON.stringify({ origin: built.origin, size: built.size, names: built.names }));
  writeFileSync(join(tmp, 'block_entities.json.gz'), gzipSync(JSON.stringify(built.blockEntities)));
  const context = {
    format: 'minecraft-block-surfaces-v1',
    source: info.source,
    label: info.label,
    capturedAt: info.capturedAt,
    origin: built.origin, size: built.size,
    recordCount: surfaces.records.length / 5, count: surfaces.records.length / 5,
    strideBytes: 10, dtype: 'uint16', endianness: 'little',
    fields: ['localX', 'localY', 'localZ', 'paletteIndex', 'faceMask'],
    faceBits: { '+X': 0, '-X': 1, '+Y': 2, '-Y': 3, '+Z': 4, '-Z': 5 },
    palette: surfaces.palette, paletteOpticalClasses: surfaces.paletteOpticalClasses,
    dataFile: 'surfaces.bin.gz', compressedBytes: gz.length, uncompressedBytes: raw.length,
    sha256: sha(gz), rawSha256: sha(raw),
    chunksLoaded: built.stats.chunksLoaded, chunksMissing: built.stats.chunksMissing, sectionsLoaded: built.stats.sectionsLoaded,
    blockEntityCount: built.blockEntities.length,
    visibleFaceCount: surfaces.visibleFaceCount, visibleFacesByDirection: surfaces.visibleFacesByDirection,
    mostCommonVisibleBlocks: surfaces.mostCommonVisibleBlocks,
    ignoredNames: IGNORED_NAMES,
    transparentRule: 'glass/leaves/water expose neighboring opaque faces; identical transparent block names suppress internal faces',
    cropRules: 'No synthetic faces at the bottom or horizontal crop boundaries; top face at world limit Y319 retained.',
    representation: 'Full cubes using actual block names; no blockstate shape/orientation, blockentity models, biome tint or textures.',
  };
  writeFileSync(join(tmp, 'context.json'), JSON.stringify(context));
  rmSync(dir, { recursive: true, force: true });
  renameSync(tmp, dir);
  return context;
}

export function loadGrid(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'grid.json'), 'utf8'));
  const raw = gunzipSync(readFileSync(join(dir, 'grid.bin.gz')), { maxOutputLength: 256 * 1024 * 1024 });
  const grid = new Uint16Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const blockEntities = existsSync(join(dir, 'block_entities.json.gz')) ? JSON.parse(gunzipSync(readFileSync(join(dir, 'block_entities.json.gz')))) : [];
  return { ...meta, grid, blockEntities };
}

// Synchronous build. A torn read while the server saves surfaces as an exception; callers retry.
export function captureSnapshot(worldDir, origin, size) {
  const started = Date.now();
  const built = buildGrid(worldDir, origin, size);
  const surfaces = computeSurfaces(built);
  return { built, surfaces, durationMs: Date.now() - started };
}
