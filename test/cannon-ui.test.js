import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCannon, cannonSettingsPayload, cannonStartState, cannonLocation, renderCannonProgress, updateCannonLive } from '../public/assets/cannon-ui.js';
import { DEFAULT_OPTIONS } from '../src/api-stations.js';

const station = () => ({ name:'kanone-11', assignment:17, online:true, state:'feeding', options:{...DEFAULT_OPTIONS},
  alignment:{enabled:true}, schematic:{settings:{enabled:true,autoUpdate:true,replaceMode:2,skipMissing:false,protectBlockEntities:true},job:{state:'ready',version:2}},
  blueprint:{id:'west',name:'Nordhaus West',origin:[42,63,-27],version:2,currentVersion:2},
  range:{state:'inrange',distance:71,limit:256,origin:[42,63,-27],version:2},
  totals:{start:100,needed:50,kinds:3}, status:{state:'feeding',script:'1.2.0'} });
function values(c) {
  const data = new FormData();
  for (const [key,value] of Object.entries(c.options)) if (typeof value !== 'boolean' || value) data.set('o_'+key,String(value));
  for (const [key,value] of Object.entries(c.schematic.settings)) if (typeof value !== 'boolean' || value) data.set('s_'+key,String(value));
  return data;
}
const render = (c, isAdmin = true) => renderCannon(c, [['west','Nordhaus West']], {isAdmin, alignmentHtml:'', ago:()=>'gerade eben'});

test('saving unchanged settings is a no-op; feeder edits never resend the schematic', () => {
  const c = station(), data = values(c);
  assert.deepEqual(cannonSettingsPayload(data,c,true), {});
  data.set('o_autoCraft','on'); data.set('o_bufferStacks','4');
  assert.deepEqual(cannonSettingsPayload(data,c,true), {options:{autoCraft:true,bufferStacks:4}});
  assert.equal(c.options.autoCraft, false, 'collecting a draft does not mutate its saved baseline');
});
test('unchecked options are explicit false and multiple edits are collected in one request', () => {
  const c = station(), data = values(c);
  data.delete('o_returnLeftovers'); data.set('o_paused','on'); data.delete('s_enabled'); data.set('s_replaceMode','1');
  assert.deepEqual(cannonSettingsPayload(data,c,true), {options:{paused:true,returnLeftovers:false},schematic:{enabled:false,replaceMode:1}});
});
test('members cannot edit bound cannons; unbound member edits omit privileged schematic settings', () => {
  const c = station(), data = values(c);
  assert.throws(() => cannonSettingsPayload(data,c,false), /Admin/);
  c.alignment = {enabled:false}; data.set('o_autoCraft','on'); data.delete('s_enabled');
  assert.deepEqual(cannonSettingsPayload(data,c,false), {options:{autoCraft:true}});
  assert.deepEqual(cannonSettingsPayload(data,c,true), {options:{autoCraft:true}});
  assert.match(render(station(),false), /class="cannon-settings"><fieldset disabled/);
  assert.doesNotMatch(render(station(),false), /data-act="prepare"|data-act="choose"/);
});
test('invalid or absent quantities and unsafe replacement modes never form a request', () => {
  const c = station();
  for (const invalid of ['', 'NaN', '0', '17', '2.5']) {
    const data = values(c); data.set('o_bufferStacks',invalid);
    assert.throws(() => cannonSettingsPayload(data,c,true), /gültige Mengen/);
  }
  const data = values(c); data.set('s_replaceMode','3');
  assert.throws(() => cannonSettingsPayload(data,c,true), /Ersetzungsmodus/);
});
test('server-side blocks stay prominent even if the computer reports feeding', () => {
  const c = station(); c.state='alignment'; c.message='Kanone läuft mit einer anderen Ausrichtung.';
  const html = render(c);
  assert.match(html,/Material gesperrt/);
  assert.match(html,/class="notice" role="status">Kanone läuft/);
  assert.doesNotMatch(html,/>Aktiv</);
});
test('out-of-range transfer is retained for admins and escaped; pending target versions are distinguished', () => {
  const c = station(); c.state='outofrange'; c.range={...c.range,state:'outofrange',distance:300,version:3,origin:[500,63,-27],candidates:[{name:'free<script>',availability:'free',distance:3,position:[500,64,-27],assignment:8}]};
  const html = render(c);
  assert.match(html,/data-act="transfer"/);
  assert.match(html,/Für v3: 500 63 -27/);
  assert.match(html,/\/api\/blueprints\/west\/preview\.png\?version=2/);
  assert.match(html,/free&lt;script&gt;/);
  assert.doesNotMatch(render(c,false),/data-act="transfer"/);
});
test('station names, plan names and job errors cannot inject markup into forms', () => {
  const c = station(); c.name='<script>';c.blueprint.name='" onmouseover="bad';c.schematic.job={state:'error',message:'<img src=x onerror=bad>'};
  const html = render(c);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;img/);
  assert.match(html,/&quot; onmouseover=&quot;/);
});

test('web start requires a live verified automatic plan and distinguishes running and paused native states', () => {
  const c=station();c.alignment={enabled:true,state:'aligned',observed:{state:'STOPPED'}};
  assert.deepEqual(cannonStartState(c,true),{visible:true,enabled:true,label:'Kanone starten',reason:''});
  assert.match(render(c),/data-act="start" title=/);
  assert.doesNotMatch(render(c,false),/data-act="start"/);
  c.alignment.observed.state='PAUSED';assert.equal(cannonStartState(c,true).label,'Fortsetzen');assert.equal(cannonStartState(c,true).enabled,true);
  c.alignment.observed.state='RUNNING';assert.equal(cannonStartState(c,true).label,'Läuft');assert.equal(cannonStartState(c,true).enabled,false);
  c.alignment.observed.state='STOPPED';
  for(const change of [c=>c.online=false,c=>c.range.state='outofrange',c=>c.schematic.job.state='waiting',c=>c.schematic.job.version=1,c=>c.alignment.state='mismatch',c=>c.options.paused=true,c=>c.done=true]){
    const unsafe=structuredClone(c);change(unsafe);assert.equal(cannonStartState(unsafe,true).enabled,false);assert.match(render(unsafe),/data-act="start" disabled/);
  }
});

