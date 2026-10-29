'use strict';
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
  ({ overview: loadStatus, snapshots: loadSnapshots, agent: loadTokens, activity: loadActivity, admin: loadAdmin })[tab]?.();
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
    <div class="row" style="margin-top:10px">${st ? badge(st.status) : ''}<a class="btn small primary" href="/api/blueprints/${encodeURIComponent(id)}/download">NBT herunterladen (v${bp.currentVersion})</a><button class="small" id="dUpload">Neue Version hochladen</button><a class="btn small" href="/viewer">Im 3D-Viewer</a></div>
    <dl class="kv">
      <dt>Position (origin)</dt><dd class="mono">${esc(cur?.origin.join(', '))} <button class="small" id="dMove">ändern</button></dd>
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

// ---------- tokens ----------
async function loadTokens() {
  const list = await api('/api/tokens');
  $('tokRows').innerHTML = list.map(t => `<tr><td>${esc(t.name)}</td><td>${t.scope === 'write' ? 'Lesen + Schreiben' : 'Nur lesen'}</td><td class="mono">${esc(t.prefix)}…</td><td>${esc(when(t.createdAt))}</td><td>${esc(ago(t.lastUsedAt))}</td>
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

# Bauplan holen, bearbeiten, mit baseVersion zurückspielen (409 = jemand war schneller)
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
const ACTIONS = { 'blueprint.create': 'Bauplan angelegt', 'blueprint.version': 'Neue Version', 'blueprint.meta': 'Metadaten geändert', 'blueprint.archive': 'Archiviert', 'snapshot.capture': 'Snapshot erfasst', 'package.import': 'HTML importiert', 'token.create': 'Token erzeugt', 'token.revoke': 'Token widerrufen', 'invite.create': 'Einladung erzeugt', 'auth.register': 'Account angelegt', 'auth.login': 'Angemeldet', 'user.update': 'Account geändert' };
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

(async () => {
  try {
    me = await api('/api/me');
    $('who').textContent = me.user.username;
    if (me.user.role === 'admin') $('adminTab').classList.remove('hide');
    const tab = location.hash.slice(1);
    showTab(['overview', 'snapshots', 'agent', 'activity', 'admin'].includes(tab) ? tab : 'overview');
    setInterval(() => { if (!document.hidden && !$('drawer').classList.contains('open')) loadStatus().catch(() => {}); }, 60e3);
  } catch (e) { toast(e.message, true); }
})();
