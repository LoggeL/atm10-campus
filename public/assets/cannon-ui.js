import { renderCannonPicker, renderNativeProgress, nativeProgressLabel } from './cannon-picker.js?v=20261101-progress-1';
import { cannonRangeCard, distanceText } from './cannon-range.js?v=20261101-progress-1';
import { coordinateFields, placementValues } from './placement.js?v=20261101-progress-1';
import { blueprintPreview } from './blueprint-preview.js?v=20261101-progress-1';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => n == null ? '–' : Number(n).toLocaleString('de-DE');
const checked = value => value ? ' checked' : '';
const states = { outofrange:'Außer Reichweite', alignment:'Material gesperrt', offline:'Computer offline', nocomputer:'Kein Computer', feeding:'Aktiv', preparing:'Wartet auf Schematic', waiting:'Wartet auf Material', full:'Kiste voll', done:'Fertig', paused:'Pausiert', unassigned:'Kein Bauplan', missing:'Bauplan fehlt', nosnapshot:'Kein Live-Bestand', error:'Fehler', start:'Startet', unknown:'Status ausstehend' };
const jobs = { outofrange:'Außer Reichweite', queued:'Wartet auf Vorbereitung', applying:'Wird eingesetzt', waiting:'Wartet auf Kanone', ready:'Vorbereitet', empty:'Kein Rest zu bauen', error:'Vorbereitung fehlgeschlagen' };
const discoveryUnresolved = d => !!(d?.automatic && d.state && !['bound','found','disabled'].includes(d.state));
const supplyState = c => !c.online && c.blueprint && !['done','paused','outofrange'].includes(c.state) ? 'offline' : c.state === 'feeding' && c.online && c.status && !c.status.stale ? c.status.state : c.state;

export function canEditCannon(c, isAdmin) { return isAdmin || !c.alignment?.enabled; }

export function cannonLocation(c) {
  const alignment = c.alignment || {}, discovery = alignment.discovery || {}, binding = alignment.binding;
  const bound = alignment.enabled && binding && ['x','y','z'].every(key => Number.isSafeInteger(binding[key]));
  if (bound && !discoveryUnresolved(discovery)) return {label:discovery.automatic && ['bound','found'].includes(discovery.state) ? 'Automatisch erkannt' : 'Position gespeichert', binding, retry:false};
  const pending = ['searching','pending','queued'].includes(discovery.state);
  const labels = {
    searching:'Kanonen-Position wird automatisch gesucht …', pending:'Kanonen-Position wird automatisch gesucht …', queued:'Kanonen-Position wird automatisch gesucht …',
    found:'Kanone gefunden. Die Verbindung wird noch geprüft.', bound:'Die Kanonen-Position wird noch geprüft.',
    missing:'Noch keine passende Kanone gefunden.', ambiguous:'Die Kanone lässt sich noch nicht eindeutig zuordnen.',
    unsupported:'Dieser Aufbau kann noch nicht automatisch zugeordnet werden.', offline:'Der Minecraft-Computer ist offline.',
    blocked:'Die automatische Zuordnung wartet auf eine Prüfung.', disabled:'Die automatische Positionssuche ist deaktiviert.',
    error:'Die Kanonen-Position konnte gerade nicht ermittelt werden.',
  };
  return {label:discovery.message || labels[discovery.state] || 'Kanonen-Position noch nicht ermittelt.', binding:null, retry:!pending};
}

