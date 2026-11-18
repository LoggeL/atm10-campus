import test from 'node:test';
import assert from 'node:assert/strict';
import {ninePreflight} from '../src/erebor-nine-preflight.js';

test('absent opt-in preserves three slots',()=>{
 assert.deepEqual(ninePreflight(),{mode:'legacy',slots:['A','B','C']});
 assert.deepEqual(ninePreflight({enabled:false}),{mode:'legacy',slots:['A','B','C']});
});
// Synthetic coordinates and IDs: test data, not installation inputs.
const now=1_000_000;
function fixture(){
 const groups=[0,1,2].map(i=>({id:'g'+i,computerId:i,computer:[i*10,0,-1],chest:[i*10,0,0],
  chestName:'test:chest_'+i,bridgeName:'test:bridge',slots:[...'ABCDEFGHI'.slice(i*3,i*3+3)].map((slot,j)=>({slot,position:[[i*10+1,0,0],[i*10-1,0,0],[i*10,0,1]][j]}))}));
 const config={enabled:true,schema:1,site:'K01',version:12,dimension:'minecraft:overworld',bridge:[0,0,-2],groups};
 const observation={at:now,version:12,site:'K01',dimension:config.dimension,bridge:{position:config.bridge,online:true,powered:true},groups:structuredClone(groups).map(g=>({...g,chestBlock:'sophisticatedstorage:netherite_chest',slots:g.slots.map(s=>({...s,empty:true}))}))};
 return {config,observation};
}
test('direct AP names are scoped to independently verified computer namespaces',()=>{
 const f=fixture();
 // All three computers face outward from one bridge; each chest is opposite it.
 const coords=[
  {computer:[0,0,1],chest:[0,0,2],slots:[[0,0,3],[-1,0,2],[1,0,2]]},
  {computer:[-1,0,0],chest:[-2,0,0],slots:[[-3,0,0],[-2,0,-1],[-2,0,1]]},
  {computer:[1,0,0],chest:[2,0,0],slots:[[3,0,0],[2,0,-1],[2,0,1]]},
 ];
 f.config.bridge=[0,0,0];f.observation.bridge.position=[0,0,0];
 for(let i=0;i<3;i++){
  const g=f.config.groups[i],p=coords[i];
  Object.assign(g,{access:'direct',computer:p.computer,chest:p.chest,chestName:'front',bridgeName:'back'});
  g.slots.forEach((s,j)=>s.position=p.slots[j]);
  f.observation.groups[i]={...structuredClone(g),chestBlock:'sophisticatedstorage:netherite_chest',
   exportProof:{computerId:g.computerId,chestName:'front',bridgeName:'back',exported:1,returned:1,emptyAfter:true},
   slots:g.slots.map(s=>({...s,empty:true}))};
 }
 const r=ninePreflight(f.config,f.observation,[],now);
 assert.equal(r.runtimeEnabled,false);
 assert.deepEqual(r.groups.map(g=>g.computerId),[0,1,2]);
 const bad=structuredClone(f);delete bad.observation.groups[1].exportProof;
 assert.throws(()=>ninePreflight(bad.config,bad.observation,[],now),/Direct export/);
 const cross=structuredClone(f);cross.observation.groups[1].exportProof.computerId=0;
 assert.throws(()=>ninePreflight(cross.config,cross.observation,[],now),/Direct export/);
});
test('explicit measured mapping prepares isolated groups, never enables runtime',()=>{
 const {config,observation}=fixture();
 const result=ninePreflight(config,observation,[],now);
 assert.equal(result.mode,'prepared-only');
 assert.deepEqual(result.groups.map(g=>g.slots),[['A','B','C'],['D','E','F'],['G','H','I']]);
 assert.equal(result.runtimeEnabled,false);
});
const invalidCases=[
 ['missing mapping',f=>delete f.config.groups],
 ['duplicate computer',f=>f.config.groups[1].computerId=0],
 ['duplicate chest feed',f=>f.config.groups[1].chestName='test:chest_0'],
 ['duplicate group',f=>f.config.groups[1].id='g0'],
 ['duplicate coordinate',f=>f.config.groups[1].chest=f.config.groups[0].chest],
 ['duplicate slot',f=>f.config.groups[1].slots[0].slot='A'],
 ['remote cannon',f=>f.config.groups[1].slots[0].position=[500,0,0]],
 ['stale telemetry',f=>f.observation.at=now-10000],
 ['future telemetry',f=>f.observation.at=now+1],
 ['wrong version',f=>f.observation.version=13],
 ['unknown bridge health',f=>delete f.observation.bridge.powered],
 ['wrong chest',f=>f.observation.groups[0].chestBlock='minecraft:chest'],
 ['changed feed',f=>f.observation.groups[0].chestName='other'],
 ['missing consumer',f=>f.observation.groups[0].slots.pop()],
 ['ambiguous direction',f=>f.config.groups[0].chestName='left'],
 ['malformed opt-in',f=>f.config.enabled='true'],
 ['overlapping consumers',f=>{
  const g=f.config.groups[1];g.computer=[2,0,-1];g.chest=[2,0,0];
  g.slots.forEach((s,i)=>s.position=[[3,0,0],[2,1,0],[2,0,1]][i]);
  f.observation.groups[1]={...structuredClone(g),chestBlock:'sophisticatedstorage:netherite_chest',slots:g.slots.map(s=>({...s,empty:true}))};
 }],
];
for(const [label,change] of invalidCases)test('fails closed: '+label,()=>{
 const f=fixture();change(f);assert.throws(()=>ninePreflight(f.config,f.observation,[],now));
});
function job(slot='A',file='campus_00000000-0000-0000-0000-000000000001.nbt'){
 return {slot,file,sha256:'a'.repeat(64),anchor:[0,0,0],size:[16,16,16],options:[2,false,false]};
}
function load(f,j){
 const s=f.observation.groups.flatMap(g=>g.slots).find(s=>s.slot===j.slot);
 Object.assign(s,{empty:false,file:j.file,sha256:j.sha256,anchor:j.anchor,size:j.size,options:j.options,owner:'Erebor',aligned:true});
}
test('rejects an unassigned loaded cannon',()=>{
 const f=fixture();load(f,job());assert.throws(()=>ninePreflight(f.config,f.observation,[],now));
});
test('only the exact group receives its independently confirmed job',()=>{
 const f=fixture(),j=job('D');load(f,j);
 const r=ninePreflight(f.config,f.observation,[j],now);
 assert.deepEqual(r.groups.map(g=>g.jobs.map(j=>j.slot)),[[],['D'],[]]);
});
test('rejects duplicate upload across groups and mismatched job identity',()=>{
 const f=fixture(),a=job(),d=job('D');load(f,a);load(f,d);
 assert.throws(()=>ninePreflight(f.config,f.observation,[a,d],now));
 const g=fixture(),j=job();load(g,j);g.observation.groups[0].slots[0].sha256='b'.repeat(64);
 assert.throws(()=>ninePreflight(g.config,g.observation,[j],now));
});
