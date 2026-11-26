import { esc } from './format.js?v=20261125-overhaul-1';
import { api, copyText } from './campus-client.js?v=20261125-overhaul-1';
import { withWorldCoordinates } from './project-coordinates.js?v=20261125-overhaul-1';
import { installStoneControls, buildingModsHtml } from './project-stone-ui.js?v=20261125-overhaul-1';
import { renderExistingProject } from './project-existing.js?v=20261125-overhaul-1';
import { coordinateFields } from './placement.js?v=20261125-overhaul-1';
import { landscapeView } from './erebor-landscape.js?v=20261125-overhaul-1';

import {projectHero, projectNav, projectSection as section} from './project-shell.js?v=20261125-overhaul-1';
import {projectEntries, areaFromUrl, projectMapData, PROJECT_AREAS} from './project-areas.js?v=20261125-overhaul-1';
import {areaLinks,projectMapBody} from './project-map-view.js?v=20261125-overhaul-1';
import {areaHome} from './project-area-view.js?v=20261125-overhaul-1';
import {mountWatercity} from './watercity.js?v=20261125-overhaul-1&revision=20261126-area-1';

const $ = (s) => document.querySelector(s);
const list = (items) => `<ul>${(items || []).map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

let current = null;
let activeArea = null, watercity = null, stopWatercity = null;
const mapData = () => projectMapData(current, activeArea, watercity?.slots || [], mapScope);
let selected = null;
let floor = '0';
let zoom = 1;
let selectedCannon = null;
let showCannons = true;
let mapScope = 'mountain';
let navObserver = null;

const safeUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' ? u.href : '#';
  } catch {
    return '#';
  }
};

const color = (id) => {
  const c = current.plan.styles?.find((s) => s.id === id)?.color;
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#81949c';
};

const dimensions = (z) => [0, 2, 1].map((i) => z.bounds[1][i] - z.bounds[0][i]).join(' × ');
const placed = () => Array.isArray(current?.plan.worldOrigin);
const boundsOf = (z) => (placed() && z.worldBounds ? z.worldBounds : z.bounds);
const floorsOf = (z) => (placed() && z.worldFloors ? z.worldFloors : z.floors);

function setViewerLink(href) {
  const viewerLink = document.getElementById('viewerLink') || document.getElementById('projectViewerLink');
  if (viewerLink) viewerLink.href = href;
}

function wireStickyNav() {
  if (navObserver) {
    navObserver.disconnect();
    navObserver = null;
  }
  const links = [...document.querySelectorAll('.project-nav a[href^="#"]')];
  if (!links.length || typeof IntersectionObserver === 'undefined') return;
  const targets = links
    .map((a) => ({ a, el: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter((entry) => entry.el);
  if (!targets.length) return;
  const activate = (id) => {
    for (const { a, el } of targets) {
      if (el.id === id) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  };
  navObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) activate(visible[0].target.id);
    },
    { rootMargin: '-120px 0px -60% 0px', threshold: 0 },
  );
  for (const { el } of targets) navObserver.observe(el);
  for (const { a, el } of targets) {
    a.addEventListener('click', () => activate(el.id));
  }
}

function map() {
  const p = current.plan;
  const all = floor === 'all';
  const y = Number(floor) + (placed() ? p.worldOrigin[1] : 0);
  const {zones,stations,boxes}=mapData();
  if(!boxes.length){$('#mapDrawing').textContent='Bereichsgeometrie unbekannt.';return;}
  const visible = zones.filter((z) => {
    const b = boundsOf(z);
    return all || (b[0][1] <= y && b[1][1] > y);
  });

  const minX = Math.min(...boxes.map((b) => b[0][0])) - 100;
  const maxX = Math.max(...boxes.map((b) => b[1][0])) + 100;
  const minZ = Math.min(...boxes.map((b) => b[0][2])) - 120;
  const maxZ = Math.max(...boxes.map((b) => b[1][2])) + 100;
  $('#mapLabel').textContent =
    (placed() ? 'Weltkoordinaten · Norden oben · ' : 'Lokale Koordinaten · ') +
    (all
      ? 'Gesamtlage mit überlagerten Raumvolumen.'
      : `Laufhöhe Y${y}; gestrichelt = offener Raum ohne Boden auf dieser Ebene.`);
  const terrain = ((placed() ? p.site?.terrainSamples : []) || []).filter(([x,z])=>x>=minX&&x<=maxX&&z>=minZ&&z<=maxZ);
  const [gx, , gz] = p.worldOrigin || [0, 0, 0];
  $('#mapDrawing').innerHTML = `<svg role="group" aria-label="${esc(activeArea?.title || p.title)} Standortplan, Norden oben" viewBox="${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}" style="width:${zoom * 100}%">
   <defs><pattern id="grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M64 0H0V64" fill="none" stroke="#293b33" stroke-width="1"/></pattern></defs>
   <rect x="${minX}" y="${minZ}" width="${maxX - minX}" height="${maxZ - minZ}" fill="url(#grid)"/>
   ${terrain.map(([x, z, h, w]) => `<rect x="${x - 16}" y="${z - 16}" width="32" height="32" fill="${w ? '#2b6b8c' : `hsl(140 16% ${Math.max(16, Math.min(58, h / 3))}%)`}" opacity=".48"/>`).join('')}
   ${placed() && !activeArea ? `<ellipse cx="${p.mountainFill?.peak?.[0] ?? gx}" cy="${p.mountainFill?.peak?.[2] ?? gz}" rx="${(p.envelope.worldBounds[1][0] - p.envelope.worldBounds[0][0]) / 2}" ry="${(p.envelope.worldBounds[1][2] - p.envelope.worldBounds[0][2]) / 2}" fill="#f2be6b12" stroke="#f2be6b" stroke-width="5" stroke-dasharray="15 12"/>` : ''}
   ${visible
     .map((z) => {
       const [a, b] = boundsOf(z);
       const walk = all || floorsOf(z).includes(y);
       const poly = placed() && z.worldFootprint;
       return `<g class="map-room ${z.id === selected ? 'selected' : ''}" data-room="${esc(z.id)}" tabindex="0" role="button" aria-label="${esc(z.id + ' ' + z.title)}"><title>${esc(z.id + ' · ' + z.title + ' · ' + dimensions(z))}</title>${poly ? `<polygon points="${poly.map((v) => v.join(',')).join(' ')}"` : `<rect x="${a[0]}" y="${a[2]}" width="${b[0] - a[0]}" height="${b[2] - a[2]}"`} class="${walk ? '' : 'map-void'}" fill="${color(z.style)}" fill-opacity="${all ? 0.3 : walk ? 0.55 : 0.1}" stroke="${color(z.style)}" stroke-width="${placed() ? 3 : 1.4}"/><text x="${(a[0] + b[0]) / 2}" y="${(a[2] + b[2]) / 2 + 6}" text-anchor="middle" style="font-size:${placed() ? 22 : 14}px">${esc(z.id)}</text></g>`;
     })
     .join('')}
   ${(placed() ? p.site?.protectedAreas : [])?.filter(q=>q.bounds[0][0]<maxX&&q.bounds[1][0]>minX&&q.bounds[0][2]<maxZ&&q.bounds[1][2]>minZ).map((q) => {
     const [a, b] = q.bounds;
     return `<rect x="${a[0]}" y="${a[2]}" width="${b[0] - a[0]}" height="${b[2] - a[2]}" fill="none" stroke="#f08c84" stroke-width="4" stroke-dasharray="10 6"><title>${esc(q.title)}</title></rect>`;
   }).join('') || ''}
   <g class="map-axis" style="font-size:${placed() ? 30 : 14}px"><text x="${minX + 16}" y="${minZ + 42}">N ↑ / −Z · Ost → +X</text>${!activeArea?`<circle cx="${gx}" cy="${gz}" r="${placed()?12:3}" fill="#f2be6b"/><text x="${gx+18}" y="${gz-24}">Tor ${placed()?p.worldOrigin.join(' / '):'(0, 0, 0)'}</text>`:''}<path d="M${minX + 20} ${maxZ - 24}h128" stroke="#8ea397" stroke-width="5"/><text x="${minX + 20}" y="${maxZ - 40}">128 Blöcke</text></g>
   ${
     showCannons
       ? stations
           .map((s) => {
             const [x, yPos, z] = s.position;
             const kind = s.survey?.known === false ? 'unknown' : s.survey?.block === 'minecraft:water' ? 'water' : 'normal';
             return `<g class="map-cannon ${kind} ${s.id === selectedCannon ? 'selected' : ''}" data-cannon="${esc(s.id)}" transform="translate(${x} ${z})" tabindex="0" role="button" aria-pressed="${s.id === selectedCannon}" aria-label="Kanone ${esc(s.id)}, X ${x}, Y ${yPos}, Z ${z}"><title>${esc(s.id + ' · X ' + x + ' / Y ' + yPos + ' / Z ' + z + ' · ' + s.setup)}</title><circle class="cannon-halo" r="70"/><path d="M0 -35V0"/><circle class="cannon-dot" r="13"/><rect x="-55" y="-85" width="110" height="54" rx="12"/><text x="0" y="-46" text-anchor="middle">${esc(s.id)}</text></g>`;
           })
           .join('')
       : ''
   }
   ${activeArea?(watercity?.slots||[]).map(s=>`<a href="#slot-${esc(s.key)}" aria-label="${esc(s.key)} · Statuskarte"><circle cx="${s.position[0]}" cy="${s.position[2]}" r="5" fill="#7ee0a8"><title>${esc(s.key)} · Y ${s.position[1]}</title></circle></a>`).join('')+(watercity?.groups||[]).filter(g=>g.commissioned).map(g=>`<a href="#slot-${esc(g.id)}A"><text x="${g.computer[0]}" y="${g.computer[2]-18}" text-anchor="middle" style="font-size:18px;fill:#7ee0a8">${esc(g.id)} · Y ${g.computer[1]}</text></a>`).join(''):''}</svg>`;
  for (const node of document.querySelectorAll('[data-room]')) {
    const select = () => {
      selectedCannon = null;
      selected = node.dataset.room;
      map();
      details();
    };
    node.addEventListener('click', select);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  }
  for (const node of document.querySelectorAll('[data-cannon]')) {
    const select = () => {
      const id = node.dataset.cannon;
      selectCannon(id);
      $('#mapDrawing [data-cannon="' + id + '"]')?.focus({ preventScroll: true });
    };
    node.addEventListener('click', select);
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select();
      }
    });
  }
  document.querySelectorAll('[data-zone]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.zone === selected)));
}

function details() {
  const s = mapData().stations.find((st) => st.id === selectedCannon);
  if (s) {
    $('#roomInfo').innerHTML = `<p class="c-eyebrow">Geplanter Kanonenstandort</p><h3>${esc(s.id)}${s.id === current.plan.cannonLayout.nearEntrance ? ' · Start nahe dem Tor' : ''}</h3>${coordinateFields({ origin: s.position })}<p><strong>Y ${s.position[1]} ist der Kanonenblock.</strong><br>Fundament darunter: Y ${s.position[1] - 1}.</p><p class="project-note">${esc(s.setup)}</p><p>${Number(s.assigned).toLocaleString('de-DE')} zugeordnete Steinabschnitte.</p><p class="muted">Bauplatzaufnahme vom ${esc(new Date(s.survey?.capturedAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }))} (Berlin). Geplanter Standort, keine bestätigte Kanone im Spiel.</p><div class="row"><button id="copyCannon" type="button" class="c-btn c-btn--sm">X / Y / Z kopieren</button><a class="c-btn c-btn--ghost c-btn--sm" href="#cannon-sites">Standortliste</a></div><p id="cannonCopyStatus" class="muted" role="status"></p>`;
    const copy = async (text) => {
      try {
        const ok = await copyText(text);
        $('#cannonCopyStatus').textContent = ok ? 'Kopiert: ' + text : 'Bitte manuell übernehmen: ' + text;
      } catch {
        $('#cannonCopyStatus').textContent = 'Bitte manuell übernehmen: ' + text;
      }
    };
    $('#copyCannon').onclick = () => copy(s.position.join(' '));
    for (const b of $('#roomInfo').querySelectorAll('[data-copy-coordinate]')) {
      b.onclick = () => copy(b.dataset.copyCoordinate);
    }
    return;
  }
  const z = mapData().zones.find((zone) => zone.id === selected);
  if (!z) return;
  const b = boundsOf(z);
  $('#roomInfo').innerHTML = `<p class="c-eyebrow">${esc(z.id)} · ${placed() ? 'Weltbereich' : 'Planungsvolumen'}</p><h3>${esc(z.title)}</h3><p><strong>${dimensions(z)} Blöcke</strong> <span class="muted">(lokale Breite × Länge × Höhe)</span></p><p class="c-mono">X ${b[0][0]} … ${b[1][0] - 1}<br>Z ${b[0][2]} … ${b[1][2] - 1}<br>Block-Y ${b[0][1]} … ${b[1][1] - 1}</p><p>Laufhöhen: <strong>${esc(floorsOf(z).join(' / '))}</strong></p>${list(z.features)}${current.id === 'erebor' ? `<p><a class="c-btn c-btn--primary c-btn--sm" href="/viewer?project=erebor&room=${encodeURIComponent(z.id)}">Raum in 3D ansehen &amp; betreten</a></p>` : ''}`;
}

function selectCannon(id, scroll = false) {
  if (!current.plan.cannonLayout?.stations.some((s) => s.id === id)) return;
  selectedCannon = id;
  showCannons = true;
  const cb = $('#showCannons');
  if (cb) cb.checked = true;
  map();
  details();
  if (scroll) $('#layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function crossSection() {
  const ids = ['E03', 'E02', 'E05', 'E06', 'E07', 'E08', 'E10'];
  return `<div class="section-frame"><svg viewBox="${placed() ? '-1800 -250 2150 425' : '-830 -250 1070 425'}" role="img" aria-label="Mittlerer Längsschnitt durch Erebor"><path d="${placed() ? 'M-1750 26L-1600 -32L-1400 -80L-1100 -160L-750 -225L-500 -185L-300 -160L-50 -152L0 -152L0 1L36 1' : 'M-820 0L-760 -90L-660 -150L-560 -180L-440 -225L-300 -188L-180 -160L-70 -146L0 -136L100 0L180 12'}" fill="#7ee0a808" stroke="#6d867a" stroke-width="2"/><text x="${placed() ? -1775 : -812}" y="-224">${placed() ? 'West · innen' : 'Nord · innen'}</text><text x="100" y="-224">${placed() ? 'Ost · Tor' : 'Süd · Tor'}</text>
  ${[-128, -96, -64, 0, 32, 64, 128, 224].map((y) => `<path d="M${placed() ? -1775 : -815} ${-y}H195" stroke="#2d4239" stroke-width=".7" stroke-dasharray="3 5"/><text x="200" y="${-y + 4}">${y + (placed() ? current.plan.worldOrigin[1] : 0)}</text>`).join('')}
  ${current.plan.zones
    .filter((z) => ids.includes(z.id))
    .map((z) => {
      const [a, b] = z.bounds;
      return `<rect x="${a[2]}" y="${-b[1]}" width="${b[2] - a[2]}" height="${b[1] - a[1]}" fill="${color(z.style)}" fill-opacity=".42" stroke="${color(z.style)}"/>${z.floors.map((f) => `<path d="M${a[2]} ${-f}H${b[2]}" stroke="#f2be6b" stroke-width="1.7"/>`).join('')}<text text-anchor="middle" x="${(a[2] + b[2]) / 2}" y="${-(a[1] + b[1]) / 2}">${z.id}</text>`;
    })
    .join('')}<text x="${placed() ? -1775 : -812}" y="163">Gold = Laufhöhen. Nur Räume auf X0; Seitenflügel sind im Grundriss sichtbar. Felsprofil ist schematisch.</text></svg></div>`;
}

function render() {
  current = { ...current, plan: withWorldCoordinates(current.plan) };
  const p = current.plan;
  document.title = p.title + ' · ATM10 Campus';
  if (!Array.isArray(p.zones) || !p.envelope) {
    $('#content').innerHTML = `<div class="c-card"><h1>${esc(p.title)}</h1><p>${esc(p.summary)}</p><pre>${esc(JSON.stringify(p, null, 2))}</pre></div>`;
    return;
  }
  const integer = (v) => Number.isSafeInteger(v) && Math.abs(v) <= 1000000;
  const box = (b) =>
    Array.isArray(b) &&
    b.length === 2 &&
    b.every((v) => Array.isArray(v) && v.length === 3 && v.every(integer)) &&
    b[0].every((v, i) => v < b[1][i]);
  if (
    placed() &&
    (!p.worldOrigin.every(integer) ||
      !box(p.envelope.worldBounds) ||
      !Array.isArray(p.site?.terrainSamples) ||
      p.site.terrainSamples.length > 20000 ||
      p.site.terrainSamples.some((v) => !Array.isArray(v) || v.length !== 4 || !v.every(integer)) ||
      !Array.isArray(p.site.protectedAreas) ||
      p.site.protectedAreas.some((v) => !box(v.bounds)) ||
      !Array.isArray(p.mountainFill?.peak) ||
      !p.mountainFill.peak.every(integer))
  ) {
    throw Error('Ungültige Standortdaten.');
  }
  if (
    !p.zones.length ||
    p.zones.length > 1000 ||
    p.zones.some(
      (z) =>
        !Array.isArray(z.bounds) ||
        z.bounds.length !== 2 ||
        z.bounds.some((v) => !Array.isArray(v) || v.length !== 3 || !v.every(integer)) ||
        z.bounds[0].some((v, i) => v >= z.bounds[1][i]) ||
        !Array.isArray(z.floors) ||
        !z.floors.every(integer),
    ) ||
    !Array.isArray(p.levels) ||
    p.levels.some((l) => !integer(l.y))
  ) {
    throw Error('Der Grundriss enthält ungültige Maß- oder Höhenangaben.');
  }
  if (
    placed() &&
    p.zones.some(
      (z) =>
        !Array.isArray(z.worldBounds) ||
        z.worldBounds.length !== 2 ||
        z.worldBounds.some((v) => !Array.isArray(v) || v.length !== 3 || !v.every(integer)) ||
        z.worldFootprint?.some((v) => !Array.isArray(v) || v.length !== 2 || !v.every(integer)),
    )
  ) {
    throw Error('Ungültige Weltkoordinaten.');
  }
  if (
    p.cannonLayout &&
    (!Array.isArray(p.cannonLayout.stations) ||
      p.cannonLayout.stations.length > 100 ||
      p.cannonLayout.stations.some(
        (s) => !/^K[0-9]{2}$/.test(s.id) || !Array.isArray(s.position) || s.position.length !== 3 || !s.position.every(integer),
      ))
  ) {
    throw Error('Ungültige Kanonenstandorte.');
  }
  $('#modelLink')?.remove();
  setViewerLink('/viewer?project=' + encodeURIComponent(current.id));
  if (p.zones?.length) {
    const link = document.createElement('a');
    link.id = 'modelLink';
    link.className = 'c-btn c-btn--primary c-btn--sm';
    link.href = '/viewer?project=' + encodeURIComponent(current.id) + (current.id === 'erebor' ? '&room=E05' : '');
    link.textContent = current.id === 'erebor' ? 'Räume in 3D ansehen' : 'Im 3D-Viewer öffnen';
    document.querySelector('.project-toolbar .row')?.prepend(link);
  }
  if (placed() && selected === null) {
    floor = 'all';
    selectedCannon = p.cannonLayout?.nearEntrance || null;
  }
  selected = p.zones.some((z) => z.id === selected) ? selected : 'E02';

  const navItems = [
    ['stone', 'Stein-Schematics'],
    ...(p.cannonLayout ? [['cannon-sites', 'Kanonenstandorte']] : []),
    ['layout', p.cannonLayout ? 'Karte & Kanonen' : 'Grundriss'],
    ['height', 'Höhen'],
    ...(p.buildingMods ? [['building-mods', 'Baumods & Formen']] : []),
    ['palette', 'Materialien'],
    ['packages', 'Bauumfang'],
    ['routes', 'Wege'],
    ['phases', 'Baufolge'],
    ['export', 'Schematics'],
    ['sources', 'Referenzen'],
  ];

  $('#content').innerHTML = `${projectHero({
    status:`Masterplan · ${placed() ? 'Standort festgelegt · Tor nach Osten' : 'Standort offen'} · Version ${current.version}`,
    title:p.title, summary:p.summary,
    actions:'<a class="c-btn c-btn--primary" href="/app?project=erebor#overview">Baupläne · Erebor öffnen</a>'+areaLinks(current),
    metrics:[
      [(p.envelope.bounds[1][0]-p.envelope.bounds[0][0]).toLocaleString('de-DE')+' × '+(p.envelope.bounds[1][2]-p.envelope.bounds[0][2]).toLocaleString('de-DE'),'Bergmassiv in Blöcken'],
      [(p.envelope.interior||[600,800]).map(n=>Number(n).toLocaleString('de-DE')).join(' × '),'Reservat der unterirdischen Stadt'],
      [p.packages.length+' Bauabschnitte','mit Reihenfolge und Raumprogramm'],
      [placed()?'Y−40 bis Y312':'−128 bis +224',placed()?'Welt-Blockhöhen des Berges':'lokale Blockhöhen'],
    ],
  })}
  ${
    p.site?.relocation
      ? `<aside class="project-note"><strong>${p.site.relocation.status === 'surveying' ? 'Standortwechsel in Vorbereitung' : 'Neuer Standort'} · City1 bleibt erhalten.</strong>${p.site.esgarothShoreAccess ? `<p>Uferzugang Esgaroth: ${p.site.esgarothShoreAccess.join(' / ')} (X / Y / Z).</p>` : ''}<p>${p.site.relocation.status === 'surveying' ? 'Bisherige Torschwelle' : 'Neue Torschwelle'}: ${p.worldOrigin.join(' / ')} (X / Y / Z). Alte Schematics der Versionen ${esc(p.site.relocation.previousVersions || 'vor dem Umzug')} gehören zum bisherigen Standort. Verwende die Koordinaten und Dateien der aktuellen Version.</p>${p.site.exploration?.complete ? '' : '<p>Die neue Fläche ist noch nicht vollständig erkundet. Nicht gespeicherte Chunks zuerst laden und speichern lassen. Architekturpakete werden nur mit vollständig bekannter Zielfläche freigegeben; die 3D-Ansicht zeigt bereits den Entwurf.</p>'}</aside>`
      : ''
  }
  ${projectNav(navItems)}
  <section id="architectureRelease" class="project-section project-section-card"><h2>Architektur · veröffentlichte Baupläne</h2><p class="muted">Veröffentlichungsstand wird geladen …</p></section>
  <details class="project-disclosure"><summary>Ursprünglicher Masterplan und Umfang</summary><p class="project-note">${esc(p.scope)}</p></details>
  ${
    p.symmetry
      ? section(
          'symmetry',
          'Symmetrieprüfung · Architektur R' + Number(p.symmetry.revision),
          `<p>${esc(p.symmetry.scope)}</p><p><strong>${p.symmetry.rooms.length} Hallen geprüft · ${p.symmetry.rooms.reduce((n, r) => n + r.pairs, 0).toLocaleString('de-DE')} Blockpaare verglichen · ${p.symmetry.rooms.reduce((n, r) => n + r.mismatches, 0)} Abweichungen im symmetrischen Hallenaufbau.</strong></p><p>Beide Treppenläufe bleiben auch nach dem Einfügen der Gänge begehbar. Säulen, Deckenrippen, Galerien und Nebenräume sind auf gemeinsame Achsen ausgerichtet.</p><details class="project-disclosure"><summary>Bewusste Ausnahmen</summary>${list(p.symmetry.exceptions)}</details>`,
          true,
        )
      : ''
  }
  ${p.mountainFill ? stoneSection() : ''}
  ${current.id === 'erebor' && p.mountainFill ? section('landschaft', 'Außenhaut, Bergwald und Schneegipfel', '<p><a class="c-btn c-btn--sm" href="/app?project=erebor#overview">Landschafts-Schematics öffnen</a></p><div id="landscapeDraft" class="muted">Landschaftsentwurf wird geladen …</div>', true) : ''}
  ${p.cannonLayout ? cannonSitesSection() : ''}
  ${section('layout', p.cannonLayout ? '01 · Karte, Kanonenstandorte und Grundriss' : '01 · Grundriss und Raumprogramm', projectMapBody(current))}
  ${section('height', '02 · Höhen und gemeinsame Bauachse', `<p>${esc(p.envelope.note)}</p>${crossSection()}<div class="project-cards">${Object.entries(p.coordinateSystem).map(([k, t]) => `<div class="project-card"><h3>${esc({ origin: 'Nullpunkt', axes: 'Richtung', bounds: 'Maße lesen', floors: 'Boden und Laufhöhe', placement: 'Weltposition und Ausrichtung' }[k] || k)}</h3><p>${esc(t)}</p></div>`).join('')}</div>`)}
  ${p.buildingMods ? section('building-mods', 'Baumods · Formen, Oberflächen und Einrichtung', buildingModsHtml(p.buildingMods)) : ''}
  ${section('palette', '03 · Steingrau, Jade und kräftiges Gold', `<p>Original-Blockbilder aus der lokalen ATM10-Instanz. Connecting-Varianten sind ausdrücklich markiert. Die Anteile beziehen sich auf sichtbare Flächen, nicht auf exakte Materialmengen.</p><div class="project-cards">${p.styles.filter((s) => !['rock', 'circulation', 'technical'].includes(s.id)).map((s) => `<div class="project-card" style="border-top:3px solid ${color(s.id)}"><h3>${esc(s.name)}</h3><p>${esc(s.use)}</p><p class="tag">${esc(s.ratio)}</p><p>${esc(s.rule)}</p></div>`).join('')}</div><div class="palette-grid">${p.palette.map((b) => `<div class="palette-item">${/^[a-z0-9_]+:[a-z0-9_]+$/.test(b.id) ? `<img src="/assets/project-blocks/${b.id.replace(':', '__')}.png" alt="${esc(b.name)}" loading="lazy" width="64" height="64">` : ''}<div><strong>${esc(b.name)}</strong><small class="${b.connecting ? 'connecting' : 'no-connecting'}">${b.connecting ? 'CONNECTING AN' : 'Keine Connecting-Variante'}</small><small>${esc(b.use)}</small></div><code>${esc(b.id)}</code></div>`).join('')}</div>`)}
  ${section('packages', '04 · Vollständiger Bauumfang', `<p>${esc(p.provenance)}</p><div class="project-table"><table><thead><tr><th>Teil</th><th>Was gebaut wird</th><th>Phase</th></tr></thead><tbody>${p.packages.map((s) => `<tr><td>${esc(s.id)}</td><td><strong>${esc(s.title)}</strong><p>${esc(s.work)}</p><small>${esc(s.basis)}</small></td><td>${esc(s.phase)}</td></tr>`).join('')}</tbody></table></div><h3>Verbindliche Gestaltungsregeln</h3><ol class="project-rules">${p.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>`)}
  ${section('routes', '05 · Wege, Türen und Höhenwechsel', `<p>Die Verbindungen legen Breite, Richtung und Anschlusshöhe fest. Die Architekturdateien enthalten ihre Blockgeometrie; Aushub wird getrennt ausgewiesen.</p><div class="project-table"><table><thead><tr><th>Verbindung</th><th>Breite</th><th>Führung</th></tr></thead><tbody>${p.connections.map((c) => `<tr><td>${esc(c.a)} ↔ ${esc(c.b)}</td><td>${esc(c.width)}</td><td>${esc(c.description)}</td></tr>`).join('')}</tbody></table></div>`)}
  ${section('phases', '06 · Baufolge mit klaren Zwischenständen', `<div class="project-cards">${p.phases.map((s) => `<div class="project-card"><p class="tag">PHASE ${esc(String(s.n).padStart(2, '0'))}</p><h3>${esc(s.title)}</h3>${list(s.tasks)}<p><strong>Fertig, wenn:</strong> ${esc(s.exit)}</p></div>`).join('')}</div>`)}
  ${section('export', '07 · Schematic-Pakete und Baufolge', `<p><a class="c-btn c-btn--primary" href="/app?project=erebor#overview">Erebor-Schematics unter Baupläne öffnen</a></p><div class="project-cards">${Object.entries(p.schematicStrategy).map(([k, v]) => `<div class="project-card"><h3>${esc({ grid: 'Modulgröße', naming: 'Eindeutige Dateinamen', ownership: 'Saubere Nahtstellen', layers: 'Getrennte Baupakete', air: 'Bauen und Aushub', release: 'Veröffentlichung', materials: 'Materialmengen' }[k] || k)}</h3>${Array.isArray(v) ? list(v) : `<p>${esc(v)}</p>`}</div>`).join('')}</div><p class="project-note">${esc(p.validation.notes)}</p>`)}
  ${section('sources', '08 · Referenzen und getroffene Entscheidungen', `${list(p.decisions)}<ul class="source-list">${p.sources.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a><small>${esc(s.use)}</small></li>`).join('')}</ul><p class="muted">Gespeichert über die Campus-API: ${esc(new Date(current.updatedAt).toLocaleString('de-DE'))}. Planung und bestehende Welt-Baupläne werden getrennt geführt.</p>`)}`;

  wireMap();

  const landscape = document.getElementById('landscapeDraft');
  if (landscape) {
    const link = document.createElement('a');
    link.href = '#landschaft';
    link.textContent = 'Berglandschaft';
    document.querySelector('.project-nav a[href="#stone"]')?.after(link);
    api('/api/projects/erebor/landschaft')
      .then((result) => {
        if (landscape.isConnected) landscape.innerHTML = landscapeView(result);
      })
      .catch(() => {
        landscape.textContent = 'Der Landschaftsentwurf konnte gerade nicht geladen werden.';
      });
  }

  wireStickyNav();
  installStoneControls(current, api, selectCannon);

  const projectId = current.id;
  Promise.all([api('/api/projects/' + projectId + '/architecture'), api('/api/projects/' + projectId + '/architecture/manifest')])
    .then(([a, m]) => {
      if (current?.id !== projectId) return;
      const built = a.packages.reduce((n, pkg) => n + pkg.files.filter((f) => f.kind === 'build').length, 0);
      const clear = a.packages.reduce((n, pkg) => n + pkg.files.filter((f) => f.kind === 'clear').length, 0);
      const done = a.packages.length === m.packages.length;
      const target = $('#architectureRelease');
      if (!target) return;
      target.innerHTML =
        '<h2>Architektur R' +
        a.revision +
        ' · ' +
        (done
          ? 'alle Pakete veröffentlicht'
          : current.plan.site?.requireKnownArchitecture && !current.plan.site?.exploration?.complete
            ? 'Weitere Pakete nach Erkundung'
            : 'Veröffentlichung läuft') +
        '</h2><p><strong>' +
        a.packages.length +
        ' / ' +
        m.packages.length +
        ' Pakete · ' +
        built.toLocaleString('de') +
        ' Bau-Schematics · ' +
        clear.toLocaleString('de') +
        ' separate Aushub-Dateien.</strong></p><p>Tor und Spieler-Statuen, Haupthallen, Treppen, Wohn- und Handwerksviertel, Dale, Wasserstadt, Brücken und Landschaftsbauteile. Die Blockvorschau zeigt die tatsächlich exportierte Entwurfsgeometrie. Welt-Schutz-Aussparungen stehen in jedem Paketbericht.</p><div class="row"><a class="c-btn c-btn--primary c-btn--sm" href="/app?project=erebor#overview">Alle Baupläne mit Koordinaten öffnen</a><a class="c-btn c-btn--sm" href="/viewer?project=erebor&room=E02">Tor in 3D ansehen</a></div><p class="project-note">Erst Steinfüllung, dann Aushub, dann Architektur von unten nach oben. Unbekannte Chunks sind nicht für Aushub freigegeben. Wasser und Lava zuletzt separat einsetzen. Funktionsmaschinen und die optionale Smaug-Skulptur sind weiterhin eigene Ausbauten.</p>';
    })
    .catch((e) => {
      const target = $('#architectureRelease');
      if (target) target.innerHTML = '<h2>Architektur</h2><p class="muted">' + esc(e.message) + '</p>';
    });

  $('#cannonCsv')?.addEventListener('click', () => {
    const csv =
      'Kanone;X;Y;Z;Fundament_Y;Abschnitte\r\n' +
      p.cannonLayout.stations.map((s) => [s.id, ...s.position, s.position[1] - 1, s.assigned].join(';')).join('\r\n');
    downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), 'Erebor-Kanonen-Standorte-V' + current.version + '.csv');
  });
}

