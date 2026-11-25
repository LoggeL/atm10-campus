import { esc } from './format.js?v=20261125-overhaul-1';

export function landscapeView({ draft: d, profile }) {
  if (!d) return '<p class="muted">Für diese Bergversion ist noch kein Landschaftsentwurf gespeichert.</p>';
  const [start] = profile[0];
  const [end] = profile.at(-1);
  const yBase = Math.min(...profile.flatMap((r) => r.slice(1))) - 3;
  const xy = (x, y) => [32 + (500 * (x - start)) / (end - start), 115 - (95 * (y - yBase)) / (320 - yBase)];
  const line = (i) => profile.map((r) => xy(r[0], r[i]).join(',')).join(' ');
  const [cx, cy] = xy(d.summit[0], d.summit[1]);
  const chart =
    '<figure class="landscape-figure"><svg viewBox="0 0 570 140" role="img" aria-label="West-Ost-Schnitt der geplanten Bergspitze. Das bisherige Steinprofil ist gestrichelt, das geplante Schneeprofil durchgezogen.">' +
    '<polyline points="' +
    line(1) +
    '" fill="none" stroke="#f2be6b" stroke-width="2" stroke-dasharray="5 4"/>' +
    '<polyline points="' +
    line(2) +
    '" fill="none" stroke="#7cc9e8" stroke-width="3"/><circle cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="3.5" fill="#edf3ee"/>' +
    '<g fill="#c2d0c7" font-size="12"><text x="' +
    (cx + 8) +
    '" y="' +
    cy +
    '">Y ' +
    d.summit[1] +
    '</text><text x="32" y="134">West · X ' +
    start +
    '</text><text x="530" y="134" text-anchor="end">Ost · X ' +
    end +
    '</text></g></svg>' +
    '<figcaption>Gipfelschnitt bei Z ' +
    d.summit[2] +
    '. Gestrichelt (Gold) ist das geplante Cleanstone-Profil, durchgezogen (Blau) die neue Oberfläche. Die Höhe ist überzeichnet.</figcaption></figure>';
  const rows = d.bands.map((b) => '<tr>' + b.map((s) => '<td>' + esc(s) + '</td>').join('') + '</tr>').join('');
  return (
    '<p>' +
    esc(d.summary) +
    '</p>' +
    chart +
    '<div class="project-table"><table><thead><tr><th>Höhe</th><th>Landschaft</th><th>Gestaltung</th></tr></thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    '<h3>Orientierung im Spiel</h3><ul>' +
    d.sites.map(([x, y, z, n]) => '<li><strong>' + esc(n) + '</strong> · <span class="c-mono">X ' + x + ' / Y ' + y + ' / Z ' + z + '</span></li>').join('') +
    '</ul>' +
    '<h3>Baufolge nach dem Steinmassiv</h3><ol>' +
    d.steps.map((t) => '<li>' + esc(t) + '</li>').join('') +
    '</ol>'
  );
}
