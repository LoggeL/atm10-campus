// Navigation metadata only. An area always reads its real parent project/version.
export const PROJECT_AREAS = Object.freeze([
  Object.freeze({id:'wasserstadt',project:'erebor',title:'Wasserstadt',summary:'Esgaroth und Brücke · E25 / E26 · eigene Übersicht, Baupläne und belegte Kanonenplätze innerhalb von Erebor.',zones:Object.freeze(['E25','E26']),href:'/projects?id=erebor&area=wasserstadt'}),
]);
export const projectArea = id => PROJECT_AREAS.find(a=>a.id===id) || null;
export function areaFromUrl(url) {
  const area = projectArea(url.pathname==='/erebor/wasserstadt' ? 'wasserstadt' : url.searchParams.get('area') || (url.pathname==='/app' ? url.searchParams.get('project') : null));
  return area && (!url.searchParams.has('id') || url.searchParams.get('id')===area.project) ? area : null;
}
export function projectEntries(projects) {
  return projects.flatMap(p=>[p,...PROJECT_AREAS.filter(a=>a.project===p.id&&!p.archivedAt).map(area=>({...p,title:area.title,summary:area.summary,area,href:area.href}))]);
}
export const areaZones = (project, area) => (project.plan.zones || []).filter(z=>area.zones.includes(z.id));
export const areaPackages = (packages, area) => packages.filter(p=>area.zones.includes(p.group));

// The same map renderer uses this projection for a whole project or a real area.
export function projectMapData(project, area=null, slots=[], scope='mountain') {
 const p=project.plan,placed=Array.isArray(p.worldOrigin);
 const zones=area?areaZones(project,area):(p.zones||[]);
 const stations=placed&&!area?(p.cannonLayout?.stations||[]):[];
 const bounds=z=>placed&&z.worldBounds?z.worldBounds:z.bounds;
 const boxes=area?zones.map(bounds):stations.length&&scope==='mountain'?[p.envelope.worldBounds]:zones.map(bounds);
 if(placed&&!area)boxes.push(p.envelope.worldBounds);
 for(const s of area?slots:stations)boxes.push([s.position,s.position]);
 const levels=area?[...new Set(zones.flatMap(z=>z.floors||[]))].sort((a,b)=>a-b).map(y=>({y,title:'Laufhöhe'})):(p.levels||[]);
 return {zones,stations,boxes,levels};
}
