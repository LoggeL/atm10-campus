// Campus viewer: loads scene + data, feeds the mesher worker, drives UI, layers, picking and camera.
import * as THREE from 'three';
import { VoxelRenderer } from './renderer.js';
import { Navigation } from './navigation.js';
import { buildAtlas } from './atlas.js';
import { LAYERS, PRESETS, MODES, CAT, categoryModes, categoryColors, statusLabel, statusColor } from './layers.js';
import { blueprintPreview, installPreviewFallbacks } from '/assets/blueprint-preview.js?v=20261101-select-1';
import { connectPolling } from '/assets/live-updates.js?v=20261101-select-1';
installPreviewFallbacks();

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n ?? 0).toLocaleString('de-DE');
const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));

const BP_STATUS = {
  conflict: { label: 'Konflikt', color: '#ff3d71' },
  warning: { label: 'Seit Planung geändert', color: '#ffbf5f' },
  ok: { label: 'In Arbeit', color: '#4fc3ff' },
  built: { label: 'Fertig', color: '#5fd99a' },
  unknown: { label: 'Unbekannt', color: '#8d97a3' },
};

const state = {
  scene: null, bps: new Map(), modes: {}, overlap: false, preset: null,
  visible: new Set(), selected: null, filter: 'all', search: '', collapsed: new Set(),
};
let view, nav, worker, bounds = null, home = null;

// ---------- loading ----------
function loading(step, pct) {
  $('#loading-step').textContent = step;
  if (pct !== undefined) $('#loading-bar').style.width = pct + '%';
}
function fail(err) {
  console.error(err);
  $('#loading').classList.add('error');
  $('#loading').classList.remove('done');
  loading('Fehler: ' + (err.message || err), 100);
}
function toast(html, ms = 4000) {
  const t = $('#toast');
  t.innerHTML = html; t.classList.remove('hidden');
  clearTimeout(toast.timer);
  if (ms) toast.timer = setTimeout(() => t.classList.add('hidden'), ms);
}

async function api(url, options = {}) {
  const r = await fetch(url, { credentials: 'same-origin', ...options });
  if (r.status === 401) { location.href = '/login'; throw new Error('Nicht angemeldet'); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `${r.status} ${r.statusText}`);
  return r;
}

async function fetchSurfaces(url) {
  const res = await api(url);
  const raw = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  return new Uint16Array(raw);
}

function parseBlueprintBin(buf) {
  const hlen = new DataView(buf).getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  const base = 4 + hlen + ((4 - ((4 + hlen) % 4)) % 4);
  // slice(): each array gets its own buffer, so the worker transfer moves only what it needs.
  return {
    palette: header.palette,
    blueprints: header.blueprints.map(b => ({
      id: b.id, placed: b.placed, clear: b.clear,
      pos: new Uint16Array(buf, base + b.pos, (b.placed + b.clear) * 3).slice(),
      pal: new Uint16Array(buf, base + b.pal, b.placed).slice(),
      status: new Uint8Array(buf, base + b.status, b.placed + b.clear).slice(),
    })),
  };
}

// Per-layer cell counts of one blueprint, from its per-cell statuses.
function cellCounts(b) {
  const c = { status: new Array(6).fill(0), demolish: 0, overlap: 0 };
  for (let i = 0; i < b.status.length; i++) {
    const s = b.status[i];
    if (s & 0x10) c.overlap++;
    if (i < b.placed) c.status[s & 15]++;
    else if ((s & 15) !== 0) c.demolish++;
  }
  return c;
}

