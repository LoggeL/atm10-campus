import * as THREE from 'three';
import { ProjectGeometry } from './project-geometry.js?v=20261104-erebor-symmetry-3';
import { installViewerControls } from './controls.js?v=20261104-erebor-symmetry-3';
import { connectPolling } from '/assets/live-updates.js?v=20261104-erebor-symmetry-3';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const keyOf = item => item.kind + ':' + item.id;
const LAYERS = [
  ['mountain','Bergfüllung','Geplante Form, vereinfacht im 16-Block-Raster'],
  ['terrain','Geländeaufnahme','Gespeicherte Höhenstichproben; Lücken bleiben unbekannt'],
  ['zones','Räume und Außenanlagen','Reservierte Bauvolumen, keine fertigen Gebäude'],
  ['protected','Schutzbereiche','Bestehende Anlagen und freizuhaltende Flächen'],
  ['cannons','Kanonenstandorte','Geplante Positionen, keine Live-Kanonen'],
  ['preview','Torprototyp','Vorhandenes Blockmodell der Torwächter'],
];
const PRESETS = [
  {id:'overview',label:'Gesamtplan',hint:'Räume und Außenanlagen im Berg',modes:['ghost','ghost','solid','off','off','off']},
  {id:'mountain',label:'Bergmassiv',hint:'Geplante Felsform mit Geländeaufnahme',modes:['solid','solid','off','off','off','off']},
  {id:'rooms',label:'Innenräume',hint:'Hallen, Wege und Außenanlagen freilegen',modes:['off','off','solid','ghost','off','off']},
  {id:'cannons',label:'Kanonenstandorte',hint:'Arbeitsplätze und geschützte Bereiche',modes:['ghost','ghost','off','solid','solid','off']},
];

