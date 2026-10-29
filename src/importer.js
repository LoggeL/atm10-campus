// Imports a self-contained viewer HTML (Jonny's export): blueprints become versions, the rest becomes viewer extras,
// and the HTML minus its embedded data becomes the viewer template.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { HttpError } from './auth.js';
import { now, logActivity } from './db.js';

const MARKER = 'const EMBEDDED_PACKAGE = ';

// Finds the end of the JSON object literal starting at `start` (string-aware brace matching).
function jsonEnd(s, start) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inStr) {
      if (c === 92) i++;            // backslash
      else if (c === 34) inStr = false;
      continue;
    }
    if (c === 34) inStr = true;
    else if (c === 123 || c === 91) depth++;
    else if (c === 125 || c === 93) { depth--; if (depth === 0) return i + 1; }
  }
  throw new HttpError(422, 'Eingebettetes Paket ist nicht vollständig.');
}

export function extractPackage(html) {
  const at = html.indexOf(MARKER);
  if (at < 0) throw new HttpError(422, 'Keine eingebetteten Campus-Daten gefunden (const EMBEDDED_PACKAGE fehlt).');
  const start = at + MARKER.length;
  if (html[start] !== '{') throw new HttpError(422, 'EMBEDDED_PACKAGE ist kein Objekt.');
  const end = jsonEnd(html, start);
  let pkg;
  try { pkg = JSON.parse(html.slice(start, end)); } catch (e) { throw new HttpError(422, 'EMBEDDED_PACKAGE ist kein gültiges JSON: ' + e.message); }
  if (!pkg.manifest || !Array.isArray(pkg.files)) throw new HttpError(422, 'Paket enthält kein manifest/files.');
  return { pkg, template: html.slice(0, start) + 'window.CAMPUS_PACKAGE' + html.slice(end) };
}

// Placeholders the server fills per request. Missing optional patches only produce warnings.
export function patchTemplate(template, sourceWorldDate) {
  const warnings = [];
  let t = template;
  // The export hardcodes its world date ("vom 18.10.2026") in texts; the served Bestand is a live snapshot instead.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(sourceWorldDate || '');
  if (m) t = t.split(`${m[3]}.${m[2]}.${m[1]}`).join('{{CAMPUS_CONTEXT_DATE}}');
  const coreTag = t.indexOf('<script id="nbt-core">');
  const firstScript = coreTag >= 0 ? coreTag : t.indexOf('<script');
  if (firstScript < 0) throw new HttpError(422, 'Viewer enthält kein <script>.');
  t = t.slice(0, firstScript) + '{{CAMPUS_PACKAGE_SCRIPT}}\n' + t.slice(firstScript);
  const badge = /<span class="badge">[^<]*<\/span>/;
  if (badge.test(t)) t = t.replace(badge, '{{CAMPUS_NAV}}<span class="badge">{{CAMPUS_BADGE}}</span>');
  else { t = t.replace('</header>', '{{CAMPUS_NAV}}</header>'); warnings.push('Badge im Header nicht gefunden; Navigation ans Header-Ende gesetzt.'); }
  const notice = /\$\('contextNoticeTitle'\)\.textContent='[^']*';/;
  if (notice.test(t)) t = t.replace(notice, "$('contextNoticeTitle').textContent='Bestand · '+(meta.label||'')+(meta.capturedAt?' · '+new Date(meta.capturedAt).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}):'');");
  else warnings.push('Bestand-Titel nicht gefunden; Datum im Viewer bleibt statisch.');
  return { template: t, warnings };
}

export function importHtml(campus, html, { actor, baseSnapshotId, force = false, note } = {}) {
  const { pkg, template: raw } = extractPackage(html);
  const { template, warnings } = patchTemplate(raw, pkg.manifest?.source_world_date);
  const { manifest, files, context, ...rest } = pkg;
  const { modules = [], ...manifestGlobals } = manifest;
  const byFile = new Map(modules.map(m => [m.file, m]));
  const uiVersion = pkg.uiVersion || manifest.ui_version || null;
  const results = { created: [], updated: [], unchanged: [], skippedConflicts: [], errors: [], notInImport: [], warnings };
  const imported = new Set();

  for (const f of files) {
    const m = byFile.get(f.name);
    if (!m) { results.errors.push({ file: f.name, error: 'Kein Manifest-Eintrag (origin unbekannt).' }); continue; }
    const bytes = Buffer.from(f.base64, 'base64');
    const id = f.name.replace(/\.nbt$/i, '');
    imported.add(id);
    const { file, name, origin, category, description, ...meta } = m;
    try {
      const current = campus.db.prepare('SELECT 1 FROM blueprints WHERE id = ?').get(id) ? campus.currentVersion(id) : null;
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (current && !force && current.uploadedVia !== 'import' && (current.sha256 !== hash || current.origin.join() !== origin.join())) {
        results.skippedConflicts.push({ blueprint: id, currentVersion: current.version, uploadedBy: current.uploadedBy, uploadedVia: current.uploadedVia,
          reason: 'Seit dem letzten Import in der App geändert; Import würde diese Änderung überschreiben.' });
        continue;
      }
      const r = campus.saveVersion({ fileName: f.name, bytes, origin, name, category, description, meta, note: note || `Import ${uiVersion || ''}`.trim(), baseSnapshotId, actor, via: 'import' });
      (r.unchanged ? results.unchanged : current ? results.updated : results.created).push({ blueprint: id, version: r.version.version });
    } catch (e) { results.errors.push({ file: f.name, error: e.message }); }
  }
  for (const b of campus.listBlueprints()) if (!imported.has(b.id)) results.notInImport.push(b.id);

  const dir = join(campus.config.dataDir, 'package');
  mkdirSync(dir, { recursive: true });
  const extras = { ...rest, manifestGlobals, importedContext: context ? { ...context, base64: undefined } : null };
  const info = campus.db.prepare('INSERT INTO packages (ui_version, source_world_date, note, imported_by, created_at, summary_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uiVersion, manifest.source_world_date || null, note || null, actor?.user?.id ?? null, now(), JSON.stringify({
      created: results.created.length, updated: results.updated.length, unchanged: results.unchanged.length,
      skippedConflicts: results.skippedConflicts.length, errors: results.errors.length, warnings }));
  const pid = Number(info.lastInsertRowid);
  writeFileSync(join(dir, `extras-${pid}.json`), JSON.stringify(extras));
  writeFileSync(join(dir, `template-${pid}.html`), template);
  writeFileSync(join(dir, 'extras.json'), JSON.stringify(extras));
  writeFileSync(join(dir, 'template.html'), template);
  logActivity(campus.db, actor, 'package.import', String(pid), { uiVersion, created: results.created.length, updated: results.updated.length, skippedConflicts: results.skippedConflicts.length });
  campus.invalidate();
  return { packageId: pid, uiVersion, ...results };
}

export function loadViewerAssets(dataDir) {
  const dir = join(dataDir, 'package');
  if (!existsSync(join(dir, 'template.html'))) return null;
  return { template: readFileSync(join(dir, 'template.html'), 'utf8'), extras: JSON.parse(readFileSync(join(dir, 'extras.json'), 'utf8')) };
}
