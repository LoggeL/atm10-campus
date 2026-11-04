import {esc,fmt} from './format.js?v=20261104-erebor-expansion-1';
import {STONE_BATCH_SIZE} from './stone-placement.js?v=20261104-erebor-expansion-1';
import {showPreparedStone} from './prepared-stone-ui.js?v=20261104-erebor-expansion-1';

const $=s=>document.querySelector(s);
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
export function installStoneControls(project,api,selectCannon){
 showPreparedStone(project,api);
 let manifest=null,busy=false;
 const endpoint='/api/projects/'+encodeURIComponent(project.id)+'/stone/';
 const stationOptions=project.plan.cannonLayout?.stations||[];
 async function load(){
  const button=$('#loadStone');button.disabled=true;manifest=null;$('#stoneStatus').textContent='Abschnitte und Kanonenplätze werden geladen …';
  try {
   manifest=await api(endpoint+'manifest?version='+project.version);
   const ys=[...new Set(manifest.tiles.map(t=>t.origin[1]))].sort((a,b)=>a-b);
   $('#stoneStatus').textContent=fmt(manifest.tiles.length)+' geplante Abschnitte. Die tatsächliche Steinmenge wird beim Export gegen die gespeicherte Welt ermittelt.';
   $('#stoneList').innerHTML=`<div class="map-tools"><label>Kanonenplatz <select id="stoneCannon"><option value="">Alle Standorte</option>${stationOptions.map(c=>`<option value="${esc(c.id)}">${esc(c.id)} · ${c.position.join(' / ')}</option>`).join('')}</select></label><label>Paket <select id="stonePart"></select></label><label>Unterkante <select id="stoneY"><option value="">Alle Höhen</option>${ys.map(y=>`<option value="${y}">Y ${y} bis ${Math.min(y+15,312)}</option>`).join('')}</select></label><label>Abschnitt suchen <input id="stoneSearch" placeholder="z. B. X27_Z15 oder -986"></label></div><div class="row" style="margin-top:14px"><button id="stoneBatch" class="primary">Gewähltes Paket herunterladen</button><button id="stoneCsv">Alle Einsetzkoordinaten als CSV</button></div><p id="stoneCount" class="muted"></p><div class="project-table"><table><thead><tr><th>Schematic / Datei</th><th>X / Y / Z · Bauplan-Anker</th><th>Größe X/Y/Z</th><th>Kanonenplatz</th><th>Download</th></tr></thead><tbody id="stoneRows"></tbody></table></div>`;
   $('#stoneCannon').value=project.plan.cannonLayout?.nearEntrance||'';
   const parts=()=>{const c=$('#stoneCannon').value,n=manifest.tiles.filter(t=>!c||t.cannon?.id===c).length;$('#stonePart').innerHTML='<option value="">Alle Abschnitte</option>'+(c?Array.from({length:Math.ceil(n/STONE_BATCH_SIZE)},(_,i)=>`<option value="${i+1}">${String(i+1).padStart(2,'0')} · Abschnitte ${i*STONE_BATCH_SIZE+1}–${Math.min((i+1)*STONE_BATCH_SIZE,n)}</option>`).join(''):'');$('#stonePart').value=c?'1':'';rows();};
   $('#stoneCannon').onchange=parts;$('#stonePart').onchange=rows;$('#stoneY').onchange=rows;$('#stoneSearch').oninput=rows;
   $('#stoneBatch').onclick=()=>batch($('#stoneCannon').value,Number($('#stonePart').value));
   $('#stoneCsv').onclick=()=>{const lines=['Datei;Anker_X;Anker_Y;Anker_Z;Breite;Hoehe;Tiefe;Drehung;Spiegelung;Kanone;Kanone_X;Kanone_Y;Kanone_Z;Abstand',...manifest.tiles.map(t=>{const c=t.cannon;return [t.fileName,...t.origin,...t.size,'NONE','NONE',c?.id||'',...(c?.position||['','','']),c?c.distance.toFixed(3):''].join(';');})];download(new Blob([String.fromCharCode(65279)+lines.join(String.fromCharCode(13,10))],{type:'text/csv;charset=utf-8'}),'Erebor-Stein-Koordinaten-V'+project.version+'.csv');};parts();
  }catch(e){$('#stoneStatus').textContent=e.message;}finally{button.disabled=false;}
 }
 async function batch(cannon,part){
  if(busy||!/^K[0-9]{2}$/.test(cannon)||!Number.isSafeInteger(part)||part<1)return;
  busy=true;const buttons=[$('#startStone'),$('#stoneBatch')].filter(Boolean);buttons.forEach(b=>b.disabled=true);
  $('#stoneStatus').textContent=`${cannon} · Paket ${part}: gespeicherte Luft und Wasser prüfen, Schematics erzeugen …`;
  try{const r=await fetch(`${endpoint}batch.zip?version=${project.version}&cannon=${cannon}&part=${part}`);if(!r.ok){const e=await r.json();throw Error(e.error||'Paketexport fehlgeschlagen.');}
   const n=Number(r.headers.get('X-Campus-Schematic-Count')),blocks=Number(r.headers.get('X-Campus-Stone-Blocks')),skip=Number(r.headers.get('X-Campus-Skipped-Tiles')),unknown=Number(r.headers.get('X-Campus-Unknown-Tiles'));
   download(await r.blob(),`${project.id.toUpperCase()}_STEIN_${cannon}_PAKET_${String(part).padStart(2,'0')}_V${project.version}.zip`);
   $('#stoneStatus').textContent=`${cannon} · Paket ${part}: ${n} fertige NBT-Dateien, ${fmt(blocks)} Cleanstone. ${skip-unknown} Abschnitte ohne Restfüllung ausgelassen, ${unknown} wegen unbekannter Chunks offen. ZIP enthält Koordinaten und Anleitung. Untere Schichten zuerst bauen.`;
  }catch(e){$('#stoneStatus').textContent=e.message;}finally{busy=false;buttons.forEach(b=>b.disabled=false);if($('#stoneCannon'))$('#stoneBatch').disabled=!$('#stoneCannon').value||!$('#stonePart').value;}
 }
 function rows(){
  const q=$('#stoneSearch').value.trim().toLowerCase(),y=$('#stoneY').value,c=$('#stoneCannon').value,part=Number($('#stonePart').value);
  let all=manifest.tiles.filter(t=>!c||t.cannon?.id===c);if(part)all=all.slice((part-1)*STONE_BATCH_SIZE,part*STONE_BATCH_SIZE);
  all=all.filter(t=>(y===''||t.origin[1]===Number(y))&&(!q||(t.id+' '+t.origin.join(' ')).toLowerCase().includes(q)));
  $('#stoneBatch').disabled=busy||!c||!part;
  $('#stoneCount').textContent=`${all.length} passende Abschnitte; ${Math.min(60,all.length)} angezeigt. Das ZIP umfasst das gesamte gewählte Paket, unabhängig von Suche und Höhenfilter. Leere Abschnitte entfallen beim Export.`;
  $('#stoneRows').innerHTML=all.slice(0,60).map(t=>`<tr><td><strong>${esc(t.id)}</strong><br><small>${esc(t.fileName)}</small></td><td class="mono">${t.origin.join(' / ')}</td><td>${t.size.join(' × ')}</td><td>${t.cannon?`<button data-stone-cannon="${esc(t.cannon.id)}">${esc(t.cannon.id)} ↗ Karte</button><br><small>${t.cannon.position.join(' / ')}</small>`:'—'}</td><td><button data-stone="${esc(t.id)}">NBT laden</button></td></tr>`).join('');
  for(const b of document.querySelectorAll('[data-stone-cannon]'))b.onclick=()=>selectCannon(b.dataset.stoneCannon,true);
  for(const b of document.querySelectorAll('[data-stone]'))b.onclick=async()=>{b.disabled=true;$('#stoneStatus').textContent='Gespeicherten Weltstand prüfen und NBT erzeugen …';try{const t=manifest.tiles.find(t=>t.id===b.dataset.stone),r=await fetch(endpoint+t.id+'.nbt?version='+project.version);if(!r.ok){const e=await r.json();throw Error(e.error||'Download fehlgeschlagen.');}download(await r.blob(),t.fileName);$('#stoneStatus').textContent=`${t.cannon?.id||''} · ${t.id}: ${fmt(r.headers.get('X-Campus-Stone-Blocks'))} Cleanstone. Bauplan-Anker siehe Tabellenzeile.`;}catch(e){$('#stoneStatus').textContent=e.message;}finally{b.disabled=false;}};
 }
 $('#loadStone')?.addEventListener('click',load);
 $('#startStone')?.addEventListener('click',async()=>{if(busy)return;$('#startStone').disabled=true;await load();if(manifest)await batch(project.plan.cannonLayout.nearEntrance,1);else $('#startStone').disabled=false;});
}
export function buildingModsHtml(b){
 const url=v=>{try{const u=new URL(v);return u.protocol==='https:'?u.href:'#';}catch{return '#';}};
 return `<p>${esc(b.summary)}</p><p class="muted">Lokal geprüft: ${esc(b.pack)}. Die Auswahl beschreibt den vorgesehenen Einsatz für Erebor.</p><div class="project-table"><table><thead><tr><th>Mod / installierte Version</th><th>Einsatz für Erebor</th><th>Herstellung / Einbau</th></tr></thead><tbody>${b.mods.map(m=>`<tr><td><a href="${esc(url(m.source))}" target="_blank" rel="noopener noreferrer">${esc(m.name)}</a><br><small>${esc(m.version)}</small></td><td>${esc(m.use)}</td><td>${esc(m.notes)}</td></tr>`).join('')}</tbody></table></div><ul>${b.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ul>`;
}
