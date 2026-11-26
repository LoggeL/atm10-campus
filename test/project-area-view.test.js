import test from 'node:test';
import assert from 'node:assert/strict';
import {projectArea} from '../public/assets/project-areas.js';
import {fixture} from './watercity-fixture.js';

import {renderWatercity} from '../public/assets/watercity-view.js';

test('retained slot renderer uses project section/card grid and stable map deep links',()=>{
 const data={groups:[{id:'P01',computerId:92,commissioned:true,chest:[1,2,3]},{id:'P02',commissioned:false}],slots:[{key:'P01A',site:'P01',position:[1,2,3],assignment:null,observation:null}]};
 const html=renderWatercity(data);
 assert.match(html,/project-cards/);
 assert.match(html,/project-card/);
 assert.match(html,/id="slot-P01A"/);
 assert.match(html,/P02 · Nicht in Betrieb/);
 assert.match(html,/aktueller Zustand unbekannt/);
});
test('area map markup reuses the project map controls and exposes the area outside the mountain viewport',async()=>{
 const {projectMapBody}=await import('../public/assets/project-map-view.js');
 const html=projectMapBody(project,projectArea('wasserstadt'));
 for(const id of ['floor','zoom','mapDrawing','roomInfo'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/data-zone="E25"/);
 assert.match(html,/data-zone="E26"/);
 assert.doesNotMatch(html,/id="mapScope"/);
 const parent=projectMapBody({...project,plan:{...project.plan,styles:[],levels:[],cannonLayout:{stations:[]}}});
 assert.match(parent,/value="wasserstadt"/);
 assert.match(parent,/href="\/projects\?id=erebor&amp;area=wasserstadt#layout"/);
});
const project={id:'erebor',version:12,plan:{zones:[{id:'E25',title:'Esgaroth',bounds:[[0,0,0],[30,30,30]],floors:[0]},{id:'E26',title:'Brücke',bounds:[[0,0,0],[30,30,30]],floors:[0]}]}};
test('scoped shared home links only actual E25/E26 packages and valid viewer rooms, retaining all six historical cards',async()=>{
 const {areaHome}=await import('../public/assets/project-area-view.js');
 const area=projectArea('wasserstadt');
 const file={id:'E25_F1',fileName:'E25_F1.nbt',origin:[1,2,3],cannon:'AP1040',kind:'build',blocks:1040};
 const packages=[{id:'E25_001',title:'Stadt',group:'E25',version:12,revision:5,files:[file]}, {id:'E26_001',title:'Brücke',group:'E26',version:12,revision:5,files:[]}, {id:'E02_001',title:'Tor',group:'E02',version:12,revision:5,files:[file]}];
 const html=areaHome({project,area,architecture:{baseVersion:12,packages},mapHtml:'<svg id="test-map"></svg>'});
 assert.match(html,/class="project-hero"/);
 assert.match(html,/class="project-nav"/);
 assert.match(html,/id="layout"/);
 assert.match(html,/id="plans"/);
 assert.match(html,/id="fleet"/);
 assert.match(html,/id="wc-fleet"/);
 assert.match(html,/E25_001\/E25_F1\.nbt\?version=12&amp;revision=5/);
 assert.match(html,/project=erebor&amp;room=E25/);
 assert.match(html,/project=erebor&amp;room=E26/);
 assert.match(html,/id="test-map"/);
 assert.doesNotMatch(html,/E02_001|Bergmassiv|Reservat|Y312|\/api\/projects\/wasserstadt/);
 const stale=areaHome({project,area,architecture:{baseVersion:11,packages},mapHtml:''});
 assert.match(stale,/Veröffentlichungsstand unbekannt/);
 assert.doesNotMatch(stale,/E25_001/);
 const empty=areaHome({project,area,architecture:null,mapHtml:''});
 assert.match(empty,/Veröffentlichungsstand unbekannt/);
 assert.doesNotMatch(empty,/>0 Baupläne</);
});
