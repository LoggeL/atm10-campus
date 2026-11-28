import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {isDeepStrictEqual as same} from 'node:util';
import {createHash} from 'node:crypto';
import {parallelFleet,parallelLayout} from '../src/erebor-parallel.js';
import {interiorFrontier,interiorColumns,inRange,interiorGroup} from '../src/erebor-interior.js';
import {hallParents} from '../src/erebor-hall-split.js';
import {gateTerrainEligible} from '../src/erebor-dispatch-repair.js';
import {publishedPlan} from '../src/erebor-selection.js';
import {DESIGN_REVISION} from '../src/erebor-design.js';
import {stoneNBT} from '../src/project-stone.js';
import {tileNBT} from '../src/erebor-tiles.js';
import {zipStore} from '../src/zip.js';
import {landscapeQueue} from '../src/erebor-landscape-work.js';
import {ereborUploadName} from '../src/erebor-file.js';

const unclear='Minecraft hat keine eindeutige Antwort für diese Kanonenposition geliefert. Bitte erneut prüfen.';
const p={current_version:12,plan_json:JSON.stringify({mountainFill:{bounds:[[0,0,0],[32,32,32]],protectedBoxes:[]}})};
const source=readFileSync(new URL('../src/erebor-queue.js',import.meta.url),'utf8');
const candidateBody=source.slice(source.indexOf(' async function interiorCandidate('),source.indexOf(' campus.ereborHelpers=helpers;'));
function fixture(t,{phase='build',site='K23',slot='C',loaded=false,surface=false}={}){
 const directory=mkdtempSync(join(tmpdir(),'erebor-ready-')),path=join(directory,'queue.db');
 let db=new DatabaseSync(path),helpers;
 const calls=[],checks=[];
 const cells=new Int16Array(32**3);cells.fill(-1);cells[0]=0;
 const bytes=phase==='clear'?tileNBT([{name:'minecraft:air'}],cells,'clear').bytes:stoneNBT([32,32,32],[[0,0,0]]);
 const sha256=createHash('sha256').update(bytes).digest('hex');
 const name=surface?'EREBOR_HAUT_R0_0_X0_Y64_Z0':`EREBOR_E23_${site}_${phase==='clear'?'AUSHUB':'BAU'}_X0_Y64_Z0`;
 const position=parallelLayout.sites.find(s=>s.site===site)[slot];
 const entry={name,sourceVersion:12,revision:DESIGN_REVISION,part:'E23_001',sha256,stage:phase,group:'E23',origin:position.map(n=>Math.floor(n/32)*32),size:[32,32,32],unknownCells:0,clearOmitted:0};
 db.exec('CREATE TABLE project_architecture_packages(project_id,base_version,revision,package_id,report_json,zip)');
 db.prepare('INSERT INTO project_architecture_packages VALUES(?,?,?,?,?,?)').run('erebor',12,DESIGN_REVISION,entry.part,
  JSON.stringify({files:[{fileName:name+'.nbt',cannon:site,sha256,kind:phase,origin:entry.origin,size:entry.size,blocks:1,materials:phase==='clear'?{}:{'minecraft:stone':1}}]}),zipStore([{name:name+'.nbt',data:bytes}]));
 let original=publishedPlan(db,p,{...entry,version:12,site,file:name+'.nbt'}).job,landscape;
 if(surface){
  db.exec('CREATE TABLE erebor_landscape(project_version,revision);CREATE TABLE erebor_surface_parts(v,r,id,version,report,zip)');
  db.exec('INSERT INTO erebor_landscape VALUES(12,7)');
  db.prepare('INSERT INTO erebor_surface_parts VALUES(12,7,?,1,?,?)').run('R0_0',JSON.stringify({files:[{fileName:name+'.nbt',sha256,origin:entry.origin,blocks:1,materials:{'minecraft:stone':1}}]}),zipStore([{name:name+'.nbt',data:bytes}]));
  landscape=landscapeQueue(db);
  original=landscape.restore(12,{r:7,part:'R0_0',fileName:name+'.nbt',sha256}).job;
  db.prepare('INSERT INTO erebor_surface_dispatch(v,r,file,sha,site,slot) VALUES(12,7,?,?,?,?)').run(name+'.nbt',sha256,site,slot);
 }
 const job={...original,source:surface?original.source:entry,...(surface?{}:{interior:true}),loaded,...(loaded?{baseline:0,placed:0}:{})};
 const d=job.desired,key=site+slot;
 let native={state:'PAUSED',status:'ready',inputEmpty:false,item:'create:schematic',fileHash:d.sha256,options:d.options,
  amountPlaced:0,amountToPlace:1,flyingBlocks:0,outputCount:0,
  printer:{Anchor:d.anchor,CurrentPos:[-1,0,0],DeferredBlocks:[],EntityProgress:-1,PrintStage:'BLOCKS'},
  components:{'create:schematic_file':d.file,'create:schematic_owner':d.owner,'create:schematic_anchor':d.anchor,
   'create:schematic_bounds':job.size,'create:schematic_deployed':1,'create:schematic_rotation':'none','create:schematic_mirror':'none'}};
 const signal={state:'PAUSED',status:'ready',ready:true,aligned:true,empty:false,placed:0,fuel:10,upload:d.file,owner:d.owner,
  anchor:d.anchor,size:job.size,options:[d.options.replace_mode,false,false]};
 let report={version:12,sharedChest:4,ereborProjectWork:1,interiorHelpers:1,surfaceModeTracker:1,at:Date.now(),stations:{[key]:signal}};
 const state={open:surface?[]:[entry],worldOK:true,enabled:true,allowed:true,busy:[],predecessors:[],world:[]};
 let validate=async(_p,_site,_slot,retained)=>{
  checks.push(key);
  const restored=publishedPlan(db,p,{...retained.source,version:12,site,file:retained.desired.blueprint+'.nbt'}).job;
  return same(restored.desired,retained.desired)&&same(restored.size,retained.size);
 };
 let request=async(action,args)=>{
  calls.push([action,args.site]);
  assert.equal(args.site,key);
  if(action==='erebor-start'){
   assert.equal(helpers.jobAt(12,site,slot).loaded,true,'normal service persists loaded proof before start');
   assert.equal(helpers.jobAt(12,site,slot).baseline,0,'normal service persists the native output baseline');
   native={...native,state:'RUNNING',status:phase==='clear'?'clearing':'placing'};
  }else assert.equal(action,'erebor-inspect','retained inputs must never be prepared again');
  return {observed:{...native,at:Date.now()/1000},started:true};
 };
 const boot=()=>helpers=parallelFleet(db,{},{},(...args)=>request(...args),()=>false,async()=>false,null,null,
  {validateReady:(...args)=>validate(...args)});
 boot();
 db.prepare('INSERT INTO erebor_helpers(version,site,slot,name,job,message) VALUES(12,?,?,?,?,?)').run(site,slot,name,JSON.stringify(job),unclear);
 const save=(value,message=unclear)=>db.prepare('UPDATE erebor_helpers SET job=?,message=? WHERE version=12 AND site=? AND slot=?').run(JSON.stringify(value),message,site,slot);
 t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
 return {calls,checks,job,signal,get db(){return db;},get helpers(){return helpers;},get report(){return report;},set report(v){report=v;},
  get native(){return native;},set native(v){native=v;},get request(){return request;},set request(v){request=v;},set validate(v){validate=v;},save,state,
  normalValidation(){
   // Execute the production queue's actual closure with only controller, world
   // worker and policy/persistence boundaries injected, as in the P-SEE tests.
   const deps={config:{worldSources:{live:'fixture-only'}},massif:{enabled:()=>state.enabled},production:{ordered:()=>({open:state.open})},
    releases:{busy:()=>new Set(state.busy),allows:()=>state.allowed,mark:()=>assert.fail('recovery must not release or reserve columns')},
    deferredInterior:new Map(),dispatchChecks:new Map(),interiorFrontier,interiorColumns,inRange,interiorGroup,
    insideMassif:()=>false,mountainTop:()=>null,parallelLayout,helpers,read:()=>({}),choices:{waiting:()=>[]},project:()=>p,
    published:(_p,_site,e)=>publishedPlan(db,_p,{...e,version:12,site:_site,file:e.name+'.nbt'}),
    generate:async(_p,input)=>{state.world.push(input);await state.afterWorld?.();return state.worldOK;},current:()=>true,liveCache:report,
    sectionBlockers:()=>state.predecessors,landscape:landscape??{},hallParents,hasHallSplit:()=>false,isRetired:()=>false,gateTerrainEligible,same};
   const run=Function(...Object.keys(deps),candidateBody+';return typeof validateReady==="function"?validateReady:async()=>false;')(...Object.values(deps));
   validate=(...args)=>run(...args);
  },
  restart(){db.close();db=new DatabaseSync(path);boot();},
  run:(enabled=()=>true,current=()=>true)=>helpers.startFueledExtras(p,report,enabled,()=>({}),current)};
}

