// Minimal NBT reader (Java edition, big endian) for structure files and chunk data.
// Long arrays stay as Uint32Array pairs [hi, lo, hi, lo, ...] so block-state unpacking avoids BigInt.
import { gunzipSync, inflateSync } from 'node:zlib';

const MAX_DEPTH = 128;
const MAX_LIST = 50_000_000;

export class LongArray {
  constructor(words) { this.words = words; } // Uint32Array, length = 2 * count
  get length() { return this.words.length / 2; }
}

export function parseNBT(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let p = 0;
  const need = n => { if (n < 0 || p + n > buf.length) throw new Error('NBT ist unvollständig oder beschädigt.'); };
  const u8 = () => { need(1); return buf[p++]; };
  const i8 = () => { need(1); return buf.readInt8(p++); };
  const i16 = () => { need(2); const v = buf.readInt16BE(p); p += 2; return v; };
  const u16 = () => { need(2); const v = buf.readUInt16BE(p); p += 2; return v; };
  const i32 = () => { need(4); const v = buf.readInt32BE(p); p += 4; return v; };
  const len = () => { const n = i32(); if (n < 0 || n > MAX_LIST) throw new Error('Ungültige NBT-Länge.'); return n; };
  const str = () => { const n = u16(); need(n); const v = buf.toString('utf8', p, p + n); p += n; return v; };

  function value(t, depth) {
    if (depth > MAX_DEPTH) throw new Error('NBT ist zu tief verschachtelt.');
    switch (t) {
      case 1: return i8();
      case 2: return i16();
      case 3: return i32();
      case 4: { need(8); const v = buf.readBigInt64BE(p); p += 8; return Number(v); }
      case 5: { need(4); const v = buf.readFloatBE(p); p += 4; return v; }
      case 6: { need(8); const v = buf.readDoubleBE(p); p += 8; return v; }
      case 7: { const n = len(); need(n); const v = new Int8Array(buf.buffer.slice(buf.byteOffset + p, buf.byteOffset + p + n)); p += n; return v; }
      case 8: return str();
      case 9: {
        const et = u8(), n = len(), out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = value(et, depth + 1);
        return out;
      }
      case 10: {
        const o = {};
        for (;;) {
          const ct = u8();
          if (ct === 0) return o;
          const name = str();
          o[name] = value(ct, depth + 1);
        }
      }
      case 11: { const n = len(); need(n * 4); const v = new Int32Array(n); for (let i = 0; i < n; i++) v[i] = buf.readInt32BE(p + i * 4); p += n * 4; return v; }
      case 12: {
        const n = len(); need(n * 8); const w = new Uint32Array(n * 2);
        for (let i = 0; i < n * 2; i++) w[i] = buf.readUInt32BE(p + i * 4);
        p += n * 8; return new LongArray(w);
      }
      default: throw new Error('Unbekannter NBT-Typ ' + t + '.');
    }
  }

  const t = u8();
  if (t !== 10) throw new Error('NBT muss mit einem Compound beginnen.');
  const name = str();
  return { name, value: value(10, 0) };
}

export function decodeMaybeCompressed(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf, { maxOutputLength: 512 * 1024 * 1024 });
  if (buf[0] === 0x78) return inflateSync(buf, { maxOutputLength: 512 * 1024 * 1024 });
  return buf;
}

export const AIR_NAMES = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

// Parse a vanilla/Create structure file (.nbt). Positions are local to the structure.
// Returns placed blocks (non-air), clear cells (explicit air) and the structure size.
export function parseStructure(bytes) {
  const root = parseNBT(decodeMaybeCompressed(Buffer.from(bytes))).value;
  const size = root.size, palette = root.palette || (root.palettes && root.palettes[0]);
  if (!Array.isArray(size) || size.length !== 3 || !size.every(n => Number.isInteger(n) && n > 0 && n <= 8192) || !Array.isArray(palette) || !Array.isArray(root.blocks)) {
    throw new Error('Erwartet wird eine Vanilla-/Create-Structure (.nbt) mit size, palette und blocks.');
  }
  const names = palette.map(s => {
    if (!s || typeof s.Name !== 'string') throw new Error('Palette enthält einen Eintrag ohne Name.');
    return s.Name;
  });
  const placed = [], clear = [], materials = {};
  let blockEntities = 0;
  for (const b of root.blocks) {
    const pos = b.pos, name = names[b.state];
    if (name === undefined || !Array.isArray(pos) || pos.length !== 3 || !pos.every((n, i) => Number.isInteger(n) && n >= 0 && n < size[i])) {
      throw new Error('NBT enthält einen ungültigen Block oder Palettenverweis.');
    }
    if (name === 'minecraft:structure_void') continue;
    if (AIR_NAMES.has(name)) { clear.push(pos[0], pos[1], pos[2]); continue; }
    placed.push({ x: pos[0], y: pos[1], z: pos[2], name });
    materials[name] = (materials[name] || 0) + 1;
    if (b.nbt) blockEntities++;
  }
  return {
    size: [...size], dataVersion: root.DataVersion ?? null, placed, clear, materials,
    blockEntities, entities: Array.isArray(root.entities) ? root.entities.length : 0,
  };
}

