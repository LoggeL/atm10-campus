import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const script=readFileSync(new URL('../controller/kubejs/erebor-target-chunks.js',import.meta.url),'utf8');
const fleet=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
const pairs=JSON.parse(readFileSync(new URL('../src/erebor-fleet/parallel.json',import.meta.url)));
class Pos{
 constructor(x,y,z){Object.assign(this,{x,y,z});}getX(){return this.x;}getY(){return this.y;}getZ(){return this.z;}
 equals(p){return this.x===p.x&&this.y===p.y&&this.z===p.z;}distSqr(p){return (this.x-p.x)**2+(this.y-p.y)**2+(this.z-p.z)**2;}
}
class Cannon{}
test('extended tracker observes both K24 groups only under their own feeder identity',()=>{
 const expansion=JSON.parse(readFileSync(new URL('../src/erebor-fleet/expansion-groups.json',import.meta.url)));
 const k09=JSON.parse(readFileSync(new URL('../src/erebor-fleet/k09-groups.json',import.meta.url)));
 const groups=expansion.sites.find(r=>r.site==='K24').groups;
 const classes={BlockPos:Pos,ChunkPos:class {},SchematicannonBlockEntity:Cannon,AllDataComponents:Components,
  Comparator:{naturalOrder:()=>({})},TicketType:{create:()=>1},BuiltInRegistries:{BLOCK:{getKey:b=>b.id}}};
 let tick,report;const blocks=new Map(),entities=new Map();
 const key=p=>[p.x,p.y,p.z].join(',');
 for(const [index,g] of groups.entries()){
  const cp=g.computer.join(',');
  blocks.set(cp,'computercraft:computer_advanced');
  entities.set(cp,{saveWithoutMetadata:()=>({contains:()=>true,getString:()=> 'erebor-'+g.name,getBoolean:()=>true,getInt:()=>40+index})});
  blocks.set(g.chest.join(','),'sophisticatedstorage:netherite_chest');
  for(const pos of Object.values(g.slots)){
   const m=machine('K24',new Pos(...pos),new Pos(...pos));m.mode='STOPPED';m.replaceMode=2;
   entities.set(pos.join(','),m);
  }
 }
 vm.runInNewContext(script,{Java:{loadClass:n=>classes[n.split('.').at(-1)]},
  JsonIO:{read:p=>p.includes('expansion')?expansion:p.includes('k09')?k09:p.includes('parallel')?pairs:fleet,write:(_,r)=>{report=r;}},
  ServerEvents:{tick:fn=>{tick=fn;}},console:{info(){},error(e){throw Error(e);}}});
 const level={registryAccess:()=>({}),getChunkSource:()=>({getChunkNow:()=>true}),hasChunk:()=>false,
  getBlockEntity:p=>entities.get(key(p)),getBlockState:p=>({getBlock:()=>({id:blocks.get(key(p)),getStateDefinition:()=>({getProperty:n=>n})}),getValue:()=>({name:()=> 'single'})})};
 const poll=()=>{for(let i=0;i<80;i++)tick({server:{overworld:()=>level}});};
 poll();assert.equal(Object.keys(report.stations).length,225);
 for(const s of 'DEF')assert.equal(report.stations['K24'+s].feederId,40);
 for(const s of 'GHI')assert.equal(report.stations['K24'+s].feederId,41);
 entities.delete(groups[0].computer.join(','));poll();
 for(const s of 'DEF')assert.equal(report.stations['K24'+s].state,undefined);
 for(const s of 'GHI')assert.equal(report.stations['K24'+s].feederId,41);
});
test('stalled printer support temporarily tickets only the surveyed station and the validated cursor fringe',()=>{
 let tick;const held=[];
 const pos=new Pos(0,64,0),anchor=new Pos(16,64,16);
 const c=machine('K01',anchor,new Pos(80,64,16));
 const classes={BlockPos:Pos,ChunkPos:class{constructor(p){this.p=p;}},TicketType:{create:(_,cmp,ttl)=>{assert.equal(ttl,120);return 'temporary';}},
  Comparator:{naturalOrder:()=>({})},SchematicannonBlockEntity:Cannon,AllDataComponents:Components};
 const layout={sites:Array.from({length:37},(_,i)=>({main:[i*16,64,0]}))};
 const chunks={getChunkNow:x=>x===0,addRegionTicket:(_,p,level)=>held.push([p.p.x,p.p.z,level])};
 const world={getChunkSource:()=>chunks,getBlockEntity:()=>c};
 const code=readFileSync(new URL('../public/assets/erebor-stauhilfe.js',import.meta.url),'utf8');
 vm.runInNewContext(code,{Java:{loadClass:n=>classes[n.split('.').at(-1)]},JsonIO:{read:()=>layout},ServerEvents:{tick:handler=>{tick=handler;}}});
 const polls=n=>{for(let i=0;i<40*n;i++)tick({server:{overworld:()=>world}});};
 polls(3);assert.deepEqual(held,[[pos.x,pos.z,2],[80,16,2]]);
 held.length=0;c.target=new Pos(1900,64,16);polls(3);assert.deepEqual(held,[[pos.x,pos.z,2]]);
 held.length=0;c.parts.OWNER='Other';polls(4);assert.deepEqual(held,[]);
 c.parts.OWNER='Erebor';c.mode='STOPPED';polls(4);assert.deepEqual(held,[]);
});
const Components=Object.fromEntries(['OWNER','FILE','ANCHOR','BOUNDS','ROTATION','MIRROR'].map(k=>['SCHEMATIC_'+k,k]));
test('stale stone marker at the initial cursor is released without resetting progress or real material waits',()=>{
 let tick,changes=0,updates=0;
 const anchor=new Pos(16,64,16),sentinel=new Pos(15,64,16);
 const c=machine('K12',anchor,sentinel);
 c.mode='RUNNING';c.statusMsg='searching';c.blocksPlaced=38806;c.blocksToPlace=78844;c.remainingFuel=354;
 c.missingItem={id:'minecraft:stone'};
 c.setChanged=()=>changes++;c.sendData=()=>updates++;
 c.stage='BLOCKS';c.entity=-1;c.deferred=[];
 c.printer.write=tag=>{tag.stage=c.stage;tag.entity=c.entity;tag.deferred=c.deferred;};
 const classes={BlockPos:Pos,ChunkPos:class{},SchematicannonBlockEntity:Cannon,AllDataComponents:Components,
  Comparator:{naturalOrder:()=>({})},TicketType:{create:()=>({})},CompoundTag:class{
   getString(key){assert.equal(key,'PrintStage');return this.stage;}
   getInt(key){assert.equal(key,'EntityProgress');return this.entity;}
   getList(key,type){assert.equal(key,'DeferredBlocks');assert.equal(type,10);return {isEmpty:()=>this.deferred.length===0};}
  }};
 const layout={sites:Array.from({length:37},(_,i)=>({site:'K'+i,main:[i*16,64,0]}))};
 const world={getChunkSource:()=>({getChunkNow:x=>x===0,addRegionTicket(){}}),getBlockEntity:()=>c};
 const code=readFileSync(new URL('../public/assets/erebor-stauhilfe.js',import.meta.url),'utf8');
 vm.runInNewContext(code,{Java:{loadClass:n=>classes[n.split('.').at(-1)]},JsonIO:{read:()=>layout},
  ServerEvents:{tick:handler=>{tick=handler;}},console:{info(){},error(e){throw Error(e);}}});
 const polls=n=>{for(let i=0;i<40*n;i++)tick({server:{overworld:()=>world}});};
 polls(2);assert.equal(c.missingItem.id,'minecraft:stone');
 polls(1);assert.equal(c.missingItem,null);assert.equal(changes,1);assert.equal(updates,1);
 assert.deepEqual([c.blocksPlaced,c.blocksToPlace,c.remainingFuel],[38806,78844,354]);
 c.missingItem={id:'minecraft:stone'};c.target=anchor;polls(4);assert.ok(c.missingItem);
 c.target=sentinel;c.mode='PAUSED';c.statusMsg='missingBlock';polls(4);assert.ok(c.missingItem);
 c.mode='RUNNING';c.statusMsg='searching';c.flights=[anchor];polls(4);assert.ok(c.missingItem);
 c.flights=[];c.deferred=[anchor];polls(4);assert.ok(c.missingItem);
 c.deferred=[];c.stage='ENTITIES';polls(4);assert.ok(c.missingItem);
 c.stage='BLOCKS';c.entity=0;polls(4);assert.ok(c.missingItem);
 c.entity=-1;c.missingItem={id:'minecraft:gold_block'};polls(4);assert.ok(c.missingItem);
 c.missingItem={id:'minecraft:stone'};c.parts.OWNER='Other';polls(4);assert.ok(c.missingItem);
 assert.equal(changes,1);
 c.parts.OWNER='Erebor';polls(3);assert.equal(c.missingItem,null);assert.equal(changes,2);
});
function machine(n,anchor,target){
 const c=new Cannon();c.mode='PAUSED';c.state={name:()=>c.mode};c.statusMsg='targetNotLoaded';c.target=target;c.flights=[];
 c.parts={OWNER:'Erebor',FILE:'campus_'+'1'.repeat(36)+'.nbt',ANCHOR:anchor,BOUNDS:new Pos(64,16,64),ROTATION:'NONE',MIRROR:'none'};
 c.inventory={getStackInSlot:n=>n===1?{isEmpty:()=>true}:{id:'create:schematic',isEmpty:()=>false,get:k=>c.parts[k]}};c.printer={isLoaded:()=>true,isErrored:()=>false,getAnchor:()=>anchor,getCurrentTarget:()=>c.target};
 c.flyingBlocks={isEmpty:()=>!c.flights.length,size:()=>c.flights.length,get:i=>({target:c.flights[i]})};return c;
}
test('Erebor leases only native targets and in-flight blocks, never idle, foreign or off-plan chunks',()=>{
 let tick,ttl,report,chestId='minecraft:chest',chestType='single';const calls=[],sites=new Map(),supplies=new Set();
 const classes={BlockPos:Pos,ChunkPos:class{constructor(p){this.chunk=[p.x>>4,p.z>>4];}},SchematicannonBlockEntity:Cannon,AllDataComponents:Components,Comparator:{naturalOrder:()=>({})},TicketType:{create:(name,cmp,t)=>{ttl=t;return name;}}};
 classes.BuiltInRegistries={BLOCK:{getKey:block=>block.id}};
 vm.runInNewContext(script,{Java:{loadClass:n=>classes[n.split('.').at(-1)]},JsonIO:{read:p=>p.includes('parallel')?pairs:fleet,write:(_path,data)=>{report=data;}},ServerEvents:{tick:cb=>{tick=cb;}},console:{info(){},error(e){throw Error(e);}}});
 const chunks={getChunkNow:()=>true,addRegionTicket:(type,cp,d,p)=>calls.push([p.x,...cp.chunk])};
 const level={hasChunk:()=>false,getBlock:()=>{throw Error('diagnostics must not load chunks');},getBlockEntity:p=>sites.get(p.x+','+p.z),getChunkSource:()=>chunks,getBlockState:p=>({
  getBlock:()=>({id:supplies.has([p.x,p.y,p.z].join(','))?chestId:'minecraft:air',getStateDefinition:()=>({getProperty:n=>n})}),
  getValue:()=>({name:()=>chestType})
 })};
 const poll=()=>{calls.length=0;for(let i=0;i<10;i++)tick({server:{overworld:()=>level}});};
 const a=machine('K01',new Pos(-214,-40,-10808),new Pos(-214,-40,-10808)),b=machine('K02',new Pos(-598,-40,-10808),new Pos(-592,-40,-10777));
 let updates=0;a.replaceMode=0;a.blocksPlaced=777;a.setChanged=()=>{};a.sendData=()=>{updates++;};b.replaceMode=3;
 sites.set('-252,-11010',a);sites.set('-668,-10850',b);
 poll();assert.equal(ttl,200);assert.deepEqual(calls,[[-252,-14,-676],[-668,-37,-674]]);
 assert.equal(a.replaceMode,2);assert.equal(a.blocksPlaced,777);assert.equal(updates,1);assert.equal(b.replaceMode,3);
 a.mode='RUNNING';a.target=new Pos(-189,-40,-10808);a.flights=[new Pos(-214,-40,-10808),a.target];
 b.statusMsg='ready';poll();assert.deepEqual(calls,[[-252,-12,-676],[-252,-14,-676]]);
 a.target=new Pos(-999,-40,-10808);a.flights=[];poll();assert.deepEqual(calls,[]);
 a.target=new Pos(-214,-40,-10808);a.parts.OWNER='Other';a.replaceMode=0;poll();assert.deepEqual(calls,[]);assert.equal(a.replaceMode,0);
 a.parts.OWNER='Erebor';a.mode='STOPPED';poll();assert.deepEqual(calls,[]);
 const one=pairs.sites[0],helper=machine('K01B',a.parts.ANCHOR,a.parts.ANCHOR);
 sites.set(one.B[0]+','+one.B[2],helper);
 for(let i=0;i<8;i++)poll();
 assert.equal(report.stations.K01B.ready,false);
 supplies.add(one.chest.join(','));
 for(let i=0;i<8;i++)poll();
 assert.equal(report.stations.K01B.ready,true);
 chestId='sophisticatedstorage:netherite_chest';
 for(let i=0;i<8;i++)poll();
 assert.equal(report.chestTracker,5);assert.equal(report.stations.K01B.ready,true);
 assert.equal(report.stations.K01.chestBlock,chestId);
 chestType='left';for(let i=0;i<8;i++)poll();assert.equal(report.stations.K01B.ready,false);
 assert.equal(Object.keys(report.stations).length,111);
 assert.equal(Object.keys(report.network.stations).length,37);
 assert.equal(report.network.stations.K01.loaded,false);
 assert.deepEqual(calls,[[one.B[0],-14,-676]]);
});
