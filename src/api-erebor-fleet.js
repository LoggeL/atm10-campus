import {readFileSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {HttpError,requireActor} from './auth.js';
import {zipStore} from './zip.js';

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
function checkedLayout(req,campus) {
  requireActor(req,'read');
  const row=campus.db.prepare('SELECT plan_json FROM build_projects WHERE id=?').get('erebor');
  const live=row && JSON.parse(row.plan_json).cannonLayout?.stations;
  if(!Array.isArray(live)||live.length!==layout.sites.length||layout.sites.some(s=>
    !live.some(r=>r.id===s.site&&JSON.stringify(r.position)===JSON.stringify(s.planned))))
    throw new HttpError(409,'Der Erebor-Standortplan hat sich geändert. Installer-Zuordnung neu prüfen.');
}
export function registerEreborFleet(app,campus) {
  const prefix='/api/projects/erebor/cannon-sites';
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
