import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {execFileSync} from 'node:child_process';

test('artifact configuration is opt-in through PLACEMENT_DRAFT_PATH',()=>{
 const output=execFileSync(process.execPath,['--input-type=module','-e',"import {config} from './src/config.js';console.log(config.placementDraftPath)"],{cwd:new URL('..',import.meta.url),env:{...process.env,PLACEMENT_DRAFT_PATH:'/private/plan.json'},encoding:'utf8'});
 assert.equal(output.trim(),'/private/plan.json');
});

const fixture=()=>({schemaVersion:1,planId:'survey-1',revision:'r1',generatedAt:'2026-11-23T12:00:00Z',source:'test fixture only',stations:[{id:'NEW-01',label:'Neue Truhe',dimension:'minecraft:overworld',equipment:{receiver:{x:1,y:64,z:1},cable:[{x:1,y:64,z:2}],bridge:{x:1,y:64,z:3},computer:{x:2,y:64,z:3},chest:{x:2,y:64,z:4}},cannons:{A:{x:3,y:64,z:4},B:{x:3,y:64,z:5},C:null},observed:{at:'2026-11-23T11:59:00Z',source:'saved world fixture',computerId:null,blocks:[{position:{x:2,y:64,z:4},blockId:'minecraft:chest'}]}}]});

test('artifact validates exact coordinates, expandable IDs and rejects duplicate or malformed rows',async()=>{
 const {validatePlacementDraft}=await import('../public/assets/erebor-placement-model.js');
 assert.deepEqual(validatePlacementDraft(fixture()),fixture());
 for(const mutate of [p=>p.stations.push(p.stations[0]),p=>p.stations[0].equipment.chest.x=1.5,p=>p.stations[0].cannons.A=null,p=>p.schemaVersion=2,p=>p.stations[0].observed.at='yesterday']){
  const p=fixture();mutate(p);assert.throws(()=>validatePlacementDraft(p));
 }
});

test('configured artifact is served privately and malformed replacements fail closed',async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR,'placement-artifact-'));
 const path=join(dir,'draft.json');writeFileSync(path,JSON.stringify(fixture()));
 const app=await buildServer({dataDir:dir,placementDraftPath:path,worldSources:{},bootstrapInvite:'artifact-test',publicUrl:'http://test',cookieSecure:false,snapshotIntervalMin:0});
 try{
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'artifact-test',username:'artifact',password:'artifact-test-password'}});
  const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  const result=await app.inject({url:'/api/projects/erebor/placement-draft',headers});
  assert.equal(result.statusCode,200);assert.deepEqual(result.json(),fixture());
  assert.match(result.headers['cache-control'],/no-store/);
  writeFileSync(path,'{}');
  const invalid=await app.inject({url:'/api/projects/erebor/placement-draft',headers});
  assert.equal(invalid.statusCode,503);assert.doesNotMatch(invalid.body,new RegExp(dir));
  assert.equal((await app.inject('/assets/placement-draft.json')).statusCode,404);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('placement draft is session-private, unavailable without an artifact, and read-only', async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR,'placement-'));
 let calls=0;
 const app=await buildServer({dataDir:dir,worldSources:{},bootstrapInvite:'placement-test',publicUrl:'http://test',cookieSecure:false,snapshotIntervalMin:0,cannonBridgeRequest:async()=>{calls++;throw Error('forbidden');}});
 try {
  assert.equal((await app.inject('/erebor/aufstellung')).statusCode,302);
  assert.equal((await app.inject('/api/projects/erebor/placement-draft')).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'placement-test',username:'placement',password:'placement-test-password'}});
  const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  const page=await app.inject({url:'/erebor/aufstellung',headers});
  assert.equal(page.statusCode,200);
  assert.match(page.body,/aria-current="page"[^>]*>Aufstellung/);
  assert.match(page.body,/Manuelle Checkliste/);
  const before=app.campus.db.prepare('SELECT total_changes() n').get().n;
  const data=await app.inject({url:'/api/projects/erebor/placement-draft',headers});
  assert.equal(data.statusCode,503);
  assert.equal(app.campus.db.prepare('SELECT total_changes() n').get().n,before);
  assert.equal(calls,0);
  assert.equal((await app.inject({method:'POST',url:'/api/projects/erebor/placement-draft',headers,payload:{}})).statusCode,404);
 } finally {await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
