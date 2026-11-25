import {groupOf,slotsFor} from './erebor-groups.js';
import {ASSET_VERSION,campusPage} from './campus-page.js';
import {readFileSync} from 'node:fs';
import {stationSource} from './erebor-me-order.js';
import {Worker} from 'node:worker_threads';
import {HttpError,requireActor} from './auth.js';
import {tx,now,logActivity} from './db.js';
import {normalizeOptions} from './api-stations.js';
import {zipStore} from './zip.js';
import {parallelLayout} from './erebor-parallel.js';

const folder=new URL('./erebor-fleet/',import.meta.url);
const file=name=>readFileSync(new URL(name,folder));
const layout=JSON.parse(file('stations.json'));
const hubNames={A0:'Zentralhub A',A1:'A-Nordwest',A2:'A-Nordost',B0:'Zentralhub B',B1:'B-Südwest',B2:'B-Südost'};
function linkPage(report,actor) {
  const label=id=>hubNames[id]||id;
  const rows=Object.entries(layout.hubs).map(([id,pos])=>{
    const links=report.links.filter(l=>l.hub===id||l.id===id);
    const name=l=>label(l.hub===id?l.id:l.hub);
    const head=report.hubs[id];
    const pending=links.filter(l=>l.state!=='paired').map(l=>name(l)+' ('+({absent:'Block fehlt',unknown:'unbekannt',ambiguous:'mehrdeutig',unpaired:'offen'}[l.state])+')');
    const ports=head.ports.map(p=>p.port+' → '+(p.peers.map(label).join(', ')||'unbekanntes Ziel')).join('<br>');
    const portCell=head.present===null
      ?'<span class="c-badge c-badge--neutral">Unbekannt</span>'
      :head.present
        ?'<span class="c-badge c-badge--ok">Belegt: '+head.ports.length+'/8</span>'+(ports?'<div class="cell-note">'+ports+'</div>':'')
        :'<span class="c-badge c-badge--danger">Hub fehlt</span>';
    const checkCell=pending.length
      ?'<span class="c-badge c-badge--warn">Offen</span><div class="cell-note">'+pending.join(', ')+'</div>'
      :'<span class="c-badge c-badge--ok">Alle gekoppelt</span>';
    return '<tr><th scope="row">'+label(id)+'</th><td class="c-mono">'+(head.position||pos).join(' / ')+'</td><td>'+links.map(name).join(', ')+'</td><td>'+portCell+'</td><td>'+checkCell+'</td></tr>';
  }).join('');
  const surveyed=new Date(report.surveyedAt).toLocaleString('de-DE',{timeZone:'Europe/Berlin'});
  return campusPage('<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Funkverbindungen · ATM10 Campus</title><link rel="stylesheet" href="/assets/app.css?v='+ASSET_VERSION+'"></head><body><a class="skip-link" href="#main">Zum Inhalt</a><!-- campus-navigation --><main id="main" class="c-shell">'+
    '<div class="c-page-head"><div class="c-page-head-main"><p class="c-eyebrow">Bauprojekt Erebor · Stationstechnik</p><h1>Funkverbindungen bei Erebor</h1><p class="c-page-sub">Mit dem ME Wireless Setup Kit beide Partner eines Paars rechtsklicken. Bei einer Kanone den Wireless Connector anklicken. Eine Hub-Verbindung wird nur einmal gekoppelt.</p></div>'+
    '<div class="c-page-actions"><span class="c-status-pill c-status-pill--info"><span class="c-status-dot c-status-dot--info" aria-hidden="true"></span>Weltstand: '+surveyed+' Uhr (Berlin)</span><a class="c-btn c-btn--sm" href="/app?project=erebor#cannon-coordinates">← Kanonenstandorte</a></div></div>'+
    '<div class="c-table-wrap table-wrap" role="region" aria-label="Funkverbindungen" tabindex="0"><table><thead><tr><th scope="col">Hub</th><th scope="col">X / Y / Z</th><th scope="col">Vorgesehene Partner</th><th scope="col">Gespeicherte Ports</th><th scope="col">Zu prüfen</th></tr></thead><tbody>'+rows+'</tbody></table></div></main></body></html>',actor,'tech');
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
    const site=groupOf(name)?.name.split('-')[0]??/^erebor-(K\d{2})$/i.exec(name)?.[1]?.toUpperCase();
    if(!site)return null;
    const network=(await campus.ereborLiveReport(parallelLayout.version))?.network;
    const group=groupOf(name),key=group?.name.includes('-2')?group.name:site;
    return network?.stations?.[key]?{...network.stations[key],at:network.at,source:network.source,power:network.power}:{stale:true,at:null};
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
    requireActor(req,'read');
    if(req.query.format!=='json')return reply.redirect('/app?project=erebor#cannons');
    checkedLayout(req,campus);
    const version=parallelLayout.version;
    const report=await campus.ereborLiveReport(version);
    const jobs=campus.ereborHelpers.list(version);
    const diagnostics=await Promise.all(layout.sites.map(async s=>{
      const row=campus.db.prepare('SELECT status_json,last_seen_at FROM cannons WHERE name=?').get('erebor-'+s.site);
      const status=JSON.parse(row?.status_json||'null');
      return {name:s.site,online:!!row?.last_seen_at&&Date.now()-Date.parse(row.last_seen_at)<180000,status,network:await campus.ereborNetworkView('erebor-'+s.site)};
    }));
    const stations=parallelLayout.sites.map(pair=>({...pair,helpers:slotsFor(pair.site).slice(1).map(slot=>({
      slot,job:jobs.find(j=>j.site===pair.site&&j.slot===slot)||null,live:report?.stations?.[pair.site+slot]||null
    }))}));
    reply.header('Cache-Control','private, no-store');
    const enabled=campus.ereborHelpers.isEnabled(version);
    const queue=campus.db.prepare('SELECT version,enabled FROM erebor_queue_config WHERE id=1').get();
    const settings=supplySettings();
    const stoneOrders=JSON.parse(stationOptions.get('erebor-K02')?.options_json||'{}')?.stoneAutoCraft===true;
    const resume=campus.db.prepare('SELECT site,slot,result,expires FROM erebor_resume WHERE version=? ORDER BY site,slot').all(version);
    return {version,enabled,stoneOrders,autoLoad:!!queue?.enabled,staleQueue:!!queue&&queue.version!==version,at:report?.at||null,chestTracker:report?.chestTracker??null,chestController:report?.chestController??null,stations,diagnostics,power:report?.network?.power||[],supplySettings:settings,resume};
  });
  app.get(prefix+'/installer.zip',async(req,reply)=>{
    checkedLayout(req,campus);
    const entries=['ANLEITUNG.txt','install.py','stations.json'].map(name=>({name,data:file(name)}));
    entries.push({name:'campus.lua',data:Buffer.from(stationSource())});
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
    if(req.query.format==='html')return reply.type('text/html; charset=utf-8').send(linkPage(report,req.actor));
    return report;
  });
}
