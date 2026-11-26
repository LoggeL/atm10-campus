import {esc} from './format.js?v=20261125-overhaul-1';
import {projectHero,projectNav,projectSection as section} from './project-shell.js?v=20261125-overhaul-1';
import {areaZones,areaPackages} from './project-areas.js?v=20261125-overhaul-1';

const viewer=id=>`/viewer?project=erebor&room=${encodeURIComponent(id)}`;
const count=n=>Number(n).toLocaleString('de-DE');
function catalog(packages) {
 if(!packages)return '<p class="project-note">Veröffentlichungsstand unbekannt · Baupläne konnten nicht geladen werden. Bitte aktualisieren.</p>';
 if(!packages.length)return '<p class="project-note">Für diesen Bereich sind noch keine aktuellen Pakete veröffentlicht. Kein leerer Fortschritt wird als abgeschlossen gewertet.</p>';
 return packages.map(p=>{
  const base=`/api/projects/erebor/architecture/${encodeURIComponent(p.id)}`;
  const query=`?version=${p.version}&revision=${p.revision}`;
  return `<details class="project-disclosure" id="plan-${esc(p.id)}"><summary>${esc(p.id)} · ${esc(p.title)} · ${p.files.length} Dateien</summary><p><a class="c-btn c-btn--sm" href="${esc(base+'.zip'+query)}" download>Paket als ZIP</a> <a class="c-btn c-btn--ghost c-btn--sm" href="${esc(viewer(p.group))}">${esc(p.group)} in 3D</a></p><div class="project-table"><table><thead><tr><th>Bauplan</th><th>Plan-Anker X / Y / Z</th><th>Quelle im Katalog</th><th>Download</th></tr></thead><tbody>${p.files.map(f=>`<tr><td>${f.kind==='clear'?'Aushub':'Bau'} · ${esc(f.fileName)}<small>${count(f.blocks)} ${f.kind==='clear'?'Luftzellen':'Planblöcke brutto'}</small></td><td class="c-mono">${esc(f.origin?.join(' / ')||'unbekannt')}</td><td>${esc(f.cannon)}</td><td><a href="${esc(base+'/'+encodeURIComponent(f.id)+'.nbt'+query)}" download>NBT</a></td></tr>`).join('')}</tbody></table></div></details>`;
 }).join('');
}
export function areaHome({project,area,architecture,mapHtml}) {
 const zones=areaZones(project,area),packages=architecture?.baseVersion===project.version?areaPackages(architecture.packages,area):null;
 const files=packages?.flatMap(p=>p.files);
 const links=area.zones.map(id=>`<a class="c-btn c-btn--sm" href="${esc(viewer(id))}">${esc(id)} · ${id==='E25'?'Wasserstadt':'Brücke'} in 3D</a>`).join('');
 return projectHero({
  status:`Teilbereich · Erebor · Projektversion ${project.version}`,
  title:area.title,summary:area.summary,
  actions:'<a class="c-btn c-btn--primary" href="#plans">Baupläne öffnen</a><a class="c-btn" href="#fleet">Kanonenplätze</a><a class="c-btn c-btn--ghost" href="/projects?id=erebor">Erebor-Gesamtprojekt</a>',
  metrics:[
   [zones.map(z=>z.id).join(' / ')||'unbekannt','Esgaroth und Uferbrücke · Teilbereich Erebor'],
   [packages?count(packages.length)+' Pakete':'unbekannt','nur aktuelle Veröffentlichungen dieses Bereichs'],
   [files?count(files.length)+' Baupläne':'unbekannt','Bau und Aushub getrennt im Katalog'],
   ['P01 / P03','Belegte Plätze einzeln unten · P02 nicht in Betrieb'],
  ],
 })+projectNav([['overview','Übersicht'],['layout','Karte & 3D'],['plans','Baupläne E25 / E26'],['fleet','Kanonenplätze']])+
 section('overview','Wasserstadt · Esgaroth und Brücke',`<p>Die Übersicht umfasst Esgaroth und die Uferbrücke aus der gemeinsamen Erebor-Projektversion. Die Karte zeigt den Entwurf; der Stationsstand unten unterscheidet aktuelle Messungen von beibehaltenen Beobachtungen.</p><div class="project-cards">${zones.map(z=>`<article class="project-card"><h3>${esc(z.id)} · ${esc(z.title)}</h3><p>${esc((z.features||[]).join(' · '))}</p><a class="c-btn c-btn--sm" href="${esc(viewer(z.id))}">Bereich in 3D ansehen</a></article>`).join('')||'<p>Bereichsgeometrie unbekannt.</p>'}</div>`,true)+
 section('layout','Karte, Grundriss und 3D',`<p>Direkter Ausschnitt auf Esgaroth und die Brücke, unabhängig vom Berg-Zoom des Gesamtprojekts. Entwurfsvolumen, kein Nachweis bereits gesetzter Blöcke. P01/P03 markieren die tatsächlichen belegten Plätze; ihre Höhe und Beobachtung stehen in den Karten unten.</p><div class="row">${links}</div>${mapHtml}`,true)+
 section('plans','Baupläne · E25 Wasserstadt / E26 Brücke',`<p>Nur veröffentlichte Pakete der aktuellen Erebor-Version. AP-Quellschlüssel im Katalog sind keine neue Zuordnung zu physischen P-Plätzen. Aushub und Bau bleiben getrennt; Downloads starten oder wechseln keine Kanone.</p>${catalog(packages)}`,true)+
 section('fleet','Belegte Kanonenplätze · P01 und P03',`<p class="project-note">Nur Statusansicht: Die sechs bestehenden Reservierungen bleiben belegt und vom allgemeinen Scheduler ausgeschlossen. Keine Start-, Wechsel-, Materialfreigabe oder Ablaufverlängerung. P02 ist nicht in Betrieb.</p><p><a class="c-btn c-btn--sm" href="/erebor/aufstellung">Aufstellung &amp; Hardware</a></p><p id="wc-status" role="status">Lade geschützten Stationsstand …</p><div id="wc-fleet" aria-live="polite"></div>`,true);
}
