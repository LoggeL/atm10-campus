import {esc,fmt} from './format.js?v=20261104-erebor-expansion-1';

export async function showPreparedStone(project,api){
 const target=document.querySelector('#stonePrepared');if(!target)return;
 try{
  const result=await api('/api/projects/'+encodeURIComponent(project.id)+'/stone/prepared?version='+project.version);
  if(!target.isConnected)return;
  if(!result.packages.length){target.innerHTML='';return;}
  const groups=new Map();for(const p of result.packages){if(!groups.has(p.cannon))groups.set(p.cannon,[]);groups.get(p.cannon).push(p);}
  target.innerHTML='<h3>Fertige Pakete auf dem Campus</h3><p>Diese Schematics sind auf dem Server gespeichert und sofort herunterladbar. Jedes ZIP enthält NBT-Dateien, Einsetzkoordinaten und eine Anleitung. Die Mengen gelten für den beim Erstellen gelesenen Weltstand; bei späteren Änderungen stehen unten weiterhin frisch berechnete Exporte bereit.</p>'+[...groups].map(([c,packages])=>{
   const station=project.plan.cannonLayout?.stations.find(s=>s.id===c),count=packages.reduce((n,p)=>n+p.fileCount,0),blocks=packages.reduce((n,p)=>n+p.blocks,0),unknown=packages.reduce((n,p)=>n+p.unknown,0);
   return `<details open><summary><strong>${esc(c)} · ${packages.length} fertige Pakete · ${fmt(count)} Schematics · ${fmt(blocks)} Cleanstone${unknown?' · '+fmt(unknown)+' Abschnitte noch unbekannt':''}</strong></summary><p>Kanonenblock: <strong>${station?station.position.join(' / '):esc(c)}</strong> (X / Y / Z). Pakete der Reihe nach von unten nach oben bauen.</p><div class="project-table"><table><thead><tr><th>Paket</th><th>NBT-Dateien</th><th>Cleanstone</th><th>Höhen der Bauplan-Anker</th><th>Erstellt (Berlin)</th><th>Download</th></tr></thead><tbody>${packages.map(p=>{
    const ys=p.files.map(f=>f.origin[1]),y=ys.length?`Y ${Math.min(...ys)} bis ${Math.max(...ys)}`:'—',date=new Date(p.savedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}),name=`${project.id.toUpperCase()}_STEIN_${c}_PAKET_${String(p.part).padStart(2,'0')}_V${p.version}.zip`;
    return `<tr><td><strong>${esc(c)} · ${String(p.part).padStart(2,'0')}</strong>${p.part===1?' · Start':''}${p.empty?`<br><small>${p.empty} ohne Restfüllung</small>`:''}${p.unknown?`<br><strong>${p.unknown} unbekannte Abschnitte offen</strong>`:''}</td><td>${p.fileCount}</td><td>${fmt(p.blocks)}</td><td>${y}</td><td>${esc(date)}</td><td><a download="${esc(name)}" href="/api/projects/${encodeURIComponent(project.id)}/stone/prepared/${encodeURIComponent(c)}/${p.part}.zip?version=${p.version}">Paket ${String(p.part).padStart(2,'0')} laden</a></td></tr>`;
   }).join('')}</tbody></table></div></details>`;
  }).join('');
 }catch(e){if(target.isConnected)target.textContent='Fertige Pakete konnten nicht geladen werden: '+e.message;}
}
