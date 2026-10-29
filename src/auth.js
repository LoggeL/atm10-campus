import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { now } from './db.js';

export const SESSION_COOKIE = 'campus_session';
const SESSION_DAYS = 30;
export const TOKEN_PREFIX = 'atc_';

export const sha256 = s => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, key] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(expected, got);
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) return 'Benutzername: 3–32 Zeichen, nur Buchstaben, Zahlen, _ . -';
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) return 'Passwort: mindestens 10 Zeichen.';
  return null;
}

export function createSession(db, userId) {
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(token), userId, now(), expires);
  return { token, expires };
}

export function createApiToken(db, userId, name, scope) {
  const token = TOKEN_PREFIX + randomToken();
  const info = db.prepare('INSERT INTO api_tokens (user_id, name, token_hash, prefix, scope, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, name, sha256(token), token.slice(0, 10), scope, now());
  return { id: Number(info.lastInsertRowid), token };
}

// Resolves the caller from a bearer token or session cookie. Returns null when anonymous.
export function resolveActor(db, req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    const row = db.prepare(`SELECT t.id AS token_id, t.scope, t.name AS token_name, u.* FROM api_tokens t JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ? AND t.revoked_at IS NULL AND u.disabled_at IS NULL`).get(sha256(token));
    if (!row) return { invalid: true };
    db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), row.token_id);
    return { via: 'token', scope: row.scope, tokenId: row.token_id, tokenName: row.token_name, user: { id: row.id, username: row.username, role: row.role } };
  }
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL`).get(sha256(cookie), now());
    if (row) return { via: 'session', scope: 'write', user: { id: row.id, username: row.username, role: row.role } };
  }
  return null;
}

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.statusCode = status; this.extra = extra; }
}

// Guards. level: 'read' | 'station' (write or station token) | 'write' | 'session' (browser only) | 'admin' (browser session + admin role)
export function requireActor(req, level) {
  const a = req.actor;
  if (!a || a.invalid) throw new HttpError(401, a?.invalid ? 'Token ungültig oder widerrufen.' : 'Anmeldung erforderlich.');
  if (a.via === 'session' && req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-campus-csrf'] !== '1') {
    throw new HttpError(403, 'CSRF-Header fehlt.');
  }
  if (level === 'write' && a.scope !== 'write') {
    throw new HttpError(403, a.scope === 'station' ? 'Station-Tokens dürfen nur lesen und ME-Bestand/Kanonen-Status melden.' : 'Dieser Token darf nur lesen.');
  }
  if (level === 'station' && a.scope === 'read') throw new HttpError(403, 'Dieser Token darf nur lesen. Für ME-Computer einen Token mit Scope „Station“ anlegen.');
  if ((level === 'session' || level === 'admin') && a.via !== 'session') throw new HttpError(403, 'Nur mit Browser-Login möglich, nicht per API-Token.');
  if (level === 'admin' && a.user.role !== 'admin') throw new HttpError(403, 'Nur für Admins.');
  return a;
}

// Simple in-memory login throttling per IP + username.
const attempts = new Map();
export function throttleLogin(key) {
  const t = Date.now(), list = (attempts.get(key) || []).filter(x => t - x < 15 * 60e3);
  if (list.length >= 10) throw new HttpError(429, 'Zu viele Versuche. Bitte in 15 Minuten erneut probieren.');
  list.push(t); attempts.set(key, list);
}
export const clearThrottle = key => attempts.delete(key);
