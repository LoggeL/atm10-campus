import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {interiorFrontier,interiorColumns,inRange,interiorGroup,interiorWorldCheck} from '../src/erebor-interior.js';
import {Region} from '../src/region.js';
import {tileNBT} from '../src/erebor-tiles.js';
import {hallParents} from '../src/erebor-hall-split.js';
import {gateTerrainEligible} from '../src/erebor-dispatch-repair.js';

// Exercise the actual closed-over scheduler body without booting timers, a live
// controller or a world worker. Only its persistence/worker boundaries are fakes.
const source=readFileSync(new URL('../src/erebor-queue.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf(' async function interiorCandidate('),source.indexOf(' campus.ereborHelpers=helpers;'));
function fixture(change={}){
 const entry={name:'bridge',group:'E26',stage:'clear',origin:[544,128,-9312],size:[32,32,32],unknownCells:0,clearOmitted:0,...change.entry};
 const boxes=change.boxes??[{id:'P-SEE',bounds:[[448,-64,-9686],[1212,320,-8826]]}];
 const plan={mountainFill:{bounds:[[0,0,-9600],[128,256,-9400]],protectedBoxes:boxes}};
 const p={current_version:12,plan_json:JSON.stringify(plan)},calls=[];
 let published=0,marked=0;
 const deps={config:{worldSources:{live:'fixture-only'}},massif:{enabled:()=>change.enabled!==false},production:{ordered:()=>({open:change.open??[entry]})},
  releases:{busy:()=>new Set(change.busy??[]),allows:()=>change.allowed!==false,mark:()=>marked++},deferredInterior:new Map(),
  interiorFrontier,interiorColumns,inRange,interiorGroup,insideMassif:()=>false,mountainTop:()=>change.columns?200:null,
  published:()=>{published++;if(change.untrusted)throw Error('Untrusted published file');return {bytes:Buffer.from('exact-published-bytes'),job:{desired:{anchor:entry.origin}}};},
  generate:async(_p,input)=>{calls.push(input);return change.worldOK!==false;},current:()=>change.current!==false,
  liveCache:change.surface?{surfaceModeTracker:1}:null,
  sectionBlockers:()=>change.predecessors??[],
  landscape:{candidate:async(_p,_site,_slot,_position,verify)=>{
   const pkg={bytes:Buffer.from('published surface'),job:{desired:{anchor:[544,256,-9312]}}};
   return await verify(pkg)===true?pkg:null;
  }},
  hallParents,hasHallSplit:()=>false,dispatchChecks:new Map(),isRetired:()=>false,gateTerrainEligible};
 const run=Function(...Object.keys(deps),body+';return interiorCandidate;')(...Object.values(deps));
 return {entry,calls,get published(){return published;},get marked(){return marked;},run:()=>run(p,'K35',change.position??[324,144,-9314],new Set(change.taken??[]),true)};
}
test('surface waits for local published or unpublished predecessors',async()=>{
 for(const predecessor of ['open-clear','unpublished-E08_001']){
  const f=fixture({surface:true,open:[],predecessors:[predecessor]});
  assert.equal(await f.run(),null);assert.equal(f.calls.length,0);
 }
 const ready=fixture({surface:true,open:[],predecessors:[]});assert.ok(await ready.run());
 assert.equal(ready.calls[0].interiorCheck.kind,'surface');
});
test('finishing advances independently of unfinished work in another section',async()=>{
 const entry={name:'bridge',group:'E26',stage:'build',finishing:true,origin:[544,128,-9312],size:[32,32,32],unknownCells:0,clearOmitted:0};
 const other={...entry,name:'elsewhere',finishing:false,origin:[1024,128,-9312]};
 const f=fixture({entry,open:[entry,other]});
 assert.ok(await f.run(),'another section must not hold this cannon behind a global finishing barrier');
});
test('published bridge clear and Esgaroth build reach exact world validation through P-SEE',async()=>{
 for(const entry of [{group:'E26',stage:'clear'},{group:'E25',stage:'build'}]){
  const f=fixture({entry});const result=await f.run();assert.ok(result,'P-SEE must not blanket-reject published exterior architecture');
  assert.equal(f.published,1);assert.equal(f.calls.length,1);assert.equal(f.calls[0].interiorCheck.outdoor,true);
  assert.equal(f.calls[0].interiorCheck.kind,entry.stage);assert.deepEqual(f.calls[0].interiorCheck.anchor,f.entry.origin);
  assert.equal(f.marked,0);result.release();assert.equal(f.marked,1);
 }
});
test('outdoor exact targets still reject water and foreign shoreline structures for build and clear',t=>{
 let block='minecraft:air';
 t.mock.method(Region,'open',()=>({chunk:(x,z)=>({xPos:x,zPos:z,Status:'full',sections:[{Y:0,block_states:{palette:[{Name:block}]}}],block_entities:[]})}));
 for(const kind of ['build','clear']){
  const cells=new Int16Array(32768);cells.fill(-1);cells[0]=kind==='clear'?0:1;
  const bytes=tileNBT([{name:'minecraft:air'},{name:'minecraft:oak_planks'}],cells,kind).bytes;
  const input={bytes,anchor:[0,0,0],kind,outdoor:true};
  block='minecraft:air';assert.equal(interiorWorldCheck('.',input),true);
  for(block of ['minecraft:water','minecraft:oak_planks','minecraft:chest']){
   if(kind==='build'&&block==='minecraft:oak_planks')continue;
   assert.equal(interiorWorldCheck('.',input),false,kind+' must preserve '+block);
  }
 }
});

test('overlapping technical, city and unidentified protections still reject',async()=>{
 for(const id of ['TECH-HUT','CITY1',undefined]){
  const f=fixture({boxes:[{id:'P-SEE',bounds:[[448,-64,-9686],[1212,320,-8826]]},{id,bounds:[[544,128,-9312],[576,160,-9280]]}]});
  assert.equal(await f.run(),null);assert.equal(f.published,0);assert.equal(f.calls.length,0);
 }
});
test('P-SEE exception retains frontier, range, unknown, phase, reservation and exact-world gates',async()=>{
 for(const change of [{entry:{unknownCells:1}},{entry:{clearOmitted:1}},{position:[0,0,0]},{enabled:false},{taken:['bridge']},{entry:{stage:'stone'}},{columns:true,allowed:false},{columns:true,busy:['8,4']},{worldOK:false},{current:false}]){
  const f=fixture(change);assert.equal(await f.run(),null,JSON.stringify(change));assert.equal(f.marked,0);
 }
 const untrusted=fixture({untrusted:true});await assert.rejects(untrusted.run(),/Untrusted published file/);assert.equal(untrusted.calls.length,0);
});
