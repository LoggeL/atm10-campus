import { api } from './campus-client.js?v=20261125-overhaul-1';
import { esc } from './format.js?v=20261125-overhaul-1';
import { renderFleetIssues } from './connection-status.js?v=20261125-overhaul-1';

const fleet = '/api/projects/erebor/cannon-sites';
const queue = '/api/projects/erebor/planfolge';
const button = (id, label, cls = 'small') => '<button type="button" class="' + cls + '" data-command="' + id + '">' + label + '</button>';

export function fleetEquipment(root, { admin, notify }) {
  let snapshot = null,
    epoch = 0,
    busy = false,
    lastMarkup = '';
  async function refresh() {
    if (busy) return;
    const seq = ++epoch;
    try {
      const data = await api(fleet + '/dreierbetrieb?format=json');
      if (seq !== epoch) return;
      snapshot = data;
      const editors = admin();
      const recent = Math.max(0, ...data.resume.map((r) => r.expires));
      const results = new Map();
      for (const row of data.resume.filter((r) => r.expires === recent)) {
        const text = row.result || (Date.now() < row.expires ? 'Wartet auf Freigabe' : 'Zeitfenster abgelaufen');
        results.set(text, (results.get(text) || 0) + 1);
      }
      const configuredSupply = data.supplySettings.filter((s) => s.configured).length;
      const totalSupply = data.supplySettings.length;
      const html =
        '<section class="panel fleet-overview">' +
        '<div class="fleet-overview-head"><h2>Flottenbetrieb</h2>' +
        '<div class="fleet-status-strip">' +
        '<span class="badge ' + (data.enabled ? 'built' : 'warning') + '">Zusatzkanonen: ' + (data.enabled ? 'freigegeben' : 'pausiert') + '</span>' +
        '<span class="badge ' + (data.stoneOrders ? 'built' : '') + '">Steinbestellung K02: ' + (data.stoneOrders ? 'aktiv' : 'aus') + '</span>' +
        '<span class="badge ' + (data.autoLoad ? 'ok' : 'warning') + '">Auto-Nachlegen: ' + (data.autoLoad ? 'aktiv' : 'pausiert') + '</span>' +
        '<span class="badge ' + (configuredSupply === totalSupply && totalSupply > 0 ? 'built' : '') + '">Materialpuffer: ' + configuredSupply + ' / ' + totalSupply + '</span>' +
        '</div></div>' +
        (editors
          ? '<div class="row">' +
            (data.staleQueue
              ? ''
              : button(
                  'reload',
                  data.autoLoad ? 'Nachlegen für die Flotte pausieren' : 'Nachlegen für die Flotte aktivieren',
                )) +
            button('helpers', data.enabled ? 'Neue Helferaufträge pausieren' : 'Helferaufträge freigeben') +
            button('start', 'Dreierbetrieb an allen Stationen starten', 'primary small') +
            button('resume', 'Pausierte Steinaufträge fortsetzen') +
            '</div>'
          : '') +
        (results.size ? '<p class="muted">' + [...results].map(([s, n]) => n + ' × ' + esc(s)).join(' · ') + '</p>' : '') +
        '<div class="row">' +
        (editors
          ? button('supply', '16 Stacks und 64 Schießpulver je Station setzen') +
            button('stone', data.stoneOrders ? 'Steinbestellung ausschalten' : 'Stein automatisch nachbestellen')
          : '') +
        '<a class="btn small" href="/assets/erebor-me-auftrag.html">Connecting-Blöcke bestellen</a></div>' +
        renderFleetIssues(data.diagnostics) +
        '<details data-maintenance><summary>Aufbau und Wartung</summary><p>A, B und C verwenden dieselbe Materialkiste. Bei K09 steht C unter der Kiste.</p>' +
        '<p class="muted">Controller ' +
        esc(data.chestController ?? 'unbekannt') +
        ' · Kistentracker ' +
        esc(data.chestTracker ?? 'unbekannt') +
        '</p><div class="row"><a class="btn small" href="/assets/erebor-shared-v5.zip">Kistensteuerung V5</a><a class="btn small" href="/assets/erebor-solid-v6.zip">Massiv-Update V6</a>' +
        (editors ? ' <a class="btn small" href="' + queue + '/drucker-reparatur.zip">Druckerreparatur herunterladen</a>' : '') +
        '</div></details></section>';
      if (html !== lastMarkup) {
        const opened = [...root.querySelectorAll('details[open]')].map(d=>d.querySelector('summary').textContent);
        const focus = root.contains(document.activeElement) ? document.activeElement.dataset.command : null;
        root.innerHTML = html;
        for(const details of root.querySelectorAll('details'))details.open=opened.includes(details.querySelector('summary').textContent);
        if (focus) root.querySelector('[data-command="' + focus + '"]')?.focus({ preventScroll: true });
        lastMarkup = html;
      }
    } catch (error) {
      if (seq === epoch) {
        snapshot = null;
        lastMarkup = '';
        root.textContent = 'Flottenbetrieb nicht verfügbar. ' + error.message;
      }
    }
  }
  root.addEventListener('click', async (event) => {
    const id = event.target.closest('[data-command]')?.dataset.command;
    if (!id || busy || !snapshot || !admin()) return;
    const { version, enabled, stoneOrders, autoLoad } = snapshot;
    const commands = {
      reload: [queue, { action: autoLoad ? 'pause' : 'prepare', version }],
      helpers: [queue + '/dreierbetrieb', { version, enabled: !enabled }],
      start: [queue + '/dreierbetrieb', { version, enabled: true, allMains: true }],
      resume: [queue + '/fortsetzen', { version }],
      supply: [fleet + '/materialpuffer', undefined],
      stone: ['/api/cannons/erebor-K02', { options: { stoneAutoCraft: !stoneOrders } }, 'PUT'],
    };
    const [url, body, method = 'POST'] = commands[id];
    ++epoch;
    busy = true;
    root.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const result = await api(url, { method, body });
      notify(id === 'resume' ? result.queued.length + ' Kanonen zum Fortsetzen vorgemerkt.' : 'Gespeichert.');
    } catch (error) {
      notify(error.message, true);
    } finally {
      busy = false;
      lastMarkup = '';
      await refresh();
    }
  });
  return { refresh };
}
