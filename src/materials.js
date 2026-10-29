// Material lists (what is still missing, as items) and "remaining" structures (only what still has to be built).
import { AIR_NAMES, nbtList } from './nbt.js';
import { gridLookup, cellStatus, CELL } from './analysis.js';

const VOID = 'minecraft:structure_void';
// Cells that are not building material: void = "leave untouched", light = invisible creative block (snapshots read it as air).
const SKIP = new Set([VOID, 'minecraft:light']);
const AIR = 'minecraft:air';
export const SHULKER_STACKS = 27;

// Blocks that never come from an item (or are a side effect of another block).
const NO_ITEM = new Set(['piston_head', 'moving_piston', 'nether_portal', 'end_portal', 'end_gateway', 'fire', 'soul_fire',
  'bubble_column', 'frosted_ice', 'air', 'cave_air', 'void_air', 'structure_void'].map(n => 'minecraft:' + n));

// Block id → item id where they differ (vanilla).
const ITEM_OF = Object.fromEntries(Object.entries({
  redstone_wire: 'redstone', tripwire: 'string', cocoa: 'cocoa_beans', sweet_berry_bush: 'sweet_berries',
  carrots: 'carrot', potatoes: 'potato', beetroots: 'beetroot_seeds', wheat: 'wheat_seeds',
  melon_stem: 'melon_seeds', attached_melon_stem: 'melon_seeds', pumpkin_stem: 'pumpkin_seeds', attached_pumpkin_stem: 'pumpkin_seeds',
  torchflower_crop: 'torchflower_seeds', pitcher_crop: 'pitcher_pod', kelp_plant: 'kelp', bamboo_sapling: 'bamboo',
  cave_vines: 'glow_berries', cave_vines_plant: 'glow_berries', twisting_vines_plant: 'twisting_vines', weeping_vines_plant: 'weeping_vines',
  tall_seagrass: 'seagrass', big_dripleaf_stem: 'big_dripleaf', powder_snow: 'powder_snow_bucket',
  water: 'water_bucket', lava: 'lava_bucket', farmland: 'dirt', dirt_path: 'dirt',
}).map(([k, v]) => ['minecraft:' + k, 'minecraft:' + v]));

// Blocks that cost several items (vanilla + Create, which ATM10 builds with).
const MULTI = {
  'minecraft:water_cauldron': [['minecraft:cauldron', 1], ['minecraft:water_bucket', 1]],
  'minecraft:lava_cauldron': [['minecraft:cauldron', 1], ['minecraft:lava_bucket', 1]],
  'minecraft:powder_snow_cauldron': [['minecraft:cauldron', 1], ['minecraft:powder_snow_bucket', 1]],
  'create:andesite_encased_shaft': [['create:shaft', 1], ['create:andesite_casing', 1]],
  'create:brass_encased_shaft': [['create:shaft', 1], ['create:brass_casing', 1]],
  'create:andesite_encased_cogwheel': [['create:cogwheel', 1], ['create:andesite_casing', 1]],
  'create:brass_encased_cogwheel': [['create:cogwheel', 1], ['create:brass_casing', 1]],
  'create:andesite_encased_large_cogwheel': [['create:large_cogwheel', 1], ['create:andesite_casing', 1]],
  'create:brass_encased_large_cogwheel': [['create:large_cogwheel', 1], ['create:brass_casing', 1]],
  'create:encased_fluid_pipe': [['create:fluid_pipe', 1], ['create:copper_casing', 1]],
  'create:glass_fluid_pipe': [['create:fluid_pipe', 1]],
};
// Parts of multi-block machines without an item of their own.
const CREATE_NO_ITEM = /^create:(mechanical_piston_head|water_wheel_structure|large_water_wheel_structure|belt_funnel_dummy)$/;

const WALL = /^(.*:)(?:(.+)_)?wall_(torch|sign|hanging_sign|banner|head|skull|fan)$/;

