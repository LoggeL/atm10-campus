import { esc, fmt } from './format.js?v=20261114-status-1';
export const states = {
  placing: 'Baut',
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
    ' Planblöcke in manuellen Sonderzielen. ' +
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
        ' zugewiesen. Sonderziele: ' +
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
