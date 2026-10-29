import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','write')),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
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
CREATE INDEX IF NOT EXISTS idx_versions_bp ON blueprint_versions(blueprint_id, version);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity(at);
`;

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'campus.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
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