export function cannonStartState(c, isAdmin) {
  const native = c?.alignment?.observed?.state;
  const visible = !!(isAdmin && c?.alignment?.enabled && c?.schematic?.settings?.enabled && c?.blueprint);
  const label = c?.done ? 'Fertig' : native === 'RUNNING' ? 'Läuft' : native === 'PAUSED' ? 'Fortsetzen' : 'Kanone starten';
  const reason = !visible ? 'Automatische Vorbereitung und erkannte Kanonen-Position erforderlich.'
    : !c.online ? 'Der Minecraft-Computer ist offline.'
    : discoveryUnresolved(c.alignment.discovery) ? c.alignment.discovery.message || 'Die Kanonen-Position ist noch nicht eindeutig erkannt.'
    : c.range?.state !== 'inrange' ? 'Das Bauziel ist nicht als erreichbar bestätigt.'
    : c.schematic.job?.state !== 'ready' || c.schematic.job?.version !== c.blueprint.version ? 'Der gewählte Bauplan ist noch nicht eingesetzt.'
    : c.alignment.state !== 'aligned' ? c.alignment.message || 'Die Live-Prüfung der Kanone fehlt.'
    : c.options?.paused ? 'Die Materialzufuhr ist pausiert.'
    : c.done ? 'Für diesen Auftrag ist nichts mehr zu bauen.'
    : native === 'RUNNING' ? 'Die Kanone baut bereits.'
    : !['STOPPED','PAUSED'].includes(native) ? 'Der Zustand der Kanone ist noch nicht bestätigt.'
    : '';
  return {visible, enabled:visible && !reason, label, reason};
}

export function renderCannonProgress(c) {
  if(!c.blueprint)return '';
  const native=c.nativeProgress, t=c.totals;
  if(native?.fresh)return `<div class="cannon-progress">${renderNativeProgress(native)}</div>`;
  const pct=t?.start?Math.max(0,Math.min(100,Math.round((t.start-t.needed)/t.start*1000)/10)):null;
  return `<div class="cannon-progress"><div class="bar" role="progressbar" aria-label="Materialfortschritt aus Weltabgleich" aria-valuemin="0" aria-valuemax="100"${pct==null?'':` aria-valuenow="${pct}"`}><i style="width:${pct??0}%"></i></div><p>Weltabgleich: ${pct==null?'Fortschritt noch unbekannt':fmt(pct)+' %'}${t?` · noch ${fmt(t.needed)} Items in ${fmt(t.kinds)} Sorten`:''}</p>${native?`<p class="muted">${esc(nativeProgressLabel(native))}, nicht live.${native.state==='completed'?' Auftrag abgeschlossen.':''}</p>`:''}</div>`;
}

function renderCannonStart(c,isAdmin) {
  const start=cannonStartState(c,isAdmin),bp=c.blueprint;
  return start.visible?`<div class="cannon-start"><button class="primary" data-act="start"${start.enabled?'':' disabled'} title="${esc(start.reason||'Bauplan und Kanone werden vor dem Start live geprüft.')}">${start.label}</button><span class="muted">${esc(start.reason||`Baut v${bp.version} an ${bp.origin.join(' ')}. Die Kanone wird vor dem Start live geprüft.`)}</span></div>`:'';
}

// Live status must keep moving while editable form nodes and their baselines stay intact.
export function updateCannonLive(card,c,{isAdmin,busy=false,sameAssignment=true}) {
  const progress=card.querySelector('[data-cannon-progress]');
  if(progress)progress.innerHTML=(sameAssignment?'':`<p class="notice">Der Auftrag wurde geändert.${c.blueprint?` Live-Fortschritt für ${esc(c.blueprint.name)} · v${esc(c.blueprint.version)}.`:''} Deine Eingaben bleiben erhalten.</p>`)+renderCannonProgress(c);
  const supply=card.querySelector('[data-cannon-state]');
  const state=supplyState(c);
  if(supply){supply.textContent=states[state]||state;supply.className=`badge ${['alignment','outofrange','error','missing','nosnapshot'].includes(c.state)?'warning':state==='done'?'built':'ok'}`;}
  if(c.nativeProgress?.state==='completed') {
    const schematic=card.querySelector('[data-cannon-schematic]');
    if(schematic)schematic.textContent=`Auftrag abgeschlossen${c.blueprint?.version?' · v'+c.blueprint.version:''}`;
  }
  if(!busy) {
    const start=card.querySelector('[data-cannon-start]');
    if(start) {
      start.innerHTML=renderCannonStart(c,isAdmin);
      const button=start.querySelector('button');
      if(button&&!sameAssignment){button.disabled=true;button.title='Der Auftrag hat sich geändert. Eingaben zuerst speichern oder verwerfen.';}
    }
  }
}