function wireMap() {
  const p=current.plan;
  $('#floor').value = floor;
  $('#zoom').value = String(zoom);
  $('#floor').addEventListener('change', (e) => {
    floor = e.target.value;
    map();
  });
  $('#zoom').addEventListener('change', (e) => {
    zoom = Number(e.target.value);
    map();
  });
  if (!activeArea && p.cannonLayout) {
    $('#mapScope').value = mapScope;
    $('#showCannons').checked = showCannons;
    $('#mapScope').onchange = (e) => {
      const area=PROJECT_AREAS.find(a=>a.id===e.target.value&&a.project===current.id);
      if(area){location.assign(area.href+'#layout');return;}
      mapScope = e.target.value;
      map();
    };
    $('#showCannons').onchange = (e) => {
      showCannons = e.target.checked;
      if (!showCannons) selectedCannon = null;
      map();
      details();
    };
  }
  for (const b of document.querySelectorAll('[data-cannon-link]')) {
    b.onclick = () => selectCannon(b.dataset.cannonLink, true);
  }
  document.querySelectorAll('[data-zone]').forEach((el) =>
    el.addEventListener('click', () => {
      selectedCannon = null;
      selected = el.dataset.zone;
      const z = p.zones.find((zone) => zone.id === selected);
      if (floor !== 'all' && !(z.bounds[0][1] <= Number(floor) && z.bounds[1][1] > Number(floor))) {
        floor = String(z.floors[0]);
        $('#floor').value = floor;
      }
      map();
      details();
    }),
  );
  map();
  details();
}

