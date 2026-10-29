// Test fixtures: tiny NBT encoder, structure files and a synthetic region file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync, deflateSync } from 'node:zlib';

// Values: { t: type, v } with t in byte|short|int|long|string|list|compound|intArray|longArray
export const T = {
  byte: v => ({ t: 1, v }), int: v => ({ t: 3, v }), string: v => ({ t: 8, v }),
  list: (et, v) => ({ t: 9, et, v }), compound: v => ({ t: 10, v }), longArray: v => ({ t: 12, v }),
};

function enc(node, out) {
  const { t, v } = node;
  switch (t) {
    case 1: out.push(Buffer.from([v & 255])); break;
    case 3: { const b = Buffer.alloc(4); b.writeInt32BE(v); out.push(b); break; }
    case 8: { const s = Buffer.from(v, 'utf8'), l = Buffer.alloc(2); l.writeUInt16BE(s.length); out.push(l, s); break; }
    case 9: { const h = Buffer.alloc(5); h[0] = v.length ? node.et : 0; h.writeInt32BE(v.length, 1); out.push(h); for (const x of v) enc({ t: node.et, v: x.v ?? x, et: x.et }, out); break; }
    case 10: for (const [k, c] of Object.entries(v)) { const s = Buffer.from(k, 'utf8'), h = Buffer.alloc(3); h[0] = c.t; h.writeUInt16BE(s.length, 1); out.push(h, s); enc(c, out); } out.push(Buffer.from([0])); break;
    case 12: { const h = Buffer.alloc(4); h.writeInt32BE(v.length); out.push(h); for (const x of v) { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt.asIntN(64, x)); out.push(b); } break; }
    default: throw new Error('enc type ' + t);
  }
}
export function encodeNBT(rootCompound) {
  const out = [Buffer.from([10, 0, 0])];
  enc(rootCompound, out);
  return Buffer.concat(out);
}

// blocks: [{ pos:[x,y,z], name }]
export function structureNbt(size, blocks) {
  const names = [...new Set(blocks.map(b => b.name))];
  return gzipSync(encodeNBT(T.compound({
    DataVersion: T.int(3955),
    size: T.list(3, size.map(T.int)),
    palette: T.list(10, names.map(n => T.compound({ Name: T.string(n) }))),
    blocks: T.list(10, blocks.map(b => T.compound({ pos: T.list(3, b.pos.map(T.int)), state: T.int(names.indexOf(b.name)) }))),
    entities: T.list(10, []),
  })));
}

function packSection(indices, paletteLen) {
  const bits = Math.max(4, Math.ceil(Math.log2(paletteLen))), per = Math.floor(64 / bits);
  const longs = new Array(Math.ceil(4096 / per)).fill(0n);
  indices.forEach((v, i) => { longs[Math.floor(i / per)] |= BigInt(v) << BigInt((i % per) * bits); });
  return longs;
}

// blocks: [{ x, y, z, name }] world coords inside chunk (0..15, 0..15); blockEntities: [{x,y,z,id}]
export function writeWorld(dir, chunks) {
  mkdirSync(join(dir, 'region'), { recursive: true });
  const header = Buffer.alloc(8192), bodies = [];
  let sector = 2;
  for (const { cx, cz, blocks, blockEntities = [] } of chunks) {
    const bySection = new Map();
    for (const b of blocks) {
      const sy = Math.floor(b.y / 16);
      if (!bySection.has(sy)) bySection.set(sy, []);
      bySection.get(sy).push(b);
    }
    const sections = [...bySection].map(([sy, list]) => {
      const palette = ['minecraft:air', ...new Set(list.map(b => b.name))];
      const idx = new Array(4096).fill(0);
      for (const b of list) idx[((b.y - sy * 16) * 16 + (b.z & 15)) * 16 + (b.x & 15)] = palette.indexOf(b.name);
      return T.compound({ Y: T.byte(sy), block_states: T.compound({ palette: T.list(10, palette.map(n => T.compound({ Name: T.string(n) }))), data: T.longArray(packSection(idx, palette.length)) }) });
    });
    const nbt = encodeNBT(T.compound({
      xPos: T.int(cx), zPos: T.int(cz), Status: T.string('minecraft:full'),
      sections: T.list(10, sections),
      block_entities: T.list(10, blockEntities.map(e => T.compound({ id: T.string(e.id), x: T.int(e.x), y: T.int(e.y), z: T.int(e.z) }))),
    }));
    const data = deflateSync(nbt), len = Buffer.alloc(5);
    len.writeUInt32BE(data.length + 1); len[4] = 2;
    let body = Buffer.concat([len, data]);
    const sectors = Math.ceil(body.length / 4096);
    body = Buffer.concat([body, Buffer.alloc(sectors * 4096 - body.length)]);
    const i = 4 * ((cx & 31) + (cz & 31) * 32);
    header[i] = sector >> 16; header[i + 1] = (sector >> 8) & 255; header[i + 2] = sector & 255; header[i + 3] = sectors;
    sector += sectors; bodies.push(body);
  }
  writeFileSync(join(dir, 'region', 'r.0.0.mca'), Buffer.concat([header, ...bodies]));
}
