import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderCannonPicker,renderChoicePreview,cannonSelectionPayload,updateCannonPicker} from '../public/assets/cannon-picker.js';
const item={id:'open',name:'Nordhaus <West>',version:3,origin:[4,64,4],progress:62.5,built:5,total:8,remaining:3,distance:12.3,blocked:0,unsupported:0};
const station=()=>({assignment:42,blueprint:{id:'old',version:1},blueprintChoices:{items:[item],snapshot:{id:8,capturedAt:'2026-11-01T10:00:00Z'},excluded:{finished:2,range:3,assigned:1}}});
test('picker shows progress, remaining count, distance and pinned preview without offering existing invalid plans',()=>{
  const c=station(),html=renderCannonPicker(c,()=> 'vor 2 Minuten');
  assert.match(html,/62,5 % gebaut/);assert.match(html,/3 offen · 12,3 Blöcke/);assert.match(html,/2 fertig/);
  assert.match(html,/Weltabgleich vor 2 Minuten/);assert.doesNotMatch(html,/<option value="old"/);
  assert.match(html,/value="__current__" disabled hidden selected/);
  assert.match(html,/Nordhaus &lt;West&gt;/);
  const preview=renderChoicePreview(item);assert.match(preview,/preview.png\?version=3/);assert.match(preview,/aria-valuenow="62.5"/);
  c.blueprintChoices.items.push({...item,id:'done',progress:100,remaining:0},{...item,id:'far',distance:256});
  assert.doesNotMatch(renderCannonPicker(c,()=>''),/<option value="done"|<option value="far"/);
});
test('selection pins version and assignment, preserves unchanged jobs and allows deliberate unassignment',()=>{
  const c=station(),data=new FormData();data.set('blueprint','__current__');assert.deepEqual(cannonSelectionPayload(data,c),{});
  data.set('blueprint','open');assert.deepEqual(cannonSelectionPayload(data,c),{blueprint:'open',version:3,selection:{version:3,assignment:42}});
  c.blueprint={id:'open',version:2};assert.equal(cannonSelectionPayload(data,c).version,3,'same plan upgrades deliberately');
  c.blueprint.version=3;assert.deepEqual(cannonSelectionPayload(data,c),{});
  data.set('blueprint','');assert.deepEqual(cannonSelectionPayload(data,c),{blueprint:null});
  data.set('blueprint','missing');assert.throws(()=>cannonSelectionPayload(data,c),/nicht mehr/);
});

test('live job progress stays distinct from the world snapshot and stale reports lose the live label',()=>{
  const choice={...item,nativeProgress:{state:'finishing',percent:99.9,sent:3,total:3,fresh:true}};
  let html=renderChoicePreview(choice);
  assert.match(html,/Auftrag 99,9 % · Kanone · 3 \/ 3 Schüsse gesendet/);
  assert.match(html,/Letzte Blöcke noch unterwegs/);
  assert.match(html,/Weltabgleich: 62,5 % gebaut · 5 \/ 8 Blöcke/);
  assert.doesNotMatch(html,/100 %|8 \/ 8 Blöcke/);
  choice.nativeProgress.fresh=false;html=renderChoicePreview(choice);
  assert.match(html,/aria-valuenow="62.5"/);assert.match(html,/Auftrag 99,9 % · letzter Stand, nicht live/);
  assert.doesNotMatch(html,/· Kanone/);
  const c=station();c.blueprintChoices.items=[{...choice,nativeProgress:{...choice.nativeProgress,state:'completed'}}];
  assert.doesNotMatch(renderCannonPicker(c,()=>''),/<option value="open"/);
});

// Small DOM surface: tests verify the existing select/options survive, without a browser dependency.
function pickerFixture(c,value='open') {
  const elements=new Map(),form={dataset:{dirty:'1'},querySelector:key=>elements.get(key)};
  const select={options:[],value,get selectedOptions(){return this.options.filter(o=>o.value===this.value);},
    ownerDocument:{createElement:()=>({dataset:{}})},append(option){this.options.push(option);option.remove=()=>this.options.splice(this.options.indexOf(option),1);}};
  for(const option of [{value:'__current__',dataset:{}},{value:'',dataset:{}},...c.blueprintChoices.items.map(b=>({value:b.id,dataset:{version:String(b.version)}}))])select.append(option);
  elements.set('select[name="blueprint"]',select);
  for(const key of ['[data-choice-preview]','[data-choice-meta]','[data-choice-warning]'])elements.set(key,{});
  const summary={};const card={querySelector:key=>key==='.assignment-form'?form:key==='[data-section="assignment"] > summary'?summary:undefined};
  return {card,form,select,summary,elements};
}

test('live picker refresh preserves a valid dirty selection and its option, removes completed alternatives',()=>{
  const c=station();c.blueprintChoices.items.push({...item,id:'other'});
  const fixture=pickerFixture(c),selected=fixture.select.selectedOptions[0];
  const latest=structuredClone(c);latest.assignment=99;latest.blueprintChoices.items=[{...item,nativeProgress:{state:'active',percent:40,sent:2,total:5,fresh:true}}];
  updateCannonPicker(fixture.card,latest,()=> 'gerade eben');
  assert.equal(fixture.select.value,'open');assert.equal(fixture.select.selectedOptions[0],selected);
  assert.match(selected.textContent,/Auftrag 40 % · Kanone/);
  assert.equal(fixture.select.options.some(o=>o.value==='other'),false);
  assert.equal(fixture.form.dataset.dirty,'1');assert.equal(fixture.form.dataset.choiceInvalid,undefined);
  const data=new FormData();data.set('blueprint','open');
  assert.deepEqual(cannonSelectionPayload(data,c,{catalog:latest.blueprintChoices,version:selected.dataset.version}),{blueprint:'open',version:3,selection:{version:3,assignment:42}},'new live reads never advance the saved assignment baseline');
});

test('completed or superseded draft is removed immediately and remains invalid across later live updates',()=>{
  const c=station(),fixture=pickerFixture(c),latest=structuredClone(c);latest.blueprintChoices.items=[];
  updateCannonPicker(fixture.card,latest,()=> 'jetzt');
  assert.equal(fixture.select.value,'__current__');assert.equal(fixture.select.options.some(o=>o.value==='open'),false);
  assert.equal(fixture.form.dataset.dirty,'1');assert.equal(fixture.form.dataset.choiceInvalid,'1');
  assert.match(fixture.elements.get('[data-choice-warning]').textContent,/inzwischen fertig oder nicht mehr baubar/);
  updateCannonPicker(fixture.card,latest,()=> 'jetzt');
  assert.equal(fixture.form.dataset.choiceInvalid,'1');
  const versionFixture=pickerFixture(c);latest.blueprintChoices.items=[{...item,version:4}];
  updateCannonPicker(versionFixture.card,latest,()=> 'jetzt');
  assert.equal(versionFixture.select.value,'__current__','a new version must never silently replace the selected draft');
  const data=new FormData();data.set('blueprint','open');
  assert.throws(()=>cannonSelectionPayload(data,c,{catalog:latest.blueprintChoices,version:3}),/nicht mehr/);
});
