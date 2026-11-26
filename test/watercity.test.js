import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {fixture} from './watercity-fixture.js';

const endpoint='/api/projects/erebor/wasserstadt';

test('private watercity fleet adopts exactly six retained selections read-only and uses independent native counters',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR,'watercity-ui-'));
 const app=await buildServer({dataDir:dir,worldSources:{},bootstrapInvite:'watercity-test',cookieSecure:false,snapshotIntervalMin:0,publicUrl:'http://test'});
 try{
  assert.equal((await app.inject('/erebor/wasserstadt')).statusCode,302);
  assert.equal((await app.inject(endpoint)).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'watercity-test',username:'watercity-test',password:'watercity-test-password'}});
  const headers={cookie:login.headers['set-cookie'].split(';')[0],'x-campus-csrf':'1'};
  const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null};
  assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}})).statusCode,200);
  const db=app.campus.db;
  db.exec("UPDATE build_projects SET current_version=12 WHERE id='erebor'");
  const {jobs,watercity}=fixture();
  for(const j of jobs)db.prepare("INSERT INTO erebor_selections(id,version,site,name,sha,job,status) VALUES(?,12,'AP1040_M9200',?,?,?,'waiting')").run(j.selectionId,j.desired.blueprint,j.desired.sha256,JSON.stringify(j.job));
  let reads=0;app.campus.ereborLiveReport=async()=>{reads++;return {version:12,at:Date.now(),watercity};};
  const before=db.prepare('SELECT * FROM erebor_selections ORDER BY id').all(),changes=db.prepare('SELECT total_changes() n').get().n;
  const response=await app.inject({url:endpoint,headers});
  assert.equal(response.statusCode,200,response.body);
  assert.match(response.headers['cache-control'],/private.*no-store/);
  const data=response.json();
  assert.equal(data.slots.length,6);
  assert.deepEqual(data.slots.map(s=>s.assignment.id),[12,13,14,15,16,17]);
  assert.deepEqual(data.slots.map(s=>s.observation.placed),[356,357,358,359,360,361]);
  assert.deepEqual(data.slots.map(s=>s.observation.total),[1040,1040,1040,0,0,0]);
  assert.ok(data.slots.every(s=>s.observation.fresh&&s.assignment.status==='waiting'));
  assert.equal(data.groups.find(g=>g.id==='P02').commissioned,false);
  assert.equal(data.automaticNextJob,false);
  assert.equal(reads,1);
  assert.deepEqual(db.prepare('SELECT * FROM erebor_selections ORDER BY id').all(),before);
  assert.equal(db.prepare('SELECT total_changes() n').get().n,changes);
  const page=await app.inject({url:'/erebor/wasserstadt',headers});
  assert.equal(page.statusCode,200);
  assert.match(page.body,/href="\/erebor\/wasserstadt"[^>]*aria-current="page"/);
  assert.match(page.body,/href="\/erebor\/aufstellung"/);
  assert.equal((await app.inject({method:'POST',url:endpoint,headers,payload:{start:true}})).statusCode,404);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
