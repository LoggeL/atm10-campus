import {esc,fmt} from './format.js?v=20261105-cannon-coordinates-1';

export function cannonSiteRows(project,prepared){
 if(prepared.version!==project.version)throw Error('Der Projektstand wurde geändert. Bitte erneut aktualisieren.');
 return (project.plan.cannonLayout?.stations||[]).filter(s=>Array.isArray(s.position)&&s.position.length===3&&s.position.every(Number.isSafeInteger)).map(s=>{
  const packages=prepared.packages.filter(p=>p.cannon===s.id),[x,y,z]=s.position;
  return {...s,x,y,z,foundationY:y-1,start:s.id===project.plan.cannonLayout.nearEntrance,
   packages:packages.length,files:packages.reduce((n,p)=>n+p.fileCount,0),unknown:packages.reduce((n,p)=>n+p.unknown,0)};
 });
}

export function renderCannonSites(project,prepared,progress={}){
 const rows=cannonSiteRows(project,prepared),start=rows.find(s=>s.start),id=encodeURIComponent(project.id);
 const position=s=>`X ${s.x} / Y ${s.y} / Z ${s.z}`;
 const map=s=>`/viewer?project=${id}#area=cannon:${encodeURIComponent(s.id)}&pv=cannons`;
 const state = s => progress[s.id] || {placed:false,ready:false,version:0};
 const checkboxes = s => {
  const {placed,ready,version}=state(s);
  return `<div class="cannon-checks" data-site="${esc(s.id)}" data-revision="${version}" data-project-version="${project.version}"><label><input type="checkbox" data-placed ${placed?'checked':''} aria-label="${esc(s.id)} aufgestellt">Aufgestellt</label><label><input type="checkbox" data-ready ${ready?'checked':''} ${placed?'':'disabled'} aria-label="${esc(s.id)} betriebsbereit">Betriebsbereit</label></div>`;
 };
 return `<p class="intro">${esc(project.name||'Erebor')} · Projektversion ${esc(project.version)} · ${fmt(rows.length)} geplante Kanonenplätze für die Steinfüllung.</p>
  ${start?`<div class="cannon-site-start"><div><p class="eyebrow">Startplatz · ${esc(start.id)}</p><strong>${position(start)}</strong><p>Fundamentblock: Y${start.foundationY} · ${fmt(start.packages)} Pakete / ${fmt(start.files)} Schematics bereit</p></div><button data-copy-cannon="${start.x} ${start.y} ${start.z}">Kopieren: X / Y / Z</button><a class="btn" href="${map(start)}">${esc(start.id)} auf der Karte</a></div>`:''}
  <p><strong>X / Y / Z bezeichnet den Kanonenblock.</strong> Das Fundament liegt einen Block darunter. Die Einsetzkoordinaten der einzelnen Schematics findest du bei den Bauplänen.</p>
  <p class="muted">${rows.filter(s=>state(s).placed).length} von ${rows.length} aufgestellt · ${rows.filter(s=>state(s).ready).length} betriebsbereit. Die Häkchen pflegt ihr gemeinsam.</p>
  <div class="row"><a class="btn" href="/app?project=${id}#overview">Baupläne öffnen</a><a class="btn" href="/projects?id=${id}#cannon-sites">Projektkarte und Standortdetails</a></div>
  <div class="table-wrap cannon-site-table" role="region" aria-label="Geplante Kanonenkoordinaten" tabindex="0"><table><thead><tr><th>Platz</th><th>X</th><th>Y</th><th>Z</th><th>Fundament Y</th><th>Status</th><th>Steinpakete</th><th>Aktion</th></tr></thead><tbody>${rows.map(s=>`<tr${s.start?' class="cannon-site-highlight"':''}><th scope="row">${esc(s.id)}${s.start?' · Start':''}</th><td class="mono">${s.x}</td><td class="mono">${s.y}</td><td class="mono">${s.z}</td><td class="mono">${s.foundationY}</td><td>${checkboxes(s)}</td><td>${s.packages?`${fmt(s.packages)} Pakete · ${fmt(s.files)} Schematics${s.unknown?`<div class="warn">${fmt(s.unknown)} Abschnitte noch unbekannt</div>`:''}`:'Noch keine veröffentlicht'}</td><td><div class="row"><button class="small" data-copy-cannon="${s.x} ${s.y} ${s.z}" aria-label="Koordinaten von ${esc(s.id)} kopieren">Kopieren</button><a class="btn small" href="${map(s)}">Karte</a></div></td></tr>`).join('')}</tbody></table></div>`;
}

export function createCannonSites({api,element,getProject,isActive,notify}){
 let sequence=0, saving=false;
 element.addEventListener('change',async event=>{
  const input=event.target, cell=input.closest('[data-site]');
  if(!cell || saving || !isActive())return;
  saving=true;
  ++sequence;
  const project=getProject(), placed=cell.querySelector('[data-placed]').checked;
  const ready=placed && cell.querySelector('[data-ready]').checked;
  element.querySelectorAll('[data-site] input').forEach(box=>box.disabled=true);
  try{
   await api('/api/projects/'+encodeURIComponent(project)+'/cannon-sites/'+encodeURIComponent(cell.dataset.site)+'/status',{
    method:'PUT',body:{projectVersion:Number(cell.dataset.projectVersion),baseVersion:Number(cell.dataset.revision),placed,ready}
   });
   notify(cell.dataset.site+' gespeichert.');
  }catch(error){notify(error.message,true);}
  finally{
   saving=false;
   if(isActive())await load().catch(error=>notify(error.message,true));
  }
 });
 element.addEventListener('click',async e=>{
  const button=e.target.closest('[data-copy-cannon]');if(!button)return;
  try{await navigator.clipboard.writeText(button.dataset.copyCannon);notify('Kanonenkoordinaten kopiert: '+button.dataset.copyCannon);}
  catch{notify('Kopieren nicht möglich. Die Koordinaten stehen in der Tabelle.',true);}
 });
 async function load(){
  if(saving)return;
  const seq=++sequence,selected=getProject();
  if(selected!=='erebor'){
   element.innerHTML='<p>Für den Campus ist kein festes Netz geplanter Kanonenplätze hinterlegt. Die erkannten Positionen eurer verbundenen Kanonen stehen unter <a href="#cannons">Steuerung</a>.</p><p>Wähle oben das Bauprojekt <strong>Erebor</strong>, um dessen Aufstellkoordinaten zu sehen.</p>';
   return;
  }
  try{
   const project=await api('/api/projects/erebor');
   const [prepared,progress]=await Promise.all([api('/api/projects/erebor/stone/prepared?version='+project.version),api('/api/projects/erebor/cannon-sites/status')]);
   if(seq!==sequence||getProject()!==selected||!isActive())return;
   if(progress.projectVersion!==project.version)throw Error('Der Projektstand wurde geändert. Bitte erneut aktualisieren.');
   const html=renderCannonSites(project,prepared,progress.sites);if(element.innerHTML!==html)element.innerHTML=html;
  }catch(error){
   if(seq===sequence&&getProject()===selected&&isActive())element.innerHTML=`<p role="alert">Aufstellkoordinaten konnten nicht geladen werden: ${esc(error.message)}</p>`;
   throw error;
  }
 }
 return {load};
}
