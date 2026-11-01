import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../src/server.js';
import { createApiToken, HttpError, sha256 } from '../src/auth.js';
import { writeWorld, structureNbt } from './helpers.js';

async function fixture(t, realtime = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'campus-realtime-')), world = join(dir, 'world');
  writeWorld(world, [{cx:0,cz:0,blocks:[{x:1,y:1,z:1,name:'minecraft:stone'}]}]);
  const app = await buildServer({
    port:0,host:'127.0.0.1',dataDir:join(dir,'data'),worldSources:{live:world},contextOrigin:[0,0,0],contextSize:[16,16,16],
    snapshotIntervalMin:0,snapshotKeepRecent:10,bootstrapInvite:'realtime-bootstrap-123',publicUrl:'http://test',cookieSecure:false,
    maxUploadBytes:32*1024*1024,realtime:{heartbeatMs:40,batchMs:10,maxPerUser:2,...realtime},
  });
  const registered = await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'realtime-bootstrap-123',username:'realtime',password:'realtime-pass-123'}});
  assert.equal(registered.statusCode,200,registered.body);
  const session = registered.cookies.find(c=>c.name==='campus_session').value;
  const headers = {cookie:'campus_session='+session,'x-campus-csrf':'1'};
  const user = registered.json().user;
  const station = createApiToken(app.campus.db,user.id,'station','station').token;
  const read = createApiToken(app.campus.db,user.id,'reader','read').token;
  const origin = await app.listen({host:'127.0.0.1',port:0});
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});});
  return {app,origin,headers,session,station,read,user};
}

async function subscribe(origin, headers = {}) {
  const abort = new AbortController();
  const response = await fetch(origin+'/api/events',{headers,signal:abort.signal});
  assert.equal(response.status,200);
  const events = [], waiters = new Set(), decoder = new TextDecoder();
  let rest = '', finished = false, failure = null;
  const pump = (async()=>{
    try {
      for await (const chunk of response.body) {
        rest += decoder.decode(chunk,{stream:true});
        let end;
        while((end=rest.indexOf('\n\n'))>=0) {
          const packet=rest.slice(0,end);rest=rest.slice(end+2);
          const fields=Object.fromEntries(packet.split('\n').map(line=>{const i=line.indexOf(':');return [line.slice(0,i),line.slice(i+1).trimStart()];}));
          if(fields.event) events.push({type:fields.event,id:fields.id,data:JSON.parse(fields.data)});
        }
        for(const wake of waiters)wake();
      }
    } catch(error) { if(!abort.signal.aborted)failure=error; }
    finally { finished=true;for(const wake of waiters)wake(); }
  })();
  return {
    response, events, end:pump, abort:()=>abort.abort(),
    next(type, predicate=()=>true, timeout=1500) {
      return new Promise((resolve,reject)=>{
        let timer;
        const check=()=>{
          const index=events.findIndex(e=>e.type===type&&predicate(e.data));
          if(index>=0){cleanup();resolve(events.splice(index,1)[0]);}
          else if(finished){cleanup();reject(failure||new Error('Stream ended before '+type));}
        };
        const cleanup=()=>{clearTimeout(timer);waiters.delete(check);};
        timer=setTimeout(()=>{cleanup();reject(new Error('Timed out waiting for '+type));},timeout);
        waiters.add(check);check();
      });
    },
  };
}

test('SSE authenticates, sets streaming headers, sends sync/heartbeat and limits connections', async t=>{
  const {app,origin,headers,read}=await fixture(t);
  assert.equal((await app.inject({url:'/api/events'})).statusCode,401);
  assert.equal((await app.inject({url:'/api/events',headers:{authorization:'Bearer invalid'}})).statusCode,401);
  const one=await subscribe(origin,headers),two=await subscribe(origin,{authorization:'Bearer '+read});
  t.after(()=>{one.abort();two.abort();});
  const sync=await one.next('sync');
  assert.deepEqual(sync.data.topics,['blueprints','snapshots','cannons','stock','activity']);
  assert.match(sync.id,/^[a-f0-9-]+:\d+$/);
  assert.match(one.response.headers.get('content-type'),/^text\/event-stream/);
  assert.match(one.response.headers.get('cache-control'),/private.*no-store.*no-transform/);
  assert.equal(one.response.headers.get('x-accel-buffering'),'no');
  assert.ok((await one.next('heartbeat')).data.at>0);
  const excess=await app.inject({url:'/api/events',headers});
  assert.equal(excess.statusCode,429);assert.equal(excess.headers['retry-after'],'15');
  one.abort();await one.end;
  // Wait for the server to receive the socket-close event.
  await new Promise(resolve=>setTimeout(resolve,30));
  const reconnected=await subscribe(origin,{...headers,'last-event-id':sync.id});
  assert.deepEqual((await reconnected.next('sync')).data.topics,sync.data.topics);
  reconnected.abort();await reconnected.end;
});

test('computer reports invalidate the named cannon; reads and rejected writes do not loop', async t=>{
  const {app,origin,headers,station}=await fixture(t);
  const stream=await subscribe(origin,headers);t.after(()=>stream.abort());await stream.next('sync');
  const response=await app.inject({method:'POST',url:'/api/cannons/alpha/status',headers:{authorization:'Bearer '+station},payload:{state:'waiting',script:'1.3.0',assignment:1}});
  assert.equal(response.statusCode,200,response.body);
  const change=await stream.next('change',d=>d.topics.includes('cannons'));
  assert.deepEqual(change.data.cannons,['alpha']);
  assert.equal((await app.inject({url:'/api/cannons/alpha',headers})).statusCode,200);
  assert.equal((await app.inject({method:'POST',url:'/api/cannons/alpha/status',headers:{authorization:'Bearer bad'},payload:{state:'done'}})).statusCode,401);
  await assert.rejects(stream.next('change',d=>d.topics.includes('cannons'),120),/Timed out/);
  app.updates.publish('cannons','alpha');app.updates.publish('cannons','beta');app.updates.publish('stock');
  const batched=await stream.next('change',d=>d.topics.includes('stock'));
  assert.deepEqual(batched.data.cannons,['alpha','beta']);
  assert.ok(batched.data.topics.includes('cannons'));
  app.updates.publish('cannons','alpha');app.updates.publish('cannons');
  const all=await stream.next('change',d=>d.topics.includes('cannons'));
  assert.equal(all.data.cannons,undefined,'a full invalidation must not be narrowed by a named one');
});