// ---------- startup ----------
async function main() {
  const snapQ = params.get('snapshot');
  const qs = snapQ ? `?snapshot=${encodeURIComponent(snapQ)}` : '';
  loading('Lade Szene …', 4);
  const scene = await (await api('/api/viewer/scene' + qs)).json();
  state.scene = scene;
  view = new VoxelRenderer($('#scene'));
  nav = new Navigation(view.camera, $('#scene'));
  view.resize();
  new ResizeObserver(() => view.resize()).observe($('#scene'));

  loading('Lade Bestand und Baupläne …', 12);
  const [records, binBuf, atlas] = await Promise.all([
    scene.context ? fetchSurfaces(scene.context.url) : null,
    api(scene.blueprintsUrl).then(r => r.arrayBuffer()),
    buildAtlas(scene.materials, view.renderer),
  ]);
  view.setAtlas(atlas.texture, scene.materials);
  const bin = parseBlueprintBin(binBuf);

  // Style table shared by context and blueprint palettes.
  const styleNames = Object.keys(scene.styles);
  const styleIndex = new Map(styleNames.map((n, i) => [n, i]));
  const matIdx = new Map(scene.materials.map((m, i) => [m, i]));
  const L = m => matIdx.get(m) ?? 0;
  const styles = styleNames.map(n => {
    const s = scene.styles[n];
    const layers = s.material === 'grass' ? [L('dirt'), L('grass'), L('dirt')] : [L(s.material), L(s.material), L(s.material)];
    const kind = s.material === 'glass' || s.material === 'water' ? 2 : s.material === 'leaves' || s.material === 'plant' ? 1 : 0;
    return { color: s.color, top: s.top, layers, kind, emissive: s.emissive };
  });
  const styleOf = name => {
    if (!styleIndex.has(name)) { styleIndex.set(name, styles.length); styleNames.push(name); styles.push({ color: [150, 150, 150], top: null, layers: [0, 0, 0], kind: 0 }); }
    return styleIndex.get(name);
  };
  const ctxStyleOf = scene.context ? Uint16Array.from(scene.context.palette, styleOf) : null;
  const bpStyleOf = Uint16Array.from(bin.palette, styleOf);

  const meta = new Map(scene.blueprints.map(b => [b.id, b]));
  const workerBps = [];
  for (const b of bin.blueprints) {
    const m = meta.get(b.id);
    if (!m) continue;
    state.bps.set(b.id, { ...m, cells: cellCounts(b) });
    workerBps.push({ ...b, origin: m.origin, size: m.size });
  }
  const want = hash.get('bps');
  state.visible = new Set(want ? want.split(',').filter(id => state.bps.has(id)) : state.bps.keys());

  loading('Erzeuge Geometrie …', 35);
  worker = new Worker('/viewer/mesher.worker.js');
  worker.onmessage = onWorker;
  worker.onerror = e => fail(new Error(e.message || 'Worker-Fehler'));
  const transfer = [];
  if (records) transfer.push(records.buffer);
  for (const b of workerBps) transfer.push(b.pos.buffer, b.pal.buffer, b.status.buffer);
  worker.postMessage({
    type: 'init', styles, styleNames,
    context: scene.context && { origin: scene.context.origin, size: scene.context.size, records, styleOf: ctxStyleOf },
    blueprints: workerBps, bpPalette: bin.palette, bpStyleOf, visible: [...state.visible],
  }, transfer);

  buildUi();
  const colors = categoryColors();
  colors.forEach((c, i) => view.uniforms.uCatColor.value[i].set(c));
  const preset = PRESETS.find(p => p.id === hash.get('v'));
  if (hash.get('m')) {
    for (const part of hash.get('m').split(',')) { const [k, v] = part.split(':'); if (LAYERS.some(l => l.id === k)) state.modes[k] = Number(v); }
    state.overlap = hash.get('o') === '1';
    applyModes();
  } else applyPreset(preset || PRESETS[0]);
  if (atlas.generated.length) console.info('Prozedurale Texturen für:', atlas.generated.join(', '));

  let last = performance.now();
  const frame = now => {
    const dt = (now - last) / 1000; last = now;
    nav.update(dt);
    view.sky.position.copy(view.camera.position);
    view.render(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setInterval(updateHud, 500);
  const polling=connectPolling({refresh:checkLive,onState:status=>{
    const label=$('#refresh-label'),button=$('#refresh-now');
    label.textContent=status.phase==='refreshing'?'Prüfe Änderungen …':status.phase==='error'?'Prüfung fehlgeschlagen':status.phase==='paused'?'Pausiert':`Prüfung in ${status.remainingSeconds} s`;
    label.title=status.error||'Prüft neue Weltstände und Bauplanversionen. Die Ansicht bleibt erhalten.';
    $('#refresh-progress').value=status.progress;button.disabled=status.phase==='refreshing';
  }});
  $('#refresh-now').addEventListener('click',()=>polling.refreshNow());
}

let firstDone = false;
const pickCallbacks = new Map();
function onWorker(e) {
  const m = e.data;
  if (m.type === 'bounds') {
    bounds = { lo: m.lo, size: m.size };
    view.setBounds(m.lo, m.size);
    setupClip();
    setupCamera();
  } else if (m.type === 'chunk') {
    view.setChunk(m.key, 'ctx', m.ctx);
    view.setChunk(m.key, 'bp', m.bp);
  } else if (m.type === 'progress') {
    if (!firstDone) loading(`Erzeuge Geometrie … ${m.done}/${m.total} Chunks`, 35 + 63 * (m.done / Math.max(1, m.total)));
  } else if (m.type === 'done') {
    if (!firstDone) { firstDone = true; loading('Fertig', 100); setTimeout(() => $('#loading').classList.add('done'), 250); }
  } else if (m.type === 'solid') {
    nav.setSolid({ bits: m.bits, lo: m.lo, size: m.size });
  } else if (m.type === 'pick') {
    const cb = pickCallbacks.get(m.id); pickCallbacks.delete(m.id);
    cb?.(m.hit);
  } else if (m.type === 'error') fail(new Error(m.message));
}

// ---------- camera ----------
function setupCamera() {
  const { lo, size } = bounds;
  const c = [lo[0] + size[0] / 2, 66, lo[2] + size[2] / 2];
  const span = Math.max(size[0], size[2]);
  const k = Math.min(2.2, Math.max(1, 1.25 / view.camera.aspect)); // portrait screens need more distance
  home = { pos: [c[0] - span * 0.42 * k, 66 + span * 0.5 * k, c[2] + span * 0.62 * k], target: c };
  const cam = (hash.get('cam') || '').split(',').map(Number);
  if (cam.length === 6 && cam.every(Number.isFinite)) nav.lookAt(cam.slice(0, 3), cam.slice(3));
  else nav.lookAt(home.pos, home.target);
  const sel = hash.get('bp');
  if (sel && state.bps.has(sel)) select(sel, { focus: cam.length !== 6 });
}

function focusBlueprint(b) {
  const c = [b.origin[0] + b.size[0] / 2, b.origin[1] + b.size[1] * 0.35, b.origin[2] + b.size[2] / 2];
  const d = Math.max(b.size[0], b.size[1], b.size[2]) * 1.25 + 14;
  const dir = view.camera.position.clone().sub(new THREE.Vector3(...c)).setY(0).normalize();
  if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(-0.6, 0, 0.8);
  if (nav.mode === 'walk') { nav.setMode('orbit'); syncNavButtons(); }
  nav.flyTo([c[0] + dir.x * d * 0.75, c[1] + d * 0.85, c[2] + dir.z * d * 0.75], c); // steep, so neighbours rarely block the view
}

// Persist camera, view and selection in the URL hash (debounced).
let hashTimer = null;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const h = new URLSearchParams();
    const p = view.camera.position, t = nav.target();
    h.set('cam', [p.x, p.y, p.z, t.x, t.y, t.z].map(v => v.toFixed(1)).join(','));
    if (state.preset) h.set('v', state.preset);
    else { h.set('m', LAYERS.map(l => `${l.id}:${state.modes[l.id] ?? 0}`).join(',')); h.set('o', state.overlap ? '1' : '0'); }
    if (state.selected) h.set('bp', state.selected);
    if (state.visible.size !== state.bps.size) h.set('bps', [...state.visible].join(','));
    history.replaceState(null, '', location.pathname + location.search + '#' + h.toString().replace(/%2C/g, ',').replace(/%3A/g, ':'));
  }, 400);
}

