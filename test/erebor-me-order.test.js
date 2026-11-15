import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';

test('admin starts one versioned order, a bound station confirms batches and other callers cannot start it',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'campus-me-order-'));
  const app=await buildServer({dataDir:temp,worldSources:{},publicUrl:'http://test',bootstrapInvite:'test-admin',cookieSecure:false,snapshotIntervalMin:0});
  const db=app.campus.db,base='/api/projects/erebor/connecting-auftrag';
  const post=(url,headers,payload)=>app.inject({method:'POST',url,headers,payload});
  try {
    const account=await post('/api/auth/register',{}, {code:'test-admin',username:'order-admin',password:'test-me-orders-password'});
    const admin={cookie:'campus_session='+account.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
    const token=async scope=>({authorization:'Bearer '+(await post('/api/tokens',admin,{name:scope,scope})).json().token});
    const station=await token('station'),write=await token('write');
    const initial=(await app.inject({url:base,headers:write})).json();
    assert.equal(initial.state,'idle');
    assert.equal((await post(base,write,{attempt:0})).statusCode,403);
    assert.equal((await post(base,station,{attempt:0})).statusCode,403);
    assert.equal((await post(base,{cookie:admin.cookie},{attempt:0})).statusCode,403);
    await app.inject({method:'PUT',url:'/api/projects/erebor',headers:admin,payload:{baseVersion:0,plan:{title:'Erebor',summary:'Berg',status:'planning',worldOrigin:null}}});
    db.prepare("UPDATE build_projects SET current_version=12 WHERE id='erebor'").run();
    await post('/api/cannons/erebor-K02/status',station,{script:'1.4.4',computerId:13});
    assert.equal((await post(base,admin,{attempt:0})).statusCode,409);
    db.prepare(`INSERT INTO project_architecture_packages(project_id,base_version,revision,package_id,sha256,zip,report_json,saved_at)
      VALUES('erebor',12,5,'sample','hash',X'00',?,'today')`).run(JSON.stringify({materials:initial.targets}));
    assert.equal((await post(base,admin,{attempt:0})).json().state,'queued');
    assert.equal((await post(base,admin,{attempt:0})).json().attempt,1);
    const event=(event,extra={})=>post(base+'/station',station,{attempt:1,computer:13,event,...extra});
    assert.equal((await event('claim',{computer:2})).statusCode,409);
    assert.equal((await event('done')).statusCode,400);
    assert.equal((await event('claim')).json().state,'running');
    assert.equal((await event('done')).statusCode,409);
    const other=await token('station');
    assert.equal((await post(base+'/station',other,{attempt:1,computer:13,event:'claim'})).statusCode,409);
    assert.equal((await event('blocked',{message:'Zutaten fehlen'})).json().state,'blocked');
    assert.equal((await post(base,admin,{attempt:0})).statusCode,409);
    assert.equal((await post(base,admin,{attempt:1})).json().attempt,2);
    assert.equal((await event('claim')).statusCode,409);
    await event('claim',{attempt:2});
    const material='rechiseled:blackstone_tiles_connecting';
    const waiting=await event('progress',{attempt:2,item:material,stage:'retrying',quantity:11,covered:11,message:'MISSING_ITEMS'});
    assert.equal(waiting.json().state,'running');
    assert.equal((await app.inject({url:base,headers:write})).json().detail[material].covered,11);
    assert.equal((await event('progress',{attempt:2,item:material,stage:'crafting',quantity:initial.targets[material],covered:11})).statusCode,400);
    for(const [item,quantity] of Object.entries(initial.targets)){
      assert.equal((await event('progress',{attempt:2,item,quantity,stage:'credited'})).statusCode,200);
    }
    assert.equal((await event('done',{attempt:2})).json().state,'done');
    assert.equal((await post(base,admin,{attempt:2})).json().state,'done');
  } finally {await app.close();db.close();rmSync(temp,{recursive:true,force:true})}
});
