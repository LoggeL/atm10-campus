import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {scanMassifColumn,combineRepairLayers} from '../src/erebor-massif-scan.js';
import {stoneNBT} from '../src/project-stone.js';
import {registerMassif} from '../src/erebor-massif.js';
import {parseStructure} from '../src/nbt.js';
import {isStationStone,observedEreborOptions} from '../src/erebor-feeder.js';
import {writeWorld} from './helpers.js';

test('paired repairs preserve every world position, oldest save and eligible cannon',()=>{
 const stations=[{main:[10,32,0],B:[11,32,0],C:[9,32,0]}];
 const make=(layer,suffix)=>({tile:'X00_Z00_H0'+layer+suffix,origin:[16,layer*16,32],size:[64,16,64],blocks:1,
   bytes:stoneNBT([64,16,64],[[1,layer+1,2]]),oldestTargetSave:70-layer});
 const lo=make(0,'_LUFT'),hi=make(1,'_LUFT'),solid=make(1,''),special=make(0,'_BE');
 const [merged,rest,be]=combineRepairLayers([lo,hi,solid,special],stations);
 assert.equal(rest,solid);assert.equal(be,special);
 assert.equal(merged.blocks,2);assert.equal(merged.oldestTargetSave,69);assert.deepEqual(merged.size,[64,32,64]);
 assert.match(merged.tile,/_LUFT$/);assert.deepEqual(merged.origin,lo.origin);
 assert.deepEqual(parseStructure(merged.bytes).placed.map(({x,y,z})=>[x,y,z]),[[1,1,2],[1,18,2]]);
 const nearLimit=[16,-245,32];assert.equal(combineRepairLayers([lo,hi],[{main:nearLimit,B:nearLimit,C:nearLimit}]).length,2);
 assert.equal(combineRepairLayers([lo,{...hi,blocks:17000}],stations).length,2);
});

test('solid, cavity, protected and special positions are separate in real stone-only NBT',()=>{
 const world=mkdtempSync(join(tmpdir(),'massif-scan-'));
 try{
  const names=['oak_log','snow_block','diorite','water','stone','bedrock','sculk_sensor'];
  const blocks=names.map((n,i)=>({x:17+i,y:9,z:20,name:'minecraft:'+n}));
  blocks.push({x:24,y:9,z:20,name:'ae2:fluix_glass_cable'});
  const chunks=[];
  for(let cz=0;cz<=2;cz++)for(let cx=0;cx<=2;cx++)chunks.push({cx,cz,blocks:cx===1&&cz===1?blocks:[],blockEntities:cx===1&&cz===1?[{id:'minecraft:sculk_sensor',x:23,y:9,z:20}]:[]});
  writeWorld(world,chunks);
  const plan={worldOrigin:[200,20,200],rotationDegrees:90,mountainFill:{algorithm:'erebor-massif-v1',bounds:[[12,8,12],[34,18,34]],peak:[22,17,22],protectedBoxes:[{bounds:[[25,8,20],[26,12,21]]}],roofReserves:[]}};
  const scan=()=>scanMassifColumn(world,plan,0,0,[]);
  const result=scan();assert.deepEqual(result.missing,[]);assert.equal(result.unbreakable,1);
  const target=new Map();
  for(const row of result.rows){
   const n=parseStructure(row.bytes);assert.equal(n.materials['minecraft:stone'],row.blocks);assert.equal(n.clear.length,0);
   for(const {x,y,z} of n.placed){const key=[x+12,y+8,z+12].join(',');assert.ok(!target.has(key));target.set(key,row.tile);}
  }
  const kind=x=>target.get(x+',9,20');
  for(const x of [17,18,19])assert.equal(kind(x),'X00_Z00_H00');
  assert.match(kind(20),/_LUFT$/);assert.match(kind(26),/_LUFT$/);assert.match(kind(23),/_BE$/);
  for(const x of [21,22,24,25])assert.equal(kind(x),undefined);
  writeWorld(world,chunks.filter(c=>c.cx!==1||c.cz!==1));
  assert.ok(scan().missing.length);assert.equal(scan().rows.length,0);
 }finally{rmSync(world,{recursive:true,force:true});}
});

