import { esc } from './format.js?v=20261101-polish-1';
import { blueprintPreview } from './blueprint-preview.js?v=20261101-polish-1';
const fmt=n=>Number(n).toLocaleString('de-DE',{maximumFractionDigits:1});
const choices=c=>(c.blueprintChoices?.items||[]).filter(b=>b.nativeProgress?.state!=='completed'&&Number.isFinite(b.progress)&&b.progress<100&&b.remaining>0&&Number.isFinite(b.distance)&&b.distance<256);
export function nativeProgressLabel(progress) {
  if(!progress)return '';
  const percent=Number.isFinite(progress.percent)?Math.max(0,Math.min(progress.state==='completed'?100:99.9,progress.percent)):null;
  return `${percent===null?'Auftrag: Fortschritt unbekannt':'Auftrag '+fmt(percent)+' %'}${progress.fresh?' · Kanone':' · letzter Stand'}`;
}
export function renderNativeProgress(progress) {
  if(!progress)return '';
  const percent=Number.isFinite(progress.percent)?Math.max(0,Math.min(progress.state==='completed'?100:99.9,progress.percent)):null;
  const sent=Number.isFinite(progress.sent)?fmt(progress.sent):'?', total=Number.isFinite(progress.total)?fmt(progress.total):'?';
  return `<div class="bar" role="progressbar" aria-label="Auftragsfortschritt" aria-valuemin="0" aria-valuemax="100"${percent===null?'':` aria-valuenow="${percent}"`}><i style="width:${percent??0}%"></i></div><p>${esc(nativeProgressLabel(progress))}${progress.state==='completed'?' · Abgeschlossen':` · ${sent} / ${total} Schüsse gesendet${progress.state==='finishing'?' · Letzte Blöcke noch unterwegs':''}`}</p>`;
}
const choiceLabel=b=>`${b.name} · ${b.nativeProgress?.fresh?nativeProgressLabel(b.nativeProgress):fmt(b.progress)+' % gebaut'} · ${fmt(b.remaining)} offen · ${fmt(b.distance)} Blöcke`;
const pickerMeta=(catalog,ago)=>{
  const hidden=Object.entries(catalog?.excluded||{}).filter(([,n])=>n>0).map(([key,n])=>`${fmt(n)} ${{finished:'fertig',range:'außer Reichweite',assigned:'bereits zugewiesen',blocked:'ohne baubaren Rest',unknown:'ohne sicheren Baustand'}[key]||'nicht verfügbar'}`).join(' · ');
  return `${catalog?.message?`<p class="muted">${esc(catalog.message)}</p>`:''}${hidden?`<p class="footnote">Ausgeblendet: ${esc(hidden)}.</p>`:''}<p class="footnote">${catalog?.snapshot?`Baustand aus Weltabgleich ${esc(ago(catalog.snapshot.capturedAt))}.`:'Baustand noch nicht verfügbar.'} Noch fehlendes Material kann anschließend geliefert oder gecraftet werden.</p>`;
};
export function renderChoicePreview(choice) {
  if(!choice)return '<p class="muted">Einen baubaren Plan auswählen, um seinen Baustand zu sehen.</p>';
  const native=choice.nativeProgress;
  return `<div class="cannon-choice">${blueprintPreview(choice,{size:'small'})}<div><strong>${esc(choice.name)} · v${esc(choice.version)}</strong>${native?.fresh?renderNativeProgress(native):`<div class="bar" role="progressbar" aria-label="Baufortschritt aus Weltabgleich" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${choice.progress}"><i style="width:${choice.progress}%"></i></div>`}<p>Weltabgleich: ${fmt(choice.progress)} % gebaut · ${fmt(choice.built)} / ${fmt(choice.total)} Blöcke</p>${native&&!native.fresh?`<p class="muted">${esc(nativeProgressLabel(native))}, nicht live.</p>`:''}<p>${fmt(choice.remaining)} noch baubar · ${fmt(choice.distance)} Blöcke entfernt</p>${choice.blocked||choice.unsupported?`<p class="muted">${fmt(choice.blocked+choice.unsupported)} weitere Blöcke werden übersprungen.</p>`:''}</div></div>`;
}
const pickerSummary=(c,count)=>`${c.done?'Nächsten Bauplan wählen':c.blueprint?'Bauplan ändern':'Bauplan wählen'} · ${count} baubar`;
export function renderCannonPicker(c,ago) {
  const catalog=c.blueprintChoices, items=choices(c);
  const current=items.find(b=>b.id===c.blueprint?.id&&b.version===c.blueprint?.version);
  return `<details data-section="assignment" class="assignment"><summary>${pickerSummary(c,items.length)}</summary><form class="assignment-form"><label class="setting">Baubare Baupläne<select name="blueprint"><option value="__current__" disabled hidden${!current?' selected':''}>${c.blueprint?'Aktueller Auftrag unverändert':'Bauplan auswählen'}</option>${c.blueprint?'<option value="">Auftrag aufheben</option>':''}${items.map(b=>`<option value="${esc(b.id)}" data-version="${esc(b.version)}"${current?.id===b.id?' selected':''}>${esc(choiceLabel(b))}</option>`).join('')}</select></label><div data-choice-preview aria-live="polite">${renderChoicePreview(current)}</div><p data-choice-warning class="warn" role="status"></p><div data-choice-meta>${pickerMeta(catalog,ago)}</div><div class="form-actions"><button class="small" type="submit">Zuweisen</button><button class="small" type="reset">Verwerfen</button><span class="draft-note" role="status"></span></div><p class="form-error" role="alert"></p></form></details>`;
}
// Refresh only the picker contents. Keep the select, form and other settings nodes alive.
export function updateCannonPicker(card,c,ago) {
  const form=card.querySelector('.assignment-form');
  if(!form)return;
  const select=form.querySelector('select[name="blueprint"]'), value=select.value;
  const version=select.selectedOptions[0]?.dataset.version, items=choices(c);
  const selected=items.find(b=>b.id===value&&String(b.version)===version);
  const invalid=value!==''&&value!=='__current__'&&!selected;
  for(const option of [...select.options]) {
    if(option.value===''||option.value==='__current__')continue;
    const choice=items.find(b=>b.id===option.value&&String(b.version)===option.dataset.version);
    if(!choice)option.remove();else option.textContent=choiceLabel(choice);
  }
  for(const choice of items) {
    if([...select.options].some(o=>o.value===choice.id&&o.dataset.version===String(choice.version)))continue;
    const option=select.ownerDocument.createElement('option');option.value=choice.id;option.dataset.version=String(choice.version);option.textContent=choiceLabel(choice);select.append(option);
  }
  select.value=invalid?'__current__':value;
  if(invalid)form.dataset.choiceInvalid='1';
  const warning=form.querySelector('[data-choice-warning]');
  warning.textContent=form.dataset.choiceInvalid?'Der ausgewählte Bauplan ist inzwischen fertig oder nicht mehr baubar. Bitte neu wählen oder verwerfen.':'';
  form.querySelector('[data-choice-preview]').innerHTML=renderChoicePreview(selected);
  form.querySelector('[data-choice-meta]').innerHTML=pickerMeta(c.blueprintChoices,ago);
  card.querySelector('[data-section="assignment"] > summary').textContent=pickerSummary(c,items.length);
}
export function cannonSelectionPayload(data,c,{catalog=c.blueprintChoices,version=null}={}) {
  const id=data.get('blueprint');
  if(id===null||id==='__current__')return {};
  if(id==='')return c.blueprint?{blueprint:null}:{};
  const choice=choices({blueprintChoices:catalog}).find(b=>b.id===id&&(version===null||String(b.version)===String(version)));
  if(!choice)throw Error('Dieser Bauplan ist nicht mehr in der baubaren Auswahl. Verwerfen und neu wählen.');
  if(id===c.blueprint?.id&&choice.version===c.blueprint.version)return {};
  return {blueprint:id,version:choice.version,selection:{version:choice.version,assignment:c.assignment}};
}
