// Saved-map candidates only. The host must recheck the computer, inventory and
// every adjacent cannon live before accepting a binding or preparing a plan.
import { stat } from 'node:fs/promises';
import { readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Region, unpackBlockStates } from './region.js';

const COMPUTERS = new Set(['computercraft:computer_normal', 'computercraft:computer_advanced']);
const COLORS = ['white','orange','magenta','light_blue','yellow','lime','pink','gray','light_gray','cyan','purple','blue','brown','green','red','black'];
const INVENTORIES = new Set(['minecraft:chest','minecraft:trapped_chest','minecraft:barrel','minecraft:shulker_box', ...COLORS.map(c => `minecraft:${c}_shulker_box`)]);
const CANNON = 'create:schematicannon';
const SIDES = new Set(['front','back','left','right','top','bottom']);
const FRONT = {north:[0,0,-1],east:[1,0,0],south:[0,0,1],west:[-1,0,0]};
const NEIGHBORS = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const CACHE_MS = 30_000, MAX_MAPS = 4, MAX_CHUNKS = 1024, MAX_REGION_BYTES = 64 * 1024 * 1024;
const cache = new Map();
let activeScans = 0;
const keyOf = (x,y,z) => `${x},${y},${z}`;
const failure = (state, message) => ({state,message,candidate:null});

function bounds(config) {
  const origin=config.contextOrigin, size=config.contextSize;
  if (!Array.isArray(origin) || !Array.isArray(size) || origin.length!==3 || size.length!==3
      || !origin.every(Number.isSafeInteger) || !size.every(n => Number.isSafeInteger(n) && n>0)
      || origin.some(n => Math.abs(n)>30_000_000)) throw Error('bounds');
  const lo=origin.map(n=>n-2), hi=origin.map((n,i)=>n+size[i]+1);
  lo[1]=Math.max(-64,lo[1]);hi[1]=Math.min(319,hi[1]);
  const cx0=Math.floor(lo[0]/16),cx1=Math.floor(hi[0]/16),cz0=Math.floor(lo[2]/16),cz1=Math.floor(hi[2]/16);
  if (hi[1]<lo[1] || (cx1-cx0+1)*(cz1-cz0+1)>MAX_CHUNKS) throw Error('bounds');
  const regions=[];
  for(let rx=Math.floor(cx0/32);rx<=Math.floor(cx1/32);rx++)for(let rz=Math.floor(cz0/32);rz<=Math.floor(cz1/32);rz++)regions.push([rx,rz]);
  if (regions.length>16) throw Error('bounds');
  return {lo,hi,cx0,cx1,cz0,cz1,regions};
}

const stamp = s => `${s.ino}:${s.size}:${s.mtimeNs}`;
async function worldStamp(world, area) {
  if (!(await stat(join(world,'region'))).isDirectory()) throw Error('world');
  const parts=await Promise.all(area.regions.map(async([rx,rz])=>{
    try {
      const s=await stat(join(world,'region',`r.${rx}.${rz}.mca`),{bigint:true});
      if (!s.isFile() || s.size>BigInt(MAX_REGION_BYTES)) throw Error('region');
      return stamp(s);
    } catch(error) { if(error.code==='ENOENT')return '-';throw error; }
  }));
  return parts.join('|');
}

