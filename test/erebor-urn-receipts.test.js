import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {manualUrn} from '../src/erebor-manual-urn.js';
import {ereborUploadName} from '../src/erebor-file.js';
import {writeWorld} from './helpers.js';

test('empty printers can finish before start readback; credit only their exact receipt and saved stone',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'campus-single-urn-'));
 const signals={};
 const bridge=async(type)=>type==='erebor-live'?{version:12,urnPreparation:2,sharedChest:4,at:Date.now(),stations:signals}:{observed:{inputEmpty:false}};
 const app=await buildServer({dataDir:dir,worldSources:{live:dir},snapshotIntervalMin:0,publicUrl:'http://test',cookieSecure:false,bootstrapInvite:'campus-urn-test',cannonBridgeRequest:bridge});
 const db=app.campus.db;
 try{
   const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'campus-urn-test',username:'admin-user',password:'fleet-test-password'}});
   assert.equal(login.statusCode,200,login.body);
  const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
  const {readFileSync}=await import('node:fs');
  const layout=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
  const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:layout.sites.map(s=>({id:s.site,position:s.planned}))}};
  assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}})).statusCode,200);
  db.exec("UPDATE build_projects SET current_version=12 WHERE id='erebor';INSERT INTO erebor_massif_runs VALUES(12,1,'today')");
  const post=action=>app.inject({method:'POST',url:'/api/projects/erebor/planfolge',headers,payload:{version:12,action}});
  assert.equal((await post('pause')).statusCode,200);
  writeWorld(dir,[{cx:0,cz:0,blocks:[1,2,4].map(x=>({x,y:15,z:3,name:'minecraft:stone'}))}]);
  for(const [i,slot] of [...'ABCD'].entries()){
   const pos=[i+1,15,3],f=manualUrn('X00_Z00',pos),blueprint='EREBOR_STEIN_K01_MASSIV_'+f.tile+'_V12';
   const file=ereborUploadName(blueprint+'.nbt',f.sha);
   const desired={file,blueprint,sha256:f.sha,owner:'Erebor',anchor:pos,version:12,rotation:'none',mirror:'none',options:{replace_mode:0,skip_missing:false,replace_block_entities:false}};
   const job={massif:f.tile,desired,size:[1,1,1],blocks:1,phase:'stone',loaded:false,next:0};
   db.prepare('INSERT OR IGNORE INTO erebor_massif_blobs VALUES(?,?)').run(f.sha,f.bytes);
   db.prepare("INSERT INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,site,slot,special) VALUES(12,?,?,?,?,1,1,1,1,?,'K01',?,1)").run(f.tile,...pos,f.sha,slot);
   if(slot==='A')db.prepare("UPDATE erebor_queue_sites SET state=json_set(state,'$.job',json(?)) WHERE site='K01'").run(JSON.stringify(job));
   else db.prepare("INSERT INTO erebor_helpers(version,site,slot,name,job) VALUES(12,'K01',?,?,?)").run(slot,blueprint,JSON.stringify(job));
   signals[slot==='A'?'K01':'K01'+slot]={empty:true,upload:'',state:'STOPPED',status:'finished',ready:true,finish:{file:slot==='D'?'foreign':file,before:Date.now()-1500,at:Date.now()-1000,oldCount:0,newCount:1}};
  }
  await post('prepare');
  const completed=()=>db.prepare('SELECT slot FROM erebor_massif_tiles WHERE done=1 ORDER BY slot').all().map(r=>r.slot);
  for(let i=0;i<120&&completed().length<2;i++)await new Promise(r=>setTimeout(r,25));
  assert.deepEqual(completed(),['A','B']);
  assert.equal(db.prepare("SELECT completed FROM erebor_helpers WHERE site='K01' AND slot='B'").get().completed,1);
 }finally{await app.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
