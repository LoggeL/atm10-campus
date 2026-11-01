'use strict';
import { coordinateFields, placementCard, placementValues, coordinateListText } from './placement.js?v=20261101-coordinates-1';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '–' : Number(n).toLocaleString('de-DE');
const when = t => t ? new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–';
const ago = t => {
  if (!t) return '–';
  const s = (Date.now() - new Date(t)) / 1000;
  if (s < 90) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return when(t);
};
const STATUS = { conflict: 'Konflikt', warning: 'Geändert seit Planung', ok: 'Offen', built: 'Gebaut', unknown: 'Kein Bestand' };
const badge = s => `<span class="badge ${s}">${STATUS[s] || s}</span>`;

async function api(path, opts = {}) {
  const headers = { 'x-campus-csrf': '1', ...(opts.headers || {}) };
  let body = opts.body;
  if (body && !(body instanceof Blob) && !(body instanceof ArrayBuffer) && typeof body !== 'string') { body = JSON.stringify(body); headers['content-type'] = 'application/json'; }
  const r = await fetch(path, { ...opts, headers, body });
  if (r.status === 401) { location.href = '/login'; throw new Error('Nicht angemeldet'); }
  const j = r.headers.get('content-type')?.includes('json') ? await r.json() : null;
  if (!r.ok) { const e = new Error(j?.error || r.statusText); e.data = j; e.status = r.status; throw e; }
  return j;
}
function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  document.body.append(t); setTimeout(() => t.remove(), err ? 7000 : 3500);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

let me = null, status = null;

// ---------- tabs ----------
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(tab) {
  document.querySelectorAll('nav.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  document.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hide', p.dataset.pane !== tab));
  ({ overview: loadStatus, coordinates: loadStatus, snapshots: loadSnapshots, cannons: loadCannons, agent: loadTokens, activity: loadActivity, admin: loadAdmin })[tab]?.();
  history.replaceState(null, '', '#' + tab);
}

