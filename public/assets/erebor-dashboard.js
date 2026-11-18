const el = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? n.toLocaleString('de-DE') : '–';
function percent(done,total) {
  if (!(total > 0)) return '–';
  const value = 100*done/total;
  if (value > 0 && value < 0.1) return '&lt; 0,1 %';
  if (value > 99.9 && value < 100) return '&gt; 99,9 %';
  return fmt(Math.round(value*10)/10)+' %';
}
const volume = n => n >= 1e6 ? fmt(Math.round(n/1e5)/10)+' Mio.' : fmt(n);
const time = t => new Date(t).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const states = {placing:'Baut',searching:'Sucht Ziel',waiting:'Wartet',handover:'Planwechsel',idle:'Frei',unknown:'Kein Signal',unverified:'Plan ungeprüft'};
const reasons = {missingItem:'Material fehlt',missingBlock:'Baublock fehlt',noGunpowder:'Schießpulver fehlt',targetNotLoaded:'Zielchunk lädt',ready:'Startbereit'};
let data = null, selected = 'K01', busy = false, showedFresh = false;
const isFresh = () => data?.telemetryAt != null && Date.now()-data.telemetryAt < 45000;
const borrowed = r => r.home && r.home !== r.site;
const track = (done,total,active=0) => total > 0
  ? '<div class="track" aria-hidden="true"><i style="width:'+Math.min(100,100*done/total)+'%"></i><b style="width:'+Math.min(100,100*active/total)+'%"></b></div>' : '';
function renderSummary(fleet) {
  const f = data.filling;
  const sum = key => f ? f.solid[key]+f.cavity[key] : null;
  const done = sum('done'), total = sum('total');
  const working = fleet.filter(r=>r.state==='placing').length;
  const known = fleet.filter(r=>r.state!=='unknown').length;
  const transfers = fleet.filter(borrowed).length;
  const throughput = data.throughput;
  el('summary').innerHTML = '<article class="panel primary-panel"><h3>Massiv-Füllung</h3><div class="metric-line"><strong class="big">'+percent(done,total)+'</strong><span class="unit">der automatischen Teile erledigt</span></div>'+
    track(done,total,sum('inProgress'))+'<div class="facts"><span><b>'+fmt(done)+' / '+fmt(total)+'</b> Teile</span><span><b>'+fmt(sum('inProgress'))+'</b> zugewiesen</span><span><b>'+fmt(sum('open'))+'</b> frei</span></div>'+(f ? '<p class="meta volume">'+volume(sum('finishedBlocks'))+' von '+volume(sum('blocks'))+' Planblöcken in abgeschlossenen Teilen</p>' : '')+'</article>'+
    '<article class="panel"><h3>Kanonen im Einsatz</h3><div class="metric-line"><strong class="big">'+(known?fmt(working):'–')+'</strong><span class="unit">bauen · '+fleet.length+' Kanonen</span></div><div class="facts"><span><b>'+transfers+'</b> gebietsübergreifende Aufträge</span>'+
    (isFresh() && throughput?.covered ? '<span><b>'+fmt(Math.round(throughput.blocksPerSecond))+'</b> Blöcke/s ('+fmt(throughput.covered)+' gemessen)</span>':'')+
    '</div><p class="meta">'+(known?fmt(known)+' mit Weltmeldung':'Weltmeldung ausstehend')+' · '+(data.balance.enabled?(data.balance.plannedAt?'Lastverteilung um '+time(data.balance.plannedAt):'Lastverteilung bereit'):'Massiv-Vergabe pausiert')+'</p></article>';
}
function renderTasks() {
  const f = data.filling;
  const rows = [
    ['Festgestein ersetzen',f?.solid],['Hohlräume füllen',f?.cavity],['Manuelle Sonderziele',f?.manual],
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
function slotDetail(r) {
  const why = r.state==='waiting' && reasons[r.reason] ? ' · '+reasons[r.reason] : '';
  const assigned = r.tile || r.file;
  const source = borrowed(r)?'<p class="meta borrow">Übernimmt einen Teil von '+esc(r.home)+'</p>':'';
  const progress = r.placed != null ? '<p class="meta">'+fmt(r.placed)+(r.total==null?'':' / '+fmt(r.total))+' Blöcke laut Kanone</p>'+track(r.placed,r.total):'';
  return '<div class="slot"><div class="slot-head"><span class="slot-name">Kanone '+esc(r.slot)+'</span><span>'+states[r.state]+why+'</span></div>'+
    (assigned?'<p class="file">'+esc(assigned)+'</p>':'')+source+progress+'</div>';
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
  el('empty').hidden = visible.length>0;
  el('detail').hidden = !selected;
  if(selected) el('detail').innerHTML='<div class="detail-head"><h3>Station '+esc(selected)+'</h3><span class="meta">A / B / C</span></div>'+groups.get(selected).map(slotDetail).join('');
}
function render() {
  if(!data)return;
  showedFresh=isFresh();
  const fleet=showedFresh?data.fleet:data.fleet.map(r=>({...r,state:'unknown',placed:null,total:null}));
  renderSummary(fleet);renderFleet(fleet);
}
async function refresh() {
  if (busy || document.hidden) return;
  busy=true;el('refresh').disabled=true;
  try {
    const response=await fetch('/api/projects/erebor/dashboard',{cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(response.status===401){
      el('error').innerHTML='Sitzung abgelaufen. <a href="/login">Bei Campus anmelden</a>.';
      el('error').hidden=false;el('stamp').textContent='Anmeldung erforderlich';data=null;
      for(const id of ['summary','fleet','tasks','detail'])el(id).replaceChildren();
      return;
    }
    if(!response.ok)throw Error('HTTP '+response.status);
    data=await response.json();el('error').hidden=true;
    el('stamp').textContent='Stand '+time(data.capturedAt)+' Uhr';
    renderTasks();render();
  }catch(error){
    el('error').textContent='Projektstand konnte nicht aktualisiert werden ('+error.message+').';
    el('error').hidden=false;
  }finally{busy=false;el('refresh').disabled=false;}
}
el('legend').innerHTML=[['placing','Baut'],['waiting','Sucht / wartet'],['handover','Planwechsel'],['idle','Frei'],['unverified','Ungeprüft'],['unknown','Kein Signal']].map(([kind,label])=>'<span><i class="dot '+kind+'"></i>'+label+'</span>').join('');
el('fleet').addEventListener('click',e=>{
  const button=e.target.closest('button[data-site]');if(!button)return;
  selected=button.dataset.site;render();
  if(matchMedia('(max-width:800px)').matches)el('detail').scrollIntoView({block:'nearest'});
});
el('filter').addEventListener('change',render);
el('refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();refresh();}});
setInterval(refresh,15000);
setInterval(()=>{if(showedFresh && !isFresh())render();},1000);
refresh();
