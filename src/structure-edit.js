// Editable model of a structure NBT plus the edit operations agents use.
// Untouched data (block-entity NBT, entities, DataVersion, extra root tags) survives a round trip.
import { gzipSync } from 'node:zlib';
import { parseTyped, encodeTyped, decodeMaybeCompressed, nbtInt, nbtString, nbtList, nbtCompound } from './nbt.js';
import { HttpError } from './auth.js';

const AIR = 'minecraft:air';
const MAX_AXIS = 512;
const MAX_CELLS_PER_REQUEST = 4_000_000;
const NAME_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

const stateKey = (name, props) => props && Object.keys(props).length
  ? name + '[' + Object.keys(props).sort().map(k => `${k}=${props[k]}`).join(',') + ']' : name;
const cellKey = (x, y, z) => `${x},${y},${z}`;

export function loadModel(bytes) {
  const { name, root } = parseTyped(decodeMaybeCompressed(Buffer.from(bytes)));
  const c = root.v;
  const paletteNode = c.palette || (c.palettes && c.palettes.v.items[0]);
  if (!c.size || !paletteNode || !c.blocks) throw new HttpError(422, 'Keine Vanilla-/Create-Structure (size, palette, blocks fehlen).');
  const size = c.size.v.items.map(n => n.v);
  const palette = paletteNode.v.items.map(n => {
    const props = {};
    if (n.v.Properties) for (const [k, pv] of Object.entries(n.v.Properties.v)) props[k] = String(pv.v);
    return { name: n.v.Name.v, props };
  });
  const cells = new Map();
  for (const b of c.blocks.v.items) {
    const pos = b.v.pos.v.items.map(n => n.v), st = palette[b.v.state.v];
    cells.set(cellKey(...pos), { name: st.name, props: st.props, nbt: b.v.nbt || null });
  }
  const rest = { ...c };
  delete rest.size; delete rest.palette; delete rest.palettes; delete rest.blocks;
  return { rootName: name, rest, size, cells };
}

export function serializeModel(model) {
  const states = new Map(), paletteItems = [], blockItems = [];
  const entries = [...model.cells.entries()].map(([k, v]) => [k.split(',').map(Number), v])
    .sort((a, b) => a[0][1] - b[0][1] || a[0][2] - b[0][2] || a[0][0] - b[0][0]);
  for (const [pos, cell] of entries) {
    const sk = stateKey(cell.name, cell.props);
    let idx = states.get(sk);
    if (idx === undefined) {
      idx = paletteItems.length; states.set(sk, idx);
      const comp = { Name: nbtString(cell.name) };
      if (cell.props && Object.keys(cell.props).length) comp.Properties = nbtCompound(Object.fromEntries(Object.entries(cell.props).map(([k, v]) => [k, nbtString(String(v))])));
      paletteItems.push(nbtCompound(comp));
    }
    const b = { pos: nbtList(3, pos.map(nbtInt)), state: nbtInt(idx) };
    if (cell.nbt) b.nbt = cell.nbt;
    blockItems.push(nbtCompound(b));
  }
  const root = nbtCompound({
    ...model.rest,
    size: nbtList(3, model.size.map(nbtInt)),
    palette: nbtList(10, paletteItems),
    blocks: nbtList(10, blockItems),
    ...(model.rest.entities ? {} : { entities: nbtList(10, []) }),
    ...(model.rest.DataVersion ? {} : { DataVersion: nbtInt(3955) }),
  });
  return gzipSync(encodeTyped(model.rootName || '', root));
}

export function emptyModel(size) {
  checkSize(size);
  return { rootName: '', rest: {}, size: [...size], cells: new Map() };
}

function checkSize(size) {
  if (!Array.isArray(size) || size.length !== 3 || !size.every(n => Number.isInteger(n) && n > 0 && n <= MAX_AXIS)) {
    throw new HttpError(400, `size muss [x,y,z] mit 1…${MAX_AXIS} sein.`);
  }
}