// ---------- layers ----------
function applyPreset(p) {
  state.modes = { ...p.modes };
  state.overlap = p.overlap;
  applyModes();
}

function applyModes() {
  view.uniforms.uMode.value.set(categoryModes(state.modes));
  view.uniforms.uOverlap.value = state.overlap ? 1 : 0;
  view.markShadows();
  const match = PRESETS.find(p => p.overlap === state.overlap && LAYERS.every(l => (p.modes[l.id] ?? 0) === (state.modes[l.id] ?? 0)));
  state.preset = match?.id ?? null;
  renderPresets();
  renderLayers();
  $('#overlap').checked = state.overlap;
  saveHash();
}

function renderPresets() {
  $('#presets').innerHTML = PRESETS.map(p => `<button class="preset ${state.preset === p.id ? 'active' : ''}" data-preset="${p.id}" title="${esc(p.hint)}"><b>${esc(p.label)}</b><span>${esc(p.hint)}</span></button>`).join('');
}

function layerCounts() {
  const c = { context: state.scene.context?.recordCount ?? 0, demolish: 0, overlap: 0, status: new Array(6).fill(0) };
  for (const id of state.visible) {
    const b = state.bps.get(id);
    if (!b) continue;
    c.demolish += b.cells.demolish; c.overlap += b.cells.overlap;
    b.cells.status.forEach((n, i) => { c.status[i] += n; });
  }
  return c;
}

function renderLayers() {
  const counts = layerCounts();
  let group = null, html = '';
  for (const l of LAYERS) {
    if (l.group !== group) { group = l.group; html += `<div class="layer-group">${esc(group === 'Plan' ? 'Plan (Baupläne)' : 'Bestand (Welt)')}</div>`; }
    const mode = state.modes[l.id] ?? 0;
    const n = l.id === 'context' ? counts.context : l.id === 'demolish' ? counts.demolish : counts.status[l.status];
    const unit = l.id === 'context' ? 'sichtbare Blöcke' : 'Blöcke';
    html += `<div class="layer ${mode ? '' : 'off'}" style="--c:${l.color}" title="${esc(l.hint)}">
      <span class="sw"></span>
      <span class="name"><b>${esc(l.label)}</b><small>${fmt(n)} ${unit}</small></span>
      <span class="modes">${MODES.map(m => `<button data-layer="${l.id}" data-mode="${m.id}" class="${m.id === mode ? 'on' : ''}" title="${m.label}">${m.short}</button>`).join('')}</span>
    </div>`;
  }
  $('#layers').innerHTML = html;
  $('#overlap-count').textContent = counts.overlap ? `(${fmt(counts.overlap)})` : '';
}

// ---------- blueprints ----------
function renderEdition() {
  const t = { conflict: 0, warning: 0, ok: 0, built: 0, unknown: 0 };
  let done = 0, total = 0;
  for (const b of state.bps.values()) {
    t[b.status] = (t[b.status] || 0) + 1;
    if (b.counts) { done += b.counts.built + b.counts.cleared; total += b.counts.placed + b.counts.clear - b.counts.outsideSnapshot; }
  }
  const pct = total ? (done / total * 100).toFixed(1).replace('.', ',') : '–';
  const pill = (c, label, n) => `<span class="pill" style="color:${c}"><i></i><span style="color:var(--muted)">${label}</span> <b>${n}</b></span>`;
  $('#edition').innerHTML = `<span class="pill"><span>Baupläne</span> <b>${state.bps.size}</b></span><span class="pill"><span>Gesamt gebaut</span> <b>${pct} %</b></span>`
    + (t.conflict ? pill(BP_STATUS.conflict.color, 'Konflikte', t.conflict) : '')
    + (t.warning ? pill(BP_STATUS.warning.color, 'Geändert', t.warning) : '')
    + pill(BP_STATUS.built.color, 'Fertig', t.built);
  $('#bp-count').textContent = state.bps.size;
}

