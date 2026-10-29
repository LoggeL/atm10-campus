// Assembles the data package the imported viewer expects (same shape as the original EMBEDDED_PACKAGE),
// with blueprints from the database and "Bestand" from a live snapshot.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { loadViewerAssets } from './importer.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function buildViewerPackage(campus, snapshotId) {
  const assets = loadViewerAssets(campus.config.dataDir);
  if (!assets) return null;
  const { extras } = assets;
  const { manifestGlobals = {}, importedContext, ...rest } = extras;
  const blueprints = campus.listBlueprints().filter(b => b.current);
  const modules = blueprints.map(b => ({
    ...b.meta, file: b.fileName, name: b.name, category: b.category, description: b.description,
    origin: b.current.origin, size: b.current.size, placed_blocks: b.current.stats.placed, sha256: b.current.sha256,
    campus_version: b.currentVersion,
  }));
  const files = blueprints.map(b => ({ name: b.fileName, base64: campus.readVersionBytes(b.id, b.current.version).toString('base64') }));
  let context = null;
  if (snapshotId) {
    const dir = campus.snapshotDir(snapshotId);
    if (existsSync(join(dir, 'context.json'))) {
      context = JSON.parse(readFileSync(join(dir, 'context.json'), 'utf8'));
      context.base64 = readFileSync(join(dir, 'surfaces.bin.gz')).toString('base64');
    }
  }
  return {
    ...rest,
    manifest: { ...manifestGlobals, module_count: modules.length, placed_blocks: modules.reduce((a, m) => a + (m.placed_blocks || 0), 0), modules },
    files,
    context,
  };
}

// Cached JS payload (`window.CAMPUS_PACKAGE = …`), gzip-precompressed.
export function viewerPackageScript(campus, snapshotId) {
  const key = campus.status().edition.versionsKey + ':' + snapshotId;
  if (campus.viewerCache?.key === key) return campus.viewerCache.value;
  const pkg = buildViewerPackage(campus, snapshotId);
  if (!pkg) return null;
  const body = Buffer.from('window.CAMPUS_PACKAGE=' + JSON.stringify(pkg) + ';\n');
  const value = { body, gzip: gzipSync(body, { level: 6 }), etag: '"' + createHash('sha1').update(body).digest('hex') + '"' };
  campus.viewerCache = { key, value };
  return value;
}

export function renderViewerHtml(campus, snapshot) {
  const assets = loadViewerAssets(campus.config.dataDir);
  if (!assets) return null;
  const sid = snapshot ? snapshot.id : 'none';
  const at = snapshot && new Date(snapshot.worldTime || snapshot.capturedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' });
  const label = snapshot ? `${snapshot.source === 'live' ? 'LIVE' : snapshot.label} · ${at}` : 'KEIN BESTAND';
  const contextDate = snapshot ? `${at} (${snapshot.source === 'live' ? 'live' : snapshot.label})` : '–';
  const nav = `<a href="/app" style="color:var(--cyan,#73d8e5);text-decoration:none;font-size:13px;margin-left:auto;margin-right:12px">← Übersicht</a>`;
  return assets.template
    .replace('{{CAMPUS_PACKAGE_SCRIPT}}', `<script src="/api/viewer/package.js?snapshot=${esc(sid)}"></script>`)
    .replace('{{CAMPUS_NAV}}', nav)
    .replace('{{CAMPUS_BADGE}}', esc(label))
    .split('{{CAMPUS_CONTEXT_DATE}}').join(esc(contextDate));
}