function cannonSitesSection() {
  const layout = current.plan.cannonLayout;
  return section(
    'cannon-sites',
    'Kanonenstandorte',
    `<p>${layout.stations.length} geplante Standorte · ${Number(layout.coveredTiles).toLocaleString('de-DE')} abgedeckte Steinabschnitte · größter zugeordneter Abstand ${Number(layout.maxDistance).toFixed(1)} Blöcke.</p>
 <div class="row"><a class="c-btn c-btn--sm" href="#layout">Projektkarte</a><a class="c-btn c-btn--sm" href="/app?project=erebor#cannon-coordinates">Aufstellung und Vermessung</a><button id="cannonCsv" type="button" class="c-btn c-btn--sm">Koordinaten als CSV</button></div>`,
    true,
  );
}

function stoneMaterialSummary() {
  const m = current.plan.mountainFill.materialEstimate;
  const fmtNum = (n) => Number(n).toLocaleString('de-DE');
  if (Number.isSafeInteger(m?.knownRemaining) && Number.isSafeInteger(m?.maximumRemaining)) {
    return `<p><strong>Steinbedarf nach Abzug des Bestands: ${fmtNum(m.knownRemaining)}${m.complete ? '' : ' bis maximal ' + fmtNum(m.maximumRemaining)} Cleanstone.</strong></p><p>${fmtNum(m.existingSkipped)} vorhandene Blöcke und ${fmtNum(m.protectedCells)} geschützte Zielpositionen sind bereits abgezogen. ${m.complete ? 'Das gesamte Zielgebiet ist in der gespeicherten Welt erfasst.' : fmtNum(m.unknownCells) + ' Zielpositionen in ' + fmtNum(m.unknownChunks) + ' unbekannten Chunks bleiben offen; daher die Spanne.'} Gezählt wird nur die massive Steinfüllung, ohne Architektur und Dekor.</p><p class="muted">Gespeicherte Weltdateien, ausgewertet ${esc(new Date(m.capturedTo).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }))} (Berlin). Spätere Weltänderungen sind darin nicht enthalten.</p>`;
  }
  return `<p><strong>Material-Obergrenze: ${fmtNum(m?.geometryUpperBound || 0)} Steinblöcke.</strong> Bereits vorhandener Fels und Schutzbereiche werden abgezogen; der genaue Restbedarf ist noch offen.</p>`;
}

