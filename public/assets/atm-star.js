import { api } from './campus-client.js?v=20261114-status-1';

const byId = id => document.getElementById(id);
const status = byId('stock-status');
const error = byId('stock-error');
const metrics = byId('metrics');
const parts = byId('parts');
const refresh = byId('refresh');
const number = new Intl.NumberFormat('de-DE');
const berlin = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const format = quantity => quantity === null ? 'unbekannt' : number.format(quantity);

function element(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function checklistItem(row, ingredient, hasStock) {
  const container = element('span', undefined, 'star-item');
  const label = row.alternatives.map(option => option.label).join(' oder ');
  const checkbox = element('input');
  checkbox.type = 'checkbox';
  checkbox.disabled = true;
  checkbox.checked = hasStock && row.missing === 0;
  checkbox.setAttribute('aria-label', label + ' gedeckt');
  const name = element('span', `${format(row.needed)} × ${label}`, 'star-item-name');
  name.title = row.alternatives.map(option => option.id).join(' | ');
  const facts = element('span', undefined, 'star-item-note');
  const recipe = `${format(row.perRecipe)} je ${ingredient ? 'Bauteil' : 'Star'}`;
  const goal = `${format(row.totalForGoal)} für 18 Stars`;
  const stock = row.alternatives.length === 1
    ? `ME ${format(row.alternatives[0].inMe)}`
    : `ME ${row.alternatives.map(option => `${format(option.inMe)} ${option.label}`).join(' / ')}`;
  facts.append(`${recipe} · ${goal} · ${stock}`);
  if (hasStock) {
    const allocated = row.alternatives.reduce((sum, option) => sum + option.allocated, 0);
    if (ingredient && allocated > 0) facts.append(` · ${format(allocated)} hier eingeplant`);
    const progress = row.missing > 0 ? `${format(row.missing)} offen` : 'gedeckt';
    facts.append(' · ', element('strong', progress, row.missing > 0 ? 'star-needed' : 'star-ready'));
  }
  container.append(checkbox, name, facts);
  return container;
}

let lastGroups;
function show(plan) {
  const hasStock = plan.stock !== null;
  const stale = hasStock && Date.now() - Date.parse(plan.stock.at) > 20 * 60_000;
  status.textContent = hasStock
    ? `ME-Stand ${berlin.format(new Date(plan.stock.at))} Uhr · ${plan.stock.source}${stale ? ' · ältere Meldung' : ''}`
    : 'Warte auf die erste ME-Meldung. Bis dahin siehst du den Bedarf für alle 18 Stars.';

  const netherTotal = plan.netherStars.reduce((total, row) => total + (row.inMe ?? 0) * row.units, 0);
  const tiles = [
    ['ATM Stars im ME', format(plan.stars)],
    ['ATM Star Blocks im ME', format(plan.blocks)],
    ['Noch zu craftende Stars', hasStock ? format(plan.remainingStars) : 'unbekannt'],
    ['Nethersterne inkl. Blöcke', hasStock ? format(netherTotal) : 'unbekannt'],
  ];
  metrics.replaceChildren(...tiles.map(([label, value]) => {
    const tile = element('div');
    tile.append(element('dt', label), element('dd', value));
    return tile;
  }));
  metrics.hidden = false;

  const groups = JSON.stringify([hasStock, plan.groups]);
  if (lastGroups === groups) return;
  const open = new Set([...parts.querySelectorAll('details[open]')].map(part => part.dataset.id));
  const focused = document.activeElement.closest('summary')?.parentElement.dataset.id;
  parts.replaceChildren(...plan.groups.map((group, index) => {
    const part = element('details', undefined, 'star-part');
    part.dataset.id = group.alternatives[0].id;
    part.open = lastGroups === undefined ? index === 0 : open.has(part.dataset.id);
    const title = element('summary');
    title.append(checklistItem(group, false, hasStock));
    const ingredients = element('ul', undefined, 'star-ingredients');
    ingredients.append(...group.ingredients.map(ingredient => {
      const line = element('li');
      line.append(checklistItem(ingredient, true, hasStock));
      return line;
    }));
    part.append(title, ingredients);
    return part;
  }));
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
update();
setInterval(() => { if (!document.hidden) update(); }, 60_000);
