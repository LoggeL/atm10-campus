// Local room bounds plus project placement are authoritative. R2 plans omitted
// the derived worldBounds for enlarged/new rooms; older cached bounds can be stale.
export function withWorldCoordinates(plan){
 if(!Array.isArray(plan.worldOrigin)||plan.worldOrigin.length!==3||!plan.worldOrigin.every(Number.isSafeInteger)||![0,90,180,270].includes(plan.rotationDegrees)||!Array.isArray(plan.zones))return plan;
 const [a,b,c]=plan.worldOrigin,q=plan.rotationDegrees;
 const point=([x,y,z])=>q===90?[a+z,b+y,c-x]:q===180?[a-x,b+y,c-z]:q===270?[a-z,b+y,c+x]:[a+x,b+y,c+z];
 return {...plan,zones:plan.zones.map(zone=>{
  if(!Array.isArray(zone.bounds)||zone.bounds.length!==2||!zone.bounds.every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isSafeInteger)))return zone;
  const corners=zone.bounds.map(point);
  return {...zone,worldBounds:[corners[0].map((v,i)=>Math.min(v,corners[1][i])),corners[0].map((v,i)=>Math.max(v,corners[1][i]))],worldFloors:zone.floors?.map(y=>y+b)};
 })};
}
