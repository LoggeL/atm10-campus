import { cannonRangeCard, distanceText } from './cannon-range.js?v=20261101-previews-1';
import { coordinateFields, placementValues } from './placement.js?v=20261101-previews-1';
import { blueprintPreview } from './blueprint-preview.js?v=20261101-previews-1';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = n => n == null ? '–' : Number(n).toLocaleString('de-DE');
const checked = value => value ? ' checked' : '';
const states = { outofrange:'Außer Reichweite', alignment:'Material gesperrt', offline:'Computer offline', nocomputer:'Kein Computer', feeding:'Aktiv', preparing:'Wartet auf Schematic', waiting:'Wartet auf Material', full:'Kiste voll', done:'Fertig', paused:'Pausiert', unassigned:'Kein Bauplan', missing:'Bauplan fehlt', nosnapshot:'Kein Live-Bestand', error:'Fehler', start:'Startet', unknown:'Status ausstehend' };
const jobs = { outofrange:'Außer Reichweite', queued:'Wartet auf Vorbereitung', applying:'Wird eingesetzt', waiting:'Wartet auf Kanone', ready:'Vorbereitet', empty:'Kein Rest zu bauen', error:'Vorbereitung fehlgeschlagen' };

export function canEditCannon(c, isAdmin) { return isAdmin || !c.alignment?.enabled; }

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
  const o = c.options, bp = c.blueprint, t = c.totals;
  const sc = c.schematic?.settings || {}, job = c.schematic?.job;
  const live = c.online && !c.status?.stale ? c.status : null;
  const canEdit = canEditCannon(c, isAdmin), canSchematic = isAdmin && c.alignment?.enabled;
  // A fresh computer report may refine feeding, but never override a server-side safety gate.
  const state = !c.online && bp && !['done','paused','outofrange'].includes(c.state) ? 'offline' : c.state === 'feeding' && live ? live.state : c.state;
  const blocked = ['alignment','outofrange','error','missing','nosnapshot'].includes(c.state);
  const pct = t?.start ? Math.max(0, Math.min(100, Math.round((t.start - t.needed) / t.start * 1000) / 10)) : null;
  const r = c.range, origin = placementValues(bp);
  const rangeText = r?.distance != null ? `${esc(distanceText(r.distance))} von ${esc(r.limit)} Blöcken` : 'Noch nicht geprüft';
  const opts = bp && !bpOptions.some(([id]) => id === bp.id) ? [[bp.id, bp.name], ...bpOptions] : bpOptions;
  const checkbox = (key, label, value) => `<label class="check"><input type="checkbox" name="${key}"${checked(value)}> ${label}</label>`;
  const shortages = (live?.shortages || []).map(x => `<li${x.crafting ? '' : ' class="warn"'}>${fmt(x.missing)} × ${esc(String(x.item).replace(/^minecraft:/,''))} <span class="muted">· im ME ${fmt(x.inME)}${x.crafting ? ' · wird gecraftet' : x.craftable ? ' · craftbar' : ''}</span>${x.error ? ` <span class="err">${esc(x.error)}</span>` : ''}</li>`).join('');
  return `<article class="panel cannon" data-cannon="${esc(c.name)}" aria-label="${esc(c.name)}">
    <div class="cannon-heading"><h2>${esc(c.name)}</h2><span class="connection"><span class="dot${c.online ? ' on' : ''}"></span>${c.online ? 'Online' : 'Offline'}</span><span class="last-seen">${c.lastSeenAt ? 'Meldung ' + esc(ago(c.lastSeenAt)) : 'Noch keine Meldung'}</span></div>
    <dl class="kv">
      <dt>Bauplan</dt><dd>${bp ? blueprintPreview(bp) : ''}<span>${bp ? `${esc(bp.name)} · v${esc(bp.version)}` : 'Kein Bauplan zugewiesen'}</span>
        ${canEdit ? `<details data-section="assignment" class="assignment"><summary>Ändern</summary><form class="assignment-form"><label class="setting">Bauplan<select name="blueprint"><option value="">Kein Bauplan</option>${opts.map(([id,name]) => `<option value="${esc(id)}"${bp?.id === id ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label><div class="form-actions"><button class="small" type="submit">Zuweisen</button><button class="small" type="reset">Verwerfen</button><span class="draft-note" role="status"></span></div><p class="form-error" role="alert"></p></form></details>` : ''}
        ${canEdit && bp && bp.version !== bp.currentVersion ? `<button class="small" data-act="upgrade" data-bp="${esc(bp.id)}">Auf v${esc(bp.currentVersion)} aktualisieren</button>` : ''}</dd>
      ${bp ? `<dt>Zielkoordinaten</dt><dd>${coordinateFields(bp)}${origin ? `<button class="text-button small" data-copy-coordinate="${origin.join(' ')}">Kopieren</button>` : ''}</dd>` : ''}
      <dt>Reichweite</dt><dd><span class="muted" title="Weniger als 256 Blöcke Luftlinie, Höhe eingeschlossen">${rangeText}</span><span class="badge ${r?.state === 'inrange' ? 'built' : 'warning'}">${r?.state === 'inrange' ? 'Erreichbar' : r?.state === 'outofrange' ? 'Außer Reichweite' : r?.state === 'dimension' ? 'Andere Dimension' : r?.state === 'unbound' ? 'Kanone noch nicht verbunden' : 'Kein Ziel'}</span>${bp && r?.version && r.version !== bp.version ? `<span class="muted">Für v${esc(r.version)}: ${esc(r.origin?.join(' '))}</span>` : ''}</dd>
      <dt>Materialversorgung</dt><dd><span class="badge ${blocked ? 'warning' : state === 'done' ? 'built' : 'ok'}">${esc(states[state] || state)}</span>${live?.chest ? `<span class="muted">Kiste ${fmt(live.chest.used)}/${fmt(live.chest.slots)}</span>` : ''}</dd>
      <dt>Schematic</dt><dd>${esc(sc.enabled ? jobs[job?.state] || 'Wartet auf Bauplan' : 'Manuell einsetzen')}${job?.version ? ` <span class="muted">v${esc(job.version)}</span>` : ''}</dd>
    </dl>
    ${bp && t ? `<div class="cannon-progress"><div class="bar"><i style="width:${pct ?? 0}%"></i></div><p>${pct == null ? 'Fortschritt noch unbekannt' : fmt(pct) + ' %'} · noch ${fmt(t.needed)} Items in ${fmt(t.kinds)} Sorten</p></div>` : ''}
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
        ${isAdmin && !c.alignment?.enabled ? '<p class="footnote">Zuerst unter „Verbindung und Diagnose“ den Kanonen-Block bestätigen.</p>' : !isAdmin && canEdit ? '<p class="footnote">Die automatische Vorbereitung richtet ein Admin ein.</p>' : ''}
        <details data-section="advanced"><summary>Weitere Einstellungen</summary>
          ${checkbox('o_paused', 'Materialzufuhr pausieren', o.paused)}
          <p class="footnote">Pausiert die Lieferung aus dem ME. Die Kanone selbst bedienst du im Spiel.</p>
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
