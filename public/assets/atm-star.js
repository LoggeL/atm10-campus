import { api } from './campus-client.js?v=20261114-status-1';

const byId = id => document.getElementById(id);
const status = byId('stock-status');
const error = byId('stock-error');
const metrics = byId('metrics');
const parts = byId('parts');
const refresh = byId('refresh');
const search = byId('search');
const openOnly = byId('open-only');
const empty = byId('empty');
const number = new Intl.NumberFormat('de-DE');
const berlin = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const format = quantity => quantity === null ? 'unbekannt' : number.format(quantity);

function element(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function valueCell(label, text, className) {
  const cell = element('span', undefined, 'star-value');
  const value = element('strong', text ?? '–', className);
  if (text === null) value.setAttribute('aria-label', 'Unbekannt');
  cell.append(element('span', label, 'star-value-label'), value);
  return cell;
}

function fillRow(container, row, ingredient, hasStock, goal) {
  const name = element('span', undefined, 'star-name');
  const check = element('span', undefined, 'star-check');
  check.setAttribute('aria-hidden', 'true');
  check.dataset.complete = hasStock && row.missing === 0;
  const copy = element('span');
  const title = element('span', row.alternatives.map(option => option.label).join(' oder '), 'star-title');
  title.title = row.alternatives.map(option => option.id).join(' | ');
  const facts = [`${format(row.perRecipe)} je ${ingredient ? 'Bauteil' : 'Star'}`, `${format(row.totalForGoal)} für ${format(goal)} Stars`];
  const inMe = row.alternatives.reduce((sum, option) => sum + (option.inMe ?? 0), 0);
  const allocated = row.alternatives.reduce((sum, option) => sum + option.allocated, 0);
  if (hasStock && row.alternatives.length > 1) {
    facts.push(row.alternatives.map(option => `${format(option.inMe)} × ${option.label} im ME`).join(' / '));
  }
  if (hasStock && ingredient && row.missing > 0 && allocated < inMe) facts.push(`${format(allocated)} hier eingeplant`);
  copy.append(title, element('span', facts.join(' · '), 'star-note'));
  name.append(check, copy);
  const missing = !hasStock ? null : row.missing === 0 ? 'Gedeckt' : format(row.missing);
  container.append(name, valueCell('Bedarf', format(row.needed)), valueCell('Im ME', hasStock ? format(inMe) : null),
    valueCell('Fehlt', missing, row.missing === 0 ? 'star-ready' : 'star-needed'));
  if (!ingredient) {
    const chevron = element('span', undefined, 'star-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    container.append(chevron);
  }
}

const searchText = row => row.alternatives.map(({ id, label }) => `${label} ${id}`).join(' ').toLocaleLowerCase('de');
const expanded = () => new Set(displayed.filter(({ part }) => part.open).map(({ part }) => part.dataset.id));
let displayed = [];
let expandedBeforeSearch = null;
let lastGroups;

function filterList() {
  const term = search.value.trim().toLocaleLowerCase('de');
  if (term && !expandedBeforeSearch) expandedBeforeSearch = expanded();
  const onlyMissing = openOnly.checked && !openOnly.disabled;
  let visible = 0;
  for (const { part, text, row, ingredients } of displayed) {
    const parentMatches = text.includes(term);
    let hasMatchingIngredient = false;
    for (const ingredient of ingredients) {
      const matches = ingredient.text.includes(term);
      ingredient.line.hidden = !parentMatches && !matches;
      hasMatchingIngredient ||= matches;
    }
    part.hidden = (onlyMissing && row.missing === 0) || (!parentMatches && !hasMatchingIngredient);
    if (!part.hidden) visible++;
    if (term && !parentMatches && hasMatchingIngredient) part.open = true;
    if (!term && expandedBeforeSearch) part.open = expandedBeforeSearch.has(part.dataset.id);
  }
  if (!term) expandedBeforeSearch = null;
  empty.hidden = visible > 0;
  empty.textContent = term ? 'Kein Bauteil und keine Zutat gefunden.' : 'Alle Bauteile sind gedeckt.';
}

function show(plan) {
  const hasStock = plan.stock !== null;
  const stale = hasStock && Date.now() - Date.parse(plan.stock.at) > 20 * 60_000;
  status.textContent = hasStock
    ? `ME-Stand ${berlin.format(new Date(plan.stock.at))} Uhr · ${plan.stock.source}${stale ? ' · ältere Meldung' : ''}`
    : 'Warte auf die erste ME-Meldung. Bis dahin siehst du den Bedarf für alle 18 Stars.';
  status.dataset.stock = !hasStock ? 'unknown' : stale ? 'stale' : 'current';

  const netherTotal = plan.netherStars.reduce((total, row) => total + (row.inMe ?? 0) * row.units, 0);
  const completed = plan.goal - plan.remainingStars;
  const tiles = [
    ['ATM Stars verfügbar', hasStock ? `${format(completed)} / ${format(plan.goal)}` : '–'],
    ['Noch zu craften', hasStock ? format(plan.remainingStars) : '–'],
    ['ATM Star Blocks im ME', format(plan.blocks)],
    ['Nethersterne inkl. Blöcke', hasStock ? format(netherTotal) : '–'],
  ];
  metrics.replaceChildren(...tiles.map(([label, value], index) => {
    const tile = element('div');
    tile.append(element('dt', label), element('dd', value));
    if (index === 0) {
      tile.className = 'star-progress';
      if (hasStock) {
        const progress = element('progress');
        progress.max = plan.goal;
        progress.value = completed;
        progress.setAttribute('aria-label', 'Fortschritt zum ATM-Star-Ziel');
        tile.append(progress);
      }
    }
    return tile;
  }));
  metrics.hidden = false;
  openOnly.disabled = !hasStock;

  const groups = JSON.stringify([hasStock, plan.groups]);
  if (lastGroups === groups) return;
  const open = expanded();
  const focused = document.activeElement.closest('summary')?.parentElement.dataset.id;
  displayed = plan.groups.map((group, index) => {
    const part = element('details', undefined, 'star-part');
    part.dataset.id = group.alternatives[0].id;
    part.open = lastGroups === undefined ? index === 0 : open.has(part.dataset.id);
    const title = element('summary', undefined, 'star-row');
    fillRow(title, group, false, hasStock, plan.goal);
    const list = element('ul', undefined, 'star-ingredients');
    const ingredients = group.ingredients.map(ingredient => {
      const line = element('li', undefined, 'star-row');
      fillRow(line, ingredient, true, hasStock, plan.goal);
      return { line, text: searchText(ingredient) };
    });
    list.append(...ingredients.map(({ line }) => line));
    part.append(title, list);
    return { part, row: group, text: searchText(group), ingredients };
  });
  parts.replaceChildren(...displayed.map(({ part }) => part));
  byId('list-tools').hidden = false;
  byId('ledger').hidden = false;
  filterList();
  if (focused) [...parts.children].find(part => part.dataset.id === focused)?.firstElementChild.focus({ preventScroll: true });
  lastGroups = groups;
}

async function update() {
  if (refresh.disabled) return;
  refresh.disabled = true;
  try {
    show(await api('/api/atm-star'));
    error.hidden = true;
  } catch (failure) {
    error.textContent = `ME-Stand konnte nicht geladen werden. ${failure.message}`;
    error.hidden = false;
    if (!lastGroups) status.textContent = 'ME-Stand unbekannt';
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener('click', update);
search.addEventListener('input', filterList);
openOnly.addEventListener('change', filterList);
update();
setInterval(() => { if (!document.hidden) update(); }, 60_000);
