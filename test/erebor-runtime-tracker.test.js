import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const fleet=read('../src/erebor-fleet/stations.json'),pairs=read('../src/erebor-fleet/parallel.json');
const mapping=read('../controller/erebor-observers.example.json');mapping.mode='leased-targets';
const script=readFileSync(new URL('../controller/kubejs/erebor-target-chunks.js',import.meta.url),'utf8');
class Pos {
 constructor(x,y,z){Object.assign(this,{x,y,z});}getX(){return this.x;}getY(){return this.y;}getZ(){return this.z;}
 equals(p){return this.x===p.x&&this.y===p.y&&this.z===p.z;}distSqr(p){return (this.x-p.x)**2+(this.y-p.y)**2+(this.z-p.z)**2;}
}
class Cannon {}
function fixture(map=mapping,loaded=()=>true){
 let tick,report,now=100000,lease=null,changes=0,worldReads=0;const tickets=[];
 const p=mapping.sites[0].groups[0].slots.D,anchor=p.map((n,i)=>i===0?n+10:n);
 const c=new Cannon(),parts={FILE:'campus_11111111-1111-1111-1111-111111111111.nbt',OWNER:'Erebor',ANCHOR:new Pos(...anchor),BOUNDS:new Pos(16,16,16),ROTATION:'none',MIRROR:'none',DEPLOYED:true};
 Object.assign(c,{replaceMode:2,skipMissing:false,replaceBlockEntities:false,blocksPlaced:10,blocksToPlace:100,remainingFuel:20,state:{name:()=> 'RUNNING'},statusMsg:'running',
 inventory:{getStackInSlot:n=>n===0?{id:'create:schematic',isEmpty:()=>false,get:k=>parts[k]}:{isEmpty:()=>true}},
 printer:{isLoaded:()=>true,isErrored:()=>false,getAnchor:()=>parts.ANCHOR,getCurrentTarget:()=>parts.ANCHOR},
 flyingBlocks:{isEmpty:()=>true,size:()=>0},setChanged:()=>changes++,sendData:()=>changes++});
 const classes={TicketType:{create:()=> 'ticket'},Comparator:{naturalOrder:()=>({})},ChunkPos:class{constructor(p){this.p=p;}},BlockPos:Pos,SchematicannonBlockEntity:Cannon,
 AllDataComponents:Object.fromEntries(Object.keys(parts).map(k=>['SCHEMATIC_'+k,k])),BuiltInRegistries:{BLOCK:{getKey:b=>b}}};
 const chunks={getChunkNow:loaded,addRegionTicket:(_t,cp,_n,pos)=>tickets.push([pos.x,cp.p.x])};
 const level={getChunkSource:()=>chunks,hasChunk:()=>false,getBlockEntity:pos=>{worldReads++;return pos.equals(new Pos(...p))?c:null;},getBlockState:()=>({getBlock:()=> 'sophisticatedstorage:netherite_chest',getValue:()=>({name:()=> 'single'})})};
 // Supply getStateDefinition as production chest-state lookup expects.
 level.getBlockState=()=>({getBlock:()=>({id:'sophisticatedstorage:netherite_chest',getStateDefinition:()=>({getProperty:()=> 'type'})}),getValue:()=>({name:()=> 'single'})});
 classes.BuiltInRegistries.BLOCK.getKey=b=>b.id;
 vm.runInNewContext(script,{Java:{loadClass:n=>classes[n.split('.').at(-1)]},Date:{now:()=>now},JsonIO:{read:path=>path.includes('runtime-leases')?lease:path.includes('runtime-tracker')?map:path.includes('parallel')?pairs:fleet,write:(_p,data)=>{report=data;}},ServerEvents:{tick:cb=>{tick=cb;}},console:{info(){},error(e){throw Error(e);}}});
 return {c,parts,p,anchor,tickets,get changes(){return changes;},get worldReads(){return worldReads;},get report(){return report;},set now(v){now=v;},set lease(v){lease=v;},poll(){tickets.length=0;for(let i=0;i<80;i++)tick({server:{overworld:()=>level}});}};
}
function lease(f){return {schema:1,version:12,phase:'stone',at:100000,expiresAt:108000,jobs:{K12D:{file:f.parts.FILE,anchor:f.anchor,size:[16,16,16],options:[2,false,false]}}};}
test('opt-in K12 tracker records native identity but only exact short job lease grants target tickets',()=>{
 const f=fixture();f.poll();assert.equal(f.report.stations.K12D.upload,f.parts.FILE);assert.equal(f.report.stations.K12D.placed,10);assert.deepEqual(f.tickets,[]);
 f.lease=lease(f);f.poll();assert.ok(f.tickets.length>0);assert.ok(f.tickets.every(([x])=>x===f.p[0]));assert.equal(f.changes,0);
 f.now=108000;f.poll();assert.deepEqual(f.tickets,[]);
});
test('runtime target lease rejects a volume whose origin is in range but far corner is not',()=>{
 const f=fixture();f.anchor[0]=f.p[0]+250;f.parts.ANCHOR=new Pos(...f.anchor);f.lease=lease(f);f.poll();assert.deepEqual(f.tickets,[]);
});
test('sleeping new slots are never read or ticketed',()=>{
 const f=fixture(mapping,()=>false);f.lease=lease(f);f.poll();assert.equal(f.worldReads,0);assert.deepEqual(f.tickets,[]);
});
for(const [label,alter] of Object.entries({
 missing:l=>null,
 future:l=>({...l,at:100001}),
 long:l=>({...l,expiresAt:110001}),
 version:l=>({...l,version:13}),
 phase:l=>({...l,phase:'build'}),
 upload:l=>{l.jobs.K12D.file='campus_22222222-2222-2222-2222-222222222222.nbt';return l;},
 anchor:l=>{l.jobs.K12D.anchor=[0,0,0];return l;},
 size:l=>{l.jobs.K12D.size=[1,1,1];return l;},
 options:l=>{l.jobs.K12D.options=[0,false,false];return l;}
}))test('runtime lease fails closed: '+label,()=>{
 const f=fixture();f.lease=alter(lease(f));f.poll();assert.deepEqual(f.tickets,[]);assert.equal(f.changes,0);
});
test('unleased new slots never inherit legacy mode rewriting',()=>{
 const f=fixture();f.c.replaceMode=0;f.poll();assert.equal(f.c.replaceMode,0);assert.equal(f.changes,0);assert.deepEqual(f.tickets,[]);
});
for(const [label,alter] of Object.entries({
 noOptIn:m=>null,
 observerOnly:m=>{m.mode='observe-only';return m;},
 wrongVersion:m=>{m.version++;return m;},
 duplicate:m=>{m.sites[0].groups[1].computerId=50;return m;},
 legacyCollision:m=>{m.sites[0].groups[0].slots.D=m.sites[0].main;return m;},
 invalidLastGroup:m=>{m.sites[0].groups[1].slots.I=[0,0,0];return m;},
 outsidePilot:m=>{m.sites[0].site='K24';return m;}
}))test('invalid runtime mapping leaves all legacy slots only: '+label,()=>{
 const f=fixture(alter(structuredClone(mapping)));f.lease=lease(f);f.poll();assert.equal(Object.keys(f.report.stations).length,111);assert.deepEqual(f.tickets,[]);
});
