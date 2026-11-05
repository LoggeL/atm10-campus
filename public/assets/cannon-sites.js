import {esc,fmt} from './format.js?v=20261105-cannon-coordinates-1';

export function cannonSiteRows(project,prepared){
 if(prepared.version!==project.version)throw Error('Der Projektstand wurde geändert. Bitte erneut aktualisieren.');
 return (project.plan.cannonLayout?.stations||[]).filter(s=>Array.isArray(s.position)&&s.position.length===3&&s.position.every(Number.isSafeInteger)).map(s=>{
  const packages=prepared.packages.filter(p=>p.cannon===s.id),[x,y,z]=s.position;
  return {...s,x,y,z,foundationY:y-1,start:s.id===project.plan.cannonLayout.nearEntrance,
   packages:packages.length,files:packages.reduce((n,p)=>n+p.fileCount,0),unknown:packages.reduce((n,p)=>n+p.unknown,0)};
 });
}

export function renderCannonSites(project,prepared){
 const rows=cannonSiteRows(project,prepared),start=rows.find(s=>s.start),id=encodeURIComponent(project.id);
 const position=s=>`X ${s.x} / Y ${s.y} / Z ${s.z}`;
 const map=s=>`/viewer?project=${id}#area=cannon:${encodeURIComponent(s.id)}&pv=cannons`;
 return `<p class="intro">${esc(project.name||'Erebor')} · Projektversion ${esc(project.version)} · ${fmt(rows.length)} geplante Kanonenplätze für die Steinfüllung.</p>
  ${start?`<div class="cannon-site-start"><div><p class="eyebrow">Startplatz · ${esc(start.id)}</p><strong>${position(start)}</strong><p>Fundamentblock: Y${start.foundationY} · ${fmt(start.packages)} Pakete / ${fmt(start.files)} Schematics bereit</p></div><button data-copy-cannon="${start.x} ${start.y} ${start.z}">Kopieren: X / Y / Z</button><a class="btn" href="${map(start)}">${esc(start.id)} auf der Karte</a></div>`:''}
  <p><strong>X / Y / Z bezeichnet den Kanonenblock.</strong> Das Fundament liegt einen Block darunter. Die Einsetzkoordinaten der einzelnen Schematics findest du bei den Bauplänen.</p>
  <p class="muted">Die Plätze sind geplant; diese Liste bestätigt keine bereits aufgestellten Kanonen. „Bereit“ zählt veröffentlichte Steinpakete, keinen Baufortschritt.</p>
  <div class="row"><a class="btn" href="/app?project=${id}#overview">Baupläne öffnen</a><a class="btn" href="/projects?id=${id}#cannon-sites">Projektkarte und Standortdetails</a></div>
  <div class="table-wrap cannon-site-table" role="region" aria-label="Geplante Kanonenkoordinaten" tabindex="0"><table><thead><tr><th>Platz</th><th>X</th><th>Y</th><th>Z</th><th>Fundament Y</th><th>Steinpakete</th><th>Aktion</th></tr></thead><tbody>${rows.map(s=>`<tr${s.start?' class="cannon-site-highlight"':''}><th scope="row">${esc(s.id)}${s.start?' · Start':''}</th><td class="mono">${s.x}</td><td class="mono">${s.y}</td><td class="mono">${s.z}</td><td class="mono">${s.foundationY}</td><td>${s.packages?`${fmt(s.packages)} Pakete · ${fmt(s.files)} Schematics${s.unknown?`<div class="warn">${fmt(s.unknown)} Abschnitte noch unbekannt</div>`:''}`:'Noch keine veröffentlicht'}</td><td><div class="row"><button class="small" data-copy-cannon="${s.x} ${s.y} ${s.z}" aria-label="Koordinaten von ${esc(s.id)} kopieren">Kopieren</button><a class="btn small" href="${map(s)}">Karte</a></div></td></tr>`).join('')}</tbody></table></div>`;
}

export function createCannonSites({api,element,getProject,isActive,notify}){
 let sequence=0;
 element.addEventListener('click',async e=>{
  const button=e.target.closest('[data-copy-cannon]');if(!button)return;
  try{await navigator.clipboard.writeText(button.dataset.copyCannon);notify('Kanonenkoordinaten kopiert: '+button.dataset.copyCannon);}
  catch{notify('Kopieren nicht möglich. Die Koordinaten stehen in der Tabelle.',true);}
 });
 return {async load(){
  const seq=++sequence,selected=getProject();
  if(selected!=='erebor'){
   element.innerHTML='<p>Für den Campus ist kein festes Netz geplanter Kanonenplätze hinterlegt. Die erkannten Positionen eurer verbundenen Kanonen stehen unter <a href="#cannons">Steuerung</a>.</p><p>Wähle oben das Bauprojekt <strong>Erebor</strong>, um dessen Aufstellkoordinaten zu sehen.</p>';
   return;
  }
  try{
   const project=await api('/api/projects/erebor');
   const prepared=await api('/api/projects/erebor/stone/prepared?version='+project.version);
   if(seq!==sequence||getProject()!==selected||!isActive())return;
   const html=renderCannonSites(project,prepared);if(element.innerHTML!==html)element.innerHTML=html;
  }catch(error){
   if(seq===sequence&&getProject()===selected&&isActive())element.innerHTML=`<p role="alert">Aufstellkoordinaten konnten nicht geladen werden: ${esc(error.message)}</p>`;
   throw error;
  }
 }};
}