function renderBlueprints() {
  const q = state.search.toLowerCase();
  const list = [...state.bps.values()].filter(b => (state.filter === 'all' || b.status === state.filter) && (!q || (b.name + ' ' + b.id + ' ' + b.category).toLowerCase().includes(q)));
  const groups = new Map();
  for (const b of list.sort((a, b) => a.id.localeCompare(b.id))) {
    if (!groups.has(b.category)) groups.set(b.category, []);
    groups.get(b.category).push(b);
  }
  const counts = { all: state.bps.size };
  for (const b of state.bps.values()) counts[b.status] = (counts[b.status] || 0) + 1;
  $('#bp-filter').innerHTML = [['all', 'Alle'], ...Object.entries(BP_STATUS).map(([k, v]) => [k, v.label])].filter(([k]) => counts[k])
    .map(([k, label]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${esc(label)} ${counts[k]}</button>`).join('');
  $('#bp-list').innerHTML = [...groups].map(([cat, items]) => {
    const allOn = items.every(b => state.visible.has(b.id));
    return `<div class="bp-group ${state.collapsed.has(cat) ? 'collapsed' : ''}" data-cat="${esc(cat)}">
      <header><input type="checkbox" data-group="${esc(cat)}" ${allOn ? 'checked' : ''} aria-label="Gruppe sichtbar"><span class="caret">▾</span>${esc(cat.replace(/_/g, ' '))}<span class="n">${items.length}</span></header>
      <div class="bp-items">${items.map(b => {
        const st = BP_STATUS[b.status] || BP_STATUS.unknown, p = b.progress ?? 0;
        return `<div class="bp ${state.selected === b.id ? 'selected' : ''}" data-bp="${esc(b.id)}">
          <input type="checkbox" data-vis="${esc(b.id)}" ${state.visible.has(b.id) ? 'checked' : ''} aria-label="sichtbar">
          ${blueprintPreview(b,{size:'small'})}
          <span class="t"><b>${esc(b.name)}</b><small>v${b.version} · ${esc(st.label)}</small></span>
          <span class="ring" style="--p:${p};--c:${st.color}" title="${String(p).replace('.', ',')} % gebaut"><span>${Math.round(p)} %</span></span>
        </div>`;
      }).join('')}</div></div>`;
  }).join('') || '<p style="color:var(--muted)">Keine Baupläne gefunden.</p>';
}

function setVisible(ids, on) {
  for (const id of ids) on ? state.visible.add(id) : state.visible.delete(id);
  worker.postMessage({ type: 'visibility', visible: [...state.visible] });
  renderBlueprints(); renderLayers(); updateRestZipLink(); saveHash();
}

function select(id, { focus = false } = {}) {
  state.selected = id;
  const b = id && state.bps.get(id);
  const u = view.uniforms;
  if (b) {
    u.uSelMin.value.set(...b.origin);
    u.uSelMax.value.set(b.origin[0] + b.size[0], b.origin[1] + b.size[1], b.origin[2] + b.size[2]);
    if (focus) focusBlueprint(b);
  } else { u.uSelMin.value.set(1e9, 1e9, 1e9); u.uSelMax.value.set(-1e9, -1e9, -1e9); }
  renderDetail();
  renderBlueprints();
  saveHash();
}

function renderDetail() {
  const el = $('#detail');
  const b = state.selected && state.bps.get(state.selected);
  if (!b) { el.classList.add('hidden'); return; }
  const st = BP_STATUS[b.status] || BP_STATUS.unknown, c = b.counts || {}, k = b.conflicts || {};
  const stat = (label, n, color) => `<div class="stat" style="--c:${color}"><b>${fmt(n)}</b><small><i></i>${label}</small></div>`;
  const hi = b.origin.map((v, i) => v + b.size[i] - 1);
  const date = b.updatedAt ? new Date(b.updatedAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  el.innerHTML = `<button class="close" data-close aria-label="Schließen">✕</button>
    <span class="status-tag" style="--c:${st.color}">● ${esc(st.label)}</span>
    <h2>${esc(b.name)}</h2>
    <div class="sub">${esc(b.fileName)} · v${b.version} · ${esc(b.uploadedBy || '')} · ${esc(date)}</div>
    <figure class="blueprint-figure">${blueprintPreview(b,{size:'large',eager:true})}<figcaption>Bauplan v${b.version} · ohne Weltbestand</figcaption></figure>
    ${b.description ? `<p class="desc">${esc(b.description)}</p>` : ''}
    <div class="progress"><div style="width:${b.progress ?? 0}%"></div></div>
    <small style="color:var(--muted)">${String(b.progress ?? 0).replace('.', ',')} % gebaut · ${b.origin.join(', ')} → ${hi.join(', ')}</small>
    <div class="stats">
      ${stat('Gebaut', c.built, '#4fd08a')}${stat('Noch setzen', c.toPlace, '#4fc3ff')}
      ${stat('Ersetzen', c.toReplace, '#ffb347')}${stat('Abriss offen', c.toClear, '#ff5a4f')}
      ${stat('Maschinen im Weg', k.protectedBlockEntities, '#ff3d71')}${stat('Seit Planung geändert', k.changedSinceBase, '#b48cff')}
      ${k.overlapCells ? stat('Überlappung', k.overlapCells, '#ee5cdb') : ''}
    </div>
    <div class="actions">
      <button data-act="focus">Fokus</button>
      <button data-act="solo">Nur diesen zeigen</button>
      <button data-act="materials">Materialliste</button>
      <a href="/api/blueprints/${encodeURIComponent(b.id)}/remaining.nbt${state.scene.snapshot ? '?snapshot=' + state.scene.snapshot.id : ''}" download title="Nur was noch fehlt – gleicher Ankerpunkt wie der volle Bauplan, Schematicannon im normalen Modus">Rest-NBT</a>
      <a href="/api/blueprints/${encodeURIComponent(b.id)}/download" download>.nbt laden</a>
      <a href="/api/blueprints/${encodeURIComponent(b.id)}/layers" target="_blank" rel="noopener">Schichten (Text)</a>
      <a href="/app#bp=${encodeURIComponent(b.id)}">Versionen &amp; Upload</a>
    </div>`;
  el.classList.remove('hidden');
}

// ---------- materials ----------
const mat = { ids: [], data: null };
const joinQs = (...parts) => parts.filter(Boolean).join('&');
const idsQuery = ids => (ids.length === state.bps.size ? '' : 'ids=' + ids.map(encodeURIComponent).join(','));
const snapQuery = () => (state.scene.snapshot ? 'snapshot=' + state.scene.snapshot.id : '');
const restQuery = () => joinQs(snapQuery(), $('#mat-clear').checked ? 'clear=1' : '', $('#mat-skip-blocked').checked ? '' : 'skipBlocked=0');
const visibleIds = () => [...state.bps.keys()].filter(id => state.visible.has(id));

async function openMaterials(ids, title) {
  if (!state.scene.snapshot) return toast('Für die Materialliste oben einen Snapshot wählen (nicht „Ohne Bestand“).');
  if (!ids.length) return toast('Keine Baupläne sichtbar.');
  mat.ids = ids; mat.data = null;
  $('#mat-title').textContent = 'Materialliste · ' + title;
  $('#mat-sub').textContent = '';
  $('#mat-summary').innerHTML = '';
  $('#mat-body').innerHTML = '<div class="empty">Rechne …</div>';
  $('#materials').classList.remove('hidden');
  updateMatLinks();
  try {
    const data = await (await api('/api/materials?' + joinQs(idsQuery(ids), snapQuery(), 'all=1'))).json();
    if (mat.ids !== ids) return;
    mat.data = data;
    renderMaterials();
  } catch (e) {
    if (mat.ids !== ids) return;
    $('#mat-body').innerHTML = `<div class="empty">Fehler: ${esc(e.message)}</div>`;
  }
}
function updateRestZipLink() { $('#bp-rest-zip').href = '/api/remaining.zip?' + joinQs(idsQuery(visibleIds()), snapQuery()); }
function closeMaterials() { $('#materials').classList.add('hidden'); mat.ids = []; }

function updateMatLinks() {
  const ids = mat.ids, one = ids.length === 1;
  $('#mat-csv').href = '/api/materials?' + joinQs(idsQuery(ids), snapQuery(), 'format=csv');
  $('#mat-rest').href = one ? `/api/blueprints/${encodeURIComponent(ids[0])}/remaining.nbt?${restQuery()}` : '/api/remaining.zip?' + joinQs(idsQuery(ids), restQuery());
  $('#mat-rest').textContent = one ? 'Rest-NBT laden' : `Rest-NBTs laden (ZIP, ${ids.length})`;
}

const stacksText = r => (r.stack === 1 ? `${r.needed} × 1er` : r.stacks ? `${r.stacks} × ${r.stack}${r.rest ? ' + ' + r.rest : ''}` : String(r.rest));
function renderMaterials() {
  const d = mat.data, t = d.totals;
  const snapDate = new Date(d.snapshot.worldTime || Date.now()).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  $('#mat-sub').textContent = `${d.blueprints.length === 1 ? '1 Bauplan' : d.blueprints.length + ' Baupläne'} · Bestand: Snapshot #${d.snapshot.id} (${d.snapshot.label}, ${snapDate})`;
  const stat = (n, label, cls = '') => `<div class="stat ${cls}"><b>${fmt(n)}</b><small>${label}</small></div>`;
  $('#mat-summary').innerHTML = stat(t.needed, 'Items fehlen') + stat(t.kinds, 'Sorten') + stat(t.stacks, 'Stacks') + stat(t.shulkers, 'Shulker-Kisten (≈)')
    + (t.me ? stat(t.me.short, `fehlen auch im ME (${fmt(t.me.shortKinds)} Sorten, ${fmt(t.me.craftableKinds)} craftbar)`, t.me.short ? 'warn' : '') : '')
    + (t.blocked ? stat(t.blocked, 'Zellen mit Maschine im Weg', 'warn') : '') + (t.unknown ? stat(t.unknown, 'Zellen ohne Bestand', 'warn') : '');
  if (t.me) $('#mat-sub').textContent += ` · ME-Bestand von ${t.me.source}, ${new Date(t.me.at).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`;
  const q = $('#mat-search').value.trim().toLowerCase(), showBuilt = $('#mat-built').checked;
  const rows = d.items.filter(r => (showBuilt || r.needed > 0) && (!q || r.item.toLowerCase().includes(q) || pretty(r.item).label.toLowerCase().includes(q)));
  const color = item => { const c = state.scene.styles[item]?.color; return c ? `rgb(${c[0]},${c[1]},${c[2]})` : '#5d6b78'; };
  const byTitle = r => (r.by ? Object.entries(r.by).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `${state.bps.get(id)?.name || id}: ${n}`).join('\n') : '');
  const table = rows.length ? `<table class="mat-table"><thead><tr><th>Item</th><th class="num">Fehlt</th><th class="num">Stacks</th>${t.me ? '<th class="num">Im ME</th>' : ''}<th>Gebaut</th></tr></thead><tbody>${rows.map(r => {
    const n = pretty(r.item), pct = r.planned ? Math.round(r.built / r.planned * 100) : 100;
    return `<tr class="${r.needed ? '' : 'done'}" title="${esc(byTitle(r))}"><td><span class="it"><i style="--c:${color(r.item)}"></i><span>${esc(n.label)}<small>${esc(r.item)}</small></span></span></td>
      <td class="num"><b>${fmt(r.needed)}</b></td><td class="num">${esc(stacksText(r))}</td>${t.me ? `<td class="num${r.short ? ' short' : ''}" title="${r.short ? `fehlt im ME: ${fmt(r.short)}${r.craftable ? ' · craftbar' : ''}` : 'ME deckt alles'}">${fmt(r.me)}${r.short && r.craftable ? ' ⚙' : ''}</td>` : ''}
      <td><div class="bar" title="${fmt(r.built)} von ${fmt(r.planned)} gesetzt"><div style="width:${pct}%"></div></div></td></tr>`;
  }).join('')}</tbody></table>` : `<div class="empty">${t.needed ? 'Kein Item passt zur Suche.' : 'Nichts mehr zu bauen. Alles steht wie geplant.'}</div>`;
  const removed = d.removed.length ? `<details><summary>Beim Abreißen/Ersetzen fallen ${fmt(d.removed.reduce((a, r) => a + r.count, 0))} Blöcke an</summary><table class="mat-table"><tbody>${d.removed.slice(0, 60).map(r =>
    `<tr><td><span class="it"><i style="--c:${color(r.block)}"></i><span>${esc(pretty(r.block).label)}<small>${esc(r.block)}</small></span></span></td><td class="num">${fmt(r.count)}</td></tr>`).join('')}</tbody></table></details>` : '';
  $('#mat-body').innerHTML = table + removed;
}

function setupMaterials() {
  const modal = $('#materials');
  modal.onclick = e => { if (e.target === modal || e.target.closest('[data-close]')) closeMaterials(); };
  $('#mat-search').oninput = () => mat.data && renderMaterials();
  $('#mat-built').onchange = () => mat.data && renderMaterials();
  $('#mat-clear').onchange = updateMatLinks;
  $('#mat-skip-blocked').onchange = updateMatLinks;
  // Hand the clipboard a promise synchronously: Safari only allows clipboard writes inside the click itself.
  $('#mat-copy').onclick = async () => {
    const text = api('/api/materials?' + joinQs(idsQuery(mat.ids), snapQuery(), 'format=text')).then(r => r.text());
    try {
      if (window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then(t => new Blob([t], { type: 'text/plain' })) })]);
      else await navigator.clipboard.writeText(await text);
      toast('Materialliste kopiert.');
    } catch (e) { toast('Kopieren fehlgeschlagen: ' + esc(e.message)); }
  };
  $('#bp-materials').onclick = () => { const ids = visibleIds(); openMaterials(ids, ids.length === state.bps.size ? 'ganzer Campus' : `${ids.length} sichtbare Baupläne`); };
  $('#bp-rest-zip').onclick = e => {
    if (!state.scene.snapshot) { e.preventDefault(); return toast('Erst einen Snapshot wählen.'); }
    if (!visibleIds().length) { e.preventDefault(); return toast('Keine Baupläne sichtbar.'); }
    updateRestZipLink();
  };
  updateRestZipLink();
}

