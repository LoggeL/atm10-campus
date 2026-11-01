const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const distanceText = value => Number(value).toLocaleString('de-DE', { maximumFractionDigits: Math.abs(value - 256) < 1 ? 3 : 1 });

export function cannonRangeCard(c, canTransfer = false) {
  const r = c.range;
  if (!r || r.state === 'unassigned') return '';
  if (r.distance == null) return `<div class="range-card muted">${esc(r.message)}</div>`;
  const out = r.state === 'outofrange';
  const labels = { free: 'Frei und online', assigned: 'Bereits beauftragt', offline: 'Computer offline', applying: 'Vorbereitung läuft', outdated: 'Computer aktualisieren oder neue Statusmeldung abwarten' };
  const candidates = r.candidates || [], free = candidates.filter(x => x.availability === 'free');
  return `<div class="range-card${out ? ' range-warning' : ''}" aria-label="Reichweite">
    <div class="row"><strong>${esc(distanceText(r.distance))} Blöcke zum Bauplan-Anker</strong><span class="badge ${out ? 'warning' : 'ok'}">${out ? 'Außer Reichweite' : 'In Reichweite'}</span></div>
    <p class="muted">Grenze: weniger als ${r.limit} Blöcke Luftlinie, Höhe eingeschlossen. Geprüft für v${r.version}, Ziel <span class="mono">${esc(r.origin.join(' '))}</span>.</p>
    ${out ? `<p>Auftrag wartet. Eine nähere Kanone wählen oder die Kanone näher aufstellen und ihre neue Position unter Ausrichtung bestätigen.</p>
      <div class="range-candidates"><strong>Kanonen in Reichweite</strong>${candidates.map(x => `<div class="range-candidate"><div>${esc(x.name)} · ${esc(distanceText(x.distance))} Blöcke<br><small class="muted">${esc(labels[x.availability])} · ${esc(x.position.join(' '))}</small></div>
        ${canTransfer && x.availability === 'free' ? `<button class="small primary" data-act="transfer" data-target="${esc(x.name)}" data-source-assignment="${c.assignment}" data-target-assignment="${x.assignment}" data-version="${r.version}">Auftrag hierhin verschieben</button>` : ''}</div>`).join('') || '<p class="muted">Keine bestätigte Kanone in Reichweite.</p>'}
      ${candidates.length && !free.length ? '<p class="muted">Aktuell ist keine dieser Kanonen frei und online.</p>' : ''}</div>` : ''}
  </div>`;
}
