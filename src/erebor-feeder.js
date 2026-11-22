import {groupOf,groupCount,supplyGroup} from './erebor-groups.js';
import {isDeepStrictEqual as same} from 'node:util';
import {verifyAlignment} from './alignment.js';
import {itemsFor,stackSize} from './materials.js';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {latestStock} from './me-stock.js';
import {hasFeederPatch} from './feeder-version.js';
import {oldTreeInput} from './erebor-landscape-work.js';

function deliverBlock(job,key,block){
 if(block.endsWith('_leaves'))return false;
 return !/^minecraft:(?:oak|birch|spruce)_log$/.test(block)||!oldTreeInput(key,job);
}

export const isEreborStation=name=>!!groupOf(name)||/^erebor-K(?:0[1-9]|[12][0-9]|3[0-7])$/i.test(name);
export const needsSolidReplacement=desired=>desired?.blueprint?.includes('_MASSIV_')&&!desired.blueprint.includes('_LUFT_')&&!desired.blueprint.includes('_URN_');

// Installed V5 controllers prepare stone in mode 0. V6 and manually
// updated cannons use 2. All other options and identity checks stay exact.
export function observedEreborOptions(desired,observed){
 const options=desired.options;
 if(desired.blueprint?.includes('_URN_'))return options;
 if(!needsSolidReplacement(desired)&&desired.owner==='Erebor'&&/^EREBOR_STEIN_K\d{2}_/.test(desired.blueprint)&&
    [0,2].includes(options?.replace_mode)&&[0,2].includes(observed?.replace_mode)&&
    options.skip_missing===false&&options.replace_block_entities===false)
   return {...options,replace_mode:observed.replace_mode};
 return options;
}
export function verifyEreborAlignment(desired,observed,receipt){
 if(!same(desired,receipt))return verifyAlignment(desired,observed,receipt);
 const expected={...desired,options:observedEreborOptions(desired,observed?.options)};
 return verifyAlignment(expected,observed,expected);
}

// The empty printer returns to the fleet default after consuming a plan.
// Only use this for an independently verified empty, stopped cannon.
export function completedStoneOptions(desired,observed){
 if(desired.blueprint?.includes('_URN_')&&observed?.replace_mode===2)
  return {...desired.options,replace_mode:2};
 return observedEreborOptions(desired,observed);
}

export function isStationStone(job,site){
 const d=job?.desired;
 return (job?.phase==='stone'||job?.phase==='build'&&job.massif&&needsSolidReplacement(d)) && d?.owner==='Erebor' && d.blueprint?.startsWith('EREBOR_STEIN_'+site+'_') &&
  [0,2].includes(d.options?.replace_mode) && d.options.skip_missing===false && d.options.replace_block_entities===false;
}

// The host serializes Minecraft commands. Queue at the caller, before the
// transport timeout starts, rather than sending 37 expiring HTTP requests.
export function limitSupplyReads(request){
 const waiting=[];
 let active=0,lastWasStocked=false;
 async function run(entry){
  active++;
  try{
   if(Date.now()-entry.at>20_000)throw new Error('Materialprüfung wartet auf freie Controller-Kapazität.');
   entry.resolve(await request('erebor-supply',entry.args));
  }catch(e){entry.reject(e);}
  finally{
   active--;
   if(waiting.length){
    // A waiting printer gets the next slot ahead of routine top-ups. Age
    // the queue so a continuously busy group cannot starve the others.
    const urgent=waiting.findIndex(entry=>entry.urgent);
    const stocked=lastWasStocked?-1:waiting.findIndex(entry=>entry.stocked);
    const next=stocked>=0?stocked:Date.now()-waiting[0].at<5000&&urgent>=0?urgent:0;
    lastWasStocked=stocked>=0;
    void run(waiting.splice(next,1)[0]);
   }
  }
 }
 return (args,urgent=false,stocked=false)=>new Promise((resolve,reject)=>{
  const entry={args,urgent,stocked:stocked===true,at:Date.now(),resolve,reject};
  if(active<2)void run(entry);
  else if(waiting.length<37+groupCount)waiting.push(entry);
  else reject(new Error('Materialprüfung wartet auf freie Controller-Kapazität.'));
 });
}

