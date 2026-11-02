// Read-only, sampled site survey outside the fixed campus snapshot box.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Region, regionMtime } from './region.js';

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air', 'minecraft:light']);
const FOLIAGE = /(?:leaves|sapling|flower|grass|fern|vine|petal|mushroom|bush|roots|lily_pad|sugar_cane|bamboo|kelp|seagrass)$/;
const skipGround = name => name !== 'minecraft:grass_block' && FOLIAGE.test(name);

export function terrainQuery(query) {
  const pair = value => {
    if (!/^-?\d+,-?\d+$/.test(String(value))) throw Error('from/to müssen x,z sein.');
    const p = String(value).split(',').map(Number);
    if (p.some(v => !Number.isSafeInteger(v) || Math.abs(v) > 29998000)) throw Error('Koordinaten außerhalb des Bereichs.');
    return p;
  };
  const a = pair(query.from), b = pair(query.to);
  const from = a.map((v, i) => Math.min(v, b[i])), to = a.map((v, i) => Math.max(v, b[i]));
  const step = Number(query.step ?? 16), probeY = Number(query.y ?? 87);
  if (!Number.isInteger(step) || step < 4 || step > 64) throw Error('step muss 4–64 sein.');
  if (!Number.isInteger(probeY) || probeY < -64 || probeY > 319) throw Error('y muss −64–319 sein.');
  const size = to.map((v, i) => v - from[i] + 1);
  const samples = size.reduce((n, s) => n * (Math.floor((s - 1) / step) + 1), 1);
  if (size.some(s => s > 1536) || samples > 40000) throw Error('Maximal 1536 × 1536 Blöcke und 40.000 Stichproben.');
  return { from, to, step, probeY };
}

export function chunkBlockReader(chunk) {
  const sections = new Map((chunk.sections || []).map(s => [s.Y, s.block_states]));
  return (x, y, z) => {
    const bs = sections.get(Math.floor(y / 16));
    if (!bs?.palette?.length) return 'minecraft:air';
    if (bs.palette.length === 1) return bs.palette[0].Name;
    if (!bs.data?.words) throw Error('Blockzustände fehlen.');
    const i = ((y & 15) * 16 + (z & 15)) * 16 + (x & 15);
    const bits = Math.max(4, Math.ceil(Math.log2(bs.palette.length))), perLong = Math.floor(64 / bits), mask = (1 << bits) - 1;
    const k = Math.floor(i / perLong) * 2, off = (i % perLong) * bits, w = bs.data.words;
    if (k + 1 >= w.length) throw Error('Blockzustände sind unvollständig.');
    const hi = w[k], lo = w[k + 1];
    const p = off + bits <= 32 ? (lo >>> off) & mask : off >= 32 ? (hi >>> (off - 32)) & mask : ((lo >>> off) | (hi << (32 - off))) & mask;
    if (!bs.palette[p]) throw Error('Ungültiger Palettenindex.');
    return bs.palette[p].Name;
  };
}

export function surveyTerrain(worldDir, options) {
  if (!existsSync(join(worldDir, 'region'))) throw Error('Live-Welt nicht verfügbar.');
  const started = Date.now(), { from, to, step, probeY } = options;
  const groups = new Map(), samples = [], blockEntities = [], structures = [], regions = [], errors = [];
  const palette = [], indexes = new Map();
  const id = name => { if (name == null) return null; if (!indexes.has(name)) { indexes.set(name, palette.length); palette.push(name); } return indexes.get(name); };
  for (let cx = Math.floor(from[0] / 16); cx <= Math.floor(to[0] / 16); cx++) for (let cz = Math.floor(from[1] / 16); cz <= Math.floor(to[1] / 16); cz++) {
    const key = `${cx >> 5},${cz >> 5}`;
    if (!groups.has(key)) groups.set(key, new Map());
    groups.get(key).set(`${cx},${cz}`, { cx, cz, points: [] });
  }
  for (let z = from[1]; z <= to[1]; z += step) for (let x = from[0]; x <= to[0]; x += step) {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), key = `${cx >> 5},${cz >> 5}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const chunks = groups.get(key), ck = `${cx},${cz}`;
    if (!chunks.has(ck)) chunks.set(ck, { cx, cz, points: [] });
    chunks.get(ck).points.push([x, z]);
  }
  let chunksLoaded = 0, chunksMissing = 0, samplesMissing = 0, truncatedEntities = false;
  for (const [key, chunks] of groups) {
    const [rx, rz] = key.split(',').map(Number), before = regionMtime(worldDir, rx, rz);
    let region;
    try { region = Region.open(worldDir, rx, rz); } catch { region = null; errors.push({ region: [rx, rz], message: 'Region konnte nicht gelesen werden.' }); }
    for (const { cx, cz, points } of chunks.values()) {
      let chunk;
      try { chunk = region?.chunk(cx & 31, cz & 31); } catch { errors.push({ chunk: [cx, cz], message: 'Chunk konnte nicht gelesen werden.' }); }
      if (!chunk?.sections || !['minecraft:full', 'full'].includes(chunk.Status)) {
        chunksMissing++; samplesMissing += points.length;
        for (const [x, z] of points) samples.push([x, z, null, null, null, null, null, false]);
        continue;
      }
      chunksLoaded++;
      const at = chunkBlockReader(chunk);
      for (const [x, z] of points) {
        try {
          let topY = null, groundY = null, top = null, ground = null;
          for (let y = 319; y >= -64; y--) {
            const n = at(x, y, z); if (AIR.has(n)) continue;
            if (topY === null) { topY = y; top = n; }
            if (!skipGround(n)) { groundY = y; ground = n; break; }
          }
          samples.push([x, z, topY, groundY, id(top), id(ground), id(at(x, probeY, z)), true]);
        } catch { samplesMissing++; samples.push([x, z, null, null, null, null, null, false]); }
      }
      for (const be of chunk.block_entities || []) if (be.x >= from[0] && be.x <= to[0] && be.z >= from[1] && be.z <= to[1]) {
        if (blockEntities.length < 10000) blockEntities.push({ pos: [be.x, be.y, be.z], id: String(be.id || '') }); else truncatedEntities = true;
      }
      for (const [name, s] of Object.entries(chunk.structures?.starts || {})) if (s.id && s.id !== 'INVALID') {
        structures.push({ id: name, chunk: [cx, cz], boxes: (s.Children || []).map(c => c.BB ? Array.from(c.BB) : null).filter(Boolean) });
      }
    }
    const after = regionMtime(worldDir, rx, rz);
    regions.push({ region: [rx, rz], savedAt: before ? new Date(before).toISOString() : null, changedDuringRead: before !== after });
  }
  return { source: 'live-saved-region-files', capturedAt: new Date().toISOString(), bounds: { from, to }, step, probeY,
    legend: 'samples: [x,z,topY,groundY,topPalette,groundPalette,probePalette,known]. Ground ignores common foliage, NOT water or structures. Unknown chunks are not air.',
    palette, samples, blockEntities, structures, regions, errors,
    coverage: { chunksLoaded, chunksMissing, samples: samples.length, samplesMissing, truncatedEntities }, durationMs: Date.now() - started,
    limitations: 'Sampled saved Overworld terrain, not an atomic live snapshot. Plants can affect ground heights. Unsampled obstacles and caves are not checked; block entities may be naturally generated.' };
}
