import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderCannonPicker,renderChoicePreview,cannonSelectionPayload} from '../public/assets/cannon-picker.js';
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
