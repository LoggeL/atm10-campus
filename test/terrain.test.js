import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { terrainQuery, chunkBlockReader, surveyTerrain } from '../src/terrain.js';
import { LongArray, encodeTyped, nbtCompound, nbtInt, nbtList, nbtString } from '../src/nbt.js';
import { buildServer } from '../src/server.js';

test('terrain bounds reject expensive/malformed queries and preserve negative coordinates', () => {
  assert.deepEqual(terrainQuery({from:'-964,466',to:'-1564,-484',step:'16',y:'87'}),{from:[-1564,-484],to:[-964,466],step:16,probeY:87});
  for (const q of [{from:'0,0',to:'2000,0'},{from:'0,0',to:'1535,1535',step:4},{from:'0,0',to:'0,0',step:0},{from:'0,0',to:'0,0',y:320},{from:'NaN,0',to:'0,0'}]) assert.throws(()=>terrainQuery(q));
});

test('random block reads decode packed values across 32-bit boundaries and negative coordinates', () => {
  const words=new Uint32Array(Math.ceil(4096/12)*2), values=new Map([[6,31],[12,17],[4095,23]]);
  for(const [i,p] of values){const k=Math.floor(i/12)*2,v=BigInt(p)<<BigInt((i%12)*5);words[k]|=Number(v>>32n);words[k+1]|=Number(v&0xffffffffn);}
  const at=chunkBlockReader({sections:[{Y:-1,block_states:{palette:Array.from({length:32},(_,i)=>({Name:'test:b'+i})),data:new LongArray(words)}}]});
  assert.equal(at(-10,-16,-16),'test:b31');assert.equal(at(-4,-16,-16),'test:b17');assert.equal(at(-1,-1,-1),'test:b23');assert.equal(at(0,0,0),'minecraft:air');
});

test('site survey keeps unknown chunks distinct from air and reads saved terrain outside campus bounds', async () => {
  const dir=mkdtempSync(join(tmpdir(),'campus-terrain-')), world=join(dir,'world');mkdirSync(join(world,'region'),{recursive:true});
  const section=(y,name)=>nbtCompound({Y:{t:1,v:y},block_states:nbtCompound({palette:nbtList(10,[nbtCompound({Name:nbtString(name)})])})});
  const root=nbtCompound({Status:nbtString('minecraft:full'),sections:nbtList(10,[section(4,'minecraft:grass_block'),section(5,'minecraft:oak_leaves')]),block_entities:nbtList(10,[nbtCompound({x:nbtInt(-10),y:nbtInt(68),z:nbtInt(-12),id:nbtString('minecraft:chest')})])});
  const compressed=deflateSync(encodeTyped('',root)), buf=Buffer.alloc(12288), index=(31+31*32)*4;
  buf[index+2]=2;buf[index+3]=1;buf.writeUInt32BE(compressed.length+1,8192);buf[8196]=2;compressed.copy(buf,8197);writeFileSync(join(world,'region','r.-1.-1.mca'),buf);
  const app=await buildServer({dataDir:join(dir,'db'),worldSources:{live:world},snapshotIntervalMin:0,maxUploadBytes:1024*1024,publicUrl:'http://test',bootstrapInvite:'terrain-test-bootstrap',cookieSecure:false});
  try {
    const q={from:[-16,-16],to:[0,0],step:16,probeY:87}, data=surveyTerrain(world,q);
    assert.equal(data.coverage.samplesMissing,3);assert.equal(data.coverage.chunksLoaded,1);
    const s=data.samples.find(s=>s[7]);assert.deepEqual(s.slice(0,4),[-16,-16,95,79]);assert.equal(data.palette[s[5]],'minecraft:grass_block');assert.equal(data.palette[s[6]],'minecraft:oak_leaves');
    assert.equal(data.blockEntities.length,1);assert.equal(data.samples.filter(s=>!s[7]).every(s=>s[2]===null),true);
    const url='/api/world/terrain?from=-16,-16&to=0,0';assert.equal((await app.inject(url)).statusCode,401);
    const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'terrain-test-bootstrap',username:'surveyor',password:'terrain-test-password'}});
    const headers={cookie:'campus_session='+reg.cookies.find(c=>c.name==='campus_session').value};
    const result=await app.inject({url,headers});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().coverage.samplesMissing,3);
    assert.equal((await app.inject({url:'/api/world/terrain?from=0,0&to=2000,2000',headers})).statusCode,400);
    assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n,0);
    assert.deepEqual(app.campus.listBlueprints(),[]);
  } finally {await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
