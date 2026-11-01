import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { T, encodeNBT } from './helpers.js';
import { discoverCannon } from '../src/cannon-discovery-map.js';

// A real Anvil fixture with exact CC identity and facing properties. Keep this
// independent from discovery: it only encodes the stated world blocks as NBT.
function writeMap(world,blocks,{badChunk}={}) {
  mkdirSync(join(world,'region'),{recursive:true});
  const chunks=new Map();
  for(const b of blocks){
    const cx=Math.floor(b.x/16),cz=Math.floor(b.z/16),key=`${cx},${cz}`;
    if(!chunks.has(key))chunks.set(key,{cx,cz,blocks:[]});
    chunks.get(key).blocks.push(b);
  }
  if(badChunk)chunks.set(badChunk.join(','),{cx:badChunk[0],cz:badChunk[1],blocks:[],bad:true});
  const regions=new Map();
  for(const chunk of chunks.values()){
    const {cx,cz}=chunk, groups=new Map(),entities=[];
    for(const b of chunk.blocks){
      const sy=Math.floor(b.y/16);
      if(!groups.has(sy))groups.set(sy,[]);groups.get(sy).push(b);
      if(b.computerId!==undefined)entities.push(T.compound({id:T.string(b.name),x:T.int(b.x),y:T.int(b.y),z:T.int(b.z),ComputerId:T.int(b.computerId)}));
    }
    const sections=[...groups].map(([sy,list])=>{
      const palette=[{Name:'minecraft:air'}],ids=new Map([['air',0]]),values=new Array(4096).fill(0);
      for(const b of list){
        const state={Name:b.name,...(b.properties?{Properties:b.properties}:{})},key=JSON.stringify(state);
        if(!ids.has(key)){ids.set(key,palette.length);palette.push(state);}
        values[((b.y&15)*16+(b.z&15))*16+(b.x&15)]=ids.get(key);
      }
      const bits=Math.max(4,Math.ceil(Math.log2(palette.length))),per=Math.floor(64/bits),longs=new Array(Math.ceil(4096/per)).fill(0n);
      values.forEach((v,i)=>longs[Math.floor(i/per)]|=BigInt(v)<<BigInt((i%per)*bits));
      return T.compound({Y:T.byte(sy),block_states:T.compound({palette:T.list(10,palette.map(p=>T.compound({Name:T.string(p.Name),...(p.Properties?{Properties:T.compound(Object.fromEntries(Object.entries(p.Properties).map(([k,v])=>[k,T.string(v)])))}:{})}))),data:T.longArray(longs)})});
    });
    const nbt=encodeNBT(T.compound({xPos:T.int(cx),zPos:T.int(cz),sections:T.list(10,chunk.bad?[T.compound({Y:T.string('invalid')})]:sections),block_entities:T.list(10,entities)}));
    const data=deflateSync(nbt),header=Buffer.alloc(5);header.writeUInt32BE(data.length+1);header[4]=2;
    const body=Buffer.concat([header,data]),sectors=Math.ceil(body.length/4096),padded=Buffer.concat([body,Buffer.alloc(sectors*4096-body.length)]);
    const regionKey=`${Math.floor(cx/32)},${Math.floor(cz/32)}`;
    if(!regions.has(regionKey))regions.set(regionKey,[]);
    regions.get(regionKey).push({cx,cz,sectors,body:padded});
  }
  for(const [key,chunks]of regions){
    const header=Buffer.alloc(8192),bodies=[];let sector=2;
    for(const chunk of chunks){
      const at=4*((chunk.cx&31)+(chunk.cz&31)*32);header.writeUIntBE(sector,at,3);header[at+3]=chunk.sectors;
      bodies.push(chunk.body);sector+=chunk.sectors;
    }
    writeFileSync(join(world,'region',`r.${key.replace(',','.')}.mca`),Buffer.concat([header,...bodies]));
  }
}
function fixture(t) {
  const world=mkdtempSync(join(tmpdir(),'campus-discovery-'));
  t.after(()=>rmSync(world,{recursive:true,force:true}));
  return {world,config:{worldSources:{live:world},contextOrigin:[-32,48,-32],contextSize:[96,48,96]}};
}
const station=(id=4,x=0,y=64,z=0,facing='south',offset=[-1,0,0])=>[
  {x,y,z,name:'computercraft:computer_advanced',computerId:id,properties:{facing}},
  {x:x+offset[0],y:y+offset[1],z:z+offset[2],name:'minecraft:chest',properties:{type:'single',facing:'south'}},
  {x:x+2*offset[0],y:y+2*offset[1],z:z+2*offset[2],name:'create:schematicannon'},
];

