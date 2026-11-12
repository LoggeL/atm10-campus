import {esc,fmt} from './format.js?v=20261105-cannon-coordinates-1';

const base='/api/projects/erebor/planfolge';
const positions=Array.from({length:37},(_,i)=>'K'+String(i+1).padStart(2,'0'));
const labels={noGunpowder:'Schießpulver fehlt',targetNotLoaded:'Wartet auf Zielchunk',missingBlock:'Baumaterial fehlt',missingItem:'Baumaterial fehlt'};
export function fleetState(r){
 const n=r?.live;
 if(!n||Date.now()-n.at>=45000)return {title:r?.file?'Keine aktuelle Rückmeldung':'Kein bestätigter Plan',tone:'offline'};
 if(n.state==='RUNNING')return {title:'Baut',tone:'working'};
 if(labels[n.status])return {title:labels[n.status],tone:'waiting'};
 if(n.state==='PAUSED'&&n.status==='ready')return {title:'Startbereit',tone:'ready'};
 if(n.state==='PAUSED')return {title:'Pausiert',tone:'ready'};
 if(n.state==='STOPPED')return {title:'Gestoppt',tone:'ready'};
 return {title:'Unbekannt',tone:'offline'};
}
export function setupEreborQueue({api,admin,active,notify,onStatus,onSite}){
 const root=document.getElementById('ereborQueue'),find=s=>root.querySelector(s);
 const label=find('[data-summary]'),grid=find('[data-sites]'),pick=find('#ereborPick'),load=find('[data-load-picked]'),start=find('[data-start]'),prepare=find('[data-prepare]'),pause=find('[data-pause]');
 let last=null,site='K01',loading=null,busy=false,plans=[],group=new Map(),optionsKey='',plansVersion=null;
 const initial=new URL(location.href).searchParams.get('kanone');if(positions.includes(initial))site=initial;
 function current(){return last?.stations.find(r=>r.site===site);}
 function selected(){return group.get(site)?.find(b=>b.id===pick.value);}
 const setText=(sel,t)=>{const el=find(sel);if(el.textContent!==t)el.textContent=t;};
 function rebuild(){
  const r=current(),items=group.get(site)||[],key=[site,plansVersion,r?.upload,items.length,items[0]?.sha256,items.at(-1)?.sha256].join('|');
  if(optionsKey===key)return;
  const was=pick.dataset.site===site?pick.value:null;optionsKey=key;pick.dataset.site=site;
  pick.replaceChildren();pick.add(new Option(r?.file?'Eingelegt: '+r.file:'Bauplan auswählen',''));
  for(const b of items)pick.add(new Option((b.kind==='clear'?'Aushub':b.kind==='build'?'Bau':'Cleanstone')+' · '+b.fileName.replace(/\.nbt$/,'')+' · '+fmt(b.blocks)+' Blöcke',b.id));
  if(was&&items.some(b=>b.id===was))pick.value=was;
 }
 function detail(){
  const r=current(),n=r?.live,s=fleetState(r),chosen=selected(),matches=!chosen||(chosen.id===r?.file&&chosen.sha256===r?.sha256);
  const pending=last?.waiting?.filter(w=>w.site===site)||[],actual=!!n&&s.tone!=='offline',editable=admin()&&!last?.stale&&!busy;
  setText('[data-station-name]',site);setText('[data-catalog-heading]','Baupläne für '+site);setText('[data-native]',s.title);find('[data-native]').className='fleet-pill '+s.tone;
  setText('[data-job]',r?.file||'Kein Bauplan eingelegt');
  setText('[data-placed]',actual?fmt(n.placed)+(r.blocks?' / '+fmt(r.blocks):''):'Unbekannt');
  setText('[data-fuel]',actual?fmt(n.fuel)+' Schüsse':'Unbekannt');
  setText('[data-target]',actual?(n.target?n.target.join(' / '):n.chunks?'Blöcke im Flug':'Bei Baustart'):'Unbekannt');
  const wait=find('[data-waiting]');wait.hidden=!pending.length;wait.textContent=pending.length?'Vorgemerkt: '+pending.map(w=>w.name).join(', '):'';
  load.disabled=!(editable&&chosen&&!matches&&!pending.some(w=>w.name===chosen.id&&w.sha===chosen.sha256));
  start.disabled=!(editable&&actual&&r?.upload&&matches&&!pending.length&&s.tone==='ready');
  start.textContent=s.tone==='working'?'Kanone baut':n?.state==='PAUSED'&&n.placed>0?'Bau fortsetzen':'Kanone starten';
  setText('[data-hint]',((chosen?.kind==='clear'||(!chosen&&r?.kind==='clear'))?'Aushub entfernt Blöcke. ':'')+(!admin()?'Zum Laden und Starten als Admin anmelden.':last?.stale?'Projektversion geändert. Seite neu laden.':pending.length?'Die Homebox legt den vorgemerkten Plan nach dem laufenden Bau ein.':chosen&&!matches?'Diesen Plan zuerst laden. Ein laufender Bau bleibt erhalten.':s.tone==='working'?'Die Homebox lädt die Zielchunks während des Baus automatisch.':s.tone==='waiting'?s.title+'.':s.tone==='offline'?'Der Start wird nach der Live-Prüfung freigegeben.':'Der eingelegte Plan startet erst mit deinem Klick oder im Spiel.'));
 }
 function draw(){
  if(!grid.children.length)grid.innerHTML=positions.map(k=>'<button type="button" data-site="'+k+'"><i aria-hidden="true"></i>'+k+'</button>').join('');
  for(const b of grid.children){const k=b.dataset.site,s=fleetState(last?.stations.find(r=>r.site===k));b.className=s.tone;b.setAttribute('aria-pressed',String(site===k));b.setAttribute('aria-label',k+': '+s.title);}
  if(last){label.textContent=last.stale?'Projektversion geändert.':last.enabled?'Aktiv · '+last.phase:'Nachlegen pausiert.';}
  prepare.classList.toggle('hide',!admin()||!!last?.enabled);pause.classList.toggle('hide',!admin()||!last?.enabled);prepare.disabled=pause.disabled=busy||!last||last.stale;
  rebuild();detail();
 }
 grid.onclick=e=>{const b=e.target.closest('[data-site]');if(!b||busy)return;site=b.dataset.site;const url=new URL(location.href);url.searchParams.set('kanone',site);history.replaceState(null,'',url);draw();onSite?.(site);};
 pick.onchange=detail;
 async function refresh(){
  if(!active()||document.hidden)return;
  if(!loading)loading=api(base).then(q=>{if(active()){last=q;draw();onStatus?.();}}).catch(e=>{last=null;draw();label.textContent=e.message;}).finally(()=>{loading=null;});
  return loading;
 }
 async function action(fn){
  if(busy)return;busy=true;draw();
  try{await fn();}catch(e){notify(e.message,true);}finally{busy=false;await refresh();draw();}
 }
 async function loadPlan(b,version){const receipt=await api(base+'/laden',{method:'POST',body:{version,sourceVersion:b.version,part:b.part,revision:b.revision,site:b.cannon,file:b.fileName,sha256:b.sha256}});await refresh();return receipt;}
 load.onclick=()=>{const b=selected();if(b&&!load.disabled)void action(async()=>{const r=await loadPlan(b,plansVersion);notify(r.status==='loaded'?site+': Plan ist eingelegt.':site+': Ladeauftrag angenommen.');});};
 start.onclick=()=>{const r=current();if(!r||start.disabled)return;void action(async()=>{
  const result=await api(base+'/start',{method:'POST',body:{site,version:last.version,upload:r.upload,file:r.file,sha256:r.sha256}});
  notify(result.waiting?site+': Start angenommen, Create wartet.':site+(result.alreadyRunning?' baut bereits.':' gestartet.'));
 });};
 for(const [button,kind] of [[prepare,'prepare'],[pause,'pause']])button.onclick=()=>void action(async()=>{await api(base,{method:'POST',body:{action:kind,version:last.version}});});
 setInterval(refresh,5000);draw();
 return {refresh,loadPlan,site:()=>site,setPlans(items,version){plans=items;plansVersion=version;group=new Map();for(const b of plans){if(!group.has(b.cannon))group.set(b.cannon,[]);group.get(b.cannon).push(b);}optionsKey='';draw();},
 loadedStatus(file,hash){const waiting=last?.waiting?.find(r=>r.name+'.nbt'===file&&r.sha===hash);if(waiting)return 'Für '+waiting.site+' vorgemerkt';const station=last?.stations.find(r=>r.file+'.nbt'===file);if(!station?.live)return null;return station.sha256===hash?fleetState(station).title:'Aktueller Restplan eingelegt';}};
}
