import {validatePlacementDraft} from './erebor-placement-model.js?v=20261125-overhaul-1';

const $=id=>document.getElementById(id);
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const coordinate=pos=>pos?`${pos.x} · ${pos.y} · ${pos.z}`:'Noch nicht festgelegt';
const stages=[['placed','Platziert'],['commissioned','In Betrieb genommen'],['runningObserved','Lauf beobachtet (manuell)']];
let notes={},storageKey;
function save(){
 try{localStorage.setItem(storageKey,JSON.stringify(notes));}
 catch{$('storage-status').textContent='Speichern nicht möglich – Häkchen gelten nur bis zum Neuladen.';}
}
function stationCard(station){
 const blocked=station.readiness==='conditional-not-build-ready';
 const card=element('details',undefined,`station c-card${blocked?' station--blocked':''}`);
 card.dataset.search=`${station.id} ${station.label}`.toLocaleLowerCase('de');
 const summary=element('summary');
 const summaryMain=element('span',undefined,'station-summary-main');
 summaryMain.append(element('span',station.id,'station-id c-mono'),element('span',station.label,'station-label'));
 const summaryRight=element('span',undefined,'station-summary-right');
 const configuredSlots=['A','B','C'].filter(slot=>Boolean(station.cannons[slot]));
 summaryRight.append(
  blocked
   ?element('span','Gesperrt','c-badge c-badge--danger')
   :element('span',configuredSlots.join(' · '),'c-badge c-badge--neutral c-mono')
 );
 summary.append(summaryMain,summaryRight);
 card.append(summary);

 const body=element('div',undefined,'station-body');
 if(blocked){
  const banner=element('div',undefined,'c-notice c-notice--danger placement-blocked');
  banner.append(element('p','GESPERRTER PLANUNGSENTWURF · NICHT BAUFREIGEGEBEN','observation placement-blocked-title'));
  const blockers=element('ul');for(const reason of station.blockers)blockers.append(element('li',reason));banner.append(blockers);
  body.append(banner);
 }
 body.append(element('p',`Dimension: ${station.dimension}`,'placement-dimension'));
 const coordinates=element('dl',undefined,'placement-coordinates');
 const row=(label,value)=>coordinates.append(element('dt',label),element('dd',value));
 for(const [key,label] of [['receiver','Wireless Receiver'],['bridge','ME Bridge'],['computer','Computer'],['chest','Truhe']])row(label,coordinate(station.equipment[key]));
 row('Kabel (jede Blockposition)',station.equipment.cable.length?station.equipment.cable.map(coordinate).join(' / '):'Keine Positionen hinterlegt');
 body.append(coordinates);

 const slots=element('div',undefined,'placement-slots');
 for(const slot of ['A','B','C']){
  const hasPos=Boolean(station.cannons[slot]);
  const section=element('section',undefined,`placement-slot${slot==='A'?' placement-slot--primary':' placement-slot--reserve'}${hasPos?'':' placement-slot--empty'}`);
  const slotHead=element('div',undefined,'placement-slot-head');
  slotHead.append(
   element('h3',`Kanone ${slot}`),
   slot==='A'
    ?element('span','Zunächst vorgesehen','c-badge c-badge--ok')
    :element('span',hasPos?'Reserve':'Reserve · offen','c-badge c-badge--neutral')
  );
  section.append(slotHead,element('p',coordinate(station.cannons[slot]),'coordinate'));
  const checks=element('div',undefined,'placement-checks');
  for(const [flag,label] of stages){
   const key=JSON.stringify([station.id,slot,flag]);
   const wrapper=element('label');const input=element('input');input.type='checkbox';
   input.setAttribute('aria-label',`${slot} · ${label}`);input.checked=notes[key]===true;input.disabled=!station.cannons[slot]||station.readiness==='conditional-not-build-ready';
   input.addEventListener('change',()=>{notes[key]=input.checked;save();});
   wrapper.append(input,document.createTextNode(label));checks.append(wrapper);
  }
  section.append(checks);
  slots.append(section);
 }
 body.append(slots,element('p','Live-Betrieb: unbekannt. Diese Ansicht besitzt keine laufende Telemetrie.','observation c-notice c-notice--info'));
 const metadata=element('details',undefined,'metadata');metadata.append(element('summary','Bekannte Metadaten · nur lesbar'));
 const metaBody=element('div',undefined,'metadata-body');
 if(station.observed){
  const o=station.observed;
  metaBody.append(element('p',`Momentaufnahme: ${o.at} · Quelle: ${o.source}`),element('p',`Computer-ID: ${o.computerId??'unbekannt'}`));
  const list=element('ul');
  for(const block of o.blocks)list.append(element('li',`${coordinate(block.position)} → ${block.blockId}`));
  metaBody.append(list,element('p','Gespeicherte Blockidentitäten bestätigen weder Inbetriebnahme noch aktuellen Lauf.'));
 }else metaBody.append(element('p','Keine unabhängige Beobachtung hinterlegt.'));
 metadata.append(metaBody);
 body.append(metadata);
 card.append(body);
 return card;
}
async function load(){
 try{
  const responses=await Promise.all([fetch('/api/projects/erebor/placement-draft',{cache:'no-store'}),fetch('/api/me',{cache:'no-store'})]);
  if(responses.some(r=>r.status===401)){location.assign('/login');return;}
  if(!responses[0].ok){const error=await responses[0].json();throw Error(error.error||'Plan nicht verfügbar.');}
  if(!responses[1].ok)throw Error('Benutzerzuordnung nicht verfügbar.');
  const plan=validatePlacementDraft(await responses[0].json());const me=await responses[1].json();
  storageKey=JSON.stringify(['campus-placement-manual-v1',me.user.id,plan.planId,plan.revision]);
  try{const stored=JSON.parse(localStorage.getItem(storageKey)||'{}');notes=stored&&typeof stored==='object'&&!Array.isArray(stored)?stored:{};}
  catch{$('storage-status').textContent='Lokale Notizen konnten nicht gelesen werden; neue Häkchen sind noch ungespeichert.';}
  $('plan-status').textContent=`${plan.stations.length} Stationen · Revision ${plan.revision} · ${plan.generatedAt} · Quelle: ${plan.source}`;
  if(plan.planning){
   $('plan-status').classList.add('placement-status--blocked');
   $('plan-status').textContent='GESPERRTER PLANUNGSENTWURF · NICHT BAUFREIGEGEBEN · '+$('plan-status').textContent;
   const scope=element('section',undefined,'c-card placement-scope');scope.append(element('h2','Geltungsbereich · Wiederverwendung zuerst'));
   for(const note of plan.planning.notes)scope.append(element('p',note));$('placement-stations').before(scope);
  }
  $('placement-stations').replaceChildren(...plan.stations.map(stationCard));
  $('search').addEventListener('input',()=>{
   const query=$('search').value.trim().toLocaleLowerCase('de');
   let visibleCount=0;
   for(const card of $('placement-stations').children){
    const match=card.dataset.search.includes(query);
    card.hidden=!match;
    if(match)visibleCount++;
   }
   $('search-empty').hidden=visibleCount>0;
  });
 }catch(error){$('plan-status').textContent='Kein nutzbarer Plan geladen.';$('plan-error').hidden=false;$('plan-error').textContent=error.message;$('search').disabled=true;}
}
load();
