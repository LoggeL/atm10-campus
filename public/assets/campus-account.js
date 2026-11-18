import { api } from './campus-client.js?v=20261114-status-1';
import { esc } from './format.js?v=20261114-status-1';
const $ = (id) => document.getElementById(id);
const SCOPES = {
  write: 'Lesen + Schreiben',
  read: 'Nur lesen',
  station: 'Station (ME-Computer)',
  erebor_supply: 'Erebor-Materialpuffer',
};

export function setupAccountTools({ currentUser, when, ago, guard, toast, loadStatus }) {
  // ---------- tokens ----------
  async function loadTokens() {
    const list = await api('/api/tokens');
    $('tokRows').innerHTML =
      list
        .map(
          (
            t,
          ) => `<tr><td>${esc(t.name)}</td><td>${SCOPES[t.scope] || esc(t.scope)}</td><td class="mono">${esc(t.prefix)}…</td><td>${esc(when(t.createdAt))}</td><td>${esc(ago(t.lastUsedAt))}</td>
    <td>${t.revokedAt ? '<span class="muted">widerrufen</span>' : `<button class="small danger" data-revoke="${t.id}">Widerrufen</button>`}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6" class="muted">Noch keine Tokens.</td></tr>';
    $('tokRows')
      .querySelectorAll('[data-revoke]')
      .forEach(
        (b) =>
          (b.onclick = guard(async () => {
            if (!confirm('Token widerrufen? Agents mit diesem Token verlieren sofort den Zugriff.')) return;
            await api('/api/tokens/' + b.dataset.revoke, { method: 'DELETE' });
            loadTokens();
          })),
      );
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
    if (!name) {
      toast('Bitte einen Namen angeben.', true);
      return;
    }
    const t = await api('/api/tokens', { method: 'POST', body: { name, scope: $('tokScope').value } });
    $('tokNew').classList.remove('hide');
    $('tokNew').innerHTML =
      `<p>Neuer Token <strong>${esc(t.name)}</strong>. Jetzt kopieren, er wird nicht noch einmal angezeigt:</p><div class="secret" id="tokVal">${esc(t.token)}</div><div class="row"><button class="small" id="tokCopy">Kopieren</button><button class="small" id="tokCopySnippet">Agent-Anleitung mit Token kopieren</button></div>`;
    $('tokCopy').onclick = () => navigator.clipboard.writeText(t.token).then(() => toast('Kopiert.'));
    if (t.scope === 'erebor_supply') {
      $('tokCopySnippet').remove();
      const hint = document.createElement('p');
      hint.textContent =
        'Für Codex auf Windows: Kopiere den Token und speichere ihn in der Benutzervariable CAMPUS_SUPPLY_TOKEN. Über „Widerrufen“ kannst du den Zugriff jederzeit beenden.';
      $('tokNew').append(hint);
    } else {
      $('tokCopySnippet').onclick = () =>
        navigator.clipboard.writeText(agentSnippet(t.token)).then(() => toast('Kopiert.'));
    }
    $('tokName').value = '';
    loadTokens();
  });

  // ---------- activity ----------
  const ACTIONS = {
    'blueprint.create': 'Bauplan angelegt',
    'blueprint.version': 'Neue Version',
    'blueprint.meta': 'Metadaten geändert',
    'blueprint.archive': 'Archiviert',
    'snapshot.capture': 'Snapshot erfasst',
    'package.import': 'HTML importiert',
    'token.create': 'Token erzeugt',
    'token.revoke': 'Token widerrufen',
    'invite.create': 'Einladung erzeugt',
    'auth.register': 'Account angelegt',
    'auth.login': 'Angemeldet',
    'user.update': 'Account geändert',
    'cannon.assign': 'Kanone zugewiesen',
    'cannon.transfer': 'Auftrag verschoben',
    'cannon.delete': 'Kanone entfernt',
    'cannon.start': 'Kanone gestartet',
  };
  async function loadActivity() {
    const list = await api('/api/activity?limit=200');
    $('actRows').innerHTML =
      list
        .filter((a) => a.action !== 'auth.login')
        .map(
          (
            a,
          ) => `<tr><td>${esc(when(a.at))}</td><td>${esc(a.user || 'System')}</td><td>${esc(a.via)}</td><td>${esc(ACTIONS[a.action] || a.action)}</td><td class="mono">${esc(a.target || '')}</td>
    <td class="cell-note">${esc(
      a.detail
        ? Object.entries(a.detail)
            .filter(([k, v]) => v != null && typeof v !== 'object')
            .map(([k, v]) => k + ': ' + v)
            .join(', ')
        : '',
    )}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6" class="muted">Noch keine Änderungen.</td></tr>';
  }

  // ---------- admin ----------
  async function loadAdmin() {
    const [inv, users, snaps] = await Promise.all([api('/api/invites'), api('/api/users'), api('/api/snapshots')]);
    const selectedBase = $('impBase').value;
    $('impBase').innerHTML =
      '<option value="">Planungsstand: neuester Live-Snapshot</option>' +
      snaps.snapshots
        .map(
          (s) =>
            `<option value="${s.id}">Planungsstand: #${s.id} ${esc(s.source === 'live' ? 'Live' : s.label)} (${esc(when(s.worldTime))})</option>`,
        )
        .join('');
    if ([...$('impBase').options].some((option) => option.value === selectedBase))
      $('impBase').value = selectedBase;
    $('invRows').innerHTML =
      inv
        .map(
          (
            i,
          ) => `<tr><td>${esc(i.note || '–')}</td><td>${esc(i.role)}</td><td>${esc(when(i.createdAt))}</td><td>${esc(when(i.expiresAt))}</td><td>${esc(i.usedBy || '–')}</td>
    <td>${!i.usedAt && new Date(i.expiresAt) > new Date() ? `<button class="small danger" data-inv="${i.id}">Zurückziehen</button>` : ''}</td></tr>`,
        )
        .join('') || '<tr><td colspan="6" class="muted">Noch keine Einladungen.</td></tr>';
    $('invRows')
      .querySelectorAll('[data-inv]')
      .forEach(
        (b) =>
          (b.onclick = guard(async () => {
            await api('/api/invites/' + b.dataset.inv, { method: 'DELETE' });
            loadAdmin();
          })),
      );
    $('userRows').innerHTML = users
      .map(
        (
          u,
        ) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${esc(when(u.createdAt))}</td><td>${u.disabledAt ? 'gesperrt' : 'aktiv'}</td>
    <td>${u.id === currentUser().id ? '<span class="muted">du</span>' : `<button class="small" data-user="${u.id}" data-dis="${u.disabledAt ? 0 : 1}">${u.disabledAt ? 'Entsperren' : 'Sperren'}</button>`}</td></tr>`,
      )
      .join('');
    $('userRows')
      .querySelectorAll('[data-user]')
      .forEach(
        (b) =>
          (b.onclick = guard(async () => {
            await api('/api/users/' + b.dataset.user, {
              method: 'PATCH',
              body: { disabled: b.dataset.dis === '1' },
            });
            loadAdmin();
          })),
      );
  }
  $('invCreate').onclick = guard(async () => {
    const r = await api('/api/invites', {
      method: 'POST',
      body: { note: $('invNote').value, role: $('invRole').value, days: Number($('invDays').value) },
    });
    $('invNew').classList.remove('hide');
    $('invNew').innerHTML =
      `<p>Einladungslink (${r.days} Tage, einmalig nutzbar):</p><div class="secret">${esc(r.url)}</div><button class="small" id="invCopy">Kopieren</button>`;
    $('invCopy').onclick = () => navigator.clipboard.writeText(r.url).then(() => toast('Kopiert.'));
    $('invNote').value = '';
    loadAdmin();
  });
  $('impGo').onclick = guard(async () => {
    const f = $('impFile').files[0];
    if (!f) {
      toast('Bitte eine HTML-Datei wählen.', true);
      return;
    }
    $('impGo').disabled = true;
    try {
      const q = new URLSearchParams();
      if ($('impForce').checked) q.set('force', '1');
      if ($('impBase').value) q.set('baseSnapshot', $('impBase').value);
      const r = await api('/api/import/html?' + q, {
        method: 'POST',
        body: f,
        headers: { 'content-type': 'text/html' },
      });
      $('impOut').classList.remove('hide');
      $('impOut').textContent =
        `Import ${r.uiVersion || ''}: ${r.created.length} neu, ${r.updated.length} aktualisiert, ${r.unchanged.length} unverändert, ${r.skippedConflicts.length} Konflikte, ${r.errors.length} Fehler\n\n` +
        JSON.stringify(
          {
            skippedConflicts: r.skippedConflicts,
            errors: r.errors,
            notInImport: r.notInImport,
            warnings: r.warnings,
          },
          null,
          2,
        );
      toast('Import abgeschlossen.');
      loadStatus();
    } finally {
      $('impGo').disabled = false;
    }
  });

  function configure() {
    if (currentUser().role === 'admin') $('tokScope').add(new Option(SCOPES.erebor_supply, 'erebor_supply'));
  }
  return { configure, loadTokens, loadActivity, loadAdmin };
}
