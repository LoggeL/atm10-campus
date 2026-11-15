import { readFileSync } from 'node:fs';
import { requireActor, HttpError } from './auth.js';
import { now, tx, logActivity } from './db.js';
import { DESIGN_REVISION } from './erebor-design.js';

const station = 'erebor-K02';
const base = '/api/projects/erebor/connecting-auftrag';
const version = 12, revision = 5;
const worker = readFileSync(new URL('../public/assets/erebor-chisel-order.lua', import.meta.url), 'utf8');
const targets = Object.fromEntries([...worker.matchAll(/^  \{"([^"]+_connecting)", (\d+)\},$/gm)]
  .map(([, item, amount]) => [item, Number(amount)]));
if (Object.keys(targets).length !== 4) throw new Error('Vier Connecting-Zielmengen im ME-Auftrag erwartet.');

export function stationSource() {
  const source = readFileSync(new URL('../public/cc/campus.lua', import.meta.url), 'utf8');
  return source.replace('-- EMBED_EREBOR_ME_WORKER', () => worker);
}

export function registerEreborMeOrder(app, campus) {
  const db = campus.db;
  db.exec(`CREATE TABLE IF NOT EXISTS erebor_connecting_order (
    id INTEGER PRIMARY KEY CHECK(id=1), attempt INTEGER NOT NULL, computer INTEGER NOT NULL,
    token_id INTEGER, state TEXT NOT NULL, updated TEXT NOT NULL, detail TEXT NOT NULL)`);
  const row = () => db.prepare('SELECT * FROM erebor_connecting_order WHERE id=1').get();
  const view = () => {
    const r = row();
    return {station, version, revision, targets, attempt:r?.attempt ?? 0, state:r?.state ?? 'idle',
      updated:r?.updated ?? null, detail:JSON.parse(r?.detail ?? '{}')};
  };
  app.get(base, async (req, reply) => {
    const actor = requireActor(req, 'read');
    return reply.header('Cache-Control','private, no-store').send({...view(),
      canStart:actor.via === 'session' && actor.user.role === 'admin'});
  });
  app.post(base, async req => {
    const actor = requireActor(req, 'admin');
    if (req.headers.origin && req.headers.origin !== campus.config.publicUrl) throw new HttpError(403,'Fremder Origin.');
    return tx(db, () => {
      const r = row();
      if (r && r.state !== 'blocked') return view();
      if (req.body?.attempt !== (r?.attempt ?? 0)) throw new HttpError(409,'Auftragsstatus neu laden.');
      const current = db.prepare("SELECT current_version FROM build_projects WHERE id='erebor'").get();
      if (current?.current_version !== version || DESIGN_REVISION !== revision) throw new HttpError(409,'Der Erebor-Entwurf hat sich geändert.');
      const published = db.prepare(`SELECT material.key AS item, sum(material.value) AS amount
        FROM project_architecture_packages p, json_each(p.report_json,'$.materials') material
        WHERE project_id='erebor' AND base_version=? AND revision=? AND material.key IN (?,?,?,?)
        GROUP BY material.key`).all(version, revision, ...Object.keys(targets));
      if (published.length !== 4 || published.some(v => targets[v.item] !== v.amount))
        throw new HttpError(409,'Die Mengen der veröffentlichten Baupläne haben sich geändert.');
      const status = db.prepare('SELECT status_json FROM cannons WHERE name=?').get(station);
      const computer = JSON.parse(status?.status_json || '{}').computerId;
      if (!Number.isSafeInteger(computer) || computer < 0 || (r && computer !== r.computer))
        throw new HttpError(409,'Der bisherige K02-Computer muss sich beim Campus melden.');
      const attempt = (r?.attempt ?? 0) + 1;
      db.prepare(`INSERT INTO erebor_connecting_order VALUES(1,?,?,NULL,'queued',?,'{}')
        ON CONFLICT(id) DO UPDATE SET attempt=excluded.attempt,state='queued',updated=excluded.updated`).run(attempt, computer, now());
      logActivity(db, actor, 'erebor.me-order.start', station, {attempt, computer, version, revision});
      return view();
    });
  });
  // Only advertise work to the existing station and only after the admin has queued it.
  function attemptFor(name, actor) {
    if (name !== station || actor.via !== 'token' || actor.scope !== 'station') return null;
    const r = row();
    return r && ['queued','running'].includes(r.state) && (r.token_id == null || r.token_id === actor.tokenId) ? r.attempt : null;
  }
  app.post(base+'/station', async req => {
    const a = requireActor(req, 'station');
    if (a.via !== 'token' || a.scope !== 'station') throw new HttpError(403,'Stationszugang erforderlich.');
    const b = req.body || {}, r = row();
    if (!r || b.attempt !== r.attempt || b.computer !== r.computer ||
        (r.token_id != null && a.tokenId !== r.token_id)) throw new HttpError(409,'Auftrag oder Station stimmt nicht.');
    if (['done','blocked'].includes(r.state)) return {accepted:false,state:r.state};
    if (!['claim','progress','done','blocked'].includes(b.event) || (b.event !== 'claim' && r.token_id == null))
      throw new HttpError(400,'Zuerst Auftrag übernehmen.');
    const detail = JSON.parse(r.detail);
    if (b.event === 'progress') {
      if (!Object.hasOwn(targets,b.item) || !['waiting','calculating','crafting','credited','blocked'].includes(b.stage)
        || !Number.isSafeInteger(b.quantity) || b.quantity<0 || b.quantity>targets[b.item]) throw new HttpError(400,'Ungültige ME-Meldung.');
      detail[b.item] = {stage:b.stage,quantity:b.quantity,message:String(b.message||'').slice(0,300),at:now()};
    }
    if (b.event === 'blocked') detail.error = String(b.message||'Auftrag prüfen.').slice(0,600);
    else if (b.event === 'claim') delete detail.error;
    if (b.event === 'done' && !Object.entries(targets).every(([item,n]) => detail[item]?.stage==='credited' && detail[item].quantity===n))
      throw new HttpError(409,'Es fehlen Mengenbestätigungen der ME Bridge.');
    const state = ['done','blocked'].includes(b.event) ? b.event : 'running';
    db.prepare('UPDATE erebor_connecting_order SET token_id=?,state=?,updated=?,detail=? WHERE id=1')
      .run(a.tokenId,state,now(),JSON.stringify(detail));
    return {accepted:true,state};
  });
  return {attemptFor};
}
