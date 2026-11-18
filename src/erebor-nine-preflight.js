// Offline preparation only: deliberately not imported by the running scheduler.
import {isDeepStrictEqual as same} from 'node:util';

const requireThat=(ok,message)=>{if(!ok)throw Error(message);};
const position=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isSafeInteger);
const adjacent=(a,b)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0)===1;
const name=n=>typeof n==='string'&&n.length>0&&n.length<=128&&!/\s/.test(n);
export function ninePreflight(config,observation,jobs=[],now=Date.now()){
 requireThat(config==null||config.enabled===undefined||typeof config.enabled==='boolean','Boolean opt-in required');
 if(config?.enabled!==true)return {mode:'legacy',slots:['A','B','C']};
 requireThat(config.schema===1&&/^K(?:0[1-9]|[12][0-9]|3[0-7])$/.test(config.site)&&
  Number.isSafeInteger(config.version)&&config.version>0&&config.dimension==='minecraft:overworld','Invalid expansion identity');
 requireThat(position(config.bridge)&&Array.isArray(config.groups)&&config.groups.length===3,'Explicit measured mapping required');
 requireThat(Number.isFinite(now)&&Number.isFinite(observation?.at)&&now>=observation.at&&now-observation.at<10000,'Fresh observation required');
 requireThat(observation.version===config.version&&observation.site===config.site&&observation.dimension===config.dimension&&
  same(observation.bridge?.position,config.bridge)&&observation.bridge.online===true&&observation.bridge.powered===true,'Bridge or identity unconfirmed');
 requireThat(Array.isArray(observation.groups)&&observation.groups.length===3,'Three observed groups required');
 const used=new Set([config.bridge.join(',')]),ids=new Set(),computers=new Set(),chests=new Set(),slots=new Set();
 const claim=p=>{requireThat(position(p),'Invalid position');const key=p.join(',');requireThat(!used.has(key),'Physical positions must be distinct');used.add(key);};
 const result=[];
 for(const g of config.groups){
  requireThat(name(g.id)&&!ids.has(g.id),'Distinct group IDs required');ids.add(g.id);
  requireThat(Number.isSafeInteger(g.computerId)&&g.computerId>=0&&!computers.has(g.computerId),'Distinct computer IDs required');computers.add(g.computerId);
  const sides=['top','bottom','front','back','left','right'];
  requireThat(name(g.chestName)&&name(g.bridgeName),'Explicit feed names required');
  if(g.access==='direct'){
   requireThat(sides.includes(g.chestName)&&sides.includes(g.bridgeName)&&g.chestName!==g.bridgeName&&
    adjacent(g.computer,config.bridge),'Direct computer must adjoin shared bridge');
  }else{
   requireThat(g.access===undefined||g.access==='wired','Unknown peripheral access');
   requireThat(!chests.has(g.chestName),'Explicit distinct feed names required');chests.add(g.chestName);
   requireThat(!sides.includes(g.chestName)&&!sides.includes(g.bridgeName),'Wired peripheral names required');
  }
  claim(g.computer);claim(g.chest);
  requireThat(adjacent(g.computer,g.chest)&&Array.isArray(g.slots)&&g.slots.length===3,'One local computer and three neighbours per chest required');
  const observed=observation.groups.filter(o=>o.id===g.id);
  requireThat(observed.length===1,'Group observation missing or duplicated');
  const o=observed[0];
  for(const key of ['computerId','computer','chest','chestName','bridgeName','access'])requireThat(same(o[key],g[key]),'Feed identity mismatch');
  if(g.access==='direct'){
   const p=o.exportProof;
   requireThat(p?.computerId===g.computerId&&p.chestName===g.chestName&&p.bridgeName===g.bridgeName&&
    p.exported===1&&p.returned===1&&p.emptyAfter===true,'Direct export and rollback proof required');
  }
  requireThat(o.chestBlock==='sophisticatedstorage:netherite_chest'&&Array.isArray(o.slots)&&o.slots.length===3,'Netherite chest and consumers unconfirmed');
  for(const s of g.slots){
   requireThat(/^[A-I]$/.test(s.slot)&&!slots.has(s.slot),'Distinct A-I slots required');slots.add(s.slot);
   claim(s.position);requireThat(adjacent(s.position,g.chest),'Cannon must neighbour its own chest');
   const signals=o.slots.filter(v=>v.slot===s.slot);
   requireThat(signals.length===1&&same(signals[0].position,s.position),'Cannon observation mismatch');
  }
  result.push({id:g.id,computerId:g.computerId,chestName:g.chestName,slots:g.slots.map(s=>s.slot)});
 }
 for(const g of config.groups)for(const other of config.groups)if(g.id!==other.id)
  requireThat(other.slots.every(s=>!adjacent(s.position,g.chest)),'Cross-group chest consumer');
 requireThat(slots.size===9&&result.some(g=>same([...g.slots].sort(),['A','B','C'])),'Legacy A/B/C group must stay together');
 requireThat(Array.isArray(jobs),'Explicit job list required');
 const jobSlots=new Set(),uploads=new Set();
 for(const j of jobs){
  requireThat(j&&slots.has(j.slot)&&!jobSlots.has(j.slot)&&!uploads.has(j.file),'Distinct jobs and uploads required');
  requireThat(/^campus_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.nbt$/.test(j.file)&&/^[0-9a-f]{64}$/.test(j.sha256)&&
   position(j.anchor)&&position(j.size)&&j.size.every(n=>n>0&&n<=128)&&same(j.options,[2,false,false]),'Exact supported job identity required');
  jobSlots.add(j.slot);uploads.add(j.file);
 }
 for(const g of result){
  g.jobs=jobs.filter(j=>g.slots.includes(j.slot)).map(j=>structuredClone(j));
  const signals=observation.groups.find(o=>o.id===g.id).slots;
  for(const s of signals){
   const j=g.jobs.find(j=>j.slot===s.slot);
   if(!j){requireThat(s.empty===true&&!s.file,'Unassigned loaded cannon');continue;}
   requireThat(s.empty===false&&s.owner==='Erebor'&&s.aligned===true,'Loaded cannon unconfirmed');
   for(const key of ['file','sha256','anchor','size','options'])requireThat(same(s[key],j[key]),'Loaded job mismatch');
  }
 }
 return {mode:'prepared-only',runtimeEnabled:false,site:config.site,version:config.version,groups:result};
}
