import { esc } from './format.js?v=20261101-select-1';
import { blueprintPreview } from './blueprint-preview.js?v=20261101-select-1';
const fmt=n=>Number(n).toLocaleString('de-DE',{maximumFractionDigits:1});
export const pickerChoices=c=>(c.blueprintChoices?.items||[]).filter(b=>b.nativeProgress?.state!=='completed'&&Number.isFinite(b.progress)&&b.progress<100&&b.remaining>0&&Number.isFinite(b.distance)&&b.distance<256);
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
const pickerMeta=(catalog,ago)=>{
  const hidden=Object.entries(catalog?.excluded||{}).filter(([,n])=>n>0).map(([key,n])=>`${fmt(n)} ${{finished:'fertig',range:'außer Reichweite',assigned:'bereits zugewiesen',blocked:'ohne baubaren Rest',unknown:'ohne sicheren Baustand'}[key]||'nicht verfügbar'}`).join(' · ');
  return `${hidden?`Ausgeblendet: ${esc(hidden)}. `:''}${catalog?.snapshot?`Baustand aus Weltabgleich ${esc(ago(catalog.snapshot.capturedAt))}.`:'Baustand noch nicht verfügbar.'} Fehlendes Material wird danach geliefert oder gecraftet.`;
};
export const renderPickerMeta=pickerMeta;
const pickerTitle=c=>c.done?'Nächsten Bauplan wählen':c.blueprint?'Bauplan ändern':'Bauplan wählen';
const pickerSummary=c=>`${pickerTitle(c)} · ${pickerChoices(c).length} baubar`;
export const renderPickerHeading=pickerTitle;
export const renderPickerButton=c=>`<button class="small" data-act="choose-blueprint" data-picker-button>${pickerSummary(c)}</button>`;
// Live refresh of a protected card: only the count changes, focus and drafts stay.
export function updateCannonPicker(card,c) {
  const button=card.querySelector('[data-picker-button]');
  if(button)button.textContent=pickerSummary(c);
}
// What stops a selection before it is tried. The server decides again on the click.
export function buildBlocker(c) {
  const native=c.alignment?.observed?.state;
  if(!c.alignment?.enabled||!c.alignment.binding)return 'Die Kanonen-Position muss zuerst eindeutig erkannt sein.';
  if(!c.schematic?.settings?.enabled)return 'Die automatische Vorbereitung ist ausgeschaltet. Zuerst in den Einstellungen der Kanone aktivieren.';
  if(!c.online)return 'Der Minecraft-Computer ist offline.';
  if(c.options?.paused)return 'Die Materialzufuhr ist pausiert. Vor dem Start wieder aktivieren.';
  if(native==='RUNNING')return 'Die Kanone baut gerade. Ein neuer Bauplan ist erst möglich, wenn sie im Spiel beendet und zurückgesetzt ist.';
  if(native==='PAUSED')return 'Die Kanone ist pausiert. Den Bau fortsetzen oder im Spiel zurücksetzen, bevor ein neuer Bauplan startet.';
  return null;
}
export const isStarted=b=>b.built>0;
export function filterChoices(items,query) {
  const needle=query.trim().toLocaleLowerCase('de');
  return needle?items.filter(b=>`${b.name} ${b.id}`.toLocaleLowerCase('de').includes(needle)):items;
}
const percentText=b=>b.built>0&&b.progress<.1?'Unter 0,1':fmt(b.progress);
function renderChoice(b,{current,disabled,pending,retry}) {
  const native=b.nativeProgress;
  return `<li class="picker-choice">${blueprintPreview(b,{size:'small'})}<div class="picker-choice-body"><p class="picker-choice-title"><strong>${esc(b.name)}</strong> <span class="muted">v${esc(b.version)}</span>${current?' <span class="badge">Aktueller Auftrag</span>':''}</p><div class="bar" role="progressbar" aria-label="Baufortschritt aus Weltabgleich" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b.progress}"><i style="width:${b.progress}%"></i></div><p>${percentText(b)} % gebaut · ${fmt(b.remaining)} Blöcke offen · ${fmt(b.distance)} Blöcke entfernt${b.origin?` · <span class="mono">${esc(b.origin.join(' '))}</span>`:''}</p>${native?`<p class="muted">${esc(nativeProgressLabel(native))}${native.fresh?'':', nicht live'}</p>`:''}</div><button class="primary small" type="button" data-build="${esc(b.id)}" data-version="${esc(b.version)}" aria-label="${esc(b.name)} jetzt vorbereiten und bauen"${disabled?' disabled':''}>${pending?'Startet …':retry?'Erneut versuchen':'Bauen'}</button></li>`;
}
export const choiceKey=b=>`${b.id}:${b.version}`;
export function renderPickerList(c,{query='',disabled=false,pending=null,retry=null}={}) {
  const all=pickerChoices(c),shown=filterChoices(all,query);
  if(!all.length)return `<p class="muted picker-empty">${esc(c.blueprintChoices?.message||'Kein baubarer Bauplan verfügbar.')}</p>`;
  if(!shown.length)return `<p class="muted picker-empty">Kein Bauplan passt zu „${esc(query.trim())}“.</p>`;
  const group=(title,items)=>items.length?`<section class="picker-group"><h3 class="eyebrow">${title} · ${items.length}</h3><ul>${items.map(b=>renderChoice(b,{disabled,pending:pending===choiceKey(b),retry:retry===choiceKey(b),current:b.id===c.blueprint?.id&&b.version===c.blueprint?.version})).join('')}</ul></section>`:'';
  return group('Angefangen',shown.filter(isStarted))+group('Noch nicht begonnen',shown.filter(b=>!isStarted(b)));
}
// The stage says how far the request got, so the text can say what really changed.
export function buildFailure(error) {
  if(!error?.status)return `Verbindung unterbrochen: ${error?.message||'keine Antwort'}. Ob die Kanone gestartet wurde, ist offen. Der Stand wird neu geladen.`;
  const stage=error.data?.stage;
  if(stage==='prepare')return `Bauplan zugewiesen, aber nicht gestartet: ${error.message}`;
  if(stage==='start')return `Bauplan vorbereitet, Start nicht bestätigt: ${error.message}`;
  return `Nichts geändert: ${error.message}`;
}
