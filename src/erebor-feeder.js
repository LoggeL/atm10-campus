import {isDeepStrictEqual as same} from 'node:util';
import {verifyAlignment} from './alignment.js';
import {itemsFor,stackSize} from './materials.js';

export const isEreborStation=name=>/^erebor-K(?:0[1-9]|[12][0-9]|3[0-7])$/i.test(name);

export function ereborFeeder(db,request,version){
 const samples=new Map(),views=new Map();
 const lookup=db.prepare("SELECT s.state FROM erebor_queue_sites s JOIN erebor_queue_config q ON q.id=1 JOIN build_projects p ON p.id='erebor' WHERE s.site=? AND q.version=? AND p.current_version=q.version");
 const jobAt=site=>JSON.parse(lookup.get(site,version)?.state||'{}').job;
 const poll=async(row,opts)=>{
  const site=row.name.slice(-3).toUpperCase(),j=jobAt(site),reported=JSON.parse(row.status_json||'{}')||{};
  const assignment=j?parseInt(j.desired.file.slice(7).replaceAll('-','').slice(0,12),16):row.assignment;
  const base={...opts,cannon:row.name,assignment,intervals:{...opts.intervals,plan:5},done:false,items:[],blueprint:null,totals:{start:0,needed:0,kinds:0}};
  const held=message=>({...base,state:'alignment',message,alignment:{enabled:true,state:'blocked',leaseSeconds:10},options:{...base.options,paused:true,returnLeftovers:false,gunpowder:0,autoCraft:false}});
  if(!j||!j.loaded)return held('Kein bestätigter Bauplan in der Erebor-Kanone.');
  if(!Number.isInteger(reported.computerId)||!reported.chestSide||!(Math.abs(Date.now()-Date.parse(reported.at))<180000))return held('Wartet auf aktuelle Computer-ID und Kistenseite.');
  try{
   const {observed:o}=await request('erebor-supply',{site,version,computerId:reported.computerId,chestSide:reported.chestSide});
   samples.set(site,o);
   const mismatch=verifyAlignment(j.desired,o,j.desired);
   if(mismatch||!same(o.components?.['create:schematic_bounds'],j.size)||jobAt(site)?.desired.file!==j.desired.file)return held(mismatch||'Der eingelegte Bauplan hat sich geändert.');
   const amounts=new Map(),materials=j.phase==='stone'?{'minecraft:stone':j.blocks}:j.phase==='build'?j.materials:{};
   for(const [block,n] of Object.entries(materials||{}))for(const [item,each] of itemsFor(block))if(!item.endsWith('_bucket')&&n>0)amounts.set(item,(amounts.get(item)||0)+each*n);
   const items=[...amounts].map(([item,needed])=>({item,needed,stack:stackSize(item)})),total=items.reduce((s,i)=>s+i.needed,0);
   return {...base,state:base.options.paused?'paused':'feeding',alignment:{enabled:true,state:'aligned',leaseSeconds:10},blueprint:{id:j.desired.blueprint,name:j.desired.blueprint,version,origin:j.desired.anchor,size:j.size},items,totals:{start:total,needed:total,kinds:items.length}};
  }catch(e){return held(e.message);}
 };
 const feeder=async(row,opts)=>{const plan=await poll(row,opts);views.set(row.name,{plan,at:Date.now()});return plan;};
 // Cached samples serve only the read-only dashboard and background monitoring.
 // A material lease or an explicit plan change always takes a new live sample.
 feeder.sample=site=>{const o=samples.get(site);return o&&Math.abs(Date.now()/1000-o.at)<5?o:null;};
 feeder.view=name=>{const v=views.get(name);return v&&Date.now()-v.at<15000?v.plan:null;};
 return feeder;
}