// ---------- overview ----------
async function loadStatus() {
  status = await api('/api/status');
  const live = status.live, t = status.edition.totals;
  $('liveLine').innerHTML = live
    ? `Live-Bestand #${live.id}: Welt gespeichert ${esc(ago(live.worldTime))}, erfasst ${esc(ago(live.capturedAt))}`
    : '<span class="err">Noch kein Live-Snapshot vorhanden.</span>';
  const placed = status.blueprints.reduce((a, b) => a + (b.counts ? b.counts.placed + b.counts.clear - b.counts.outsideSnapshot : 0), 0);
  const done = status.blueprints.reduce((a, b) => a + (b.counts ? b.counts.built + b.counts.cleared : 0), 0);
  $('cards').innerHTML = [
    ['Baupläne', fmt(t.blueprints), 'in der aktuellen Edition'],
    ['Konflikte', fmt(t.conflict), 'Maschinen im Weg oder Überlappung'],
    ['Geändert seit Planung', fmt(t.warning), 'Bestand im Baufeld hat sich verändert'],
    ['Gebaut', fmt(t.built), `von ${fmt(t.blueprints)} komplett`],
    ['Gesamtfortschritt', placed ? (Math.round(done / placed * 1000) / 10).toLocaleString('de-DE') + ' %' : '–', 'Blöcke wie geplant'],
  ].map(([k, v, d]) => `<div class="card"><div class="k">${k}</div><div class="v">${v}</div><div class="d">${d}</div></div>`).join('');
  renderRows();
  renderCoordinates();
  $('overlaps').innerHTML = status.overlaps.length
    ? '<table><thead><tr><th>Baupläne</th><th class="num">Zellen</th><th>Beispiel</th></tr></thead><tbody>' + status.overlaps.map(o =>
      `<tr><td>${o.blueprints.map(esc).join(' ↔ ')}</td><td class="num">${fmt(o.cells)}</td><td class="mono">${esc(o.samples[0]?.pos.join(' '))}</td></tr>`).join('') + '</tbody></table>'
    : 'Keine Überlappungen. Kein Bauplan setzt einen anderen Block in eine Zelle, die ein anderer schon belegt.';
}
function renderRows() {
  if (!status) return;
  const q = $('search').value.trim().toLowerCase(), f = $('filter').value;
  const order = { conflict: 0, warning: 1, ok: 2, unknown: 3, built: 4 };
  const rows = status.blueprints.filter(b => (!f || b.status === f) && (!q || (b.name + ' ' + b.id).toLowerCase().includes(q)))
    .sort((a, b) => order[a.status] - order[b.status] || a.fileName.localeCompare(b.fileName));
  $('bpRows').innerHTML = rows.map(b => {
    const c = b.conflicts || {};
    const conflictText = [c.protectedBlockEntities ? `${fmt(c.protectedBlockEntities)} Maschinen` : '', c.overlapCells ? `${fmt(c.overlapCells)} Überlappung` : '', c.changedSinceBase ? `${fmt(c.changedSinceBase)} geändert` : ''].filter(Boolean).join(' · ') || '–';
    return `<tr class="click" data-id="${esc(b.id)}"><td><div>${esc(b.name)}</div><div class="muted mono">${esc(b.fileName)}</div></td><td>${badge(b.status)}</td><td class="num">v${b.version}</td>
      <td><div class="bar"><i style="width:${b.progress ?? 0}%"></i></div><div class="muted" style="font-size:12px">${b.progress == null ? '–' : b.progress.toLocaleString('de-DE') + ' %'}</div></td>
      <td class="num hide-sm">${fmt(b.counts?.toPlace)}</td><td class="num hide-sm">${fmt(b.counts?.toReplace)}</td><td class="num" style="font-size:12px">${conflictText}</td>
      <td class="hide-sm muted" style="font-size:12px">${esc(ago(b.updatedAt))}${b.uploadedBy ? ' · ' + esc(b.uploadedBy) : ''}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="muted">Keine Baupläne. Als Admin unter „Admin“ eine Campus-HTML importieren oder „Neuer Bauplan“ nutzen.</td></tr>';
}
$('search').addEventListener('input', renderRows);
$('filter').addEventListener('change', renderRows);
$('bpRows').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) openBlueprint(tr.dataset.id); });

// ---------- placement coordinates ----------
function renderCoordinates() {
  if (!status) return;
  const q = $('coordinateSearch').value.trim().toLowerCase();
  const rows = status.blueprints.filter(b => !q || `${b.name} ${b.id} ${b.fileName}`.toLowerCase().includes(q))
    .sort((a,b) => a.fileName.localeCompare(b.fileName, 'de', {numeric:true}));
  $('coordinateCount').textContent = `${rows.length} von ${status.blueprints.length} Bauplänen · Stand ${when(status.generatedAt)}`;
  $('coordinateRows').innerHTML = rows.map(b => `<tr><td><button class="small" data-open-blueprint="${esc(b.id)}">${esc(b.name)}</button><div class="muted mono">${esc(b.fileName)}</div></td><td>v${b.version}</td><td>${coordinateFields(b)}</td><td>${placementValues(b) ? `<button class="small" data-copy-coordinate="${b.origin.join(' ')}">X Y Z kopieren</button>` : ''}<a class="btn small" href="/api/blueprints/${encodeURIComponent(b.id)}/download?version=${b.version}">NBT v${b.version}</a></td></tr>`).join('') || '<tr><td colspan="4">Keine passenden Baupläne.</td></tr>';
}
$('coordinateSearch').addEventListener('input', renderCoordinates);
$('coordinateRows').addEventListener('click', e => { const b = e.target.closest('[data-open-blueprint]'); if (b) openBlueprint(b.dataset.openBlueprint); });
$('coordinateDownload').onclick = () => {
  if (!status) return;
  const rows = [...status.blueprints].sort((a,b) => a.fileName.localeCompare(b.fileName, 'de', {numeric:true}));
  const url = URL.createObjectURL(new Blob([coordinateListText(rows)], {type:'text/plain;charset=utf-8'}));
  const a = document.createElement('a'); a.href=url; a.download='CAMPUS_KOORDINATEN_AKTUELL.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
document.addEventListener('click', guard(async e => {
  const button = e.target.closest('[data-copy-coordinate]');
  if (!button) return;
  const value = button.dataset.copyCoordinate;
  try { await navigator.clipboard.writeText(value); toast(`Kopiert: ${value}`); }
  catch { prompt('Zum Kopieren markieren:', value); }
}));

// ---------- drawer ----------
function closeDrawer() { $('drawer').classList.remove('open'); $('scrim').classList.remove('open'); }
$('scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

const openBlueprint = guard(async id => {
  const bp = await api('/api/blueprints/' + encodeURIComponent(id));
  const cur = bp.versions.find(v => v.version === bp.currentVersion), a = bp.analysis;
  const st = status?.blueprints.find(b => b.id === id);
  const sample = (title, list, cols) => list?.length ? `<details><summary>${title} (${fmt(list.length)}${list.length >= 200 ? '+' : ''} Beispiele)</summary><table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${list.slice(0, 60).map(s => `<tr>${cols.map(c => `<td class="mono">${esc(c[1](s))}</td>`).join('')}</tr>`).join('')}</tbody></table></details>` : '';
  $('drawer').innerHTML = `
    <div class="row" style="justify-content:space-between"><div><h2>${esc(bp.name)}</h2><div class="muted mono">${esc(bp.fileName)}</div></div><button class="small" id="dClose">Schließen</button></div>
    <div class="row" style="margin-top:10px">${st ? badge(st.status) : ''}<a class="btn small primary" href="/api/blueprints/${encodeURIComponent(id)}/download">NBT herunterladen (v${bp.currentVersion})</a><button class="small" id="dUpload">Neue Version hochladen</button><a class="btn small" href="/viewer#bp=${encodeURIComponent(id)}">Im 3D-Viewer</a><a class="btn small" href="/api/blueprints/${encodeURIComponent(id)}/materials?format=html" target="_blank" rel="noopener">Materialliste</a><a class="btn small" href="/api/blueprints/${encodeURIComponent(id)}/remaining.nbt" download title="Nur fehlende Blöcke, gleicher origin – für die Schematicannon (normaler Modus)">Rest-NBT</a></div>
    ${placementCard({origin:cur?.origin, version:bp.currentVersion})}
    <dl class="kv">
      <dt>Bauplan verschieben</dt><dd><button class="small" id="dMove">Position im Campus ändern</button></dd>
      <dt>Größe</dt><dd class="mono">${esc(cur?.size.join(' × '))}</dd>
      <dt>Blöcke</dt><dd>${fmt(cur?.stats.placed)} setzen · ${fmt(cur?.stats.clear)} abreißen</dd>
      <dt>Kategorie</dt><dd>${esc(bp.category || '–')}</dd>
      <dt>Beschreibung</dt><dd>${esc(bp.description || '–')}</dd>
    </dl>
    ${a ? `<div class="panel"><h2>Vergleich mit Live-Bestand #${a.snapshotId}${a.baseSnapshotId ? ` (Planungsstand #${a.baseSnapshotId})` : ''}</h2>
      <dl class="kv">
        <dt>Fortschritt</dt><dd>${(Math.round(a.progress * 1000) / 10).toLocaleString('de-DE')} %, ${fmt(a.built)} gesetzt, ${fmt(a.cleared)} schon frei</dd>
        <dt>Noch zu tun</dt><dd>${fmt(a.toPlace)} in Luft setzen · ${fmt(a.toReplace)} ersetzen · ${fmt(a.toClear)} abreißen</dd>
        <dt>Maschinen im Weg</dt><dd class="${a.conflicts.protectedBlockEntities ? 'err' : ''}">${fmt(a.conflicts.protectedBlockEntities)}</dd>
        <dt>Seit Planung geändert</dt><dd>${a.baseCompared ? fmt(a.conflicts.changedSinceBase) : 'kein Planungsstand hinterlegt'}</dd>
        <dt>Außerhalb Bestand</dt><dd>${fmt(a.outsideSnapshot)}</dd>
        <dt>Überlappungen</dt><dd>${fmt(st?.conflicts?.overlapCells)}</dd>
      </dl>
      ${sample('Maschinen / Block-Entities im Weg', a.samples.protectedBlockEntities, [['Position', s => s.pos.join(' ')], ['Live', s => s.blockEntity], ['Geplant', s => s.planned]])}
      ${sample('Seit Planung geändert', a.samples.changedSinceBase, [['Position', s => s.pos.join(' ')], ['Damals', s => s.base], ['Jetzt', s => s.live], ['Geplant', s => s.planned]])}
      ${sample('Zu ersetzende Blöcke', a.samples.toReplace, [['Position', s => s.pos.join(' ')], ['Live', s => s.live], ['Geplant', s => s.planned]])}
    </div>` : '<p class="muted">Noch keine Analyse (kein Live-Snapshot).</p>'}
    <div class="panel"><h2>Versionen</h2><table><thead><tr><th>Ver.</th><th>Wann</th><th>Wer</th><th>Notiz</th><th></th></tr></thead><tbody>
      ${bp.versions.map(v => `<tr><td>v${v.version}${v.version === bp.currentVersion ? ' <span class="badge ok">aktuell</span>' : ''}</td><td>${esc(when(v.createdAt))}</td><td>${esc(v.uploadedBy || '–')} <span class="muted">(${esc(v.uploadedVia)})</span></td><td>${esc(v.note || '')}${v.origin.join() !== cur?.origin.join() ? ` <span class="muted mono">@${esc(v.origin.join(','))}</span>` : ''}</td>
        <td class="row"><a class="btn small" href="/api/blueprints/${encodeURIComponent(id)}/download?version=${v.version}">↓</a>${v.version !== bp.currentVersion ? `<button class="small" data-revert="${v.version}">wiederherstellen</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="row"><button class="small danger" id="dArchive">Bauplan archivieren</button></div>`;
  $('drawer').classList.add('open'); $('scrim').classList.add('open');
  $('dClose').onclick = closeDrawer;
  $('dUpload').onclick = () => pickFile(guard(async file => {
    const note = prompt('Änderungsnotiz (optional):', '') ?? '';
    const r = await api(`/api/blueprints/${encodeURIComponent(id)}/nbt?baseVersion=${bp.currentVersion}&note=${encodeURIComponent(note)}`, { method: 'PUT', body: file, headers: { 'content-type': 'application/octet-stream' } })
      .catch(e => { if (e.status === 409) throw new Error(e.message + ' Bitte Seite neu laden und erneut versuchen.'); throw e; });
    toast(r.unchanged ? 'Identisch mit aktueller Version, nichts geändert.' : `Version ${r.version.version} gespeichert.`);
    await loadStatus(); openBlueprint(id);
  }));
  $('dMove').onclick = guard(async () => {
    const v = prompt('Neue Position x,y,z:', cur.origin.join(','));
    if (!v) return;
    await api('/api/blueprints/' + encodeURIComponent(id), { method: 'PATCH', body: { origin: v.split(',').map(Number), baseVersion: bp.currentVersion } });
    toast('Neue Version mit geänderter Position gespeichert.'); await loadStatus(); openBlueprint(id);
  });
  $('drawer').querySelectorAll('[data-revert]').forEach(b => b.onclick = guard(async () => {
    if (!confirm(`Version ${b.dataset.revert} als neue Version wiederherstellen?`)) return;
    await api(`/api/blueprints/${encodeURIComponent(id)}/revert`, { method: 'POST', body: { version: Number(b.dataset.revert) } });
    toast('Wiederhergestellt.'); await loadStatus(); openBlueprint(id);
  }));
  $('dArchive').onclick = guard(async () => {
    if (!confirm('Bauplan archivieren? Er verschwindet aus Edition und Viewer, die Versionen bleiben gespeichert.')) return;
    await api('/api/blueprints/' + encodeURIComponent(id), { method: 'DELETE' });
    closeDrawer(); toast('Archiviert.'); loadStatus();
  });
});

function pickFile(cb) {
  const f = $('hiddenFile'); f.value = '';
  f.onchange = () => f.files[0] && cb(f.files[0]);
  f.click();
}
$('newBp').onclick = () => pickFile(guard(async file => {
  const origin = prompt(`Position (origin x,y,z) für ${file.name}:`, '0,63,0');
  if (!origin) return;
  const name = prompt('Anzeigename:', file.name.replace(/\.nbt$/i, '')) || '';
  const r = await api(`/api/blueprints/${encodeURIComponent(file.name.replace(/\.nbt$/i, ''))}/nbt?fileName=${encodeURIComponent(file.name)}&origin=${encodeURIComponent(origin)}&name=${encodeURIComponent(name)}`,
    { method: 'PUT', body: file, headers: { 'content-type': 'application/octet-stream' } });
  toast(`${r.blueprint.name}: Version ${r.version.version} gespeichert.`); loadStatus();
}));

// ---------- snapshots ----------
async function loadSnapshots() {
  const { sources, snapshots } = await api('/api/snapshots');
  $('snapSource').innerHTML = sources.map(s => `<option value="${esc(s)}">${s === 'live' ? 'Live-Welt' : esc(s)}</option>`).join('');
  $('snapSource').classList.toggle('hide', sources.length < 2);
  $('snapRows').innerHTML = snapshots.map(s => `<tr><td>#${s.id}${s.pinned ? ' 📌' : ''}</td><td>${esc(s.source === 'live' ? 'Live' : s.label)}</td><td>${esc(when(s.capturedAt))}</td><td>${esc(when(s.worldTime))}</td>
    <td class="num">${fmt(s.recordCount)}</td><td class="num">${fmt(s.blockEntityCount)}</td><td><a class="btn small" href="/viewer?snapshot=${s.id}">im Viewer</a></td></tr>`).join('') || '<tr><td colspan="7" class="muted">Noch keine Snapshots.</td></tr>';
}
$('snapNow').onclick = guard(async () => {
  $('snapNow').disabled = true;
  try {
    const r = await api('/api/snapshots', { method: 'POST', body: { source: $('snapSource').value || 'live', label: $('snapLabel').value || undefined, force: true } });
    toast(`Snapshot #${r.snapshot.id} erfasst.`); loadSnapshots();
  } finally { $('snapNow').disabled = false; }
});

// ---------- cannons ----------
const CANNON_STATE = { alignment: 'Ausrichtung gesperrt', offline: 'Computer offline', nocomputer: 'Kein Computer', feeding: 'Liefert', waiting: 'Wartet auf Material', full: 'Kiste voll', done: 'Fertig', paused: 'Pausiert', unassigned: 'Kein Bauplan', missing: 'Bauplan fehlt', nosnapshot: 'Kein Live-Bestand', error: 'Fehler', start: 'Startet' };
const shortName = item => String(item).replace(/^minecraft:/, '');
let cannonTimer = null;
async function loadCannons() {
  const [list, stock, bps] = await Promise.all([api('/api/cannons'), api('/api/me/stock'), status ? Promise.resolve(status.blueprints) : api('/api/blueprints')]);
  $('ccInstall').textContent = `wget run ${location.origin}/cc/install.lua`;
  const s = stock.stock;
  $('meLine').innerHTML = s ? `ME-Bestand von <b>${esc(s.source)}</b>, ${esc(ago(s.at))} · ${fmt(s.kinds)} relevante Sorten` : 'Noch kein ME-Bestand gemeldet.';
  if (!list.length) $('ccSetup').open = true;
  const options = bps.filter(b => b.current || b.version).map(b => [b.id, b.name]).sort((a, b) => a[1].localeCompare(b[1], 'de'));
  $('cannonList').innerHTML = list.length ? `<div class="cannons">${list.map(c => cannonCard(c, options)).join('')}</div>`
    : '<div class="panel muted">Noch keine Kanone gemeldet. Sobald ein Computer das Script startet, erscheint er hier.</div>';
  scheduleCannons();
}
// Re-arms every 15 s; skips the reload while hidden, on another tab or while a card field has focus.
function scheduleCannons() {
  clearTimeout(cannonTimer);
  cannonTimer = setTimeout(() => {
    if ($('cannonList').closest('.hide')) return;
    if (document.hidden || document.activeElement?.closest?.('.cannon select, .cannon input')) return scheduleCannons();
    loadCannons().catch(() => scheduleCannons());
  }, 15e3);
}
function alignmentCard(c) {
  const a=c.alignment || {state:'disabled',message:'Ausrichtung deaktiviert: keine bestätigte Blockbindung.'}, b=a.binding, d=a.desired, o=a.observed;
  return `<details class="alignment"><summary>Ausrichtung: ${esc(a.state==='aligned'?'Live bestätigt':a.state==='disabled'?'Deaktiviert / nicht gebunden':'Material gesperrt · '+a.state)}</summary>
    <p class="${a.state==='aligned'?'muted':'warn'}">${esc(a.message)}</p>
    ${b?`<p>Bestätigter Block: <span class="mono">${esc(b.dimension)} ${esc(b.x)} ${esc(b.y)} ${esc(b.z)}</span> · Owner ${esc(b.owner)}</p>`:''}
    ${d?`<p>Soll: ${esc(d.file)} · v${esc(d.version)} · Anker ${esc(d.anchor.join(' '))} · Rotation none / Spiegelung none<br><small class="mono">SHA256 ${esc(d.sha256)}</small></p>`:''}
    ${o?`<p>Ist (Live): ${esc(o.state)} · AmountPlaced ${esc(o.amountPlaced)} · Datei ${esc(o.components?.['create:schematic_file'])} · Owner ${esc(o.components?.['create:schematic_owner'])}<br>Anker ${esc(o.components?.['create:schematic_anchor']?.join(' '))} · Rotation ${esc(o.components?.['create:schematic_rotation'])} · Spiegelung ${esc(o.components?.['create:schematic_mirror'])}<br>Printer-Anker ${esc(o.printer?.Anchor?.join(' ') || 'kein Cache-Anker')}<br><small>Live-Dateihash ${esc(o.fileHash || 'Datei fehlt / nicht prüfbar')}</small></p>`:''}
    <p class="warn">Nur Campus-Materialfreigabe, kein unveränderlicher Baulock: Die native Create-GUI und manuell bereitgestellte Materialien können das umgehen. Bestehender Kisteninhalt bleibt verfügbar. Während Apply niemand im Spiel die Kanone bedienen; Readback ist keine dauerhafte GUI-Sperre.</p>
    ${me?.user?.role==='admin'?`<p>Blockbindung manuell eingeben. Beispiel (nicht vorausgefüllt): minecraft:overworld 94 64 21, Owner KGZJonny. Erst am richtigen Block prüfen, dann ausdrücklich binden. Die Probe schreibt keine Welt-NBT.</p>
      <div class="row"><label>Dimension <select data-bind="dimension">${['minecraft:overworld','minecraft:the_nether','minecraft:the_end'].map(dim=>`<option${b?.dimension===dim?' selected':''}>${dim}</option>`).join('')}</select></label>${['x','y','z'].map(k=>`<label>${k} <input data-bind="${k}" type="number" step="1" value="${esc(b?.[k]??'')}" required></label>`).join('')}<label>Schematic-Owner <input data-bind="owner" value="${esc(b?.owner??'')}" autocomplete="off" maxlength="16" required></label></div>
      <button class="small" data-act="alignment-probe">Block read-only prüfen / Bindung bestätigen</button>
      ${b?'<button class="small primary" data-act="alignment-apply">Nach Stop/Reset: Ausrichtung anwenden / erneut versuchen</button>':''}
      <p class="muted">Aktivierung benötigt Feeder 1.1.0 mit frischer Statusmeldung. Apply nur STOPPED, AmountPlaced=0, AmountToPlace=0, ohne Printer-Cache; sonst im Spiel bewusst stoppen/zurücksetzen bzw. Schematic entnehmen. Es gibt keinen automatischen Reset. Exakte gewählte NBT-Version am Schematic Table hochladen und einlegen. Bauplanwechsel stellt den neuen Anker bereit und versucht sicheres Apply; bei laufender/gecachter Kanone bleibt er ausstehend.</p>`:''}
  </details>`;
}
// alignment-card-end
function cannonCard(c, bpOptions) {
  const o = c.options, st = c.status, t = c.totals, bp = c.blueprint;
  const pct = t && t.start ? Math.max(0, Math.min(100, Math.round((t.start - t.needed) / t.start * 1000) / 10)) : null;
  const live = st && !st.stale && c.online ? st : null;
  const offline = !c.online && bp && !['done', 'paused'].includes(c.state);
  const state = offline ? (c.lastSeenAt ? 'offline' : 'nocomputer') : c.state === 'feeding' && live ? live.state : c.state;
  const shorts = (live?.shortages || []).map(x => `<li class="${x.crafting ? '' : 'warn'}">${fmt(x.missing)}× ${esc(shortName(x.item))} · im ME ${fmt(x.inME)}${x.crafting ? ' · wird gecraftet' : x.craftable ? ' · craftbar' : ''}${x.error ? ` · <span class="err">${esc(x.error)}</span>` : ''}</li>`).join('');
  const next = (c.items || []).slice(0, 6).map(i => `${esc(shortName(i.item))} ${fmt(i.needed)}`).join(' · ');
  return `<div class="panel cannon" data-cannon="${esc(c.name)}">
    <div class="row" style="justify-content:space-between"><h3><span class="dot ${c.online ? 'on' : ''}" title="${c.online ? 'online' : 'offline'}"></span>${esc(c.name)}</h3>
      <span class="muted" style="font-size:12px">${c.lastSeenAt ? 'zuletzt ' + esc(ago(c.lastSeenAt)) : 'nie gesehen'}${live?.script ? ' · Script ' + esc(live.script) : ''}</span></div>
    <div class="row" style="margin-top:10px"><select data-f="blueprint" aria-label="Bauplan"><option value="">– kein Bauplan –</option>${bp && !bpOptions.some(([id]) => id === bp.id) ? `<option value="${esc(bp.id)}" selected>${esc(bp.name)}</option>` : ''}${bpOptions.map(([id, name]) => `<option value="${esc(id)}"${bp?.id === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select>
      ${bp && bp.version !== bp.currentVersion ? `<button class="small" data-act="upgrade" data-bp="${esc(bp.id)}" title="Neuere Version zuweisen (neuer Auftrag, Reste gehen zurück)">v${bp.version} → v${bp.currentVersion}</button>` : ''}
      ${c.restNbt ? `<a class="btn small primary" href="${esc(c.restNbt)}" download>Rest-NBT</a>` : ''}</div>
    ${bp ? `${placementCard(bp, 'Einsetzkoordinaten · zugewiesene Schematic')}<div style="margin-top:10px"><div class="bar"><i style="width:${pct ?? 0}%"></i></div>
      <div class="muted" style="font-size:12px;margin-top:3px">${pct == null ? '–' : pct.toLocaleString('de-DE') + ' %'} · fehlt ${fmt(t.needed)} Items in ${fmt(t.kinds)} Sorten</div></div>` : ''}
    <div class="row" style="margin-top:8px"><span class="badge ${state === 'done' ? 'built' : ['waiting', 'error', 'missing', 'offline', 'nocomputer'].includes(state) ? 'warning' : 'ok'}">${esc(CANNON_STATE[state] || state)}</span>
      ${live?.chest ? `<span class="muted" style="font-size:12px">Kiste ${fmt(live.chest.used)}/${fmt(live.chest.slots)} Slots</span>` : ''}
      ${c.message ? `<span class="muted" style="font-size:12px">${esc(c.message)}</span>` : ''}${live?.message ? `<span class="muted" style="font-size:12px">${esc(live.message)}</span>` : ''}</div>
    ${shorts ? `<ul class="short">${shorts}</ul>` : ''}
    ${next && state !== 'done' ? `<div class="muted" style="font-size:12px;margin-top:6px">Als Nächstes: ${next}</div>` : ''}
    <div class="opts">
      <label><input type="checkbox" data-o="paused"${o.paused ? ' checked' : ''}> Pausiert</label>
      <label><input type="checkbox" data-o="autoCraft"${o.autoCraft ? ' checked' : ''}> Fehlendes craften</label>
      <label><input type="checkbox" data-o="returnLeftovers"${o.returnLeftovers ? ' checked' : ''}> Reste zurück ins ME</label>
      <label title="Zellen mit Maschine im Weg nicht beliefern (wie in der Rest-NBT)"><input type="checkbox" data-o="skipBlocked"${o.skipBlocked ? ' checked' : ''}> Maschinen-Zellen auslassen</label>
      <label>Puffer <input type="number" min="1" max="16" data-o="bufferStacks" value="${o.bufferStacks}"> Stacks</label>
      <label>Schießpulver <input type="number" min="0" max="64" data-o="gunpowder" value="${o.gunpowder}"></label>
      <label>Craft-Menge <input type="number" min="1" max="4096" data-o="craftBatch" value="${o.craftBatch}"></label>
    </div>
    ${alignmentCard(c)}
    <div class="row"><button class="small danger" data-act="delete"${c.alignment?.enabled?' disabled title="Gebundene Station geschützt"':''}>Entfernen</button></div>
  </div>`;
}
$('cannonList').addEventListener('change', guard(async e => {
  const card = e.target.closest('[data-cannon]');
  if (!card) return;
  const name = card.dataset.cannon, el = e.target;
  let body;
  if (el.dataset.f === 'blueprint') {
    if (!confirm(el.value ? `${name} baut ab jetzt „${el.selectedOptions[0].textContent}“. Reste des alten Auftrags gehen zurück ins ME. Weiter?` : `${name} keinen Bauplan mehr zuweisen?`)) { loadCannons(); return; }
    body = { blueprint: el.value || null };
  } else if (el.dataset.o) {
    body = { options: { [el.dataset.o]: el.type === 'checkbox' ? el.checked : Number(el.value) } };
  } else return;
  try {
    await api('/api/cannons/' + encodeURIComponent(name), { method: 'PUT', body });
    toast('Gespeichert. Der Computer holt es sich innerhalb einer Minute.');
  } finally { el.blur(); loadCannons().catch(() => {}); }
}));
$('cannonList').addEventListener('click', guard(async e => {
  const b = e.target.closest('button[data-act]'), card = e.target.closest('[data-cannon]');
  if (!b || !card) return;
  const name = card.dataset.cannon;
  const alignmentUrl='/api/cannons/'+encodeURIComponent(name)+'/alignment';
  if(b.dataset.act==='alignment-probe') {
    const binding={};
    for(const k of ['dimension','x','y','z','owner']) {
      const value=card.querySelector(`[data-bind="${k}"]`).value;
      if(!value)throw new Error('Dimension, x/y/z und Owner vollständig eingeben.');
      binding[k]=['x','y','z'].includes(k)?Number(value):value;
    }
    const probe=await api(alignmentUrl+'/probe',{method:'POST',body:{binding}});
    const o=probe.observed;
    if(confirm(`READ-ONLY PROBE: create:schematicannon in ${binding.dimension} ${binding.x} ${binding.y} ${binding.z}\nNative State: ${o.state}, AmountPlaced ${o.amountPlaced}\nOwner-Bindung: ${binding.owner}\nEingelegte Datei: ${o.components?.['create:schematic_file']||'keine'}\n\nIst dies wirklich die Kanone dieser Station? Bindung und Materialschutz AKTIVIEREN? Bis zum sicheren Apply wird die Materiallieferung gesperrt. Kein Welt-NBT-Write durch Binden. Native GUI bleibt bedienbar.`)) {
      await api(alignmentUrl+'/bind',{method:'POST',body:{binding,nonce:probe.nonce,confirm:true}});
      toast('Blockbindung bestätigt. Materialschutz aktiv; nach Stop/Reset Ausrichtung anwenden.');
    }
  }
  if(b.dataset.act==='alignment-apply') {
    if(!confirm('Nur gestoppte, ungestartete Kanone ohne Printer-Cache. Niemand darf während Apply die native GUI bedienen. Sichere Ausrichtung jetzt versuchen (kein Reset)?'))return;
    const result=await api(alignmentUrl+'/apply',{method:'POST',body:{}});toast(result.state==='aligned'?'Ausrichtung live bestätigt.':result.message);
  }
  if (b.dataset.act === 'delete') {
    if (!confirm(`${name} entfernen? Läuft der Computer noch, meldet er sich gleich wieder an.`)) return;
    await api('/api/cannons/' + encodeURIComponent(name), { method: 'DELETE' });
  }
  if (b.dataset.act === 'upgrade') {
    await api('/api/cannons/' + encodeURIComponent(name), { method: 'PUT', body: { blueprint: b.dataset.bp, version: null } });
  }
  loadCannons();
}));
document.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); showTab(a.dataset.goto); }));

// ---------- tokens ----------
const SCOPES = { write: 'Lesen + Schreiben', read: 'Nur lesen', station: 'Station (ME-Computer)' };
async function loadTokens() {
  const list = await api('/api/tokens');
  $('tokRows').innerHTML = list.map(t => `<tr><td>${esc(t.name)}</td><td>${SCOPES[t.scope] || esc(t.scope)}</td><td class="mono">${esc(t.prefix)}…</td><td>${esc(when(t.createdAt))}</td><td>${esc(ago(t.lastUsedAt))}</td>
    <td>${t.revokedAt ? '<span class="muted">widerrufen</span>' : `<button class="small danger" data-revoke="${t.id}">Widerrufen</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Noch keine Tokens.</td></tr>';
  $('tokRows').querySelectorAll('[data-revoke]').forEach(b => b.onclick = guard(async () => {
    if (!confirm('Token widerrufen? Agents mit diesem Token verlieren sofort den Zugriff.')) return;
    await api('/api/tokens/' + b.dataset.revoke, { method: 'DELETE' }); loadTokens();
  }));
  $('agentSnippet').textContent = agentSnippet('atc_…');
}
function agentSnippet(token) {
  const u = location.origin;
  return `# ATM10 Campus API (Doku: ${u}/docs, OpenAPI: ${u}/api/openapi.json)
export CAMPUS_URL=${u}
export CAMPUS_TOKEN=${token}

# Was ist live, was ist geplant, wo knallt es?
curl -s -H "Authorization: Bearer $CAMPUS_TOKEN" $CAMPUS_URL/api/status

# Bauplan lesen (Text-Schichten) und blockgenau ändern: erst dryRun, dann mit baseVersion speichern
curl -s -H "Authorization: Bearer $CAMPUS_TOKEN" "$CAMPUS_URL/api/blueprints/01_Technikhof_P01/layers?y=64..66"
curl -s -X POST -H "Authorization: Bearer $CAMPUS_TOKEN" -H "content-type: application/json" $CAMPUS_URL/api/blueprints/01_Technikhof_P01/edits \\
  -d '{"dryRun":true,"edits":[{"op":"replace","match":"minecraft:*_planks","block":"minecraft:spruce_planks"}]}'

# Oder ganze NBT holen, extern bearbeiten, mit baseVersion zurückspielen (409 = jemand war schneller)
curl -s -H "Authorization: Bearer $CAMPUS_TOKEN" -o 01_Technikhof_P01.nbt $CAMPUS_URL/api/blueprints/01_Technikhof_P01/download
curl -s -X PUT -H "Authorization: Bearer $CAMPUS_TOKEN" -H "content-type: application/octet-stream" \\
  --data-binary @01_Technikhof_P01.nbt "$CAMPUS_URL/api/blueprints/01_Technikhof_P01/nbt?baseVersion=1&note=Dach+angepasst"`;
}
$('tokCreate').onclick = guard(async () => {
  const name = $('tokName').value.trim();
  if (!name) { toast('Bitte einen Namen angeben.', true); return; }
  const t = await api('/api/tokens', { method: 'POST', body: { name, scope: $('tokScope').value } });
  $('tokNew').classList.remove('hide');
  $('tokNew').innerHTML = `<p>Neuer Token <strong>${esc(t.name)}</strong>. Jetzt kopieren, er wird nicht noch einmal angezeigt:</p><div class="secret" id="tokVal">${esc(t.token)}</div><div class="row" style="margin-top:8px"><button class="small" id="tokCopy">Kopieren</button><button class="small" id="tokCopySnippet">Agent-Anleitung mit Token kopieren</button></div>`;
  $('tokCopy').onclick = () => navigator.clipboard.writeText(t.token).then(() => toast('Kopiert.'));
  $('tokCopySnippet').onclick = () => navigator.clipboard.writeText(agentSnippet(t.token)).then(() => toast('Kopiert.'));
  $('tokName').value = ''; loadTokens();
});

// ---------- activity ----------
const ACTIONS = { 'blueprint.create': 'Bauplan angelegt', 'blueprint.version': 'Neue Version', 'blueprint.meta': 'Metadaten geändert', 'blueprint.archive': 'Archiviert', 'snapshot.capture': 'Snapshot erfasst', 'package.import': 'HTML importiert', 'token.create': 'Token erzeugt', 'token.revoke': 'Token widerrufen', 'invite.create': 'Einladung erzeugt', 'auth.register': 'Account angelegt', 'auth.login': 'Angemeldet', 'user.update': 'Account geändert', 'cannon.assign': 'Kanone zugewiesen', 'cannon.delete': 'Kanone entfernt' };
async function loadActivity() {
  const list = await api('/api/activity?limit=200');
  $('actRows').innerHTML = list.filter(a => a.action !== 'auth.login').map(a => `<tr><td>${esc(when(a.at))}</td><td>${esc(a.user || 'System')}</td><td>${esc(a.via)}</td><td>${esc(ACTIONS[a.action] || a.action)}</td><td class="mono">${esc(a.target || '')}</td>
    <td class="muted" style="font-size:12px">${esc(a.detail ? Object.entries(a.detail).filter(([k, v]) => v != null && typeof v !== 'object').map(([k, v]) => k + ': ' + v).join(', ') : '')}</td></tr>`).join('');
}

// ---------- admin ----------
async function loadAdmin() {
  const [inv, users, snaps] = await Promise.all([api('/api/invites'), api('/api/users'), api('/api/snapshots')]);
  $('impBase').innerHTML = '<option value="">Planungsstand: neuester Live-Snapshot</option>' + snaps.snapshots.map(s => `<option value="${s.id}">Planungsstand: #${s.id} ${esc(s.source === 'live' ? 'Live' : s.label)} (${esc(when(s.worldTime))})</option>`).join('');
  $('invRows').innerHTML = inv.map(i => `<tr><td>${esc(i.note || '–')}</td><td>${esc(i.role)}</td><td>${esc(when(i.createdAt))}</td><td>${esc(when(i.expiresAt))}</td><td>${esc(i.usedBy || '–')}</td>
    <td>${!i.usedAt && new Date(i.expiresAt) > new Date() ? `<button class="small danger" data-inv="${i.id}">Zurückziehen</button>` : ''}</td></tr>`).join('');
  $('invRows').querySelectorAll('[data-inv]').forEach(b => b.onclick = guard(async () => { await api('/api/invites/' + b.dataset.inv, { method: 'DELETE' }); loadAdmin(); }));
  $('userRows').innerHTML = users.map(u => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(when(u.createdAt))}</td><td>${u.disabledAt ? 'gesperrt' : 'aktiv'}</td>
    <td>${u.id === me.user.id ? '<span class="muted">du</span>' : `<button class="small" data-user="${u.id}" data-dis="${u.disabledAt ? 0 : 1}">${u.disabledAt ? 'Entsperren' : 'Sperren'}</button>`}</td></tr>`).join('');
  $('userRows').querySelectorAll('[data-user]').forEach(b => b.onclick = guard(async () => { await api('/api/users/' + b.dataset.user, { method: 'PATCH', body: { disabled: b.dataset.dis === '1' } }); loadAdmin(); }));
}
$('invCreate').onclick = guard(async () => {
  const r = await api('/api/invites', { method: 'POST', body: { note: $('invNote').value, role: $('invRole').value, days: Number($('invDays').value) } });
  $('invNew').classList.remove('hide');
  $('invNew').innerHTML = `<p>Einladungslink (${r.days} Tage, einmalig nutzbar):</p><div class="secret">${esc(r.url)}</div><button class="small" id="invCopy" style="margin-top:8px">Kopieren</button>`;
  $('invCopy').onclick = () => navigator.clipboard.writeText(r.url).then(() => toast('Kopiert.'));
  $('invNote').value = ''; loadAdmin();
});
$('impGo').onclick = guard(async () => {
  const f = $('impFile').files[0];
  if (!f) { toast('Bitte eine HTML-Datei wählen.', true); return; }
  $('impGo').disabled = true;
  try {
    const q = new URLSearchParams();
    if ($('impForce').checked) q.set('force', '1');
    if ($('impBase').value) q.set('baseSnapshot', $('impBase').value);
    const r = await api('/api/import/html?' + q, { method: 'POST', body: f, headers: { 'content-type': 'text/html' } });
    $('impOut').classList.remove('hide');
    $('impOut').textContent = `Import ${r.uiVersion || ''}: ${r.created.length} neu, ${r.updated.length} aktualisiert, ${r.unchanged.length} unverändert, ${r.skippedConflicts.length} Konflikte, ${r.errors.length} Fehler\n\n` + JSON.stringify({ skippedConflicts: r.skippedConflicts, errors: r.errors, notInImport: r.notInImport, warnings: r.warnings }, null, 2);
    toast('Import abgeschlossen.'); loadStatus();
  } finally { $('impGo').disabled = false; }
});

$('logout').onclick = guard(async () => { await api('/api/auth/logout', { method: 'POST' }); location.href = '/login'; });

function routeFromHash() {
  const tab = location.hash.slice(1), bpLink = /^bp=(.+)$/.exec(tab);
  closeDrawer();
  showTab(['overview', 'coordinates', 'snapshots', 'cannons', 'agent', 'activity', 'admin'].includes(tab) ? tab : 'overview');
  if (bpLink) openBlueprint(decodeURIComponent(bpLink[1]));
}
window.addEventListener('hashchange', () => { if (me) routeFromHash(); });

(async () => {
  try {
    me = await api('/api/me');
    $('who').textContent = me.user.username;
    if (me.user.role === 'admin') $('adminTab').classList.remove('hide');
    routeFromHash();
    setInterval(() => { if (!document.hidden && !$('drawer').classList.contains('open')) loadStatus().catch(() => {}); }, 60e3);
  } catch (e) { toast(e.message, true); }
})();
