import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// read: status + downloads · write: also uploads/edits · station: read + report ME stock and cannon status (CC computers)
const TOKENS_TABLE = name => `CREATE TABLE IF NOT EXISTS ${name} (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','write','station')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member')),
  created_at TEXT NOT NULL,
  disabled_at TEXT
);
CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by INTEGER REFERENCES users(id),
  used_at TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blueprints (
  id TEXT PRIMARY KEY,
  file_name TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS blueprint_versions (
  id INTEGER PRIMARY KEY,
  blueprint_id TEXT NOT NULL REFERENCES blueprints(id),
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  origin_json TEXT NOT NULL,
  size_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  note TEXT,
  base_snapshot_id INTEGER REFERENCES snapshots(id),
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_via TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (blueprint_id, version)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  world_stamp REAL NOT NULL,
  dir TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS analyses (
  version_id INTEGER NOT NULL REFERENCES blueprint_versions(id),
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (version_id, snapshot_id)
);
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY,
  ui_version TEXT,
  source_world_date TEXT,
  note TEXT,
  imported_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  via TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS me_stock (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  source TEXT NOT NULL,
  kinds INTEGER NOT NULL,
  total INTEGER NOT NULL,
  items_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cannons (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  blueprint_id TEXT REFERENCES blueprints(id),
  version INTEGER,
  assignment INTEGER NOT NULL DEFAULT 0,
  options_json TEXT NOT NULL DEFAULT '{}',
  start_json TEXT,
  status_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_versions_bp ON blueprint_versions(blueprint_id, version);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
`;

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'campus.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  db.exec(TOKENS_TABLE('api_tokens'));
  migrateTokenScopes(db);
  return db;
}

// Older databases only allowed read/write tokens; SQLite cannot alter a CHECK, so the table is rebuilt once.
function migrateTokenScopes(db) {
  const t = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'api_tokens'").get();
  if (!t || t.sql.includes("'station'")) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    tx(db, () => {
      db.exec(TOKENS_TABLE('api_tokens_new'));
      db.exec(`INSERT INTO api_tokens_new (id, user_id, name, token_hash, prefix, scope, created_at, last_used_at, revoked_at)
        SELECT id, user_id, name, token_hash, prefix, scope, created_at, last_used_at, revoked_at FROM api_tokens`);
      db.exec('DROP TABLE api_tokens');
      db.exec('ALTER TABLE api_tokens_new RENAME TO api_tokens');
    });
  } finally { db.exec('PRAGMA foreign_keys = ON'); }
}

export const now = () => new Date().toISOString();

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

export function logActivity(db, actor, action, target, detail) {
  db.prepare('INSERT INTO activity (at, user_id, via, action, target, detail_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now(), actor?.user?.id ?? null, actor?.via ?? 'system', action, target ?? null, detail ? JSON.stringify(detail) : null);
}
