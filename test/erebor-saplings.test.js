import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {convertSurfaceTrees} from '../src/erebor-saplings.js';
import {landscapeQueue,carrySurfaceJobs} from '../src/erebor-landscape-work.js';
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
