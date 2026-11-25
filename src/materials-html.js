import { ASSET_VERSION, campusPage } from './campus-page.js';
import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../public/assets/material-icons/catalog.json', import.meta.url), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null ? '–' : Number(n).toLocaleString('de-DE'));
const when = s => (s ? new Date(s).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) + ' (Berlin)' : 'unbekannt');

function material(item) {
  const info = catalog[item];
  const icon = info
    ? `<img class="material-icon" src="${esc(info.icon)}" width="48" height="48" alt="" loading="lazy">`
    : '<span class="material-icon material-unknown" role="img" aria-label="Kein Blockbild verfügbar">?</span>';
  const connecting = info?.connecting == null
    ? ''
    : `<span class="c-badge ${info.connecting ? 'c-badge--ok' : 'c-badge--neutral'}">Connecting ${info.connecting ? 'AN' : 'AUS'}</span>`;
  return `<div class="material-label">${icon}<div><div class="material-name">${esc(info?.name || item)} ${connecting}</div><div class="c-mono mono muted">${esc(item)}</div></div></div>`;
}

export function materialsHtml(report, title, requestUrl, actor) {
  // Only links back to the current API route; preserve selection/snapshot/version/ME filters.
  const url = new URL(requestUrl, 'http://campus.local');
  const link = changes => {
    const q = new URLSearchParams(url.search);
    for (const [key, value] of Object.entries(changes)) q.set(key, value);
    return esc(url.pathname + '?' + q.toString());
  };
  const all = url.searchParams.has('all') && !/^(0|false|no|nein)$/i.test(url.searchParams.get('all'));
  const t = report.totals, me = t.me;
  const rows = report.items.map(r => `<tr data-material>
    <td>${material(r.item)}</td><td class="num"><b>${fmt(r.needed)}</b></td>
    <td class="num">${fmt(r.stacks)} × ${fmt(r.stack)}${r.rest ? ` + ${fmt(r.rest)}` : ''}</td>
    <td class="num material-extra">${fmt(r.planned)}</td><td class="num material-extra">${fmt(r.built)}</td>
    ${me ? `<td class="num">${fmt(r.me)}</td><td class="num">${fmt(r.short)}</td><td>${r.craftable ? 'Ja' : 'Nein'}</td>` : ''}</tr>`).join('');

  return campusPage(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Materialliste · ATM10 Campus</title>
<link rel="stylesheet" href="/assets/app.css?v=${ASSET_VERSION}"></head>
<body class="materials-page"><a class="skip-link" href="#main">Zum Inhalt</a>
<!-- campus-navigation -->
<main id="main" class="c-shell">
  <div class="c-page-head">
    <div class="c-page-head-main">
      <p class="c-eyebrow">Werkzeuge · Materialbedarf</p>
      <h1>Materialliste</h1>
      <p class="c-page-sub intro">${esc(title)}</p>
    </div>
    <div class="c-page-actions c-no-print">
      <a class="c-btn c-btn--sm" href="/app#overview">← Bauaufträge</a>
      <details class="menu"><summary>Downloads</summary><div class="menu-content"><a href="${link({ format: 'text' })}">Textliste</a><a href="${link({ format: 'csv' })}">CSV herunterladen</a></div></details>
    </div>
  </div>
  <div class="c-kpi-grid summary-line" aria-label="Fehlendes Material laut Weltaufnahme">
    <span class="c-kpi"><span class="c-kpi-label">Items fehlen</span><b class="c-kpi-value">${fmt(t.needed)}</b></span>
    <span class="c-kpi"><span class="c-kpi-label">Sorten</span><b class="c-kpi-value">${fmt(t.kinds)}</b></span>
    <span class="c-kpi"><span class="c-kpi-label">Stacks (ca.)</span><b class="c-kpi-value">${fmt(t.stacks)}</b></span>
    ${me ? `<span class="c-kpi${me.short ? '' : ' c-kpi--accent'}"><span class="c-kpi-label">Noch zu beschaffen (ME)</span><b class="c-kpi-value">${fmt(me.short)}</b></span>` : ''}
  </div>
  <div class="row" style="margin:12px 0 4px">
    <span class="c-status-pill c-status-pill--info material-meta"><span class="c-status-dot c-status-dot--info" aria-hidden="true"></span>Weltstand: ${esc(when(report.snapshot?.worldTime))} · Snapshot #${esc(report.snapshot?.id)}. Kein Echtzeitstand.</span>
    ${me ? `<span class="c-status-pill c-status-pill--ok material-meta"><span class="c-status-dot c-status-dot--ok" aria-hidden="true"></span>ME-Bestand: ${esc(when(me.at))} · ${esc(me.source)} · davon noch ${fmt(me.short)} Items zu beschaffen.</span>` : '<span class="c-badge c-badge--neutral muted">Kein ME-Bestand berücksichtigt.</span>'}
  </div>
  ${t.blocked || t.unknown ? `<p class="c-notice c-notice--warn notice">${fmt(t.blocked)} Zellen mit Maschine im Weg · ${fmt(t.unknown)} Zellen ohne bekannten Bestand</p>` : ''}
  <div class="toolbar c-no-print">
    <input type="search" class="c-input search" id="materialSearch" aria-label="Material suchen" placeholder="Material suchen …">
    <a class="c-btn btn" href="${link({ format: 'html', all: all ? 'false' : 'true' })}">${all ? 'Nur fehlende Materialien' : 'Gebautes zeigen'}</a>
    <label class="check"><input type="checkbox" id="materialDetails"> Planmengen zeigen</label>
  </div>
  <div class="c-table-wrap table-wrap material-table" role="region" aria-label="Materialien" tabindex="0"><table>
  <thead><tr><th scope="col">Material / exakte Variante</th><th scope="col" class="num">Noch setzen</th><th scope="col" class="num">Stacks + Rest</th><th scope="col" class="num material-extra">Geplant</th><th scope="col" class="num material-extra">Gebaut</th>
  ${me ? '<th scope="col" class="num">Im ME</th><th scope="col" class="num">Fehlt im ME</th><th scope="col">Im ME craftbar</th>' : ''}</tr></thead>
  <tbody>${rows || `<tr><td colspan="${me ? 8 : 5}" class="muted">Für diese Auswahl fehlen keine Materialien.</td></tr>`}<tr id="materialEmpty" class="hide"><td colspan="${me ? 8 : 5}" class="muted">Kein Material passt zur Suche.</td></tr></tbody></table></div>
  <p class="footnote">Blockbilder aus den Minecraft- und Modtexturen. Connecting-Bilder zeigen einen einzelnen Block; die Kennzeichnung nennt die benötigte Variante.</p>
</main><script src="/assets/materials.js?v=${ASSET_VERSION}" defer></script></body></html>`, actor, 'materials');
}
