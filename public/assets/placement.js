const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Always use the origin of the version being displayed, including pinned cannon jobs.
export function placementValues(bp) {
  const origin = bp?.origin ?? bp?.current?.origin;
  return Array.isArray(origin) && origin.length === 3 && origin.every(Number.isSafeInteger) ? origin : null;
}
export function coordinateFields(bp) {
  const origin = placementValues(bp);
  if (!origin) return '<span class="muted">Keine Einsetzkoordinaten hinterlegt.</span>';
  return `<div class="coordinate-values">${origin.map((v,i) => `<button type="button" class="coordinate-value" data-copy-coordinate="${v}" aria-label="${'XYZ'[i]} ${v} kopieren" title="${'XYZ'[i]} einzeln kopieren"><span>${'XYZ'[i]}</span><strong>${v}</strong></button>`).join('')}</div>`;
}
export function placementCard(bp, label = 'Schematic platzieren') {
  const origin = placementValues(bp), version = bp.version ?? bp.currentVersion;
  return `<div class="placement-card"><div class="row"><strong>${escapeHtml(label)}</strong><span class="badge ok">v${escapeHtml(version)}</span></div>
    ${coordinateFields(bp)}
    <p>Drehung <b>0°</b> · Spiegelung <b>keine</b></p>
    <p class="muted">X, Y und Z im Positionsmenü der Schematic eintragen. Das ist der Bauplan-Anker, nicht deine Standhöhe oder die Position der Kanone.</p>
    ${origin ? `<button type="button" class="small" data-copy-coordinate="${origin.join(' ')}">X Y Z kopieren</button>` : ''}</div>`;
}
export function coordinateListText(blueprints) {
  return ['ATM10 Campus – Einsetzkoordinaten der aktuellen Baupläne',
    'Reihenfolge: X Y Z | Drehung 0 Grad | Spiegelung keine',
    'Y ist der Bauplan-Anker, nicht die Laufhöhe. Bei Kanonen gilt die zugewiesene Version.', '',
    ...blueprints.map(b => `${b.name} | v${b.version ?? b.currentVersion}\n${b.fileName ?? b.id + '.nbt'}\n${placementValues(b)?.map((v,i) => `${'XYZ'[i]} ${v}`).join('   ') ?? 'Keine Koordinaten'}\n`)].join('\n');
}
