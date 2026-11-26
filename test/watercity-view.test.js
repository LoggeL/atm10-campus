import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {watercityData} from '../src/watercity.js';
import {fixture} from './watercity-fixture.js';

function projection(f=fixture(100000)) {
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE build_projects(id,current_version);INSERT INTO build_projects VALUES('erebor',12);CREATE TABLE erebor_selections(id,version,site,name,sha,job,status)");
 for(const j of f.jobs)db.prepare("INSERT INTO erebor_selections VALUES(?,12,'AP1040_M9200',?,?,?,'waiting')").run(j.selectionId,j.desired.blueprint,j.desired.sha256,JSON.stringify(j.job));
 return {db,f};
}

test('missing, future, stale, expired and foreign-upload telemetry never becomes live or erases last native progress',()=>{
 const {db,f}=projection();
 try{
  const read=(r,now=100000)=>watercityData(db,r,now);
  for(const report of [null,{...f.watercity,at:100001},{...f.watercity,at:55000},{...f.watercity,expires:100000},{...f.watercity,version:13}]){
   const view=read(report);
   assert.ok(view.slots.every(s=>!s.observation.fresh));
   assert.ok(view.slots.every(s=>Number.isInteger(s.observation.placed)));
  }
  const foreign=structuredClone(f.watercity);foreign.stations.P01B.file='foreign.nbt';
  const view=read(foreign);
  assert.equal(view.slots[1].observation.placed,301);
  assert.equal(view.slots[1].observation.fresh,false);
  assert.match(view.slots[1].problem,/nicht exakt/);
  assert.equal(view.slots[0].observation.fresh,true);
  assert.ok(read(f.watercity,220000).slots.every(s=>s.expired&&!s.observation.fresh));
  // Two retained rows on one physical slot are a visible conflict, not two jobs.
  const j=f.jobs[0];
  db.prepare("INSERT INTO erebor_selections VALUES(100,12,'AP_OTHER',?,?,?,'waiting')").run(j.desired.blueprint,j.desired.sha256,JSON.stringify(j.job));
  assert.equal(read(f.watercity).slots.length,6);
  assert.equal(read(f.watercity).slots[0].assignment,null);
  assert.match(read(f.watercity).slots[0].problem,/Mehrere/);
 }finally{db.close();}
});

test('malformed optional telemetry and incomplete metadata fail closed without breaking fleet reads',()=>{
 const {db,f}=projection();
 try{
  for(const patch of [{jobs:{}},{jobs:[{key:'P01A',selectionId:12,desired:null}]},{stations:{P01A:{valid:true}}}]){
   const view=watercityData(db,{...f.watercity,...patch},100000);
   assert.equal(view.slots.length,6);
   assert.equal(view.slots[0].observation.fresh,false);
  }
  delete f.jobs[0].job.desired.options;
  db.prepare('UPDATE erebor_selections SET job=? WHERE id=12').run(JSON.stringify(f.jobs[0].job));
  const view=watercityData(db,f.watercity,100000);
  assert.equal(view.slots[0].assignment,null);
  assert.match(view.slots[0].problem,/nicht überein/);
 }finally{db.close();}
});

test('watercity renderer names six independent cards, unknown native totals, historical observations and expiry',async()=>{
 const module=await import('../public/assets/watercity-view.js').catch(e=>{
  if(e.code==='ERR_MODULE_NOT_FOUND')return {renderWatercity:()=>''};throw e;
 });
 const {db,f}=projection();
 try{
  const data=watercityData(db,f.watercity,100000);
  const html=module.renderWatercity(data,{now:100000});
  for(const key of f.jobs.map(j=>j.key))assert.match(html,new RegExp(`data-slot="${key}"`));
  assert.match(html,/356/);assert.match(html,/Gesamtzahl unbekannt/);
  assert.equal((html.match(/<progress /g)||[]).length,3);
  assert.match(html,/P02/);assert.match(html,/Nicht in Betrieb/);
  assert.match(html,/500/);assert.match(html,/keine.*Folgeauftrag/i);
  assert.match(module.renderWatercity(data,{now:146000}),/Zuletzt beobachtet/);
  assert.doesNotMatch(module.renderWatercity(data,{now:146000}),/data-fresh="true"/);
  assert.match(module.renderWatercity(data,{now:221000}),/Freigabe abgelaufen/);
  assert.doesNotMatch(module.renderWatercity(data,{now:100001,failed:true}),/data-fresh="true"/);
  data.slots[0].assignment.blueprint='<script>bad</script>';
  assert.doesNotMatch(module.renderWatercity(data,{now:100000}),/<script>bad/);
 }finally{db.close();}
});
