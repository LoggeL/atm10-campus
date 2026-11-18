import {registerGroupFeeders} from './erebor-group-feeders.js';
import {campusPage} from './campus-page.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { config as defaultConfig } from './config.js';
import { openDb, now } from './db.js';
import { Campus, parseOrigin } from './campus.js';
import { resolveActor, requireActor, HttpError } from './auth.js';
import { registerAccounts } from './api-accounts.js';
import { importHtml } from './importer.js';
import { zipStore } from './zip.js';
import { openapi } from './openapi.js';
import { registerAgentRoutes } from './api-agent.js';
import { registerMaterialRoutes } from './api-materials.js';
import { registerAlignment } from './alignment.js';
import { createSchematics } from './schematics.js';
import { registerStationRoutes, endCannonJobs } from './api-stations.js';
import { sceneJson, blueprintsBinary } from './viewer-data.js';
import { registerPreviewRoutes } from './preview/service.js';
import { registerRealtime } from './realtime.js';
import { registerProjectRoutes } from './api-projects.js';
import { registerTerrainRoutes } from './api-terrain.js';
import { registerProjectStoneRoutes } from './api-project-stone.js';
import { registerEreborArchitectureRoutes } from './api-erebor-architecture.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const page = name => readFileSync(join(root, 'public', name), 'utf8');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

export async function buildServer(config = defaultConfig) {
  const db = openDb(config.dataDir);
  const campus = new Campus(db, config);
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, bodyLimit: config.maxUploadBytes, trustProxy: true });
  app.decorate('campus', campus);
  await app.register(cookie);
  await app.register(fastifyStatic, { root: join(root, 'public', 'assets'), prefix: '/assets/' });
  await app.register(fastifyStatic, { root: join(root, 'public', 'viewer'), prefix: '/viewer/', decorateReply: false, index: false, maxAge: '10m' });
  await app.register(fastifyStatic, { root: join(root, 'node_modules', 'three'), prefix: '/vendor/three/', decorateReply: false, index: false, maxAge: '7d', allowedPath: p => /^\/(build|examples\/jsm)\//.test(p) });
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

  registerRealtime(app, campus, config.realtime);

  const html = (reply, body) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(body);
  // ---------- pages ----------
  app.get('/', async (req, reply) => reply.redirect(req.actor && !req.actor.invalid ? '/erebor/dashboard' : '/login'));
  app.get('/login', async (req, reply) => html(reply, page('login.html')));
  app.get('/invite/:code', async (req, reply) => html(reply, page('invite.html')));
  function workspacePage(path, file, section) {
    app.get(path, async (req,reply)=>{
      if(req.actor?.via!=='session')return reply.redirect('/login');
      return html(reply,campusPage(page(file),req.actor,section));
    });
  }
  workspacePage('/app','app.html','orders');
  workspacePage('/erebor/dashboard','erebor-dashboard.html','dashboard');
  workspacePage('/projects','projects.html','projects');
  app.get('/erebor/bauzaehler',async(req,reply)=>reply.redirect(req.actor?.via==='session'?'/erebor/dashboard':'/login'));
  app.get('/docs', async (req, reply) => html(reply, campusPage(page('docs.html'),req.actor)));
  app.get('/viewer', async (req, reply) => (req.actor?.via === 'session' ? html(reply, page('viewer/index.html')) : reply.redirect('/login')));
  app.get('/healthz', async () => ({ ok: true, version, time: now(), live: campus.latestSnapshot('live')?.capturedAt ?? null }));
  app.get('/api/openapi.json', async () => openapi(config.publicUrl));

  registerAccounts(app, db, config);
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

  const blueprintPreviews = registerPreviewRoutes(app, campus);
  registerProjectRoutes(app, campus);

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
    for (const r of db.prepare('SELECT name FROM cannons WHERE blueprint_id = ?').all(req.params.id)) {
      if (alignment.busy(r.name)) throw new HttpError(409, 'Ein Schematic wird gerade eingesetzt. Bitte kurz warten.');
    }
    campus.archive(req.params.id, a);
    endCannonJobs(db, req.params.id, a);
    return { ok: true };
  });

  registerAgentRoutes(app, campus);
  registerProjectStoneRoutes(app, campus, blueprintPreviews);
  registerEreborArchitectureRoutes(app, campus, blueprintPreviews);
  registerTerrainRoutes(app, campus);
  const materials = registerMaterialRoutes(app, campus);
  const schematics = createSchematics(campus, materials);
  const alignment = registerAlignment(app, campus, schematics);
  registerStationRoutes(app, campus, materials, alignment, schematics);
  campus.ereborGroupFeeders=registerGroupFeeders(app,campus); // no provisioned identities by default

  // ---------- viewer data ----------
  const snapParam = q => (q.snapshot && q.snapshot !== 'none' ? campus.getSnapshot(Number(q.snapshot)).id : q.snapshot === 'none' ? null : campus.latestSnapshot('live')?.id ?? null);
  app.get('/api/viewer/scene', async req => { requireActor(req, 'read'); return sceneJson(campus, snapParam(req.query), req.query.project); });
  app.get('/api/viewer/blueprints.bin', async (req, reply) => {
    requireActor(req, 'read');
    const bin = blueprintsBinary(campus, snapParam(req.query), req.query.project);
    reply.header('ETag', bin.etag).header('Cache-Control', 'private, no-cache').type('application/octet-stream');
    if (req.headers['if-none-match'] === bin.etag) return reply.code(304).send();
    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return reply.header('Content-Encoding', 'gzip').send(bin.gzip);
    return reply.send(bin.body);
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