export function ereborFeeder(db,request,version,liveReport,savedMissingItems){
 const samples=new Map(),views=new Map(),pending=new Map();
 const craftOwners=new Map(),reserveNeeds=new Map();
 const lookup=db.prepare("SELECT s.state FROM erebor_queue_sites s JOIN erebor_queue_config q ON q.id=1 JOIN build_projects p ON p.id='erebor' WHERE s.site=? AND q.version=? AND p.current_version=q.version");
 const jobAt=site=>JSON.parse(lookup.get(site,version)?.state||'{}').job;
 const stationAt=db.prepare('SELECT status_json,options_json FROM cannons WHERE name=?');
 let legacyUntil=0;
 const supplyRead=limitSupplyReads(request);
 const helperRows=db.prepare('SELECT slot,job FROM erebor_helpers WHERE site=? AND version=? AND job IS NOT NULL ORDER BY slot');
 function groupJobs(site,live){
  const jobs={},main=jobAt(site);
  // A counter discontinuity invalidates completion evidence. The host can still
  // independently prove the identity of the loaded stone plan for material supply.
  const eligible=(job,slot)=>{
   if(job?.loaded&&(!job.tainted||isStationStone(job,site)))return true;
   const s=live?.stations?.[site+(slot==='A'?'':slot)],d=job?.desired;
   // The tracker can see an installed room before the scheduler reads back
   // its first shot. The independent physical chest/file check still follows.
   return d&&(job.interior||job.surface)&&s?.ready&&s.aligned&&['RUNNING','PAUSED'].includes(s.state)
    &&s.upload===d.file&&s.owner===d.owner&&same(s.anchor,d.anchor)&&same(s.size,job.size)
    &&same(s.options,[d.options.replace_mode,d.options.skip_missing,d.options.replace_block_entities]);
  };
  if(eligible(main,'A'))jobs.A=main;
  for(const r of helperRows.all(site,version)){
   const job=JSON.parse(r.job);
   if(eligible(job,r.slot))jobs[r.slot]=job;
  }
  return jobs;
 }
 function groupTargets(jobs,site,live){
  return Object.fromEntries(Object.entries(jobs).map(([slot,j])=>{
   const {file,sha256,anchor,options}=j.desired;
   const native=live.stations?.[site+(slot==='A'?'':slot)];
   const mode=isStationStone(j,site)&&!needsSolidReplacement(j.desired)&&native?.upload===file&&[0,2].includes(native.options?.[0])
     ?native.options[0]:options.replace_mode;
   return [slot,{file,sha256,anchor,size:j.size,options:[mode,options.skip_missing,options.replace_block_entities]}];
  }));
 }
 async function readSupply(site,reported,job){
  const {options,...desired}=job.desired,file=desired.file;
  const args={site,version,computerId:reported.computerId,chestSide:reported.chestSide};
  const target={desired,options,size:job.size};
  const key=JSON.stringify([site,file,args.computerId,args.chestSide]);
  if(pending.has(key))return pending.get(key);
  const read=(async()=>{
   const started=Date.now();
   for(let attempt=1;;attempt++){
    try{
     if(Date.now()>=legacyUntil){
      try{
       return {...await supplyRead({...args,target}),attempt};
      }catch(e){
       // Older hosts reject the additional key before reading the world.
       if(e.message!=='Erebor-Standortplan oder Auftrag passt nicht.')throw e;
       legacyUntil=Date.now()+60_000;
      }
     }
     return {...await supplyRead(args),attempt};
    }catch(e){
     // A competing RCON read can return no identifiable block. Only a new,
     // physically guarded read can authorize supply. Never retry a write.
     if(e.message!=='Minecraft hat keine eindeutige Antwort für diese Kanonenposition geliefert. Bitte erneut prüfen.'||
        attempt>=3||Date.now()-started>5000)throw e;
     await delay(100*attempt+Math.random()*150);
    }
   }
  })();
  pending.set(key,read);
  try{return await read;}finally{pending.delete(key);}
 }
 const poll=async(row,opts)=>{
  const extra=groupOf(row.name),site=extra?extra.name.split('-')[0]:row.name.slice(-3).toUpperCase(),j=extra?null:jobAt(site),reported=JSON.parse(row.status_json||'{}')||{};
  const assignment=j?parseInt(j.desired.file.slice(7).replaceAll('-','').slice(0,12),16):row.assignment;
  const base={...opts,cannon:row.name,assignment,intervals:{...opts.intervals,plan:5},done:false,items:[],blueprint:null,totals:{start:0,needed:0,kinds:0}};
  // The CC computer resets its per-job delivery limit when the assignment changes.
  // A failed probe must not reset that limit while the same group is building.
  const held=message=>({...base,assignment:views.get(row.name)?.plan.assignment??reported.assignment??assignment,state:'alignment',message,alignment:{enabled:true,state:'blocked',leaseSeconds:10},options:{...base.options,paused:true,returnLeftovers:false,gunpowder:0,autoCraft:false}});
  if(!Number.isInteger(reported.computerId)||!reported.chestSide||!(Math.abs(Date.now()-Date.parse(reported.at))<180000))return held('Wartet auf aktuelle Computer-ID und Kistenseite.');
  try{
   const live=await liveReport(version);
   const group=supplyGroup(groupJobs(site,live),extra);
   if(live?.sharedChest===4&&(extra||group.B||group.C||live.stations?.[site+'B']?.state||live.stations?.[site+'C']?.state)){
    const targets=groupTargets(group,site,live);
    if(!Object.keys(targets).length)return held('Wartet auf den ersten eingelegten Bauplan.');
    const groupSlots=extra?Object.keys(extra.slots):['A','B','C'];
    // A changed input cannot pass the host's shared-chest proof. Wait for its
    // reservation locally so other chests can use the two physical probe slots.
    if(Number.isFinite(live.at)&&Math.abs(Date.now()-live.at)<10000){
     for(const slot of groupSlots){
      const signal=live.stations?.[site+(slot==='A'?'':slot)];
      if(!signal?.upload||signal.empty)continue;
      const t=targets[slot];
      if(!t||signal.upload!==t.file||signal.owner!=='Erebor'||!signal.aligned||
         !same(signal.anchor,t.anchor)||!same(signal.size,t.size)||!same(signal.options,t.options))
       return held('Bauplan, Ausrichtung oder Optionen an '+site+slot+' prüfen.');
     }
    }
    const waiting=Object.keys(targets).some(slot=>['missingBlock','missingItem','noGunpowder'].includes(live.stations?.[site+(slot==='A'?'':slot)]?.status));
    // A saved missing item is only a scheduling hint. The physical proof below
    // still has to confirm each occupied printer and the shared chest.
    const deliverFirst=new Set();
    if(waiting&&savedMissingItems){
     const stock=latestStock(db);
     if(stock&&Math.abs(Date.now()-Date.parse(stock.at))<60000){
      const saved=await savedMissingItems(live).catch(()=>new Map());
      for(const [slot,target] of Object.entries(targets)){
       const key=slot==='A'?site:site+slot,signal=live.stations[key],r=saved.get(key);
       if(r&&signal?.state==='PAUSED'&&r.file===target.file&&r.file===signal.upload&&r.placed===signal.placed&&
          r.status===signal.status&&stock.items[r.item]?.[0]>0)deliverFirst.add(r.item);
      }
     }
    }
    const result=await supplyRead({site:extra?.name??site,version,computerId:reported.computerId,chestSide:reported.chestSide,targets},waiting,deliverFirst.size>0);
    const station=stationAt.get(row.name),after=JSON.parse(station?.status_json||'null');
    if(!same(targets,groupTargets(supplyGroup(groupJobs(site,live),extra),site,live))||station?.options_json!==row.options_json||
       after?.computerId!==reported.computerId||after?.chestSide!==reported.chestSide||
       !Number.isFinite(result.at)||Math.abs(Date.now()/1000-result.at)>10)
     return held('Aufträge oder Standort während der Materialprüfung geändert.');
    const entries=Object.entries(result.confirmed||{});
    if(!entries.length||entries.some(([slot,r])=>!targets[slot]||r.file!==targets[slot].file||!Number.isSafeInteger(r.placed)||r.placed<0))
     return held('Materialbedarf der Gruppe ist unbestätigt.');
    const amounts=new Map();
    for(const [slot,r] of entries){
     const job=group[slot];
     const native=live.stations?.[site+(slot==='A'?'':slot)];
     // Create can restore a counter above the NBT's block count. A confirmed
     // stone printer still asking for material gets one stack to resume; the
     // existing consumption ledger and chest buffer still bound all transfers.
     const missingStone=isStationStone(job,site)&&native?.upload===r.file&&native.state==='PAUSED'&&
      ['missingItem','missingBlock'].includes(native.status);
     const materials=isStationStone(job,site)||job.phase==='stone'?{'minecraft:stone':Math.max(missingStone?64:0,job.blocks-r.placed)}:job.phase==='build'?job.materials:{};
     for(const [block,n] of Object.entries(materials||{}))if(deliverBlock(job,site+slot,block))for(const [item,count] of itemsFor(block))
      if(n>0&&!item.endsWith('_bucket'))amounts.set(item,(amounts.get(item)||0)+count*n);
    }
    const items=[...amounts].map(([item,needed])=>({item,needed,stack:stackSize(item)}));
    if(deliverFirst.size)items.sort((a,b)=>Number(deliverFirst.has(b.item))-Number(deliverFirst.has(a.item)));
    if(entries.every(([slot])=>isStationStone(group[slot],site))){
     const stone=items.find(i=>i.item==='minecraft:stone');
     if(stone)stone.confirmedPlaced=entries.reduce((n,[,r])=>n+r.placed,0);
    }
    const total=items.reduce((sum,item)=>sum+item.needed,0),first=group[entries[0][0]];
    const identity=entries.map(([slot,r])=>slot+'='+r.file).sort().join('|');
    const assignment=parseInt(createHash('sha256').update(identity).digest('hex').slice(0,12),16);
    const projectCraft=!base.options.paused&&entries.some(([slot])=>group[slot].phase==='build'&&(group[slot].interior||group[slot].surface));
    // One requesting computer orders an output for the shared ME. Other groups
    // still export it as soon as it arrives. A stopped computer loses its lease.
    if(projectCraft&&hasFeederPatch(reported.script,11)){
     reserveNeeds.set(row.name,{at:Date.now(),amounts});
     const central=JSON.parse(stationAt.get('erebor-K02')?.status_json||'null');
     const centralOnline=central?.computerId===13&&Math.abs(Date.now()-Date.parse(central.at))<45000;
     const managed=new Set();
     if(centralOnline){
      if(hasFeederPatch(central.script,12)&&central.brickReserve)managed.add('minecraft:stone_bricks');
      if(hasFeederPatch(central.script,14)&&central.grassReserve)managed.add('minecraft:grass_block');
      if(hasFeederPatch(central.script,15)&&central.mossReserve)managed.add('minecraft:moss_block');
      if(hasFeederPatch(central.script,15)&&central.podzolReserve)managed.add('minecraft:podzol');
      if(hasFeederPatch(central.script,16)&&central.spruceReserve)managed.add('minecraft:spruce_sapling');
     }
     for(const it of items){
      if(managed.has(it.item))continue;
      const shortage=reported.assignment===assignment&&reported.shortages?.find(s=>s.item===it.item&&s.craftable&&s.missing>s.inME);
      const owner=craftOwners.get(it.item);
      if(shortage&&(!owner||owner.until<=Date.now()||owner.name===row.name)){
       craftOwners.set(it.item,{name:row.name,until:Date.now()+30000});
       it.orderBatch=Math.min(2048,it.needed);
      }
     }
    }
    const rebalance=projectCraft&&groupSlots.every(slot=>{
     const s=live.stations?.[site+(slot==='A'?'':slot)];
     return s?.ready&&(result.confirmed?.[slot]?.file&&s.upload===result.confirmed[slot].file||s.empty&&s.state==='STOPPED');
    });
    return {...base,assignment,state:base.options.paused?'paused':'feeding',options:{...base.options,projectSupply:projectCraft,rebalance,autoCraft:base.options.autoCraft||projectCraft,returnLeftovers:false},
     alignment:{enabled:true,state:'aligned',leaseSeconds:10,probeMode:'shared'},blueprint:{id:first.desired.blueprint,
     name:site+' · '+entries.map(([slot])=>slot).join(' + '),origin:first.desired.anchor,size:first.size,version},items,
     totals:{start:total,needed:total,kinds:items.length}};
   }
   if(!j?.loaded)return held('Kein bestätigter Bauplan in der Erebor-Kanone.');
   const {observed:o,confirmation,attempt}=await readSupply(site,reported,j);
   const current=jobAt(site),station=stationAt.get(row.name);
   const report=JSON.parse(station?.status_json||'null');
   if(!current?.loaded||current.desired.file!==j.desired.file||
      report?.computerId!==reported.computerId||report?.chestSide!==reported.chestSide||
      station.options_json!==row.options_json)return held('Standort, Auftrag oder Einstellungen während der Live-Prüfung geändert.');
   if(confirmation){
    if(confirmation.file!==j.desired.file||confirmation.sha256!==j.desired.sha256||
       !Number.isFinite(confirmation.at)||Math.abs(Date.now()/1000-confirmation.at)>10)return held('Der aktuelle Materialauftrag wurde nicht bestätigt.');
   }else{
    if(o?.inputEmpty===true&&o.state==='STOPPED'&&o.status==='finished')return held('Kanone meldet fertig und der Eingabeslot ist leer. Wartet auf bestätigten Abschluss.');
    const mismatch=verifyEreborAlignment(j.desired,o,j.desired);
    if(mismatch||!same(o.components?.['create:schematic_bounds'],j.size))return held(mismatch||'Der eingelegte Bauplan hat sich geändert.');
    samples.set(site,o);
   }
   const amounts=new Map(),materials=j.phase==='stone'?{'minecraft:stone':j.blocks}:j.phase==='build'?j.materials:{};
   for(const [block,n] of Object.entries(materials||{}))if(deliverBlock(j,site+'A',block))for(const [item,each] of itemsFor(block))if(!item.endsWith('_bucket')&&n>0)amounts.set(item,(amounts.get(item)||0)+each*n);
   const items=[...amounts].map(([item,needed])=>({item,needed,stack:stackSize(item)})),total=items.reduce((s,i)=>s+i.needed,0);
   return {...base,state:base.options.paused?'paused':'feeding',alignment:{enabled:true,state:'aligned',leaseSeconds:10,probeAttempts:attempt,probeMode:confirmation?'compact':'full'},blueprint:{id:j.desired.blueprint,name:j.desired.blueprint,version,origin:j.desired.anchor,size:j.size},items,totals:{start:total,needed:total,kinds:items.length}};
  }catch(e){return held(e.message);}
 };
 const feeder=async(row,opts)=>{
  const plan=await poll(row,opts);
  if(opts.options.paused||(plan.state==='feeding'&&!plan.options.projectSupply))reserveNeeds.delete(row.name);
  views.set(row.name,{plan,at:Date.now()});
  return plan;
 };
 feeder.reserveTarget=(item,limit)=>Math.min(limit,[...reserveNeeds.values()].reduce((sum,r)=>sum+(Date.now()-r.at<60000?(r.amounts.get(item)??0):0),0));
 // Cached samples serve only the read-only dashboard and background monitoring.
 // A material lease or an explicit plan change always takes a new live sample.
 feeder.sample=site=>{const o=samples.get(site);return o&&Math.abs(Date.now()/1000-o.at)<5?o:null;};
 feeder.view=name=>{const v=views.get(name);return v&&Date.now()-v.at<15000?v.plan:null;};
 return feeder;
}