// ---------- places, snapshot, edition ----------
function renderPois() {
  const pois = state.scene.pois;
  $('#pois').innerHTML = pois.length ? pois.map((p, i) => `<button class="poi" data-poi="${i}"><b>${esc(p.label)}</b><small>${p.position.map(v => Math.round(v)).join(', ')}</small></button>`).join('')
    : '<p style="color:var(--muted)">Keine Orte im importierten Paket.</p>';
  const tabBtn = document.querySelector('[data-tab="places"]');
  if (!pois.length) tabBtn.style.opacity = 0.5;
}

function renderSnapshot() {
  const sc = state.scene, sel = $('#snapshot');
  const cur = sc.snapshot?.id ?? 'none';
  const fmtDate = s => new Date(s.worldTime || s.capturedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  sel.innerHTML = sc.snapshots.map(s => `<option value="${s.id}" ${s.id === cur ? 'selected' : ''}>#${s.id} · ${esc(s.label || s.source)} · ${fmtDate(s)}${s.id === sc.live ? ' (live)' : ''}</option>`).join('')
    + `<option value="none" ${cur === 'none' ? 'selected' : ''}>Ohne Bestand (nur Pläne)</option>`;
  const badge = $('#live-badge');
  if (sc.snapshot && sc.snapshot.id === sc.live) {
    const mins = Math.round((Date.now() - new Date(sc.snapshot.worldTime || sc.snapshot.capturedAt)) / 60000);
    badge.className = 'badge live';
    badge.textContent = 'Live · ' + (mins < 1 ? 'gerade' : mins < 90 ? `vor ${mins} min` : `vor ${Math.round(mins / 60)} h`);
    badge.title = 'Stand der Welt: ' + fmtDate(sc.snapshot);
  } else if (sc.snapshot) { badge.className = 'badge past'; badge.textContent = 'Historisch'; badge.title = 'Älterer Snapshot – nicht der aktuelle Stand'; }
  else { badge.className = 'badge none'; badge.textContent = 'Ohne Bestand'; }
}

async function checkLive() {
  const s = await (await api('/api/status', {signal:AbortSignal.timeout(20_000)})).json();
  const sc = state.scene;
  if (sc.snapshot && sc.snapshot.id === sc.live && s.live && s.live.id !== sc.live) {
    toast('Neuer Live-Stand der Welt verfügbar. <a href="" id="reload">Neu laden</a>', 0);
  } else if (s.edition?.versionsKey && checkLive.key && s.edition.versionsKey !== checkLive.key) {
    toast('Baupläne wurden geändert. <a href="" id="reload">Neu laden</a>', 0);
  }
  checkLive.key = s.edition?.versionsKey;
}

// ---------- clip, hover, picking ----------
function setupClip() {
  const el = $('#clip'), lo = bounds.lo[1], hi = bounds.lo[1] + bounds.size[1];
  el.min = lo; el.max = hi; el.value = hi;
  const apply = () => {
    const v = Number(el.value);
    view.uniforms.uClipY.value = v >= hi ? 1e6 : v + 0.001;
    $('#clip-val').textContent = v >= hi ? 'aus' : 'Y ' + v;
    view.markShadows();
  };
  el.oninput = apply;
  apply();
}

const shownCats = () => Array.from(view.uniforms.uMode.value, v => v > 0);
let pickSeq = 0;
function pickAt(clientX, clientY, cb) {
  const r = view.canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, view.camera);
  const id = ++pickSeq;
  pickCallbacks.set(id, cb);
  const clip = view.uniforms.uClipY.value;
  worker.postMessage({ type: 'pick', id, origin: ray.ray.origin.toArray(), dir: ray.ray.direction.toArray(), maxDist: 2000, shown: shownCats(), clipY: clip > 1e5 ? null : Math.floor(clip) });
}

