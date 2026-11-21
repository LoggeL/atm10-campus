import { esc, fmt } from './format.js?v=20261114-status-1';
export const states = {
  placing: 'Baut',
  clearing: 'Hebt aus',
  searching: 'Sucht Ziel',
  waiting: 'Wartet',
  handover: 'Planwechsel',
  idle: 'Frei',
  unknown: 'Kein Signal',
  unverified: 'Plan ungeprüft',
};
const reasons = {
  missingItem: 'Material fehlt',
  missingBlock: 'Baublock fehlt',
  noGunpowder: 'Schießpulver fehlt',
  targetNotLoaded: 'Zielchunk lädt',
  ready: 'Startbereit',
};
export const borrowed = (row) => row.home && row.home !== row.site;
export function freshFleet(data, now = Date.now()) {
  const age = now - data.telemetryAt;
  const fresh = Number.isFinite(data.telemetryAt) && age >= 0 && age < 45000;
  return {
    fresh,
    rows: fresh ? data.fleet : data.fleet.map((row) => ({ ...row, state: 'unknown', placed: null, total: null })),
  };
}
export function landscapePanel(surface){
 if(!surface)return '<p>Für die aktuelle Bergversion sind keine Landschaftspläne veröffentlicht.</p>';
 return '<div class="facts"><span><b>'+fmt(surface.published)+' / '+fmt(surface.regions)+'</b> Regionen veröffentlicht</span>'+
  '<span><b>'+fmt(surface.files)+'</b> Schematics</span><span><b>'+fmt(surface.blocks)+'</b> geplante Blöcke</span></div>'+
  '<p class="volume">Erde und Wald an den unteren Hängen · '+fmt(surface.trees)+' geplante Bäume · Schneegipfel auf Y '+fmt(surface.summitY)+'</p>'+
  '<p class="meta">Die Aufgabenliste zählt die abgeschlossenen und zugewiesenen Landschaftspläne.</p>'+
  '<p class="volume"><a href="/app?project=erebor&amp;surface=1#overview">Landschafts-Baupläne öffnen</a> · <a href="/projects?id=erebor#landschaft">Höhenprofil ansehen</a></p>';
}

