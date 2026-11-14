import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseNBT} from '../src/nbt.js';
import {wirelessReport} from '../src/erebor-wireless.js';
import {buildServer} from '../src/server.js';
import {openDb} from '../src/db.js';

test('existing tokens and their revocations survive the buffer scope migration',()=>{
  const directory=mkdtempSync(join(tmpdir(),'erebor-token-db-'));
  let db=openDb(directory);
  try{
    db.exec("INSERT INTO users (username,password_hash,role,created_at) VALUES ('owner','test','admin','yesterday')");
    const currentSchema=db.prepare("SELECT sql FROM sqlite_master WHERE name='api_tokens'").get().sql;
    db.exec('DROP TABLE api_tokens');
    db.exec(currentSchema.replace(",'erebor_supply'",''));
    db.exec("INSERT INTO api_tokens(user_id,name,token_hash,prefix,scope,created_at,revoked_at) VALUES (1,'live','test1','abc','station','yesterday',NULL),(1,'old','test2','def','read','yesterday','today')");
    const before=db.prepare('SELECT * FROM api_tokens ORDER BY id').all();
    db.close();db=openDb(directory);
    assert.deepEqual(db.prepare('SELECT * FROM api_tokens ORDER BY id').all(),before);
    db.exec("INSERT INTO api_tokens(user_id,name,token_hash,prefix,scope,created_at) VALUES (1,'buffer','test3','xyz','erebor_supply','today')");
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

test('wireless pairing distinguishes adjacent 64-bit frequencies, unused slots and duplicate endpoints',()=>{
  const bytes=Buffer.from('0a000004000166002000000000000100','hex');
  const first=parseNBT(bytes,{preserveLongs:true}).value.f;
  assert.equal(first,9007199254740993n);
  const layout={hubs:{A0:[],A1:[]},sites:[{site:'K02',hub:'A1'},{site:'K03',hub:'A1'}]};
  const device=(...f)=>({present:true,ports:f.map((frequency,i)=>({frequency,port:i+1}))});
  const points=new Map([['A1',device(first,first+2n)],['A0',device(first+2n)],['K02',device(first-1n)],['K03',device(first)]]);
  const state=r=>Object.fromEntries(r.links.filter(l=>l.hub==='A1').map(l=>[l.id,l.state]));
  assert.deepEqual(state(wirelessReport(layout,points)),{A0:'paired',K02:'unpaired',K03:'paired'});
  points.set('K02',device(first));
  assert.equal(state(wirelessReport(layout,points)).K03,'ambiguous');
});

test('operator ZIP contains current feeder and all station mappings, only for the intended project layout',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'fleet-'));
  const app=await buildServer({dataDir:temp,worldSources:{},snapshotIntervalMin:0,publicUrl:'http://test',bootstrapInvite:'fleet-test',cookieSecure:false});
  try{
    const url='/api/projects/erebor/cannon-sites/installer.zip';
    assert.equal((await app.inject(url)).statusCode,401);
    const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'fleet-test',username:'fleet-admin',password:'fleet-test-password'}});
    const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
    assert.equal((await app.inject({url,headers})).statusCode,409);
    const layout=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
    const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:layout.sites.map(s=>({id:s.site,position:s.planned}))}};
    assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}})).statusCode,200);
    const zip=await app.inject({url,headers});assert.equal(zip.statusCode,200);
    const data=zip.rawPayload;const files=new Map();let i=0;
    while(data.readUInt32LE(i)===0x04034b50){
      const len=data.readUInt32LE(i+18),n=data.readUInt16LE(i+26),start=i+30+n+data.readUInt16LE(i+28);
      files.set(data.subarray(i+30,i+30+n).toString(),data.subarray(start,start+len));i=start+len;
    }
    assert.deepEqual([...files.keys()].sort(),['ANLEITUNG.txt','Funkverbindungen.csv','campus.lua','install.py','stations.json']);
    assert.deepEqual(files.get('campus.lua'),readFileSync(new URL('../public/cc/campus.lua',import.meta.url)));
    assert.equal(JSON.parse(files.get('stations.json')).sites.length,37);
    assert.equal(files.get('Funkverbindungen.csv').toString().trim().split('\r\n').length,38);
    const db=app.campus.db;
    const preset='/api/projects/erebor/cannon-sites/materialpuffer';
    const post=h=>app.inject({method:'POST',url:preset,headers:h});
    assert.equal((await post({})).statusCode,401);
    assert.equal((await post({cookie:headers.cookie})).statusCode,403);
    const add=db.prepare("INSERT INTO cannons(name,created_at,updated_at,assignment,options_json) VALUES(?,datetime('now'),datetime('now'),42,?)");
    const original=JSON.stringify({bufferStacks:8,gunpowder:64,autoCraft:true});
    const row=name=>db.prepare('SELECT options_json,assignment FROM cannons WHERE name=?').get(name);
    for(const s of layout.sites.slice(0,-1))add.run('erebor-'+s.site,original);
    add.run('campus-other',original);
    assert.equal((await post(headers)).statusCode,409);
    assert.equal(row('erebor-K01').options_json,original);
    add.run('erebor-K37','{}');
    const saved=await post(headers);
    assert.equal(saved.statusCode,200,saved.body);
    assert.deepEqual(saved.json(),{verified:37,total:37});
    for(const {site} of layout.sites){
      const stored=row('erebor-'+site);
      assert.equal(stored.assignment,42);
      assert.equal(JSON.parse(stored.options_json).bufferStacks,16);
      assert.equal(JSON.parse(stored.options_json).gunpowder,64);
    }
    assert.equal(JSON.parse(row('erebor-K01').options_json).autoCraft,true);
    assert.equal(row('campus-other').options_json,original);
    assert.equal((await post(headers)).statusCode,200);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='erebor.supply.settings'").get().n,1);
    const issue=(scope,h=headers)=>app.inject({method:'POST',url:'/api/tokens',headers:h,payload:{name:'Puffertest',scope}});
    const issued=await issue('erebor_supply');
    assert.equal(issued.statusCode,200);
    const key=issued.json(),agent={authorization:'Bearer '+key.token};
    const call=(method,url,payload)=>app.inject({method,url,headers:agent,payload});
    const settings=async()=>(await call('GET',preset)).json().stations;
    assert.equal((await settings()).length,37);
    const change=await call('POST',preset,{sites:['K01','K37'],bufferStacks:12});
    assert.equal(change.statusCode,200);
    assert.deepEqual(change.json(),{verified:2,total:2});
    const rows=await settings();
    assert.deepEqual(rows.filter(r=>r.bufferStacks===12).map(r=>r.site),['K01','K37']);
    assert.ok(rows.every(r=>r.gunpowder===64));
    assert.equal((await call('POST',preset,{gunpowder:32})).json().verified,37);
    for(const input of [{paused:true},{sites:[],bufferStacks:8},{sites:['K38'],gunpowder:8},{sites:['K01','K01'],gunpowder:32},{bufferStacks:17},{gunpowder:-1},{gunpowder:1.5},{gunpowder:'64'},{}])
      assert.equal((await call('POST',preset,input)).statusCode,400);
    for(const [method,url,payload] of [['GET','/api/status'],['GET','/api/tokens'],['POST','/api/tokens',{name:'broader',scope:'write'}],
      ['POST','/api/projects/erebor/planfolge/automatik',{site:'K01',version:12,enabled:true}],['PUT','/api/projects/erebor',{baseVersion:1,plan}],
      ['POST','/api/cannons/erebor-K01/status',{state:'feeding'}],['PUT','/api/cannons/erebor-K01',{options:{paused:true}}]])
      assert.equal((await call(method,url,payload)).statusCode,403,method+' '+url);
    for(const scope of ['read','station','write']){
      const ordinary={authorization:'Bearer '+(await issue(scope)).json().token};
      assert.equal((await post(ordinary)).statusCode,403);
    }
    db.exec("UPDATE users SET role='member' WHERE username='fleet-admin'");
    assert.equal((await issue('erebor_supply')).statusCode,403);
    assert.equal((await call('GET',preset)).statusCode,403);
    db.exec("UPDATE users SET role='admin' WHERE username='fleet-admin'");
    assert.equal((await app.inject({method:'DELETE',url:'/api/tokens/'+key.id,headers})).statusCode,200);
    assert.equal((await call('GET',preset)).statusCode,401);
    assert.equal((await call('POST',preset,{bufferStacks:8})).statusCode,401);
  }finally{await app.close();app.campus.db.close();rmSync(temp,{recursive:true,force:true});}
});
