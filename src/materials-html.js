import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../public/assets/material-icons/catalog.json', import.meta.url), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '–' : Number(n).toLocaleString('de-DE');
const when = s => s ? new Date(s).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'short', timeStyle: 'short' }) + ' (Berlin)' : 'unbekannt';

function material(item) {
  const info = catalog[item];
  const icon = info
    ? `<img class="material-icon" src="${esc(info.icon)}" width="48" height="48" alt="" loading="lazy">`
    : '<span class="material-icon material-unknown" role="img" aria-label="Kein Blockbild verfügbar">?</span>';
  const connecting = info?.connecting == null ? '' : `<span class="badge ${info.connecting ? 'ok' : 'unknown'}">Connecting ${info.connecting ? 'AN' : 'AUS'}</span>`;
  return `<div class="material-label">${icon}<div><div class="material-name">${esc(info?.name || item)} ${connecting}</div><div class="mono muted">${esc(item)}</div></div></div>`;
}

export function materialsHtml(report, title, requestUrl) {
  // Only links back to the current API route; preserve selection/snapshot/version/ME filters.
  const url = new URL(requestUrl, 'http://campus.local');
  const link = changes => {
    const q = new URLSearchParams(url.search);
    for (const [key, value] of Object.entries(changes)) q.set(key, value);
    return esc(url.pathname + '?' + q.toString());
  };
  const all = url.searchParams.has('all') && !/^(0|false|no|nein)$/i.test(url.searchParams.get('all'));
  const t = report.totals, me = t.me;
  const rows = report.items.map(r => `<tr>
    <td>${material(r.item)}</td><td class="num"><b>${fmt(r.needed)}</b></td>
    <td class="num">${fmt(r.stacks)} × ${fmt(r.stack)}${r.rest ? ` + ${fmt(r.rest)}` : ''}</td>
    <td class="num">${fmt(r.planned)}</td><td class="num">${fmt(r.built)}</td>
    ${me ? `<td class="num">${fmt(r.me)}</td><td class="num">${fmt(r.short)}</td><td>${r.craftable ? 'Ja' : 'Nein'}</td>` : ''}</tr>`).join('');
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Materialliste · ${esc(title)}</title><link rel="stylesheet" href="/assets/app.css"></head>
<body class="materials-page"><header class="top"><div><h1>Materialliste</h1><div class="sub">${esc(title)}</div></div>
<span class="spacer"></span><a class="btn" href="/app">Zum Campus</a></header>
<main><div class="panel"><div class="toolbar">
<a class="btn" href="${link({format:'html', all: all ? 'false' : 'true'})}">${all ? 'Nur fehlende Materialien' : 'Auch bereits gebaute Materialien'}</a>
<a class="btn" href="${link({format:'text'})}">Textliste</a><a class="btn" href="${link({format:'csv'})}">CSV herunterladen</a></div>
<p><b>${fmt(t.needed)} Items</b> fehlen in der Weltaufnahme · ${fmt(t.kinds)} Sorten · etwa ${fmt(t.stacks)} Stacks.</p>
<p class="muted">Weltstand: ${esc(when(report.snapshot?.worldTime))} · Snapshot #${esc(report.snapshot?.id)}. Kein Echtzeitstand.</p>
${me ? `<p class="muted">ME-Bestand: ${esc(when(me.at))} · ${esc(me.source)} · davon noch ${fmt(me.short)} Items zu beschaffen.</p>` : '<p class="muted">Kein ME-Bestand berücksichtigt.</p>'}
${t.blocked || t.unknown ? `<p class="badge warning">${fmt(t.blocked)} Zellen mit Maschine im Weg · ${fmt(t.unknown)} Zellen ohne bekannten Bestand</p>` : ''}
</div><div class="panel material-table" role="region" aria-label="Materialien" tabindex="0"><table>
<thead><tr><th scope="col">Material / exakte Variante</th><th scope="col" class="num">Noch setzen</th><th scope="col" class="num">Stacks + Rest</th><th scope="col" class="num">Geplant</th><th scope="col" class="num">Gebaut</th>
${me ? '<th scope="col" class="num">Im ME</th><th scope="col" class="num">Fehlt im ME</th><th scope="col">Im ME craftbar</th>' : ''}</tr></thead>
<tbody>${rows || `<tr><td colspan="${me ? 8 : 5}" class="muted">Für diese Auswahl fehlen keine Materialien.</td></tr>`}</tbody></table></div>
<p class="muted">Blockbilder aus den Minecraft- und Modtexturen. Connecting-Bilder zeigen einen einzelnen Block; die Kennzeichnung nennt die benötigte Variante.</p>
</main></body></html>`;
}
