import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,statSync,utimesSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildServer} from '../src/server.js';
import {createApiToken} from '../src/auth.js';
import {writeWorld} from './helpers.js';
import {parseStructure} from '../src/nbt.js';

test('prepared stone packages require write/dryRun/current world, persist, and never overwrite a saved package',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'prepared-stone-')),world=join(dir,'world');
 const chunks=[];for(let cx=0;cx<4;cx++)for(let cz=0;cz<4;cz++)chunks.push({cx,cz,blocks:[]});writeWorld(world,chunks);
 const config={dataDir:join(dir,'db'),worldSources:{live:world},snapshotIntervalMin:0,maxUploadBytes:1024*1024,publicUrl:'http://test',bootstrapInvite:'prepared-stone-test',cookieSecure:false};
 let app=await buildServer(config);
 try {
  const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'prepared-stone-test',username:'planner',password:'stone-test-password'}}),headers={cookie:'campus_session='+reg.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const p={title:'Erebor',summary:'Steinfüllung',status:'planning',worldOrigin:[100,88,32],rotationDegrees:90,site:{status:'planned'},mountainFill:{algorithm:'erebor-massif-v1',bounds:[[0,0,0],[64,32,64]],peak:[32,24,32],roofReserves:[],protectedBoxes:[]},cannonLayout:{stations:[{id:'K19',position:[32,32,32]}]}};
  assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan:p}})).statusCode,200);
  const url='/api/projects/erebor/stone/prepared?version=1',file='/api/projects/erebor/stone/prepared/K19/1.zip?version=1',body={baseVersion:1,cannon:'K19',part:1,dryRun:true};
  const post=(payload,h=headers)=>app.inject({method:'POST',url,headers:h,payload});
  assert.equal((await app.inject(file)).statusCode,401);
  assert.equal((await app.inject({url:file,headers})).statusCode,404);
  const user=app.campus.db.prepare('SELECT id FROM users WHERE username=?').get('planner'),read=createApiToken(app.campus.db,user.id,'read','read');
  assert.equal((await post(body,{authorization:'Bearer '+read.token})).statusCode,403);
  assert.equal((await post({...body,baseVersion:0})).statusCode,409);
  assert.equal((await post({...body,dryRun:false,preview:'missing'})).statusCode,409);
  let dry=await post(body);assert.equal(dry.statusCode,200,dry.body);assert.ok(dry.json().report.files.length>0);
  assert.equal((await app.inject({url,headers})).json().packages.length,0);
  const region=join(world,'region','r.0.0.mca'),stamp=statSync(region);utimesSync(region,stamp.atime,new Date(stamp.mtimeMs+2000));
  assert.equal((await post({...body,dryRun:false,preview:dry.json().preview})).statusCode,409);
  dry=await post(body);assert.equal(dry.statusCode,200,dry.body);
  const worldBefore=readFileSync(region),saved=await post({...body,dryRun:false,preview:dry.json().preview});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().saved,true);assert.equal(saved.json().worldPlacement,false);
  const zip=await app.inject({url:file,headers});assert.equal(zip.statusCode,200);assert.equal(createHash('sha256').update(zip.rawPayload).digest('hex'),saved.json().package.sha256);
  let offset=0,total=0;while(zip.rawPayload.readUInt32LE(offset)===0x04034b50){const b=zip.rawPayload,size=b.readUInt32LE(offset+18),len=b.readUInt16LE(offset+26),start=offset+30+len+b.readUInt16LE(offset+28),name=b.subarray(offset+30,offset+30+len).toString();if(name.endsWith('.nbt')){const n=parseStructure(b.subarray(start,start+size));assert.equal(n.clear.length,0);assert.deepEqual(n.materials,{'minecraft:stone':n.placed.length});total+=n.placed.length;}offset=start+size;}
  assert.equal(total,saved.json().package.blocks);
  const first=saved.json().package.files[0],single=`/api/projects/erebor/stone/prepared/K19/1/${first.tile}.nbt?version=1`;
  assert.equal((await app.inject(single)).statusCode,401);
  assert.equal((await app.inject({url:single.replace('version=1','version=0'),headers})).statusCode,409);
  assert.equal((await app.inject({url:'/api/projects/erebor/stone/prepared/K19/1/absent.nbt?version=1',headers})).statusCode,404);
  const nbt=await app.inject({url:single,headers});assert.equal(nbt.statusCode,200,nbt.body);
  assert.equal(nbt.headers['x-campus-origin'],first.origin.join(','));assert.equal(nbt.headers['x-campus-cannon'],'K19');
  assert.equal(createHash('sha256').update(nbt.rawPayload).digest('hex'),first.sha256);
  assert.deepEqual(parseStructure(nbt.rawPayload).materials,{'minecraft:stone':first.blocks});
  assert.equal((await post({...body,dryRun:false,preview:'already-saved'})).json().unchanged,true);
  assert.deepEqual(readFileSync(region),worldBefore);assert.deepEqual(app.campus.listBlueprints(),[]);assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM cannons').get().n,0);
  await app.close();app.campus.db.close();app=await buildServer(config);
  const again=await app.inject({url:file,headers});assert.equal(again.statusCode,200);assert.deepEqual(again.rawPayload,zip.rawPayload);
  assert.equal((await app.inject({url,headers})).json().packages.length,1);
  const current=(await app.inject({url:'/api/projects/erebor',headers})).json();
  current.plan.stoneStart={preparedBaseVersion:1};current.plan.summary='Innenräume erweitert, Berg unverändert';
  assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:1,plan:current.plan}})).statusCode,200);
  const inherited=await app.inject({url:url.replace('version=1','version=2'),headers});
  assert.equal(inherited.json().packages.length,1);assert.equal(inherited.json().packages[0].version,1);
  assert.deepEqual((await app.inject({url:file,headers})).rawPayload,zip.rawPayload,'immutable stone downloads survive an interior-only project revision');
  assert.equal((await post(body)).statusCode,409,'historical project versions cannot be written');
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