test('domain blueprint writes and completed background snapshots publish fresh-data notifications', async t=>{
  const {app,origin,headers}=await fixture(t);
  const stream=await subscribe(origin,headers);t.after(()=>stream.abort());await stream.next('sync');
  const bp=app.campus.saveVersion({fileName:'house.nbt',origin:[0,0,0],bytes:structureNbt([2,2,2],[{pos:[1,1,1],name:'minecraft:stone'}]),via:'api'});
  assert.equal(bp.version.version,1);
  const changed=await stream.next('change',d=>d.topics.includes('blueprints'));
  assert.ok(changed.data.topics.includes('cannons'));assert.equal(changed.data.cannons,undefined);
  const result=await app.campus.capture({source:'live',force:true});
  assert.equal(result.skipped,false);
  const snapshot=await stream.next('change',d=>d.topics.includes('snapshots'));
  assert.ok(snapshot.data.topics.includes('cannons'));
  assert.equal(app.campus.latestSnapshot('live').id,result.snapshot.id,'event follows committed snapshot');
  assert.equal((await app.campus.capture({source:'live'})).skipped,true);
  await assert.rejects(stream.next('change',d=>d.topics.includes('snapshots'),120),/Timed out/);
});

test('revoked token and expired session lose their open stream before receiving another change', async t=>{
  const {app,origin,headers,read,session}=await fixture(t);
  const cookieStream=await subscribe(origin,headers),tokenStream=await subscribe(origin,{authorization:'Bearer '+read});
  t.after(()=>{cookieStream.abort();tokenStream.abort();});
  await cookieStream.next('sync');await tokenStream.next('sync');
  app.campus.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE token_hash=?").run(sha256(session));
  app.campus.db.prepare("UPDATE api_tokens SET revoked_at='2026-01-01T00:00:00Z' WHERE token_hash=?").run(sha256(read));
  app.updates.publish('cannons','alpha');
  await Promise.all([cookieStream.next('auth'),tokenStream.next('auth')]);
  await Promise.all([cookieStream.end,tokenStream.end]);
  assert.equal(cookieStream.events.some(e=>e.type==='change'),false);
  assert.equal(tokenStream.events.some(e=>e.type==='change'),false);
});

test('loss of a computer heartbeat invalidates its online state without browser polling', async t=>{
  const {app,origin,headers,station}=await fixture(t);
  await app.inject({method:'POST',url:'/api/cannons/quiet/status',headers:{authorization:'Bearer '+station},payload:{state:'waiting',assignment:1}});
  const stream=await subscribe(origin,headers);t.after(()=>stream.abort());await stream.next('sync');
  await stream.next('heartbeat');
  stream.events.length=0;
  app.campus.db.prepare('UPDATE cannons SET last_seen_at=? WHERE name=?').run(new Date(Date.now()-4*60_000).toISOString(),'quiet');
  const offline=await stream.next('change',d=>d.topics.includes('cannons'));
  assert.deepEqual(offline.data.cannons,['quiet']);
});

test('server shutdown ends an open event stream without waiting for its client to disconnect', async t=>{
  const {app,origin,headers}=await fixture(t);
  const stream=await subscribe(origin,headers);t.after(()=>stream.abort());await stream.next('sync');
  let timer;
  try {
    await Promise.race([app.close(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shutdown hung on SSE request')),1000);})]);
    await stream.end;
  } finally { clearTimeout(timer); }
});

test('a native-operation guard blocks all blueprint mutation entrypoints without partial writes or events', async t=>{
  const {app}=await fixture(t), campus=app.campus;
  const bytes=structureNbt([2,2,2],[{pos:[1,1,1],name:'minecraft:stone'}]);
  campus.saveVersion({fileName:'locked.nbt',origin:[0,0,0],bytes,via:'api'});
  campus.saveVersion({fileName:'locked.nbt',origin:[1,0,0],bytes,via:'api'});
  const before=campus.getBlueprint('locked');
  const files=readdirSync(join(campus.config.dataDir,'blueprints','locked'));
  let changes=0;campus.events.on('change',()=>changes++);
  campus.assertBlueprintWritable=id=>{if(id==='locked')throw new HttpError(409,'Native action in progress');};
  for(const write of [
    ()=>campus.saveVersion({fileName:'locked.nbt',origin:[2,0,0],bytes,via:'api'}),
    ()=>campus.updateMeta('locked',{name:'Changed during native start'}),
    ()=>campus.archive('locked'),
    ()=>campus.revert('locked',1,undefined,'api'),
  ])assert.throws(write,error=>error.statusCode===409);
  assert.deepEqual(campus.getBlueprint('locked'),before);
  assert.deepEqual(readdirSync(join(campus.config.dataDir,'blueprints','locked')),files);
  assert.equal(changes,0);
  assert.equal(campus.saveVersion({fileName:'unrelated.nbt',origin:[0,0,0],bytes,via:'api'}).version.version,1);
});
