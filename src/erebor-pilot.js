import {targetRenewal} from './erebor-pilot-renewal.js';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {verifyAlignment,cannonReset} from './alignment.js';

// Source-only K12 coordinator. No browser/feeder may supply positions or leases.
// Transport is the same authenticated controller client as the legacy scheduler.
// The installed observer-only controller rejects prepare/start/publication, so
// wiring this coordinator never silently promotes observation into activation.
export function pilotScheduler(db,massif,request,supply){
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_pilot_claim(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT,expires INTEGER); INSERT OR IGNORE INTO erebor_pilot_claim VALUES(1,NULL,0)`);
 const row=(v,s)=>db.prepare('SELECT job FROM erebor_helpers WHERE version=? AND site=\'K12\' AND slot=?').get(v,s)?.job;
 let renewSnapshot=null,renewMapping=null;
 const renewal=targetRenewal(()=>renewSnapshot?.()??null,request);
 return {async renew(mapping){
  if(!mapping||!same(mapping,renewMapping))return {state:'disabled'};
  return renewal.tick();
 },async tick(mapping){
  if(!mapping)return {state:'disabled'};
  const m=structuredClone(mapping),{site,version:v,group,positions}=m;
  if(site!=='K12'||!['DEF','GHI'].includes(group)||!Number.isSafeInteger(v))throw Error('Ungültige Pilotbindung');
  let binding;
  const gate=()=>{
   const b=db.prepare('SELECT site,group_id,version,computer_id,chest_side,token_hash FROM erebor_group_feeders WHERE site=? AND group_id=?').get(site,group);
   if(!b||b.version!==v||b.computer_id!==m.computerId||b.chest_side!==m.chestSide||binding&&binding!==JSON.stringify(b))throw Error('Pilotbindung fehlt oder geändert');
   binding??=JSON.stringify(b);
   const c=db.prepare('SELECT version,enabled,phase FROM erebor_queue_config WHERE id=1').get();
   const p=db.prepare("SELECT current_version FROM build_projects WHERE id='erebor'").get();
   const station=db.prepare("SELECT options_json FROM cannons WHERE name='erebor-K12'").get();
   if(!c?.enabled||c.version!==v||c.phase!=='stone'||p?.current_version!==v||!massif.enabled(v)||!station||JSON.parse(station.options_json||'{}').paused)throw Error('Pilot ist gesperrt');
  };
  gate();
  const owner=randomUUID();
  if(!db.prepare('UPDATE erebor_pilot_claim SET owner=?,expires=? WHERE id=1 AND expires<=?').run(owner,Date.now()+30000,Date.now()).changes)return {state:'busy'};
  let expected;
  const check=()=>{
   gate();const claim=db.prepare('SELECT * FROM erebor_pilot_claim WHERE id=1').get();
   if(claim.owner!==owner||claim.expires<=Date.now())throw Error('Pilotprüfung abgelaufen');
   if(expected&&[...group].some(s=>row(v,s)!==expected[s]))throw Error('Pilotauftrag geändert');
  };
  const call=async(action,args)=>{check();const r=await request(action,args);check();return r;};
  try{
   const plans=massif.reserveGroup(v,site,group,positions);
   if(!plans)return {state:'no-work'};
   expected=Object.fromEntries([...group].map(s=>[s,row(v,s)]));
   const save=(s,job)=>{
    const text=JSON.stringify(job);
    const r=db.prepare('UPDATE erebor_helpers SET job=?,message=? WHERE version=? AND site=? AND slot=? AND job=?').run(text,'Pilot geprüft',v,site,s,expected[s]);
    if(r.changes!==1)throw Error('Pilotauftrag geändert');expected[s]=text;
   };
   const matches=(j,o)=>!verifyAlignment(j.desired,o,j.desired)&&same(o.components?.['create:schematic_bounds'],j.size)&&
    same(o.options,{replace_mode:2,skip_missing:false,replace_block_entities:false});
   for(const s of group){
    const job=JSON.parse(expected[s]),args={site:site+s,version:v};
    if(job.tainted)throw Error('Pilotauftrag ist markiert');
    let {observed:o}=await call('erebor-inspect',args);
    if(!matches(job,o)){
     if(job.loaded||o?.inputEmpty!==true||!cannonReset(o)||!Number.isFinite(o.at)||Date.now()/1000-o.at<0||Date.now()/1000-o.at>10)throw Error('Pilotkanone nicht sicher leer');
     const {options,...desired}=job.desired;
     const prepared=await call('erebor-prepare',{...args,desired,kind:'stone',size:job.size,nbtBase64:plans[s].bytes.toString('base64')});
     o=prepared.observed;
     if(!prepared.applied||!matches(job,o))throw Error('Pilot-Einlegen nicht bestätigt');
    }
    job.loaded=true;job.seen=o.at;job.placed=o.amountPlaced;
    if(o.state==='RUNNING')job.started=true;
    save(s,job);
   }
   const now=Date.now();
   const lease={schema:1,version:v,phase:'stone',at:now,expiresAt:now+8000,jobs:Object.fromEntries([...group].map(s=>{
    const j=JSON.parse(expected[s]);return [site+s,{file:j.desired.file,anchor:j.desired.anchor,size:j.size,options:[2,false,false]}];
   }))};
   const publication=await call('erebor-target-leases',lease);
   if(!publication.published||!same(publication.lease,lease)||Date.now()>=lease.expiresAt)throw Error('Ziel-Lease nicht bestätigt');
   check();const plan=await supply(m);check();
   if(plan?.state!=='feeding'||plan.options?.paused!==false)throw Error('Gruppenzufuhr nicht bestätigt');
   // A material plan proves permission, NOT actual delivery. Native controller
   // must additionally prove the exact group's feeder/chest and supply readback.
   const proof=await call('erebor-group-proof',{site,version:v,group,computerId:m.computerId,chestSide:m.chestSide,jobs:lease.jobs});
   if(proof?.verified!==true||!same(proof.jobs,lease.jobs)||!Number.isFinite(proof.at)||Date.now()-proof.at<0||Date.now()-proof.at>=10000)throw Error('Physische Gruppenzufuhr nicht bestätigt');
   const started=[];
   for(const s of group){
    const j=JSON.parse(expected[s]);if(j.started)continue;
    if(Date.now()>=lease.expiresAt||Date.now()-proof.at>=10000)throw Error('Pilotfreigabe abgelaufen');
    const args={site:site+s,version:v}, {observed:o}=await call('erebor-inspect',args);
    if(!Number.isFinite(o?.at)||Date.now()/1000-o.at<0||Date.now()/1000-o.at>=10||!matches(j,o)||!['STOPPED','PAUSED'].includes(o.state)||o.flyingBlocks!==0||o.amountPlaced!==0||['missingItem','missingBlock','noGunpowder','targetNotLoaded','skipping'].includes(o.status))throw Error('Pilotstart nicht sicher');
    const {options,...desired}=j.desired;
    const r=await call('erebor-start',{...args,desired,kind:'stone',size:j.size});
    if(!r.started||r.observed?.state!=='RUNNING'||!matches(j,r.observed))throw Error('Pilotstart nicht bestätigt');
    j.started=true;save(s,j);started.push(site+s);
   }
   // Arm only after complete native dispatch, never on a material plan alone.
   // Re-read reservations/credentials/phase on every independent renewal.
   renewMapping=structuredClone(m);
   renewSnapshot=()=>{
    gate();
    if([...group].some(s=>row(v,s)!==expected[s]))throw Error('Pilotauftrag geändert');
    const files=Object.values(lease.jobs).map(j=>j.file);
    const helpers=db.prepare('SELECT job FROM erebor_helpers').all().map(r=>JSON.parse(r.job||'null')?.desired?.file).filter(Boolean);
    const mains=db.prepare('SELECT state FROM erebor_queue_sites').all().map(r=>JSON.parse(r.state||'{}').job?.desired?.file).filter(Boolean);
    if(files.some(f=>helpers.filter(x=>x===f).length!==1||mains.includes(f)))throw Error('Pilotauftrag mehrfach reserviert');
    return {version:v,jobs:structuredClone(lease.jobs)};
   };
   return {state:'started',started,expiresAt:lease.expiresAt};
  }finally{db.prepare('UPDATE erebor_pilot_claim SET owner=NULL,expires=0 WHERE id=1 AND owner=?').run(owner);}
 }};
}
