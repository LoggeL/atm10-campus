import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeWorld} from './helpers.js';
import {architecturePackage} from '../src/erebor-export.js';
import {storedZipEntry} from '../src/zip.js';
import {parseStructure} from '../src/nbt.js';
import {buildServer} from '../src/server.js';

test('architecture protects machines and inventories, excludes unknown excavation, leaves the world unchanged',()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-protection-'));
 try{writeWorld(dir,[{cx:0,cz:0,blocks:[{x:4,y:5,z:4,name:'minecraft:chest'},{x:14,y:5,z:14,name:'ae2:cable_bus'}],blockEntities:[{id:'minecraft:chest',x:4,y:5,z:4}]}]);const before=readFileSync(join(dir,'region','r.0.0.mca'));
  const tile={id:'test',origin:[0,0,0],size:[32,32,32],cannon:'K01',cannonPosition:[0,32,0],ops:[{a:[0,0,0],b:[32,16,32],s:1,g:'E02'},{a:[0,4,0],b:[32,8,32],s:0,g:'E02'}]},scene={revision:1,palette:[{name:'minecraft:air'},{name:'minecraft:stone_bricks'}]};
  const {bytes,report}=architecturePackage(scene,{id:'E02_001',group:'E02',title:'Tor',tiles:[tile]},dir,{id:'erebor',version:6});assert.ok(report.protectedCells>0);assert.ok(report.unknownCells>0);
  for(const f of report.files){const n=parseStructure(storedZipEntry(bytes,f.fileName));if(f.kind==='build'){assert.equal(n.clear.length,0);assert.ok(!n.placed.some(b=>b.x===4&&b.y===5&&b.z===4));}else{assert.equal(n.placed.length,0);for(let i=0;i<n.clear.length;i+=3){const [x,y,z]=n.clear.slice(i,i+3);assert.ok(x<16&&z<16,'never excavate unknown chunks');assert.ok(!(x<9&&z<9&&y>=1&&y<10),'inventory buffer');assert.ok(!(x===14&&y===5&&z===14),'mod cable');}}}
  assert.deepEqual(readFileSync(join(dir,'region','r.0.0.mca')),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('architecture API requires dryRun, publishes immutable authenticated downloads, and does not register world builds',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'erebor-api-')),world=join(dir,'world');writeWorld(world,[{cx:0,cz:0,blocks:[]}]);
 const app=await buildServer({dataDir:join(dir,'db'),worldSources:{live:world},snapshotIntervalMin:0,maxUploadBytes:1024*1024,publicUrl:'http://test',bootstrapInvite:'erebor-test',cookieSecure:false});
 try{const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'erebor-test',username:'planner',password:'erebor-test-password'}}),headers={cookie:'campus_session='+reg.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const plan=JSON.parse(readFileSync(new URL('./fixtures/erebor-plan.json',import.meta.url)));plan.title='Erebor';plan.summary='Architektur';plan.status='planning';plan.site.status='planned';
  const put=await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,dryRun:false,plan}});assert.equal(put.statusCode,200,put.body);
  assert.equal((await app.inject('/api/projects/erebor/architecture')).statusCode,401);
  const post=payload=>app.inject({method:'POST',url:'/api/projects/erebor/architecture/prepare',headers,payload});
  assert.equal((await post({baseVersion:0,dryRun:true,package:'E02_001'})).statusCode,409);
  assert.equal((await post({baseVersion:1,dryRun:false,package:'E02_001'})).statusCode,409);
  const dry=await post({baseVersion:1,dryRun:true,package:'E02_001'});assert.equal(dry.statusCode,200,dry.body);assert.ok(dry.json().report.files.length>0);
  assert.equal((await app.inject({url:'/api/projects/erebor/architecture',headers})).json().packages.length,0);
  const saved=await post({baseVersion:1,dryRun:false,package:'E02_001',preview:dry.json().preview});assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().worldPlacement,false);
  const f=saved.json().package.files[0],url=`/api/projects/erebor/architecture/E02_001/${f.id}.nbt?version=1&revision=${saved.json().package.revision}`;assert.equal((await app.inject(url)).statusCode,401);const n=await app.inject({url,headers});assert.equal(n.statusCode,200);assert.equal(n.headers['x-campus-sha256'],f.sha256);assert.equal(n.headers['x-campus-origin'],f.origin.join(','));
  const again=await post({baseVersion:1,dryRun:false,package:'E02_001',preview:'old'});assert.equal(again.json().unchanged,true);
  assert.equal(app.campus.listBlueprints().length,0);assert.equal(app.campus.db.prepare('SELECT COUNT(*) n FROM cannons').get().n,0);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
