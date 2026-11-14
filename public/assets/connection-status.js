import {esc} from './format.js?v=20261114-status-1';

// A computer heartbeat is not proof of a working ME network. Retain the last
// reported fault when stale, but never infer a power/channel cause from offline.
export function connectionIssues(c) {
 const issues=[],s=c.status;
 if(!c.online)issues.push('Computer offline – keine aktuelle Verbindung');
 if(s?.stale)issues.push('Daten veraltet – letzter bekannter Zustand, nicht live');
 if(!s)issues.push('ME-Zustand unbekannt – noch keine Stationsmeldung');
 const n=c.network,age=Date.now()-Number(n?.at);
 const measured=n && age>=0 && age<45000 && !n.stale;
 if(n && !measured)issues.push('Netzdiagnose veraltet oder nicht erreichbar – Stromzustand unbekannt');
 if(measured){
  if(n.loaded===false)issues.push('Chunk ungeladen – Bridge nicht beobachtbar');
  else {
   if(n.powered===false)issues.push('Kein Strom – AE2-Bridge meldet powered=false');
   if(n.channelsSatisfied===false)issues.push('Kanalmangel – AE2-Kanalanforderung nicht erfüllt');
   if(n.booting===true)issues.push('Netz startet – AE2 noch nicht betriebsbereit');
   if(n.error || n.nodePresent===false)issues.push('Netzdiagnose unbekannt – keine auswertbare AE2-Node');
   if(n.online===false && n.powered!==false && n.channelsSatisfied!==false && !n.booting)issues.push('ME-Verbindung offline – Ursache unbekannt');
  }
 }
 const message=String(s?.message||'');
 if(/ME Bridge offline|ME[- ]Verbindung offline/i.test(message) && !(measured && n.powered===false))issues.push('ME-Verbindung offline – Ursache unbekannt (Strom, Kanäle oder Netzstart prüfen)');
 else if(s?.state==='error')issues.push(message||'Stationsfehler – Ursache unbekannt');
 return issues;
}
export function renderConnectionIssues(c) {
 const issues=connectionIssues(c);
 const n=c.network;
 return issues.length?`<div class="notice error connection-fault" role="status"><strong>Versorgung gestört</strong><ul>${issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><small>Computer-Meldung: ${esc(c.status?.at||c.lastSeenAt||'Zeitpunkt unbekannt')}${c.status?.stale?' · nicht live':''}${n?`<br>Netzdiagnose: ${esc(n.source||'nicht verfügbar')} · ${n.at?esc(new Date(n.at).toISOString()):'kein aktueller Zeitpunkt'}${n.position?' · Bridge '+esc(n.position.join(' / ')):''}`:''}</small></div>`:'';
}
export function renderFleetIssues(list) {
 const affected=list.filter(c=>connectionIssues(c).length);
 const n=list.find(c=>c.network?.power)?.network;
 const chain=n && Date.now()-n.at<45000?`<details><summary>Details zur Stromstrecke</summary><p>Quelle: ${esc(n.source)} · ${esc(new Date(n.at).toISOString())}</p><ul>${n.power.map(p=>`<li>${esc(p.block||'Quellposition')} (${esc(p.position.join(' / '))}): ${p.loaded===false?'Chunk ungeladen – aktuellen Speicher-/Generatorzustand nicht messbar':p.powered===false?'AE2 ohne Strom · '+esc(p.storedAE)+' AE gespeichert':'geladen; Energiezustand nicht gemessen'}</li>`).join('')}</ul><p>Quellchunk und angeschlossenen Speicher im Spiel prüfen. Keine automatische Reparatur oder Chunkladung.</p></details>`:'';
 return affected.length?`<div class="notice error connection-fault" role="status"><strong>${affected.length}/${list.length} Stationen mit Verbindungs- oder Versorgungsfehlern</strong><p>Campus erreichbar bedeutet nicht, dass das ME-Netz Strom hat. Stationsfehler bleiben unabhängig vom Bauauftrag sichtbar.</p><ul>${affected.map(c=>`<li><b>${esc(c.name)}</b>: ${connectionIssues(c).map(esc).join(' · ')}</li>`).join('')}</ul>${chain}</div>`:'';
}
