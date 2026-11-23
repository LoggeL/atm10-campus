import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {tileNBT,TILE} from '../src/erebor-tiles.js';
import {parseStructure} from '../src/nbt.js';
import {storedZipEntry} from '../src/zip.js';
import {ereborUploadName} from '../src/erebor-file.js';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const sha=b=>createHash('sha256').update(b).digest('hex');
function fixture(){
 const palette=[{name:'minecraft:structure_void'},{name:'minecraft:stone'},{name:'minecraft:gold_block'},{name:'rechiseled:gold_block_polished_connecting',props:{axis:'x'}},{name:'minecraft:raw_gold_block'},{name:'minecraft:golden_rail'}];
 const cells=new Uint16Array(TILE**3);[1,2,3,4,5].forEach((n,i)=>cells[i]=n);
 const bytes=tileNBT(palette,cells).bytes,hash=sha(bytes),name='EREBOR_E05_BAU_K01_X0_Y64_Z0_R5';
 return {bytes,job:{phase:'build',interior:true,loaded:true,size:[32,32,32],blocks:5,desired:{blueprint:name,sha256:hash,file:ereborUploadName(name+'.nbt',hash),anchor:[0,64,0],options:{replace_mode:0,skip_missing:false,replace_block_entities:false}},source:{name,sha256:hash,stage:'build',origin:[0,64,0],size:[32,32,32],part:'E05_001'}},version:12,site:'K01',slot:'A'};
}
test('partition preserves exact non-gold, deferred states and original bytes without completing original',async()=>{
 const {prepareGoldDeferral}=await import('../src/erebor-gold-deferral.js');
 const f=fixture(),r=prepareGoldDeferral(f),m=r.manifest;
 assert.equal(m.state,'prepared-only');assert.equal(m.originalFinished,false);assert.equal(m.activationAllowed,false);
 assert.deepEqual(storedZipEntry(r.zip,'original.nbt'),f.bytes);
 const continuation=parseStructure(storedZipEntry(r.zip,'continuation.nbt'),true),gold=parseStructure(storedZipEntry(r.zip,'deferred-gold.nbt'),true);
 assert.deepEqual(continuation.materials,{'minecraft:stone':1,'minecraft:golden_rail':1});
 assert.equal(gold.placed.length,3);assert.deepEqual(gold.placed[1].properties,{axis:'x'});
 assert.deepEqual(m.deferred.targets[1].world,[2,64,0]);
 assert.deepEqual(m.original.job,f.job);assert.equal(m.deferred.resume,'explicit-user-request-only');
 assert.equal(continuation.clear.length,0);assert.equal(gold.clear.length,0);
 assert.equal(m.original.sha256,sha(f.bytes));
 const restored=[...continuation.placed,...gold.placed].sort((a,b)=>a.x-b.x);
 assert.deepEqual(restored,parseStructure(f.bytes,true).placed);
 assert.deepEqual(prepareGoldDeferral(f).zip,r.zip);
});
test('staging preserves mode 2, rejects a source mapping mismatch and unsafe options',async()=>{
 const {prepareGoldDeferral}=await import('../src/erebor-gold-deferral.js');
 const f=fixture();f.job.desired.options.replace_mode=2;
 assert.equal(prepareGoldDeferral(f).manifest.original.job.desired.options.replace_mode,2);
 f.job.source.origin=[32,64,0];assert.throws(()=>prepareGoldDeferral(f),/source/i);
 f.job.source.origin=[0,64,0];f.job.desired.options.skip_missing=true;
 assert.throws(()=>prepareGoldDeferral(f),/unsafe/i);
});
test('unsafe identities, incomplete jobs and unsupported content fail closed',async()=>{
 const {prepareGoldDeferral}=await import('../src/erebor-gold-deferral.js');
 for(const mutate of [
  f=>f.job.desired.sha256='0'.repeat(64),f=>f.job.desired.file='foreign.nbt',
  f=>f.job.desired.anchor=[0,64],f=>f.job.tainted=true,f=>f.job.loaded=false,
  f=>f.job.selection={id:1},f=>f.job.phase='clear',f=>f.job.blocks=4,
  f=>f.job.size=[64,32,32],f=>f.job.desired.options.replace_block_entities=true,
  f=>f.job.desired.options.replace_mode=1,f=>f.site='K99',f=>f.slot='Z',
  f=>f.version=0,f=>f.job.source.sha256='wrong'
 ]){const f=fixture();mutate(f);assert.throws(()=>prepareGoldDeferral(f));}
});

test('CLI persists a verified self-contained archive and never overwrites an existing artifact',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gold-test-'));
 try{
  const {bytes,...input}=fixture(),nbt=join(dir,'source.nbt'),metadata=join(dir,'input.json'),out=join(dir,'plan.zip');
  writeFileSync(nbt,bytes);writeFileSync(metadata,JSON.stringify({...input,originalPath:nbt}));
  const run=()=>spawnSync(process.execPath,['tools/prepare-erebor-gold-deferral.mjs',metadata,out],{encoding:'utf8'});
  const first=run();assert.equal(first.status,0,first.stderr);
  const archive=readFileSync(out),m=JSON.parse(storedZipEntry(archive,'gold-deferral.json'));
  assert.equal(m.original.sha256,sha(bytes));assert.equal(m.state,'prepared-only');
  assert.notEqual(run().status,0);assert.deepEqual(readFileSync(out),archive);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