test('retained ambiguous normal build is adopted and first-started before a full helper pass, including after app restart',async t=>{
 const f=fixture(t);
 f.restart();
 await f.run();
 assert.deepEqual(f.calls,[['erebor-inspect','K23C'],['erebor-start','K23C']]);
 assert.deepEqual(f.checks,['K23C']);
 const adopted=f.helpers.jobAt(12,'K23','C');
 assert.equal(adopted.loaded,true);assert.equal(adopted.started,true);
 assert.equal(adopted.desired.file,f.job.desired.file);
 assert.equal(f.helpers.reserved(12,'K23').has(f.job.desired.blueprint),true);
});

test('one ambiguous coordinate inspection gets one fresh read, never a prepare retry',async t=>{
 const f=fixture(t,{phase:'clear',site:'K28',slot:'B',loaded:true}),request=f.request;
 let reads=0;
 f.request=async(action,args)=>{
  if(action==='erebor-inspect'&&reads++===0){f.calls.push([action,args.site]);throw Error(unclear);}
  return request(action,args);
 };
 await f.run();
 assert.deepEqual(f.calls,[['erebor-inspect','K28B'],['erebor-inspect','K28B'],['erebor-start','K28B']]);
 assert.equal(f.helpers.jobAt(12,'K28','B').started,true);
});

