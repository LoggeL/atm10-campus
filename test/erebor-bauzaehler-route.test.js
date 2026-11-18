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
  assert.equal((await app.inject('/erebor/bauzaehler')).statusCode,302);
  assert.equal((await app.inject('/api/projects/erebor/bauzaehler')).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'counter-bootstrap',username:'counter',password:'counter-test-password'}});
  assert.equal(login.statusCode,200);
  const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  const page=await app.inject({url:'/erebor/bauzaehler',headers});
  assert.equal(page.statusCode,200);assert.match(page.body,/nicht addiert/);
  // Empty project state must be explicit, not invented zero totals.
  const result=await app.inject({url:'/api/projects/erebor/bauzaehler',headers});
  assert.equal(result.statusCode,404);assert.equal(calls,0);
  const db=app.campus.db;
  db.prepare("INSERT INTO build_projects(id,current_version,plan_json,created_at,updated_at) VALUES('erebor',12,'{}','now','now')").run();
  const before=db.prepare('SELECT total_changes() n').get().n;
  const response=await app.inject({url:'/api/projects/erebor/bauzaehler',headers});
  assert.equal(response.statusCode,200);assert.match(response.headers['cache-control'],/no-store/);
  assert.equal(response.json().massif,null);assert.equal(response.json().targetTotal,null);
  assert.equal(response.json().stages.stone.total,0);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.equal(calls,0);
  assert.equal((await app.inject({method:'POST',url:'/api/projects/erebor/bauzaehler',headers,payload:{}})).statusCode,404);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
