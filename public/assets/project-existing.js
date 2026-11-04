import { esc, fmt } from './format.js?v=20261104-erebor-rooms-3';
import { coordinateFields, coordinateListText } from './placement.js?v=20261104-erebor-rooms-3';

const states = {built:'Gebaut', ok:'Restarbeiten', conflict:'Konflikt', warning:'Seit Planung geändert', unknown:'Kein Weltvergleich'};
const when = value => value ? new Date(value).toLocaleString('de-DE', {timeZone:'Europe/Berlin', dateStyle:'medium', timeStyle:'short'}) : 'unbekannt';

export function renderExistingProject(target, project, status) {
  const plan=project.plan, ids=new Set(plan.blueprintIds), available=new Map(status.blueprints.map(b=>[b.id,b]));
  const rows=[...ids].map(id=>available.get(id)).filter(Boolean).sort((a,b)=>a.fileName.localeCompare(b.fileName,'de',{numeric:true}));
  const missing=[...ids].filter(id=>!available.has(id));
  const count=state=>rows.filter(b=>b.status===state).length;
  const query=s=>target.querySelector(s);
  document.title=plan.title+' · ATM10 Campus';
  document.getElementById('projectViewerLink').href='/viewer?project='+encodeURIComponent(project.id);
  target.innerHTML=`<div class="project-hero"><p class="project-status">Bestehende Anlage · Laufender Ausbau</p><h1>${esc(plan.title)}</h1><p>${esc(plan.summary)}</p>
    <div class="project-metrics"><div><strong>${fmt(rows.length)}</strong><span>verknüpfte Baupläne</span></div><div><strong>${fmt(count('built'))}</strong><span>laut Weltvergleich gebaut</span></div><div><strong>${fmt(count('conflict'))}</strong><span>mit Konflikten</span></div><div><strong>${fmt(count('warning'))}</strong><span>seit Planung geändert</span></div></div></div>
    <nav class="project-nav" aria-label="Projektbereiche"><a href="#campus-blueprints">Baupläne und Koordinaten</a><a href="/viewer?project=${encodeURIComponent(project.id)}">Campus in 3D</a><a href="/app#cannons">Kanonen verwalten</a></nav>
    <p class="project-note">Weltstand: ${esc(when(status.live?.worldTime))} (Berlin), erfasst ${esc(when(status.live?.capturedAt))}${status.live?' · Aufnahme #'+Number(status.live.id):''}. Der Fortschritt vergleicht die aktuellen Baupläne mit dieser gespeicherten Aufnahme. Spätere Änderungen im Spiel sind darin noch nicht enthalten.</p>
    ${missing.length?`<p class="err">${missing.length} verknüpfte Baupläne fehlen im aktuellen Bestand oder sind archiviert: ${missing.map(esc).join(', ')}.</p>`:''}
    <section id="campus-blueprints" class="project-section"><h2>Baupläne und Einsetzkoordinaten</h2><p>Die vorhandenen Schematics bleiben miteinander verknüpft. Downloads und Koordinaten beziehen sich immer auf die hier angezeigte aktuelle Version.</p><p><strong>X / Y / Z ist der Bauplan-Anker. Drehung 0°, Spiegelung keine.</strong></p>
    <div class="map-tools"><label>Bauplan suchen <input id="campusSearch" placeholder="z. B. Hall of Fame, AE2 oder Wege"></label><label>Anzeige <select id="campusFilter"><option value="">Alle</option value="built">Gebaut</option value="pending">Mit Restarbeiten oder Hinweisen</option value="conflict">Konflikte</option></select></label><button id="campusCoordinates">Koordinatenliste herunterladen</button></div>
    <p id="campusCount" class="muted" role="status"></p><div class="project-table"><table><thead><tr><th>Bauplan</th><th>Version</th><th>Fortschritt / Status</th><th>X / Y / Z</th><th>Öffnen / Laden</th></tr></thead><tbody id="campusRows"></tbody></table></div></section>`;
  function draw() {
    const q=query('#campusSearch').value.trim().toLowerCase(), filter=query('#campusFilter').value;
    const visible=rows.filter(b=>(!q||`${b.name} ${b.fileName}`.toLowerCase().includes(q))&&(!filter||(filter==='pending'?b.status!=='built':b.status===filter)));
    query('#campusCount').textContent=`${visible.length} von ${rows.length} Bauplänen`;
    query('#campusRows').innerHTML=visible.map(b=>`<tr><td><strong>${esc(b.name)}</strong><br><small>${esc(b.fileName)}</small></td><td>v${Number(b.version)}</td><td>${b.progress==null?'—':Number(b.progress).toLocaleString('de-DE')+' %'}<br><span class="badge ${Object.hasOwn(states,b.status)?b.status:'unknown'}">${esc(states[b.status]||b.status)}</span></td><td>${coordinateFields(b)}</td><td><a href="/viewer?project=${encodeURIComponent(project.id)}#bp=${encodeURIComponent(b.id)}">3D-Ansicht</a><br><a href="/api/blueprints/${encodeURIComponent(b.id)}/materials?format=html">Materialien</a><br><a href="/api/blueprints/${encodeURIComponent(b.id)}/download?version=${Number(b.version)}">NBT v${Number(b.version)}</a></td></tr>`).join('')||'<tr><td colspan="5">Keine passenden Baupläne.</td></tr>';
  }
  query('#campusSearch').addEventListener('input',draw);
  query('#campusFilter').addEventListener('change',draw);
  query('#campusRows').addEventListener('click',async e=>{
    const button=e.target.closest('[data-copy-coordinate]'); if(!button)return;
    try { await navigator.clipboard.writeText(button.dataset.copyCoordinate);query('#campusCount').textContent='Koordinate kopiert: '+button.dataset.copyCoordinate; }
    catch { query('#campusCount').textContent='Bitte manuell übernehmen: '+button.dataset.copyCoordinate; }
  });
  query('#campusCoordinates').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([coordinateListText(rows)],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download='CAMPUS_KOORDINATEN_AKTUELL.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
  });
  draw();
}
