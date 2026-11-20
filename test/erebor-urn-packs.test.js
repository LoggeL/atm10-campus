import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {registerMassif} from '../src/erebor-massif.js';
import {parseStructure} from '../src/nbt.js';
import {groupUrns} from '../src/erebor-urn-packs.js';

test('reserve only still-free sparse targets, survive retry, and release each original once',async()=>{
 const db=new DatabaseSync(':memory:'),gets=new Map(),posts=new Map(),closes=[];
 const app={post:(p,h)=>posts.set(p,h),get:(p,h)=>gets.set(p,h),addHook:(k,h)=>closes.push(h)};
 const stations=[{site:'K01',main:[0,64,0],B:[1,64,0],C:[0,64,1]}];
 db.exec("CREATE TABLE build_projects(id TEXT,current_version INTEGER,plan_json TEXT);INSERT INTO build_projects VALUES('erebor',12,'{}');CREATE TABLE erebor_queue_sites(state TEXT);CREATE TABLE erebor_helpers(version INTEGER,job TEXT);CREATE TABLE activity(at,user_id,via,action,target,detail_json)");
 let host=2;
 const m=registerMassif(app,{db,config:{worldSources:{}}},stations,()=>[],()=>host);
 try{
  db.exec("INSERT INTO erebor_massif_runs VALUES(12,1,'now');INSERT INTO erebor_massif_blobs VALUES('single',x'00')");
  const put=db.prepare("INSERT INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(12,?,?,64,0,1,1,1,1,'single','K01',1,1)");
  for(const x of [1,6,16,31,32])put.run('X00_Z00_URN_'+x+'_64_0_BE',x);
  const req={actor:{scope:'write',via:'token',user:{id:1}},headers:{},method:'POST',body:{baseVersion:12,dryRun:true}};
  const path='/api/projects/erebor/stone/massif/urnenpakete',publish=posts.get(path);
  const dry=await publish(req);
  assert.equal(dry.plans,1);
  const single=m.reserve(12,'K01','A').job;
  const committed=await publish({...req,body:{...req.body,dryRun:false,preview:dry.preview}});
  assert.deepEqual(committed,{version:12,targets:4,largest:4,plans:1});
  await assert.rejects(publish({...req,body:{...req.body,dryRun:false,preview:dry.preview}}));
  const other=m.reserve(12,'K01','C').job;
  assert.equal(other.blocks,1);
  host=3;
  assert.equal(m.reserve(12,'K01','B'),null);
  m.finish(12,other.massif,'K01','C');
  const batch=m.reserve(12,'K01','B'),j=batch.job;
  assert.equal(j.blocks,3);assert.ok(j.massif.includes('_URN_PACK_'));assert.equal(j.desired.options.replace_mode,0);
  assert.deepEqual(m.restore(12,'K01','B',j.massif),batch);
  assert.deepEqual(m.reserve(12,'K01','B'),batch);
  const n=parseStructure(batch.bytes);
  assert.deepEqual(n.placed.map(p=>p.x+j.desired.anchor[0]).sort((a,b)=>a-b),[16,31,32]);
  assert.equal(n.clear.length,0);assert.equal(n.entities,0);assert.equal(n.blockEntities,0);
  host=2;assert.equal(m.reserve(12,'K01','C'),null);
  assert.throws(()=>m.finish(12,j.massif,'K01','C'));
  m.finish(12,j.massif,'K01','B');
  assert.equal(db.prepare('SELECT sum(done) AS n FROM erebor_massif_tiles').get().n,4);
  assert.equal(m.restore(12,'K01','A',single.massif).job.massif,single.massif);
 }finally{for(const c of closes)await c();db.close();}
});

test('distant targets split across reachable cannon positions and unreachable targets are explicit',()=>{
 const rows=[-249,-248,252,253,600].map(x=>({tile:'x'+x,x,y:0,z:0}));
 const {groups,unserved}=groupUrns(rows,[{site:'K01',pos:[0,0,0]}]);
 assert.deepEqual(groups.map(g=>g.rows.length),[2,2]);
 assert.deepEqual(unserved,['x600']);
});
