import * as THREE from 'three';
import {installViewerControls} from './controls.js?v=20261104-erebor-relocation-1';
import {connectPolling} from '/assets/live-updates.js?v=20261104-erebor-relocation-1';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color=name=>/gold|gilded/.test(name)?'#d4ae49':/light|glowstone|lantern/.test(name)?'#ffe8b3':/prismarine|veridium/.test(name)?'#306c62':/blackstone|deepslate/.test(name)?'#30363c':/wood|spruce|barrel|bookshelf/.test(name)?'#715439':'#969897';

// One bounded room or corridor at a time, using the same integer design cells as NBT export.
export async function startArchitectureViewer({view,nav,scene,hash,api,loading,toast,room}) {
  const data=scene.planning,items=[...data.zones],clipPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),1e6);
  if(!items.some(i=>i.id==='E39'))items.push({id:'E39',title:'Gangnetz · mittlerer Ausschnitt',floors:[...new Set(items.filter(i=>i.id.startsWith('G')).flatMap(i=>i.floors))]});
  let model=null,group=null,busy=false,selected=room,search='',saveTimer,home=null;
  view.renderer.localClippingEnabled=true;
  view.scene.add(new THREE.AmbientLight(0xffffff,1.25));
  nav.orbit.minDistance=.5;nav.orbit.maxPolarAngle=Math.PI*.98;
  document.body.classList.add('architecture-viewer');
  $('.snap').classList.add('hidden');
  $('#project-note').classList.remove('hidden');
  $('#project-note').textContent='Echte Planblöcke aus den Erebor-Schematics. Wähle eine Halle oder einen Gang und betrete ihn.';
  $('#blueprints-link').href='/app?project=erebor#overview';
  $('#edition').innerHTML='<span class="pill">Erebor · Blockansicht</span>';
  $('[data-tab="blueprints"]').textContent='Räume & Gänge';
  $('[data-tab="places"]').textContent='Etagen';
  $('#bp-search').placeholder='Raum oder Gang suchen …';$('#bp-search').setAttribute('aria-label','Raum oder Gang suchen');
  $('.bp-actions').classList.add('hidden');$('#bp-filter').classList.add('hidden');
  $('#bp-all').classList.add('hidden');$('#bp-none').classList.add('hidden');
  $('#layer-disclosure').classList.add('hidden');
  $('#presets').innerHTML=`<label class="project-level"><span>Raum / Gang</span><select id="architecture-room" aria-label="Raum oder Gang">${items.map(i=>`<option value="${esc(i.id)}">${esc(i.id+' · '+i.title)}</option>`).join('')}</select></label>
    <h2 id="architecture-title"></h2><p id="architecture-size" class="project-note" role="status"></p>
    <label class="project-level"><span>Einstiegsebene</span><select id="architecture-floor" aria-label="Einstiegsebene"></select></label>
    <button class="preset active" id="architecture-enter"><b>Innen betreten</b><span>Auf dem Boden stehen · WASD zum Laufen</span></button>
    <button class="preset" id="architecture-outside"><b>Von außen ansehen</b><span>Drehen, zoomen und verschieben</span></button>
    <button class="preset" id="architecture-cut"><b>Dach öffnen</b><span>Von oben in die Halle schauen</span></button>
    <a class="preset" href="/viewer?project=erebor#pv=rooms"><b>Gesamtgrundriss</b><span>Alle Räume und Verbindungen im Berg</span></a>
    <p class="project-note" id="architecture-note"></p><p class="project-note">Jeweils der ausgewählte Bereich wird geladen. Andere Hallen und Gänge oben oder unter „Räume & Gänge“ auswählen.</p>`;
  const roomSelect=$('#architecture-room'),floorSelect=$('#architecture-floor');
  function syncNavButtons(){document.querySelectorAll('#nav-mode button').forEach(b=>{const on=b.dataset.mode===nav.mode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',String(on));});}
  function saveHash(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{
    if(!model)return;const p=view.camera.position,t=nav.target(),h=new URLSearchParams();
    h.set('cam',[p.x,p.y,p.z,t.x,t.y,t.z].map(v=>v.toFixed(2)).join(','));h.set('mode',nav.mode);
    h.set('floor',floorSelect.value);if(Number($('#clip').value)<model.bounds[1][1])h.set('cut',$('#clip').value);
    history.replaceState(null,'','/viewer?project=erebor&room='+encodeURIComponent(selected)+'#'+h.toString().replace(/%2C/g,','));
  },300);}
  function setClip(y){if(!model)return;$('#clip').value=y;clipPlane.constant=y>=model.bounds[1][1]?1e6:y+.001;$('#clip-val').textContent=clipPlane.constant===1e6?'aus':'Y '+y;view.markShadows();saveHash();}
  function enter(floor=Number(floorSelect.value)){
    if(!model||busy)return;const spawn=model.navigation.spawns.find(s=>s.floor===floor)||model.navigation.spawns[0];
    if(!spawn){toast('Hier ist kein sicherer Einstieg vorhanden. Bitte Fliegen verwenden.');return;}
    nav.anim=null;nav.setMode('fly');nav.lookAt(spawn.position,spawn.target);nav.setMode('walk');nav.lookAt(spawn.position,spawn.target);nav.vel.set(0,0,0);
    floorSelect.value=spawn.floor;setClip(model.bounds[1][1]);syncNavButtons();saveHash();view.canvas.focus();
  }
  function outside(){if(!home)return;nav.anim=null;nav.setMode('orbit');nav.lookAt(home.pos,home.target);syncNavButtons();saveHash();}
  installViewerControls({view,nav,home:()=>home,saveHash,syncNavButtons,onEscape:()=>{},filename:'erebor',enterWalk:()=>enter()});
  $('#architecture-enter').onclick=()=>enter();$('#architecture-outside').onclick=outside;
  $('#architecture-cut').onclick=()=>{outside();setClip(model.bounds[1][1]-5);};
  $('#clip').oninput=e=>setClip(Number(e.target.value));
  floorSelect.onchange=()=>enter();roomSelect.onchange=()=>loadRoom(roomSelect.value);
  function renderList(){const q=search.toLowerCase();$('#bp-list').innerHTML=items.filter(i=>(i.id+' '+i.title).toLowerCase().includes(q)).map(i=>`<div class="project-area ${i.id===selected?'selected':''}"><button data-room="${esc(i.id)}" ${busy?'disabled':''}><b>${esc(i.id+' · '+i.title)}</b><small>Blockansicht · ${i.floors.map(y=>'Y'+y).join(' / ')}</small></button></div>`).join('');}
  $('#bp-search').oninput=e=>{search=e.target.value;renderList();};
  $('#bp-list').onclick=e=>{const id=e.target.closest('[data-room]')?.dataset.room;if(id)loadRoom(id);};
  document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{
    document.querySelectorAll('.tabs button').forEach(t=>{t.classList.toggle('active',t===b);t.setAttribute('aria-pressed',String(t===b));});
    document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===b.dataset.tab));
  });
  function dispose(g){if(!g)return;view.scene.remove(g);g.traverse(m=>{m.geometry?.dispose();if(m.material){m.material.map?.dispose();m.material.dispose();}});}
  async function makeGroup(m){
    const g=new THREE.Group(),batches=new Map();g.position.set(...m.bounds[0]);
    for(const [axis,sign,plane,u,v,w,h,state] of m.quads){
      if(!batches.has(state))batches.set(state,{p:[],n:[],uv:[]});const a=batches.get(state),U=(axis+1)%3,V=(axis+2)%3;
      for(const k of sign>0?[0,1,2,0,2,3]:[0,2,1,0,3,2]){const p=[0,0,0],n=[0,0,0],du=[0,w,w,0][k],dv=[0,0,h,h][k];p[axis]=plane;p[U]=u+du;p[V]=v+dv;n[axis]=sign;a.p.push(...p);a.n.push(...n);a.uv.push(du,dv);}
    }
    await Promise.all([...batches].map(async([state,a])=>{
      const name=m.palette[state].name,geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(a.p,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(a.n,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(a.uv,2));
      const mat=new THREE.MeshLambertMaterial({color:color(name),side:THREE.DoubleSide,clippingPlanes:[clipPlane],clipShadows:true});
      if(/light|glowstone|lantern/.test(name)){mat.emissive.set('#d6ad61');mat.emissiveIntensity=.7;}
      const mesh=new THREE.Mesh(geo,mat);mesh.userData.block=name;mesh.castShadow=true;mesh.receiveShadow=true;g.add(mesh);
      try {let texture=await new THREE.TextureLoader().loadAsync('/assets/erebor-palette/'+name.replace(':','__')+'.png');
        // Rechiseled sheets have five tiles across; its Create add-on uses eight.
        // Show the complete single-block tile; do not stretch the entire CTM atlas.
        const img=texture.image,columns=name.startsWith('rechiseledcreate:')?8:5,n=name.endsWith('_connecting')&&img.width%columns===0?img.width/columns:Math.min(img.width,img.height);
        if(img.width!==n||img.height!==n){const canvas=document.createElement('canvas');canvas.width=canvas.height=n;canvas.getContext('2d').drawImage(img,0,0,n,n,0,0,n,n);texture.dispose();texture=new THREE.CanvasTexture(canvas);}
        texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestMipmapLinearFilter;texture.wrapS=texture.wrapT=THREE.RepeatWrapping;mat.map=texture;mat.color.set('#ffffff');mat.needsUpdate=true;
      }catch{/* readable material color if an exact texture is unavailable */}
    }));return g;
  }
  async function loadRoom(id,{initial=false,preserve=false}={}){
    if(busy)return;busy=true;roomSelect.disabled=true;$('#architecture-enter').disabled=true;renderList();
    $('#architecture-size').textContent='Lade Planblöcke und begehbare Etagen …';
    const previous=selected;
    try{
      const m=await(await api('/api/projects/erebor/architecture/preview?zone='+encodeURIComponent(id)+'&navigation=1')).json();
      const newGroup=await makeGroup(m);dispose(group);group=newGroup;model=m;selected=id;view.scene.add(group);
      const n=m.navigation;nav.setSolid({...n,bits:Uint8Array.from(atob(n.bits),c=>c.charCodeAt(0))});
      view.setBounds(m.bounds[0],m.size);view.grid.position.y=m.bounds[0][1]-.1;view.scene.fog.near=Math.max(...m.size)*3;view.scene.fog.far=Math.max(...m.size)*8;
      const c=m.bounds[0].map((v,i)=>v+m.size[i]/2),span=Math.max(...m.size),k=Math.max(1,1.3/view.camera.aspect);home={pos:[c[0]+span*1.05*k,c[1]+span*.65*k,c[2]+span*.8*k],target:c};
      roomSelect.value=id;floorSelect.innerHTML=n.spawns.map(s=>`<option value="${s.floor}">Laufhöhe Y ${s.floor}</option>`).join('');
      const wanted=initial?Number(hash.get('floor')):88;if(n.spawns.some(s=>s.floor===wanted))floorSelect.value=wanted;
      $('#architecture-title').textContent=id+' · '+m.title;$('#architecture-size').textContent=m.size.join(' × ')+' Blöcke'+(m.partial?' · Teilansicht':'');
      $('#architecture-note').textContent=m.note;$('#edition').innerHTML=`<span class="pill">Architektur R${m.revision}</span><span class="pill">Plan v${m.baseVersion}</span>`;
      $('#clip').min=m.bounds[0][1];$('#clip').max=m.bounds[1][1];setClip(m.bounds[1][1]);
      $('#pois').innerHTML='<h3>Raum betreten</h3>'+n.spawns.map(s=>`<button class="preset" data-floor="${s.floor}">Etage Y ${s.floor}</button>`).join('')+'<p class="project-note">Einstiegspunkte liegen auf einem freien Bodenbereich. Die Grenze der geladenen Raumansicht ist beim Laufen gesperrt; zum nächsten Bereich die Raumauswahl verwenden.</p>';
      $('#pois').onclick=e=>{const b=e.target.closest('[data-floor]');if(b)enter(Number(b.dataset.floor));};
      busy=false;floorSelect.disabled=!n.spawns.length;$('#architecture-enter').disabled=!n.spawns.length;$('#nav-mode [data-mode="walk"]').disabled=!n.spawns.length;
      const saved=(hash.get('cam')||'').split(',').map(Number);
      if(initial&&saved.length===6&&saved.every(Number.isFinite)){nav.setMode(['fly','walk'].includes(hash.get('mode'))?hash.get('mode'):'orbit');nav.lookAt(saved.slice(0,3),saved.slice(3));if(hash.has('cut'))setClip(Number(hash.get('cut')));}
      else if(!preserve){outside();}
      syncNavButtons();saveHash();view.markShadows();loading('Fertig',100);$('#loading').classList.add('done');
    }catch(e){selected=previous;roomSelect.value=previous;$('#architecture-size').textContent='Laden fehlgeschlagen: '+e.message;toast(esc(e.message),0);$('#loading').classList.add('done');}
    finally{busy=false;roomSelect.disabled=false;$('#architecture-enter').disabled=!model?.navigation.spawns.length;renderList();}
  }
  const tip=$('#tooltip'),ray=new THREE.Raycaster();
  view.canvas.addEventListener('pointermove',e=>{
    if(!group||e.buttons||nav.mode!=='orbit'){tip.classList.add('hidden');return;}
    const r=view.canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),view.camera);
    const hit=ray.intersectObjects(group.children).find(h=>h.point.y<=clipPlane.constant);tip.classList.toggle('hidden',!hit);
    if(hit){tip.textContent=hit.object.userData.block;tip.style.left=e.clientX+'px';tip.style.top=e.clientY+'px';}
  });
  view.canvas.addEventListener('pointerleave',()=>tip.classList.add('hidden'));
  const polling=connectPolling({refresh:async()=>{
    const projects=await(await api('/api/projects',{signal:AbortSignal.timeout(20000)})).json();
    if(projects.find(p=>p.id==='erebor')?.version!==data.version)toast('Neue Projektversion verfügbar. <a href="">Ansicht neu laden</a>',0);
  },onState:s=>{$('#refresh-label').textContent=s.phase==='refreshing'?'Prüfe Plan …':s.phase==='error'?'Prüfung fehlgeschlagen':s.phase==='paused'?'Pausiert':`Prüfung in ${s.remainingSeconds} s`;$('#refresh-progress').value=s.progress;$('#refresh-now').disabled=s.phase==='refreshing';}});
  $('#refresh-now').onclick=()=>model?polling.refreshNow():loadRoom(selected);
  let last=performance.now(),hud=0;
  function frame(now){nav.update((now-last)/1000);last=now;view.sky.position.copy(view.camera.position);view.render(1/60);
    if(now-hud>300){const p=view.camera.position;$('#hud').textContent=`Welt ${p.x.toFixed(1)} / ${p.y.toFixed(1)} / ${p.z.toFixed(1)}\n${nav.mode==='orbit'?'Ziehen: drehen · Rechts: schieben · Rad: zoomen':nav.mode==='walk'?'WASD: laufen · Ziehen: umsehen · Leertaste: springen · Shift: schneller':'WASD: fliegen · E: hoch · Q: runter · Ziehen: umsehen'}`;hud=now;}
    requestAnimationFrame(frame);
  }requestAnimationFrame(frame);
  await loadRoom(items.some(i=>i.id===room)?room:'E05',{initial:true});
}