test('an ambiguous first-start mutation is durable and never replayed by either helper path',async t=>{
 const f=fixture(t),request=f.request;
 f.request=async(action,args)=>{
  if(action==='erebor-start'){f.calls.push([action,args.site]);throw Error(unclear);}
  return request(action,args);
 };
 await f.run();
 f.restart();
 await f.run();
 await f.helpers.refill(p,'K23','C',f.report,()=>true,{},()=>true);
 assert.equal(f.calls.filter(([action])=>action==='erebor-start').length,1);
 assert.equal(f.helpers.jobAt(12,'K23','C').startPending,true);
 assert.equal(f.helpers.reserved(12,'K23').has(f.job.desired.blueprint),true);
});

test('an explicitly refused pre-mutation fuel wait remains retryable by the normal service',async t=>{
 const f=fixture(t),request=f.request;let refused=false;
 f.request=async(action,args)=>{
  if(action==='erebor-start'&&!refused){
   refused=true;f.calls.push([action,args.site]);
   assert.equal(f.helpers.jobAt(12,'K23','C').startPending,true);
   throw Error('Die Kanone wartet noch auf Treibstoff, Material oder den Zielchunk.');
  }
  return request(action,args);
 };
 await f.run();
 await f.helpers.refill(p,'K23','C',f.report,()=>true,{},()=>true);
 assert.equal(f.calls.filter(([action])=>action==='erebor-start').length,2);
 assert.equal(f.helpers.jobAt(12,'K23','C').started,true);
});

test('the normal queue revalidates the retained exact publication, frontier, full range and world before first start',async t=>{
 const f=fixture(t);f.normalValidation();
 await f.run();
 assert.equal(f.calls.filter(([action])=>action==='erebor-start').length,1);
 assert.equal(f.state.world.length,1);
 assert.equal(f.state.world[0].interiorCheck.kind,'build');
});

test('the normal queue also revalidates a retained mode-3 clear with its original explicit-air NBT',async t=>{
 const f=fixture(t,{phase:'clear',site:'K28',slot:'B'});f.normalValidation();
 await f.run();assert.deepEqual(f.calls,[['erebor-inspect','K28B'],['erebor-start','K28B']]);
 assert.equal(f.state.world[0].interiorCheck.kind,'clear');assert.deepEqual(f.helpers.jobAt(12,'K28','B').materials,{});
});

test('a retained normal surface never first-starts ahead of same-section clear or build predecessors',async t=>{
 const f=fixture(t,{surface:true});f.state.predecessors=['open-clear'];f.normalValidation();
 await f.run();
 assert.deepEqual(f.calls,[]);
 assert.equal(f.state.world.length,0);
 assert.equal(f.db.prepare('SELECT count(*) n FROM erebor_surface_dispatch WHERE done=0').get().n,1);
});

