import {esc,fmt} from './format.js?v=20261105-cannon-coordinates-1';

export function setupEreborQueue({api,admin,active,notify,onStatus}){
 const root=document.getElementById('ereborQueue'),label=root.querySelector('[data-summary]'),body=root.querySelector('tbody');
 const prepare=root.querySelector('[data-prepare]'),pause=root.querySelector('[data-pause]');
 let version=null,busy=false,loading=null,last=null;
 function render(q){
  last=q;version=q.version;onStatus?.();
  const ready=q.stations.filter(r=>r.inserted&&Date.now()-Date.parse(r.checked)<90000).length;
  label.textContent=q.stale?'Projektversion geändert. Zuordnung prüfen.':q.enabled?
   q.phase+' · '+ready+' von '+q.stations.length+' eingelegt · Automatisches Nachlegen aktiv':
   q.stations.length?'Automatisches Nachlegen pausiert':'Planfolge noch nicht aktiviert.';
  prepare.classList.toggle('hide',!admin());pause.classList.toggle('hide',!admin()||!q.enabled);prepare.disabled=pause.disabled=busy||q.stale;
  body.innerHTML=q.stations.map(r=>'<tr><td>'+esc(r.site)+'</td><td>'+esc(r.status)+'</td><td class="mono">'+esc(r.file||'')+'</td><td>'+ (r.blocks==null?'':fmt(r.blocks))+'</td><td>'+fmt(r.completed)+'</td><td>'+ (r.checked?esc(new Date(r.checked).toLocaleTimeString('de-DE')):'')+'</td></tr>').join('');
 }
 async function refresh(){
  if(!active()||document.hidden)return;
  if(!loading)loading=api('/api/projects/erebor/planfolge').then(q=>{if(active())render(q);}).catch(e=>{label.textContent=e.message;}).finally(()=>{loading=null;});
  return loading;
 }
 async function act(action){
  if(busy||version==null)return;
  busy=true;prepare.disabled=pause.disabled=true;
  try{const q=await api('/api/projects/erebor/planfolge',{method:'POST',body:{action,version}});render(q);notify(action==='prepare'?'Vorbereitung angefordert.':'Nachlegen pausiert.');}
  catch(e){notify(e.message,true);}finally{busy=false;if(last)render(last);void refresh();}
 }
 prepare.onclick=()=>act('prepare');pause.onclick=()=>act('pause');
 setInterval(refresh,10000);
 return {refresh,async loadPlan(b,activeVersion){
  const receipt=await api('/api/projects/erebor/planfolge/laden',{method:'POST',body:{version:activeVersion,sourceVersion:b.version,part:b.part,revision:b.revision,site:b.cannon,file:b.fileName,sha256:b.sha256}});
  await refresh();return receipt;
 },loadedStatus(file,hash){
  const waiting=last?.waiting?.find(r=>r.name+'.nbt'===file&&r.sha===hash);
  if(waiting)return 'Für '+waiting.site+' vorgemerkt';
  const station=last?.stations.find(r=>r.file+'.nbt'===file);
  if(!station?.inserted||Date.now()-Date.parse(station.checked)>=90000)return null;
  return station.sha256===hash?station.status:'Aktueller Restplan eingelegt';
 }};
}