function scan(world, area) {
  const computers=[],blocks=[];
  const inside=(x,y,z)=>[x,y,z].every((n,i)=>n>=area.lo[i]&&n<=area.hi[i]);
  for(const [rx,rz] of area.regions){
    const path=join(world,'region',`r.${rx}.${rz}.mca`);
    let before;
    try{before=statSync(path,{bigint:true});}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(!before.isFile() || before.size>BigInt(MAX_REGION_BYTES))throw Error('region');
    const bytes=readFileSync(path);
    if(bytes.length<8192)throw Error('truncated region');
    const region=new Region(bytes);
    for(let cx=Math.max(area.cx0,rx*32);cx<=Math.min(area.cx1,rx*32+31);cx++)for(let cz=Math.max(area.cz0,rz*32);cz<=Math.min(area.cz1,rz*32+31);cz++){
      const location=4*((cx&31)+(cz&31)*32), offset=bytes.readUIntBE(location,3), sectors=bytes[location+3];
      if((offset===0)!==(sectors===0) || (offset>0 && offset<2))throw Error('invalid region header');
      const chunk=region.chunk(cx&31,cz&31);
      if(!chunk)continue;
      if(chunk.xPos!==cx || chunk.zPos!==cz || !Array.isArray(chunk.sections) || !Array.isArray(chunk.block_entities))throw Error('invalid chunk');
      for(const entity of chunk.block_entities){
        if(!COMPUTERS.has(entity.id))continue;
        const {x,y,z}=entity;
        if(![x,y,z].every(Number.isSafeInteger) || Math.floor(x/16)!==cx || Math.floor(z/16)!==cz)throw Error('invalid computer');
        if(inside(x,y,z))computers.push({id:entity.ComputerId,x,y,z,block:entity.id});
        if(computers.length>2048)throw Error('too many computers');
      }
      const sectionYs=new Set();
      for(const section of chunk.sections){
        if(!Number.isSafeInteger(section.Y) || sectionYs.has(section.Y))throw Error('invalid section');
        sectionYs.add(section.Y);
        if(section.Y*16+15<area.lo[1] || section.Y*16>area.hi[1])continue;
        const bs=section.block_states;
        if(!bs)continue; // Empty/light-only sections have no block state container.
        const palette=bs.palette;
        if(!Array.isArray(palette) || !palette.length || palette.length>4096 || palette.some(p=>typeof p?.Name!=='string'))throw Error('invalid palette');
        const interesting=new Set(palette.flatMap((p,i)=>(COMPUTERS.has(p.Name)||INVENTORIES.has(p.Name)||p.Name===CANNON)?[i]:[]));
        if(!interesting.size)continue;
        const indices=new Uint16Array(4096);
        if(palette.length>1){
          const perLong=Math.floor(64/Math.max(4,Math.ceil(Math.log2(palette.length))));
          if(bs.data?.words?.length!==Math.ceil(4096/perLong)*2)throw Error('invalid palette data');
          unpackBlockStates(bs.data,palette.length,indices);
        }
        for(let i=0;i<4096;i++){
          if(indices[i]>=palette.length)throw Error('invalid palette index');
          if(!interesting.has(indices[i]))continue;
          const x=cx*16+(i&15),y=section.Y*16+(i>>8),z=cz*16+((i>>4)&15);
          if(!inside(x,y,z))continue;
          const p=palette[indices[i]];
          blocks.push({x,y,z,block:p.Name,facing:p.Properties?.facing,type:p.Properties?.type});
          if(blocks.length>65_536)throw Error('too many discovery blocks');
        }
      }
    }
  }
  const order=(a,b)=>a.x-b.x||a.y-b.y||a.z-b.z||String(a.id??a.block).localeCompare(String(b.id??b.block));
  return {computers:computers.sort(order),blocks:blocks.sort(order)};
}

if(!isMainThread && workerData?.kind==='cannon-discovery-map'){
  try{
    // Running cannons change counters/flight NBT continually. Compare only the
    // relevant topology in two complete, independently decoded map reads.
    const first=scan(workerData.world,workerData.area),second=scan(workerData.world,workerData.area);
    if(JSON.stringify(first)!==JSON.stringify(second))throw Error('discovery topology changed');
    parentPort.postMessage({map:second});
  }
  catch{parentPort.postMessage({error:true});}
}

async function loadMap(world,area) {
  if(activeScans>=2)throw Error('busy');
  activeScans++;
  try {
    const map=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL(import.meta.url),{workerData:{kind:'cannon-discovery-map',world,area},resourceLimits:{maxOldGenerationSizeMb:256}});
      let finished=false;
      const finish=(error,map)=>{
        if(finished)return;finished=true;clearTimeout(timer);
        worker.terminate().then(()=>error?reject(error):resolve(map),reject);
      };
      const timer=setTimeout(()=>finish(Error('timeout')),15_000);
      worker.once('message',message=>finish(message.error?Error('scan'):null,message.map));
      worker.once('error',()=>finish(Error('worker')));
      worker.once('exit',()=>{if(!finished)finish(Error('worker exit'));});
    });
    return {...map,blocks:new Map(map.blocks.map(b=>[keyOf(b.x,b.y,b.z),b]))};
  } finally {activeScans--;}
}

