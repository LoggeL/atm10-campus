import {setProjectArchive} from './project-archive.js';
import { requireActor, HttpError } from './auth.js';
import { now, tx, logActivity } from './db.js';
import { validPlacement } from './project-placement.js';
import { validateMountain } from './project-stone.js';
import { registerEreborQueue } from './erebor-queue.js';
import { registerEreborFleet } from './api-erebor-fleet.js';

// Projects describe plans or link existing blueprints; saving has no world side effects.
export function registerProjectRoutes(app, campus) {
  registerEreborFleet(app,campus);
  registerEreborQueue(app,campus);
  const db = campus.db;
  db.exec('CREATE TABLE IF NOT EXISTS project_archive(project_id TEXT PRIMARY KEY REFERENCES build_projects(id),archived_at TEXT NOT NULL)');
  const archivedAt=id=>db.prepare('SELECT archived_at FROM project_archive WHERE project_id=?').get(id)?.archived_at??null;
  const decode = r => ({ archivedAt:archivedAt(r.id), id: r.id, version: r.current_version, createdAt: r.created_at, updatedAt: r.updated_at, plan: JSON.parse(r.plan_json) });
  const get = id => db.prepare('SELECT * FROM build_projects WHERE id = ?').get(id);
  function siteLayout(id) {
    const project = get(id);
    if (!project) throw new HttpError(404, 'Bauprojekt nicht gefunden.');
    const stations = JSON.parse(project.plan_json).cannonLayout?.stations || [];
    return {version: project.current_version, stations};
  }
  const siteProgress = db.prepare('SELECT revision AS version, placed, ready FROM cannon_site_progress WHERE project_id=? AND site_id=? AND x=? AND y=? AND z=?');
  function progressOf(id, site) {
    const row = siteProgress.get(id, site.id, ...site.position);
    return {version: row?.version ?? 0, placed: !!row?.placed, ready: !!row?.ready};
  }
  app.get('/api/projects/:id/cannon-sites/status', async (req, reply) => {
    requireActor(req, 'read');
    const {version, stations} = siteLayout(req.params.id);
    reply.header('Cache-Control', 'private, no-store');
    return {projectVersion: version, sites: Object.fromEntries(stations.map(s => [s.id, progressOf(req.params.id, s)]))};
  });
  app.put('/api/projects/:id/cannon-sites/:site/status', async req => {
    const actor = requireActor(req, 'write'), {id, site: siteId} = req.params, b = req.body;
    if (!b || !Number.isSafeInteger(b.projectVersion) || !Number.isSafeInteger(b.baseVersion) ||
        b.baseVersion < 0 || typeof b.placed !== 'boolean' || typeof b.ready !== 'boolean' ||
        (b.ready && !b.placed) || (b.dryRun !== undefined && typeof b.dryRun !== 'boolean'))
      throw new HttpError(400, 'Projektversion, Statusversion und gültige Häkchen erforderlich. Betriebsbereit setzt Aufgestellt voraus.');
    return tx(db, () => {
      const {version, stations} = siteLayout(id);
      if (version !== b.projectVersion) throw new HttpError(409, 'Der Standortplan wurde geändert. Bitte neu laden.');
      const site = stations.find(s => s.id === siteId);
      if (!site) throw new HttpError(404, 'Kanonenplatz nicht gefunden.');
      const current = progressOf(id, site);
      if (current.version !== b.baseVersion) throw new HttpError(409, 'Der Status wurde inzwischen geändert. Bitte neu laden.');
      if (current.placed === b.placed && current.ready === b.ready) return current;
      const next = {version: current.version + 1, placed: b.placed, ready: b.ready};
      if (b.dryRun) return next;
      db.prepare(`INSERT INTO cannon_site_progress(project_id,site_id,x,y,z,revision,placed,ready) VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,site_id,x,y,z) DO UPDATE SET revision=excluded.revision, placed=excluded.placed, ready=excluded.ready`)
        .run(id, siteId, ...site.position, next.version, Number(next.placed), Number(next.ready));
      logActivity(db, actor, 'cannon.site.status', id + '/' + siteId, next);
      return next;
    });
  });
  app.get('/api/projects', async req => {
    requireActor(req, 'read');
    return db.prepare('SELECT p.* FROM build_projects p LEFT JOIN project_archive a ON a.project_id=p.id WHERE (?=1 OR a.project_id IS NULL) ORDER BY p.updated_at DESC,p.id').all(req.query.includeArchived==='1'?1:0).map(r => {
      const p = decode(r);
      return { archivedAt:p.archivedAt,id: p.id, version: p.version, title: p.plan.title, summary: p.plan.summary, updatedAt: p.updatedAt, status: p.plan.status, blueprintCount: p.plan.blueprintIds?.length };
    });
  });
  app.get('/api/projects/:id', async (req, reply) => {
    requireActor(req, 'read');
    const r = get(req.params.id);
    if (!r) throw new HttpError(404, 'Bauprojekt nicht gefunden.');
    reply.header('Cache-Control', 'private, no-store');
    return decode(r);
  });
  app.post('/api/projects/:id/archive',async req=>{
    const actor=requireActor(req,'admin');
    if(req.headers.origin&&req.headers.origin!==campus.config.publicUrl)throw new HttpError(403,'Fremder Origin.');
    return setProjectArchive(db,req.params.id,req.body?.baseVersion,req.body?.archived,actor);
  });
  app.put('/api/projects/:id', { bodyLimit: 512 * 1024 }, async req => {
    const actor = requireActor(req, 'write'), id = req.params.id, body = req.body;
    if(archivedAt(id))throw new HttpError(409,'Dieses Bauprojekt ist archiviert.');
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new HttpError(400, 'Projekt-ID: 1–80 Kleinbuchstaben, Ziffern, _ oder -.');
    if (!body || !Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0) throw new HttpError(400, 'baseVersion ist erforderlich (0 bei einem neuen Projekt).');
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new HttpError(400, 'dryRun muss boolean sein.');
    const plan = body.plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 160 || typeof plan.summary !== 'string' || plan.summary.length > 4000) throw new HttpError(400, 'plan benötigt title (1–160 Zeichen) und summary (max. 4000).');
    if (plan.status === 'existing') {
      if (plan.kind !== 'blueprint_collection' || plan.worldOrigin !== null || plan.mountainFill || !Array.isArray(plan.blueprintIds) || !plan.blueprintIds.length || plan.blueprintIds.length > 2000 || plan.blueprintIds.some(id => typeof id !== 'string' || !id || id.length > 200) || new Set(plan.blueprintIds).size !== plan.blueprintIds.length)
        throw new HttpError(400, 'Bestehende Projekte benötigen kind=blueprint_collection, worldOrigin=null und eindeutige blueprintIds.');
      const exists = db.prepare('SELECT id FROM blueprints WHERE id=? AND archived_at IS NULL');
      if (plan.blueprintIds.some(id => !exists.get(id))) throw new HttpError(400, 'Ein verknüpfter Bauplan fehlt oder ist archiviert.');
    } else if (plan.status !== 'planning' || plan.kind === 'blueprint_collection' || !validPlacement(plan)) throw new HttpError(400, 'Planung benötigt worldOrigin=null oder einen geplanten Standort mit rotationDegrees (0/90/180/270) und site.status=planned.');
    if (plan.mountainFill) { try { validateMountain(plan); } catch(e) { throw new HttpError(400,e.message); } }
    // Validation/dryRun and the compare-and-swap use the same transaction.
    return tx(db, () => {
      const old = get(id), currentVersion = old?.current_version ?? 0;
      if (body.baseVersion !== currentVersion) throw new HttpError(409, 'Projekt wurde inzwischen geändert. Neu laden und abgleichen.', { currentVersion });
      const text = JSON.stringify(plan), unchanged = old?.plan_json === text, version = unchanged ? currentVersion : currentVersion + 1;
      if (body.dryRun) return { dryRun: true, id, currentVersion, nextVersion: version, unchanged: !!unchanged, worldPlacement: false };
      if (unchanged) return { unchanged: true, project: decode(old) };
      const at = now();
      db.prepare(`INSERT INTO build_projects (id, current_version, plan_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET current_version=excluded.current_version, plan_json=excluded.plan_json, updated_at=excluded.updated_at`).run(id, version, text, at, at);
      db.prepare('INSERT INTO build_project_versions (project_id, version, plan_json, saved_at, user_id) VALUES (?, ?, ?, ?, ?)').run(id, version, text, at, actor.user.id);
      logActivity(db, actor, 'project.save', id, { version, title: plan.title });
      return { project: decode(get(id)) };
    });
  });
}
