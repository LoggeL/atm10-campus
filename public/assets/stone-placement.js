// Shared by API exports and the project UI: one cannon assignment and filename.
export const STONE_BATCH_SIZE = 16;
export function nearestStoneCannon(plan, origin) {
  let best=null;
  for(const station of plan.cannonLayout?.stations||[]) {
    if(!/^K[0-9]{2}$/.test(station.id)||!Array.isArray(station.position)||station.position.length!==3||!station.position.every(Number.isSafeInteger))continue;
    const distance=Math.hypot(...origin.map((n,i)=>n-station.position[i]));
    if(distance<256&&(!best||distance<best.distance))best={id:station.id,position:station.position,distance};
  }
  return best;
}
export function stoneFileName(project,version,tile,plan) {
  const cannon=nearestStoneCannon(plan,tile.origin);
  return `${project.toUpperCase()}_STEIN_${cannon?cannon.id+'_':''}${tile.id}_V${version}.nbt`;
}
export function stoneBatchTiles(tiles,plan,cannonId,part) {
  if(!/^K[0-9]{2}$/.test(cannonId)||!plan.cannonLayout?.stations.some(s=>s.id===cannonId))throw Error('Unbekannter Kanonenstandort.');
  if(!Number.isSafeInteger(part)||part<1)throw Error('Paketnummer muss eine positive ganze Zahl sein.');
  const assigned=tiles.filter(t=>nearestStoneCannon(plan,t.origin)?.id===cannonId);
  const parts=Math.ceil(assigned.length/STONE_BATCH_SIZE);
  if(part>parts)throw Error('Paketnummer liegt außerhalb der verfügbaren Abschnitte.');
  return {tiles:assigned.slice((part-1)*STONE_BATCH_SIZE,part*STONE_BATCH_SIZE),parts,total:assigned.length};
}
