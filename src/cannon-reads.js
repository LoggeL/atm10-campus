// A UI refresh and feeder poll may ask for the same proof concurrently. Share
// only in-flight reads of the same job, never a cached safety decision. Serial
// reads also keep multi-command fallback probes from interleaving each other.
export function createCannonReads(request) {
  const pending=new Map();let tail=Promise.resolve();
  return (station,identity)=>{
    const key=JSON.stringify([station.toLowerCase(),identity]);
    if(pending.has(key))return pending.get(key);
    const read=tail.then(()=>request('inspect',{station}));
    tail=read.catch(()=>{});
    pending.set(key,read);
    read.then(()=>pending.delete(key),()=>pending.delete(key));
    return read;
  };
}