// Items needed for one block state: [[item, count], …] (empty for no item).
export function itemsFor(name, props = {}) {
  if (NO_ITEM.has(name) || CREATE_NO_ITEM.test(name)) return [];
  if (MULTI[name]) return MULTI[name].map(([i, n]) => [i, n]);
  // Create belts: one belt connector per belt (counted at its start), shafts sit in start/end/pulley segments.
  if (name === 'create:belt') {
    const out = props.part === 'start' ? [['create:belt_connector', 1]] : [];
    if (props.part && props.part !== 'middle') out.push(['create:shaft', 1]);
    return out;
  }
  const cake = /^minecraft:(?:(.+)_)?candle_cake$/.exec(name);
  if (cake) return [['minecraft:cake', 1], [`minecraft:${cake[1] ? cake[1] + '_' : ''}candle`, 1]];
  if ((name === 'minecraft:water' || name === 'minecraft:lava') && props.level && props.level !== '0') return [];
  if (props.half === 'upper') return [];                                  // doors, tall plants: one item for both halves
  if (/_bed$/.test(name) && props.part === 'head') return [];
  const path = name.slice(name.indexOf(':') + 1);
  const pot = /^(.*:)potted_(.+)$/.exec(name);
  if (pot) return [['minecraft:flower_pot', 1], [pot[1] + pot[2].replace(/^(flowering_)?azalea_bush$/, '$1azalea'), 1]];
  let item = ITEM_OF[name];
  if (!item) { const w = WALL.exec(name); item = w ? `${w[1]}${w[2] ? w[2] + '_' : ''}${w[3]}` : name; }
  let n = 1;
  if (/slab/.test(path) && props.type === 'double') n = 2;
  for (const k of ['candles', 'pickles', 'eggs', 'flower_amount', 'segment_amount']) if (props[k]) n = Number(props[k]) || 1;
  if (name === 'minecraft:snow' && props.layers) n = Number(props.layers) || 1;
  return [[item, n]];
}

export function stackSize(item) {
  if (/_bucket$|_bed$|^minecraft:(cake|totem_of_undying)$|_shulker_box$|^minecraft:shulker_box$/.test(item)) return 1;
  if (/_sign$|_hanging_sign$|_banner$|^minecraft:(armor_stand|egg|snowball|ender_pearl)$/.test(item)) return 16;
  return 64;
}

const isAir = name => AIR_NAMES.has(name);

// One blueprint version (as editable model) against a live grid (+ optional planning base).
// skipCells: world keys "x,y,z" another selected blueprint already accounts for (shared walls count once).
export function blueprintMaterials(model, origin, liveSnap, baseSnap, skipCells = null) {
  const live = gridLookup(liveSnap), base = gridLookup(baseSnap);
  const items = new Map(), removed = new Map();
  const counts = { cells: 0, done: 0, missing: 0, blocked: 0, changed: 0, unknown: 0, clearOpen: 0 };
  const add = (map, key, field, n) => {
    let e = map.get(key);
    if (!e) { e = { needed: 0, planned: 0, built: 0 }; map.set(key, e); }
    e[field] += n;
  };
  for (const [k, cell] of model.cells) {
    if (SKIP.has(cell.name)) continue;
    const [x, y, z] = k.split(',').map(Number), wx = origin[0] + x, wy = origin[1] + y, wz = origin[2] + z;
    if (skipCells && skipCells.has(wx + ',' + wy + ',' + wz)) continue;
    const want = isAir(cell.name) ? AIR : cell.name;
    const s = live ? cellStatus(live, base, wx, wy, wz, want) : CELL.UNKNOWN;
    counts.cells++;
    const now = live && live.inside(wx, wy, wz) ? live.name(wx, wy, wz) : null;
    if (want === AIR) {
      if (s !== CELL.DONE && now && now !== AIR) { counts.clearOpen++; add(removed, now, 'needed', 1); }
      continue;
    }
    const its = itemsFor(cell.name, cell.props);
    for (const [item, n] of its) add(items, item, 'planned', n);
    if (s === CELL.DONE) { counts.done++; for (const [item, n] of its) add(items, item, 'built', n); continue; }
    counts.missing++;
    if (s === CELL.BLOCKED) counts.blocked++;
    if (s === CELL.CHANGED) counts.changed++;
    if (s === CELL.UNKNOWN) counts.unknown++;
    for (const [item, n] of its) add(items, item, 'needed', n);
    if (now && now !== AIR) add(removed, now, 'needed', 1);                // replaced blocks come back as drops
  }
  return { items, removed, counts };
}

// Merge per-blueprint results into one list (with per-blueprint breakdown).
export function mergeMaterials(results) {
  const items = new Map(), removed = new Map();
  const counts = { cells: 0, done: 0, missing: 0, blocked: 0, changed: 0, unknown: 0, clearOpen: 0 };
  for (const { id, result } of results) {
    for (const [k, v] of Object.entries(result.counts)) counts[k] += v;
    for (const [item, e] of result.items) {
      let t = items.get(item);
      if (!t) { t = { needed: 0, planned: 0, built: 0, by: {} }; items.set(item, t); }
      t.needed += e.needed; t.planned += e.planned; t.built += e.built;
      if (e.needed) t.by[id] = e.needed;
    }
    for (const [block, e] of result.removed) removed.set(block, (removed.get(block) || 0) + e.needed);
  }
  return { items, removed, counts };
}

