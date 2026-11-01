import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the app's actual read/paint coordination with a protected card, without booting the whole app.
const source=readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
const coordination=source.slice(source.indexOf('// ---------- cannons ----------'),source.indexOf("$('showSetup').onclick"));
function appFixture() {
  let protectedCard=true,replacements=0;
  const updates=[],requests=[],reads=[];
  const old={dataset:{cannon:'test'},querySelector:()=>protectedCard?{}:null,contains:()=>false,querySelectorAll:()=>[],replaceWith:()=>{replacements++;}};
  const list={querySelectorAll:()=>[old]};
  const context=vm.createContext({me:{user:{role:'admin'}},document:{activeElement:{},createElement:()=>({content:{firstElementChild:{querySelectorAll:()=>[]}}})},
    $:id=>{assert.equal(id,'cannonList');return list;},
    api:url=>new Promise(resolve=>reads.push({url,resolve})),
    updateCannonPicker:(card,c)=>updates.push(['picker',c]),updateCannonLive:(card,c)=>updates.push(['progress',c]),
    renderCannon:()=>'<article></article>',alignmentCard:()=>'',ago:()=>'',refreshQueue:{request:key=>requests.push(key)}});
  vm.runInContext(coordination,context);
  const app=vm.runInContext('({read:refreshOneCannon,flush:flushPendingCannons,baseline:cannonBaseline,latest:cannonLatest,pending:cannonPending})',context);
  const baseline={name:'test',assignment:4,options:{gunpowder:12}};app.baseline.set('test',baseline);
  return {app,baseline,updates,requests,reads,unprotect:()=>{protectedCard=false;},replacements:()=>replacements};
}

test('refresh fetches and paints progress on a dirty card, preserving baseline and deferring full render locally',async()=>{
  const f=appFixture(),fresh={name:'test',assignment:5,nativeProgress:{state:'completed',percent:100},blueprintChoices:{items:[]}};
  const reading=f.app.read('test');assert.equal(f.reads.length,1);assert.equal(f.reads[0].url,'/api/cannons/test');
  f.reads[0].resolve(fresh);assert.equal(await reading,true,'protected card consumes the event without retrying GET');
  assert.equal(f.updates.length,2);assert.equal(f.updates[0][1],fresh);
  assert.equal(f.app.baseline.get('test'),f.baseline);assert.equal(f.app.baseline.get('test').assignment,4);
  assert.equal(f.app.latest.get('test'),fresh);assert.equal(f.app.pending.size,1);
  assert.equal(f.replacements(),0);assert.deepEqual(f.requests,[]);
  f.unprotect();f.app.flush();
  assert.equal(f.replacements(),1);assert.equal(f.app.baseline.get('test'),fresh);assert.equal(f.app.pending.size,0);
  assert.equal(f.reads.length,1,'ending a draft uses the saved read rather than polling again');
});

test('an older overlapping read cannot resurrect a completed choice in an open picker',async()=>{
  const f=appFixture(),older=f.app.read('test'),newer=f.app.read('test');
  const completed={name:'test',assignment:4,done:true,blueprintChoices:{items:[]}};
  f.reads[1].resolve(completed);await newer;
  f.reads[0].resolve({name:'test',assignment:4,done:false,blueprintChoices:{items:[{id:'finished'}]}});await older;
  assert.equal(f.app.latest.get('test'),completed);assert.equal(f.app.pending.get('test').c,completed);
  assert.equal(f.updates.length,2);assert.deepEqual(f.requests,[]);
});
