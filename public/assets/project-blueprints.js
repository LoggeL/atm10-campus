import {esc,fmt} from './format.js?v=20261101-select-1';
import {coordinateFields,placementCard,coordinateListText} from './placement.js?v=20261101-select-1';

export function preparedBlueprints(project,packages){
 return packages.flatMap(p=>p.files.map((f,i)=>({...f,id:f.fileName.replace(/\.nbt$/i,''),project:project.id,version:p.version,part:p.part,order:i,savedAt:p.savedAt,sourceRegions:p.sourceRegions,name:`Erebor · ${p.cannon} · Paket ${String(p.part).padStart(2,'0')} · ${f.tile}`,download:`/api/projects/${encodeURIComponent(project.id)}/stone/prepared/${encodeURIComponent(p.cannon)}/${p.part}/${encodeURIComponent(f.tile)}.nbt?version=${p.version}`,packageDownload:`/api/projects/${encodeURIComponent(project.id)}/stone/prepared/${encodeURIComponent(p.cannon)}/${p.part}.zip?version=${p.version}`})));
}
export function filterPreparedBlueprints(items,query,packet=''){
 const q=query.trim().toLocaleLowerCase('de');
 return items.filter(b=>(!packet||b.cannon+':'+b.part===packet)&&(!q||`${b.name} ${b.fileName} ${b.origin.join(' ')}`.toLocaleLowerCase('de').includes(q)));
}
const icon='<img class="material-icon" src="/assets/project-blocks/minecraft__stone.png" width="48" height="48" alt="Cleanstone" loading="lazy">';
const when=t=>new Date(t).toLocaleString('de-DE',{timeZone:'Europe/Berlin'});
export function createProjectBlueprints({api,isSelected,closeDrawer}){
 const $=id=>document.getElementById(id);let items=[],packages=[],version=null;
 function rows(){
  const list=filterPreparedBlueprints(items,$('search').value,$('stonePacket').value);
  $('bpRows').innerHTML=list.map(b=>`<tr class="click" data-stone-id="${esc(b.id)}"><td><div class="blueprint-entry">${icon}<span><button class="text-button blueprint-name">${esc(b.name)}</button><span class="muted mono blueprint-file">${esc(b.fileName)}</span><span class="cell-note">${fmt(b.blocks)} Cleanstone · X ${b.origin[0]} / Y ${b.origin[1]} / Z ${b.origin[2]}</span></span></div></td><td><span class="badge ok">Downloadbereit</span><div class="cell-note">Kanone ${esc(b.cannon)}</div></td><td>v${b.version}</td><td><span class="muted">Nicht ermittelt</span></td><td><button class="text-button" data-stone-id="${esc(b.id)}">Details</button> <a class="btn small" href="${esc(b.download)}" download>NBT laden</a></td></tr>`).join('')||'<tr><td colspan="5">Keine passenden Erebor-Schematics. Suche oder Paketfilter ändern.</td></tr>';
  $('stoneBlueprintCount').textContent=`${list.length} von ${items.length} Erebor-Schematics · Fortschritt wird für diese gespeicherten Dateien nicht ausgewiesen.`;
 }
 function coordinates(){
  const list=filterPreparedBlueprints(items,$('coordinateSearch').value);
  $('coordinateCount').textContent=`${list.length} von ${items.length} Erebor-Schematics · Projektversion ${version}`;
  $('coordinateRows').innerHTML=list.map(b=>`<tr><td><button class="text-button blueprint-entry" data-stone-id="${esc(b.id)}">${icon}<span><span class="blueprint-name">${esc(b.name)}</span><span class="muted mono blueprint-file">${esc(b.fileName)}</span></span></button></td><td>v${b.version}</td><td>${coordinateFields(b)}</td><td><button class="small" data-copy-coordinate="${b.origin.join(' ')}">X Y Z kopieren</button> <a class="btn small" href="${esc(b.download)}" download>NBT laden</a></td></tr>`).join('');
 }
 function details(id){
  const b=items.find(b=>b.id===id);if(!b)return;
  const drawer=$('drawer');drawer.innerHTML=`<div class="drawer-heading"><div><h2 id="blueprintTitle">${esc(b.name)}</h2><div class="muted mono">${esc(b.fileName)}</div></div><button class="small" id="dClose">Schließen</button></div><div class="row"><span class="badge ok">Downloadbereit</span><a class="btn primary" href="${esc(b.download)}" download>NBT herunterladen</a><a class="btn small" href="${esc(b.packageDownload)}" download>Ganzes Paket ${String(b.part).padStart(2,'0')}</a></div>${placementCard(b)}<dl class="kv"><dt>Kanonenplatz</dt><dd><strong>${esc(b.cannon)} · ${b.cannonPosition.join(' / ')}</strong> (X / Y / Z)<br><a href="/projects?id=erebor#cannon-sites">Kanonenstandorte ansehen</a></dd><dt>Größe X / Y / Z</dt><dd>${b.size.join(' × ')} Blöcke</dd><dt>Material</dt><dd><div class="material-label">${icon}<span><strong>${fmt(b.blocks)} Cleanstone</strong><br><span class="mono">minecraft:stone</span></span></div></dd><dt>Gespeichert</dt><dd>${esc(when(b.savedAt))} (Berlin)</dd><dt>Fortschritt</dt><dd>Nicht ermittelt. Die Datei enthält die beim Erstellen noch fehlende Steinfüllung.</dd></dl><p><strong>Kanone: Don't Replace Solid Blocks · Block-Entities ersetzen AUS.</strong></p><p class="muted">Feste Bestandsblöcke und Schutzbereiche wurden beim Erstellen ausgespart. Spätere Weltänderungen sind in dieser gespeicherten Datei nicht enthalten.</p><details><summary>Verwendeter Weltstand</summary><ul>${b.sourceRegions.map(r=>`<li>Region ${r.region.join(' / ')} · gespeichert ${r.savedAt?esc(when(r.savedAt)):'unbekannt'}</li>`).join('')}</ul></details>`;
  drawer.classList.add('open');if(!drawer.open)drawer.showModal();$('dClose').onclick=closeDrawer;$('dClose').focus();
 }
 document.addEventListener('click',e=>{if(!isSelected()||e.target.closest('a,[data-copy-coordinate]'))return;const row=e.target.closest('[data-stone-id]');if(row)details(row.dataset.stoneId);});
 return {
  async load(){
   const project=await api('/api/projects/erebor'),prepared=await api('/api/projects/erebor/stone/prepared?version='+project.version);
   if(!isSelected())return;
   items=preparedBlueprints(project,prepared.packages);packages=prepared.packages;version=project.version;
   $('liveLine').textContent='Erebor: gespeicherte Schematics. Erstellungs- und Weltstand stehen in den Details; kein aktueller Baufortschritt.';
   const previous=$('stonePacket').value;$('stonePacket').innerHTML='<option value="">Alle Pakete</option>'+packages.map(p=>`<option value="${esc(p.cannon+':'+p.part)}">${esc(p.cannon)} · Paket ${String(p.part).padStart(2,'0')} (${p.fileCount} Schematics)</option>`).join('');if(packages.some(p=>p.cannon+':'+p.part===previous))$('stonePacket').value=previous;
   $('cards').innerHTML=`<span><b>${fmt(items.length)}</b> Erebor-Baupläne</span><span><b>${packages.length}</b> Pakete</span><span><b>${fmt(items.reduce((n,b)=>n+b.blocks,0))}</b> Cleanstone</span><span><b>${new Set(items.map(b=>b.cannon)).size}</b> Kanonenplätze</span>`;
   rows();coordinates();
  },rows,coordinates,
  coordinateText:()=>coordinateListText(items).replace('ATM10 Campus – Einsetzkoordinaten der aktuellen Baupläne','Erebor – Einsetzkoordinaten der gespeicherten Schematics'),
 };
}
