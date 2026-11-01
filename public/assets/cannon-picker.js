import { blueprintPreview } from './blueprint-preview.js?v=20261101-picker-1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('de-DE',{maximumFractionDigits:1});
const choices=c=>(c.blueprintChoices?.items||[]).filter(b=>Number.isFinite(b.progress)&&b.progress<100&&b.remaining>0&&Number.isFinite(b.distance)&&b.distance<256);
export function renderChoicePreview(choice) {
  if(!choice)return '<p class="muted">Einen baubaren Plan auswählen, um seinen Baustand zu sehen.</p>';
  return `<div class="cannon-choice">${blueprintPreview(choice,{size:'small'})}<div><strong>${esc(choice.name)} · v${esc(choice.version)}</strong><div class="bar" role="progressbar" aria-label="Baufortschritt" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${choice.progress}"><i style="width:${choice.progress}%"></i></div><p>${fmt(choice.progress)} % gebaut · ${fmt(choice.built)} / ${fmt(choice.total)} Blöcke</p><p>${fmt(choice.remaining)} noch baubar · ${fmt(choice.distance)} Blöcke entfernt</p>${choice.blocked||choice.unsupported?`<p class="muted">${fmt(choice.blocked+choice.unsupported)} weitere Blöcke werden übersprungen.</p>`:''}</div></div>`;
}
export function renderCannonPicker(c,ago) {
  const catalog=c.blueprintChoices, items=choices(c);
  const current=items.find(b=>b.id===c.blueprint?.id&&b.version===c.blueprint?.version);
  const hidden=Object.entries(catalog?.excluded||{}).filter(([,n])=>n>0).map(([key,n])=>`${fmt(n)} ${{finished:'fertig',range:'außer Reichweite',assigned:'bereits zugewiesen',blocked:'ohne baubaren Rest',unknown:'ohne sicheren Baustand'}[key]||'nicht verfügbar'}`).join(' · ');
  return `<details data-section="assignment" class="assignment"><summary>Ändern · ${items.length} baubar</summary><form class="assignment-form"><label class="setting">Baubare Baupläne<select name="blueprint"><option value="__current__" disabled hidden${!current?' selected':''}>${c.blueprint?'Aktueller Auftrag unverändert':'Bauplan auswählen'}</option>${c.blueprint?'<option value="">Auftrag aufheben</option>':''}${items.map(b=>`<option value="${esc(b.id)}"${current?.id===b.id?' selected':''}>${esc(b.name)} · ${fmt(b.progress)} % gebaut · ${fmt(b.remaining)} offen · ${fmt(b.distance)} Blöcke</option>`).join('')}</select></label><div data-choice-preview aria-live="polite">${renderChoicePreview(current)}</div>${catalog?.message?`<p class="muted">${esc(catalog.message)}</p>`:''}${hidden?`<p class="footnote">Ausgeblendet: ${esc(hidden)}.</p>`:''}<p class="footnote">${catalog?.snapshot?`Baustand aus Weltabgleich ${esc(ago(catalog.snapshot.capturedAt))}.`:'Baustand noch nicht verfügbar.'} Noch fehlendes Material kann anschließend geliefert oder gecraftet werden.</p><div class="form-actions"><button class="small" type="submit">Zuweisen</button><button class="small" type="reset">Verwerfen</button><span class="draft-note" role="status"></span></div><p class="form-error" role="alert"></p></form></details>`;
}
export function cannonSelectionPayload(data,c) {
  const id=data.get('blueprint');
  if(id===null||id==='__current__')return {};
  if(id==='')return c.blueprint?{blueprint:null}:{};
  const choice=choices(c).find(b=>b.id===id);
  if(!choice)throw Error('Dieser Bauplan ist nicht mehr in der baubaren Auswahl. Verwerfen und neu wählen.');
  if(id===c.blueprint?.id&&choice.version===c.blueprint.version)return {};
  return {blueprint:id,version:choice.version,selection:{version:choice.version,assignment:c.assignment}};
}
