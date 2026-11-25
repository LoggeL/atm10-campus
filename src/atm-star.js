import { createHash } from 'node:crypto';
import { now } from './db.js';
import {
  ATM_STAR_GOAL,
  NETHER_STARS_PER_STAR,
  atmStar,
  atmStarBlock,
  atmStarItemRequirements,
  atmStarPartMeta,
  atmStarParts,
  atmStarStockRules,
  modInfo,
  netherStarStock,
  starryBeeRoadmap,
} from './atm-star-recipes.js';
import iconAtlas from './atm-star-icons.json' with { type: 'json' };

const revision = createHash('sha256').update(JSON.stringify(atmStarStockRules)).digest('hex').slice(0, 16);
export const atmStarStockRequest = { revision, rules: atmStarStockRules };

const iconIndex = new Map(iconAtlas.keys.map((key, index) => [key, index]));
const rulesByKey = new Map(atmStarStockRules.map(rule => [rule.key, rule]));

const NETHER_3X_KEY = 'allthecompressed:nether_star_block_3x';
const NETHER_2X_KEY = 'allthecompressed:nether_star_block_2x';
const HISTORY_KEEP = 500;
const HISTORY_MIN_INTERVAL_MS = 10 * 60_000;
const HISTORY_READ_LIMIT = 48;
const RATE_WINDOW_MS = 24 * 60 * 60_000;
const MIN_RATE_ELAPSED_MS = 60_000;

const MILESTONE_DEFS = [
  { id: '1', goalStars: 1, mode: 'next', label: 'Nächster Star', shortLabel: 'Nächster Star (1)' },
  { id: '9', goalStars: 9, mode: 'target', label: '1. ATM Star Block', shortLabel: '1. Block (9)' },
  { id: '18', goalStars: 18, mode: 'target', label: 'Starry Bee', shortLabel: 'Starry Bee (18)' },
];

const round1 = value => Math.round(value * 10) / 10;

function rawRuleOf(key) {
  const rule = rulesByKey.get(key);
  if (!rule) return null;
  const out = {};
  if (rule.components !== undefined) out.components = rule.components;
  if (rule.displayName !== undefined) out.displayName = rule.displayName;
  if (rule.excludedName !== undefined) out.excludedName = rule.excludedName;
  return Object.keys(out).length ? out : null;
}

function requirementsOf(key) {
  return atmStarItemRequirements[key] ? atmStarItemRequirements[key].map(req => ({ ...req })) : [];
}

function availableStarsOf(counts) {
  return (counts[atmStar.key] ?? 0) + 9 * (counts[atmStarBlock.key] ?? 0);
}

function netherTotalOf(counts) {
  return netherStarStock.reduce((sum, tier) => sum + (counts[tier.key] ?? 0) * tier.units, 0);
}

function computeNetherStarSummary(counts, remainingStars, ratePerHour = null) {
  const hasStock = counts !== null;
  const needed3x = remainingStars * 15;
  const neededNetherStars = remainingStars * NETHER_STARS_PER_STAR;
  const tiers = netherStarStock.map(({ key, id, label, units }) => {
    const inMe = hasStock ? (counts[key] ?? 0) : null;
    return {
      key,
      id,
      label,
      units,
      icon: iconIndex.get(key) ?? null,
      mod: modInfo(id),
      inMe,
      equivalentNetherStars: hasStock ? inMe * units : null,
    };
  });

  if (!hasStock) {
    return {
      tiers,
      totalEquivalent: null,
      neededNetherStars,
      missingNetherStars: neededNetherStars,
      coveragePct: null,
      direct3x: null,
      direct2x: null,
      compressible2xFromLower: null,
      compressible3xFromLower: null,
      effective2xAvailable: null,
      effective3xAvailable: null,
      needed3x,
      missing3xEffective: needed3x,
      lowerThan3xUnits: null,
      ratePerHour: null,
      etaHours: null,
    };
  }

  const c0 = counts[netherStarStock[0].key] ?? 0;
  const c1 = counts[netherStarStock[1].key] ?? 0;
  const c2 = counts[netherStarStock[2].key] ?? 0;
  const c3 = counts[netherStarStock[3].key] ?? 0;
  const c4 = counts[netherStarStock[4].key] ?? 0;

  const lowerThan2xUnits = c0 + c1 * 9 + c2 * 81;
  const lowerThan3xUnits = lowerThan2xUnits + c3 * 729;
  const totalEquivalent = lowerThan3xUnits + c4 * 6561;
  const compressible2xFromLower = Math.floor(lowerThan2xUnits / 729);
  const compressible3xFromLower = Math.floor(lowerThan3xUnits / 6561);
  const effective2xAvailable = c3 + compressible2xFromLower;
  const effective3xAvailable = c4 + compressible3xFromLower;
  const missingNetherStars = Math.max(0, neededNetherStars - totalEquivalent);
  const missing3xEffective = Math.max(0, needed3x - effective3xAvailable);
  const coveragePct = neededNetherStars === 0
    ? 100
    : round1(Math.min(100, (totalEquivalent / neededNetherStars) * 100));
  const etaHours = missingNetherStars === 0
    ? 0
    : ratePerHour !== null && ratePerHour > 0
      ? round1(missingNetherStars / ratePerHour)
      : null;

  return {
    tiers,
    totalEquivalent,
    neededNetherStars,
    missingNetherStars,
    coveragePct,
    direct3x: c4,
    direct2x: c3,
    compressible2xFromLower,
    compressible3xFromLower,
    effective2xAvailable,
    effective3xAvailable,
    needed3x,
    missing3xEffective,
    lowerThan3xUnits,
    ratePerHour,
    etaHours,
  };
}