test('an exact retained lowest surface is checked and first-started without releasing its dispatch',async t=>{
 const f=fixture(t,{surface:true});f.normalValidation();
 const before=f.db.prepare('SELECT * FROM erebor_surface_dispatch').all();
 await f.run();
 assert.deepEqual(f.calls,[['erebor-inspect','K23C'],['erebor-start','K23C']]);
 assert.equal(f.state.world.length,1);assert.equal(f.state.world[0].interiorCheck.kind,'surface');
 assert.deepEqual(f.db.prepare('SELECT * FROM erebor_surface_dispatch').all(),before);
});

test('priority recovery rejects unsafe, manual, new, stale or non-exact retained inputs',async t=>{
 const cases={
  'new reservation':f=>f.save(f.job,'Reserviert'),
  'preparation changed is not a read ambiguity':f=>f.save(f.job,'Kanone während Vorbereitung geändert. Keine Freigabe; bewusst stoppen und erneut versuchen.'),
  'hard hash refusal':f=>f.save(f.job,'Schematic-Dateihash nach Vorbereitung abweichend.'),
  'manual pause':f=>f.save({...f.job,started:true}),
  taint:f=>f.save({...f.job,tainted:true}),
  'persisted progress':f=>f.save({...f.job,placed:1}),
  'negative persisted counter':f=>f.save({...f.job,placed:-1}),
  'missing reservation':f=>f.db.exec('DELETE FROM erebor_helpers'),
  'wrong reserved name':f=>f.db.exec("UPDATE erebor_helpers SET name='another'"),
  'old version':f=>f.report={...f.report,version:11},
  stale:f=>f.report={...f.report,at:Date.now()-15000},
  future:f=>f.report={...f.report,at:Date.now()+10000},
  'missing report time':f=>f.report={...f.report,at:undefined},
  'no project work':f=>f.report={...f.report,ereborProjectWork:0},
  'old helper host':f=>f.report={...f.report,interiorHelpers:0},
  'old tracker':f=>f.report={...f.report,surfaceModeTracker:0},
  'old chest':f=>f.report={...f.report,sharedChest:3},
  unaligned:f=>f.signal.aligned=false,
  unready:f=>f.signal.ready=false,
  'nonboolean readiness':f=>f.signal.ready=1,
  'already running':f=>f.signal.state='RUNNING',
  'not initial ready':f=>f.signal.status='placing',
  'native progress':f=>f.signal.placed=1,
  'no fuel':f=>f.signal.fuel=0,
  'unknown fuel':f=>delete f.signal.fuel,
  'nonfinite fuel':f=>f.signal.fuel=Infinity,
  'foreign upload':f=>f.signal.upload='foreign.nbt',
  'partial upload':f=>f.signal.upload=f.job.desired.file.slice(0,-4),
  'foreign owner':f=>f.signal.owner='Player',
  'wrong anchor':f=>f.signal.anchor=[0,0,0],
  'wrong bounds':f=>f.signal.size=[1,1,1],
  'skip missing':f=>f.signal.options=[2,true,false],
  'wrong mode':f=>f.signal.options=[3,false,false],
  'block entities':f=>f.signal.options=[2,false,true],
  'empty input':f=>f.signal.empty=true,
  'bad immutable upload':f=>{const job=structuredClone(f.job);job.desired.file='campus_other.nbt';f.signal.upload=job.desired.file;f.save(job);},
  'changed-world validation':f=>f.validate=async()=>false
 };
 for(const [name,change] of Object.entries(cases))await t.test(name,async t=>{
  const f=fixture(t);change(f);
  await f.run();assert.deepEqual(f.calls,[]);
 });
});

test('a reservation changed during the start readback is never overwritten',async t=>{
 const f=fixture(t),request=f.request,replacement={...f.job,operatorNote:'new exact reservation'};
 f.request=async(action,args)=>{
  const result=await request(action,args);
  if(action==='erebor-start')f.save(replacement,'operator changed reservation');
  return result;
 };
 await f.run();
 assert.deepEqual(f.helpers.jobAt(12,'K23','C'),replacement);
 assert.equal(f.helpers.list(12)[0].message,'operator changed reservation');
});

test('reservation-name drift during validation cannot authorize a native read or start',async t=>{
 const f=fixture(t);
 f.validate=async()=>{f.db.exec("UPDATE erebor_helpers SET name='changed'");return true;};
 await f.run();assert.deepEqual(f.calls,[]);
});

test('a changed frontier during the world check cannot authorize first start',async t=>{
 const f=fixture(t);f.normalValidation();f.state.afterWorld=()=>{f.state.open=[];};
 await f.run();assert.deepEqual(f.calls,[]);assert.equal(f.state.world.length,1);
});

