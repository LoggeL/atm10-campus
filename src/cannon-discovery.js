// Match a reporting CC computer to the saved world, then require the signed host
// to prove that exact computer/chest/cannon chain against the live game.
import { isDeepStrictEqual } from 'node:util';
import { HttpError } from './auth.js';
import { now, tx, logActivity } from './db.js';

const fresh = status => Number.isFinite(Date.parse(status?.at)) && Date.now() - Date.parse(status.at) < 180_000;
const statusOf = row => JSON.parse(row?.status_json || 'null');
const identityOf = status => JSON.stringify({
  computerId: status?.computerId ?? null,
  side: status && Object.hasOwn(status, 'chestSide') ? status.chestSide : status?.chest?.name ?? null,
});
const same = isDeepStrictEqual;

export function createCannonDiscovery({ app, campus, schematics, request, row, record, withStationsLocked, busy, afterBound }) {
  const db = campus.db, config = campus.config;
  const configured = config.cannonDiscoveryEnabled !== false;
  const intervalMs = config.cannonDiscoveryIntervalMs ?? 30_000;
  const scan = config.cannonDiscoveryScan || (async (...args) => (await import('./cannon-discovery-map.js')).discoverCannon(...args));
  const bridgeAvailable = !!(config.cannonBridgeRequest || (config.cannonBridgeUrl && config.cannonBridgeSecret?.length >= 32));
  db.exec(`CREATE TABLE IF NOT EXISTS cannon_discovery (
    name TEXT PRIMARY KEY COLLATE NOCASE REFERENCES cannons(name) ON DELETE CASCADE,
    automatic INTEGER NOT NULL DEFAULT 1, identity_json TEXT, candidate_json TEXT, state_json TEXT NOT NULL
  )`);
  const saved = name => db.prepare('SELECT * FROM cannon_discovery WHERE name=?').get(name);
  let timer, kickTimer, running = null, closing = false;
  const managed = name => {
    const stored = saved(name);
    if (stored) return !!stored.automatic;
    return configured && statusOf(row(name))?.script === '1.4.0';
  };
  function eligibility(name, status) {
    if (!configured) return { state:'disabled', message:'Automatische Standorterkennung ist auf dem Server ausgeschaltet.' };
    if (!bridgeAvailable || !config.worldSources?.live) return {state:'unsupported',message:'Live-Brücke oder lesbare Welt für die automatische Erkennung fehlen.'};
    if (status?.script !== '1.4.0' || !Number.isSafeInteger(status?.computerId) || status.computerId < 0) {
      return {state:'pending',message:'Warte auf die Computer-ID des aktuellen Versorgers.'};
    }
    if (!fresh(status)) return {state:'offline',message:'Computer meldet sich nicht mehr. Gespeicherte Position bleibt erhalten; Vorbereitung wartet.'};
    const duplicate = db.prepare('SELECT name,status_json FROM cannons WHERE name<>? COLLATE NOCASE').all(name).find(other => {
      const reported = statusOf(other);
      return fresh(reported) && reported?.computerId === status.computerId;
    });
    if (duplicate) return {state:'ambiguous',message:`Computer ${status.computerId} meldet sich auch als ${duplicate.name}. Stationsnamen am Computer eindeutig einstellen.`};
    return null;
  }
  function view(name) {
    const stored = saved(name), status = statusOf(row(name));
    if (!managed(name)) return null;
    const previous = stored && JSON.parse(stored.state_json);
    const invalid = eligibility(name,status);
    if (invalid) return {...invalid,automatic:true,computerId:status?.computerId ?? null,checkedAt:previous?.checkedAt ?? null};
    if (!stored || stored.identity_json !== identityOf(status)) return {state:'pending',message:'Computer erkannt. Position von Kiste und Kanone wird geprüft.',automatic:true,computerId:status.computerId,checkedAt:previous?.checkedAt ?? null};
    if (previous.state === 'bound' && (!record(name) || Date.now()-Date.parse(previous.checkedAt)>90_000)) return {...previous,state:'pending',message:'Gespeicherte Position wird erneut live geprüft.'};
    return previous;
  }
  function save(name, status, state, candidate = null) {
    const value = {...state,automatic:true,computerId:status?.computerId ?? null,checkedAt:now()};
    const previous = saved(name), before = previous && JSON.parse(previous.state_json);
    db.prepare(`INSERT INTO cannon_discovery(name,automatic,identity_json,candidate_json,state_json) VALUES(?,1,?,?,?)
      ON CONFLICT(name) DO UPDATE SET automatic=1,identity_json=excluded.identity_json,candidate_json=excluded.candidate_json,state_json=excluded.state_json`)
      .run(name,identityOf(status),candidate ? JSON.stringify(candidate) : null,JSON.stringify(value));
    if (JSON.stringify([before?.state,before?.message,before?.computerId,previous?.identity_json]) !== JSON.stringify([value.state,value.message,value.computerId,identityOf(status)])) app.updates?.publish('cannons',name);
    return value;
  }
  async function verify(name, actor) {
    const original = row(name);
    if (!original) throw new HttpError(404,'Station nicht gefunden.');
    const status = statusOf(original), identity = identityOf(status), originalBinding = record(name)?.binding_json;
    const unchanged = () => {
      const current = row(name), latest = statusOf(current);
      return current && current.assignment === original.assignment && identityOf(latest) === identity && latest?.script === status?.script && !eligibility(name,latest) && record(name)?.binding_json === originalBinding;
    };
    const invalid = eligibility(name,status);
    if (invalid) { save(name,status,invalid); throw new HttpError(409,invalid.message); }
    let diagnosed=false;
    try {
      const found = await scan(config,status);
      if (!unchanged()) throw new HttpError(409,'Computer, Auftrag oder Bindung während Standortprüfung geändert. Erneute Erkennung folgt.');
      if (found?.state !== 'found' || !found.candidate) {
        const failure = {state:['missing','ambiguous','unsupported'].includes(found?.state)?found.state:'error',message:found?.message || 'Standort konnte nicht eindeutig ermittelt werden.'};
        save(name,status,failure);diagnosed=true;throw new HttpError(409,failure.message);
      }
      const candidate = structuredClone(found.candidate);
      // A previously selected schematic owner belongs to the binding, not to a
      // generic scanner default. Preserve it for both revalidation and moves.
      const oldBinding = originalBinding ? JSON.parse(originalBinding) : null;
      if (oldBinding) candidate.binding.owner = oldBinding.owner;
      const result = await request('discover',{station:original.name,candidate});
      if (!unchanged()) throw new HttpError(409,'Computer oder Auftrag während Live-Erkennung geändert. Keine Materialfreigabe.');
      if (!result?.discovered || !same(result.binding,candidate.binding)) throw new HttpError(409,'Live-Erkennung bestätigt nicht die ermittelte Kanone.');
      const changed = !same(oldBinding,result.binding);
      tx(db,()=>{
        if (changed) {
          db.prepare(`INSERT INTO cannon_alignment(name,binding_json,updated_at) VALUES(?,?,?)
            ON CONFLICT(name) DO UPDATE SET binding_json=excluded.binding_json,applied_json=NULL,last_error=NULL,updated_at=excluded.updated_at`)
            .run(original.name,JSON.stringify(result.binding),now());
          schematics.clear(original.name);
        }
        schematics.enableDefault(original.name);
        save(original.name,status,{state:'bound',message:`Kanone automatisch erkannt: ${result.binding.x} ${result.binding.y} ${result.binding.z}.`},candidate);
      });
      if (changed) logActivity(db,actor,'cannon.discovered',original.name,{computerId:status.computerId,binding:result.binding});
      return {changed,discovery:view(original.name),identity,assignment:original.assignment,binding:record(original.name).binding_json};
    } catch(error) {
      // Keep a specific scan diagnosis. Host refusals and identity races remain
      // fail-closed even when the old binding and previous ready job still exist.
      if (!diagnosed) {
        save(name,status,{state:error.statusCode===409?'blocked':'error',message:String(error.message).slice(0,500)});
      }
      throw error;
    }
  }
  async function ensure(name, {locked = false, actor = null, automatic = false} = {}) {
    if (!automatic && !managed(name)) return null;
    if (closing) throw new HttpError(503,'Standortprüfung wird beendet.');
    return locked ? verify(name,actor) : withStationsLocked([name],()=>verify(name,actor));
  }
  function assertCurrent(name, proof) {
    if (!proof) return;
    const current=row(name), status=statusOf(current);
    if (!current || current.assignment!==proof.assignment || identityOf(status)!==proof.identity || eligibility(name,status) || record(name)?.binding_json!==proof.binding || view(name)?.state!=='bound') {
      throw new HttpError(409,'Computer, Auftrag oder Position während des Kanonen-Auftrags geändert. Keine Materialfreigabe.');
    }
  }
  function proof(name) {
    if(!managed(name))return null;
    const current=row(name);
    return {identity:identityOf(statusOf(current)),assignment:current?.assignment,binding:record(name)?.binding_json};
  }
  async function discover(name, actor = null, force = false) {
    const stored = saved(name), reported = statusOf(row(name));
    if (!force && (!managed(name) || busy(name))) return;
    if (!force && stored && stored.identity_json === identityOf(reported) && Date.now()-Date.parse(JSON.parse(stored.state_json).checkedAt)<intervalMs) return;
    const result = await ensure(name,{actor,automatic:force});
    if (result?.changed && !closing) await afterBound(name,actor);
    return result?.discovery;
  }
  async function run() {
    if (closing || running) return running;
    running = (async()=>{
      for (const r of db.prepare('SELECT name FROM cannons ORDER BY name').all()) {
        if (closing) break;
        try { await discover(r.name); } catch { /* Stored diagnosis is returned by alignment.view. */ }
      }
    })();
    try { await running; } finally { running = null; }
  }
  function kick() {
    if (!closing && !kickTimer) { kickTimer=setTimeout(()=>{kickTimer=null;void run();},150);kickTimer.unref(); }
  }
  function manual(name) {
    db.prepare(`INSERT INTO cannon_discovery(name,automatic,state_json) VALUES(?,0,?)
      ON CONFLICT(name) DO UPDATE SET automatic=0,state_json=excluded.state_json`).run(name,JSON.stringify({state:'manual',message:'Kanonenblock manuell bestätigt.',checkedAt:now()}));
  }
  app.addHook('onResponse',async(req,reply)=>{
    if (req.method==='POST' && req.routeOptions.url==='/api/cannons/:name/status' && reply.statusCode<300) kick();
  });
  app.addHook('onReady',async()=>{kick();timer=setInterval(kick,intervalMs);timer.unref();});
  app.addHook('preClose',async()=>{closing=true;clearTimeout(kickTimer);clearInterval(timer);});
  app.addHook('onClose',async()=>{if(running)await running;});
  return {view,managed,ensure,assertCurrent,proof,discover,manual,kick};
}