function canCraftStars(counts, k) {
  if (k <= 0) return true;
  const available = { ...counts };
  const partMissing = atmStarParts.map(part => {
    let missing = k * part.count;
    for (const { key } of part.options) {
      const take = Math.min(missing, available[key] ?? 0);
      available[key] = (available[key] ?? 0) - take;
      missing -= take;
    }
    return missing;
  });

  // Part 0 (Nether Star Block 3x) can compress any lower Nether Star tier.
  const lowerUnits =
    (available[netherStarStock[0].key] ?? 0)
    + (available[netherStarStock[1].key] ?? 0) * 9
    + (available[netherStarStock[2].key] ?? 0) * 81
    + (available[netherStarStock[3].key] ?? 0) * 729;
  if (lowerUnits < partMissing[0] * 6561) return false;

  for (let i = 1; i < atmStarParts.length; i++) {
    const batches = partMissing[i];
    if (batches === 0) continue;
    for (const ingredient of atmStarParts[i].ingredients) {
      let missing = batches * ingredient.count;
      for (const { key } of ingredient.options) {
        const take = Math.min(missing, available[key] ?? 0);
        available[key] = (available[key] ?? 0) - take;
        missing -= take;
      }
      if (missing > 0) return false;
    }
  }
  return true;
}

function computeStarsCraftable(counts) {
  if (!counts) return { fromParts: null, withSubParts: null };
  const fromParts = Math.min(
    ...atmStarParts.map(part => {
      const stock = part.options.reduce((sum, opt) => sum + (counts[opt.key] ?? 0), 0);
      return Math.floor(stock / part.count);
    }),
  );
  const maxByNetherStars = Math.floor(netherTotalOf(counts) / NETHER_STARS_PER_STAR);
  if (maxByNetherStars <= fromParts) return { fromParts, withSubParts: fromParts };

  let lo = fromParts;
  let hi = Math.min(maxByNetherStars, 1_000_000);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (canCraftStars(counts, mid)) lo = mid;
    else hi = mid - 1;
  }
  return { fromParts, withSubParts: lo };
}