test('surface dispatch ownership drift during its world check cannot authorize first start',async t=>{
 const f=fixture(t,{surface:true});f.normalValidation();
 f.state.afterWorld=()=>f.db.exec("UPDATE erebor_surface_dispatch SET slot='B'");
 await f.run();assert.deepEqual(f.calls,[]);assert.equal(f.state.world.length,1);
});

test('inspection must prove untouched printer, exact immutable identity, no flights and a valid unchanged baseline',async t=>{
 const cases={
  hash:o=>o.fileHash='0'.repeat(64),
  stale:o=>o.at=Date.now()/1000-20,
  owner:o=>o.components['create:schematic_owner']='Player',
  rotation:o=>o.components['create:schematic_rotation']='clockwise_90',
  mirror:o=>o.components['create:schematic_mirror']='left_right',
  bounds:o=>o.components['create:schematic_bounds']=[1,1,1],
  mode:o=>o.options={...o.options,replace_mode:3},
  skipping:o=>o.status='skipping',
  running:o=>o.state='RUNNING',
  cursor:o=>o.printer.CurrentPos=[0,0,0],
  'missing cursor':o=>delete o.printer.CurrentPos,
  deferred:o=>o.printer.DeferredBlocks=[[0,0,0]],
  entities:o=>o.printer.EntityProgress=0,
  stage:o=>o.printer.PrintStage='ENTITIES',
  anchor:o=>o.printer.Anchor=[0,0,0],
  placed:o=>o.amountPlaced=1,
  'unknown total':o=>delete o.amountToPlace,
  flights:o=>o.flyingBlocks=1,
  'unknown flights':o=>delete o.flyingBlocks,
  'negative baseline':o=>o.outputCount=-1,
  'changed baseline':o=>{o.outputCount=1;o.outputItem='create:empty_schematic';},
  'foreign output':o=>{o.outputCount=1;o.outputItem='minecraft:stone';}
 };
 for(const [name,change] of Object.entries(cases))await t.test(name,async t=>{
  const f=fixture(t,{loaded:true});change(f.native);
  if(name==='stale'){
   f.request=async(action,args)=>{f.calls.push([action,args.site]);return {observed:{...f.native,at:Date.now()/1000-20}};};
  }
  await f.run();assert.deepEqual(f.calls,[['erebor-inspect','K23C']]);
  assert.deepEqual(f.helpers.jobAt(12,'K23','C'),f.job);
 });
});

test('normal queue gates still reject changed publications, predecessors, unknown targets and world policy failures',async t=>{
 const cases={
  'unpublished original':f=>f.db.exec('DELETE FROM project_architecture_packages'),
  'changed hash':f=>f.db.exec("UPDATE project_architecture_packages SET report_json=json_set(report_json,'$.files[0].sha256','different')"),
  'changed bytes':f=>f.db.exec("UPDATE project_architecture_packages SET zip=x'00'"),
  'unknown target':f=>f.state.open[0]={...f.state.open[0],unknownCells:1},
  'omitted clear':f=>f.state.open[0]={...f.state.open[0],clearOmitted:1},
  'clear predecessor':f=>f.state.open.push({...f.state.open[0],name:'first-clear',stage:'clear'}),
  'lower build predecessor':f=>f.state.open.push({...f.state.open[0],name:'lower-build',origin:f.job.desired.anchor.map((n,i)=>i===1?n-32:n)}),
  'full box out of range':f=>f.state.open[0]={...f.state.open[0],origin:[0,0,0]},
  'phase disabled':f=>f.state.enabled=false,
  'columns unapproved':f=>f.state.allowed=false,
  'world changed':f=>f.state.worldOK=false
 };
 for(const [name,change] of Object.entries(cases))await t.test(name,async t=>{
  const f=fixture(t);change(f);f.normalValidation();await f.run();assert.deepEqual(f.calls,[]);
  assert.equal(f.helpers.reserved(12,'K23').has(f.job.desired.blueprint),true);
 });
});

