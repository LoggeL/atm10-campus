import {isDeepStrictEqual as same} from 'node:util';
import {verifyAlignment} from './alignment.js';
import {itemsFor,stackSize} from './materials.js';
import {setTimeout as delay} from 'node:timers/promises';

export const isEreborStation=name=>/^erebor-K(?:0[1-9]|[12][0-9]|3[0-7])$/i.test(name);

// The host serializes Minecraft commands. Queue at the caller, before the
// transport timeout starts, rather than sending 37 expiring HTTP requests.
export function limitSupplyReads(request){
 const waiting=[];
 let active=0;
 async function run(entry){
  active++;
  try{
   if(Date.now()-entry.at>20_000)throw new Error('Materialprüfung wartet auf freie Controller-Kapazität.');
   entry.resolve(await request('erebor-supply',entry.args));
  }catch(e){entry.reject(e);}
  finally{
   active--;
   if(waiting.length)void run(waiting.shift());
  }
 }
 return args=>new Promise((resolve,reject)=>{
  const entry={args,at:Date.now(),resolve,reject};
  if(active<2)void run(entry);
  else if(waiting.length<37)waiting.push(entry);
  else reject(new Error('Materialprüfung wartet auf freie Controller-Kapazität.'));
 });
}

export function ereborFeeder(db,request,version){
 const samples=new Map(),views=new Map(),pending=new Map();
 const lookup=db.prepare("SELECT s.state FROM erebor_queue_sites s JOIN erebor_queue_config q ON q.id=1 JOIN build_projects p ON p.id='erebor' WHERE s.site=? AND q.version=? AND p.current_version=q.version");
 const jobAt=site=>JSON.parse(lookup.get(site,version)?.state||'{}').job;
 const stationAt=db.prepare('SELECT status_json,options_json FROM cannons WHERE name=?');
 let legacyUntil=0;
 const supplyRead=limitSupplyReads(request);
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
  const site=row.name.slice(-3).toUpperCase(),j=jobAt(site),reported=JSON.parse(row.status_json||'{}')||{};
  const assignment=j?parseInt(j.desired.file.slice(7).replaceAll('-','').slice(0,12),16):row.assignment;
  const base={...opts,cannon:row.name,assignment,intervals:{...opts.intervals,plan:5},done:false,items:[],blueprint:null,totals:{start:0,needed:0,kinds:0}};
  const held=message=>({...base,state:'alignment',message,alignment:{enabled:true,state:'blocked',leaseSeconds:10},options:{...base.options,paused:true,returnLeftovers:false,gunpowder:0,autoCraft:false}});
  if(!j||!j.loaded)return held('Kein bestätigter Bauplan in der Erebor-Kanone.');
  if(!Number.isInteger(reported.computerId)||!reported.chestSide||!(Math.abs(Date.now()-Date.parse(reported.at))<180000))return held('Wartet auf aktuelle Computer-ID und Kistenseite.');
  try{
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
    const mismatch=verifyAlignment(j.desired,o,j.desired);
    if(mismatch||!same(o.components?.['create:schematic_bounds'],j.size))return held(mismatch||'Der eingelegte Bauplan hat sich geändert.');
    samples.set(site,o);
   }
   const amounts=new Map(),materials=j.phase==='stone'?{'minecraft:stone':j.blocks}:j.phase==='build'?j.materials:{};
   for(const [block,n] of Object.entries(materials||{}))for(const [item,each] of itemsFor(block))if(!item.endsWith('_bucket')&&n>0)amounts.set(item,(amounts.get(item)||0)+each*n);
   const items=[...amounts].map(([item,needed])=>({item,needed,stack:stackSize(item)})),total=items.reduce((s,i)=>s+i.needed,0);
   return {...base,state:base.options.paused?'paused':'feeding',alignment:{enabled:true,state:'aligned',leaseSeconds:10,probeAttempts:attempt,probeMode:confirmation?'compact':'full'},blueprint:{id:j.desired.blueprint,name:j.desired.blueprint,version,origin:j.desired.anchor,size:j.size},items,totals:{start:total,needed:total,kinds:items.length}};
  }catch(e){return held(e.message);}
 };
 const feeder=async(row,opts)=>{const plan=await poll(row,opts);views.set(row.name,{plan,at:Date.now()});return plan;};
 // Cached samples serve only the read-only dashboard and background monitoring.
 // A material lease or an explicit plan change always takes a new live sample.
 feeder.sample=site=>{const o=samples.get(site);return o&&Math.abs(Date.now()/1000-o.at)<5?o:null;};
 feeder.view=name=>{const v=views.get(name);return v&&Date.now()-v.at<15000?v.plan:null;};
 return feeder;
}
