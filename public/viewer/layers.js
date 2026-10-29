// Combinable layers: each layer maps to face categories from the mesher and gets a draw mode.
import { MODE } from './renderer.js';

const { OFF, TEXTURE: TEX, COLOR, GHOST, DIM } = MODE;

// Category ids (see mesher.worker.js): context 0 / 2 / 20+status, blueprint 10+status.
export const CAT = { CONTEXT: 0, DEMOLISH: 2, BP: 10, COVERED: 20 };
export const STATUS = ['done', 'place', 'replace', 'blocked', 'changed', 'unknown'];

export const MODES = [
  { id: OFF, label: 'Aus', short: '–' },
  { id: TEX, label: 'Echt', short: 'Echt' },
  { id: COLOR, label: 'Farbe', short: 'Farbe' },
  { id: GHOST, label: 'Geist', short: 'Geist' },
  { id: DIM, label: 'Gedimmt', short: 'Dim' },
];

export const LAYERS = [
  { id: 'context', group: 'Bestand', label: 'Bestand', hint: 'Welt aus dem Snapshot, vom Plan unberührt', color: '#93a9bd', cats: [CAT.CONTEXT] },
  { id: 'demolish', group: 'Bestand', label: 'Abriss', hint: 'Vorhandene Blöcke, die der Plan entfernt (Luft im Bauplan)', color: '#ff5a4f', cats: [CAT.DEMOLISH] },
  { id: 'done', group: 'Plan', label: 'Gebaut', hint: 'Plan-Blöcke, die schon so in der Welt stehen', color: '#4fd08a', status: 0 },
  { id: 'place', group: 'Plan', label: 'Noch setzen', hint: 'Plan-Blöcke, wo jetzt Luft ist', color: '#4fc3ff', status: 1 },
  { id: 'replace', group: 'Plan', label: 'Ersetzen', hint: 'An der Stelle steht ein anderer Block', color: '#ffb347', status: 2 },
  { id: 'blocked', group: 'Plan', label: 'Maschine im Weg', hint: 'Block-Entity (Maschine, Kiste …) müsste weichen', color: '#ff3d71', status: 3 },
  { id: 'changed', group: 'Plan', label: 'Seit Planung geändert', hint: 'Die Welt hat sich hier seit dem Planungs-Snapshot verändert', color: '#b48cff', status: 4 },
  { id: 'unknown', group: 'Plan', label: 'Außerhalb Snapshot', hint: 'Kein Bestand bekannt (außerhalb des erfassten Bereichs)', color: '#8d97a3', status: 5 },
];
for (const l of LAYERS) if (l.status !== undefined) l.cats = [CAT.BP + l.status];

const all = (bp, extra = {}) => ({ done: bp, place: bp, replace: bp, blocked: bp, changed: bp, unknown: bp, ...extra });
export const PRESETS = [
  { id: 'target', label: 'Zielbild', hint: 'So sieht der Campus nach dem Bau aus', modes: { context: TEX, demolish: OFF, ...all(TEX) }, overlap: false },
  { id: 'live', label: 'Live-Welt', hint: 'Nur der aktuelle Bestand', modes: { context: TEX, demolish: TEX, ...all(OFF) }, overlap: false },
  { id: 'progress', label: 'Baufortschritt', hint: 'Gebautes echt, Offenes eingefärbt', modes: { context: DIM, demolish: COLOR, ...all(COLOR, { done: TEX, place: GHOST, unknown: GHOST }) }, overlap: true },
  { id: 'todo', label: 'Noch zu bauen', hint: 'Nur was noch fehlt, abgerissen oder ersetzt werden muss', modes: { context: DIM, demolish: COLOR, ...all(COLOR, { done: OFF, unknown: OFF }) }, overlap: true },
  { id: 'conflicts', label: 'Konflikte', hint: 'Maschinen im Weg, Änderungen seit Planung, Überlappungen', modes: { context: DIM, demolish: GHOST, ...all(OFF, { replace: GHOST, blocked: COLOR, changed: COLOR }) }, overlap: true },
  { id: 'xray', label: 'Plan über Live', hint: 'Echte Welt, Plan als leuchtender Geist darüber', modes: { context: TEX, demolish: COLOR, ...all(GHOST) }, overlap: true },
];

// Layer modes → per-category uniform values. Covered context cells (20+s) stay hidden while the
// matching plan layer is drawn solid, so identical positions never z-fight.
export function categoryModes(modes) {
  const out = new Float32Array(32);
  for (const l of LAYERS) for (const c of l.cats) out[c] = modes[l.id] ?? OFF;
  for (const l of LAYERS) {
    if (l.status === undefined) continue;
    const m = modes[l.id] ?? OFF;
    out[CAT.COVERED + l.status] = m === OFF || m === GHOST ? (modes.context ?? OFF) : OFF;
  }
  return out;
}

export function categoryColors() {
  const cols = Array(32).fill('#9aa7b4');
  for (const l of LAYERS) for (const c of l.cats) cols[c] = l.color;
  for (const l of LAYERS) if (l.status !== undefined) cols[CAT.COVERED + l.status] = l.color;
  return cols;
}

export const statusLabel = s => LAYERS.find(l => l.status === (s & 15))?.label ?? 'Unbekannt';
export const statusColor = s => LAYERS.find(l => l.status === (s & 15))?.color ?? '#8d97a3';
