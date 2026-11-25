import {
  states,
  borrowed,
  freshFleet,
  workloadDetails,
  stationCounts,
  slotDetail,
  forecastView,
  landscapePanel,
  taskProgressCell,
} from './erebor-progress-view.js?v=20261125-overhaul-1';
import { esc, fmt, formatBerlinTime } from './format.js?v=20261125-overhaul-1';
import { api, linkStation } from './campus-client.js?v=20261125-overhaul-1';
import { connectPolling } from './live-updates.js?v=20261125-overhaul-1';

const el = (id) => document.getElementById(id);

function percent(done, total) {
  if (!(total > 0)) return '–';
  const value = (100 * done) / total;
  if (value > 0 && value < 0.1) return '&lt; 0,1 %';
  if (value > 99.9 && value < 100) return '&gt; 99,9 %';
  return fmt(Math.round(value * 10) / 10) + ' %';
}

function progressTrack(done, total, active = 0) {
  if (!(total > 0)) return '';
  const donePct = Math.min(100, Math.max(0, (100 * (done || 0)) / total));
  const activePct = Math.min(100 - donePct, Math.max(0, (100 * (active || 0)) / total));
  return (
    '<div class="c-progress c-progress--lg" aria-hidden="true">' +
    '<span class="c-progress-bar c-progress-bar--ok" style="width:' +
    donePct +
    '%"></span>' +
    (activePct > 0
      ? '<span class="c-progress-bar c-progress-bar--warn" style="width:' + activePct + '%"></span>'
      : '') +
    '</div>'
  );
}

let data = null;
let selected = new URL(location.href).searchParams.get('kanone') || 'K01';
let showedFresh = false;
let lastError = null;

function updateStatusPill(state = null) {
  const pill = el('status-pill');
  const bar = el('poll-progress');
  const button = el('refresh');
  if (bar && state) bar.value = Math.round((state.progress ?? 0) * 100);
  if (button && state) button.disabled = state.phase === 'refreshing';
  if (!pill) return;
  if (lastError) {
    pill.dataset.state = 'error';
  } else if (state?.phase === 'refreshing' && !data) {
    pill.dataset.state = 'loading';
  } else if (data) {
    pill.dataset.state = showedFresh ? 'current' : 'stale';
  } else {
    pill.dataset.state = 'loading';
  }
}

function renderSummary(fleet) {
  const overall = data.overall;
  const done = overall?.done;
  const total = overall?.total;
  const working = fleet.filter((r) => r.state === 'placing').length;
  const clearing = fleet.filter((r) => r.state === 'clearing').length;
  const known = fleet.filter((r) => r.state !== 'unknown').length;
  const transfers = fleet.filter(borrowed).length;
  const throughput = data.throughput;
  const fleetBadge =
    known > 0 && showedFresh
      ? '<span class="c-badge c-badge--ok">Live · ' + fmt(known) + ' Signale</span>'
      : '<span class="c-badge c-badge--neutral">Ohne Weltmeldung</span>';
  const balanceText = data.balance.enabled
    ? data.balance.plannedAt
      ? 'Lastverteilung um ' + formatBerlinTime(data.balance.plannedAt) + ' Uhr'
      : 'Lastverteilung bereit'
    : 'Massiv-Vergabe pausiert';

  el('summary').innerHTML =
    '<article class="c-card c-card--accent dash-hero-card">' +
    '<div class="dash-card-head"><h3>Erebor gesamt</h3><span class="c-badge c-badge--ok">' +
    fmt(done) +
    ' / ' +
    fmt(total) +
    '</span></div>' +
    '<div class="dash-metric-line"><strong class="dash-big">' +
    percent(done, total) +
    '</strong><span class="dash-unit">der veröffentlichten Bauaufgaben erledigt</span></div>' +
    progressTrack(done, total, overall?.inProgress) +
    '<div class="dash-facts">' +
    '<span><b>' +
    fmt(done) +
    ' / ' +
    fmt(total) +
    '</b> erledigt</span>' +
    '<span><b>' +
    fmt(overall?.inProgress) +
    '</b> zugewiesen</span>' +
    '<span><b>' +
    fmt(overall?.open) +
    '</b> offen</span>' +
    '</div>' +
    '<p class="dash-meta">Bergfüllung, Urnen und Sonderziele, Aushub, Bauwerke und Bergaußenhaut. Jeder Plan und jedes einzelne Urnenziel zählt einmal.</p>' +
    '</article>' +
    '<article class="c-card dash-hero-card">' +
    '<div class="dash-card-head"><h3>Kanonen im Einsatz</h3>' +
    fleetBadge +
    '</div>' +
    '<div class="dash-metric-line"><strong class="dash-big">' +
    (known ? fmt(working + clearing) : '–') +
    '</strong><span class="dash-unit">von ' +
    fmt(fleet.length) +
    ' Kanonen</span></div>' +
    '<div class="dash-facts">' +
    (known
      ? '<span><b>' + fmt(working) + '</b> setzen Blöcke</span><span><b>' + fmt(clearing) + '</b> heben aus</span>'
      : '') +
    '<span><b>' +
    fmt(transfers) +
    '</b> gebietsübergreifende Aufträge</span>' +
    (showedFresh && throughput?.covered
      ? '<span><b>' +
        fmt(Math.round(throughput.blocksPerSecond)) +
        '</b> Blöcke/s (' +
        fmt(throughput.covered) +
        ' / ' +
        fmt(throughput.assigned) +
        ' zugewiesenen Kanonen gemessen)</span>'
      : '') +
    '</div>' +
    '<p class="dash-meta">' +
    (known ? fmt(known) + ' mit Weltmeldung' : 'Weltmeldung ausstehend') +
    ' · ' +
    balanceText +
    '</p>' +
    '</article>';
}

