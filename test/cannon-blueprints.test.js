import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';
import {buildProgress} from '../src/cannon-blueprints.js';
import {structureNbt,writeWorld} from './helpers.js';

const binding={dimension:'minecraft:overworld',x:0,y:64,z:0,owner:'Campus'};
const defaults={replaceMode:2,protectBlockEntities:true};

test('construction progress excludes air volume and rejects protected, unknown, fluid-only and unsafe nearby cells',()=>{
  const grid={origin:[0,64,0],size:[10,1,1],names:['minecraft:air','minecraft:stone','minecraft:chest'],grid:new Uint16Array([0,0,0,0,1,0,2,0,0,0]),blockEntities:[[6,64,0,'minecraft:chest']]};
  const model={cells:new Map([['4,0,0',{name:'minecraft:stone'}],['5,0,0',{name:'minecraft:glass'}],['6,0,0',{name:'minecraft:glass'}],['7,0,0',{name:'minecraft:water'}],['0,0,0',{name:'minecraft:air'}]])};
  const p=buildProgress(model,[0,64,0],grid,binding,defaults,{});
  assert.deepEqual(p,{total:4,built:1,remaining:1,blocked:1,unknown:0,unsupported:1,progress:25});
  const one=(x,name='minecraft:glass')=>({cells:new Map([[`${x},0,0`,{name}]])});
  assert.equal(buildProgress(one(10),[0,64,0],grid,binding,defaults,{}).unknown,1);
  assert.equal(buildProgress(one(1),[0,64,0],grid,binding,defaults,{}).blocked,1);
  assert.equal(buildProgress(one(4),[0,64,0],grid,binding,{...defaults,replaceMode:0},{}).blocked,1);
  assert.equal(buildProgress(one(6),[0,64,0],grid,binding,{...defaults,protectBlockEntities:false},{skipBlocked:false}).remaining,1);
  const many={cells:new Map(Array.from({length:10001},(_,i)=>[`${i},0,0`,{name:'minecraft:stone'}]))};
  const huge={origin:[0,64,0],size:[10001,1,1],names:['minecraft:stone','minecraft:air'],grid:new Uint16Array(10001)};huge.grid[10000]=1;
  assert.equal(buildProgress(many,[0,64,0],huge,binding,defaults,{}).progress,99.9,'unfinished never rounds up to 100%');
});