function buildHistorySummary(stock, historyRows, missingNetherStarsForGoal) {
  const hasStock = stock !== null;
  if (!hasStock) {
    return {
      sampleCount: 0,
      since: null,
      previousAt: null,
      deltas: {},
      netherStarDelta: null,
      netherStarRatePerHour: null,
      netherStarEtaHours: null,
      points: [],
    };
  }

  const normalized = (Array.isArray(historyRows) ? historyRows : [])
    .filter(row => row && row.counts && typeof row.counts === 'object')
    .map(row => ({ at: row.at, counts: row.counts }));

  if (!normalized.length && stock.at) {
    normalized.push({ at: stock.at, counts: stock.counts });
  }

  const points = normalized.map(row => ({
    at: row.at,
    netherStarCount: netherTotalOf(row.counts),
    availableStars: availableStarsOf(row.counts),
  }));

  if (normalized.length < 2) {
    return {
      sampleCount: normalized.length,
      since: normalized[0]?.at ?? stock.at ?? null,
      previousAt: null,
      deltas: {},
      netherStarDelta: null,
      netherStarRatePerHour: null,
      netherStarEtaHours: null,
      points,
    };
  }

  const latestRow = normalized[normalized.length - 1];
  const prevRow = normalized[normalized.length - 2];
  const deltas = {};
  for (const { key } of atmStarStockRules) {
    const diff = (latestRow.counts[key] ?? 0) - (prevRow.counts[key] ?? 0);
    if (diff !== 0) deltas[key] = diff;
  }

  const latestPoint = points[points.length - 1];
  const prevPoint = points[points.length - 2];
  const netherStarDelta = latestPoint.netherStarCount - prevPoint.netherStarCount;

  const latestMs = Date.parse(latestPoint.at);
  let basePoint = null;
  if (Number.isFinite(latestMs)) {
    for (let i = 0; i < points.length - 1; i++) {
      const ms = Date.parse(points[i].at);
      if (Number.isFinite(ms) && latestMs - ms <= RATE_WINDOW_MS && latestMs - ms >= MIN_RATE_ELAPSED_MS) {
        basePoint = points[i];
        break;
      }
    }
    if (!basePoint) {
      const prevMs = Date.parse(prevPoint.at);
      if (Number.isFinite(prevMs) && latestMs - prevMs >= MIN_RATE_ELAPSED_MS) {
        basePoint = prevPoint;
      }
    }
  }

  let netherStarRatePerHour = null;
  let netherStarEtaHours = null;
  if (basePoint) {
    const elapsedMs = latestMs - Date.parse(basePoint.at);
    if (elapsedMs >= MIN_RATE_ELAPSED_MS) {
      const diff = latestPoint.netherStarCount - basePoint.netherStarCount;
      netherStarRatePerHour = round1(diff / (elapsedMs / 3_600_000));
      if (missingNetherStarsForGoal === 0) netherStarEtaHours = 0;
      else if (netherStarRatePerHour > 0) netherStarEtaHours = round1(missingNetherStarsForGoal / netherStarRatePerHour);
    }
  }

  return {
    sampleCount: normalized.length,
    since: normalized[0].at,
    previousAt: prevRow.at,
    deltas,
    netherStarDelta,
    netherStarRatePerHour,
    netherStarEtaHours,
    points,
  };
}

