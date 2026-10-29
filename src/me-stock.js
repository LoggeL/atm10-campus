// AE2 stock as reported by CC computers (ME Bridge). Only the latest reports are kept.
import { now } from './db.js';
import { HttpError } from './auth.js';

const ITEM_ID = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
const KEEP = 50;
const MAX = Number.MAX_SAFE_INTEGER;
let cached = null;

// items: [{ name, amount|count, craftable|isCraftable }] or { name: amount | {amount, craftable} } (Lua tables serialize either way).
export function normalizeStockItems(raw) {
  const out = {};
  const put = (name, amount, craftable) => {
    if (typeof name !== 'string' || !ITEM_ID.test(name)) return;
    const x = Number(amount), n = Number.isFinite(x) ? Math.min(MAX, Math.max(0, Math.floor(x))) : 0, prev = out[name];
    out[name] = prev ? [Math.min(MAX, prev[0] + n), prev[1] || (craftable ? 1 : 0)] : [n, craftable ? 1 : 0];
  };
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([name, v]) => (v && typeof v === 'object' ? { name, ...v } : { name, amount: v })) : null;
  if (!list) throw new HttpError(400, 'items fehlt: Liste [{name, amount, craftable}] oder Objekt {name: amount}.');
  if (list.length > 50000) throw new HttpError(413, 'Zu viele Items in einer Meldung (max. 50000).');
  for (const e of list) if (e && typeof e === 'object') put(e.name, e.amount ?? e.count, e.craftable ?? e.isCraftable);
  return out;
}

export function saveStock(db, actor, source, items) {
  const values = Object.values(items);
  const row = { at: now(), source, kinds: values.length, total: Math.min(MAX, values.reduce((a, v) => a + v[0], 0)) };
  const id = Number(db.prepare('INSERT INTO me_stock (at, user_id, source, kinds, total, items_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.at, actor?.user?.id ?? null, source, row.kinds, row.total, JSON.stringify(items)).lastInsertRowid);
  db.prepare('DELETE FROM me_stock WHERE id <= ?').run(id - KEEP);
  cached = { id, ...row, items };
  return cached;
}

export function latestStock(db) {
  const r = db.prepare('SELECT id, at, source, kinds, total FROM me_stock ORDER BY id DESC LIMIT 1').get();
  if (!r) return null;
  if (cached?.id !== r.id) cached = { ...r, items: JSON.parse(db.prepare('SELECT items_json FROM me_stock WHERE id = ?').get(r.id).items_json) };
  return cached;
}