function stoneSection() {
  return section(
    'stone',
    'Steinmassiv · Schematics für Luft und Wasser',
    `<p>Survival mit Materialverbrauch: Der gesamte Berg wird zuerst massiv geschlossen. Die späteren Hallen werden danach separat ausgehoben. Pro Datei höchstens 64 × 64 Blöcke Grundfläche und 16 Blöcke Höhe.</p><p><strong>Kanone: „Don't Replace Solid Blocks“ (Modus 0), Block-Entities ersetzen AUS. Drehung NONE, Spiegelung NONE.</strong> Jede Datei nutzt ihren eigenen X/Y/Z-Anker aus der Tabelle. Downloads verwenden den gespeicherten Weltstand; bei zwischenzeitlichem Bauen frisch herunterladen.</p><p class="muted">See, Wasserstadt, Dorf, Waystone-Hof und Platz um Block-Entities werden ausgespart. Nicht gespeicherte Chunks müssen zuerst im Spiel geladen werden. Die Dateien stehen hier als Projekt-Downloads; sie starten keine Kanone.</p>${stoneMaterialSummary()}<p><strong>Start bei ${esc(current.plan.cannonLayout?.nearEntrance || 'der zugeordneten Kanone')}.</strong> Jeder Dateiname nennt den nächstgelegenen geeigneten Kanonenplatz. ZIP-Pakete enthalten bis zu 16 Abschnitte, eine Koordinatenliste und die genaue Cleanstone-Menge. Bereits gefüllte Abschnitte werden ausgelassen; unbekannte Chunks im Paketbericht markiert. Die vielen Dateien bleiben bei diesem Maßstab ein großer Bauaufwand.</p><div class="row">${current.plan.cannonLayout ? `<button id="startStone" type="button" class="c-btn c-btn--primary">Startpaket ${esc(current.plan.cannonLayout.nearEntrance)} herunterladen</button>` : ''}<button id="loadStone" type="button" class="c-btn">Alle Stein-Schematics und Pakete anzeigen</button></div><div id="stonePrepared" class="prepared-stone-block"></div><p id="stoneStatus" class="muted" role="status"></p><div id="stoneList"></div>`,
    true,
  );
}

