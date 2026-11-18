import { now, logActivity } from './db.js';
import {
  SESSION_COOKIE, sha256, randomToken, hashPassword, verifyPassword, validateCredentials, createSession, createApiToken,
  requireActor, HttpError, throttleLogin, clearThrottle,
} from './auth.js';

export function registerAccounts(app, db, config) {
  const setSession = (reply, userId) => {
    const { token, expires } = createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires: new Date(expires) });
  };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // ---------- auth ----------
  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body || {};
    const key = req.ip + ':' + String(username).toLowerCase();
    throttleLogin(key);
    const u = db.prepare('SELECT * FROM users WHERE username = ? AND disabled_at IS NULL').get(String(username || ''));
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Benutzername oder Passwort falsch.');
    clearThrottle(key);
    setSession(reply, u.id);
    logActivity(db, { user: u, via: 'session' }, 'auth.login', u.username);
    return { ok: true, user: { id: u.id, username: u.username, role: u.role } };
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const c = req.cookies[SESSION_COOKIE];
    if (c) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(c));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });
  app.get('/api/auth/invite/:code', async req => {
    const inv = findInvite(req.params.code);
    return { valid: !!inv, role: inv?.role ?? null };
  });
  app.post('/api/auth/register', async (req, reply) => {
    const { code, username, password } = req.body || {};
    throttleLogin(req.ip + ':register');
    const inv = findInvite(code);
    if (!inv) throw new HttpError(400, 'Einladung ungültig, abgelaufen oder schon benutzt.');
    const err = validateCredentials(username, password);
    if (err) throw new HttpError(400, err);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'Benutzername ist vergeben.');
    const role = inv.bootstrap ? 'admin' : inv.role;
    const id = Number(db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)').run(username, hashPassword(password), role, now()).lastInsertRowid);
    if (!inv.bootstrap) db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE id = ?').run(id, now(), inv.id);
    setSession(reply, id);
    logActivity(db, { user: { id }, via: 'session' }, 'auth.register', username, { role });
    return { ok: true, user: { id, username, role } };
  });
  function findInvite(code) {
    if (typeof code !== 'string' || code.length < 10) return null;
    if (config.bootstrapInvite && code === config.bootstrapInvite && userCount() === 0) return { bootstrap: true, role: 'admin' };
    return db.prepare('SELECT * FROM invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?').get(sha256(code), now()) || null;
  }

  app.get('/api/me', async req => {
    const a = requireActor(req, 'read');
    return { user: a.user, via: a.via, scope: a.scope, token: a.tokenName ?? null };
  });

  // ---------- tokens (browser only) ----------
  app.get('/api/tokens', async req => {
    const a = requireActor(req, 'session');
    return db.prepare('SELECT id, name, prefix, scope, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt FROM api_tokens WHERE user_id = ? ORDER BY id DESC').all(a.user.id);
  });
  app.post('/api/tokens', async req => {
    const a = requireActor(req, 'session');
    const name = String(req.body?.name || '').trim().slice(0, 60), scope = req.body?.scope ?? 'write';
    if (!['read','station','write','erebor_supply'].includes(scope)) throw new HttpError(400, 'Unbekannte Token-Berechtigung.');
    if (scope === 'erebor_supply') requireActor(req,'admin');
    if (!name) throw new HttpError(400, 'Name für den Token fehlt.');
    const t = createApiToken(db, a.user.id, name, scope);
    logActivity(db, a, 'token.create', name, { scope });
    return { id: t.id, name, scope, token: t.token };
  });
  app.delete('/api/tokens/:id', async req => {
    const a = requireActor(req, 'session');
    const r = db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(now(), Number(req.params.id), a.user.id);
    if (!r.changes) throw new HttpError(404, 'Token nicht gefunden.');
    logActivity(db, a, 'token.revoke', req.params.id);
    return { ok: true };
  });

  // ---------- admin ----------
  app.get('/api/invites', async req => {
    requireActor(req, 'admin');
    return db.prepare(`SELECT i.id, i.role, i.note, i.created_at AS createdAt, i.expires_at AS expiresAt, i.used_at AS usedAt, u.username AS usedBy
      FROM invites i LEFT JOIN users u ON u.id = i.used_by ORDER BY i.id DESC LIMIT 100`).all();
  });
  app.post('/api/invites', async req => {
    const a = requireActor(req, 'admin');
    const role = req.body?.role === 'admin' ? 'admin' : 'member', days = Math.min(Math.max(Number(req.body?.days) || 7, 1), 60);
    const code = randomToken(18);
    db.prepare('INSERT INTO invites (code_hash, role, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(code), role, String(req.body?.note || '').slice(0, 100) || null, a.user.id, now(), new Date(Date.now() + days * 864e5).toISOString());
    logActivity(db, a, 'invite.create', req.body?.note || null, { role, days });
    return { url: `${config.publicUrl}/invite/${code}`, role, days };
  });
  app.delete('/api/invites/:id', async req => {
    requireActor(req, 'admin');
    db.prepare('UPDATE invites SET expires_at = ? WHERE id = ? AND used_at IS NULL').run(now(), Number(req.params.id));
    return { ok: true };
  });
  app.get('/api/users', async req => {
    requireActor(req, 'admin');
    return db.prepare('SELECT id, username, role, created_at AS createdAt, disabled_at AS disabledAt FROM users ORDER BY id').all();
  });
  app.patch('/api/users/:id', async req => {
    const a = requireActor(req, 'admin');
    const id = Number(req.params.id);
    if (id === a.user.id) throw new HttpError(400, 'Eigenen Account bitte nicht hier ändern.');
    if (req.body?.disabled !== undefined) {
      db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(req.body.disabled ? now() : null, id);
      if (req.body.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (req.body?.role === 'admin' || req.body?.role === 'member') db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
    logActivity(db, a, 'user.update', String(id), req.body);
    return { ok: true };
  });
}
