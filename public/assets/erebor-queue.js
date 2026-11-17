import {esc,fmt} from './format.js?v=20261114-status-1';

const base='/api/projects/erebor/planfolge';
const positions=Array.from({length:37},(_,i)=>'K'+String(i+1).padStart(2,'0'));
const labels={noGunpowder:'Schießpulver fehlt',targetNotLoaded:'Wartet auf Zielchunk',missingBlock:'Baumaterial fehlt',missingItem:'Baumaterial fehlt'};
export function counterText(counts){
 if(!counts)return 'Zähler unbekannt';
 return [['catalog','Katalog'],['massif','Massiv']].map(([key,label])=>label+' · '+fmt(counts[key].open)+' offen · '+fmt(counts[key].inProgress)+' zugewiesen · '+fmt(counts[key].done)+' erledigt').join(' | ');
}
export function fleetState(r){
 const n=r?.live;
 if(!n||!Number.isFinite(n.at)||Math.abs(Date.now()-n.at)>=45000)return {title:r?.file?'Keine aktuelle Rückmeldung':'Kein bestätigter Plan',tone:'offline'};
 if(n.state==='RUNNING')return {title:'Baut',tone:'working'};
 if(labels[n.status])return {title:labels[n.status],tone:'waiting'};
 if(n.state==='PAUSED'&&n.status==='ready')return {title:'Startbereit',tone:'ready'};
 if(n.state==='PAUSED')return {title:'Pausiert',tone:'ready'};
 if(n.state==='STOPPED')return {title:'Gestoppt',tone:'ready'};
 return {title:'Unbekannt',tone:'offline'};
}
export function renderCannonStrip(rows=[],site){
 return '<div class="cannon-strip" aria-label="Kanonenfortschritt">'+['A','B','C'].map(slot=>{
  const id=slot==='A'?site:site+slot,r=rows.find(r=>r.station===id),s=fleetState(r),n=s.tone==='offline'?null:r?.live;
  const valid=n&&Number.isFinite(n.placed)&&n.placed>=0&&Number.isFinite(n.total)&&n.total>0;
  const pct=valid?Math.max(0,Math.min(100,n.placed/n.total*100)):null;
  return `<div class="cannon-strip-row ${s.tone}" title="${esc(r?.file||'Kein bestätigter Plan')}"><strong>${slot}</strong><span class="cannon-strip-state">${esc(s.title)}</span><span>${valid?fmt(n.placed)+' / '+fmt(n.total):'Unbekannt'}</span><div class="bar" role="progressbar" aria-label="Kanone ${slot}" aria-valuemin="0" aria-valuemax="100"${pct===null?'':` aria-valuenow="${pct}"`}><i style="width:${pct??0}%"></i></div></div>`;
 }).join('')+'</div>';
}
export function setupEreborQueue({api,admin,active,notify,onStatus,onSite}){
 const root=document.getElementById('ereborQueue');
 const find=selector=>root.querySelector(selector);
 const grid=find('[data-sites]'),start=find('[data-start]'),auto=find('[data-auto]');
 const prepare=find('[data-prepare]'),pause=find('[data-pause]');
 const resume=find('[data-resume-fleet]');
 const initial=new URL(location.href).searchParams.get('kanone');
 let site=positions.includes(initial)?initial:'K01';
 let last=null,busy=false,view='open',generation=0,loading=null;
 const current=()=>last?.stations.find(r=>r.site===site);
 const setText=(selector,value)=>{const element=find(selector);if(element.textContent!==value)element.textContent=value;};
 const queue=()=>last?.queue?.site===site?last.queue:null;
 function draw(){
  if(!grid.children.length)for(const id of positions){
   const button=document.createElement('button');button.type='button';button.dataset.site=id;
   button.append(document.createElement('i'),id);grid.append(button);
  }
  for(const b of grid.children){
   const station=last?.stations.find(r=>r.site===b.dataset.site);
   const state=fleetState(station);
   b.className=state.tone;b.setAttribute('aria-pressed',String(b.dataset.site===site));
   b.setAttribute('aria-label',b.dataset.site+' · '+state.title+(station?.automatic?' · Automatik aktiv':''));
   b.classList.toggle('auto-on',!!station?.automatic);
  }
  const r=current(),s=fleetState(r),live=s.tone!=='offline'?r?.live:null,plans=queue();
  const editable=admin()&&!!last&&!last.stale&&!busy;
  if(resume){
   resume.disabled=!editable;
   if(!admin())setText('[data-resume-status]','Zum Sammelstart als Campus-Admin anmelden.');
   else if(find('[data-resume-status]').textContent==='Zum Sammelstart als Campus-Admin anmelden.')setText('[data-resume-status]','');
  }
  setText('[data-station-name]',site);
  find('[data-cannon-strip]').innerHTML=renderCannonStrip(last?.stale?[]:last?.cannons,site);
  setText('[data-catalog-heading]','Abschnitte für '+site);
  setText('[data-native]',s.title);find('[data-native]').className='fleet-pill '+s.tone;
  setText('[data-job]',r?.file||'Kein Bauplan eingelegt');
  setText('[data-placed]',live?fmt(live.placed)+(r.blocks?' / '+fmt(r.blocks):''):'Unbekannt');
  setText('[data-fuel]',live?fmt(live.fuel)+' Schüsse':'Unbekannt');
  setText('[data-target]',live?(live.target?live.target.join(' / '):live.chunks?'Blöcke im Flug':'Bei Baustart'):'Unbekannt');
  const next=plans?.pending[0];
  find('[data-waiting]').hidden=!next;
  if(next)setText('[data-waiting]','Als Nächstes · '+next);
  setText('[data-open-count]',plans?.counts?fmt(plans.counts.catalog.open+plans.counts.catalog.inProgress):'');
  setText('[data-done-count]',plans?.counts?fmt(plans.counts.catalog.done):'');
  setText('[data-global-counts]',counterText(last?.counts?.total));
  setText('[data-station-counts]',counterText(last?.counts?.stations?.[site]));
  for(const tab of root.querySelectorAll('[data-list]'))tab.setAttribute('aria-pressed',String(tab.dataset.list===view));
  auto.disabled=!editable||(!r?.automatic&&!plans);auto.setAttribute('aria-pressed',String(!!r?.automatic));
  auto.textContent=r?.automatic?'Automatik ausschalten':'Automatik starten';
  start.disabled=!editable||!live||s.tone!=='ready'||!!r?.automatic||!r?.upload||!!last.waiting?.some(w=>w.site===site);
  start.textContent=s.tone==='working'?'Kanone baut':'Einmal starten';
  const hint=r?.automatic?'Automatik aktiv. Jeder offene Abschnitt wird der Reihe nach geladen und gestartet.':'Die Automatik arbeitet alle offenen Abschnitte dieser Kanone ab.';
  const problem=r?.status&&!r.inserted&&!r.status.startsWith('Fertig')?r.status:'';
  setText('[data-hint]',!admin()?'Zum Starten als Admin anmelden.':problem&&r?.automatic?hint+' '+problem:hint);
  if(last)setText('[data-summary]',last.enabled?'Automatisches Nachlegen ist für die Flotte aktiv.':'Automatisches Nachlegen ist pausiert.');
  prepare.classList.toggle('hide',!admin()||!!last?.enabled);pause.classList.toggle('hide',!admin()||!last?.enabled);
  prepare.disabled=pause.disabled=!editable;
 }
 async function refresh(){
  if(!active()||document.hidden)return;
  if(loading)return loading;
  const marker=generation,requested=site;
  const pending=api(base+'?site='+encodeURIComponent(requested)).then(data=>{
   if(marker!==generation||!active())return;
   last=data;draw();onStatus?.();
  }).catch(e=>{if(marker===generation){last=null;draw();setText('[data-hint]',e.message);onStatus?.();}});
  loading=pending;try{await pending;}finally{if(loading===pending)loading=null;}
 }
 async function afterChange(){generation++;loading=null;await refresh();}
 async function action(fn){
  if(busy)return;busy=true;draw();
  try{await fn();}catch(e){notify(e.message,true);}finally{busy=false;await afterChange();draw();}
 }
 grid.onclick=e=>{
  const b=e.target.closest('[data-site]');if(!b||busy||b.dataset.site===site)return;
  site=b.dataset.site;view='open';
  const url=new URL(location.href);url.searchParams.set('kanone',site);history.replaceState(null,'',url);
  draw();onSite?.();void afterChange();
 };
 for(const tab of root.querySelectorAll('[data-list]'))tab.onclick=()=>{view=tab.dataset.list;draw();onSite?.();};
 auto.onclick=()=>{if(!auto.disabled)void action(()=>api(base+'/automatik',{method:'POST',body:{site,version:last.version,enabled:!current()?.automatic}}));};
 if(resume)resume.onclick=()=>{if(!resume.disabled)void action(async()=>{
  const result=await api(base+'/fortsetzen',{method:'POST',body:{version:last.version}});
  setText('[data-resume-status]',result.queued.length?result.queued.length+' Kanonen zum Fortsetzen vorgemerkt.':'Keine passenden pausierten Kanonen gemeldet.');
 });};
 start.onclick=()=>{const r=current();if(!r||start.disabled)return;void action(async()=>{
  const result=await api(base+'/start',{method:'POST',body:{site,version:last.version,upload:r.upload,file:r.file,sha256:r.sha256}});
  notify(result.waiting?site+' wartet auf Create.':site+' gestartet.');
 });};
 for(const [button,kind] of [[prepare,'prepare'],[pause,'pause']])button.onclick=()=>void action(()=>api(base,{method:'POST',body:{action:kind,version:last.version}}));
 async function loadPlan(b,version){
  const receipt=await api(base+'/laden',{method:'POST',body:{version,sourceVersion:b.version,part:b.part,revision:b.revision,site:b.cannon,file:b.fileName,sha256:b.sha256}});
  await afterChange();return receipt;
 }
 async function promote(b,version){
  await api(base+'/vorziehen',{method:'POST',body:{site:b.cannon,version,file:b.id,sha256:b.sha256}});
  await afterChange();
 }
 function loadedStatus(file,hash){
  const name=file.replace(/\.nbt$/,'');
  const station=last?.stations.find(r=>r.file===name);
  if(station?.live)return station.sha256===hash?fleetState(station).title:'Restplan eingelegt';
  if(queue()?.done.some(row=>row.name===name))return 'Erledigt';
  if(queue()?.preferred.includes(name))return 'Vorgezogen';
  return null;
 }
 setInterval(refresh,5000);draw();
 return {refresh,loadPlan,promote,site:()=>site,queue,view:()=>view,station:current,loadedStatus};
}