const globToRe = g => new RegExp('^' + String(g).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');

// ops: see /docs. coords 'local' (relative to structure) or 'world' (absolute, origin is subtracted).
export function applyEdits(model, origin, ops, { coords = 'local', grow = false, knownNames } = {}) {
  if (!Array.isArray(ops) || !ops.length) throw new HttpError(400, 'edits muss eine nicht leere Liste sein.');
  if (ops.length > 10_000) throw new HttpError(400, 'Maximal 10.000 Operationen pro Anfrage.');
  const off = coords === 'world' ? origin : [0, 0, 0];
  const stats = { set: 0, cleared: 0, voided: 0, unchanged: 0, cellsTouched: 0 };
  const warnings = new Set();
  let budget = MAX_CELLS_PER_REQUEST;
  const toLocal = (p, label, i) => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isInteger)) throw new HttpError(400, `Operation ${i}: ${label} muss [x,y,z] (ganze Zahlen) sein.`);
    return [p[0] - off[0], p[1] - off[1], p[2] - off[2]];
  };
  const inside = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < model.size[0] && y < model.size[1] && z < model.size[2];
  const checkBlock = (name, i) => {
    if (typeof name !== 'string' || !NAME_RE.test(name)) throw new HttpError(400, `Operation ${i}: Blockname "${name}" ist ungültig (erwartet namespace:name).`);
    if (knownNames && name !== AIR && !knownNames.has(name)) warnings.add(`Block ${name} ist weder in der Welt noch in einem Bauplan bekannt – Tippfehler?`);
  };
  const props = (p, i) => {
    if (p == null) return {};
    if (typeof p !== 'object' || Array.isArray(p)) throw new HttpError(400, `Operation ${i}: properties muss ein Objekt sein.`);
    return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));
  };
  const write = (x, y, z, cell, i) => {
    if (--budget < 0) throw new HttpError(400, `Zu viele Zellen in einer Anfrage (max. ${MAX_CELLS_PER_REQUEST}).`);
    if (!grow && !inside(x, y, z)) throw new HttpError(400, `Operation ${i}: Zelle ${x + off[0]},${y + off[1]},${z + off[2]} liegt außerhalb des Bauplans (Größe ${model.size.join('×')}). Mit "grow": true wird der Bauplan erweitert.`);
    const k = cellKey(x, y, z), prev = model.cells.get(k);
    stats.cellsTouched++;
    if (!cell) { if (prev) { model.cells.delete(k); stats.voided++; } else stats.unchanged++; return; }
    if (prev && prev.name === cell.name && stateKey(prev.name, prev.props) === stateKey(cell.name, cell.props)) { stats.unchanged++; return; }
    model.cells.set(k, { ...cell, nbt: null });
    if (cell.name === AIR) stats.cleared++; else stats.set++;
  };
  const box = (op, i) => {
    const a = toLocal(op.from, 'from', i), b = toLocal(op.to, 'to', i);
    const lo = a.map((v, j) => Math.min(v, b[j])), hi = a.map((v, j) => Math.max(v, b[j]));
    const vol = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    if (vol > MAX_CELLS_PER_REQUEST) throw new HttpError(400, `Operation ${i}: Bereich zu groß (${vol} Zellen).`);
    return { lo, hi };
  };
  const each = ({ lo, hi }, fn) => { for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) for (let x = lo[0]; x <= hi[0]; x++) fn(x, y, z); };

  ops.forEach((op, i) => {
    switch (op?.op) {
      case 'set': {
        checkBlock(op.block, i);
        const [x, y, z] = toLocal(op.pos, 'pos', i);
        write(x, y, z, { name: op.block, props: props(op.properties, i) }, i);
        break;
      }
      case 'setMany': {
        if (!Array.isArray(op.blocks)) throw new HttpError(400, `Operation ${i}: blocks fehlt.`);
        for (const b of op.blocks) { checkBlock(b.block, i); const [x, y, z] = toLocal(b.pos, 'pos', i); write(x, y, z, { name: b.block, props: props(b.properties, i) }, i); }
        break;
      }
      case 'fill': {
        checkBlock(op.block, i);
        const r = box(op, i), cell = { name: op.block, props: props(op.properties, i) }, mode = op.mode || 'all';
        const match = op.match ? globToRe(op.match) : null;
        if (!['all', 'hollow', 'outline', 'keep', 'replace'].includes(mode)) throw new HttpError(400, `Operation ${i}: mode muss all|hollow|outline|keep|replace sein.`);
        if (mode === 'replace' && !match) throw new HttpError(400, `Operation ${i}: mode "replace" braucht match.`);
        each(r, (x, y, z) => {
          const shell = x === r.lo[0] || x === r.hi[0] || y === r.lo[1] || y === r.hi[1] || z === r.lo[2] || z === r.hi[2];
          const prev = model.cells.get(cellKey(x, y, z));
          if (mode === 'all') write(x, y, z, cell, i);
          else if (mode === 'hollow') write(x, y, z, shell ? cell : { name: AIR, props: {} }, i);
          else if (mode === 'outline') { if (shell) write(x, y, z, cell, i); }
          else if (mode === 'keep') { if (!prev) write(x, y, z, cell, i); }
          else if (prev && match.test(prev.name)) write(x, y, z, cell, i);
        });
        break;
      }
      case 'replace': {
        checkBlock(op.block, i);
        if (!op.match) throw new HttpError(400, `Operation ${i}: match fehlt (Blockname, * als Platzhalter).`);
        const re = globToRe(op.match), r = op.from && op.to ? box(op, i) : null;
        for (const [k, prev] of [...model.cells]) {
          if (!re.test(prev.name)) continue;
          const [x, y, z] = k.split(',').map(Number);
          if (r && (x < r.lo[0] || x > r.hi[0] || y < r.lo[1] || y > r.hi[1] || z < r.lo[2] || z > r.hi[2])) continue;
          write(x, y, z, { name: op.block, props: op.keepProperties ? prev.props : props(op.properties, i) }, i);
        }
        break;
      }
      case 'clear': each(box(op, i), (x, y, z) => write(x, y, z, { name: AIR, props: {} }, i)); break;
      case 'void': each(box(op, i), (x, y, z) => write(x, y, z, null, i)); break;
      case 'copy': {
        const r = box(op, i), d = toLocal(op.dest, 'dest', i), src = [];
        each(r, (x, y, z) => src.push([x - r.lo[0], y - r.lo[1], z - r.lo[2], model.cells.get(cellKey(x, y, z))]));
        for (const [dx, dy, dz, cell] of src) if (cell || op.includeVoid) write(d[0] + dx, d[1] + dy, d[2] + dz, cell ? { name: cell.name, props: cell.props } : null, i);
        break;
      }
      default: throw new HttpError(400, `Operation ${i}: unbekanntes op "${op?.op}". Erlaubt: set, setMany, fill, replace, clear, void, copy.`);
    }
  });

  let originShift = [0, 0, 0];
  if (grow) {
    const lo = [0, 0, 0], hi = model.size.map(n => n - 1);
    for (const k of model.cells.keys()) { const p = k.split(',').map(Number); for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], p[j]); hi[j] = Math.max(hi[j], p[j]); } }
    const size = hi.map((h, j) => h - lo[j] + 1);
    checkSize(size);
    if (lo.some(v => v < 0)) {
      const moved = new Map();
      for (const [k, v] of model.cells) { const p = k.split(',').map(Number); moved.set(cellKey(p[0] - lo[0], p[1] - lo[1], p[2] - lo[2]), v); }
      model.cells = moved;
    }
    originShift = lo;
    model.size = size;
  }
  return { stats, warnings: [...warnings], originShift };
}

