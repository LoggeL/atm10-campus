import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';

test('draft projects are authenticated, versioned and isolated from world blueprints', async () => {
  const temp=mkdtempSync(join(tmpdir(),'campus-projects-'));
  const app=await buildServer({dataDir:temp,worldSources:{},snapshotIntervalMin:0,maxUploadBytes:1024*1024,publicUrl:'http://test',bootstrapInvite:'project-test-bootstrap',cookieSecure:false});
  try {
    assert.equal((await app.inject('/api/projects')).statusCode,401);
    assert.equal((await app.inject('/projects')).statusCode,302);
    const register=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'project-test-bootstrap',username:'planner',password:'project-test-password'}});
    const cookie='campus_session='+register.cookies.find(c=>c.name==='campus_session').value;
    const headers={cookie,'x-campus-csrf':'1'};
    const request=(method,url,payload,h=headers)=>app.inject({method,url,payload,headers:h});
    const plan={title:'Erebor',summary:'Planung',status:'planning',worldOrigin:null};
    const path='/api/projects/erebor';
    const dry=await request('PUT',path,{baseVersion:0,dryRun:true,plan});
    assert.equal(dry.statusCode,200,dry.body);assert.equal(dry.json().nextVersion,1);
    assert.deepEqual((await request('GET','/api/projects')).json(),[]);
    assert.equal((await request('GET',path)).statusCode,404);
    assert.equal((await request('PUT',path,{baseVersion:0,plan},{cookie})).statusCode,403);
    for(const scope of ['read','station']) {
      const token=(await request('POST','/api/tokens',{name:scope,scope})).json().token;
      assert.equal((await request('PUT',path,{baseVersion:0,plan},{authorization:'Bearer '+token})).statusCode,403);
    }
    const write=(await request('POST','/api/tokens',{name:'writer',scope:'write'})).json().token;
    const saved=await request('PUT',path,{baseVersion:0,plan},{authorization:'Bearer '+write});
    assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().project.version,1);
    assert.equal((await request('PUT',path,{baseVersion:0,plan})).statusCode,409);
    assert.equal((await request('PUT',path,{baseVersion:0,dryRun:true,plan})).statusCode,409);
    assert.equal((await request('PUT',path,{baseVersion:1,plan})).json().unchanged,true);
    const updated=await request('PUT',path,{baseVersion:1,plan:{...plan,title:'Erebor fertig geplant'}});
    assert.equal(updated.json().project.version,2);
    assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM build_project_versions').get().n,2);
    assert.equal((await request('GET',path)).json().plan.title,'Erebor fertig geplant');
    assert.equal((await request('GET','/api/projects')).json().length,1);
    assert.deepEqual((await request('GET','/api/blueprints')).json(),[]);
    assert.equal(app.campus.db.prepare('SELECT COUNT(*) AS n FROM cannons').get().n,0);
    assert.equal((await request('PUT',path,{baseVersion:2,plan:{...plan,worldOrigin:[0,64,0]}})).statusCode,400);
    assert.equal((await request('PUT',path,{baseVersion:2,dryRun:'false',plan})).statusCode,400);
    assert.equal((await request('PUT',path,{plan})).statusCode,400);
    assert.equal((await request('GET','/projects')).statusCode,200);
    const before=(await request('GET',path)).json();
    const tooLarge=await request('PUT',path,{baseVersion:2,plan:{...plan,notes:'x'.repeat(600000)}});
    assert.equal(tooLarge.statusCode,413);
    assert.deepEqual((await request('GET',path)).json(),before);
  } finally { await app.close();app.campus.db.close();rmSync(temp,{recursive:true,force:true}); }
});
