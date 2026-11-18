// All scanner outputs, including _LUFT cavity fills, place minecraft:stone.
// Special block-entity targets are manual and deliberately outside automatic demand.
export function massifWorkload(tiles,site){
 if(!tiles)return null;
 const result={grossBlocks:0,assignedBlocks:0,manualBlocks:0};
 for(const tile of tiles){
  if(tile.done||(site!==undefined&&(tile.site??tile.home)!==site))continue;
  if(tile.special)result.manualBlocks+=tile.blocks;
  else {result.grossBlocks+=tile.blocks;if(tile.site)result.assignedBlocks+=tile.blocks;}
 }
 return result;
}
const geometry=name=>name.replace(/_V\d+$/,'');
const empty=()=>({done:0,open:0,inProgress:0,total:0});
const stages=()=>Object.fromEntries(['stone','build','clear'].map(s=>[s,empty()]));
const sum=ledger=>({...ledger,total:ledger.done+ledger.open+ledger.inProgress});

// Pure read projection: canonical current catalog only; no queue/receipt writes.
export function constructionCounter(production,project,sites,active,counts,massifPublished,tiles=null){
 const total=stages(),stations={};
 for(const site of sites){
  const own=stages(),done=new Set([...production.ordered(project,site).done.keys()].map(geometry));
  const busy=new Set(active.filter(r=>r.site===site&&r.job?.desired?.version===project.current_version&&!r.job.massif).map(r=>r.job.desired.blueprint).filter(Boolean).map(geometry));
  const seen=new Set();
  for(const file of production.catalog(project,site)){
   const name=geometry(file.name);if(seen.has(name))continue;seen.add(name);
   const stage=file.stage||'unknown';own[stage]??=empty();total[stage]??=empty();
   const state=done.has(name)?'done':busy.has(name)?'inProgress':'open';
   own[stage][state]++;own[stage].total++;total[stage][state]++;total[stage].total++;
  }
  stations[site]={stages:own,massif:massifPublished?{...sum(counts.stations[site].massif),workload:massifWorkload(tiles,site)}:null};
 }
 return {version:project.current_version,capturedAt:new Date().toISOString(),basis:'published/cataloged',targetTotal:null,stages:total,massif:massifPublished?{...sum(counts.total.massif),workload:massifWorkload(tiles)}:null,stations,unassignedMassif:massifPublished?{...sum(counts.unassigned.massif),workload:massifWorkload(tiles,null)}:null};
}
