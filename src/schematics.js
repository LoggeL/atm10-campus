// Immutable rest plans handed to the existing signed host controller.
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpError } from './auth.js';
import { now, logActivity } from './db.js';

const DEFAULTS = { enabled: false, autoUpdate: true, replaceMode: 2, skipMissing: false, protectBlockEntities: true };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const decode = s => JSON.parse(s || 'null');
export function schematicSettings(input = {}, base = DEFAULTS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Schematic-Einstellungen als Objekt senden.');
  const out = { ...DEFAULTS, ...base };
  for (const key of ['enabled', 'autoUpdate', 'skipMissing', 'protectBlockEntities']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') throw new HttpError(400, `${key}: Boolean erwartet.`);
    out[key] = input[key];
  }
  if (input.replaceMode !== undefined) {
    if (![0, 1, 2].includes(input.replaceMode)) throw new HttpError(400, 'Rest-Schematics erlauben Ersetzungsmodus 0, 1 oder 2.');
    out.replaceMode = input.replaceMode;
  }
  return out;
}
export function createSchematics(campus, mat) {
  const db = campus.db, dir = join(campus.config.dataDir, 'schematics');
  mkdirSync(dir, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS cannon_schematics (
    cannon TEXT PRIMARY KEY COLLATE NOCASE REFERENCES cannons(name) ON DELETE CASCADE,
    settings_json TEXT NOT NULL DEFAULT '{}', job_json TEXT
  )`);
  const rowFor = name => db.prepare('SELECT * FROM cannon_schematics WHERE cannon = ?').get(name);
  const jobFor = name => decode(rowFor(name)?.job_json);
  const settingsFor = name => schematicSettings({}, decode(rowFor(name)?.settings_json) || DEFAULTS);
  const saveJob = (name, job) => db.prepare('UPDATE cannon_schematics SET job_json = ? WHERE cannon = ?').run(JSON.stringify(job), name);
  const view = name => {
    const job = jobFor(name);
    if (!job) return { settings: settingsFor(name), job: null };
    const { signature, ...publicJob } = job;
    return { settings: settingsFor(name), job: publicJob };
  };
  const configure = (name, input) => {
    const settings = schematicSettings(input, settingsFor(name));
    db.prepare(`INSERT INTO cannon_schematics (cannon, settings_json) VALUES (?, ?)
      ON CONFLICT(cannon) DO UPDATE SET settings_json = excluded.settings_json`).run(name, JSON.stringify(settings));
    return settings;
  };
  const sync = (row, snap, binding, force = false) => {
    const settings = settingsFor(row.name);
    if (!settings.enabled || !row.blueprint_id || !snap) return view(row.name);
    if (!binding || binding.dimension !== 'minecraft:overworld') throw new HttpError(400, 'Zuerst den Kanonen-Block in der Oberwelt unter Ausrichtung bestätigen.');
    const bp = campus.getBlueprint(row.blueprint_id);
    if (bp.archived) return view(row.name);
    const v = campus.version(bp.id, settings.autoUpdate ? bp.currentVersion : row.version);
    const skipBlocked = JSON.parse(row.options_json || '{}').skipBlocked !== false;
    const signature = hash(JSON.stringify({ blueprint: bp.id, version: v.version, settings, skipBlocked, binding }));
    const old = jobFor(row.name);
    if (!force && old?.signature === signature) return view(row.name);
    if (Math.hypot(...v.origin.map((n, i) => n - [binding.x, binding.y, binding.z][i])) >= 256) throw new HttpError(400, 'Bauplan-Ursprung muss weniger als 256 Blöcke von der Kanone entfernt sein.');
    const rest = mat.remainingOf(bp, v, snap, { skipBlocked });
    const id = randomUUID(), fileName = `campus_${id}.nbt`;
    if (rest.bytes.length > 16 * 1024 * 1024) throw new HttpError(400, 'Rest-Schematic ist größer als 16 MB.');
    if (rest.stats.kept) writeFileSync(join(dir, fileName), rest.bytes, { flag: 'wx' });
    saveJob(row.name, { id, signature, fileName, sha256: hash(rest.bytes), state: rest.stats.kept ? 'queued' : 'empty',
      message: rest.stats.kept ? 'Wartet auf eine vollständig gestoppte Kanone.' : 'Keine baubaren Blöcke im aktuellen Rest-Plan.',
      cannon: row.name, blueprint: bp.id, version: v.version, snapshot: snap.id, origin: v.origin, size: v.size, owner: binding.owner,
      createdAt: now(), blocks: rest.stats.kept });
    return view(row.name);
  };
  const ready = (name, id) => {
    const job = jobFor(name);
    if (!job || job.id !== id) throw new HttpError(409, 'Schematic-Auftrag wurde geändert.');
    const row = db.prepare('SELECT * FROM cannons WHERE name = ?').get(name);
    job.state = 'ready'; job.updatedAt = now();
    job.message = `Bauplan v${job.version} eingesetzt, Ziel ${job.origin.join(' ')}. Zum Bauen Play an der Kanone drücken.`;
    saveJob(name, job);
    db.prepare('UPDATE cannons SET version = ?, assignment = ?, start_json = NULL, updated_at = ? WHERE name = ?')
      .run(job.version, Math.max(row.assignment + 1, Math.floor(Date.now() / 1000)), now(), row.name);
  };
  const waiting = (name, id, message) => {
    const job = jobFor(name);
    if (job?.id === id) saveJob(name, { ...job, state: 'waiting', message: String(message).slice(0, 400), updatedAt: now() });
  };
  return { view, configure, sync, ready, waiting, settingsFor, bytes: job => readFileSync(join(dir, job.fileName)) };
}