function renderTasks() {
  const f = data.filling;
  const rows = [
    ['Festgestein ersetzen', f?.solid],
    ['Hohlräume füllen', f?.cavity],
    ['Urnen automatisch ersetzen', f?.urn],
    ...(f?.manual?.total ? [['Geschützte Sonderziele', f.manual]] : []),
    ['Cleanstone-Katalog', data.stages.stone],
    ['Aushub', data.overall?.architecture.clear],
    ['Architektur bauen', data.overall?.architecture.build],
    [
      '<a href="/app?project=erebor&amp;surface=1#overview">Bergaußenhaut</a><span class="task-sub">Erde, Gras, Wald, Fels und Schnee</span>',
      data.surface?.task,
    ],
  ];
  el('tasks').innerHTML = rows
    .map(([name, row]) => {
      const assignedClass = row?.inProgress > 0 ? 'num c-mono dash-in-progress' : 'num c-mono';
      return (
        '<tr><th scope="row">' +
        name +
        '</th><td class="num">' +
        taskProgressCell(row) +
        '</td><td class="' +
        assignedClass +
        '">' +
        fmt(row?.inProgress) +
        '</td><td class="num c-mono">' +
        fmt(row?.open) +
        '</td></tr>'
      );
    })
    .join('');
}

function stationMatches(rows, filter) {
  if (filter === 'borrowed') return rows.some(borrowed);
  if (filter === 'waiting') return rows.some((r) => ['waiting', 'searching', 'handover'].includes(r.state));
  if (filter === 'unknown') return rows.some((r) => ['unknown', 'unverified'].includes(r.state));
  return filter === 'all' || rows.some((r) => r.state === filter);
}

