import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';

test('Bauzähler page and read API retain authentication and never contact the controller',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'counter-route-'));let calls=0;
 const app=await buildServer({dataDir:dir,worldSources:{},bootstrapInvite:'counter-bootstrap',publicUrl:'http://test',cookieSecure:false,snapshotIntervalMin:0,cannonBridgeRequest:async()=>{calls++;throw Error('not allowed');}});
 try{
  assert.equal((await app.inject('/erebor/dashboard')).statusCode,302);
  assert.equal((await app.inject('/api/projects/erebor/dashboard')).statusCode,401);
  assert.equal((await app.inject('/erebor/bauzaehler')).statusCode,302);
  assert.equal((await app.inject('/api/projects/erebor/bauzaehler')).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'counter-bootstrap',username:'counter',password:'counter-test-password'}});
  assert.equal(login.statusCode,200);
  const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  assert.equal((await app.inject({url:'/',headers})).headers.location,'/erebor/dashboard');
  const publicDocs=await app.inject('/docs');
  assert.equal(publicDocs.statusCode,200);assert.doesNotMatch(publicDocs.body,/data-tab="admin"|data-logout/);
  app.campus.db.prepare("INSERT INTO snapshots(source,label,captured_at,world_stamp,dir,summary_json) VALUES('live','fixture',?,0,?,'{}')").run(new Date().toISOString(),dir);
  for(const url of ['/app','/projects','/erebor/dashboard','/docs','/api/materials?format=html']){
    const resource=await app.inject({url,headers});
    assert.equal(resource.statusCode,200,url);
    assert.match(resource.body,/class="campus-nav"/,url);
    assert.match(resource.body,/data-tab="admin"/,url);
    assert.match(resource.body,/data-logout/,url);
  }
  const equipment=await app.inject({url:'/api/projects/erebor/cannon-sites/dreierbetrieb',headers});
  assert.equal(equipment.headers.location,'/app?project=erebor#cannons');
  const page=await app.inject({url:'/erebor/bauzaehler',headers});
  assert.equal(page.statusCode,302);assert.equal(page.headers.location,'/erebor/dashboard');
  // Empty project state must be explicit, not invented zero totals.
  const result=await app.inject({url:'/api/projects/erebor/bauzaehler',headers});
  assert.equal(result.statusCode,404);assert.equal(calls,0);
  const db=app.campus.db;
  db.prepare("INSERT INTO build_projects(id,current_version,plan_json,created_at,updated_at) VALUES('erebor',12,'{}','now','now')").run();
  assert.match((await app.inject({url:'/erebor/dashboard',headers})).body,/Baufortschritt/);
  const dashboard=await app.inject({url:'/api/projects/erebor/dashboard',headers});
  assert.equal(dashboard.statusCode,200);assert.equal(dashboard.json().fleet.length,117);
  assert.equal(dashboard.json().filling,null);assert.equal(dashboard.json().telemetryAt,null);
  const before=db.prepare('SELECT total_changes() n').get().n;
  const response=await app.inject({url:'/api/projects/erebor/bauzaehler',headers});
  assert.equal(response.statusCode,200);assert.match(response.headers['cache-control'],/no-store/);
  assert.equal(response.json().massif,null);assert.equal(response.json().targetTotal,null);
  assert.equal(response.json().stages.stone.total,0);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.equal(calls,0);
  db.prepare('INSERT INTO erebor_massif_runs(v) VALUES(12)').run();
  const insert=db.prepare('INSERT INTO erebor_massif_tiles(v,tile,blocks,done,special,home,site) VALUES(?,?,?,?,?,?,?)');
  insert.run(12,'SOLID',100,0,0,'K01',null);
  insert.run(12,'CAVITY_LUFT',40,0,0,'K02','K01');
  insert.run(12,'BE',9,0,1,'K01',null);
  insert.run(12,'DONE',999,1,0,'K01',null);
  insert.run(11,'OLD',888,0,0,'K01',null);
  const changes=db.prepare('SELECT total_changes() n').get().n;
  const published=await app.inject({url:'/api/projects/erebor/bauzaehler',headers});
  const unified=(await app.inject({url:'/api/projects/erebor/dashboard',headers})).json();
  for(const key of ['massif','stages','stations','unassignedMassif'])assert.deepEqual(unified[key],published.json()[key]);
  assert.deepEqual(published.json().massif.workload,{grossBlocks:140,assignedBlocks:40,manualBlocks:9});
  assert.deepEqual(published.json().stations.K01.massif.workload,published.json().massif.workload);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,changes);assert.equal(calls,0);
  assert.equal((await app.inject({method:'POST',url:'/api/projects/erebor/bauzaehler',headers,payload:{}})).statusCode,404);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