test('automatic location failures show a retry while explicit schematic auto-off stays optional', () => {
  const c=station();c.schematic.settings.enabled=false;c.alignment={enabled:false};
  assert.match(render(c),/Kanonen-Position noch nicht ermittelt/);assert.match(render(c),/data-act="discover"/);
  assert.doesNotMatch(render(c),/Manuell einsetzen|data-act="start"|data-act="open-binding"/);
  c.alignment.enabled=true;assert.match(render(c),/Automatische Vorbereitung ist aus/);assert.match(render(c),/data-act="open-settings"/);
});

test('automatic detection is only claimed for an actual verified binding and does not enable start by itself', () => {
  const c=station();c.alignment={enabled:false,binding:null,discovery:{automatic:true,state:'found'}};
  assert.doesNotMatch(render(c),/Automatisch erkannt/);
  assert.equal(cannonStartState(c,true).enabled,false);
  c.alignment={enabled:true,state:'aligned',observed:{state:'STOPPED'},binding:{x:94,y:64,z:21},discovery:{automatic:true,state:'bound'}};
  assert.match(render(c),/Automatisch erkannt/);assert.match(render(c),/X 94 · Y 64 · Z 21/);
  assert.equal(cannonStartState(c,true).enabled,true);
  c.alignment.discovery={automatic:true,state:'ambiguous',message:'Zuordnung inzwischen unklar.'};
  assert.match(render(c),/Zuordnung inzwischen unklar/);assert.match(render(c),/data-act="discover"/);assert.doesNotMatch(render(c),/Automatisch erkannt/);
  assert.equal(cannonStartState(c,true).enabled,false);
  delete c.alignment.discovery;assert.equal(cannonLocation(c).label,'Position gespeichert');
  c.alignment.binding.x='94';assert.equal(cannonLocation(c).binding,null);
});

test('pending discovery stays quiet; unresolved reasons are escaped and retriable only by admins', () => {
  const c=station();c.alignment={enabled:false,discovery:{automatic:true,state:'pending'}};c.range.state='unbound';
  assert.match(render(c),/automatisch gesucht/);assert.doesNotMatch(render(c),/data-act="discover"|<dt>Reichweite/);
  for(const state of ['missing','ambiguous','unsupported','offline','blocked','error']) {
    c.alignment.discovery={automatic:true,state,message:'Kein Treffer <script>'};
    assert.match(render(c),/Kein Treffer &lt;script&gt;/);assert.match(render(c),/data-act="discover"/);
    assert.doesNotMatch(render(c,false),/data-act="discover"/);assert.doesNotMatch(render(c),/Automatisch erkannt/);
  }
});

test('native shots drive live progress without adding them to world snapshot material totals',()=>{
  const c=station();c.nativeProgress={state:'active',sent:1,total:4,percent:25,fresh:true};
  assert.match(renderCannonProgress(c),/Auftrag 25 % · Kanone · 1 \/ 4 Schüsse gesendet/);
  assert.doesNotMatch(renderCannonProgress(c),/50 %|75 %|Items/);
  c.nativeProgress={...c.nativeProgress,state:'finishing',percent:100,sent:4};
  assert.match(renderCannonProgress(c),/Auftrag 99,9 % · Kanone/);assert.match(renderCannonProgress(c),/noch unterwegs/);
  c.nativeProgress={...c.nativeProgress,state:'completed',sent:3};c.done=true;
  assert.match(renderCannonProgress(c),/Auftrag 100 % · Kanone/);assert.equal(cannonStartState(c,true).label,'Fertig');
  assert.doesNotMatch(renderCannonProgress(c),/3 \/ 4|Schüsse gesendet/,'the last pre-reset sample is not a final sent count');
  c.nativeProgress.fresh=false;
  assert.match(renderCannonProgress(c),/Weltabgleich: 50 % · noch 50 Items/);
  assert.match(renderCannonProgress(c),/Auftrag 100 % · letzter Stand, nicht live/);
  c.nativeProgress={state:'active',sent:0,total:null,percent:null,fresh:true};
  assert.match(renderCannonProgress(c),/Fortschritt unbekannt/);assert.doesNotMatch(renderCannonProgress(c),/aria-valuenow|NaN/);
});

test('partial live rendering touches status slots only, including during an in-flight mutation',()=>{
  const c=station();c.state='done';c.done=true;c.nativeProgress={state:'completed',sent:4,total:4,percent:100,fresh:true};
  const progress={},supply={},start={innerHTML:'in-flight button',querySelector:()=>null};
  const schematic={};
  const slots={'[data-cannon-progress]':progress,'[data-cannon-state]':supply,'[data-cannon-start]':start,'[data-cannon-schematic]':schematic};
  const card={querySelector:key=>{assert.ok(key in slots,'forms and editable controls are never replaced');return slots[key];}};
  updateCannonLive(card,c,{isAdmin:true,busy:true});
  assert.match(progress.innerHTML,/100 % · Kanone/);assert.equal(supply.textContent,'Fertig');assert.equal(schematic.textContent,'Auftrag abgeschlossen · v2');assert.equal(start.innerHTML,'in-flight button');
  updateCannonLive(card,c,{isAdmin:true});assert.match(start.innerHTML,/data-act="start" disabled/);
});
