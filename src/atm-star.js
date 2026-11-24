import { createHash } from 'node:crypto';
import { now } from './db.js';
import { ATM_STAR_GOAL, atmStar, atmStarBlock, atmStarParts, atmStarStockRules, netherStarStock } from './atm-star-recipes.js';

const revision = createHash('sha256').update(JSON.stringify(atmStarStockRules)).digest('hex').slice(0, 16);
export const atmStarStockRequest = { revision, rules: atmStarStockRules };

export function saveAtmStarStock(db, source, report) {
  if (report?.revision !== revision || !report.counts || typeof report.counts !== 'object') return;
  if (atmStarStockRules.some(({ key }) => !Number.isSafeInteger(report.counts[key]) || report.counts[key] < 0)) return;
  const counts = Object.fromEntries(atmStarStockRules.map(({ key }) => [key, report.counts[key]]));
  db.prepare(`INSERT INTO atm_star_stock (id, at, source, revision, counts_json) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET at=excluded.at, source=excluded.source, revision=excluded.revision, counts_json=excluded.counts_json`)
    .run(now(), source, revision, JSON.stringify(counts));
}

export function readAtmStarPlan(db) {
  const row = db.prepare('SELECT at, source, counts_json FROM atm_star_stock WHERE id=1 AND revision=?').get(revision);
  const stock = row ? { at: row.at, source: row.source, counts: JSON.parse(row.counts_json) } : null;
  return buildAtmStarPlan(stock);
}

export function buildAtmStarPlan(stock) {
  const available = { ...stock?.counts };
  const stars = stock?.counts[atmStar.key] ?? null;
  const blocks = stock?.counts[atmStarBlock.key] ?? null;
  const remainingStars = Math.max(0, ATM_STAR_GOAL - (stars ?? 0) - 9 * (blocks ?? 0));

  function allocate({ count, options }, batches) {
    const needed = batches * count;
    let missing = needed;
    const alternatives = options.map(({ key, id, label }) => {
      const inMe = stock?.counts[key] ?? null;
      const allocated = Math.min(missing, available[key] ?? 0);
      available[key] = (available[key] ?? 0) - allocated;
      missing -= allocated;
      return { id, label, inMe, allocated };
    });
    return { perRecipe: count, needed, missing, alternatives };
  }

  // Finished parts are committed first. Ingredients can use only the remaining stock.
  const parts = atmStarParts.map(part => allocate(part, remainingStars));
  const groups = parts.map((part, index) => ({
    ...part,
    totalForGoal: ATM_STAR_GOAL * part.perRecipe,
    ingredients: atmStarParts[index].ingredients.map(ingredient => ({
      ...allocate(ingredient, part.missing),
      totalForGoal: ATM_STAR_GOAL * part.perRecipe * ingredient.count,
    })),
  }));
  const netherStars = netherStarStock.map(({ key, label, units }) => ({ label, units, inMe: stock?.counts[key] ?? null }));
  return {
    goal: ATM_STAR_GOAL, stars, blocks, remainingStars, groups, netherStars,
    stock: stock && { at: stock.at, source: stock.source },
  };
}
