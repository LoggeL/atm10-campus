import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {convertSurfaceTrees} from '../src/erebor-saplings.js';
import {landscapeQueue,carrySurfaceJobs,releasedSurface} from '../src/erebor-landscape-work.js';
import {ereborUploadName} from '../src/erebor-file.js';
import {parseStructure} from '../src/nbt.js';
import {tileNBT} from '../src/erebor-tiles.js';
import {zipStore,storedZipEntry} from '../src/zip.js';

test('a trunk crossing two files becomes one plant; old running inputs can still finish',()=>{
 const names=['structure_void','grass_block','oak_log','oak_leaves','stone'];
 const files=[],entries=[];
 function file(y,cells){
  const grid=new Uint8Array(32**3);
  for(const [x,h,z,i] of cells)grid[x+32*(z+32*h)]=i;
  const {bytes,placed,materials}=tileNBT(names.map(n=>({name:'minecraft:'+n})),grid,'surface');
  const name='EREBOR_HAUT_R0_0_X0_Y'+y+'_Z0.nbt',sha=createHash('sha256').update(bytes).digest('hex');
  files.push({fileName:name,sha256:sha,origin:[0,y,0],blocks:placed,materials});entries.push({name,data:bytes});
 }
 file(32,[[5,30,6,1],[5,31,6,2]]);
 file(64,[[5,0,6,2],[6,1,6,3]]);
 file(96,[[2,2,2,4]]);
 const old={id:'R0_0',files,trees:1},zip=zipStore(entries);
 const next=convertSurfaceTrees(old,zip);
 assert.equal(next.report.files.length,2);
 assert.equal(next.report.trees,1);assert.equal(next.report.blocks,3);
 assert.deepEqual(parseStructure(storedZipEntry(next.zip,files[0].fileName)).placed.map(p=>[p.x,p.y,p.z,p.name]),
  [[5,30,6,'minecraft:grass_block'],[5,31,6,'minecraft:oak_sapling']]);
 assert.deepEqual(storedZipEntry(next.zip,files[2].fileName),entries[2].data);
 const db=new DatabaseSync(':memory:');
 try{
  const queue=landscapeQueue(db);
  db.exec('CREATE TABLE erebor_surface_parts(v,r,id,version,report,zip)');
  const source={r:2,part:'R0_0',fileName:files[0].fileName,sha256:files[0].sha256};
  db.prepare('INSERT INTO erebor_surface_dispatch VALUES(12,2,?,?,?, ?,0)').run(source.fileName,source.sha256,'K26','C');
  carrySurfaceJobs(db,12,2,old,zip,next.report);
  db.prepare('INSERT INTO erebor_surface_parts VALUES(12,2,?,?,?,?)').run('R0_0',2,JSON.stringify(next.report),next.zip);
  const legacy=queue.restore(12,source);
  assert.deepEqual(legacy.bytes,entries[0].data);
  queue.finish(12,'K26','C',legacy.job);
  assert.equal(db.prepare('SELECT count(*) n FROM erebor_surface_dispatch WHERE done=1').get().n,2);
 }finally{db.close();}
});

test('a requested helper can resume its reserved sapling revision without counting a finished plan',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const queue=landscapeQueue(db);
  db.exec('CREATE TABLE erebor_landscape(project_version,revision); INSERT INTO erebor_landscape VALUES(12,2)');
  const source={r:2,part:'R-3_-20',fileName:'tile.nbt',sha256:'old'};
  const job={source,surface:true,loaded:true,desired:{file:'campus_88d06245-a7f8-8d0d-95f6-f57c2d1e7b00.nbt'}};
  db.prepare('INSERT INTO erebor_surface_legacy VALUES(12,2,?,?,?,?,?)').run('tile.nbt','old','new','{}',Buffer.alloc(0));
  const add=db.prepare("INSERT INTO erebor_surface_dispatch VALUES(12,2,'tile.nbt',?,'K20','C',0)");
  add.run('old');add.run('new');
  assert.equal(queue.successor(12,'K20','B',job),null);
  assert.deepEqual(queue.successor(12,'K20','C',job),{...source,sha256:'new'});
  queue.releasePrevious(12,'K20','C',job);
  assert.equal(queue.successor(12,'K20','C',job),null);
  assert.deepEqual({...db.prepare('SELECT sha,site,slot,done FROM erebor_surface_dispatch').get()},{sha:'new',site:'K20',slot:'C',done:0});
 }finally{db.close();}
});

test('released main and helper inputs can use only their own published revision once',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  const queue=landscapeQueue(db);
  db.exec('CREATE TABLE erebor_landscape(project_version,revision); INSERT INTO erebor_landscape VALUES(12,2); CREATE TABLE erebor_surface_parts(v,r,id,report)');
  const fixture=[
   ['K20','A','R-3_-20',[-1312,64,-9792]],
   ['K20','B','R-3_-20',[-1344,64,-10016]],
   ['K36','A','R-1_-18',[-480,64,-9056]],
  ];
  for(const [site,slot,part,origin] of fixture){
   db.exec('DELETE FROM erebor_surface_parts');
   const [x,y,z]=origin,blueprint='EREBOR_HAUT_'+part+'_X'+x+'_Y'+y+'_Z'+z,fileName=blueprint+'.nbt';
   const before='a'.repeat(64),after=slot==='B'?before:'b'.repeat(64);
   const source={part,r:2,fileName,sha256:before};
   const job={loaded:true,surface:true,phase:'build',size:[32,32,32],source,desired:{owner:'Erebor',version:12,anchor:origin,blueprint,file:ereborUploadName(fileName,before),sha256:before}};
   const signal={ready:true,state:'STOPPED',status:'idle',upload:'',empty:true,finish:null};
   assert.ok(releasedSurface(site,slot,job,signal));
   for(const changed of [{status:'finished'},{state:'PAUSED'},{upload:'foreign.nbt'},{ready:false},{finish:{file:'other'}}])
    assert.ok(!releasedSurface(site,slot,job,{...signal,...changed}));
   assert.ok(!releasedSurface(site,slot,{...job,replayedAfterRelease:true},signal));
   db.prepare('INSERT INTO erebor_surface_parts VALUES(12,2,?,?)').run(part,JSON.stringify({files:[{origin,fileName,sha256:after}]}));
   const reserve=db.prepare('INSERT INTO erebor_surface_dispatch VALUES(12,2,?,?,?,?,0)');
   reserve.run(fileName,before,site,slot);
   if(before!==after){
    reserve.run(fileName,after,site,slot);
    assert.equal(queue.idleRevision(12,site,slot,job),null);
    db.prepare('INSERT INTO erebor_surface_legacy VALUES(12,2,?,?,?,?,?)').run(fileName,before,after,'{}',Buffer.alloc(0));
   }
   assert.deepEqual(queue.idleRevision(12,site,slot,job),{...source,sha256:after});
   assert.equal(queue.idleRevision(12,site,'C',job),null);
   db.prepare('UPDATE erebor_surface_dispatch SET done=1 WHERE file=? AND sha=?').run(fileName,after);
   assert.equal(queue.idleRevision(12,site,slot,job),null);
  }
 }finally{db.close();}
});
