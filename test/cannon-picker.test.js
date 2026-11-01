import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderPickerList,renderPickerButton,renderPickerMeta,updateCannonPicker,pickerChoices,filterChoices,buildFailure} from '../public/assets/cannon-picker.js';
const item={id:'open',name:'Nordhaus <West>',version:3,origin:[4,64,4],progress:62.5,built:5,total:8,remaining:3,distance:12.3,blocked:0,unsupported:0};
const station=(items=[item])=>({assignment:42,blueprint:{id:'old',version:1},blueprintChoices:{items,snapshot:{id:8,capturedAt:'2026-11-01T10:00:00Z'},excluded:{finished:2,range:3,assigned:1}}});

test('rows show render, version, progress, rest, distance and coordinates and say they build',()=>{
  const html=renderPickerList(station());
  assert.match(html,/preview.png\?version=3/);assert.match(html,/Nordhaus &lt;West&gt;/);assert.match(html,/v3/);
  assert.match(html,/aria-valuenow="62.5"/);assert.match(html,/62,5 % gebaut · 3 Blöcke offen · 12,3 Blöcke entfernt/);assert.match(html,/4 64 4/);
  assert.match(html,/>Bauen<\/button>/);assert.match(html,/aria-label="Nordhaus &lt;West&gt; jetzt vorbereiten und bauen"/);
  assert.doesNotMatch(html,/<select|<form/);
});

test('started plans come first in their own section, decided by built blocks and not by the rounded percent',()=>{
  const tiny={...item,id:'tiny',name:'Riesenturm',built:1,total:20000,progress:0},fresh={...item,id:'fresh',name:'Neubau',built:0,total:9,progress:0};
  const html=renderPickerList(station([item,tiny,fresh]));
  assert.ok(html.indexOf('Angefangen · 2')<html.indexOf('Nordhaus'));
  assert.ok(html.indexOf('Riesenturm')<html.indexOf('Noch nicht begonnen · 1'));
  assert.ok(html.indexOf('Noch nicht begonnen')<html.indexOf('Neubau'));
  assert.match(html,/Unter 0,1 % gebaut/);
  assert.doesNotMatch(renderPickerList(station([fresh])),/Angefangen/);
});

test('finished, unreachable and completed plans are never offered, and the rest is summarised',()=>{
  const c=station([item,{...item,id:'done',progress:100,remaining:0},{...item,id:'far',distance:256},{...item,id:'gone',nativeProgress:{state:'completed',percent:100}}]);
  assert.deepEqual(pickerChoices(c).map(b=>b.id),['open']);
  assert.doesNotMatch(renderPickerList(c),/data-build="(done|far|gone)"/);
  const meta=renderPickerMeta(c.blueprintChoices,()=> 'vor 2 Minuten');
  assert.match(meta,/2 fertig/);assert.match(meta,/Weltabgleich vor 2 Minuten/);
  assert.match(renderPickerButton(c),/Bauplan ändern · 1 baubar/);
  assert.match(renderPickerButton({...c,done:true}),/Nächsten Bauplan wählen/);
  assert.match(renderPickerButton({...c,blueprint:null}),/Bauplan wählen/);
});

test('native job progress stays apart from the world snapshot and is never added to built blocks',()=>{
  const native={state:'finishing',percent:99.9,sent:3,total:3,fresh:true};
  const html=renderPickerList(station([{...item,nativeProgress:native}]));
  assert.match(html,/62,5 % gebaut/);assert.match(html,/Auftrag 99,9 % · Kanone/);assert.doesNotMatch(html,/100 %/);
  assert.match(renderPickerList(station([{...item,nativeProgress:{...native,fresh:false}}])),/letzter Stand, nicht live/);
});

test('search matches name and id, ignores case and explains an empty result',()=>{
  const items=[item,{...item,id:'turm-ost',name:'Ostflügel'}];
  assert.deepEqual(filterChoices(items,'  NORD ').map(b=>b.id),['open']);
  assert.deepEqual(filterChoices(items,'turm').map(b=>b.id),['turm-ost']);
  assert.equal(filterChoices(items,'').length,2);
  assert.match(renderPickerList(station(items),{query:'<x>'}),/Kein Bauplan passt zu „&lt;x&gt;“/);
  assert.match(renderPickerList({blueprintChoices:{items:[],message:'Keine Position.'}}),/Keine Position\./);
});

test('rows mark the current job, the running selection and the one to retry',()=>{
  const c=station();c.blueprint={id:'open',version:3};
  assert.match(renderPickerList(c),/Aktueller Auftrag/);
  assert.match(renderPickerList(c,{pending:'open:3',disabled:true}),/disabled>Startet …/);
  assert.match(renderPickerList(c,{retry:'open:3'}),/>Erneut versuchen</);
});

test('live refresh of a protected card only updates the button text',()=>{
  const button={textContent:'alt'};
  updateCannonPicker({querySelector:()=>button},station([item,{...item,id:'two'}]));
  assert.equal(button.textContent,'Bauplan ändern · 2 baubar');
  updateCannonPicker({querySelector:()=>null},station());
});

test('failure text says what really happened at each stage',()=>{
  const error=(stage,status=409)=>Object.assign(new Error('Grund.'),{status,data:{stage}});
  assert.match(buildFailure(error('check')),/^Nichts geändert: Grund\./);
  assert.match(buildFailure(error('prepare')),/^Bauplan zugewiesen, aber nicht gestartet/);
  assert.match(buildFailure(error('start')),/^Bauplan vorbereitet, Start nicht bestätigt/);
  assert.match(buildFailure(new Error('Failed to fetch')),/ist offen/);
});
