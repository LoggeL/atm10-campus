import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshQueue} from '../public/assets/live-updates.js';

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