test('surface keeps current revision, exact dispatch, lowest column and unchanged world requirements',async t=>{
 const cases={
  unreserved:f=>f.db.exec('DELETE FROM erebor_surface_dispatch'),
  foreign:f=>f.db.exec("UPDATE erebor_surface_dispatch SET site='K01'"),
  done:f=>f.db.exec('UPDATE erebor_surface_dispatch SET done=1'),
  revision:f=>f.db.exec('UPDATE erebor_landscape SET revision=8'),
  world:f=>f.state.worldOK=false,
  'local build':f=>f.state.predecessors=['open-build'],
  'missing publication predecessor':f=>f.state.predecessors=['unpublished-E23_002'],
  lower:f=>{
   const row=f.db.prepare('SELECT report FROM erebor_surface_parts').get(),report=JSON.parse(row.report);
   report.files.push({...report.files[0],fileName:'EREBOR_HAUT_LOWER.nbt',origin:f.job.desired.anchor.map((n,i)=>i===1?n-32:n)});
   f.db.prepare('UPDATE erebor_surface_parts SET report=?,version=version+1').run(JSON.stringify(report));
  }
 };
 for(const [name,change] of Object.entries(cases))await t.test(name,async t=>{
  const f=fixture(t,{surface:true});change(f);f.normalValidation();await f.run();assert.deepEqual(f.calls,[]);
 });
});

test('only the exact ambiguity gets one inspection retry and the thirty-second priority cooldown is unchanged',async t=>{
 for(const [message,reads] of [[unclear,2],['Kanone während Readback geändert. Keine Freigabe; nativen Zustand prüfen.',1],['Live-Bridge: keine Antwort innerhalb von 10 Sekunden.',1]])await t.test(message,async t=>{
  const f=fixture(t);f.request=async(action,args)=>{f.calls.push([action,args.site]);throw Error(message);};
  await f.run();await f.run();
  assert.deepEqual(f.calls,Array.from({length:reads},()=>['erebor-inspect','K23C']));
 });
});

test('disabled controls or identity drift after validation/inspection stop first start without clobbering state',async t=>{
 for(const stage of ['validate','inspect'])for(const control of ['enabled','current','job'])await t.test(stage+'/'+control,async t=>{
  const f=fixture(t),request=f.request;let enabled=true,current=true;
  const replacement={...f.job,operatorNote:'changed while awaiting'};
  const change=()=>{if(control==='enabled')enabled=false;else if(control==='current')current=false;else f.save(replacement);};
  if(stage==='validate')f.validate=async()=>{change();return true;};
  else f.request=async(action,args)=>{const result=await request(action,args);change();return result;};
  await f.run(()=>enabled,()=>current);
  assert.equal(f.calls.some(([action])=>action==='erebor-start'),false);
  assert.deepEqual(f.helpers.jobAt(12,'K23','C'),control==='job'?replacement:f.job);
 });
});

test('the five reproduced helper slots share the existing three-attempt first-ready budget',async t=>{
 const f=fixture(t);f.validate=async()=>true;
 const slots=[['K23','C','build'],['K23','H','build'],['K28','B','clear'],['K28','C','build'],['K29','G','clear']];
 const natives=new Map();
 for(const [site,slot,phase] of slots){
  const job=structuredClone(f.job),key=site+slot;
  job.phase=phase;job.desired.blueprint=`EREBOR_E23_${site}_${slot}_${phase==='clear'?'AUSHUB':'BAU'}`;
  job.desired.file=ereborUploadName(job.desired.blueprint+'.nbt',job.desired.sha256);job.desired.options.replace_mode=phase==='clear'?3:2;
  f.db.prepare('INSERT INTO erebor_helpers(version,site,slot,name,job,message) VALUES(12,?,?,?,?,?) ON CONFLICT(version,site,slot) DO UPDATE SET name=excluded.name,job=excluded.job')
   .run(site,slot,job.desired.blueprint,JSON.stringify(job),unclear);
  f.report.stations[key]={...f.signal,upload:job.desired.file,options:[job.desired.options.replace_mode,false,false]};
  const o=structuredClone(f.native);o.options=job.desired.options;o.components['create:schematic_file']=job.desired.file;natives.set(key,o);
 }
 f.request=async(action,args)=>{
  f.calls.push([action,args.site]);const o=natives.get(args.site);assert.ok(o);
  if(action==='erebor-start'){o.state='RUNNING';o.status=args.kind==='clear'?'clearing':'placing';}
  else assert.equal(action,'erebor-inspect');
  return {started:true,observed:{...o,at:Date.now()/1000}};
 };
 await f.run();assert.equal(f.calls.filter(([a])=>a==='erebor-start').length,3);
 await f.run();assert.equal(f.calls.filter(([a])=>a==='erebor-start').length,5);
 await f.run();assert.equal(f.calls.filter(([a])=>a==='erebor-start').length,5);
 assert.equal(f.helpers.jobs(12).filter(r=>r.job.loaded&&r.job.started).length,5);
 assert.equal(f.helpers.jobs(12).length,5);
});