// Submit only edits. In particular, changing the feeder must not re-apply an unchanged schematic.
export function cannonSettingsPayload(data, c, isAdmin) {
  if (!canEditCannon(c, isAdmin)) throw new Error('Diese gebundene Kanone kann nur ein Admin ändern.');
  const options = {}, schematic = {};
  for (const key of ['paused', 'autoCraft', 'returnLeftovers', 'skipBlocked']) {
    const value = data.has('o_' + key);
    if (value !== c.options[key]) options[key] = value;
  }
  for (const [key, lo, hi] of [['bufferStacks', 1, 16], ['gunpowder', 0, 64], ['craftBatch', 1, 4096]]) {
    const raw = data.get('o_' + key), value = Number(raw);
    if (raw == null || raw === '' || !Number.isInteger(value) || value < lo || value > hi) throw new Error('Bitte gültige Mengen eintragen.');
    if (value !== c.options[key]) options[key] = value;
  }
  if (isAdmin && c.alignment?.enabled) {
    const current = c.schematic.settings;
    for (const key of ['enabled', 'autoUpdate', 'skipMissing', 'protectBlockEntities']) {
      const value = data.has('s_' + key);
      if (value !== current[key]) schematic[key] = value;
    }
    const mode = Number(data.get('s_replaceMode'));
    if (!data.has('s_replaceMode') || ![0,1,2].includes(mode)) throw new Error('Bitte einen gültigen Ersetzungsmodus wählen.');
    if (mode !== current.replaceMode) schematic.replaceMode = mode;
  }
  return { ...(Object.keys(options).length ? { options } : {}), ...(Object.keys(schematic).length ? { schematic } : {}) };
}

