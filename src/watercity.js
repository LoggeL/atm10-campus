import {isDeepStrictEqual as same} from 'node:util';

// Independently commissioned physical positions, not AP publication addresses.
export const WATER_GROUPS = [
  {id:'P01',commissioned:true,computerId:92,computer:[960,192,-9278],chest:[960,192,-9279],chestSide:'left',bridgeSide:'right',positions:{A:[959,192,-9279],B:[960,192,-9280],C:[961,192,-9279]}},
  {id:'P03',commissioned:true,computerId:93,computer:[1152,191,-9278],chest:[1152,191,-9279],chestSide:'right',bridgeSide:'left',positions:{A:[1151,191,-9279],B:[1152,191,-9280],C:[1153,191,-9279]}},
  {id:'P02',commissioned:false,computerId:null},
];
const ageOK=(at,now)=>Number.isFinite(at)&&now>=at&&now-at<45000;
const integer=n=>Number.isSafeInteger(n)&&n>=0?n:null;
const parse=raw=>{try{return JSON.parse(raw);}catch{return null;}};

function matching(job,row,slot,group) {
 const d=job?.desired,w=job?.watercity;
 return w?.slot===slot&&same(w.position,group.positions[slot.at(-1)])&&w.computerId===group.computerId&&
  d?.version===row.version&&d.blueprint===row.name&&d.sha256===row.sha&&d.owner==='Erebor'&&
  Array.isArray(d.anchor)&&d.anchor.length===3&&d.anchor.every(Number.isSafeInteger)&&
  Array.isArray(job.size)&&job.size.length===3&&job.size.every(n=>Number.isSafeInteger(n)&&n>0)&&
  d.rotation==='none'&&d.mirror==='none'&&d.options?.replace_mode===2&&d.options.skip_missing===false&&d.options.replace_block_entities===false&&
  /^campus_[0-9a-f-]{36}\.nbt$/.test(d.file||'')&&/^[0-9a-f]{64}$/.test(d.sha256||'');
}
function nativeMatch(job,row,key,report,signal) {
 const m=Array.isArray(report?.jobs)?report.jobs.filter(j=>j?.key===key):[],d=job.desired;
 return m.length===1&&m[0].selectionId===row.id&&m[0].desired?.file===d.file&&
  m[0].desired.sha256===d.sha256&&m[0].desired.blueprint===d.blueprint&&m[0].desired.version===d.version&&
  job.watercity.batch===report.batch&&job.watercity.leaseExpires===report.expires&&
  signal?.valid===true&&!signal.error&&same(signal.position,job.watercity.position)&&
  signal.file===d.file&&signal.owner===d.owner&&same(signal.anchor,d.anchor)&&same(signal.size,job.size)&&
  signal.rotation===d.rotation&&signal.mirror===d.mirror&&signal.deployed===true&&
  same(signal.options,[d.options.replace_mode,d.options.skip_missing,d.options.replace_block_entities])&&
  ['RUNNING','PAUSED','STOPPED'].includes(signal.state)&&signal.status!=='skipping'&&integer(signal.placed)!==null;
}
function supplyView(report,group,batch,now) {
 const s=report?.supply?.[group.id];
 if(!s||s.computerId!==group.computerId||s.batch!==batch||s.ok!==true)return null;
 const shortages=Object.entries(s.result?.shortages||{}).filter(([id,v])=>/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(id)&&integer(v?.inME)!==null&&integer(v?.missing)!==null)
  .map(([item,v])=>({item,inME:v.inME,missing:v.missing}));
 return {at:s.at,fresh:ageOK(s.at,now),state:s.result?.state||'unknown',shortages,reserve:500};
}

// Only SELECTs: adoption here means a presentation of the retained assignments,
// not scheduler activation or a fabricated operational completion.
export function watercityData(db,report,now=Date.now()) {
 const version=db.prepare("SELECT current_version FROM build_projects WHERE id='erebor'").get()?.current_version??null;
 const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='erebor_selections'").get();
 const rows=exists?db.prepare("SELECT id,version,site,name,sha,job,status FROM erebor_selections WHERE status IN ('waiting','loaded') AND json_type(job,'$.watercity')='object' ORDER BY id").all():[];
 const slots=[];
 for(const group of WATER_GROUPS.filter(g=>g.commissioned))for(const slot of ['A','B','C']){
  const key=group.id+slot,matches=rows.filter(r=>parse(r.job)?.watercity?.slot===key);
  const entry={key,site:group.id,slot,position:group.positions[slot],assignment:null,observation:null,problem:null};
  if(matches.length!==1){entry.problem=matches.length?'Mehrere Reservierungen für diesen Platz.':'Keine verifizierte Reservierung.';slots.push(entry);continue;}
  const row=matches[0],job=parse(row.job);
  if(!matching(job,row,key,group)){entry.problem='Reservierung und physische Zuordnung stimmen nicht überein.';slots.push(entry);continue;}
  const d=job.desired;
  entry.assignment={id:row.id,status:row.status,version:row.version,sourceSite:row.site,blueprint:d.blueprint,file:d.file,sha256:d.sha256,anchor:d.anchor,size:job.size,planBlocks:integer(job.blocks),loaded:job.loaded===true,started:job.started===true,leaseExpires:job.watercity.leaseExpires,pendingOperationalAdoption:job.watercity.pendingCampusAdoption===true};
  const fallbackAt=Number.isFinite(job.seen)?job.seen*1000:null;
  const fallback={source:'retained-native-snapshot',at:fallbackAt,fresh:false,state:job.watercity.nativeState??null,status:job.watercity.nativeStatus??null,placed:integer(job.placed),total:null,fuel:null};
  entry.observation=fallback;
  if(row.version!==version)entry.problem='Reservierung gehört zu einer anderen Projektversion.';
  else if(rows.some(r=>r.id!==row.id&&parse(r.job)?.desired?.file===d.file))entry.problem='Upload mehrfach reserviert.';
  else if(report?.schema===1&&report.version===version){
   const signal=report.stations?.[key];
   if(nativeMatch(job,row,key,report,signal)){
    entry.observation={source:'authenticated-native-tracker',at:report.at,fresh:ageOK(report.at,now)&&report.expires>now,state:signal.state,status:signal.status,placed:signal.placed,total:integer(signal.total),fuel:integer(signal.fuel)};
   }else if(report.state==='observed'&&report.expires>now)entry.problem='Aktueller nativer Auftrag nicht exakt bestätigt.';
  }
  entry.expired=!Number.isFinite(entry.assignment.leaseExpires)||now>=entry.assignment.leaseExpires;
  slots.push(entry);
 }
 const groups=WATER_GROUPS.map(group=>{
  const assigned=slots.filter(s=>s.site===group.id&&s.assignment),batches=new Set(assigned.map(s=>parse(rows.find(r=>r.id===s.assignment.id)?.job)?.watercity?.batch));
  return {...group,supply:group.commissioned&&assigned.length===3&&batches.size===1?supplyView(report,group,[...batches][0],now):null};
 });
 const p02=exists?db.prepare("SELECT name,job FROM erebor_selections WHERE version=? AND json_extract(job,'$.p02.slot') IN ('P02A','P02B','P02C') ORDER BY id").all(version)
   .map(row=>{const j=parse(row.job);return {...j.p02,phase:j.phase,name:row.name};}):[];
 return {version,at:now,automaticNextJob:false,readOnly:true,slots,groups,p02};
}