const pretty = n => { const [ns, p] = n.includes(':') ? n.split(':') : ['minecraft', n]; return { ns, label: p.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }; };
function tooltipHtml(h) {
  const n = pretty(h.name);
  const b = h.blueprint && state.bps.get(h.blueprint);
  const rows = [];
  if (h.source === 'blueprint') {
    rows.push(`<div class="row"><span class="dot" style="--c:${statusColor(h.status)}"></span>${esc(statusLabel(h.status))} · ${esc(b?.name || h.blueprint)}</div>`);
    if (h.live && h.live !== h.name && h.live !== 'minecraft:air') rows.push(`<div class="row" style="color:var(--muted)">Jetzt dort: ${esc(pretty(h.live).label)}</div>`);
  } else if (h.demolish) {
    rows.push(`<div class="row"><span class="dot" style="--c:#ff5a4f"></span>Wird abgerissen · ${esc(b?.name || h.blueprint)}</div>`);
  } else if (h.planned) {
    rows.push(`<div class="row"><span class="dot" style="--c:${statusColor(h.status)}"></span>Bestand · Plan: ${esc(pretty(h.planned).label)}</div>`);
  } else rows.push(`<div class="row" style="color:var(--muted)"><span class="dot" style="--c:#93a9bd"></span>Bestand (vom Plan unberührt)</div>`);
  if (h.status & 0x10) rows.push(`<div class="row" style="color:#ee5cdb">Überlappung mit anderem Bauplan</div>`);
  return `<b>${esc(n.label)}</b> <span class="ns">${esc(n.ns)}</span>${rows.join('')}<div class="pos">${h.pos.join(' ')}</div>`;
}