export function workloadDetails(massif, unassigned) {
  const w = massif?.workload;
  if (!w) return '<p>Der veröffentlichte Blockumfang ist unbekannt.</p>';
  return (
    '<p><b>' +
    fmt(w.grossBlocks) +
    '</b> Planblöcke in unfertigen automatischen Massiv-Teilen, davon ' +
    fmt(w.assignedBlocks) +
    ' in zugewiesenen Teilen. Der laufende Druckfortschritt ist darin enthalten.</p>' +
    '<p>' +
    fmt(w.manualBlocks) +
    ' Zielblöcke außerhalb der automatischen Urnenaufträge. ' +
    fmt(unassigned?.total) +
    ' veröffentlichte Teile ohne Stationszuordnung. Weitere Weltprüfungen können neue Teile ergeben.</p>'
  );
}
export function stationCounts(row) {
  if (!row) return '';
  const mass = row.massif;
  const types = [
    ['Massiv', mass],
    ['Cleanstone-Katalog', row.stages.stone],
    ['Aushub', row.stages.clear],
    ['Architektur', row.stages.build],
  ];
  return (
    '<details class="more-counts"><summary>Arbeitsumfang dieser Station</summary>' +
    types
      .map(
        ([name, r]) =>
          '<p>' +
          name +
          ' · ' +
          (r
            ? fmt(r.done) + ' / ' + fmt(r.total) + ' erledigt · ' + fmt(r.open + r.inProgress) + ' ausstehend'
            : 'Unbekannt') +
          '</p>',
      )
      .join('') +
    (mass?.workload
      ? '<p>' +
        fmt(mass.workload.grossBlocks) +
        ' automatische Planblöcke ausstehend, davon ' +
        fmt(mass.workload.assignedBlocks) +
        ' zugewiesen. Gesondert zu prüfen sind ' +
        fmt(mass.workload.manualBlocks) +
        ' Planblöcke.</p>'
      : '') +
    '</details>'
  );
}
export function slotDetail(r, throughput) {
  const why = r.state === 'waiting' && reasons[r.reason] ? ' · ' + reasons[r.reason] : '';
  const assigned = r.tile || r.file;
  const source = borrowed(r) ? '<p class="meta borrow">Übernimmt einen Teil von ' + esc(r.home) + '</p>' : '';
  const speed = throughput?.cannons.find(
    (c) => c.station === (r.slot === 'A' ? r.site : r.site + r.slot) && c.file === r.file,
  );
  const measured =
    speed?.blocksPerSecond != null
      ? '<p class="meta">' +
        fmt(Math.round(speed.blocksPerSecond * 10) / 10) +
        ' Blöcke/s · ' +
        fmt(speed.blocksPerHour) +
        ' Blöcke/h' +
        (speed.etaSeconds != null
          ? ' · ca. ' + fmt(Math.max(1, Math.ceil(speed.etaSeconds / 60))) + ' min für diesen Auftrag'
          : '') +
        '</p>'
      : '';
  const progress =
    r.placed != null
      ? '<p class="meta">' +
        fmt(r.placed) +
        (r.total > 0 ? ' / ' + fmt(r.total) : '') +
        ' Blöcke laut Kanone</p>' +
        (r.total > 0
          ? '<progress max="' +
            Number(r.total) +
            '" value="' +
            Number(r.placed) +
            '" aria-label="Baufortschritt Kanone ' +
            esc(r.slot) +
            '"></progress>'
          : '')
      : '';
  return (
    '<div class="slot"><div class="slot-head"><span class="slot-name">Kanone ' +
    esc(r.slot) +
    '</span><span>' +
    states[r.state] +
    why +
    '</span></div>' +
    (assigned ? '<p class="file">' + esc(assigned) + '</p>' : '') +
    source +
    progress +
    measured +
    '</div>'
  );
}

export function forecastView(estimate) {
  const label = '<h3>ETA der Massiv-Füllung</h3>';
  const messages = {
    unknown: 'Noch keine automatischen Massiv-Teile veröffentlicht.',
    sampling: 'Für eine Schätzung fehlen noch genügend bestätigte Abschlüsse.',
    inactive: 'Seit 30 Minuten wurde kein weiterer Teil abgeschlossen.',
    paused: 'Die Vergabe neuer Massiv-Aufträge ist pausiert.',
    complete: 'Alle veröffentlichten automatischen Massiv-Teile sind fertig.',
    offline: 'Die Prognose konnte nicht aktualisiert werden.',
  };
  if (estimate?.state !== 'estimated') return label + '<p>' + messages[estimate?.state ?? 'unknown'] + '</p>';
  const hours = Math.ceil(estimate.seconds / 3600);
  let duration;
  if (estimate.seconds < 3600) duration = Math.max(1, Math.ceil(estimate.seconds / 60)) + ' min';
  else if (hours < 48) duration = hours + ' Std.';
  else duration = Math.floor(hours / 24) + ' Tage' + (hours % 24 ? ' ' + (hours % 24) + ' Std.' : '');
  const roundedTime = Math.ceil(estimate.finishAt / 900000) * 900000;
  const finish = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(roundedTime);
  return (
    label +
    '<p class="eta-line"><strong>Noch ca. ' +
    duration +
    '</strong><span>Voraussichtlich ' +
    esc(finish) +
    ' Uhr (Berlin)</span></p>' +
    '<p class="meta">' +
    fmt(Math.round(estimate.blocksPerHour)) +
    ' Planblöcke/h · ' +
    fmt(estimate.completedParts) +
    ' bestätigte Teile in ' +
    fmt(Math.round(estimate.windowSeconds / 60)) +
    ' min. Gilt für die veröffentlichten Festgestein- und Hohlraumteile.</p>'
  );
}
