import { esc } from './format.js?v=20261101-select-1';
import { buildBlocker, buildFailure, choiceKey, pickerChoices, renderPickerHeading, renderPickerList, renderPickerMeta } from './cannon-picker.js?v=20261101-select-1';

const FRAME = `<div class="picker-panel">
  <header class="picker-head"><div><p class="eyebrow" data-picker-cannon></p><h2 id="pickerTitle" data-picker-title></h2></div><button class="text-button" type="button" data-picker-close>Schließen</button></header>
  <p class="picker-intro">Auswählen bereitet den Bauplan vor und startet die Kanone sofort.</p>
  <label class="picker-search">Baupläne durchsuchen<input type="search" data-picker-search placeholder="Name eingeben" autocomplete="off" autofocus></label>
  <div data-picker-status role="status"></div>
  <div class="picker-list" data-picker-list></div>
  <p class="footnote" data-picker-meta></p>
</div>`;

// Only the "Bauen" click starts anything. Opening, polling, typing and focus just read.
export function createCannonPickerDialog({dialog, read, build, ago, onSettled}) {
  let name = null, cannon = null, query = '', fresh = false, running = null, retry = null, failure = null, loadError = null, readToken = 0, listHtml = null, statusHtml = null;
  dialog.innerHTML = FRAME;
  const part = key => dialog.querySelector(`[data-picker-${key}]`);
  const list = part('list'), search = part('search'), close = part('close');
  const statusText = blocker => {
    if (running) return `<p class="notice">Bauplan wird vorbereitet und gestartet. Das kann einige Sekunden dauern.</p>`;
    const notes = [];
    if (failure) notes.push(`<p class="notice error" role="alert">${esc(failure)}</p>`);
    if (loadError) notes.push(`<p class="notice error" role="alert">Auswahl konnte nicht geladen werden: ${esc(loadError)} <button class="text-button small" type="button" data-picker-reload>Erneut laden</button></p>`);
    else if (!fresh) notes.push('<p class="muted">Aktueller Baustand wird geladen …</p>');
    if (blocker) notes.push(`<p class="notice">${esc(blocker)}</p>`);
    return notes.join('');
  };
  // Polling repaints the list in place. Search text, focus and scroll position survive.
  function paint() {
    const blocker = buildBlocker(cannon);
    part('cannon').textContent = name;
    part('title').textContent = renderPickerHeading(cannon);
    part('meta').innerHTML = renderPickerMeta(cannon.blueprintChoices, ago);
    close.disabled = !!running;
    const status = statusText(blocker);
    if (status !== statusHtml) { statusHtml = status; part('status').innerHTML = status; }
    const html = renderPickerList(cannon, {query, disabled: !fresh || !!running || !!blocker, pending: running, retry});
    if (html === listHtml) return;
    const active = dialog.ownerDocument.activeElement, focused = list.contains(active) ? active.closest('[data-build]')?.dataset : null, top = list.scrollTop;
    const key = focused && `${focused.build}:${focused.version}`;
    listHtml = html; list.innerHTML = html; list.scrollTop = top;
    if (!focused) return;
    const match = [...list.querySelectorAll('[data-build]')].find(button => `${button.dataset.build}:${button.dataset.version}` === key);
    (match && !match.disabled ? match : search).focus();
  }
  async function load() {
    const token = ++readToken, station = name;
    fresh = false; loadError = null; paint();
    try {
      const latest = await read(station);
      if (token !== readToken) return;
      cannon = latest; fresh = true;
    } catch (error) {
      if (token !== readToken) return;
      loadError = error.message;
    }
    paint();
  }
  async function select(id, version) {
    if (running || !fresh || buildBlocker(cannon)) return;
    const choice = pickerChoices(cannon).find(b => b.id === id && String(b.version) === version);
    if (!choice) return;
    const station = name;
    running = choiceKey(choice); retry = null; failure = null; paint();
    try {
      const result = await build(station, {blueprint: choice.id, version: choice.version, assignment: cannon.assignment});
      running = null;
      dialog.close();
      onSettled(station, result, null);
    } catch (error) {
      retry = running; running = null; failure = buildFailure(error);
      onSettled(station, null, error);
      if (dialog.open && name === station) await load();
    }
  }
  dialog.addEventListener('click', event => {
    if (event.target === dialog) { if (!running) dialog.close(); return; }
    const target = event.target.closest?.('button');
    if (!target || target.disabled) return;
    if (target.matches('[data-build]')) void select(target.dataset.build, target.dataset.version);
    else if (target.matches('[data-picker-close]')) dialog.close();
    else if (target.matches('[data-picker-reload]')) void load();
  });
  dialog.addEventListener('cancel', event => { if (running) event.preventDefault(); });
  // Browsers may force-close on a repeated Escape. The request still finishes and reports.
  dialog.addEventListener('close', () => { readToken++; });
  search.addEventListener('input', () => { query = search.value; paint(); });
  return {
    open(station, current) {
      if (dialog.open || running) return;
      name = station; cannon = current; query = ''; search.value = ''; retry = null; failure = null; listHtml = null; statusHtml = null;
      dialog.showModal();
      void load();
    },
    update(latest) {
      if (!dialog.open || running || latest.name.toLowerCase() !== name.toLowerCase()) return;
      cannon = latest; paint();
    },
  };
}