export async function discoverCannon(config,status) {
  if(!Number.isSafeInteger(status?.computerId) || status.computerId<0 || status.computerId>2147483647)
    return failure('missing','Computer-ID fehlt. Auf die nächste Meldung des aktualisierten Computers warten.');
  const side=Object.hasOwn(status,'chestSide')?status.chestSide:status.chest?.name;
  if(side==null || side==='')return failure('missing','Der Computer hat noch keine angeschlossene Materialkiste gemeldet.');
  if(!SIDES.has(side))return failure('unsupported','Automatische Erkennung benötigt eine direkt am Computer angeschlossene Materialkiste; entfernte Inventare werden nicht zugeordnet.');
  if(typeof config.worldSources?.live!=='string')return failure('missing','Gespeicherte Weltkarte ist nicht verfügbar.');
  let area;
  try{area=bounds(config);}catch{return failure('unsupported','Der konfigurierte Campus-Ausschnitt ist für die automatische Erkennung ungültig oder zu groß.');}
  const owner=config.cannonSchematicOwner||'Campus';
  if(typeof owner!=='string'||!/^[A-Za-z0-9_]{1,16}$/.test(owner))return failure('unsupported','Schematic-Owner ist ungültig konfiguriert.');
  const world=resolve(config.worldSources.live), key=JSON.stringify([world,area.lo,area.hi]);
  let map;
  try{
    const fingerprint=await worldStamp(world,area);
    let entry=cache.get(key);
    if(!entry || entry.fingerprint!==fingerprint || entry.expires<=Date.now()){
      entry={fingerprint,expires:Date.now()+CACHE_MS,promise:loadMap(world,area)};
      cache.delete(key);cache.set(key,entry);
      while(cache.size>MAX_MAPS)cache.delete(cache.keys().next().value);
    }
    try{map=await entry.promise;}catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}
  }catch{return failure('missing','Weltkarte konnte nicht vollständig und unverändert gelesen werden. Nach dem nächsten Speichern wird erneut geprüft.');}
  const matches=map.computers.filter(c=>c.id===status.computerId);
  if(matches.length>1)return failure('ambiguous','Die Computer-ID kommt mehrfach im Campus-Ausschnitt vor. Keine Kanone automatisch zugeordnet.');
  if(!matches.length)return failure('missing','Dieser Computer ist im gespeicherten Campus-Ausschnitt noch nicht gefunden.');
  const computer=matches[0], actual=map.blocks.get(keyOf(computer.x,computer.y,computer.z));
  if(actual?.block!==computer.block || !Object.hasOwn(FRONT,actual.facing))return failure('unsupported','Computerblock oder Ausrichtung ist in der Weltkarte nicht eindeutig.');
  const front=FRONT[actual.facing];
  // CC stationary computers swap left/right for historical reasons. Unlike a
  // turtle, LEFT is clockwise from the block's outward-facing front.
  const offset={front,back:front.map(n=>-n),left:[-front[2],0,front[0]],right:[front[2],0,-front[0]],top:[0,1,0],bottom:[0,-1,0]}[side];
  const chestPos=[computer.x+offset[0],computer.y+offset[1],computer.z+offset[2]];
  const chest=map.blocks.get(keyOf(...chestPos));
  if(!chest || !INVENTORIES.has(chest.block))return failure('unsupported','An der gemeldeten Computerseite wurde keine unterstützte Materialkiste gefunden.');
  if(['minecraft:chest','minecraft:trapped_chest'].includes(chest.block)&&chest.type!=='single')return failure('unsupported','Doppelkisten werden nicht automatisch einer Kanone zugeordnet. Eine einzelne Materialkiste verwenden.');
  const neighbors=NEIGHBORS.map(([dx,dy,dz])=>[chest.x+dx,chest.y+dy,chest.z+dz]);
  if(neighbors.some(p=>p.some((n,i)=>n<area.lo[i]||n>area.hi[i])))return failure('missing','Die Materialkiste liegt am Rand des gespeicherten Campus-Ausschnitts. Nicht alle Nachbarblöcke sind prüfbar.');
  const cannons=neighbors.map(p=>map.blocks.get(keyOf(...p))).filter(b=>b?.block===CANNON);
  if(cannons.length>1)return failure('ambiguous','Mehrere Kanonen berühren die Materialkiste. Keine automatische Zuordnung.');
  if(!cannons.length)return failure('missing','An der Materialkiste wurde im gespeicherten Weltstand keine Kanone gefunden.');
  const cannon=cannons[0];
  return {state:'found',message:'Computer, Materialkiste und eine benachbarte Kanone wurden in der Weltkarte gefunden.',candidate:{
    computer:{id:computer.id,x:computer.x,y:computer.y,z:computer.z,block:computer.block,facing:actual.facing},
    chest:{x:chest.x,y:chest.y,z:chest.z,block:chest.block,side},
    binding:{dimension:'minecraft:overworld',x:cannon.x,y:cannon.y,z:cannon.z,owner},
  }};
}