// Human/LLM-readable layer view. One char per palette entry, '.' = air (abreißen), ' ' = nicht angefasst.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+=?@^~<>/|';
export function layersText({ title, origin, size, get, yFrom, yTo, coords }) {
  const legend = new Map();
  const charOf = name => {
    if (!legend.has(name)) legend.set(name, legend.size < CHARS.length ? CHARS[legend.size] : '!');
    return legend.get(name);
  };
  const out = [];
  const ox = coords === 'world' ? origin[0] : 0, oz = coords === 'world' ? origin[2] : 0, oy = coords === 'world' ? origin[1] : 0;
  for (let y = yFrom; y <= yTo; y++) {
    out.push(`--- y=${y + oy}${coords === 'world' ? '' : ' (lokal)'}  Zeilen: z ${oz}…${oz + size[2] - 1} (Norden oben), Spalten: x ${ox}…${ox + size[0] - 1} (Westen links)`);
    for (let z = 0; z < size[2]; z++) {
      let row = '';
      for (let x = 0; x < size[0]; x++) {
        const n = get(x, y, z);
        row += n === undefined || n === null ? ' ' : n === AIR ? '.' : charOf(n);
      }
      out.push(row.replace(/\s+$/, '') || '');
    }
  }
  const head = [`# ${title}`, `# origin ${origin.join(',')} · size ${size.join('×')} · Legende: "." = Luft/abreißen, " " = unverändert/nicht im Plan`];
  for (const [n, ch] of legend) head.push(`# ${ch} = ${n}`);
  return head.join('\n') + '\n' + out.join('\n') + '\n';
}
