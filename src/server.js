import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { config as defaultConfig } from './config.js';
import { openDb, now, logActivity } from './db.js';
import { Campus, parseOrigin } from './campus.js';
import {
  SESSION_COOKIE, sha256, randomToken, hashPassword, verifyPassword, validateCredentials, createSession, createApiToken,
  resolveActor, requireActor, HttpError, throttleLogin, clearThrottle,
} from './auth.js';
import { importHtml } from './importer.js';
import { viewerPackageScript, renderViewerHtml } from './viewer.js';
import { zipStore } from './zip.js';
import { openapi } from './openapi.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = name => readFileSync(join(root, 'public', name), 'utf8');

export async function buildServer(config = defaultConfig) {
  const db = openDb(config.dataDir);
  const campus = new Campus(db, config);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: config.maxUploadBytes, trustProxy: true });
  app.decorate('campus', campus);
  await app.register(cookie);
  await app.register(fastifyStatic, { root: join(root, 'public', 'assets'), prefix: '/assets/' });
  for (const type of ['application/octet-stream', 'text/html']) {
    app.addContentTypeParser(type, { parseAs: 'buffer' }, (req, body, done) => done(null, body));
  }

  app.addHook('onRequest', async req => { req.actor = resolveActor(db, req); });
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: err.message, ...(err.extra || {}) });
  });

  const html = (reply, body) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(body);
  const setSession = (reply, userId) => {
    const { token, expires } = createSession(db, userId);
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, expires: new Date(expires) });
  };
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

  // ---------- pages ----------
  app.get('/', async (req, reply) => reply.redirect(req.actor && !req.actor.invalid ? '/app' : '/login'));
  app.get('/login', async (req, reply) => html(reply, page('login.html')));
  app.get('/invite/:code', async (req, reply) => html(reply, page('invite.html')));
  app.get('/app', async (req, reply) => (req.actor?.via === 'session' ? html(reply, page('app.html')) : reply.redirect('/login')));
  app.get('/docs', async (req, reply) => html(reply, page('docs.html')));
  app.get('/viewer', async (req, reply) => {
    if (req.actor?.via !== 'session') return reply.redirect('/login');
    const snap = req.query.snapshot ? campus.getSnapshot(Number(req.query.snapshot)) : campus.latestSnapshot('live');
    const out = renderViewerHtml(campus, snap);
    if (!out) return html(reply, '<!doctype html><meta charset="utf-8"><p style="font-family:system-ui">Noch kein Viewer importiert. Bitte in der <a href="/app">Übersicht</a> eine Campus-HTML importieren.</p>');
    return html(reply, out);
  });
  app.get('/healthz', async () => ({ ok: true, time: now(), live: campus.latestSnapshot('live')?.capturedAt ?? null }));
  app.get('/api/openapi.json', async () => openapi(config.publicUrl));

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
    const name = String(req.body?.name || '').trim().slice(0, 60), scope = req.body?.scope === 'read' ? 'read' : 'write';
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
  app.post('/api/import/html', async req => {
    const a = requireActor(req, 'admin');
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'HTML als text/html oder application/octet-stream senden.');
    const q = req.query;
    return importHtml(campus, req.body.toString('utf8'), {
      actor: a, force: q.force === '1' || q.force === 'true', note: q.note,
      baseSnapshotId: q.baseSnapshot ? campus.getSnapshot(Number(q.baseSnapshot)).id : undefined,
    });
  });

  // ---------- status ----------
  app.get('/api/status', async req => { requireActor(req, 'read'); return campus.status(); });
  app.get('/api/activity', async req => {
    requireActor(req, 'read');
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    return db.prepare(`SELECT a.id, a.at, u.username AS user, a.via, a.action, a.target, a.detail_json AS detail FROM activity a
      LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`).all(limit).map(r => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  });

  // ---------- blueprints ----------
  const actorVia = a => (a.via === 'token' ? 'api' : 'web');
  app.get('/api/blueprints', async req => {
    requireActor(req, 'read');
    return campus.listBlueprints({ includeArchived: req.query.archived === '1' });
  });
  app.get('/api/blueprints.zip', async (req, reply) => {
    requireActor(req, 'read');
    const entries = campus.listBlueprints().filter(b => b.current).map(b => ({ name: b.fileName, data: campus.readVersionBytes(b.id, b.current.version) }));
    const manifest = campus.listBlueprints().filter(b => b.current).map(b => ({ file: b.fileName, name: b.name, version: b.currentVersion, origin: b.current.origin, size: b.current.size, sha256: b.current.sha256 }));
    entries.push({ name: 'manifest.json', data: Buffer.from(JSON.stringify({ exportedAt: now(), modules: manifest }, null, 2)) });
    return reply.type('application/zip').header('Content-Disposition', `attachment; filename="campus-bauplaene-${now().slice(0, 10)}.zip"`).send(zipStore(entries));
  });
  app.get('/api/blueprints/:id', async req => {
    requireActor(req, 'read');
    const bp = campus.getBlueprint(req.params.id);
    const live = campus.latestSnapshot('live');
    const current = campus.currentVersion(bp.id);
    return { ...bp, versions: campus.versions(bp.id), analysis: live && current ? campus.analysis(bp.id, current, live.id) : null };
  });
  app.get('/api/blueprints/:id/versions/:version/analysis', async req => {
    requireActor(req, 'read');
    const v = campus.version(req.params.id, Number(req.params.version));
    const snap = req.query.snapshot ? campus.getSnapshot(Number(req.query.snapshot)) : campus.latestSnapshot('live');
    if (!snap) throw new HttpError(503, 'Noch kein Live-Snapshot vorhanden.');
    return campus.analysis(req.params.id, v, snap.id);
  });
  app.get('/api/blueprints/:id/download', async (req, reply) => {
    requireActor(req, 'read');
    const bp = campus.getBlueprint(req.params.id);
    const version = req.query.version ? Number(req.query.version) : bp.currentVersion;
    const v = campus.version(bp.id, version);
    const name = version === bp.currentVersion ? bp.fileName : bp.fileName.replace(/\.nbt$/i, `_v${version}.nbt`);
    return reply.type('application/octet-stream').header('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`)
      .header('X-Blueprint-Version', String(v.version)).header('ETag', `"${v.sha256}"`).send(campus.readVersionBytes(bp.id, v.version));
  });
  // Create or new version from JSON (nbtBase64) — convenient for agents.
  app.post('/api/blueprints', async req => {
    const a = requireActor(req, 'write');
    const b = req.body || {};
    if (!b.nbtBase64) throw new HttpError(400, 'nbtBase64 fehlt.');
    return campus.saveVersion({ fileName: b.fileName, bytes: Buffer.from(b.nbtBase64, 'base64'), origin: b.origin, name: b.name, category: b.category, description: b.description,
      note: b.note, baseVersion: b.baseVersion, actor: a, via: actorVia(a) });
  });
  // Raw NBT upload as new version of an existing (or new) blueprint.
  app.put('/api/blueprints/:id/nbt', async req => {
    const a = requireActor(req, 'write');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(415, 'NBT als application/octet-stream senden.');
    const q = req.query;
    let fileName = q.fileName;
    if (!fileName) { try { fileName = campus.getBlueprint(req.params.id).fileName; } catch { fileName = req.params.id + '.nbt'; } }
    return campus.saveVersion({ fileName, bytes: req.body, origin: q.origin, name: q.name, category: q.category, description: q.description,
      note: q.note, baseVersion: q.baseVersion ?? req.headers['if-match']?.replace(/"/g, ''), actor: a, via: actorVia(a) });
  });
  app.patch('/api/blueprints/:id', async req => {
    const a = requireActor(req, 'write');
    const b = req.body || {};
    if (b.origin) {
      const bp = campus.getBlueprint(req.params.id), cur = campus.currentVersion(bp.id);
      const r = campus.saveVersion({ fileName: bp.fileName, bytes: campus.readVersionBytes(bp.id, cur.version), origin: parseOrigin(b.origin), name: b.name, category: b.category, description: b.description,
        note: b.note || 'Position geändert', baseVersion: b.baseVersion, actor: a, via: actorVia(a) });
      return r;
    }
    return { blueprint: campus.updateMeta(req.params.id, b, a) };
  });
  app.post('/api/blueprints/:id/revert', async req => {
    const a = requireActor(req, 'write');
    return campus.revert(req.params.id, Number(req.body?.version), a, actorVia(a));
  });
  app.delete('/api/blueprints/:id', async req => {
    const a = requireActor(req, 'write');
    campus.archive(req.params.id, a);
    return { ok: true };
  });

  // ---------- snapshots ----------
  app.get('/api/snapshots', async req => { requireActor(req, 'read'); return { sources: Object.keys(config.worldSources), snapshots: campus.listSnapshots() }; });
  app.post('/api/snapshots', async req => {
    const a = requireActor(req, 'write');
    const b = req.body || {};
    if (b.pinned && a.user.role !== 'admin') throw new HttpError(403, 'Nur Admins können Snapshots anpinnen.');
    return campus.capture({ source: b.source || 'live', label: b.label, force: !!b.force || (b.source && b.source !== 'live'), pinned: !!b.pinned, actor: a });
  });
  app.get('/api/snapshots/:id/context.json', async (req, reply) => {
    requireActor(req, 'read');
    const s = campus.getSnapshot(Number(req.params.id));
    return reply.type('application/json').send(readFileSync(join(campus.snapshotDir(s.id), 'context.json')));
  });
  app.get('/api/snapshots/:id/surfaces.bin.gz', async (req, reply) => {
    requireActor(req, 'read');
    const s = campus.getSnapshot(Number(req.params.id));
    return reply.type('application/gzip').send(readFileSync(join(campus.snapshotDir(s.id), 'surfaces.bin.gz')));
  });
  app.get('/api/viewer/package.js', async (req, reply) => {
    requireActor(req, 'read');
    const sid = req.query.snapshot && req.query.snapshot !== 'none' ? campus.getSnapshot(Number(req.query.snapshot)).id : null;
    const pkg = viewerPackageScript(campus, sid);
    if (!pkg) throw new HttpError(404, 'Kein Viewer importiert.');
    reply.header('ETag', pkg.etag).header('Cache-Control', 'private, no-cache').type('application/javascript; charset=utf-8');
    if (req.headers['if-none-match'] === pkg.etag) return reply.code(304).send();
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return reply.header('Content-Encoding', 'gzip').send(pkg.gzip);
    return reply.send(pkg.body);
  });

  return app;
}

// One-time seeding on an empty instance; safe to run on every start.
export async function seed(app, config) {
  const { campus } = app;
  let baseId;
  if (config.seedBaselineSource) {
    const existing = campus.latestSnapshot(config.seedBaselineSource);
    baseId = existing?.id ?? (await campus.capture({ source: config.seedBaselineSource, label: config.seedBaselineLabel || config.seedBaselineSource, force: true, pinned: true })).snapshot.id;
  }
  const imported = campus.db.prepare('SELECT COUNT(*) AS n FROM packages').get().n > 0;
  if (config.seedHtml && !imported && existsSync(config.seedHtml)) {
    const r = importHtml(campus, readFileSync(config.seedHtml, 'utf8'), { baseSnapshotId: baseId, note: 'Erstimport' });
    app.log.info({ created: r.created.length, errors: r.errors.length, warnings: r.warnings }, 'seed import done');
  }
}

// Periodic live capture; only rebuilds when region files changed.
export function startScheduler(app, config) {
  if (!config.snapshotIntervalMin) return null;
  const tick = async () => {
    try {
      const r = await app.campus.capture({ source: 'live' });
      if (!r.skipped) app.log.info({ snapshot: r.snapshot.id }, 'live snapshot captured');
      app.campus.status(); // warm analyses
    } catch (e) { app.log.warn({ err: e.message }, 'live snapshot failed'); }
  };
  setTimeout(tick, 3000);
  return setInterval(tick, config.snapshotIntervalMin * 60e3);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await buildServer();
  await app.listen({ port: defaultConfig.port, host: defaultConfig.host });
  await seed(app, defaultConfig).catch(e => app.log.error({ err: e.message }, 'seed failed'));
  startScheduler(app, defaultConfig);
  if (defaultConfig.bootstrapInvite && app.campus.db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    app.log.info('Noch kein Account: Admin über die BOOTSTRAP_INVITE-Einladung anlegen (/invite/<code>).');
  }
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => app.close().then(() => process.exit(0)));
}
