import {esc,fmt} from './format.js?v=20261105-cannon-coordinates-1';
import {coordinateFields,placementCard,coordinateListText} from './placement.js?v=20261105-cannon-coordinates-1';
import {blueprintPreview} from './blueprint-preview.js?v=20261105-cannon-coordinates-1';

export function preparedBlueprints(project,packages){
 return packages.flatMap(p=>p.files.map((f,i)=>({...f,id:f.fileName.replace(/\.nbt$/i,''),project:project.id,version:p.version,part:p.part,order:i,savedAt:p.savedAt,sourceRegions:p.sourceRegions,name:`Erebor · ${p.cannon} · Paket ${String(p.part).padStart(2,'0')} · ${f.tile}`,download:`/api/projects/${encodeURIComponent(project.id)}/stone/prepared/${encodeURIComponent(p.cannon)}/${p.part}/${encodeURIComponent(f.tile)}.nbt?version=${p.version}`,packageDownload:`/api/projects/${encodeURIComponent(project.id)}/stone/prepared/${encodeURIComponent(p.cannon)}/${p.part}.zip?version=${p.version}`})));
}
export function filterPreparedBlueprints(items,query,packet=''){
 const q=query.trim().toLocaleLowerCase('de');
 return items.filter(b=>(!packet||(b.packet||b.cannon+':'+b.part)===packet)&&(!q||`${b.name} ${b.fileName} ${b.origin.join(' ')}`.toLocaleLowerCase('de').includes(q)));
}
export function architectureBlueprints(project,packages){return packages.flatMap(p=>p.files.map(f=>({...f,project:project.id,version:p.version,revision:p.revision,part:p.id,packet:'architecture:'+p.group,savedAt:p.savedAt,sourceRegions:p.sourceRegions,name:`${f.kind==='clear'?'Aushub':'Bau'} · ${p.title} · ${f.cannon} · Y${f.origin[1]}`,download:`/api/projects/${project.id}/architecture/${p.id}/${f.id}.nbt?version=${p.version}&revision=${p.revision}`,packageDownload:`/api/projects/${project.id}/architecture/${p.id}.zip?version=${p.version}&revision=${p.revision}`})));}
export const projectBlueprintPreview=(b,options={})=>blueprintPreview(b,{...options,source:b.download.replace(/\.nbt\?/, '/preview.png?')});
const when=t=>new Date(t).toLocaleString('de-DE',{timeZone:'Europe/Berlin'});
export function createProjectBlueprints({api,isSelected,closeDrawer,loadedStatus=()=>null,admin=()=>false,loadPlan,notify,getSite=()=>null,getQueue=()=>null,getView=()=>"open",getStation=()=>null,promote}){
 const $=id=>document.getElementById(id);let items=[],packages=[],version=null,limit=150,catalog={},catalogAt=0;
 let renderKey='';
 const materialList=b=>Object.entries(b.materials||{'minecraft:stone':b.blocks}).sort((a,b)=>b[1]-a[1]).map(([name,n])=>{const c=catalog[name]||{icon:'/assets/erebor-palette/'+name.replace(':','__')+'.png'};return `<div class="material-label">${c?.icon?`<img class="material-icon" width="36" height="36" src="${esc(c.icon)}" alt="" loading="lazy">`:''}<span><strong>${fmt(n)} ${esc(c?.name||name.split(':')[1].replaceAll('_',' '))}</strong>${name.endsWith('_connecting')?' · <strong>Connecting</strong>':''}<br><span class="muted mono">${esc(name)}</span></span></div>`;}).join('');
 const byId=new Map(),submitting=new Set();
 function loadButton(b){
  const supported=/^K[0-9]{2}$/.test(b.cannon);
  const hint=!supported?'Für diese Plattform wurde noch keine Kanone bestätigt.':!admin()?'Zum Einlegen als Admin anmelden.':'In '+b.cannon+' einlegen';
  return `<button type="button" class="small" data-load-plan="${esc(b.id)}" title="${esc(hint)}" ${admin()&&supported?'':'disabled'}>Bauplan laden</button> <span class="cell-note" data-load-state="${esc(b.id)}" aria-live="polite"></span>`;
 }
 function updateLoadStates(){
  for(const el of document.querySelectorAll('[data-load-state]')){
   const b=byId.get(el.dataset.loadState);if(!b)continue;
   const value=submitting.has(b.id)?'Wird angefordert …':loadedStatus(b.fileName,b.sha256)||'';
   if(el.textContent!==value)el.textContent=value;
  }
 }
 async function selectPlan(b){
  if(!b||!admin()||submitting.has(b.id))return;
  submitting.add(b.id);updateLoadStates();
  try{const receipt=await loadPlan(b,version);notify(receipt.status==='loaded'?b.cannon+' hat diesen Bauplan schon eingelegt.':b.cannon+' hat die Ladeanforderung erhalten.');}
  catch(e){notify(e.message,true);}finally{submitting.delete(b.id);updateLoadStates();}
 }
 function rows(){
  const queue=getQueue(),station=getStation(),doneView=getView()==='done';
  if(!queue){$('bpRows').innerHTML='<tr><td colspan="5">Baufolge wird geladen …</td></tr>';$('stoneBlueprintCount').textContent='';return;}
  const order=doneView?queue.done.slice().sort((a,b)=>(b.at||'').localeCompare(a.at||'' )).map(r=>r.name):[...new Set([station?.file,...queue.pending].filter(Boolean))];
  const dates=new Map(queue.done.map(r=>[r.name,r.at]));
  const preferred=new Set(queue.preferred),search=$('search').value.trim().toLowerCase();
  const list=order.map((id,index)=>({id,index,b:byId.get(id)})).filter(({id,b})=>!search||(id+' '+(b?.name||'')+' '+(b?.origin||[]).join(' ')).toLowerCase().includes(search));
  $('bpRows').innerHTML=list.slice(0,limit).map(({id,index,b})=>{
   const current=station?.file===id&&!doneView,number=queue.pending.indexOf(id)+1;
   const state=doneView?'Erledigt':current?(loadedStatus(id+'.nbt',b?.sha256)||'Eingelegt'):preferred.has(id)?'Vorgezogen':number===1?'Als Nächstes':'Offen';
   const progress=doneView?(dates.get(id)?when(dates.get(id)):'Abgeschlossen'):current&&station.live?fmt(station.live.placed)+' / '+fmt(station.blocks):'Offen';
   const count=b?.blocks==null?'':fmt(b.blocks)+' '+(b.kind==='clear'?'Luftzellen':'Blöcke');
   const priority=b&&!doneView&&!current&&number>1&&admin()?`<button class="small" data-promote="${esc(id)}">Vorziehen</button>`:'';
   const load=b&&!doneView&&!current&&!station?.automatic?loadButton(b):'';
   const links=b?`<button class="text-button" data-stone-id="${esc(id)}">Details</button> <a class="btn small" href="${esc(b.download)}" download>NBT</a>`:'';
   return `<tr class="click" data-stone-id="${esc(id)}"><td><div class="blueprint-entry">${b?projectBlueprintPreview(b):''}<span><button class="text-button blueprint-name">${esc(b?.name||id)}</button><span class="muted mono blueprint-file">${esc(id)}.nbt</span><span class="cell-note">${esc(count)}</span></span></div></td><td><span class="badge ${doneView?'ok':current?'warn':''}">${esc(state)}</span>${number&&!doneView?`<div class="cell-note">Platz ${number}</div>`:''}</td><td>${b?(b.revision?'R'+b.revision:'v'+b.version):''}</td><td>${esc(progress)}</td><td>${priority} ${load} ${links}</td></tr>`;
  }).join('')||'<tr><td colspan="5">'+(search?'Keine passenden Abschnitte.':doneView?'Noch kein bestätigter Abschluss.':'Alle veröffentlichten Abschnitte sind abgearbeitet.')+'</td></tr>';
  $('stoneBlueprintCount').innerHTML=`${fmt(list.length)} ${doneView?'erledigte Abschnitte':'Abschnitte in der Baufolge'} · ${esc(getSite())} ${list.length>limit?'<button class="small" id="moreErebor">Weitere 150 anzeigen</button>':''}`;
  if($('moreErebor'))$('moreErebor').onclick=()=>{limit+=150;rows();};
 }
 function refreshQueue(){
  const q=getQueue(),s=getStation();
  const key=JSON.stringify([getView(),q,s?.file,s?.automatic,s?.live?.state,s?.live?.status]);
  if(key!==renderKey){renderKey=key;rows();}
  else if(s?.file&&s.live&&getView()==='open'){
   const row=$('bpRows').querySelector('tr[data-stone-id="'+CSS.escape(s.file)+'"]');
   if(row)row.cells[3].textContent=fmt(s.live.placed)+' / '+fmt(s.blocks);
  }
  updateLoadStates();
 }
 function coordinates(){const list=filterPreparedBlueprints(items,$('coordinateSearch').value).filter(b=>b.kind!=='clear');$('coordinateCount').textContent=`${Math.min(300,list.length)} von ${list.length} Bauplänen · bei vielen Treffern nach Bauteil oder Dateiname suchen. Aushub nutzt denselben Anker wie BAU.`;$('coordinateRows').innerHTML=list.slice(0,300).map(b=>`<tr><td><button class="text-button blueprint-entry" data-stone-id="${esc(b.id)}">${projectBlueprintPreview(b)}<span><span class="blueprint-name">${esc(b.name)}</span><span class="muted mono blueprint-file">${esc(b.fileName)}</span></span></button></td><td>${b.revision?'R'+b.revision:'v'+b.version}</td><td>${coordinateFields(b)}</td><td>${loadButton(b)} <button class="small" data-copy-coordinate="${b.origin.join(' ')}">X Y Z kopieren</button> <a class="btn small" href="${esc(b.download)}" download>NBT laden</a></td></tr>`).join('');updateLoadStates();}
 function details(id){const b=items.find(b=>b.id===id);if(!b)return;const architecture=!!b.kind;
  const settings=b.kind==='clear'?'AUSHUB zuerst: Replace Solid with Empty · Protect Block Entities EIN. Entfernt Blöcke ohne Erstattung. Nur vor dem Neubau verwenden.':b.kind==='build'?'BAU: Replace Solid with Any · Protect Block Entities EIN. Nicht beteiligte Zellen sind structure_void.':"Don't Replace Solid Blocks · Block-Entities ersetzen AUS.";
  const drawer=$('drawer');drawer.innerHTML=`<div class="drawer-heading"><div><h2 id="blueprintTitle">${esc(b.name)}</h2><div class="muted mono">${esc(b.fileName)}</div></div><button class="small" id="dClose">Schließen</button></div>${projectBlueprintPreview(b,{size:"large",eager:true})}<div class="row">${loadButton(b)} <a class="btn" href="${esc(b.download)}" download>NBT herunterladen</a><a class="btn small" href="${esc(b.packageDownload)}" download>Paket als ZIP</a>${architecture?`<a class="btn small" href="/viewer?project=erebor&room=${esc(b.group)}">Blockvorschau</a>`:''}</div>${placementCard(b)}<dl class="kv"><dt>Kanonenplatz</dt><dd><strong>${esc(b.cannon)} · ${b.cannonPosition.join(' / ')}</strong> (X / Y / Z)<br>${b.cannon.startsWith('A')?'Provisorische Plattform: Kanone Y96, Stützblock Y95. Platz vor Ort freihalten.':`<a href="/viewer?project=erebor#area=cannon:${esc(b.cannon)}&pv=cannons">Kanonenplatz im 3D-Viewer</a>`}</dd><dt>Größe X / Y / Z</dt><dd>${b.size.join(' × ')} Blöcke</dd><dt>Material</dt><dd>${b.kind==='clear'?`${fmt(b.blocks)} ausdrücklich geplante Luftzellen; kein Baumaterial.`:materialList(b)}</dd><dt>Gespeichert</dt><dd>${esc(when(b.savedAt))} (Berlin)</dd><dt>Fortschritt</dt><dd>${esc(loadedStatus(b.fileName,b.sha256)||'Offen')}</dd>${architecture?`<dt>Bestandsabgleich</dt><dd>${fmt(b.protectedCells)} Zielzellen ausgespart. ${fmt(b.unknownCells)} Zielzellen in unbekannten Chunks; davon ${fmt(b.clearOmitted)} Aushubzellen nicht freigegeben.</dd>`:''}</dl><p><strong>${settings}</strong></p>${architecture?'<p>Reihenfolge: Steinfüllung → Aushub → BAU von unten nach oben. Wasser/Lava zuletzt von Hand in abgedichtete Becken. Keine automatische Maschinenanlage enthalten.</p>':''}<details><summary>Verwendeter Weltstand</summary><ul>${(b.sourceRegions||[]).map(r=>`<li>Region ${r.region.join(' / ')} · gespeichert ${r.savedAt?esc(when(r.savedAt)):'unbekannt'}</li>`).join('')}</ul></details>`;updateLoadStates();drawer.classList.add('open');if(!drawer.open)drawer.showModal();$('dClose').onclick=closeDrawer;$('dClose').focus();
 }
 document.addEventListener('click',async e=>{if(!isSelected())return;
  const button=e.target.closest('[data-promote]');
  if(button){const plan=byId.get(button.dataset.promote);if(!plan||!admin())return;button.disabled=true;try{await promote(plan,version);}catch(err){notify(err.message,true);}finally{button.disabled=false;}return;}
  const load=e.target.closest('[data-load-plan]');if(load){void selectPlan(byId.get(load.dataset.loadPlan));return;}if(e.target.closest('a,[data-copy-coordinate]'))return;const row=e.target.closest('[data-stone-id]');if(row)details(row.dataset.stoneId);});
 return{async load(){const project=await api('/api/projects/erebor');
  if(isSelected()&&version===project.version&&Date.now()-catalogAt<120000)return;
const [prepared,architecture,manifest,icons]=await Promise.all([api('/api/projects/erebor/stone/prepared?version='+project.version),api('/api/projects/erebor/architecture'),api('/api/projects/erebor/architecture/manifest'),fetch('/assets/material-icons/catalog.json').then(r=>r.json())]);if(!isSelected())return;catalog=icons;packages=prepared.packages;version=project.version;items=[...architectureBlueprints(project,architecture.packages),...preparedBlueprints(project,packages)];byId.clear();for(const b of items)byId.set(b.id,b);
  $('liveLine').textContent=`Erebor · ${architecture.packages.length} von ${manifest.packages.length} Architekturpaketen veröffentlicht.`;
  catalogAt=Date.now();
  $('cards').innerHTML=`<span><b>${fmt(items.filter(b=>b.kind==='build').length)}</b> Architektur-Baupläne</span><span><b>${fmt(items.filter(b=>b.kind==='clear').length)}</b> Aushub-Dateien</span><span><b>${fmt(preparedBlueprints(project,packages).length)}</b> Cleanstone-Schematics</span><span><a href="/viewer?project=erebor&room=E05">Blockvorschau öffnen</a></span>`;rows();coordinates();
 },rows,coordinates,changeSite(){limit=150;renderKey='';rows();},refreshQueue,updateLoadStates,coordinateText:()=>coordinateListText(items).replace('ATM10 Campus – Einsetzkoordinaten der aktuellen Baupläne','Erebor – Einsetzkoordinaten der gespeicherten Schematics')};
}
