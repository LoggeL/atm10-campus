export function cannonProgressRows(mains,helpers,report){
 return mains.flatMap(main=>['A','B','C'].map(slot=>{
  const station=slot==='A'?main.site:main.site+slot;
  const job=slot==='A'?main.job:helpers.find(h=>h.site===main.site&&h.slot===slot)?.job;
  const signal=report?.stations?.[station];
  const live=job?.loaded&&signal?.upload===job.desired.file?{state:signal.state,status:signal.status,placed:signal.placed,total:signal.total,at:report.at}:null;
  return {station,site:main.site,slot,file:job?.desired.blueprint||null,live};
 }));
}
