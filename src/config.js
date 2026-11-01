import { resolve } from 'node:path';

const triple = (s, fallback) => {
  if (!s) return fallback;
  const v = s.split(',').map(Number);
  if (v.length !== 3 || !v.every(Number.isInteger)) throw new Error('Ungültige Koordinaten: ' + s);
  return v;
};

// WORLD_SOURCES: "name=/path/to/world;other=/path" — extra read-only worlds (e.g. backups) for baseline snapshots.
const sources = { live: process.env.WORLD_DIR || '/worlds/live' };
for (const part of (process.env.WORLD_SOURCES || '').split(';').map(s => s.trim()).filter(Boolean)) {
  const i = part.indexOf('=');
  if (i > 0) sources[part.slice(0, i).trim()] = part.slice(i + 1).trim();
}

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: resolve(process.env.DATA_DIR || './data'),
  worldSources: sources,
  contextOrigin: triple(process.env.CONTEXT_ORIGIN, [-64, 48, -96]),
  contextSize: triple(process.env.CONTEXT_SIZE, [288, 272, 320]),
  snapshotIntervalMin: Number(process.env.SNAPSHOT_INTERVAL_MIN || 10),
  snapshotKeepRecent: Number(process.env.SNAPSHOT_KEEP_RECENT || 48),
  bootstrapInvite: process.env.BOOTSTRAP_INVITE || '',
  // First start: pinned baseline from this world source, then import of this viewer HTML on top of it.
  seedBaselineSource: process.env.SEED_BASELINE_SOURCE || '',
  seedBaselineLabel: process.env.SEED_BASELINE_LABEL || '',
  seedHtml: process.env.SEED_HTML || '',
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  cookieSecure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
  cannonBridgeUrl: process.env.CANNON_BRIDGE_URL || '',
  cannonBridgeSecret: process.env.CANNON_BRIDGE_SECRET || '',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 64) * 1024 * 1024,
};