export function materialsReport({ items, removed, counts }, { includeBuilt = false } = {}) {
  const list = [...items].map(([item, e]) => {
    const stack = stackSize(item), stacks = Math.floor(e.needed / stack), rest = e.needed % stack;
    return { item, needed: e.needed, planned: e.planned, built: e.built, stack, stacks, rest, shulkers: Math.round(e.needed / stack / SHULKER_STACKS * 100) / 100, ...(e.by ? { by: e.by } : {}) };
  }).filter(r => includeBuilt || r.needed > 0).sort((a, b) => b.needed - a.needed || a.item.localeCompare(b.item));
  const needed = list.reduce((a, r) => a + r.needed, 0);
  const slots = list.reduce((a, r) => a + Math.ceil(r.needed / r.stack), 0);
  return {
    totals: { needed, kinds: list.filter(r => r.needed).length, stacks: slots, shulkers: Math.ceil(slots / SHULKER_STACKS), ...counts },
    items: list,
    removed: [...removed].map(([block, count]) => ({ block, count })).sort((a, b) => b.count - a.count),
  };
}

const fmtStacks = r => r.stack === 1 ? `${r.needed}` : r.stacks ? `${r.stacks}×${r.stack}${r.rest ? ' + ' + r.rest : ''}` : `${r.rest}`;

export function materialsText(report, title) {
  const t = report.totals;
  const lines = [`# Materialliste: ${title}`,
    `# fehlt: ${t.needed} Items in ${t.kinds} Sorten ≈ ${t.stacks} Stacks ≈ ${t.shulkers} Shulker-Kisten` + (t.blocked ? ` · ${t.blocked} Zellen mit Maschine im Weg` : '') + (t.unknown ? ` · ${t.unknown} Zellen ohne Bestand` : ''),
    '# Anzahl  Stacks        Item'];
  for (const r of report.items) lines.push(`${String(r.needed).padStart(8)}  ${fmtStacks(r).padEnd(12)}  ${r.item}`);
  if (report.removed.length) {
    lines.push('', '# Kommt beim Abreißen/Ersetzen heraus (Blöcke):');
    for (const r of report.removed) lines.push(`${String(r.count).padStart(8)}  ${r.block}`);
  }
  return lines.join('\n') + '\n';
}

export function materialsCsv(report) {
  const rows = [['Item', 'Fehlt', 'Stacks', 'Geplant', 'Gebaut', 'Shulker']];
  for (const r of report.items) rows.push([r.item, r.needed, fmtStacks(r), r.planned, r.built, String(r.shulkers).replace('.', ',')]);
  return '﻿' + rows.map(r => r.join(';')).join('\r\n') + '\r\n';
}

// Copy of the model with only the cells that still need work, same size and origin as the full blueprint.
// Left-out cells are simply missing: vanilla structure blocks leave them alone, Create's Schematicannon reads them
// as air and only acts on air in "Replace Solid with Empty" mode (then it would clear them too). So demolition
// (clear) is opt-in and meant for structure blocks. Entities are dropped, they would be placed again on every print.
export function remainingModel(model, origin, liveSnap, baseSnap, { clear = false, skipBlocked = true, skipChanged = false } = {}) {
  const live = gridLookup(liveSnap), base = gridLookup(baseSnap);
  const cells = new Map();
  const stats = { kept: 0, place: 0, clear: 0, done: 0, skippedBlocked: 0, skippedChanged: 0, skippedClear: 0, unknown: 0,
    droppedEntities: model.rest.entities?.v?.items?.length || 0 };
  for (const [k, cell] of model.cells) {
    if (SKIP.has(cell.name)) continue;
    const [x, y, z] = k.split(',').map(Number);
    const want = isAir(cell.name) ? AIR : cell.name;
    const s = live ? cellStatus(live, base, origin[0] + x, origin[1] + y, origin[2] + z, want) : CELL.UNKNOWN;
    if (s === CELL.DONE) { stats.done++; continue; }
    if (s === CELL.BLOCKED && skipBlocked) { stats.skippedBlocked++; continue; }
    if (s === CELL.CHANGED && skipChanged) { stats.skippedChanged++; continue; }
    if (want === AIR && !clear) { stats.skippedClear++; continue; }
    if (s === CELL.UNKNOWN) stats.unknown++;
    cells.set(k, cell);
    stats.kept++;
    if (want === AIR) stats.clear++; else stats.place++;
  }
  return { model: { ...model, rest: { ...model.rest, entities: nbtList(10, []) }, cells }, stats };
}
