import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderCannon, cannonSettingsPayload, cannonStartState } from '../public/assets/cannon-ui.js';
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

test('manual schematic copy explains the missing setup and provides the appropriate action', () => {
  const c=station();c.schematic.settings.enabled=false;c.alignment={enabled:false};
  assert.match(render(c),/Kanonen-Position noch nicht bestätigt/);assert.match(render(c),/data-act="open-binding"/);
  assert.doesNotMatch(render(c),/Manuell einsetzen|data-act="start"/);
  c.alignment.enabled=true;assert.match(render(c),/Automatische Vorbereitung ist aus/);assert.match(render(c),/data-act="open-settings"/);
});
