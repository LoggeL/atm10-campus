// Anvil region (.mca) reader. Read-only: the world directory is mounted read-only in production.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, inflateSync } from 'node:zlib';
import { parseNBT } from './nbt.js';

export function regionPath(worldDir, rx, rz) {
  return join(worldDir, 'region', `r.${rx}.${rz}.mca`);
}

export function regionMtime(worldDir, rx, rz) {
  const p = regionPath(worldDir, rx, rz);
  return existsSync(p) ? statSync(p).mtimeMs : 0;
}

export class Region {
  constructor(buf) { this.buf = buf; }
  static open(worldDir, rx, rz) {
    const p = regionPath(worldDir, rx, rz);
    return existsSync(p) ? new Region(readFileSync(p)) : null;
  }
  // cx, cz are chunk coordinates local to the region (0..31). Returns the chunk root compound or null.
  chunk(cx, cz) {
    const buf = this.buf;
    if (buf.length < 8192) return null;
    const idx = 4 * ((cx & 31) + (cz & 31) * 32);
    const offset = (buf[idx] << 16 | buf[idx + 1] << 8 | buf[idx + 2]) * 4096;
    const sectors = buf[idx + 3];
    if (offset === 0 || sectors === 0) return null;
    if (offset + 5 > buf.length) throw new Error(`Chunk ${cx},${cz}: Offset außerhalb der Datei.`);
    const length = buf.readUInt32BE(offset);
    const type = buf[offset + 4];
    if (length < 1 || offset + 4 + length > buf.length) throw new Error(`Chunk ${cx},${cz}: Länge ungültig (wird evtl. gerade geschrieben).`);
    if (type & 0x80) throw new Error(`Chunk ${cx},${cz}: externe .mcc-Chunks werden nicht unterstützt.`);
    const payload = buf.subarray(offset + 5, offset + 4 + length);
    let raw;
    if (type === 1) raw = gunzipSync(payload);
    else if (type === 2) raw = inflateSync(payload);
    else if (type === 3) raw = payload;
    else throw new Error(`Chunk ${cx},${cz}: Kompression ${type} wird nicht unterstützt.`);
    return parseNBT(raw).value;
  }
}

// Unpack a 1.18+ paletted container (4096 entries, no cross-long spanning).
export function unpackBlockStates(longs, paletteLength, out) {
  const bits = Math.max(4, Math.ceil(Math.log2(paletteLength)));
  const perLong = Math.floor(64 / bits), mask = (1 << bits) - 1, w = longs.words;
  for (let i = 0; i < 4096; i++) {
    const l = Math.floor(i / perLong), off = (i % perLong) * bits;
    const hi = w[l * 2], lo = w[l * 2 + 1];
    let v;
    if (off + bits <= 32) v = (lo >>> off) & mask;
    else if (off >= 32) v = (hi >>> (off - 32)) & mask;
    else v = ((lo >>> off) | (hi << (32 - off))) & mask;
    out[i] = v;
  }
  return out;
}
