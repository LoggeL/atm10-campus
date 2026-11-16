import {DESIGN_REVISION} from './erebor-design.js';

const empty=()=>({open:0,inProgress:0,done:0});
const ledgers=()=>({catalog:empty(),massif:empty()});
const geometry=name=>name.replace(/_V\d+$/,'');

// A read-only projection. Reservations are subsets, not additional geometry.
// These ledgers are intentionally never combined into a percentage or total.
export function productionCounts(db,production,project,sites,mains=[],helpers=[]) {
 const version=project.current_version,stations=Object.fromEntries(sites.map(site=>[site,ledgers()]));
 const total=ledgers(),unassigned=ledgers();
 for(const site of sites){
  const {done}=production.ordered(project,site);
  const finished=new Set([...done.keys()].map(geometry));
  const active=new Set();
  for(const row of [...mains,...helpers]){
   const job=row.job;
   if(row.site===site&&job?.desired?.version===version&&!job.massif&&job.desired.blueprint)active.add(geometry(job.desired.blueprint));
  }
  const catalog=new Set();
  // ordered.done also contains massif and historical receipts: intersect it
  // with the published current-version/revision catalog, not history size.
  // The store exposes catalog explicitly to avoid reconstructing done entries.
  const files=production.catalog(project,site);
  catalog.clear();for(const f of files)catalog.add(geometry(f.name));
  for(const name of catalog)stations[site].catalog[finished.has(name)?'done':active.has(name)?'inProgress':'open']++;
 }
 for(const row of db.prepare('SELECT home,site,slot,done FROM erebor_massif_tiles WHERE v=?').all(version)){
  const ledger=stations[row.site??row.home]??unassigned;
  ledger.massif[row.done?'done':row.site!==null?'inProgress':'open']++;
 }
 for(const ledger of [...Object.values(stations),unassigned])for(const kind of ['catalog','massif'])for(const key of ['open','inProgress','done'])total[kind][key]+=ledger[kind][key];
 return {version,revision:DESIGN_REVISION,stations,unassigned,total};
}
