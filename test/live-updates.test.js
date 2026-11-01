import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connectLiveUpdates,createRefreshQueue} from '../public/assets/live-updates.js';

function events() {
  const listeners = new Map();
  return {
    addEventListener(name,fn) { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn); },
    removeEventListener(name,fn) { listeners.get(name)?.delete(fn); },
    emit(name,event = {}) { for (const fn of listeners.get(name) || []) fn(event); },
  };
}
function setup() {
  const sources=[], changes=[], syncs=[], states=[], auth=[];
  let clock=0,ticker=null;
  const doc={...events(),hidden:false}, win=events();
  class Source {
    constructor(url) { Object.assign(this,events()); this.url=url; this.closed=false; sources.push(this); }
    close() { this.closed=true; }
  }
  const client=connectLiveUpdates({EventSourceImpl:Source,documentImpl:doc,windowImpl:win,now:()=>clock,
    setTicker:fn=>{ticker=fn;return 1;},clearTicker:()=>ticker=null,
    onChange:change=>changes.push(change),onSync:()=>syncs.push(clock),onState:s=>states.push(s),onAuth:()=>auth.push(true)});
  return {client,sources,changes,syncs,states,auth,doc,win,advance(ms) {clock+=ms;ticker?.();}};
}

test('live connection routes targeted changes, resyncs on reconnect and falls back only while disconnected',()=>{
  const h=setup(), source=h.sources[0];
  assert.equal(source.url,'/api/events');
  source.emit('sync');assert.equal(h.client.connected,true);assert.equal(h.syncs.length,1);
  source.emit('change',{data:JSON.stringify({topics:['cannons'],cannons:['kanone-4']})});
  assert.deepEqual(h.changes,[{topics:['cannons'],cannons:['kanone-4']}]);
  for(let i=0;i<8;i++){h.advance(15000);source.emit('heartbeat');}
  assert.equal(h.syncs.length,1,'healthy streams do not poll');
  source.emit('error');assert.equal(h.client.connected,false);
  h.advance(60000);assert.equal(h.syncs.length,2,'offline UI still gets a slow refresh attempt');
  const newer=h.sources.at(-1);newer.emit('sync');assert.equal(h.syncs.length,3);
  source.emit('error');assert.equal(h.client.connected,true,'late events from a replaced stream are ignored');
  h.client.close();
});

test('silent or rejected streams are reopened, hidden pages defer reads and cached pages reconnect',()=>{
  const h=setup(), first=h.sources[0];
  h.advance(46000);assert.equal(first.closed,true);assert.equal(h.sources.length,2,'also recovers a stream which never connected');
  h.doc.hidden=true;h.sources[1].emit('sync');h.advance(90000);
  assert.equal(h.syncs.length,0,'hidden reconnect does not fetch data');
  h.doc.hidden=false;h.doc.emit('visibilitychange');assert.equal(h.syncs.length,1);
  const previous=h.sources.at(-1);h.win.emit('pagehide',{persisted:true});assert.equal(previous.closed,true);
  h.advance(100000);assert.equal(h.sources.at(-1),previous,'suspended page opens no sockets');
  h.win.emit('pageshow',{persisted:true});assert.notEqual(h.sources.at(-1),previous);assert.equal(h.syncs.length,2);
  h.sources.at(-1).emit('sync');assert.equal(h.syncs.length,3);
  h.sources.at(-1).emit('auth');assert.deepEqual(h.auth,[true]);
  const count=h.sources.length;h.advance(100000);h.win.emit('pageshow');assert.equal(h.sources.length,count,'expired sessions stay closed');
});

function queueHarness(run,canRun=()=>true) {
  const timers=new Map();let id=0;
  const queue=createRefreshQueue({run,canRun,setTimer:fn=>{timers.set(++id,fn);return id;},clearTimer:n=>timers.delete(n)});
  return {queue, async tick() {const entry=timers.entries().next().value;if(!entry)return;timers.delete(entry[0]);await entry[1]();},timers};
}
test('burst changes coalesce and a change during an in-flight read schedules a second read',async()=>{
  const calls=[];let release;
  const h=queueHarness(async key=>{calls.push(key);if(calls.length===1)await new Promise(r=>release=r);});
  h.queue.request('cannon:4');h.queue.request('cannon:4');
  const first=h.tick();assert.deepEqual(calls,['cannon:4']);
  h.queue.request('cannon:4');h.queue.request('cannon:5');release();await first;
  await h.tick();await h.tick();assert.deepEqual(calls,['cannon:4','cannon:4','cannon:5']);h.queue.close();
});
test('draft and busy guards retain pending reads; edits begun during a request are retried',async()=>{
  let editing=true, runs=0, applied=0;
  const h=queueHarness(async()=>{runs++;if(runs===1){editing=true;return false;}applied++;},()=>!editing);
  h.queue.request('cannon:4');await h.tick();assert.equal(runs,0);
  editing=false;h.queue.resume();await h.tick();assert.equal(runs,1);assert.equal(applied,0);
  await h.tick();assert.equal(runs,1,'new edit remains untouched');
  editing=false;h.queue.resume();await h.tick();assert.equal(applied,1);
  h.queue.close();assert.equal(h.timers.size,0);
});
