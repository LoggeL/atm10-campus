const labels={stone:'Regulärer Cleanstone',build:'Architektur · Bau',clear:'Aushub'};
const number=n=>Number.isFinite(n)?n.toLocaleString('de-DE'):'unbekannt';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function card(label,row,basis){
 if(!row)return `<article class="card"><h3>${escape(label)}</h3><div class="value">unbekannt</div><small>Noch keine Veröffentlichung nachgewiesen.</small></article>`;
 return `<article class="card"><h3>${escape(label)}</h3><div class="value">${number(row.done)} / ${number(row.total)}</div><small>${basis}</small>${row.total?`<progress aria-label="${escape(label)} erledigt" max="${row.total}" value="${row.done}"></progress>`:''}<small>${number(row.open+row.inProgress)} offen, davon ${number(row.inProgress)} aktiv/zugewiesen</small>${row.total?'':'<small>Kein Katalogeintrag · Zielumfang unbekannt.</small>'}</article>`;
}
function cards(group){return card('Massiv',group.massif,'veröffentlichte Kacheln')+Object.entries(group.stages).map(([s,r])=>card(labels[s]||s,r,'katalogisierte Pläne')).join('');}
let loading=false,telemetryAt=null;
const rate=n=>Number.isFinite(n)?n.toLocaleString('de-DE',{maximumFractionDigits:1}):'unbekannt';
const duration=s=>Number.isFinite(s)?s<60?'< 1 min':s<3600?Math.ceil(s/60)+' min':rate(s/3600)+' h':'unbekannt';
function renderThroughput(t){
 telemetryAt=t?.at??null;
 document.querySelector('#throughput').innerHTML=`<article class="card"><h3>Gemessener Blockdurchsatz</h3><div class="value">${rate(t?.blocksPerSecond)} Blöcke/s</div><small>${rate(t?.blocksPerHour)} Blöcke/h · ${number(t?.covered)} / ${number(t?.assigned)} zugewiesene Kanonen messbar</small><small>Je Kanone: gleiches Upload, positive Zeitdifferenz ≥ 15 s, Fenster bis 5 min. Teilabdeckung ist kein Flotten-Gesamtwert. Keine theoretische Zusage.</small><small>Weltmeldung: ${t?.at?new Date(t.at).toLocaleString('de-DE'):'unbekannt / veraltet'}</small></article><details data-site="rates"><summary>Aktuelle Aufträge · Durchsatz & Restzeit</summary>${(t?.cannons||[]).map(c=>`<article class="card"><strong>${escape(c.station)}</strong><small>${escape(c.file)}</small><small>${rate(c.blocksPerSecond)} Blöcke/s · ${rate(c.blocksPerHour)} /h</small><small>${number(c.delta)} Blöcke in ${rate(c.seconds)} s · ${number(c.remaining)} laut aktuellem Kanonenzähler übrig</small><small>Restzeit aktueller Auftrag: ${duration(c.etaSeconds)}${c.etaSeconds!==null?' bei gleichbleibendem gemessenem Tempo':''}</small></article>`).join('')}</details><small>Keine Gesamtprojekt- oder Massiv-ETA: vergleichbarer verbleibender Blockumfang unbekannt; überlappende Kataloge werden nicht addiert. Auftrags-ETA nur bei übereinstimmendem Plan- und Kanonen-Blockumfang, ohne Aushub; Such-/Wartezeiten können abweichen. Pläne/h nicht belastbar aus dieser kurzen Blockmessung.</small>`;
}
function expireThroughput(){if(telemetryAt!==null&&Date.now()-telemetryAt>=45000)renderThroughput(null);}
setInterval(expireThroughput,1000);
async function refresh(){
 if(loading)return;loading=true;
 const status=document.querySelector('#status');
 try{
  const response=await fetch('/api/projects/erebor/bauzaehler',{cache:'no-store'});
  if(response.status===401){renderThroughput(null);status.innerHTML='Anmeldung abgelaufen. <a href="/login">Bei Campus anmelden</a> und diesen Link erneut öffnen.';status.className='error';return;}
  if(!response.ok)throw Error('HTTP '+response.status);
  const data=await response.json();
  const opened=new Set([...document.querySelectorAll('details[open]')].map(el=>el.dataset.site));
  renderThroughput(data.throughput);expireThroughput();
  if(opened.has('rates'))document.querySelector('#throughput details').open=true;
  document.querySelector('#totals').innerHTML=cards(data);
  document.querySelector('#stations').innerHTML=Object.entries(data.stations).map(([site,row])=>`<details data-site="${escape(site)}" ${opened.has(site)?'open':''}><summary>${escape(site)} · Massiv ${number(row.massif?.done)} / ${number(row.massif?.total)}</summary><div class="grid">${cards(row)}</div></details>`).join('')+`<details data-site="unassigned" ${opened.has('unassigned')?'open':''}><summary>Unzugeordnete Massiv-Kacheln (im Projektzähler enthalten)</summary><div class="grid">${card('Unzugeordnet',data.unassignedMassif,'veröffentlichte Kacheln')}</div></details>`;
  status.className='';status.textContent='Stand '+new Date(data.capturedAt).toLocaleString('de-DE')+' · Version '+data.version+' · Live-Abfrage alle 15 s';
 }catch(error){renderThroughput(null);status.className='error';status.textContent='Aktualisierung fehlgeschlagen – angezeigte Zähler sind veraltet/ungeprüft. '+error.message;}
 finally{loading=false;}
}
document.querySelector('#refresh').addEventListener('click',refresh);
refresh();setInterval(refresh,15000);
