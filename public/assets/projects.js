const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list = items => `<ul>${(items || []).map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`;
const section = (id,title,body) => `<section id="${id}" class="project-section"><h2>${title}</h2>${body}</section>`;
let current = null, selected = null, floor = '0', zoom = 1;
const safeUrl = v => { try { const u=new URL(v); return u.protocol==='https:'?u.href:'#'; } catch { return '#'; } };
async function api(url) { const r=await fetch(url,{cache:'no-store'}); if(r.status===401){location.assign('/login');throw Error('Bitte anmelden.');} if(!r.ok)throw Error(`Bauprojekt konnte nicht geladen werden (${r.status}).`); return r.json(); }
const color = id => { const c=current.plan.styles?.find(s=>s.id===id)?.color; return /^#[0-9a-f]{6}$/i.test(c || '')?c:'#81949c'; };
const dimensions = z => [0,2,1].map(i=>z.bounds[1][i]-z.bounds[0][i]).join(' × ');
function map() {
  const p=current.plan, all=floor==='all', y=Number(floor), visible=p.zones.filter(z=>all || z.bounds[0][1]<=y && z.bounds[1][1]>y);
  const minX=Math.min(-320,...p.zones.map(z=>z.bounds[0][0]))-30, maxX=Math.max(320,...p.zones.map(z=>z.bounds[1][0]))+30, minZ=Math.min(...p.zones.map(z=>z.bounds[0][2]))-40, maxZ=Math.max(...p.zones.map(z=>z.bounds[1][2]))+50;
  const label=all?'Gesamtlage: übereinanderliegende Räume sind transparent.':`Laufhöhe ${y}: gestrichelt = offener Hallenraum ohne durchgehenden Boden auf dieser Höhe.`;
  $('#mapLabel').textContent=label;
  $('#mapDrawing').innerHTML=`<svg role="img" aria-label="Erebor Grundriss, Norden oben" viewBox="${minX} ${minZ} ${maxX-minX} ${maxZ-minZ}" style="width:${zoom*100}%">
    <defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#283744" stroke-width=".6"/></pattern></defs>
    <rect x="${minX}" y="${minZ}" width="${maxX-minX}" height="${maxZ-minZ}" fill="url(#grid)"/>
    <path d="M0 ${minZ+16}V${maxZ-26}" stroke="#b0a071" stroke-width="1" stroke-dasharray="5 6"/>
    ${visible.map(z=>{const [a,b]=z.bounds,walk=all||z.floors.includes(y);return `<g class="map-room ${z.id===selected?'selected':''}" data-room="${esc(z.id)}" tabindex="0" role="button" aria-label="${esc(z.id+' '+z.title)}"><title>${esc(z.id+' · '+z.title+' · '+dimensions(z))}</title><rect class="${walk?'':'map-void'}" x="${a[0]}" y="${a[2]}" width="${b[0]-a[0]}" height="${b[2]-a[2]}" rx="2" fill="${color(z.style)}" fill-opacity="${all ? .36 : walk ? .55 : .10}" stroke="${color(z.style)}" stroke-width="1.4"/><text x="${(a[0]+b[0])/2}" y="${(a[2]+b[2])/2+5}" text-anchor="middle">${esc(z.id)}</text></g>`}).join('')}
    <g class="map-axis"><text x="${minX+16}" y="${minZ+22}">N ↑ / −Z</text><text x="${maxX-140}" y="${minZ+22}">Ost → +X</text><text x="8" y="18">Toranker (0, 0, 0)</text><path d="M${minX+20} ${maxZ-24}h128" stroke="#b8c5cf" stroke-width="3"/><text x="${minX+20}" y="${maxZ-34}">128 Blöcke · Raster 32</text></g></svg>`;
  for(const node of document.querySelectorAll('[data-room]')) { const select=()=>{selected=node.dataset.room;map();details();};node.addEventListener('click',select);node.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}}); }
  document.querySelectorAll('[data-zone]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.zone===selected)));
}
function details() {
  const z=current.plan.zones.find(z=>z.id===selected); if(!z)return;
  $('#roomInfo').innerHTML=`<p class="eyebrow">${esc(z.id)} · Planungsvolumen</p><h3>${esc(z.title)}</h3><p><strong>${dimensions(z)} Blöcke</strong> <span class="muted">(Breite × Länge × Höhe)</span></p><p class="mono">X ${z.bounds[0][0]} … ${z.bounds[1][0]-1}<br>Z ${z.bounds[0][2]} … ${z.bounds[1][2]-1}<br>Block-Y ${z.bounds[0][1]} … ${z.bounds[1][1]-1}</p><p>Laufhöhen: <strong>${esc(z.floors.join(' / '))}</strong></p>${list(z.features)}`;
}
function crossSection() {
  const ids=['E03','E02','E05','E06','E07','E08','E10'];
  return `<div class="section-frame"><svg viewBox="-830 -250 1070 425" role="img" aria-label="Mittlerer Längsschnitt durch Erebor, Norden links"><path d="M-820 0L-760 -90L-660 -150L-560 -180L-440 -225L-300 -188L-180 -160L-70 -146L0 -136L100 0L180 12" fill="#ffffff08" stroke="#84918a" stroke-width="2"/><text x="-812" y="-224">Nord · innen</text><text x="100" y="-224">Süd · Tor</text>
  ${[-128,-96,-64,0,32,64,128,224].map(y=>`<path d="M-815 ${-y}H195" stroke="#455563" stroke-width=".7" stroke-dasharray="3 5"/><text x="200" y="${-y+4}">${y}</text>`).join('')}
  ${current.plan.zones.filter(z=>ids.includes(z.id)).map(z=>{const [a,b]=z.bounds;return `<rect x="${a[2]}" y="${-b[1]}" width="${b[2]-a[2]}" height="${b[1]-a[1]}" fill="${color(z.style)}" fill-opacity=".42" stroke="${color(z.style)}"/>${z.floors.map(f=>`<path d="M${a[2]} ${-f}H${b[2]}" stroke="#edce87" stroke-width="1.7"/>`).join('')}<text text-anchor="middle" x="${(a[2]+b[2])/2}" y="${-(a[1]+b[1])/2}">${z.id}</text>`}).join('')}<text x="-812" y="163">Gelb = Laufhöhen. Nur Räume auf X0; Seitenflügel sind im Grundriss sichtbar. Felsprofil ist schematisch.</text></svg></div>`;
}
function render() {
  const p=current.plan; document.title=p.title+' · ATM10 Campus';
  if(!Array.isArray(p.zones)||!p.envelope) { $('#content').innerHTML=`<h1>${esc(p.title)}</h1><p>${esc(p.summary)}</p><pre>${esc(JSON.stringify(p,null,2))}</pre>`;return; }
  const integer = v => Number.isSafeInteger(v) && Math.abs(v) <= 1000000;
  if(!p.zones.length || p.zones.length > 1000 || p.zones.some(z=>!Array.isArray(z.bounds)||z.bounds.length!==2||z.bounds.some(v=>!Array.isArray(v)||v.length!==3||!v.every(integer))||z.bounds[0].some((v,i)=>v>=z.bounds[1][i])||!Array.isArray(z.floors)||!z.floors.every(integer)) || !Array.isArray(p.levels) || p.levels.some(l=>!integer(l.y))) throw Error('Der Grundriss enthält ungültige Maß- oder Höhenangaben.');
  $('#modelLink')?.remove();
  if(p.blockPreview){const link=document.createElement('a');link.id='modelLink';link.className='btn primary';link.href='/assets/project-model.html?id='+encodeURIComponent(current.id);link.textContent='Minecraft-Blockvorschau öffnen';document.querySelector('.project-toolbar .row').prepend(link);}
  selected=p.zones.some(z=>z.id===selected)?selected:'E05';
  $('#content').innerHTML=`<div class="project-hero"><p class="project-status">Masterplan · Standort offen · Version ${current.version}</p><h1>${esc(p.title)}</h1><p>${esc(p.summary)}</p><div class="project-metrics"><div><strong>1.200 × 1.200</strong><span>Bergmassiv in Blöcken</span></div><div><strong>600 × 800</strong><span>Reservat der unterirdischen Stadt</span></div><div><strong>${p.packages.length} Bauabschnitte</strong><span>mit Reihenfolge und Raumprogramm</span></div><div><strong>−128 bis +224</strong><span>lokale Blockhöhen</span></div></div></div>
  <nav class="project-nav" aria-label="Projektbereiche">${[['layout','Grundriss'],['height','Höhen'],['palette','Materialien'],['packages','Bauumfang'],['routes','Wege'],['phases','Baufolge'],['export','Schematics'],['sources','Referenzen']].map(([id,n])=>`<a href="#${id}">${n}</a>`).join('')}</nav>
  <p class="project-note">${esc(p.scope)}</p>
  ${section('layout','01 · Grundriss und Raumprogramm',`<p>Ein Baufeld anklicken oder unten auswählen. Alle Maße sind lokal. Der Grundriss zeigt reservierte Raumhüllen, keine bereits gesetzten Minecraft-Blöcke.</p><div class="map-tools"><label>Ebene <select id="floor"><option value="all">Gesamtlage · alle Ebenen</option>${p.levels.map(l=>`<option value="${l.y}">Y ${l.y} · ${esc(l.title)}</option>`).join('')}</select></label><label>Vergrößerung <select id="zoom"><option value="1">100 %</option><option value="1.5">150 %</option><option value="2">200 %</option></select></label></div><p id="mapLabel" class="muted"></p><div class="legend">${p.styles.map(s=>`<span style="--swatch:${color(s.id)}">${esc(s.name)}</span>`).join('')}</div><div class="project-map-layout"><div><div class="map-frame" id="mapDrawing"></div><div class="project-room-list">${p.zones.map(z=>`<button data-zone="${esc(z.id)}" aria-pressed="false" title="${esc(z.title)}">${esc(z.id)} · ${esc(z.title)}</button>`).join('')}</div></div><aside class="map-room-info" id="roomInfo" aria-live="polite"></aside></div>`)}
  ${section('height','02 · Höhen und gemeinsame Bauachse',`<p>${esc(p.envelope.note)}</p>${crossSection()}<div class="project-cards">${Object.entries(p.coordinateSystem).map(([k,t])=>`<div class="project-card"><h3>${esc(({origin:'Nullpunkt',axes:'Richtung',bounds:'Maße lesen',floors:'Boden und Laufhöhe',placement:'Spätere Weltposition'})[k]||k)}</h3><p>${esc(t)}</p></div>`).join('')}</div>`)}
  ${section('palette','03 · Steingrau, Jade und kräftiges Gold',`<p>Original-Blockbilder aus der lokalen ATM10-Instanz. Connecting-Varianten sind ausdrücklich markiert. Die Anteile beziehen sich auf sichtbare Flächen, nicht auf exakte Materialmengen.</p><div class="project-cards">${p.styles.filter(s=>!['rock','circulation','technical'].includes(s.id)).map(s=>`<div class="project-card" style="border-top:3px solid ${color(s.id)}"><h3>${esc(s.name)}</h3><p>${esc(s.use)}</p><p class="tag">${esc(s.ratio)}</p><p>${esc(s.rule)}</p></div>`).join('')}</div><div class="palette-grid">${p.palette.map(b=>`<div class="palette-item">${/^[a-z0-9_]+:[a-z0-9_]+$/.test(b.id)?`<img src="/assets/project-blocks/${b.id.replace(':','__')}.png" alt="${esc(b.name)}" loading="lazy" width="64" height="64">`:''}<div><strong>${esc(b.name)}</strong><small class="${b.connecting?'connecting':'no-connecting'}">${b.connecting?'CONNECTING AN':'Keine Connecting-Variante'}</small><small>${esc(b.use)}</small></div><code>${esc(b.id)}</code></div>`).join('')}</div>`)}
  ${section('packages','04 · Vollständiger Bauumfang',`<p>${esc(p.provenance)}</p><div class="project-table"><table><thead><tr><th>Teil</th><th>Was gebaut wird</th><th>Phase</th></tr></thead><tbody>${p.packages.map(s=>`<tr><td>${esc(s.id)}</td><td><strong>${esc(s.title)}</strong><p>${esc(s.work)}</p><small>${esc(s.basis)}</small></td><td>${esc(s.phase)}</td></tr>`).join('')}</tbody></table></div><h3 style="margin-top:24px">Verbindliche Gestaltungsregeln</h3><ol class="project-rules">${p.rules.map(r=>`<li>${esc(r)}</li>`).join('')}</ol>`)}
  ${section('routes','05 · Wege, Türen und Höhenwechsel',`<p>Die Verbindungen legen Breite, Richtung und Anschlusshöhe fest. Ihre genaue Blockgeometrie folgt mit den Schematics.</p><div class="project-table"><table><thead><tr><th>Verbindung</th><th>Breite</th><th>Führung</th></tr></thead><tbody>${p.connections.map(c=>`<tr><td>${esc(c.a)} ↔ ${esc(c.b)}</td><td>${esc(c.width)}</td><td>${esc(c.description)}</td></tr>`).join('')}</tbody></table></div>`)}
  ${section('phases','06 · Baufolge mit klaren Zwischenständen',`<div class="project-cards">${p.phases.map(s=>`<div class="project-card"><p class="tag">PHASE ${esc(String(s.n).padStart(2,'0'))}</p><h3>${esc(s.title)}</h3>${list(s.tasks)}<p><strong>Fertig, wenn:</strong> ${esc(s.exit)}</p></div>`).join('')}</div>`)}
  ${section('export','07 · Aufteilung für die späteren Schematics',`<div class="project-cards">${Object.entries(p.schematicStrategy).map(([k,v])=>`<div class="project-card"><h3>${esc(({grid:'Modulgröße',naming:'Eindeutige Dateinamen',ownership:'Saubere Nahtstellen',layers:'Getrennte Baupakete',air:'Bauen und Aushub',release:'Veröffentlichung',materials:'Materialmengen'})[k]||k)}</h3>${Array.isArray(v)?list(v):`<p>${esc(v)}</p>`}</div>`).join('')}</div><p class="project-note">${esc(p.validation.notes)}</p>`)}
  ${section('sources','08 · Referenzen und getroffene Entscheidungen',`${list(p.decisions)}<ul class="source-list">${p.sources.map(s=>`<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><small>${esc(s.use)}</small></li>`).join('')}</ul><p class="muted">Gespeichert über die Campus-API: ${esc(new Date(current.updatedAt).toLocaleString('de-DE'))}. Planung und bestehende Welt-Baupläne werden getrennt geführt.</p>`)}`;
  $('#floor').value=floor;$('#zoom').value=String(zoom);
  $('#floor').addEventListener('change',e=>{floor=e.target.value;map();});
  $('#zoom').addEventListener('change',e=>{zoom=Number(e.target.value);map();});
  document.querySelectorAll('[data-zone]').forEach(el=>el.addEventListener('click',()=>{selected=el.dataset.zone; const z=p.zones.find(z=>z.id===selected);if(floor!=='all'&&!(z.bounds[0][1]<=Number(floor)&&z.bounds[1][1]>Number(floor))){floor=String(z.floors[0]);$('#floor').value=floor;}map();details();}));
  map();details();
}
async function load() {
  $('#error').textContent='';$('#reload').disabled=true;
  try {
    const id=new URL(location.href).searchParams.get('id');
    if(!id) { current=null; const all=await api('/api/projects');$('#content').innerHTML=`<h1>Bauprojekte</h1><p class="muted">Planungen vor der Weltplatzierung. Fertige Schematics stehen später unter Baupläne.</p><div class="project-cards">${all.map(p=>`<a class="project-card" href="/projects?id=${encodeURIComponent(p.id)}"><p class="tag">MASTERPLAN · V${p.version}</p><h2>${esc(p.title)}</h2><p>${esc(p.summary)}</p></a>`).join('')||'<p>Noch keine Bauprojekte vorhanden.</p>'}</div>`;}
    else { current=await api('/api/projects/'+encodeURIComponent(id));render(); }
    $('#download').hidden=!current;$('#print').hidden=!current;
  } catch(e) { $('#error').textContent=e.message; $('#content').textContent=''; }
  finally { $('#reload').disabled=false; }
}
$('#reload').addEventListener('click',load);
$('#print').addEventListener('click',()=>window.print());
$('#download').addEventListener('click',()=>{if(!current)return; const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=current.id+'-masterplan-v'+current.version+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
load();