test('exact computer IDs and all stationary CC local sides map correctly across negative chunks',async t=>{
  const {world,config}=fixture(t),blocks=[],expected=[];
  // Fixed expected vectors, including CC's stationary-computer left/right swap.
  const vectors={north:{front:[0,0,-1],back:[0,0,1],left:[1,0,0],right:[-1,0,0]},east:{front:[1,0,0],back:[-1,0,0],left:[0,0,1],right:[0,0,-1]},south:{front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0]},west:{front:[-1,0,0],back:[1,0,0],left:[0,0,-1],right:[0,0,1]}};
  let i=0;
  for(const [facing,sides] of Object.entries(vectors))for(const [side,offset]of Object.entries({...sides,top:[0,1,0],bottom:[0,-1,0]})){
    const id=100+i,x=-24+(i%6)*8,z=-24+Math.floor(i/6)*8;i++;
    blocks.push(...station(id,x,64,z,facing,offset));expected.push({id,x,z,facing,side,offset});
  }
  writeMap(world,blocks);
  for(const e of expected){
    const r=await discoverCannon(config,{computerId:e.id,chestSide:e.side});
    assert.equal(r.state,'found',JSON.stringify({e,r}));
    assert.deepEqual(r.candidate.binding,{dimension:'minecraft:overworld',x:e.x+2*e.offset[0],y:64+2*e.offset[1],z:e.z+2*e.offset[2],owner:'Campus'});
    assert.equal(r.candidate.computer.id,e.id);assert.equal(r.candidate.computer.facing,e.facing);assert.equal(r.candidate.chest.side,e.side);
  }
});

test('no station-name guessing and explicit detached chestSide cannot reuse an old chest',async t=>{
  const {world,config}=fixture(t);writeMap(world,station());
  assert.equal((await discoverCannon(config,{name:'kanone-4',chest:{name:'left'}})).state,'missing');
  assert.equal((await discoverCannon(config,{computerId:4,chestSide:null,chest:{name:'left'}})).state,'missing');
  assert.equal((await discoverCannon(config,{computerId:4,chestSide:'minecraft:chest_0'})).state,'unsupported');
  assert.equal((await discoverCannon(config,{computerId:4,chest:{name:'left'}})).state,'found');
  assert.equal((await discoverCannon(config,{computerId:5,chestSide:'left'})).state,'missing');
  assert.equal((await discoverCannon(config,{computerId:-1,chestSide:'left'})).state,'missing');
});

test('duplicate computer IDs and multiple cannons at the selected inventory reject automatic binding',async t=>{
  const {world,config}=fixture(t);
  writeMap(world,[...station(),...station(4,8,64,8)]);
  assert.equal((await discoverCannon(config,{computerId:4,chestSide:'left'})).state,'ambiguous');
  const other=fixture(t);writeMap(other.world,[...station(),{x:-1,y:65,z:0,name:'create:schematicannon'}]);
  assert.equal((await discoverCannon(other.config,{computerId:4,chestSide:'left'})).state,'ambiguous');
});

test('missing cannons, double chests, unsupported inventories and incomplete boundary checks fail closed',async t=>{
  for(const mode of ['missing','double','unsupported','boundary']){
    const {world,config}=fixture(t),blocks=station();
    if(mode==='missing')blocks.pop();
    if(mode==='double')blocks[1].properties.type='left';
    if(mode==='unsupported')blocks[1].name='some_mod:unverified_inventory';
    if(mode==='boundary'){config.contextOrigin=[0,64,0];config.contextSize=[1,1,1];blocks[0].x=-1;blocks[1].x=-2;blocks[2].x=-3;}
    writeMap(world,blocks);
    const r=await discoverCannon(config,{computerId:4,chestSide:'left'});
    assert.equal(r.state,['double','unsupported'].includes(mode)?'unsupported':'missing',mode);assert.equal(r.candidate,null);
  }
});

test('changed region fingerprints invalidate cached candidates and corrupt unrelated chunks prevent partial success',async t=>{
  const {world,config}=fixture(t),status={computerId:4,chestSide:'left'};
  writeMap(world,station());assert.equal((await discoverCannon(config,status)).state,'found');
  writeMap(world,station().slice(0,2));assert.equal((await discoverCannon(config,status)).state,'missing');
  writeMap(world,station(),{badChunk:[1,1]});
  const failed=await discoverCannon(config,status);assert.equal(failed.state,'missing');assert.match(failed.message,/vollständig/);
  writeMap(world,station());assert.equal((await discoverCannon(config,status)).state,'found','failed scans do not poison the next saved map');
  const path=join(world,'region','r.0.0.mca'),bytes=readFileSync(path);
  bytes.writeUIntBE(0,4*(1+32),3);bytes[4*(1+32)+3]=1;writeFileSync(path,bytes);
  assert.equal((await discoverCannon(config,status)).state,'missing','broken location entry is not an absent chunk');
});

test('world/config limits and schematic owner are checked without broad scans',async t=>{
  const {world,config}=fixture(t);writeMap(world,station());
  const status={computerId:4,chestSide:'left'};
  assert.equal((await discoverCannon({...config,contextSize:[100000,32,100000]},status)).state,'unsupported');
  assert.equal((await discoverCannon({...config,cannonSchematicOwner:'../other'},status)).state,'unsupported');
  assert.equal((await discoverCannon({...config,worldSources:{live:join(world,'absent')}},status)).state,'missing');
  assert.equal((await discoverCannon({...config,cannonSchematicOwner:'Builder'},status)).candidate.binding.owner,'Builder');
});