function setupPicking() {
  const canvas = view.canvas, tip = $('#tooltip');
  let pending = false, lastEv = null, down = null;
  const hover = () => {
    if (!lastEv || pending) return;
    const ev = lastEv; lastEv = null; pending = true;
    pickAt(ev.clientX, ev.clientY, hit => {
      pending = false;
      if (hit && !nav.drag) {
        tip.innerHTML = tooltipHtml(hit);
        tip.style.left = ev.clientX + 'px'; tip.style.top = ev.clientY + 'px';
        tip.classList.remove('hidden');
      } else tip.classList.add('hidden');
      if (lastEv) setTimeout(hover, 40);
    });
  };
  canvas.addEventListener('pointermove', e => { if (e.buttons) { tip.classList.add('hidden'); return; } lastEv = e; hover(); });
  canvas.addEventListener('pointerleave', () => { lastEv = null; tip.classList.add('hidden'); });
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 || performance.now() - down.t > 600) return;
    pickAt(e.clientX, e.clientY, hit => { if (hit?.blueprint) select(hit.blueprint); else if (state.selected) select(null); });
  });
  canvas.addEventListener('dblclick', e => pickAt(e.clientX, e.clientY, hit => {
    if (!hit) return;
    if (nav.mode === 'orbit') nav.flyTo(view.camera.position.clone().lerp(new THREE.Vector3(...hit.pos), 0.6).toArray(), hit.pos.map(v => v + 0.5), 600);
  }));
}

// ---------- toolbar + wiring ----------
function syncNavButtons() {
  document.querySelectorAll('#nav-mode button').forEach(b => { b.classList.toggle('active', b.dataset.mode === nav.mode); b.setAttribute('aria-pressed', String(b.dataset.mode === nav.mode)); });
}