function renderFleet(fleet) {
  const groups = new Map();
  for (const row of fleet) {
    if (!groups.has(row.site)) groups.set(row.site, []);
    groups.get(row.site).push(row);
  }
  const filterValue = el('filter').value;
  const visible = [...groups].filter(([, rows]) => stationMatches(rows, filterValue));
  const countBadge = el('fleet-count');
  if (countBadge) {
    countBadge.hidden = groups.size === 0;
    countBadge.textContent =
      visible.length === groups.size
        ? fmt(groups.size) + ' Stationen'
        : fmt(visible.length) + ' / ' + fmt(groups.size) + ' Stationen';
  }
  if (!visible.some(([site]) => site === selected)) selected = visible[0]?.[0] ?? '';
  const focused = document.activeElement?.dataset.site;
  el('fleet').innerHTML = visible
    .map(([site, rows]) => {
      const label = site + ', ' + rows.map((r) => r.slot + ' ' + states[r.state]).join(', ');
      return (
        '<button type="button" class="station" data-site="' +
        esc(site) +
        '" aria-label="' +
        esc(label) +
        '" aria-pressed="' +
        (selected === site) +
        '"><b>' +
        esc(site) +
        '</b><span class="chips">' +
        rows
          .map((r) => '<span class="chip ' + r.state + '" title="' + states[r.state] + '">' + esc(r.slot) + '</span>')
          .join('') +
        '</span></button>'
      );
    })
    .join('');
  if (focused) [...el('fleet').children].find((b) => b.dataset.site === focused)?.focus({ preventScroll: true });
  linkStation(selected);
  el('empty').hidden = visible.length > 0;
  el('detail').hidden = !selected;
  const expanded = el('detail').dataset.site === selected && el('detail').querySelector('details')?.open;
  el('detail').dataset.site = selected;
  if (selected) {
    const selectedRows = groups.get(selected);
    const slotsHtml = selectedRows.map((row) => slotDetail(row, showedFresh ? data.throughput : null)).join('');
    const extraInstaller =
      selected === 'K09'
        ? '<a class="c-btn c-btn--ghost c-btn--sm detail-action" download href="/assets/erebor-k09-ausbau.zip">Homebox-Installer K09 Nord/Süd</a>'
        : selectedRows.some((r) => r.slot === 'I')
          ? '<a class="c-btn c-btn--ghost c-btn--sm detail-action" download href="/assets/erebor-ausbau-18.zip">Sammelinstaller (18 Standorte)</a>'
          : '';
    el('detail').innerHTML =
      '<div class="detail-head"><h3>Station ' +
      esc(selected) +
      '</h3><span class="c-badge c-badge--neutral c-mono">' +
      selectedRows.map((r) => esc(r.slot)).join(' / ') +
      '</span></div>' +
      '<div class="slot-list">' +
      slotsHtml +
      '</div>' +
      stationCounts(data.stations[selected]) +
      '<div class="detail-actions">' +
      '<a class="c-btn c-btn--primary c-btn--sm detail-action" href="/app?project=erebor&amp;kanone=' +
      esc(selected) +
      '#overview">Bauaufträge für ' +
      esc(selected) +
      ' öffnen</a>' +
      '<a class="c-btn c-btn--sm detail-action" href="/app?project=erebor&amp;kanone=' +
      esc(selected) +
      '#cannons">Steuerung</a>' +
      extraInstaller +
      '</div>';
  }
  if (expanded && selected) el('detail').querySelector('details').open = true;
}

function render() {
  if (!data) return;
  const { fresh, rows: fleet } = freshFleet(data);
  showedFresh = fresh;
  renderSummary(fleet);
  renderFleet(fleet);
  updateStatusPill();
}

async function refresh() {
  try {
    data = await api('/api/projects/erebor/dashboard');
    lastError = null;
    el('error').hidden = true;
    el('forecast').innerHTML = forecastView(data.forecast);
    el('stamp').textContent = 'Stand ' + formatBerlinTime(data.capturedAt) + ' Uhr (Berlin)';
    renderTasks();
    el('landscape').innerHTML =
      landscapePanel(data.surface) +
      (data.landscapeAutomationEnabled === false
        ? '<p class="dash-meta">Für den automatischen Landschaftsbau fehlt die Homebox-Erweiterung. <a download href="/assets/erebor-baufolge.py">Installer für Logge</a></p>'
        : '');
    const manual = data.filling?.manual;
    el('quantities').innerHTML =
      workloadDetails(data.massif, data.unassignedMassif) +
      (manual?.open
        ? '<p>' +
          fmt(manual.open) +
          ' offene Sonderpläne für sonstige Block-Entities. <a href="/api/projects/erebor/stone/massif/plans?special=1">Ziele ansehen</a></p>'
        : '');
    render();
    return true;
  } catch (error) {
    lastError = error.message;
    el('forecast').innerHTML = forecastView({ state: 'offline' });
    if (data) {
      data.telemetryAt = null;
      render();
    }
    el('error').textContent = 'Projektstand konnte nicht aktualisiert werden (' + error.message + ').';
    el('error').hidden = false;
    updateStatusPill();
    throw error;
  }
}

el('legend').innerHTML = [
  ['placing', 'Baut / hebt aus'],
  ['waiting', 'Sucht / wartet'],
  ['handover', 'Planwechsel'],
  ['idle', 'Frei'],
  ['unverified', 'Ungeprüft'],
  ['unknown', 'Kein Signal'],
]
  .map(([kind, label]) => '<span><i class="dot ' + kind + '"></i>' + label + '</span>')
  .join('');

el('fleet').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-site]');
  if (!button) return;
  selected = button.dataset.site;
  const url = new URL(location.href);
  url.searchParams.set('kanone', selected);
  history.replaceState(null, '', url);
  render();
  if (matchMedia('(max-width: 860px)').matches) el('detail').scrollIntoView({ block: 'nearest' });
});

el('filter').addEventListener('change', render);

const poller = connectPolling({
  refresh,
  intervalMs: 15_000,
  immediate: true,
  onState(state) {
    if (showedFresh && data && Date.now() - data.telemetryAt >= 45000) render();
    updateStatusPill(state);
  },
});

el('refresh').addEventListener('click', () => poller.refreshNow('manual'));
