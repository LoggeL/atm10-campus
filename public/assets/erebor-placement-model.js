// Shared by the private artifact loader and browser; no runtime/world authority.
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => text(value) && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const position = value => value && ['x','y','z'].every(axis => Number.isSafeInteger(value[axis]));
export function validatePlacementDraft(plan) {
 const check=(ok,message)=>{if(!ok)throw new Error('Ungültiger Aufstellungsplan: '+message);};
 check(plan?.schemaVersion===1,'schemaVersion');
 check(text(plan.planId)&&text(plan.revision)&&date(plan.generatedAt)&&text(plan.source),'Planherkunft');
 check(Array.isArray(plan.stations)&&plan.stations.length>0,'Stationen fehlen');
 if(plan.planning!==undefined){
  check(plan.planning.status==='conditional-not-build-ready','Planungsstatus');
  check(Array.isArray(plan.planning.notes)&&plan.planning.notes.every(text),'Planungshinweise');
  for(const s of plan.stations)check(s.readiness==='conditional-not-build-ready'&&Array.isArray(s.blockers)&&s.blockers.length>0&&s.blockers.every(text),'Freigabesperren');
 }
 const ids=new Set();
 for(const station of plan.stations){
  check(text(station.id)&&!ids.has(station.id),'doppelte/fehlende Stations-ID');ids.add(station.id);
  check(text(station.label)&&text(station.dimension),'Stationsbezeichnung/Dimension');
  check(station.equipment&&station.cannons,'Ausstattung');
  for(const key of ['receiver','bridge','computer','chest'])check(station.equipment[key]===null||position(station.equipment[key]),key);
  check(Array.isArray(station.equipment.cable)&&station.equipment.cable.every(position),'Kabelpositionen');
  check(position(station.cannons.A),'Kanone A');
  for(const slot of ['B','C'])check(station.cannons[slot]===null||position(station.cannons[slot]),'Reserve '+slot);
  if(station.observed!==undefined&&station.observed!==null){
   const o=station.observed;
   check(date(o.at)&&text(o.source),'Beobachtungsherkunft');
   check(o.computerId===null||(Number.isSafeInteger(o.computerId)&&o.computerId>=0),'Computer-ID');
   check(Array.isArray(o.blocks)&&o.blocks.every(b=>position(b.position)&&text(b.blockId)),'Blockbeobachtungen');
  }
 }
 return plan;
}
