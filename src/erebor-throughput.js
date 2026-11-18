// Process-local bounded observations; no persistence, controller or queue writes.
const FRESH=45000,WINDOW=300000,MIN=15000;
const valid=s=>s&&typeof s.upload==='string'&&s.upload.length>0&&Number.isSafeInteger(s.placed)&&s.placed>=0;
const knownTotal=s=>Number.isSafeInteger(s?.total)&&s.total>0&&s.total>=s.placed;
const fresh=(r,now)=>r&&Number.isFinite(r.at)&&r.at<=now&&now-r.at<FRESH;
export function placementThroughput(){
 const history=new Map();let version=null,lastAt=0;
 return {
  observe(report,now=Date.now()){
   if(!fresh(report,now))return;
   if(version!==report.version){history.clear();version=report.version;lastAt=0;}
   if(report.at<=lastAt)return;
   lastAt=report.at;
   for(const station of history.keys())if(!valid(report.stations?.[station]))history.delete(station);
   for(const [station,s] of Object.entries(report.stations||{})){
    if(!valid(s))continue;
    let samples=history.get(station)||[];const previous=samples.at(-1);
    if(previous&&(previous.upload!==s.upload||previous.total!==s.total||s.placed<previous.placed||report.at-previous.at>=FRESH))samples=[];
    samples.push({at:report.at,upload:s.upload,placed:s.placed,total:s.total});
    samples=samples.filter(p=>report.at-p.at<=WINDOW).slice(-301);
    history.set(station,samples);
   }
  },
  read(report,rows,now=Date.now()){
   const isFresh=fresh(report,now)&&version===report.version;
   const cannons=rows.filter(r=>r.file).map(row=>{
    const signal=isFresh&&row.live?report.stations?.[row.station]:null;
    const samples=history.get(row.station)||[],first=samples[0],last=samples.at(-1);
    const seconds=valid(signal)&&last?.at===report.at&&last.upload===signal.upload&&last.total===signal.total?(last.at-first.at)/1000:0;
    const rate=seconds>=MIN/1000?(last.placed-first.placed)/seconds:null;
    const remaining=valid(signal)&&knownTotal(signal)&&row.workloadBlocks===signal.total?signal.total-signal.placed:null;
    return {station:row.station,file:row.file,at:signal?report.at:null,seconds,delta:rate===null?null:last.placed-first.placed,blocksPerSecond:rate,blocksPerHour:rate===null?null:rate*3600,remaining,etaSeconds:rate>0&&remaining!==null?remaining/rate:null};
   });
   const measured=cannons.filter(c=>c.blocksPerSecond!==null);
   const rate=measured.length?measured.reduce((sum,c)=>sum+c.blocksPerSecond,0):null;
   return {at:isFresh?report.at:null,windowSeconds:WINDOW/1000,covered:measured.length,assigned:cannons.length,blocksPerSecond:rate,blocksPerHour:rate===null?null:rate*3600,cannons};
  }
 };
}