function downloadBlob(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 30000);
}

function projectIndexCard(p) {
  const isArchive = Boolean(p.archivedAt);
  const isExisting = p.status === 'existing';
  const badgeClass = isArchive ? 'c-badge--neutral' : isExisting ? 'c-badge--ok' : 'c-badge--warn';
  const badgeLabel = isArchive ? 'Archiv' : p.area ? 'Teilbereich · Erebor' : isExisting ? 'Bestehende Anlage' : 'Masterplan';
  const cardClass = !isArchive && !isExisting ? 'project-index-card project-index-card--masterplan' : 'project-index-card';
  return `<a class="${cardClass}" href="${esc(p.href || '/projects?id='+encodeURIComponent(p.id))}">
    <div class="project-index-meta">
      <span class="c-badge ${badgeClass}">${badgeLabel}</span>
      <span class="c-mono muted">v${Number(p.version)}</span>
    </div>
    <h2>${esc(p.title)}</h2>
    <p>${esc(p.summary)}</p>
    <div class="project-index-foot">
      <span>${p.area?'Bereich öffnen':'Projekt öffnen'}</span>
      <span aria-hidden="true">&rarr;</span>
    </div>
  </a>`;
}

async function load() {
  stopWatercity?.();stopWatercity=null;
  activeArea=areaFromUrl(new URL(location.href));watercity=null;
  $('#error').textContent = '';
  $('#reload').disabled = true;
  try {
    const id = activeArea?.project || new URL(location.href).searchParams.get('id');
    if (!id) {
      current = null;
      document.title = 'Bauprojekte · ATM10 Campus';
      $('#modelLink')?.remove();
      $('#projectToolbar').hidden = true;
      setViewerLink('/viewer?project=erebor');
      const all = await api('/api/projects?includeArchived=1');
      const active = projectEntries(all.filter((p) => !p.archivedAt));
      const archive = all.filter((p) => p.archivedAt);
      $('#content').innerHTML = `<div class="c-page-head">
        <div class="c-page-head-main">
          <p class="c-eyebrow">Campus-Planung</p>
          <h1>Bauprojekte</h1>
          <p class="c-page-sub">Masterpläne, Standortkarten, Stein-Schematics und archivierte Anlagen im Überblick.</p>
        </div>
        <div class="c-page-actions">
          <button id="reloadIndex" type="button" class="c-btn c-btn--sm">Aktualisieren</button>
          <a class="c-btn c-btn--primary c-btn--sm" href="/app?project=erebor#overview">Bauaufträge öffnen</a>
        </div>
      </div>
      <div class="project-index-grid">${active.map(projectIndexCard).join('') || '<div class="c-card">Keine aktiven Bauprojekte.</div>'}</div>
      ${archive.length ? `<details id="archiv" class="project-archive" ${location.hash === '#archiv' ? 'open' : ''}><summary>Projektarchiv (${archive.length})</summary><div class="project-index-grid">${archive.map(projectIndexCard).join('')}</div></details>` : ''}`;
      $('#reloadIndex')?.addEventListener('click', load);
    } else {
      $('#projectToolbar').hidden = false;
      current = await api('/api/projects/' + encodeURIComponent(id));
      if(activeArea){
        current={...current,plan:withWorldCoordinates(current.plan)};
        const [architecture,native]=await Promise.all([api('/api/projects/'+encodeURIComponent(current.id)+'/architecture').catch(()=>null),api('/api/projects/erebor/wasserstadt').catch(()=>null)]);
        watercity=native;selected=activeArea.zones[0];selectedCannon=null;floor='all';zoom=1;
        document.title=activeArea.title+' · ATM10 Campus';
        $('#modelLink')?.remove();
        $('#content').innerHTML=areaHome({project:current,area:activeArea,architecture,mapHtml:projectMapBody(current,activeArea)});
        setViewerLink('/viewer?project=erebor&room='+encodeURIComponent(selected));
        wireMap();wireStickyNav();
        stopWatercity=mountWatercity({fleet:$('#wc-fleet'),status:$('#wc-status'),initial:watercity});
      } else if (current.plan.kind === 'blueprint_collection') {
        $('#modelLink')?.remove();
        renderExistingProject($('#content'), current, await api('/api/status'));
        wireStickyNav();
      } else {
        render();
      }
    }
    $('#download').hidden = !current || !!activeArea;
    $('#print').hidden = !current;
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  } catch (e) {
    $('#error').textContent = e.message;
    $('#content').textContent = '';
  } finally {
    $('#reload').disabled = false;
  }
}

$('#reload').addEventListener('click', load);
$('#print').addEventListener('click', () => window.print());
$('#download').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = current.id + '-masterplan-v' + current.version + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

load();
