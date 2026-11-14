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
const Components=Object.fromEntries(['OWNER','FILE','ANCHOR','BOUNDS','ROTATION','MIRROR'].map(k=>['SCHEMATIC_'+k,k]));
function machine(n,anchor,target){
 const c=new Cannon();c.mode='PAUSED';c.state={name:()=>c.mode};c.statusMsg='targetNotLoaded';c.target=target;c.flights=[];
 c.parts={OWNER:'Erebor',FILE:'campus_'+'1'.repeat(36)+'.nbt',ANCHOR:anchor,BOUNDS:new Pos(64,16,64),ROTATION:'NONE',MIRROR:'none'};
 c.inventory={getStackInSlot:n=>n===1?{isEmpty:()=>true}:{id:'create:schematic',isEmpty:()=>false,get:k=>c.parts[k]}};c.printer={isLoaded:()=>true,isErrored:()=>false,getAnchor:()=>anchor,getCurrentTarget:()=>c.target};
 c.flyingBlocks={isEmpty:()=>!c.flights.length,size:()=>c.flights.length,get:i=>({target:c.flights[i]})};return c;
}
test('Erebor leases only native targets and in-flight blocks, never idle, foreign or off-plan chunks',()=>{
 let tick,ttl,report;const calls=[],sites=new Map(),supplies=new Set();
 const classes={BlockPos:Pos,ChunkPos:class{constructor(p){this.chunk=[p.x>>4,p.z>>4];}},SchematicannonBlockEntity:Cannon,AllDataComponents:Components,Comparator:{naturalOrder:()=>({})},TicketType:{create:(name,cmp,t)=>{ttl=t;return name;}}};
 classes.BuiltInRegistries={BLOCK:{getKey:block=>block}};
 vm.runInNewContext(script,{Java:{loadClass:n=>classes[n.split('.').at(-1)]},JsonIO:{read:p=>p.includes('parallel')?pairs:fleet,write:(_path,data)=>{report=data;}},ServerEvents:{tick:cb=>{tick=cb;}},console:{info(){},error(e){throw Error(e);}}});
 const chunks={getChunkNow:()=>true,addRegionTicket:(type,cp,d,p)=>calls.push([p.x,...cp.chunk])};
 const level={getBlockEntity:p=>sites.get(p.x+','+p.z),getChunkSource:()=>chunks,getBlockState:p=>({getBlock:()=>supplies.has([p.x,p.y,p.z].join(','))?'minecraft:chest':'minecraft:air'})};
 const poll=()=>{calls.length=0;for(let i=0;i<10;i++)tick({server:{overworld:()=>level}});};
 const a=machine('K01',new Pos(-214,-40,-10808),new Pos(-214,-40,-10808)),b=machine('K02',new Pos(-598,-40,-10808),new Pos(-592,-40,-10777));
 sites.set('-252,-11010',a);sites.set('-668,-10850',b);
 poll();assert.equal(ttl,200);assert.deepEqual(calls,[[-252,-14,-676],[-668,-37,-674]]);
 a.mode='RUNNING';a.target=new Pos(-189,-40,-10808);a.flights=[new Pos(-214,-40,-10808),a.target];
 b.statusMsg='ready';poll();assert.deepEqual(calls,[[-252,-12,-676],[-252,-14,-676]]);
 a.target=new Pos(-999,-40,-10808);a.flights=[];poll();assert.deepEqual(calls,[]);
 a.target=new Pos(-214,-40,-10808);a.parts.OWNER='Other';poll();assert.deepEqual(calls,[]);
 a.parts.OWNER='Erebor';a.mode='STOPPED';poll();assert.deepEqual(calls,[]);
 const one=pairs.sites[0],helper=machine('K01B',a.parts.ANCHOR,a.parts.ANCHOR);
 sites.set(one.B[0]+','+one.B[2],helper);
 for(let i=0;i<8;i++)poll();
 assert.equal(report.stations.K01B.ready,false);
 supplies.add(one.chest.join(','));
 for(let i=0;i<8;i++)poll();
 assert.equal(report.stations.K01B.ready,true);
 assert.equal(Object.keys(report.stations).length,111);
 assert.deepEqual(calls,[[one.B[0],-14,-676]]);
});