// ---------- lossless typed NBT (for editing structures) ----------
// Node = { t, v }; lists carry their element type in `et` and hold nodes; longs are BigInt.
export function parseTyped(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let p = 0;
  const need = n => { if (n < 0 || p + n > buf.length) throw new Error('NBT ist unvollständig oder beschädigt.'); };
  const str = () => { need(2); const n = buf.readUInt16BE(p); p += 2; need(n); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const len = () => { need(4); const n = buf.readInt32BE(p); p += 4; if (n < 0 || n > MAX_LIST) throw new Error('Ungültige NBT-Länge.'); return n; };
  function val(t, depth) {
    if (depth > MAX_DEPTH) throw new Error('NBT ist zu tief verschachtelt.');
    switch (t) {
      case 1: need(1); return buf.readInt8(p++);
      case 2: { need(2); const v = buf.readInt16BE(p); p += 2; return v; }
      case 3: { need(4); const v = buf.readInt32BE(p); p += 4; return v; }
      case 4: { need(8); const v = buf.readBigInt64BE(p); p += 8; return v; }
      case 5: { need(4); const v = buf.readFloatBE(p); p += 4; return v; }
      case 6: { need(8); const v = buf.readDoubleBE(p); p += 8; return v; }
      case 7: { const n = len(); need(n); const v = Buffer.from(buf.subarray(p, p + n)); p += n; return v; }
      case 8: return str();
      case 9: { need(1); const et = buf[p++]; const n = len(); const out = new Array(n); for (let i = 0; i < n; i++) out[i] = { t: et, v: val(et, depth + 1) }; return { et, items: out }; }
      case 10: { const o = {}; for (;;) { need(1); const ct = buf[p++]; if (ct === 0) return o; const k = str(); o[k] = { t: ct, v: val(ct, depth + 1) }; } }
      case 11: { const n = len(); need(n * 4); const v = new Int32Array(n); for (let i = 0; i < n; i++) v[i] = buf.readInt32BE(p + i * 4); p += n * 4; return v; }
      case 12: { const n = len(); need(n * 8); const v = new BigInt64Array(n); for (let i = 0; i < n; i++) v[i] = buf.readBigInt64BE(p + i * 8); p += n * 8; return v; }
      default: throw new Error('Unbekannter NBT-Typ ' + t + '.');
    }
  }
  need(1);
  if (buf[p++] !== 10) throw new Error('NBT muss mit einem Compound beginnen.');
  const name = str();
  return { name, root: { t: 10, v: val(10, 0) } };
}

export function encodeTyped(name, root) {
  const chunks = [];
  const u8 = n => chunks.push(Buffer.from([n & 255]));
  const str = s => { const b = Buffer.from(s, 'utf8'); const h = Buffer.alloc(2); h.writeUInt16BE(b.length); chunks.push(h, b); };
  const i32 = n => { const b = Buffer.alloc(4); b.writeInt32BE(n); chunks.push(b); };
  function val(t, v) {
    switch (t) {
      case 1: { const b = Buffer.alloc(1); b.writeInt8(v); chunks.push(b); break; }
      case 2: { const b = Buffer.alloc(2); b.writeInt16BE(v); chunks.push(b); break; }
      case 3: i32(v); break;
      case 4: { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); chunks.push(b); break; }
      case 5: { const b = Buffer.alloc(4); b.writeFloatBE(v); chunks.push(b); break; }
      case 6: { const b = Buffer.alloc(8); b.writeDoubleBE(v); chunks.push(b); break; }
      case 7: i32(v.length); chunks.push(Buffer.from(v)); break;
      case 8: str(v); break;
      case 9: u8(v.et); i32(v.items.length); for (const it of v.items) val(v.et, it.v); break;
      case 10: for (const [k, c] of Object.entries(v)) { u8(c.t); str(k); val(c.t, c.v); } u8(0); break;
      case 11: { i32(v.length); const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeInt32BE(x, i * 4)); chunks.push(b); break; }
      case 12: { i32(v.length); const b = Buffer.alloc(v.length * 8); v.forEach((x, i) => b.writeBigInt64BE(x, i * 8)); chunks.push(b); break; }
      default: throw new Error('enc type ' + t);
    }
  }
  u8(10); str(name); val(10, root.v);
  return Buffer.concat(chunks);
}

export const nbtInt = v => ({ t: 3, v });
export const nbtString = v => ({ t: 8, v });
export const nbtList = (et, items) => ({ t: 9, v: { et, items } });
export const nbtCompound = v => ({ t: 10, v });
