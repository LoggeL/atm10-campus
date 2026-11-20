import {states,borrowed,freshFleet,workloadDetails,stationCounts,slotDetail,forecastView,landscapePanel} from './erebor-progress-view.js?v=20261121-aushub';
import {esc,fmt} from './format.js?v=20261114-status-1';
import {api,linkStation} from './campus-client.js?v=20261114-status-1';
const el = id => document.getElementById(id);
function percent(done,total) {
  if (!(total > 0)) return '–';
  const value = 100*done/total;
  if (value > 0 && value < 0.1) return '&lt; 0,1 %';
  if (value > 99.9 && value < 100) return '&gt; 99,9 %';
  return fmt(Math.round(value*10)/10)+' %';
}
const volume = n => n >= 1e6 ? fmt(Math.round(n/1e5)/10)+' Mio.' : fmt(n);
const time = t => new Date(t).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
let data = null, selected = new URL(location.href).searchParams.get('kanone') || 'K01', busy = false, showedFresh = false;
const track = (done,total,active=0) => total > 0
  ? '<div class="track" aria-hidden="true"><i style="width:'+Math.min(100,100*done/total)+'%"></i><b style="width:'+Math.min(100,100*active/total)+'%"></b></div>' : '';
function renderSummary(fleet) {
  const f = data.filling;
  const sum = key => f ? f.solid[key]+f.cavity[key]+(f.urn?.[key]??0) : null;
  const done = sum('done'), total = sum('total');
  const working = fleet.filter(r=>r.state==='placing').length;
  const clearing = fleet.filter(r=>r.state==='clearing').length;
  const known = fleet.filter(r=>r.state!=='unknown').length;
  const transfers = fleet.filter(borrowed).length;
  const throughput = data.throughput;
  el('summary').innerHTML = '<article class="panel primary-panel"><h3>Massiv-Füllung</h3><div class="metric-line"><strong class="big">'+percent(done,total)+'</strong><span class="unit">der automatischen Teile erledigt</span></div>'+
    track(done,total,sum('inProgress'))+'<div class="facts"><span><b>'+fmt(done)+' / '+fmt(total)+'</b> Teile</span><span><b>'+fmt(sum('inProgress'))+'</b> zugewiesen</span><span><b>'+fmt(sum('open'))+'</b> frei</span></div>'+(f ? '<p class="meta volume">'+volume(sum('finishedBlocks'))+' von '+volume(sum('blocks'))+' Planblöcken in abgeschlossenen Teilen</p>' : '')+'</article>'+
    '<article class="panel"><h3>Kanonen im Einsatz</h3><div class="metric-line"><strong class="big">'+(known?fmt(working+clearing):'–')+'</strong><span class="unit">von '+fleet.length+' Kanonen</span></div><div class="facts">'+(known?'<span><b>'+fmt(working)+'</b> setzen Blöcke</span><span><b>'+fmt(clearing)+'</b> heben aus</span>':'')+'<span><b>'+transfers+'</b> gebietsübergreifende Aufträge</span>'+
    (showedFresh && throughput?.covered ? '<span><b>'+fmt(Math.round(throughput.blocksPerSecond))+'</b> Blöcke/s ('+fmt(throughput.covered)+' / '+fmt(throughput.assigned)+' zugewiesenen Kanonen gemessen)</span>':'')+
    '</div><p class="meta">'+(known?fmt(known)+' mit Weltmeldung':'Weltmeldung ausstehend')+' · '+(data.balance.enabled?(data.balance.plannedAt?'Lastverteilung um '+time(data.balance.plannedAt):'Lastverteilung bereit'):'Massiv-Vergabe pausiert')+'</p></article>';
}
function renderTasks() {
  const f = data.filling;
  const rows = [
    ['Festgestein ersetzen',f?.solid],['Hohlräume füllen',f?.cavity],['Urnen automatisch ersetzen',f?.urn],
    ['Cleanstone-Katalog',data.stages.stone],['Aushub',data.stages.clear],['Architektur bauen',data.stages.build]
  ];
  el('tasks').innerHTML = rows.map(([name,row])=>'<tr><th scope="row">'+name+'</th><td><span class="progress-cell">'+
    (row?'<span>'+fmt(row.done)+' / '+fmt(row.total)+'</span><span class="pct">'+percent(row.done,row.total)+'</span>':'Unbekannt')+
    '</span></td><td>'+fmt(row?.inProgress)+'</td><td>'+fmt(row?.open)+'</td></tr>').join('');
}
function stationMatches(rows,filter) {
  if (filter==='borrowed') return rows.some(borrowed);
  if (filter==='waiting') return rows.some(r=>['waiting','searching','handover'].includes(r.state));
  if (filter==='unknown') return rows.some(r=>['unknown','unverified'].includes(r.state));
  return filter==='all' || rows.some(r=>r.state===filter);
}
function renderFleet(fleet) {
  const groups = new Map();
  for (const row of fleet) {
    if (!groups.has(row.site)) groups.set(row.site,[]);
    groups.get(row.site).push(row);
  }
  const visible = [...groups].filter(([,rows])=>stationMatches(rows,el('filter').value));
  if (!visible.some(([site])=>site===selected)) selected=visible[0]?.[0] ?? '';
  const focused = document.activeElement?.dataset.site;
  el('fleet').innerHTML = visible.map(([site,rows])=>{
    const label = site+', '+rows.map(r=>r.slot+' '+states[r.state]).join(', ');
    return '<button type="button" class="station" data-site="'+esc(site)+'" aria-label="'+esc(label)+'" aria-pressed="'+(selected===site)+'"><b>'+esc(site)+'</b><span class="chips">'+
      rows.map(r=>'<span class="chip '+r.state+'" title="'+states[r.state]+'">'+esc(r.slot)+'</span>').join('')+'</span></button>';
  }).join('');
  if(focused) [...el('fleet').children].find(b=>b.dataset.site===focused)?.focus({preventScroll:true});
  linkStation(selected);
  el('empty').hidden = visible.length>0;
  el('detail').hidden = !selected;
  const expanded=el('detail').dataset.site===selected && el('detail').querySelector('details')?.open;
  el('detail').dataset.site=selected;
  if(selected) el('detail').innerHTML='<div class="detail-head"><h3>Station '+esc(selected)+'</h3><span class="meta">'+groups.get(selected).map(r=>esc(r.slot)).join(' / ')+'</span></div>'+groups.get(selected).map(row=>slotDetail(row,showedFresh?data.throughput:null)).join('')+stationCounts(data.stations[selected])+'<a class="detail-action" href="/app?project=erebor&amp;kanone='+esc(selected)+'#overview">Bauaufträge für '+esc(selected)+' öffnen</a>'+
    (selected==='K09'?'<a class="detail-action" download href="/assets/erebor-k09-ausbau.zip">Homebox-Installer für K09 Nord und Süd</a>':
     groups.get(selected).some(r=>r.slot==='I')?'<a class="detail-action" download href="/assets/erebor-ausbau-18.zip">Sammelinstaller für 18 Standorte</a>':'');
  if(expanded && selected)el('detail').querySelector('details').open=true;
}
function render() {
  if(!data)return;
  const {fresh,rows:fleet}=freshFleet(data);
  showedFresh=fresh;
  renderSummary(fleet);renderFleet(fleet);
}
async function refresh() {
  if (busy || document.hidden) return;
  busy=true;el('refresh').disabled=true;
  try {
    data=await api('/api/projects/erebor/dashboard');el('error').hidden=true;
    el('forecast').innerHTML=forecastView(data.forecast);
    el('stamp').textContent='Stand '+time(data.capturedAt)+' Uhr';
    renderTasks();
    el('landscape').innerHTML=landscapePanel(data.surface);
    const manual=data.filling?.manual;
    el('quantities').innerHTML=workloadDetails(data.massif,data.unassignedMassif)+(manual?.open?'<p>'+fmt(manual.open)+' offene Sonderpläne für sonstige Block-Entities. <a href="/api/projects/erebor/stone/massif/plans?special=1">Ziele ansehen</a></p>':'');
    render();
  }catch(error){
    el('forecast').innerHTML=forecastView({state:'offline'});
    if(data){data.telemetryAt=null;render();}
    el('error').textContent='Projektstand konnte nicht aktualisiert werden ('+error.message+').';
    el('error').hidden=false;
  }finally{busy=false;el('refresh').disabled=false;}
}
el('legend').innerHTML=[['placing','Baut / hebt aus'],['waiting','Sucht / wartet'],['handover','Planwechsel'],['idle','Frei'],['unverified','Ungeprüft'],['unknown','Kein Signal']].map(([kind,label])=>'<span><i class="dot '+kind+'"></i>'+label+'</span>').join('');
el('fleet').addEventListener('click',e=>{
  const button=e.target.closest('button[data-site]');if(!button)return;
  selected=button.dataset.site;const url=new URL(location.href);url.searchParams.set('kanone',selected);history.replaceState(null,'',url);render();
  if(matchMedia('(max-width:800px)').matches)el('detail').scrollIntoView({block:'nearest'});
});
el('filter').addEventListener('change',render);
el('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();refresh();}});
setInterval(refresh,15000);
setInterval(()=>{if(showedFresh && Date.now()-data.telemetryAt>=45000)render();},1000);
refresh();
