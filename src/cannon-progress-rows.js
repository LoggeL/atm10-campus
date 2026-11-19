import {slotsFor,isFinishingSlot} from './erebor-groups.js';
export function cannonProgressRows(mains,helpers,report){
 return mains.flatMap(main=>slotsFor(main.site).flatMap(slot=>{
  const station=slot==='A'?main.site:main.site+slot;
  const job=slot==='A'?main.job:helpers.find(h=>h.site===main.site&&h.slot===slot)?.job;
  const signal=report?.stations?.[station];
  if(isFinishingSlot(main.site,slot)&&!job&&!(signal?.ready&&signal.state))return [];
  const live=job?.loaded&&signal?.upload===job.desired.file?{state:signal.state,status:signal.status,placed:signal.placed,total:signal.total,at:report.at}:null;
  return {station,site:main.site,slot,file:job?.desired.blueprint||null,live};
 }));
}