export function renderCannon(c, bpOptions, { isAdmin, alignmentHtml, ago }) {
  const o = c.options, bp = c.blueprint;
  const sc = c.schematic?.settings || {}, job = c.schematic?.job;
  const live = c.online && !c.status?.stale ? c.status : null;
  const canEdit = canEditCannon(c, isAdmin), canSchematic = isAdmin && c.alignment?.enabled;
  const location = cannonLocation(c);
  // A fresh computer report may refine feeding, but never override a server-side safety gate.
  const state = supplyState(c);
  const blocked = ['alignment','outofrange','error','missing','nosnapshot'].includes(c.state);
  const r = c.range, origin = placementValues(bp);
  const rangeText = r?.distance != null ? `${esc(distanceText(r.distance))} von ${esc(r.limit)} Blöcken` : 'Noch nicht geprüft';
  const checkbox = (key, label, value) => `<label class="check"><input type="checkbox" name="${key}"${checked(value)}> ${label}</label>`;
  const shortages = (live?.shortages || []).map(x => `<li${x.crafting ? '' : ' class="warn"'}>${fmt(x.missing)} × ${esc(String(x.item).replace(/^minecraft:/,''))} <span class="muted">· im ME ${fmt(x.inME)}${x.crafting ? ' · wird gecraftet' : x.craftable ? ' · craftbar' : ''}</span>${x.error ? ` <span class="err">${esc(x.error)}</span>` : ''}</li>`).join('');
  return `<article class="panel cannon" data-cannon="${esc(c.name)}" aria-label="${esc(c.name)}">
    <div class="cannon-heading"><h2>${esc(c.name)}</h2><span class="connection"><span class="dot${c.online ? ' on' : ''}"></span>${c.online ? 'Online' : 'Offline'}</span><span class="last-seen">${c.lastSeenAt ? 'Meldung ' + esc(ago(c.lastSeenAt)) : 'Noch keine Meldung'}</span></div>
    <dl class="kv">
      <dt>Bauplan</dt><dd>${bp ? blueprintPreview(bp) : ''}<span>${bp ? `${esc(bp.name)} · v${esc(bp.version)}` : 'Kein Bauplan zugewiesen'}</span>
        ${canEdit ? renderCannonPicker(c,ago) : ''}
        ${canEdit && bp && bp.version !== bp.currentVersion ? `<button class="small" data-act="upgrade" data-bp="${esc(bp.id)}">Auf v${esc(bp.currentVersion)} aktualisieren</button>` : ''}</dd>
      ${bp ? `<dt>Zielkoordinaten</dt><dd>${coordinateFields(bp)}${origin ? `<button class="text-button small" data-copy-coordinate="${origin.join(' ')}">Kopieren</button>` : ''}</dd>` : ''}
      <dt>Kanonen-Position</dt><dd><span>${esc(location.label)}</span>${location.binding ? `<span class="mono">X ${location.binding.x} · Y ${location.binding.y} · Z ${location.binding.z}</span>` : isAdmin && location.retry ? '<button class="text-button small" data-act="discover">Erneut suchen</button>' : ''}</dd>
      ${r?.state !== 'unbound' ? `<dt>Reichweite</dt><dd><span class="muted" title="Weniger als 256 Blöcke Luftlinie, Höhe eingeschlossen">${rangeText}</span><span class="badge ${r?.state === 'inrange' ? 'built' : 'warning'}">${r?.state === 'inrange' ? 'Erreichbar' : r?.state === 'outofrange' ? 'Außer Reichweite' : r?.state === 'dimension' ? 'Andere Dimension' : 'Kein Ziel'}</span>${bp && r?.version && r.version !== bp.version ? `<span class="muted">Für v${esc(r.version)}: ${esc(r.origin?.join(' '))}</span>` : ''}</dd>` : ''}
      <dt>Materialversorgung</dt><dd><span data-cannon-state class="badge ${blocked ? 'warning' : state === 'done' ? 'built' : 'ok'}">${esc(states[state] || state)}</span>${live?.chest ? `<span class="muted">Kiste ${fmt(live.chest.used)}/${fmt(live.chest.slots)}</span>` : ''}</dd>
      <dt>Schematic</dt><dd data-cannon-schematic>${esc(c.nativeProgress?.state==='completed'?'Auftrag abgeschlossen':sc.enabled ? jobs[job?.state] || (bp ? 'Wartet auf Vorbereitung' : 'Bauplan auswählen') : c.alignment?.enabled ? 'Automatische Vorbereitung ist aus' : 'Wartet auf Kanonen-Position')}${job?.version ? ` <span class="muted">v${esc(job.version)}</span>` : ''}${!sc.enabled && c.alignment?.enabled && isAdmin ? '<button class="text-button small" data-act="open-settings">Automatik einrichten</button>' : ''}</dd>
    </dl>
    <div data-cannon-start>${renderCannonStart(c,isAdmin)}</div>
    <div data-cannon-progress>${renderCannonProgress(c)}</div>
    ${r && ['outofrange','dimension'].includes(r.state) ? cannonRangeCard(c, isAdmin) : ''}
    ${c.message && c.state !== 'outofrange' ? `<p class="notice${c.state === 'error' ? ' error' : ''}" role="status">${esc(c.message)}</p>` : ''}
    ${sc.enabled && job && !['ready','empty','outofrange'].includes(job.state) ? `<p class="notice" role="status">${esc(job.message || jobs[job.state])}</p>` : ''}
    ${live?.message && live.message !== c.message ? `<p class="muted">${esc(live.message)}</p>` : ''}
    ${shortages ? `<details data-section="shortages"${live.shortages.length <= 3 ? ' open' : ''}><summary>Fehlendes Material (${live.shortages.length})</summary><ul class="short">${shortages}</ul></details>` : ''}
    <details class="settings" data-section="settings"><summary>Einstellungen</summary>
      ${!canEdit ? '<p class="muted">Diese gebundene Kanone kann nur ein Admin ändern.</p>' : ''}
      <form class="cannon-settings"><fieldset${canEdit ? '' : ' disabled'}>
        ${checkbox('o_autoCraft', 'Fehlendes automatisch craften', o.autoCraft)}
        ${checkbox('o_returnLeftovers', 'Reste ins ME zurückgeben', o.returnLeftovers)}
        <fieldset${canSchematic ? '' : ' disabled'}>${checkbox('s_enabled', 'Schematic automatisch vorbereiten', sc.enabled)}</fieldset>
        ${!c.alignment?.enabled ? '<p class="footnote">Die automatische Vorbereitung braucht eine eindeutig erkannte Kanone.</p>' : !isAdmin ? '<p class="footnote">Die automatische Vorbereitung kann ein Admin ändern.</p>' : ''}
        <details data-section="advanced"><summary>Weitere Einstellungen</summary>
          ${checkbox('o_paused', 'Materialzufuhr pausieren', o.paused)}
          <p class="footnote">Pausiert die Lieferung aus dem ME. Einen laufenden Bau hältst du an der Kanone im Spiel an.</p>
          ${checkbox('o_skipBlocked', 'Zellen mit Maschinen nicht beliefern', o.skipBlocked)}
          <div class="form-row">${[['bufferStacks','Puffer (Stacks)',1,16],['gunpowder','Schießpulver',0,64],['craftBatch','Craft-Menge',1,4096]].map(([k,label,min,max]) => `<label>${label}<input type="number" name="o_${k}" min="${min}" max="${max}" step="1" value="${o[k]}" required></label>`).join('')}</div>
          <fieldset${canSchematic ? '' : ' disabled'}><label class="setting">Blöcke ersetzen<select name="s_replaceMode">${[[0,'Feste Blöcke stehen lassen'],[1,'Feste Blöcke nur durch feste ersetzen'],[2,'Vorhandene Blöcke ersetzen']].map(([v,label]) => `<option value="${v}"${(sc.replaceMode ?? 2) === v ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
            ${checkbox('s_autoUpdate', 'Neue Planversionen übernehmen', sc.autoUpdate !== false)}
            ${checkbox('s_skipMissing', 'Fehlende Materialien überspringen', sc.skipMissing)}
            ${checkbox('s_protectBlockEntities', 'Maschinen in der Welt schützen', sc.protectBlockEntities !== false)}
          </fieldset>
        </details>
        <div class="form-actions"><button class="primary" type="submit">Speichern</button><button type="reset">Verwerfen</button><span class="draft-note" role="status"></span></div>
      </fieldset><p class="form-error" role="alert"></p></form>
    </details>
    <details data-section="diagnostics"><summary>Verbindung und Diagnose</summary>
      <p class="muted">${live?.script ? `Computer-Script ${esc(live.script)}` : 'Keine aktuelle Script-Meldung'} · Auftrag ${esc(c.assignment)}</p>
      ${bp ? `<div class="row"><a class="btn small" href="/api/blueprints/${encodeURIComponent(bp.id)}/download?version=${bp.version}">NBT v${esc(bp.version)}</a>${c.restNbt ? `<a class="btn small" href="${esc(c.restNbt)}" download>Rest-NBT</a>` : ''}<button class="small" data-act="position" data-bp="${esc(bp.id)}">Bauplan und Position</button>${isAdmin ? `<button class="small" data-act="prepare"${sc.enabled ? '' : ' disabled'}>Rest-Plan neu vorbereiten</button>` : ''}</div>` : ''}
      ${alignmentHtml}
      ${job?.message ? `<p class="muted">${esc(job.message)}</p>` : ''}
      ${(c.items || []).length ? `<p class="muted">Als Nächstes: ${c.items.slice(0,6).map(i => `${esc(String(i.item).replace(/^minecraft:/,''))} ${fmt(i.needed)}`).join(' · ')}</p>` : ''}
      <button class="small danger" data-act="delete"${c.alignment?.enabled ? ' disabled title="Gebundene Station geschützt"' : ''}>Station entfernen</button>
    </details>
  </article>`;
}
