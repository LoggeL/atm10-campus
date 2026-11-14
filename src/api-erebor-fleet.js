import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {HttpError,requireActor} from './auth.js';
import {tx,now,logActivity} from './db.js';
import {normalizeOptions} from './api-stations.js';
import {zipStore} from './zip.js';
import {parallelLayout} from './erebor-parallel.js';
import {renderConnectionIssues,renderFleetIssues} from '../public/assets/connection-status.js';

const folder=new URL('./erebor-fleet/',import.meta.url);
const file=name=>readFileSync(new URL(name,folder));
const layout=JSON.parse(file('stations.json'));
const hubNames={A0:'Zentralhub A',A1:'A-Nordwest',A2:'A-Nordost',B0:'Zentralhub B',B1:'B-Südwest',B2:'B-Südost'};
function linkPage(report) {
  const label=id=>hubNames[id]||id;
  const rows=Object.entries(layout.hubs).map(([id,pos])=>{
    const links=report.links.filter(l=>l.hub===id||l.id===id);
    const name=l=>label(l.hub===id?l.id:l.hub);
    const head=report.hubs[id];
    const pending=links.filter(l=>l.state!=='paired').map(l=>name(l)+' ('+({absent:'Block fehlt',unknown:'unbekannt',ambiguous:'mehrdeutig',unpaired:'offen'}[l.state])+')');
    const ports=head.ports.map(p=>p.port+' → '+(p.peers.map(label).join(', ')||'unbekanntes Ziel')).join('<br>');
    return '<tr><th scope="row">'+label(id)+'</th><td>'+(head.position||pos).join(' / ')+'</td><td>'+links.map(name).join(', ')+'</td><td>'+
      (head.present===null?'Unbekannt':head.present?'Belegt: '+head.ports.length+'/8<br>'+ports:'Hub fehlt')+'</td><td>'+(pending.join(', ')||'Alle gekoppelt')+'</td></tr>';
  }).join('');
  return '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Erebor · Funkverbindungen</title><link rel="stylesheet" href="/assets/app.css"><main>'+
    '<a href="/app?project=erebor#cannon-coordinates">← Kanonenstandorte</a><h1>Funkverbindungen bei Erebor</h1><p>Mit dem ME Wireless Setup Kit beide Partner eines Paars rechtsklicken. Bei einer Kanone den Wireless Connector anklicken. Eine Hub-Verbindung wird nur einmal gekoppelt.</p>'+
    '<p>Gespeicherte Kopplungen aus der Welt. Abgerufen am '+new Date(report.surveyedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})+' Uhr (Berlin).</p>'+
    '<div class="table-wrap"><table><thead><tr><th>Hub</th><th>X / Y / Z</th><th>Vorgesehene Partner</th><th>Gespeicherte Ports</th><th>Zu prüfen</th></tr></thead><tbody>'+rows+'</tbody></table></div></main></html>';
}
function checkedLayout(req,campus,permission='read') {
  const actor=requireActor(req,permission);
  const row=campus.db.prepare('SELECT plan_json FROM build_projects WHERE id=?').get('erebor');
  const live=row && JSON.parse(row.plan_json).cannonLayout?.stations;
  if(!Array.isArray(live)||live.length!==layout.sites.length||layout.sites.some(s=>
    !live.some(r=>r.id===s.site&&JSON.stringify(r.position)===JSON.stringify(s.planned))))
    throw new HttpError(409,'Der Erebor-Standortplan hat sich geändert. Installer-Zuordnung neu prüfen.');
  return actor;
}
export function registerEreborFleet(app,campus) {
  campus.ereborNetworkView=async name=>{
    const site=/^erebor-(K\d{2})$/i.exec(name)?.[1]?.toUpperCase();
    if(!site)return null;
    const network=(await campus.ereborLiveReport(parallelLayout.version))?.network;
    return network?.stations?.[site]?{...network.stations[site],at:network.at,source:network.source,power:network.power}:{stale:true,at:null};
  };
  const prefix='/api/projects/erebor/cannon-sites';
  const profile={bufferStacks:16,gunpowder:64};
  const stationOptions=campus.db.prepare('SELECT options_json FROM cannons WHERE name=?');
  const fleetSites=layout.sites.map(s=>s.site);
  function supplySettings(sites=fleetSites){
    return sites.map(site=>{
      const row=stationOptions.get('erebor-'+site);
      const opts=row&&normalizeOptions(JSON.parse(row.options_json));
      return {site,bufferStacks:opts?.bufferStacks??null,gunpowder:opts?.gunpowder??null,configured:opts?.bufferStacks===profile.bufferStacks&&opts?.gunpowder===profile.gunpowder};
    });
  }
  app.get(prefix+'/materialpuffer',async(req,reply)=>{
    checkedLayout(req,campus,'erebor_supply');
    return reply.header('Cache-Control','private, no-store').send({stations:supplySettings()});
  });
  app.post(prefix+'/materialpuffer',async req=>{
    const actor=checkedLayout(req,campus,'erebor_supply');
    if(req.headers.origin&&req.headers.origin!==campus.config.publicUrl)throw new HttpError(403,'Fremder Origin.');
    const body=req.body===undefined?profile:req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['sites','bufferStacks','gunpowder'].includes(k)))
      throw new HttpError(400,'Erlaubt sind sites, bufferStacks und gunpowder.');
    const sites=body.sites===undefined?fleetSites:body.sites;
    if(!Array.isArray(sites)||!sites.length||sites.length>fleetSites.length||new Set(sites).size!==sites.length||sites.some(s=>!fleetSites.includes(s)))
      throw new HttpError(400,'Standorte aus K01 bis K37 einmalig angeben.');
    const changes=Object.fromEntries(Object.entries(body).filter(([k])=>k!=='sites'));
    if(!Object.keys(changes).length||!Object.values(changes).every(Number.isSafeInteger))
      throw new HttpError(400,'Mindestens einen Puffer als ganze Zahl angeben.');
    normalizeOptions(changes); // Uses the same limits as the individual station editor.
    const matches=row=>Object.entries(changes).every(([key,value])=>row[key]===value);
    const update=campus.db.prepare('UPDATE cannons SET options_json=json_patch(options_json,?),updated_at=? WHERE name=?');
    return tx(campus.db,()=>{
      const pending=supplySettings(sites).filter(row=>!matches(row));
      for(const {site} of pending){
        if(update.run(JSON.stringify(changes),now(),'erebor-'+site).changes!==1)
          throw new HttpError(409,'Stationscomputer '+site+' ist noch nicht registriert.');
      }
      const verified=supplySettings(sites).filter(matches).length;
      if(verified!==sites.length)throw new HttpError(409,'Die gespeicherten Puffer konnten nicht vollständig bestätigt werden.');
      if(pending.length)logActivity(campus.db,actor,'erebor.supply.settings','erebor',{...changes,sites:pending.map(s=>s.site)});
      return {verified,total:sites.length};
    });
  });
  app.get(prefix+'/dreierbetrieb',async(req,reply)=>{
    checkedLayout(req,campus);
    const version=parallelLayout.version;
    const report=await campus.ereborLiveReport(version);
    const jobs=campus.ereborHelpers.list(version);
    const diagnostics=await Promise.all(layout.sites.map(async s=>{
      const row=campus.db.prepare('SELECT status_json,last_seen_at FROM cannons WHERE name=?').get('erebor-'+s.site);
      const status=JSON.parse(row?.status_json||'null');
      return {name:s.site,online:!!row?.last_seen_at&&Date.now()-Date.parse(row.last_seen_at)<180000,status,network:await campus.ereborNetworkView('erebor-'+s.site)};
    }));
    const stations=parallelLayout.sites.map(pair=>({...pair,helpers:['B','C'].map(slot=>({
      slot,job:jobs.find(j=>j.site===pair.site&&j.slot===slot)||null,live:report?.stations?.[pair.site+slot]||null
    }))}));
    reply.header('Cache-Control','private, no-store');
    const enabled=campus.ereborHelpers.isEnabled(version);
    const settings=supplySettings();
    const supplyLabel=settings.filter(s=>s.configured).length+' von '+settings.length+' Standorten auf 16 Stacks und 64 Schießpulver eingestellt.';
    const resume=campus.db.prepare('SELECT site,slot,result,expires FROM erebor_resume WHERE version=? ORDER BY site,slot').all(version);
    if(req.query.format==='json')return {version,enabled,at:report?.at||null,chestTracker:report?.chestTracker??null,chestController:report?.chestController??null,stations,diagnostics,power:report?.network?.power||[],supplySettings:settings,resume};
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function status({slot,job,live}){
      const label=live?.state ? (live.ready?'Materialkiste erkannt':'Materialkiste prüfen')+' · '+live.state+' / '+live.status :
        report?'Kanone fehlt oder Chunk ungeladen':'Keine aktuelle Weltmeldung';
      return '<div><b>'+slot+'</b> '+esc(label)+(live?.upload?' · '+esc(live.placed)+' Blöcke gesetzt':'')+
        (job?'<br>'+esc(job.name||'')+' '+esc(job.message||'')+' · '+esc(job.completed)+' fertig':'')+'</div>';
    }
    return reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Erebor · Dreierbetrieb</title><link rel="stylesheet" href="/assets/app.css"><main>'+
      '<a href="/app?project=erebor#cannon-coordinates">← Aufstellkoordinaten</a><h1>Erebor · Dreierbetrieb</h1><p>Alle Koordinaten in X / Y / Z. An jedem der 37 Standorte B und C direkt an die bestehende Materialkiste stellen. Der Stationscomputer versorgt alle drei Kanonen. Bei K09 steht C unter der Kiste. Für drei gleichzeitig laufende Pläne die Hauptkanone auf Automatik stellen. Kanoneneingänge leer lassen. Sobald der Tracker den Aufbau meldet, werden freie Abschnitte vergeben.</p>'+
      '<p><a href="/assets/erebor-shared-v5.zip">Homebox-Paket V5 für Oak Netherite Chest mit Anleitung (.zip)</a></p><p>Vergabe neuer Cleanstone-Pläne an alle Zusatzkanonen: <b>'+(enabled?'aktiv':'pausiert')+'</b>. '+(req.actor?.via==='session'&&req.actor?.user?.role==='admin'?'<button id="toggle" data-enabled="'+(!enabled)+'" data-version="'+version+'">'+(enabled?'Neue Aufträge pausieren':'Neue Aufträge freigeben')+'</button> <button id="all-mains" data-enabled="true" data-version="'+version+'">Alle 37 Standorte im Dreierbetrieb starten</button> <output id="result"></output>':'')+'</p><script type="module" src="/assets/erebor-parallel.js"></script><p>'+esc(report?'Weltmeldung vom '+new Date(report.at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})+' Uhr':'Keine aktuelle Weltmeldung')+'</p>'+
      '<p>'+esc(report?.chestController===5 && report?.chestTracker===5?'Oak Netherite Chest bereit – Homebox und Minecraft melden V5.':'Oak Netherite Chest wartet auf die V5-Weltmeldung von Homebox und Minecraft.')+'</p>'+
      '<p id="fortsetzen">'+(req.actor?.via==='session'&&req.actor.user?.role==='admin'?'<button id="resume-paused" data-version="'+version+'">Pausierte Cleanstone-Kanonen fortsetzen</button> <a href="/api/projects/erebor/planfolge/drucker-reparatur.zip">Reparatur für suchende Drucker herunterladen</a> ':'')+'<output id="resume-result"></output></p>'+
      '<p id="materialpuffer">'+(req.actor?.via==='session'&&req.actor.user?.role==='admin'?'<button id="set-supply">K01–K37 auf 16 Stacks und 64 Schießpulver stellen</button> ':'')+'<output id="supply-result">'+supplyLabel+'</output></p>'+
      '<section data-fleet-faults>'+renderFleetIssues(diagnostics)+'</section><div class="table-wrap"><table><thead><tr>'+['Platz','A (vorhanden)','B (neu)','C (neu)','Gemeinsame Kiste','Status'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+
      stations.map(s=>'<tr><th>'+s.site+'</th>'+['main','B','C','chest'].map(k=>'<td>'+s[k].join(' / ')+'</td>').join('')+'<td><div data-site-fault="'+s.site+'">'+renderConnectionIssues(diagnostics.find(d=>d.name===s.site))+'</div>'+s.helpers.map(status).join('')+'</td></tr>').join('')+'</tbody></table></div></main></html>');
  });
  app.get(prefix+'/installer.zip',async(req,reply)=>{
    checkedLayout(req,campus);
    const entries=['ANLEITUNG.txt','install.py','stations.json'].map(name=>({name,data:file(name)}));
    entries.push({name:'campus.lua',data:readFileSync(new URL('../public/cc/campus.lua',import.meta.url))});
    const csv=['Kanone;Connector X;Connector Y;Connector Z;Hub;Hub X;Hub Y;Hub Z',
      ...layout.sites.map(s=>[s.site,...s.connector,hubNames[s.hub],...layout.hubs[s.hub]].join(';'))].join('\r\n');
    entries.push({name:'Funkverbindungen.csv',data:Buffer.from('\uFEFF'+csv+'\r\n')});
    return reply.type('application/zip').header('Cache-Control','private, no-store')
      .header('Content-Disposition','attachment; filename="Erebor-K01-K37-Serverinstallation.zip"').send(zipStore(entries));
  });
  let current=null;
  app.get(prefix+'/wireless',async(req,reply)=>{
    checkedLayout(req,campus);
    if(!current)current=new Promise((resolve,reject)=>{
      const w=new Worker(new URL('./erebor-wireless.js',import.meta.url),{workerData:{kind:'erebor-wireless',world:campus.config.worldSources.live,layout},resourceLimits:{maxOldGenerationSizeMb:256}});
      const timer=setTimeout(()=>{w.terminate();reject(new HttpError(503,'Funkstatus-Lesung hat das Zeitlimit erreicht.'));},30000);
      w.once('message',resolve);w.once('error',reject);w.once('exit',code=>{clearTimeout(timer);if(code)reject(new HttpError(503,'Funkstatus konnte nicht gelesen werden.'));});
    }).finally(()=>{current=null;});
    const report=await current;
    reply.header('Cache-Control','private, no-store');
    if(req.query.format==='html')return reply.type('text/html; charset=utf-8').send(linkPage(report));
    return report;
  });
}