function projectMilestone(def, stock, deltas, ratePerHour) {
  const hasStock = stock !== null;
  const counts = hasStock ? stock.counts : null;
  const available = hasStock ? { ...counts } : {};
  const availableStars = hasStock ? availableStarsOf(counts) : null;
  const completedForGoal = hasStock
    ? (def.mode === 'next' ? 0 : Math.min(def.goalStars, availableStars))
    : null;
  const remainingStars = def.mode === 'next'
    ? def.goalStars
    : hasStock
      ? Math.max(0, def.goalStars - availableStars)
      : def.goalStars;

  const netherStarSummary = computeNetherStarSummary(counts, remainingStars, ratePerHour);

  function allocate({ count, options }, batches) {
    const needed = batches * count;
    let missing = needed;
    const alternatives = options.map(({ key, id, label }) => {
      const inMe = hasStock ? (counts[key] ?? 0) : null;
      const allocated = hasStock ? Math.min(missing, available[key] ?? 0) : 0;
      if (hasStock) available[key] = (available[key] ?? 0) - allocated;
      missing -= allocated;
      const requirements = requirementsOf(key);
      return {
        key,
        id,
        label,
        icon: iconIndex.get(key) ?? null,
        mod: modInfo(id),
        inMe,
        allocated,
        delta: hasStock && Object.hasOwn(deltas, key) ? deltas[key] : null,
        requirements,
        rawRule: rawRuleOf(key),
      };
    });
    return { perRecipe: count, needed, missing, alternatives };
  }

  // Finished parts are committed first. Ingredients can use only the remaining stock.
  const allocatedParts = atmStarParts.map(part => allocate(part, remainingStars));
  const rawGroups = allocatedParts.map((part, index) => ({
    ...part,
    totalForGoal: def.goalStars * part.perRecipe,
    ingredients: atmStarParts[index].ingredients.map(ingredient => ({
      ...allocate(ingredient, part.missing),
      totalForGoal: def.goalStars * part.perRecipe * ingredient.count,
    })),
  }));

  // Track cross-part ingredient usage so shared pools (e.g. piglich_heart_block) are surfaced cleanly.
  const usageMap = new Map();
  for (let pIndex = 0; pIndex < rawGroups.length; pIndex++) {
    const part = rawGroups[pIndex];
    const partOpt = part.alternatives[0];
    for (const ing of part.ingredients) {
      const slotKey = ing.alternatives.map(a => a.key).join('|');
      let entry = usageMap.get(slotKey);
      if (!entry) {
        entry = {
          slotKey,
          options: ing.alternatives,
          totalPerStar: 0,
          totalForGoal: 0,
          totalNeeded: 0,
          consumers: [],
        };
        usageMap.set(slotKey, entry);
      }
      const perStar = part.perRecipe * ing.perRecipe;
      const allocatedTotal = ing.alternatives.reduce((sum, a) => sum + a.allocated, 0);
      entry.totalPerStar += perStar;
      entry.totalForGoal += ing.totalForGoal;
      entry.totalNeeded += ing.needed;
      entry.consumers.push({
        partKey: partOpt.key,
        partId: partOpt.id,
        partLabel: partOpt.label,
        partIcon: partOpt.icon,
        perRecipe: ing.perRecipe,
        perStar,
        needed: ing.needed,
        allocated: allocatedTotal,
        missing: ing.missing,
      });
    }
  }

  const sharedPoolsBySlot = new Map();
  const sharedPools = [];
  for (const entry of usageMap.values()) {
    if (entry.consumers.length <= 1) continue;
    const primary = entry.options[0];
    const inStock = hasStock
      ? entry.options.reduce((sum, a) => sum + (counts[a.key] ?? 0), 0)
      : null;
    const missing = hasStock ? Math.max(0, entry.totalNeeded - inStock) : entry.totalNeeded;
    const coveragePct = !hasStock
      ? null
      : entry.totalNeeded === 0
        ? 100
        : round1(Math.min(100, (inStock / entry.totalNeeded) * 100));
    const pool = {
      key: entry.slotKey,
      id: primary.id,
      label: entry.options.map(o => o.label).join(' oder '),
      icon: primary.icon,
      mod: primary.mod,
      perStar: entry.totalPerStar,
      totalForGoal: entry.totalForGoal,
      totalNeeded: entry.totalNeeded,
      inStock,
      missing,
      coveragePct,
      consumersCount: entry.consumers.length,
      consumers: entry.consumers,
    };
    sharedPoolsBySlot.set(entry.slotKey, pool);
    sharedPools.push(pool);
  }

  // Enrich each part and its ingredients with craftability, readiness, compression rollup, and metadata.
  const parts = rawGroups.map(part => {
    const primary = part.alternatives[0];
    const meta = atmStarPartMeta[primary.key] ?? { station: 'Werkbank', stationDetail: '', category: 'Komponenten' };
    const isNether3x = primary.key === NETHER_3X_KEY;
    const directInMe = hasStock ? part.alternatives.reduce((sum, a) => sum + (a.inMe ?? 0), 0) : null;
    const directAllocated = part.alternatives.reduce((sum, a) => sum + a.allocated, 0);

    const enrichedIngredients = part.ingredients.map(ing => {
      const slotKey = ing.alternatives.map(a => a.key).join('|');
      const ingPrimary = ing.alternatives[0];
      const inMe = hasStock ? ing.alternatives.reduce((sum, a) => sum + (a.inMe ?? 0), 0) : null;
      const allocated = ing.alternatives.reduce((sum, a) => sum + a.allocated, 0);
      const isNether2x = isNether3x && ingPrimary.key === NETHER_2X_KEY;
      const compressibleFromLower = hasStock && isNether2x ? netherStarSummary.compressible2xFromLower : 0;
      const effectiveInMe = !hasStock ? null : isNether2x ? netherStarSummary.effective2xAvailable : inMe;
      const effectiveMissing = !hasStock
        ? ing.needed
        : isNether2x
          ? Math.max(0, ing.needed - netherStarSummary.effective2xAvailable)
          : ing.missing;

      let coveragePct = null;
      if (hasStock) {
        if (ing.needed === 0) coveragePct = 100;
        else if (isNether2x) {
          coveragePct = round1(Math.min(100, (netherStarSummary.lowerThan3xUnits / (part.missing * 6561)) * 100));
        } else {
          coveragePct = round1(Math.min(100, (allocated / ing.needed) * 100));
        }
      }

      const ingStatus = !hasStock
        ? 'unknown'
        : effectiveMissing === 0
          ? 'done'
          : (coveragePct ?? 0) > 0
            ? 'partial'
            : 'missing';

      const requirements = ing.alternatives.flatMap(a =>
        a.requirements.map(req => ({ ...req, itemKey: a.key, itemLabel: a.label })),
      );
      const rawRule = ing.alternatives.find(a => a.rawRule !== null)?.rawRule ?? null;
      const sharedPool = sharedPoolsBySlot.get(slotKey) ?? null;
      const nonNullDeltas = ing.alternatives.map(a => a.delta).filter(d => d !== null);
      const delta = nonNullDeltas.length ? nonNullDeltas.reduce((s, d) => s + d, 0) : null;

      return {
        ...ing,
        key: slotKey,
        id: ingPrimary.id,
        label: ing.alternatives.map(a => a.label).join(' oder '),
        icon: ingPrimary.icon,
        mod: ingPrimary.mod,
        inMe,
        allocated,
        effectiveInMe,
        effectiveMissing,
        compressibleFromLower,
        coveragePct,
        status: ingStatus,
        isAlternativeGroup: ing.alternatives.length > 1,
        shared: sharedPool !== null,
        sharedPool,
        requirements,
        hasSpecialRequirements: requirements.length > 0,
        rawRule,
        delta,
      };
    });

    let craftableNow = null;
    if (hasStock) {
      if (part.missing === 0) craftableNow = 0;
      else if (isNether3x) craftableNow = Math.min(part.missing, netherStarSummary.compressible3xFromLower);
      else {
        craftableNow = Math.min(
          part.missing,
          ...enrichedIngredients.map(ing => Math.floor(ing.allocated / ing.perRecipe)),
        );
      }
    }

    const effectiveCovered = hasStock ? directAllocated + craftableNow : null;
    const effectiveMissing = hasStock ? Math.max(0, part.needed - effectiveCovered) : part.needed;
    const fullyCraftable = hasStock && part.missing > 0 && craftableNow >= part.missing;

    let directPct = null;
    let craftablePct = null;
    let effectivePct = null;
    let readinessPct = null;
    if (hasStock) {
      if (part.needed === 0 || part.missing === 0) {
        directPct = 100;
        craftablePct = 0;
        effectivePct = 100;
        readinessPct = 100;
      } else {
        const directRatio = directAllocated / part.needed;
        const craftableRatio = craftableNow / part.needed;
        directPct = round1(directRatio * 100);
        craftablePct = round1(craftableRatio * 100);
        effectivePct = round1(Math.min(100, (directRatio + craftableRatio) * 100));
        if (isNether3x) {
          const totalUnitsForNeeded = directAllocated * 6561 + netherStarSummary.lowerThan3xUnits;
          readinessPct = round1(Math.min(100, (totalUnitsForNeeded / (part.needed * 6561)) * 100));
        } else {
          const avgIngRatio = enrichedIngredients.reduce((sum, ing) => sum + (ing.coveragePct / 100), 0)
            / Math.max(1, enrichedIngredients.length);
          readinessPct = round1(Math.min(100, (directRatio + (part.missing / part.needed) * avgIngRatio) * 100));
        }
      }
    }

    const ingredientsTotalCount = enrichedIngredients.length;
    const ingredientsReadyCount = hasStock
      ? enrichedIngredients.filter(ing => ing.effectiveMissing === 0).length
      : null;

    const status = !hasStock
      ? 'unknown'
      : part.missing === 0
        ? 'done'
        : craftableNow > 0
          ? 'craftable'
          : readinessPct > 0
            ? 'partial'
            : 'missing';

    const requirements = primary.requirements;
    const hasSpecialIngredientRequirements = enrichedIngredients.some(ing => ing.hasSpecialRequirements);

    return {
      ...part,
      key: primary.key,
      id: primary.id,
      label: primary.label,
      icon: primary.icon,
      mod: primary.mod,
      station: meta.station,
      stationDetail: meta.stationDetail,
      category: meta.category,
      inMe: directInMe,
      allocated: directAllocated,
      craftableNow,
      fullyCraftable,
      effectiveCovered,
      effectiveMissing,
      directPct,
      craftablePct,
      effectivePct,
      readinessPct,
      status,
      ingredientsReadyCount,
      ingredientsTotalCount,
      requirements,
      hasSpecialRequirements: requirements.length > 0,
      hasSpecialIngredientRequirements,
      rawRule: primary.rawRule,
      delta: primary.delta,
      ingredients: enrichedIngredients,
    };
  });

  // Flat deduplicated shopping list of missing ingredients across all 13 parts.
  const shoppingList = [];
  for (const entry of usageMap.values()) {
    if (entry.totalNeeded === 0) continue;
    const primary = entry.options[0];
    const isNether2x = entry.slotKey === NETHER_2X_KEY;
    const directInStock = hasStock
      ? entry.options.reduce((sum, a) => sum + (counts[a.key] ?? 0), 0)
      : null;
    const effectiveInStock = !hasStock
      ? null
      : isNether2x
        ? netherStarSummary.effective2xAvailable
        : directInStock;
    const directMissing = hasStock ? Math.max(0, entry.totalNeeded - directInStock) : entry.totalNeeded;
    const missing = hasStock ? Math.max(0, entry.totalNeeded - effectiveInStock) : entry.totalNeeded;
    if (hasStock && missing === 0) continue;

    let coveragePct = null;
    if (hasStock) {
      if (isNether2x) {
        const part0Missing = parts[0].missing;
        coveragePct = part0Missing === 0
          ? 100
          : round1(Math.min(100, (netherStarSummary.lowerThan3xUnits / (part0Missing * 6561)) * 100));
      } else {
        coveragePct = round1(Math.min(100, (directInStock / entry.totalNeeded) * 100));
      }
    }

    const requirements = entry.options.flatMap(a =>
      a.requirements.map(req => ({ ...req, itemKey: a.key, itemLabel: a.label })),
    );
    const nonNullDeltas = entry.options.map(a => a.delta).filter(d => d !== null);
    const delta = nonNullDeltas.length ? nonNullDeltas.reduce((s, d) => s + d, 0) : null;

    shoppingList.push({
      key: entry.slotKey,
      id: primary.id,
      label: entry.options.map(o => o.label).join(' oder '),
      mod: primary.mod,
      icon: primary.icon,
      perStar: entry.totalPerStar,
      totalForGoal: entry.totalForGoal,
      totalNeeded: entry.totalNeeded,
      inStock: directInStock,
      effectiveInStock,
      missing,
      directMissing,
      compressibleFromLower: hasStock && isNether2x ? netherStarSummary.compressible2xFromLower : 0,
      coveragePct,
      shared: entry.consumers.length > 1,
      hasSpecialRequirements: requirements.length > 0,
      requirements,
      rawRule: entry.options.find(a => a.rawRule !== null)?.rawRule ?? null,
      delta,
      usedBy: entry.consumers.map(({ partKey, partLabel, partIcon, perStar, needed, allocated, missing: partIngMissing }) => ({
        partKey,
        partLabel,
        partIcon,
        perStar,
        needed,
        allocated,
        missing: partIngMissing,
      })),
      alternatives: entry.options.map(({ key, id, label, icon, mod, inMe, requirements: optReqs, rawRule }) => ({
        key, id, label, icon, mod, inMe, requirements: optReqs, rawRule,
      })),
    });
  }

  shoppingList.sort((a, b) =>
    (a.coveragePct ?? 0) - (b.coveragePct ?? 0)
    || Number(b.shared) - Number(a.shared)
    || b.missing - a.missing
    || a.label.localeCompare(b.label, 'de'),
  );

  // Actionable intelligence: craftable parts, closest part, top 6 bottlenecks.
  const craftableParts = parts
    .filter(p => (p.craftableNow ?? 0) > 0)
    .sort((a, b) =>
      Number(b.fullyCraftable) - Number(a.fullyCraftable)
      || (b.readinessPct ?? 0) - (a.readinessPct ?? 0)
      || (b.craftableNow ?? 0) - (a.craftableNow ?? 0),
    )
    .map(p => ({
      key: p.key,
      id: p.id,
      label: p.label,
      icon: p.icon,
      mod: p.mod,
      station: p.station,
      craftableNow: p.craftableNow,
      needed: p.needed,
      missing: p.missing,
      effectiveMissing: p.effectiveMissing,
      fullyCraftable: p.fullyCraftable,
      readinessPct: p.readinessPct,
      ingredientsReadyCount: p.ingredientsReadyCount,
      ingredientsTotalCount: p.ingredientsTotalCount,
    }));

  let closestPart = null;
  if (hasStock) {
    const incomplete = parts.filter(p => p.missing > 0);
    const nonCraftable = incomplete.filter(p => p.craftableNow === 0);
    const candidates = nonCraftable.length ? nonCraftable : incomplete;
    if (candidates.length) {
      const sorted = [...candidates].sort((a, b) => {
        const ratioA = a.ingredientsReadyCount / Math.max(1, a.ingredientsTotalCount);
        const ratioB = b.ingredientsReadyCount / Math.max(1, b.ingredientsTotalCount);
        return ratioB - ratioA
          || (b.readinessPct ?? 0) - (a.readinessPct ?? 0)
          || (a.ingredientsTotalCount - a.ingredientsReadyCount) - (b.ingredientsTotalCount - b.ingredientsReadyCount);
      });
      const best = sorted[0];
      closestPart = {
        key: best.key,
        id: best.id,
        label: best.label,
        icon: best.icon,
        mod: best.mod,
        station: best.station,
        readinessPct: best.readinessPct,
        ingredientsReadyCount: best.ingredientsReadyCount,
        ingredientsTotalCount: best.ingredientsTotalCount,
        missingIngredientsCount: best.ingredientsTotalCount - best.ingredientsReadyCount,
        missing: best.missing,
      };
    }
  }

  const bottlenecks = shoppingList
    .map(item => {
      const reasons = [];
      let score = 100 - (item.coveragePct ?? 0);
      if (hasStock && (item.effectiveInStock ?? 0) === 0) {
        score += 25;
        reasons.push('Nicht im ME');
      } else if (hasStock && (item.coveragePct ?? 0) < 25) {
        reasons.push('Niedriger Bestand');
      }
      if (item.shared) {
        score += 30;
        reasons.push(`Geteilt (${item.usedBy.length} Bauteile)`);
      }
      if (item.hasSpecialRequirements) {
        score += 15;
        reasons.push('Sonder-NBT');
      }
      if (item.missing >= 100) {
        reasons.push('Hohe Menge');
      }
      score += Math.min(20, Math.log10(Math.max(1, item.missing)) * 6);
      return {
        key: item.key,
        id: item.id,
        label: item.label,
        icon: item.icon,
        mod: item.mod,
        totalNeeded: item.totalNeeded,
        inStock: item.inStock,
        effectiveInStock: item.effectiveInStock,
        missing: item.missing,
        coveragePct: item.coveragePct,
        shared: item.shared,
        hasSpecialRequirements: item.hasSpecialRequirements,
        requirements: item.requirements,
        usedBy: item.usedBy,
        reasons,
        score: round1(score),
      };
    })
    .sort((a, b) => b.score - a.score || b.missing - a.missing || a.label.localeCompare(b.label, 'de'))
    .slice(0, 6);

  const partsTotalCount = parts.length;
  const partsReadyCount = hasStock ? parts.filter(p => p.status === 'done').length : null;
  const partsCraftableCount = hasStock ? parts.filter(p => p.status === 'craftable').length : null;

  let overallReadinessPct = null;
  let overallDirectPct = null;
  let overallCraftablePct = null;
  if (hasStock) {
    if (remainingStars === 0) {
      overallReadinessPct = 100;
      overallDirectPct = 100;
      overallCraftablePct = 0;
    } else {
      const meanReadiness = parts.reduce((sum, p) => sum + p.readinessPct / 100, 0) / partsTotalCount;
      const meanDirect = parts.reduce((sum, p) => sum + p.directPct / 100, 0) / partsTotalCount;
      const meanCraftable = parts.reduce((sum, p) => sum + p.craftablePct / 100, 0) / partsTotalCount;
      const base = completedForGoal ?? 0;
      overallReadinessPct = round1(Math.min(100, ((base + remainingStars * meanReadiness) / def.goalStars) * 100));
      overallDirectPct = round1(Math.min(100, ((base + remainingStars * meanDirect) / def.goalStars) * 100));
      overallCraftablePct = round1(Math.min(100, ((remainingStars * meanCraftable) / def.goalStars) * 100));
    }
  }

  return {
    id: def.id,
    label: def.label,
    shortLabel: def.shortLabel,
    goalStars: def.goalStars,
    mode: def.mode,
    completedForGoal,
    remainingStars,
    overallReadinessPct,
    overallDirectPct,
    overallCraftablePct,
    partsReadyCount,
    partsCraftableCount,
    partsTotalCount,
    netherStarSummary,
    craftableParts,
    closestPart,
    bottlenecks,
    shoppingList,
    sharedPools,
    parts,
  };
}