test('per-cannon choices use current world, range, assignment and settings, and stale UI assignments are rejected',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'cannon-choices-')),world=join(dir,'world');
  const blocks=[{x:4,y:64,z:4,name:'minecraft:stone'},{x:6,y:64,z:4,name:'minecraft:chest'}];
  const write=()=>writeWorld(world,[{cx:0,cz:0,blocks,blockEntities:[{x:6,y:64,z:4,id:'minecraft:chest'}]}]);write();
  const app=await buildServer({dataDir:join(dir,'data'),worldSources:{live:world},contextOrigin:[0,48,0],contextSize:[16,32,16],snapshotKeepRecent:10,
    bootstrapInvite:'choices-bootstrap',publicUrl:'http://test',cookieSecure:false,maxUploadBytes:1024*1024,
    cannonBridgeRequest:async()=>({binding,observed:{at:Date.now()/1000,state:'STOPPED',printer:{}}})});
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});});
  const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'choices-bootstrap',username:'admin',password:'choices-password-long'}});
  const headers={cookie:reg.cookies[0].name+'='+reg.cookies[0].value,'x-campus-csrf':'1'};
  const req=(method,url,payload)=>app.inject({method,url,headers,payload});
  const add=(id,origin,cells)=>app.campus.saveVersion({fileName:id+'.nbt',origin,bytes:structureNbt([4,1,1],cells),via:'test'});
  const stone=[{pos:[0,0,0],name:'minecraft:stone'}],glass=[{pos:[0,0,0],name:'minecraft:glass'}];
  add('open',[4,64,4],[...stone,{pos:[1,0,0],name:'minecraft:glass'},{pos:[2,0,0],name:'minecraft:air'}]);
  add('done',[4,64,4],stone);add('protected',[6,64,4],glass);add('water',[7,64,4],[{pos:[0,0,0],name:'minecraft:water'}]);
  add('far',[256,64,0],stone);add('unknown',[16,64,0],stone);add('claimed',[8,64,4],stone);add('archived',[9,64,4],stone);
  app.campus.db.prepare('UPDATE blueprints SET archived_at=? WHERE id=?').run(new Date().toISOString(),'archived');
  await app.campus.capture({source:'live',force:true});
  await req('PUT','/api/cannons/a',{});await req('PUT','/api/cannons/b',{});
  app.campus.db.prepare('UPDATE cannons SET blueprint_id=? WHERE name=?').run('claimed','b');
  assert.equal((await req('GET','/api/cannons/a')).json().blueprintChoices.items.length,0,'no guessed location');
  app.campus.db.prepare('INSERT INTO cannon_alignment(name,binding_json,updated_at) VALUES(?,?,?)').run('a',JSON.stringify(binding),new Date().toISOString());
  const before=(await req('GET','/api/cannons/a')).json(), choices=before.blueprintChoices;
  assert.deepEqual(choices.items.map(x=>x.id),['open']);
  assert.equal(choices.items[0].progress,50);assert.equal(choices.items[0].remaining,1);assert.equal(choices.items[0].total,2);
  assert.deepEqual(choices.excluded,{finished:1,range:1,assigned:1,blocked:2,unknown:1});
  const select={blueprint:'open',version:1,selection:{version:1,assignment:before.assignment}};
  assert.equal((await req('PUT','/api/cannons/a',{...select,selection:{...select.selection,assignment:0}})).statusCode,409);
  app.campus.db.prepare('UPDATE cannons SET blueprint_id=? WHERE name=?').run('open','b');
  assert.equal((await req('PUT','/api/cannons/a',select)).statusCode,409,'new assignment on another cannon invalidates old menu');
  app.campus.db.prepare('UPDATE cannons SET blueprint_id=? WHERE name=?').run('claimed','b');
  blocks.push({x:5,y:64,z:4,name:'minecraft:glass'});write();await app.campus.capture({source:'live',force:true});
  assert.equal((await req('PUT','/api/cannons/a',select)).statusCode,409,'completed since menu opened');
  add('open',[4,64,4],[...stone,{pos:[3,0,0],name:'minecraft:glass'}]);
  assert.equal((await req('PUT','/api/cannons/a',select)).statusCode,409,'new blueprint version cannot silently replace selection');
  const valid=await req('PUT','/api/cannons/a',{...select,version:2,selection:{...select.selection,version:2}});
  assert.equal(valid.statusCode,200,valid.body);assert.equal(valid.json().blueprint.version,2);
  add('race',[10,64,4],stone);
  app.campus.db.prepare('INSERT INTO cannon_alignment(name,binding_json,updated_at) VALUES(?,?,?)').run('b',JSON.stringify({...binding,z:1}),new Date().toISOString());
  app.campus.db.prepare('UPDATE cannons SET version=1 WHERE name=?').run('b');
  const [a,b]=await Promise.all(['a','b'].map(async n=>(await req('GET','/api/cannons/'+n)).json()));
  const competing=await Promise.all([a,b].map(c=>req('PUT','/api/cannons/'+c.name,{blueprint:'race',version:1,selection:{assignment:c.assignment,version:1}})));
  assert.deepEqual(competing.map(r=>r.statusCode).sort(),[200,409],'simultaneous selections cannot claim the same plan twice: '+competing.map(r=>r.json().error||r.statusCode).join(' / '));
  assert.equal((await app.inject({url:'/api/cannons/a'})).statusCode,401);
});