export async function startProjectViewer({view,nav,scene,hash,api,loading,toast}) {
  const data = scene.planning, geometry = new ProjectGeometry(view,data);
  const items = new Map([...data.zones,...data.cannons,...data.protectedAreas].map(item=>[keyOf(item),item]));
  const hidden = new Set((hash.get('hidden') || '').split(',').filter(k=>items.has(k)));
  const modes = {};
  let selected = null, activePreset = null, previewPromise = null, search = '', timer;
  const [lo,hi] = data.bounds, size=hi.map((v,i)=>v-lo[i]), center=lo.map((v,i)=>v+size[i]/2);
  const span=Math.max(size[0],size[2]), k=Math.max(1,1.2/view.camera.aspect);
  const home={pos:[center[0]+span*.65*k,center[1]+span*.58*k,center[2]+span*.65*k],target:center};
  view.setBounds(lo,size); view.grid.position.y = lo[1]-.1;
  view.scene.fog.near=span*3;view.scene.fog.far=span*8;
  nav.orbit.maxDistance=span*5; nav.speed=4;
  const savedCamera=(hash.get('cam')||'').split(',').map(Number);
  if(savedCamera.length===6&&savedCamera.every(Number.isFinite)) nav.lookAt(savedCamera.slice(0,3),savedCamera.slice(3));
  else nav.lookAt(home.pos,home.target);

  document.body.classList.add('planning-viewer');
  $('.snap').classList.add('hidden');
  $('#edition').innerHTML=`<span class="pill">Masterplan <b>v${data.version}</b></span><span class="pill">${data.placed?'Weltkoordinaten':'Lokale Koordinaten'}</span>`;
  $('#project-note').textContent='Planungsvolumen und gespeicherte Geländestichproben. Kein Live-Baufortschritt.';
  $('#project-note').classList.remove('hidden');
  $('#blueprints-link').href='/app?project='+encodeURIComponent(data.id)+'#overview';
  $('[data-tab="blueprints"]').innerHTML='Bereiche <span class="count">'+data.zones.length+'</span>';
  $('[data-tab="places"]').textContent='Orte / Kanonen';
  $('#bp-search').placeholder='Bereich suchen …'; $('#bp-search').setAttribute('aria-label','Bereich suchen');
  $('.bp-actions').classList.add('hidden'); $('#bp-filter').classList.add('hidden'); $('#overlap').closest('label').classList.add('hidden');
  $('#layer-disclosure').open=true;
  const levelLabel=document.createElement('label'); levelLabel.className='project-level';
  levelLabel.title='Der Schnitt liegt acht Blöcke über der gewählten Laufhöhe.';
  levelLabel.innerHTML='<span>Höhe freilegen</span><select id="project-level" aria-label="Höhe freilegen"><option value="">Alle Höhen</option>'+data.levels.map(l=>`<option value="${l.y+8}">Y ${l.y} · ${esc(l.title)}</option>`).join('')+'</select>';
  $('[data-pane="view"]').insertBefore(levelLabel,$('#layer-disclosure'));

  function saveHash() {
    clearTimeout(timer); timer=setTimeout(()=>{
      const h=new URLSearchParams(),p=view.camera.position,t=nav.target();
      h.set('cam',[p.x,p.y,p.z,t.x,t.y,t.z].map(n=>n.toFixed(1)).join(','));
      if(activePreset)h.set('pv',activePreset);
      h.set('pm',LAYERS.map(([id])=>id+':'+modes[id]).join(','));
      if(selected)h.set('area',selected);
      if(hidden.size)h.set('hidden',[...hidden].join(','));
      if(Number($('#clip').value)<hi[1])h.set('cut',$('#clip').value);
      history.replaceState(null,'',location.pathname+location.search+'#'+h.toString().replace(/%2C/g,',').replace(/%3A/g,':'));
    },400);
  }
  const syncNavButtons=()=>document.querySelectorAll('#nav-mode button').forEach(b=>{const on=b.dataset.mode===nav.mode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});
  installViewerControls({view,nav,home:()=>home,saveHash,syncNavButtons,onEscape:()=>select(null),filename:data.id,canWalk:false});
  function focus(item) {
    if(nav.mode!=='orbit'){nav.setMode('orbit');syncNavButtons();}
    const [a,b]=item.bounds, s=b.map((v,i)=>v-a[i]),c=a.map((v,i)=>v+s[i]/2);
    const distance=Math.max(60,...s)*1.5*Math.max(1,1/view.camera.aspect);
    nav.flyTo([c[0]+distance,c[1]+distance*.8,c[2]+distance*.65],c);
  }
  function setClip(value) {
    const clip=$('#clip');clip.value=String(Math.max(lo[1],Math.min(hi[1],value)));
    const y=Number(clip.value),cut=y>=hi[1]?1e6:y+.001;
    geometry.setClip(cut); view.uniforms.uClipY.value=cut;
    $('#clip-val').textContent=y>=hi[1]?'aus':'Y '+y;
    $('#project-level').value=[...$('#project-level').options].some(o=>o.value===String(y))?String(y):'';
    saveHash();
  }
  $('#clip').min=lo[1];$('#clip').max=hi[1];$('#clip').value=hi[1];
  $('#clip').oninput=e=>setClip(Number(e.target.value));
  $('#project-level').onchange=e=>{applyPreset('rooms');setClip(e.target.value?Number(e.target.value):hi[1]);};

  const available=id=>id==='mountain'?!!data.mountain:id==='terrain'?data.terrain.length>0:id==='preview'?!!data.preview: true;
  function renderLayers() {
    $('#layers').innerHTML=LAYERS.filter(([id])=>available(id)).map(([id,label,hint])=>`<label class="project-layer"><span>${esc(label)}<small>${esc(hint)}</small></span><select data-project-layer="${id}" aria-label="${esc(label)}">${[['solid','Sichtbar'],['ghost','Geist'],['off','Aus']].map(([v,t])=>`<option value="${v}" ${modes[id]===v?'selected':''}>${t}</option>`).join('')}</select></label>`).join('');
    $('#presets').innerHTML=(data.id==='erebor'?'<a class="preset active" href="/viewer?project=erebor&room=E05"><b>Räume begehen · Blockansicht</b><span>Planblöcke, Materialien, Laufen und Fliegen</span></a>':'')+PRESETS.map(p=>`<button class="preset ${activePreset===p.id?'active':''}" aria-pressed="${activePreset===p.id}" data-project-preset="${p.id}"><b>${p.label}</b><span>${p.hint}</span></button>`).join('');
  }
  function syncModes() {
    for(const [id] of LAYERS)geometry.setMode(id,modes[id]||'off');
    for(const key of items.keys())geometry.setVisible(key,!hidden.has(key));
    activePreset=PRESETS.find(p=>p.modes.every((m,i)=>m===modes[LAYERS[i][0]]))?.id||null;
    renderLayers();saveHash();
  }
  function applyPreset(id) {
    const preset=PRESETS.find(p=>p.id===id)||PRESETS[0];
    LAYERS.forEach(([key],i)=>modes[key]=preset.modes[i]);syncModes();
  }
  async function ensurePreview() {
    if(items.has('preview:prototype'))return items.get('preview:prototype');
    if(!previewPromise)previewPromise=(async()=>{
      toast('Torprototyp wird geladen …',0);
      const project=await(await api('/api/projects/'+encodeURIComponent(data.id))).json();
      if(project.version!==data.version)throw Error('Projekt wurde inzwischen geändert. Bitte neu laden.');
      const item=await geometry.loadPreview(project.plan.blockPreview);
      items.set(keyOf(item),item); syncModes();toast('Torprototyp geladen.');return item;
    })().catch(e=>{previewPromise=null;throw e;});
    return previewPromise;
  }
  $('#layers').onchange=async e=>{
    const id=e.target.dataset.projectLayer;if(!id)return;
    modes[id]=e.target.value;syncModes();
    if(id==='preview'&&modes[id]!=='off')try{await ensurePreview();}catch(err){modes.preview='off';syncModes();toast(esc(err.message),0);}
  };
  $('#presets').onclick=e=>{const id=e.target.closest('[data-project-preset]')?.dataset.projectPreset;if(id)applyPreset(id);};
  applyPreset(hash.get('pv'));
  for(const entry of (hash.get('pm')||'').split(',')) {const [id,mode]=entry.split(':');if(LAYERS.some(([k])=>k===id)&&['solid','ghost','off'].includes(mode))modes[id]=mode;}
  syncModes();
  const cut=Number(hash.get('cut'));if(hash.has('cut')&&Number.isFinite(cut))setClip(cut);

  function renderAreas() {
    const q=search.trim().toLowerCase();
    $('#bp-list').innerHTML=[['Raumprogramm',data.zones],['Schutzbereiche',data.protectedAreas]].map(([label,list])=>{
      const rows=list.filter(item=>(item.id+' '+item.title).toLowerCase().includes(q));
      return rows.length?`<h3>${label}</h3>`+rows.map(item=>`<div class="project-area ${selected===keyOf(item)?'selected':''}"><input type="checkbox" data-visible="${esc(keyOf(item))}" aria-label="${esc(item.title)} sichtbar" ${hidden.has(keyOf(item))?'':'checked'}><button data-area="${esc(keyOf(item))}"><b>${esc(item.id)} · ${esc(item.title)}</b><small>Y ${item.bounds[0][1]} bis ${item.bounds[1][1]-1}</small></button></div>`).join(''):'';
    }).join('')||'<p>Keine passenden Bereiche.</p>';
  }
  function renderDetail() {
    const item=items.get(selected),el=$('#detail');el.classList.toggle('hidden',!item);if(!item)return;
    const [a,b]=item.bounds,position=item.position||a;
    const label={zone:'Geplantes Bauvolumen',cannon:'Geplanter Kanonenstandort',protected:'Geschützter Bereich',preview:'Blockprototyp'}[item.kind];
    el.innerHTML=`<button class="close" data-close aria-label="Schließen">✕</button><span class="status-tag">${label}</span><h2>${item.kind==='zone'?esc(item.id)+' · ':''}${esc(item.title)}</h2>
      <p class="project-coordinates">${data.placed?'Welt':'Lokal'} X / Y / Z<br><strong>${position.join(' / ')}</strong>${item.position?'':`<br>bis ${b.map(v=>v-1).join(' / ')}`}</p>
      ${item.kind==='zone'?`<p>Übersichtsvolumen.</p>${data.id==='erebor'?`<p><a class="primary" href="/viewer?project=erebor&room=${encodeURIComponent(item.id)}">Diesen Bereich als Blöcke ansehen und betreten</a></p>`:''}<p>Laufhöhen: ${item.floors.map(y=>'Y '+y).join(', ')||'nicht angegeben'}</p>${item.features.map(t=>`<p class="desc">${esc(t)}</p>`).join('')}`:''}
      ${item.kind==='cannon'?`<p>${esc(item.setup)}</p><p>Fundament: Y ${position[1]-1}<br>${Number(item.assigned)||0} zugeordnete Steinabschnitte.</p><p class="desc">Geplanter Arbeitsplatz. Eine Kanone im Spiel ist damit nicht bestätigt.</p>`:''}
      ${item.kind==='protected'?`<p>${esc(item.reason)}</p>`:''}
      ${item.kind==='preview'?`<p>${esc(item.description)}</p><p>${item.blockCount.toLocaleString('de-DE')} Modellblöcke. Position an der geplanten Torachse; Fassadendetails sind noch nicht fertig.</p>`:''}
      <div class="actions"><button data-action="focus">Fokus</button>${item.kind==='zone'?'<button data-action="solo">Nur diesen Bereich</button>':''}<button data-action="copy">X / Y / Z kopieren</button><a href="/projects?id=${encodeURIComponent(data.id)}${item.kind==='cannon'?'#cannon-sites':'#layout'}">Projekt öffnen</a></div>`;
  }
  function select(key,fly=false) {
    selected=items.has(key)?key:null;
    const item=items.get(selected);geometry.highlight(item);renderDetail();renderAreas();saveHash();
    if(fly&&item){
      hidden.delete(key);geometry.setVisible(key,true);
      const layer={zone:'zones',cannon:'cannons',protected:'protected',preview:'preview'}[item.kind];
      if(modes[layer]==='off')modes[layer]='solid';
      if(item.kind==='zone'&&modes.mountain==='solid')modes.mountain='ghost';
      syncModes();
      if(Number($('#clip').value)<=item.bounds[0][1])setClip(hi[1]);
      focus(item);renderAreas();
      if(matchMedia('(max-width:760px)').matches){$('#panel').classList.remove('open');$('#panel-toggle').setAttribute('aria-expanded','false');}
    }
  }
  $('#bp-search').oninput=e=>{search=e.target.value;renderAreas();};
  $('#bp-list').onclick=e=>{const b=e.target.closest('[data-area]');if(b)select(b.dataset.area,true);};
  $('#bp-list').onchange=e=>{const key=e.target.dataset.visible;if(!key)return;e.target.checked?hidden.delete(key):hidden.add(key);geometry.setVisible(key,e.target.checked);if(!e.target.checked&&selected===key)select(null);saveHash();};
  const allAreas=on=>{for(const item of [...data.zones,...data.protectedAreas]){const key=keyOf(item);on?hidden.delete(key):hidden.add(key);geometry.setVisible(key,on);}if(!on)select(null);renderAreas();saveHash();};
  $('#bp-all').onclick=()=>allAreas(true);$('#bp-none').onclick=()=>allAreas(false);
  $('#detail').onclick=async e=>{
    if(e.target.closest('[data-close]'))return select(null);
    const action=e.target.closest('[data-action]')?.dataset.action,item=items.get(selected);if(!item)return;
    if(action==='focus')focus(item);
    if(action==='solo'){applyPreset('rooms');allAreas(false);select(keyOf(item),true);}
    if(action==='copy')try{await navigator.clipboard.writeText((item.position||item.bounds[0]).join(' / '));toast('Koordinaten kopiert.');}catch{toast('Bitte Koordinaten im Detailfeld markieren und kopieren.');}
  };
  $('#pois').innerHTML=`<button class="poi" data-home><b>Gesamtes Projekt</b><small>Übersicht zurücksetzen</small></button>${data.preview?`<button class="poi" data-preview><b>${esc(data.preview.title)}</b><small>Texturiertes Blockmodell öffnen</small></button>`:''}<h3>Geplante Kanonenstandorte</h3>`+data.cannons.map(c=>`<button class="poi" data-area="${esc(keyOf(c))}"><b>${esc(c.id)}</b><small>${c.position.join(' / ')} · ${esc(c.setup)}</small></button>`).join('');
  $('#pois').onclick=async e=>{
    const key=e.target.closest('[data-area]')?.dataset.area;
    if(key){applyPreset('cannons');select(key,true);}
    if(e.target.closest('[data-home]'))$('#reset-cam').click();
    if(e.target.closest('[data-preview]'))try{
      const item=await ensurePreview();for(const [id] of LAYERS)modes[id]=id==='preview'?'solid':'off';syncModes();setClip(hi[1]);select(keyOf(item),true);
    }catch(err){toast(esc(err.message),0);}
  };
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.tabs button').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b));});
    document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===b.dataset.tab));
  });
  renderAreas();
  function pick(event) {
    const r=view.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((event.clientX-r.left)/r.width*2-1,-(event.clientY-r.top)/r.height*2+1),view.camera);
    return geometry.pick(ray);
  }
  let down=null;
  view.canvas.addEventListener('pointerdown',e=>down={x:e.clientX,y:e.clientY,t:performance.now()});
  view.canvas.addEventListener('pointerup',e=>{if(down&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<5&&performance.now()-down.t<600){const hit=pick(e);select(hit?keyOf(hit):null);}down=null;});
  view.canvas.addEventListener('dblclick',e=>{const hit=pick(e);if(hit)select(keyOf(hit),true);});
  const tip=$('#tooltip');
  view.canvas.addEventListener('pointermove',e=>{
    if(e.buttons){tip.classList.add('hidden');return;}
    const hit=pick(e);tip.classList.toggle('hidden',!hit);
    if(hit){tip.innerHTML=`<b>${esc(hit.id)} · ${esc(hit.title)}</b><div class="pos">${(hit.position||hit.bounds[0]).join(' / ')}</div>`;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}
  });
  view.canvas.addEventListener('pointerleave',()=>tip.classList.add('hidden'));
  const polling=connectPolling({refresh:async()=>{
    const projects=await(await api('/api/projects',{signal:AbortSignal.timeout(20_000)})).json();
    if(projects.find(p=>p.id===data.id)?.version!==data.version)toast('Neue Projektversion verfügbar. <a href="" id="reload">Neu laden</a>',0);
  },onState:s=>{
    $('#refresh-label').textContent=s.phase==='refreshing'?'Prüfe Projekt …':s.phase==='error'?'Prüfung fehlgeschlagen':s.phase==='paused'?'Pausiert':`Prüfung in ${s.remainingSeconds} s`;
    $('#refresh-label').title=s.error||'Prüft neue Projektversionen. Die Ansicht bleibt erhalten.';
    $('#refresh-progress').value=s.progress;$('#refresh-now').disabled=s.phase==='refreshing';
  }});
  $('#refresh-now').onclick=()=>polling.refreshNow();
  $('#toast').onclick=e=>{if(e.target.id==='reload'){e.preventDefault();location.reload();}};
  let last=performance.now(),lastHud=0;
  function frame(now) {
    nav.update((now-last)/1000);last=now;view.sky.position.copy(view.camera.position);geometry.updateLabels(view.camera,view.canvas.clientHeight);view.render(1/60);
    if(now-lastHud>500){const p=view.camera.position;$('#hud').textContent=`${data.placed?'Welt':'Lokal'} ${p.x.toFixed(0)} / ${p.y.toFixed(0)} / ${p.z.toFixed(0)}\n${nav.mode==='orbit'?'Ziehen: drehen · Rechts: schieben · Rad: zoomen':'WASD · E hoch · Q runter · Shift schnell · Rad: Tempo ×'+nav.speed.toFixed(1)}`;lastHud=now;}
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  loading('Fertig',100);$('#loading').classList.add('done');
  if(modes.preview!=='off'||hash.get('area')==='preview:prototype')try{await ensurePreview();}catch(e){modes.preview='off';syncModes();toast(esc(e.message),0);}
  if(hash.get('area'))select(hash.get('area'),savedCamera.length!==6);
}