export function saveAtmStarStock(db, source, report, { at = now() } = {}) {
  if (report?.revision !== revision || !report.counts || typeof report.counts !== 'object') return;
  if (atmStarStockRules.some(({ key }) => !Number.isSafeInteger(report.counts[key]) || report.counts[key] < 0)) return;
  const counts = Object.fromEntries(atmStarStockRules.map(({ key }) => [key, report.counts[key]]));
  const countsJson = JSON.stringify(counts);

  db.prepare(`INSERT INTO atm_star_stock (id, at, source, revision, counts_json) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET at=excluded.at, source=excluded.source, revision=excluded.revision, counts_json=excluded.counts_json`)
    .run(at, source, revision, countsJson);

  const last = db.prepare(
    'SELECT id, at, counts_json FROM atm_star_stock_history WHERE revision=? ORDER BY id DESC LIMIT 1',
  ).get(revision);
  const elapsedMs = last ? Date.parse(at) - Date.parse(last.at) : Infinity;
  const shouldRecord = !last || last.counts_json !== countsJson || !Number.isFinite(elapsedMs) || elapsedMs >= HISTORY_MIN_INTERVAL_MS;
  if (shouldRecord) {
    db.prepare('INSERT INTO atm_star_stock_history (at, source, revision, counts_json) VALUES (?, ?, ?, ?)')
      .run(at, source, revision, countsJson);
    db.prepare(`DELETE FROM atm_star_stock_history WHERE id <= (
      SELECT id FROM atm_star_stock_history ORDER BY id DESC LIMIT 1 OFFSET ?
    )`).run(HISTORY_KEEP);
  }
}