test('reservations survive retries, respect physical reach and helper capability, and close once',async()=>{
 const db=new DatabaseSync(':memory:'),hooks=[],posts=new Map();
 const app={addHook:(n,h)=>hooks.push(h),get(){},post:(path,handler)=>posts.set(path,handler)};
 const stations=['K01','K02','K03'].map((site,i)=>({site,main:[i===2?900:i*4,20,0],B:[i*4,20,0],C:[i*4,20,0]}));
 db.exec('CREATE TABLE erebor_queue_sites(state TEXT); CREATE TABLE erebor_helpers(version INTEGER,job TEXT); CREATE TABLE build_projects(id TEXT, current_version INTEGER,plan_json TEXT)');
 const mass=registerMassif(app,{db,config:{worldSources:{}}},stations);
 try{
  db.exec("INSERT INTO build_projects VALUES('erebor',12,'{}'); INSERT INTO erebor_massif_runs VALUES(12,1,'today'); INSERT INTO erebor_massif_blobs VALUES('hash',x'00'); CREATE TABLE activity(at TEXT,user_id INTEGER,via TEXT,action TEXT,target TEXT,detail_json TEXT)");
  const add=db.prepare("INSERT INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(12,?,?,20,0,1,1,1,1,'hash','K01',1,?)");
  add.run('SOLID',10,0);add.run('CAVITY_LUFT',11,0);add.run('DUNGEON_BE',12,1);
  assert.equal(mass.reserve(12,'K03','A'),null);
  assert.equal(mass.reserve(12,'K01','B',false).job.massif,'CAVITY_LUFT');
  assert.equal(mass.reserve(12,'K01','C',false),null);
  const setPhase=posts.get('/api/projects/erebor/stone/massif/bauphase');
  const req={method:'POST',headers:{'x-campus-csrf':'1'},actor:{via:'session',scope:'write',user:{id:1,role:'admin'}},body:{baseVersion:12,stoneOnly:false}};
  await assert.rejects(setPhase({...req,actor:{...req.actor,via:'token'}}),e=>e.statusCode===403);
  await assert.rejects(setPhase({...req,body:{...req.body,baseVersion:11}}),e=>e.statusCode===409);
  assert.equal((await setPhase(req)).stoneOnly,false);assert.equal(mass.reserve(12,'K02','A'),null);
  assert.equal((await setPhase({...req,body:{baseVersion:12,stoneOnly:true}})).stoneOnly,true);
  const j=mass.reserve(12,'K02','A').job;assert.equal(j.massif,'SOLID');assert.equal(j.phase,'build');
  assert.equal(isStationStone(j,'K02'),true);
  assert.equal(observedEreborOptions(j.desired,{replace_mode:0}).replace_mode,2);
  assert.equal(mass.reserve(12,'K01','A'),null);
  assert.deepEqual(mass.restore(12,'K02','A','SOLID').job,j);
  mass.finish(12,'SOLID','K02','A');assert.equal(mass.reserve(12,'K02','A'),null);
  add.run('OTHER_LUFT',12,0);
  const borrowed=mass.reserve(12,'K02','B',false).job;
  assert.equal(borrowed.massif,'OTHER_LUFT');assert.match(borrowed.desired.blueprint,/^EREBOR_STEIN_K02_/);
  assert.equal(mass.reserve(12,'K01','C',false),null);
  add.run('DOUBLE_LUFT',15,0);
  db.exec("UPDATE erebor_massif_tiles SET sy=32 WHERE tile='DOUBLE_LUFT'");
  db.prepare('INSERT INTO erebor_queue_sites VALUES(?)').run(JSON.stringify({job:{desired:{anchor:[15,36,0]}}}));
  assert.equal(mass.reserve(12,'K01','C',false),null);
  db.exec('DELETE FROM erebor_queue_sites');
  assert.equal(mass.reserve(12,'K01','C',false).job.massif,'DOUBLE_LUFT');
  assert.ok(mass.occupied(12).has('15,36,0'));
 }finally{for(const close of hooks)await close();db.close();}
});
