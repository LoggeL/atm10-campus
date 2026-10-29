// Resolves block names to a render style: real average colour (from the modpack's textures) and a material class
// that picks one of the generated detail textures.
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const table = JSON.parse(gunzipSync(readFileSync(new URL('./data-texture-colors.json.gz', import.meta.url))).toString());
const byNamespace = new Map();
for (const key of Object.keys(table)) {
  const [ns, path] = key.split(':');
  if (!byNamespace.has(ns)) byNamespace.set(ns, []);
  byNamespace.get(ns).push(path);
}

export const MATERIALS = ['stone', 'cobble', 'bricks', 'tiles', 'smooth', 'planks', 'log', 'leaves', 'dirt', 'grass', 'sand', 'metal', 'machine', 'crystal', 'wool', 'water', 'lamp', 'plant', 'glass'];

const RULES = [
  ['water', /(^|_)water$|bubble_column/],
  ['glass', /glass/],
  ['leaves', /leaves|leaf_|hedge/],
  ['lamp', /lamp|lantern|glowstone|froglight|shroomlight|torch|light$|_light_|candle/],
  ['plant', /(short|tall|medium|windswept)_grass$|^grass$|fern|flower|tulip|poppy|dandelion|sapling|bush$|seagrass|vine|crop|wheat|carrots|potatoes|coneflower|lily|rose|daisy|orchid|allium|bluet|clover|sprout|shrub|branch/],
  ['grass', /grass_block|moss|mycelium|podzol/],
  ['crystal', /_ore$|ore_|crystal|amethyst|diamond_block|emerald_block|lapis|gem|certus|fluix|budding/],
  ['machine', /machine|generator|furnace|smelter|crusher|controller|drive|interface|terminal|provider|assembler|press|mixer|reactor|turbine|casing|panel|cell|pipe|cable|conduit|tank|chamber|core|injector|stabilizer|solar|battery|charger|accumulator|computer|monitor|hopper|bus|port|valve|engine|pump|fabricator|infuser|enricher|purifier|combiner|centrifuge|grinder|condenser|energy|flux|accelerator|quantum|matter|pattern|crafter|altar|pedestal|structure_block/],
  ['wool', /wool|carpet|_bed$|banner/],
  ['metal', /iron|steel|copper|gold|metal|bronze|alumin|tin_|lead_|silver|netherite|_bars|anvil|rail|chain|scaffold/],
  ['log', /_log$|_stem$|bark|hyphae|_wood$/],
  ['planks', /plank|bookshelf|chest|barrel|crate|table|shelf|ladder|oak_|spruce_|birch_|jungle_|acacia_|dark_oak_|mangrove_|cherry_|bamboo|crimson_|warped_|maple_|wooden/],
  ['bricks', /brick/],
  ['cobble', /cobble/],
  ['tiles', /tile|cut_|chiseled|pillar|paving|diagonal|polished|smooth_stone/],
  ['sand', /sand|gravel|clay|soul_soil|silt|ash/],
  ['dirt', /dirt|mud|farmland|path|soil|peat|soul_|rooted/],
  ['smooth', /smooth|concrete|quartz|calcite|terracotta|glazed|plaster|marble|white|block$/],
];

const SUFFIXES = ['_connecting', '_stairs', '_slab', '_wall', '_fence_gate', '_fence', '_pressure_plate', '_button', '_trapdoor', '_door', '_pane', '_panel', '_carpet', '_vertical'];

function lookupColor(name) {
  const [ns, path] = name.split(':');
  const tries = [path, `${path}_side`, `${path}_top`, `${path}_front`, `${path}_0`, `block/${path}`];
  let base = path;
  for (const s of SUFFIXES) if (base.endsWith(s)) base = base.slice(0, -s.length);
  if (base !== path) tries.push(base, base + 's', base + '_planks', base + '_block', base.replace(/_brick$/, '_bricks'), base.replace(/_tile$/, '_tiles'));
  for (const t of tries) { const c = table[`${ns}:${t}`]; if (c) return c; }
  // Same namespace, best token overlap ("blackstone_diagonal_bricks" ~ "blackstone/diagonal_bricks").
  const tokens = new Set(base.split(/[_/]/).filter(Boolean));
  let best = null, bestScore = 0;
  for (const p of byNamespace.get(ns) || []) {
    const pt = p.split(/[_/]/).filter(Boolean);
    let score = 0;
    for (const t of pt) if (tokens.has(t)) score++;
    score -= Math.abs(pt.length - tokens.size) * 0.1;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  if (best && bestScore >= Math.max(1, tokens.size * 0.6)) return table[`${ns}:${best}`];
  // Vanilla fallback for modded variants of vanilla materials.
  if (ns !== 'minecraft') for (const t of [base, base + 's', base + '_block']) { const c = table[`minecraft:${t}`]; if (c) return c; }
  return null;
}

function hashColor(name) {
  let h = 2166136261;
  for (const ch of name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const hue = (h >>> 0) % 360, s = 0.25, l = 0.55;
  const k = n => (n + hue / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255), 255];
}

const cache = new Map();
export function blockStyle(name) {
  let s = cache.get(name);
  if (s) return s;
  const path = name.split(':')[1] || name;
  const material = (RULES.find(([, re]) => re.test(path)) || ['stone'])[0];
  const color = lookupColor(name) || hashColor(name);
  // Foliage textures are grey and tinted by biome in game; use a temperate green.
  const grey = Math.max(...color.slice(0, 3)) - Math.min(...color.slice(0, 3)) < 18;
  const FOLIAGE = [86, 140, 58];
  let rgb = color.slice(0, 3), top = null;
  if ((material === 'leaves' || material === 'plant') && grey) rgb = rgb.map((v, i) => Math.round(v / 160 * FOLIAGE[i]));
  if (material === 'grass') top = /podzol/.test(path) ? [92, 66, 40] : /mycelium/.test(path) ? [112, 96, 112] : FOLIAGE;
  s = {
    color: rgb,
    top,
    material,
    translucent: material === 'glass' || material === 'water' || material === 'leaves' || material === 'plant',
    emissive: material === 'lamp' || /glowstone|sea_lantern|froglight|shroomlight|redstone_lamp|beacon/.test(path),
  };
  cache.set(name, s);
  return s;
}