export function readAtmStarPlan(db) {
  const row = db.prepare('SELECT at, source, counts_json FROM atm_star_stock WHERE id=1 AND revision=?').get(revision);
  const stock = row ? { at: row.at, source: row.source, counts: JSON.parse(row.counts_json) } : null;
  if (!stock) return buildAtmStarPlan(null, []);
  const historyRows = db.prepare(
    'SELECT at, source, counts_json FROM atm_star_stock_history WHERE revision=? ORDER BY id DESC LIMIT ?',
  ).all(revision, HISTORY_READ_LIMIT).reverse().map(r => ({
    at: r.at,
    source: r.source,
    counts: JSON.parse(r.counts_json),
  }));
  return buildAtmStarPlan(stock, historyRows);
}

export function buildAtmStarPlan(stock, historyRows = []) {
  const hasStock = stock !== null && stock !== undefined;
  const counts = hasStock ? stock.counts : null;
  const stars = hasStock ? (counts[atmStar.key] ?? 0) : null;
  const blocks = hasStock ? (counts[atmStarBlock.key] ?? 0) : null;
  const availableStars = hasStock ? availableStarsOf(counts) : null;
  const remainingStars18 = hasStock ? Math.max(0, ATM_STAR_GOAL - availableStars) : ATM_STAR_GOAL;
  const surplusStars = hasStock ? Math.max(0, availableStars - ATM_STAR_GOAL) : null;

  const missingNetherStars18 = hasStock
    ? Math.max(0, remainingStars18 * NETHER_STARS_PER_STAR - netherTotalOf(counts))
    : remainingStars18 * NETHER_STARS_PER_STAR;
  const history = buildHistorySummary(hasStock ? stock : null, historyRows, missingNetherStars18);

  const milestones = {};
  for (const def of MILESTONE_DEFS) {
    milestones[def.id] = projectMilestone(def, hasStock ? stock : null, history.deltas, history.netherStarRatePerHour);
  }
  const primary = milestones['18'];
  const craftableStars = computeStarsCraftable(counts);

  const roadmap = {
    ...starryBeeRoadmap,
    steps: starryBeeRoadmap.steps.map(step => {
      let done = false;
      if (hasStock) {
        if (step.id === 'stars-18') done = availableStars >= 18;
        else if (step.id === 'patrick-bee') done = blocks >= 1 || availableStars >= 9;
        else if (step.id === 'starry-beehive') done = blocks >= 2 || availableStars >= 18;
      }
      return { ...step, done };
    }),
  };

  return {
    // Legacy top-level fields (100% backward compatible)
    goal: ATM_STAR_GOAL,
    stars,
    blocks,
    remainingStars: primary.remainingStars,
    groups: primary.parts,
    netherStars: primary.netherStarSummary.tiers,
    iconGrid: { columns: iconAtlas.columns, rows: iconAtlas.rows },
    stock: hasStock ? { at: stock.at ?? null, source: stock.source ?? null } : null,

    // Extended top-level fields
    revision,
    looseStars: stars,
    availableStars,
    overGoalStars: availableStars,
    surplusStars,
    starsCraftableFromParts: craftableStars.fromParts,
    starsCraftableWithSubParts: craftableStars.withSubParts,
    overallReadinessPct: primary.overallReadinessPct,
    overallDirectPct: primary.overallDirectPct,
    overallCraftablePct: primary.overallCraftablePct,
    partsReadyCount: primary.partsReadyCount,
    partsCraftableCount: primary.partsCraftableCount,
    partsTotalCount: primary.partsTotalCount,
    atmStar: {
      key: atmStar.key,
      id: atmStar.id,
      label: atmStar.label,
      icon: iconIndex.get(atmStar.key) ?? null,
      mod: modInfo(atmStar.id),
      inMe: stars,
      delta: hasStock && Object.hasOwn(history.deltas, atmStar.key) ? history.deltas[atmStar.key] : null,
    },
    atmStarBlock: {
      key: atmStarBlock.key,
      id: atmStarBlock.id,
      label: atmStarBlock.label,
      icon: iconIndex.get(atmStarBlock.key) ?? null,
      mod: modInfo(atmStarBlock.id),
      inMe: blocks,
      delta: hasStock && Object.hasOwn(history.deltas, atmStarBlock.key) ? history.deltas[atmStarBlock.key] : null,
    },
    netherStarSummary: primary.netherStarSummary,
    craftableParts: primary.craftableParts,
    closestPart: primary.closestPart,
    bottlenecks: primary.bottlenecks,
    shoppingList: primary.shoppingList,
    sharedPools: primary.sharedPools,
    milestoneOrder: MILESTONE_DEFS.map(d => d.id),
    milestones,
    history,
    starryBeeRoadmap: roadmap,
  };
}
