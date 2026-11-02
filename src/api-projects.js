import { requireActor, HttpError } from './auth.js';
import { now, tx, logActivity } from './db.js';
import { validPlacement } from './project-placement.js';
import { validateMountain } from './project-stone.js';

// Concept plans deliberately have no blueprint/cannon/world side effects.
export function registerProjectRoutes(app, campus) {
  const db = campus.db;
  const decode = r => ({ id: r.id, version: r.current_version, createdAt: r.created_at, updatedAt: r.updated_at, plan: JSON.parse(r.plan_json) });
  const get = id => db.prepare('SELECT * FROM build_projects WHERE id = ?').get(id);
  app.get('/api/projects', async req => {
    requireActor(req, 'read');
    return db.prepare('SELECT * FROM build_projects ORDER BY updated_at DESC, id').all().map(r => {
      const p = decode(r);
      return { id: p.id, version: p.version, title: p.plan.title, summary: p.plan.summary, updatedAt: p.updatedAt, status: 'planning' };
    });
  });
  app.get('/api/projects/:id', async (req, reply) => {
    requireActor(req, 'read');
    const r = get(req.params.id);
    if (!r) throw new HttpError(404, 'Bauprojekt nicht gefunden.');
    reply.header('Cache-Control', 'private, no-store');
    return decode(r);
  });
  app.put('/api/projects/:id', { bodyLimit: 512 * 1024 }, async req => {
    const actor = requireActor(req, 'write'), id = req.params.id, body = req.body;
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(id)) throw new HttpError(400, 'Projekt-ID: 1–80 Kleinbuchstaben, Ziffern, _ oder -.');
    if (!body || !Number.isSafeInteger(body.baseVersion) || body.baseVersion < 0) throw new HttpError(400, 'baseVersion ist erforderlich (0 bei einem neuen Projekt).');
    if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new HttpError(400, 'dryRun muss boolean sein.');
    const plan = body.plan;
    if (!plan || typeof plan !== 'object' || Array.isArray(plan) || typeof plan.title !== 'string' || !plan.title.trim() || plan.title.length > 160 || typeof plan.summary !== 'string' || plan.summary.length > 4000) throw new HttpError(400, 'plan benötigt title (1–160 Zeichen) und summary (max. 4000).');
    if (plan.status !== 'planning' || !validPlacement(plan)) throw new HttpError(400, 'Planung benötigt worldOrigin=null oder einen geplanten Standort mit rotationDegrees (0/90/180/270) und site.status=planned.');
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
