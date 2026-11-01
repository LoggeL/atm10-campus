import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {connectPolling} from '../public/assets/live-updates.js';

function events() {
  const listeners=new Map();
  return {addEventListener(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},emit(name,event={}){for(const fn of listeners.get(name)||[])fn(event);}};
}
const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function setup(refresh=()=>true,{immediate=false}={}) {
  let clock=1000,ticker=null;const states=[],calls=[],doc={...events(),hidden:false},win=events();
  const client=connectPolling({refresh:reason=>{calls.push({reason,at:clock});return refresh(reason);},onState:s=>states.push(s),immediate,
    documentImpl:doc,windowImpl:win,now:()=>clock,setTicker:fn=>{ticker=fn;return 1;},clearTicker:()=>ticker=null});
  return {client,states,calls,doc,win,get latest(){return states.at(-1);},async advance(ms){clock+=ms;ticker?.();await settle();}};
}

test('visible polling has a 30-second countdown and a manual refresh resets the same clock',async()=>{
  const h=setup();assert.equal(h.calls.length,0);assert.equal(h.latest.remainingSeconds,30);
  await h.client.refreshNow('navigation');assert.equal(h.calls.length,1);assert.equal(h.latest.lastUpdatedAt,1000);
  await h.advance(29000);assert.equal(h.calls.length,1);assert.equal(h.latest.remainingSeconds,1);
  assert.ok(h.latest.progress>0.96);
  await h.advance(1000);assert.equal(h.calls.length,2);assert.equal(h.calls[1].reason,'timer');
  await h.advance(10000);await h.client.refreshNow();assert.equal(h.calls.length,3);assert.equal(h.latest.remainingSeconds,30);
  await h.advance(20000);assert.equal(h.calls.length,3,'the old timer does not trigger a second refresh');h.client.close();
});

test('slow reads, repeated manual clicks and missed intervals never pile up requests',async()=>{
  let release;const h=setup(()=>new Promise(resolve=>release=resolve));
  const first=h.client.refreshNow();await settle();assert.equal(h.latest.phase,'refreshing');
  assert.equal(h.client.refreshNow(),first);
  await h.advance(120000);assert.equal(h.calls.length,1);
  release(true);await first;assert.equal(h.latest.remainingSeconds,30);
  await h.advance(29000);assert.equal(h.calls.length,1);h.client.close();
});

test('hidden and cached tabs pause without backlog, then refresh once on return',async()=>{
  const h=setup();await h.client.refreshNow();h.doc.hidden=true;h.doc.emit('visibilitychange');
  assert.equal(h.latest.phase,'paused');await h.advance(180000);await h.client.refreshNow();assert.equal(h.calls.length,1);
  h.doc.hidden=false;h.doc.emit('visibilitychange');await settle();assert.equal(h.calls.length,2);
  h.win.emit('pagehide',{persisted:true});await h.advance(90000);assert.equal(h.calls.length,2);
  h.win.emit('pageshow',{persisted:true});await settle();assert.equal(h.calls.length,3);
  h.client.close();await h.advance(90000);h.doc.emit('visibilitychange');await settle();assert.equal(h.calls.length,3);
});

test('errors and deferred drafts preserve the last success and retry on the regular interval',async()=>{
  let outcome=true;const h=setup(()=>{if(outcome instanceof Error)throw outcome;return outcome;});
  await h.client.refreshNow();const last=h.latest.lastUpdatedAt;
  outcome=Error('Server gerade nicht erreichbar');await h.advance(30000);
  assert.equal(h.latest.phase,'error');assert.equal(h.latest.error,'Server gerade nicht erreichbar');assert.equal(h.latest.lastUpdatedAt,last);
  await h.advance(10000);assert.equal(h.calls.length,2);
  outcome=false;await h.advance(20000);assert.equal(h.latest.phase,'deferred');assert.equal(h.latest.lastUpdatedAt,last);
  outcome=true;await h.advance(30000);assert.equal(h.latest.phase,'idle');assert.ok(h.latest.lastUpdatedAt>last);h.client.close();
});

test('navigation during an active read coalesces into one read of the latest tab',async()=>{
  let release,tab='overview';const seen=[];
  const h=setup(()=>{seen.push(tab);return seen.length===1?new Promise(resolve=>release=resolve):true;});
  const first=h.client.refreshNow('navigation');await settle();tab='snapshots';h.client.refreshNow('navigation');tab='cannons';h.client.refreshNow('navigation');
  release(true);await first;await settle();assert.deepEqual(seen,['overview','cannons']);h.client.close();
});

test('app awaits only the visible tab and retains form guards, without connecting EventSource',async()=>{
  const source=readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/connectLiveUpdates|new EventSource|queueChanges/);
  const code=source.slice(source.indexOf('async function refreshVisible()'),source.indexOf('function renderPollingState('));
  const calls=[];let release;const dialog={open:false},drawer={open:false};
  const context=vm.createContext({document:{hidden:false,activeElement:{closest:()=>false}},me:{},activeTab:'cannons',
    $:id=>id==='editDialog'?dialog:drawer,
    ...Object.fromEntries(['loadStatus','loadSnapshots','loadTokens','loadActivity','loadAdmin'].map(name=>[name,async()=>calls.push(name)])),
    loadCannons:()=>{calls.push('loadCannons');return new Promise(resolve=>release=resolve);}});
  vm.runInContext(code,context);let done=false;const pending=vm.runInContext('refreshVisible()',context).then(()=>done=true);
  await settle();assert.deepEqual(calls,['loadCannons']);assert.equal(done,false,'updating lasts until the actual reads complete');release(true);await pending;
  dialog.open=true;assert.equal(await vm.runInContext('refreshVisible()',context),false);assert.equal(calls.length,1);
  dialog.open=false;context.activeTab='activity';await vm.runInContext('refreshVisible()',context);assert.deepEqual(calls,['loadCannons','loadActivity']);
});