function updateHud() {
  const s = view.stats();
  const hints = { orbit: 'Ziehen: drehen · Rechts: schieben · Rad: zoomen · Doppelklick: hinfliegen', fly: `WASD · Leertaste/E hoch · Q runter · Shift schnell · Rad: Tempo ×${nav.speed.toFixed(1)}`, walk: 'WASD · Leertaste springen · Shift sprinten · Ziehen: umsehen' };
  const p = view.camera.position;
  $('#hud').textContent = `${hints[nav.mode]}\n${p.x.toFixed(0)} ${p.y.toFixed(0)} ${p.z.toFixed(0)} · ${(s.triangles / 1e6).toFixed(2)} M Dreiecke`;
}

function buildUi() {
  renderEdition(); renderBlueprints(); renderPois(); renderSnapshot();

  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
  });
  $('#presets').onclick = e => { const b = e.target.closest('[data-preset]'); if (b) applyPreset(PRESETS.find(p => p.id === b.dataset.preset)); };
  $('#layers').onclick = e => {
    const b = e.target.closest('[data-layer]');
    if (!b) return;
    state.modes[b.dataset.layer] = Number(b.dataset.mode);
    applyModes();
  };
  $('#overlap').onchange = e => { state.overlap = e.target.checked; applyModes(); };

  $('#bp-search').oninput = e => { state.search = e.target.value; renderBlueprints(); };
  $('#bp-all').onclick = () => setVisible([...state.bps.keys()], true);
  $('#bp-none').onclick = () => setVisible([...state.bps.keys()], false);
  $('#bp-filter').onclick = e => { const b = e.target.closest('[data-filter]'); if (b) { state.filter = b.dataset.filter; renderBlueprints(); } };
  $('#bp-list').onclick = e => {
    const vis = e.target.closest('[data-vis]');
    if (vis) return setVisible([vis.dataset.vis], vis.checked);
    const grp = e.target.closest('[data-group]');
    if (grp) return setVisible([...state.bps.values()].filter(b => b.category === grp.dataset.group).map(b => b.id), grp.checked);
    const head = e.target.closest('.bp-group > header');
    if (head) { const cat = head.parentElement.dataset.cat; state.collapsed.has(cat) ? state.collapsed.delete(cat) : state.collapsed.add(cat); renderBlueprints(); return; }
    const item = e.target.closest('[data-bp]');
    if (item) select(item.dataset.bp, { focus: true });
  };
  $('#detail').onclick = e => {
    if (e.target.closest('[data-close]')) return select(null);
    const act = e.target.closest('[data-act]')?.dataset.act;
    const b = state.bps.get(state.selected);
    if (!b) return;
    if (act === 'focus') focusBlueprint(b);
    if (act === 'solo') { state.visible = new Set([b.id]); setVisible([], true); focusBlueprint(b); }
    if (act === 'materials') openMaterials([b.id], b.name);
  };
  $('#pois').onclick = e => {
    const b = e.target.closest('[data-poi]');
    if (!b) return;
    const p = state.scene.pois[Number(b.dataset.poi)], d = p.direction;
    if (nav.mode === 'orbit') nav.flyTo([p.position[0] - d[0] * 6, p.position[1] + 4, p.position[2] - d[2] * 6], [p.position[0] + d[0] * 10, p.position[1], p.position[2] + d[2] * 10]);
    else nav.flyTo(p.position, [p.position[0] + d[0] * 10, p.position[1] + (d[1] || 0) * 10, p.position[2] + d[2] * 10]);
  };
  $('#snapshot').onchange = e => { location.search = '?snapshot=' + e.target.value; };
  $('#toast').onclick = e => { if (e.target.id === 'reload') { e.preventDefault(); location.reload(); } };

  $('#nav-mode').onclick = e => { const b = e.target.closest('[data-mode]'); if (b) { nav.setMode(b.dataset.mode); syncNavButtons(); } };
  nav.on(type => { if (type === 'moved') saveHash(); });
  const tod = $('#tod');
  tod.oninput = () => {
    const h = Number(tod.value);
    view.setTimeOfDay(h);
    $('#tod-val').textContent = `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  };
  const toggle = (id, fn) => { const b = $(id); b.onclick = () => { b.classList.toggle('active'); b.setAttribute('aria-pressed', String(b.classList.contains('active'))); fn(b.classList.contains('active')); }; };
  toggle('#t-shadows', on => view.setShadows(on));
  toggle('#t-bloom', on => { view.bloomEnabled = on; });
  toggle('#t-grid', on => { view.grid.visible = on; });
  $('#reset-cam').onclick = () => { if (nav.mode !== 'orbit') { nav.setMode('orbit'); syncNavButtons(); } nav.flyTo(home.pos, home.target); };
  $('#shot').onclick = () => {
    view.render(0);
    view.canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `campus-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  };
  $('#panel-toggle').onclick = () => { const open = $('#panel').classList.toggle('open'); $('#panel-toggle').setAttribute('aria-expanded', String(open)); };
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#materials').classList.contains('hidden')) { closeMaterials(); return; }
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.key === 'Escape') select(null);
    if (e.key === '1') { nav.setMode('orbit'); syncNavButtons(); }
    if (e.key === '2') { nav.setMode('fly'); syncNavButtons(); }
    if (e.key === '3') { nav.setMode('walk'); syncNavButtons(); }
  });
  setupMaterials();
  setupPicking();
  checkLive();
}

main().catch(fail);
