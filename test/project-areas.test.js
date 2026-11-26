import test from 'node:test';
import assert from 'node:assert/strict';

import {projectMapData, areaPackages} from '../public/assets/project-areas.js';
import {withWorldCoordinates} from '../public/assets/project-coordinates.js';

// Areas are views of an existing project, never synthetic database projects.
test('Bauprojekte lists Wasserstadt beside its real parent without inventing missing or archived scope', async () => {
  const { projectEntries, projectArea, areaFromUrl } = await import('../public/assets/project-areas.js');
  const erebor = { id:'erebor', title:'Erebor', version:12, status:'planning', archivedAt:null };
  const campus = { id:'campus', title:'Campus', version:1, archivedAt:'2026-01-01' };
  const entries = projectEntries([erebor, campus]);
  assert.deepEqual(entries.map(p=>p.area?.id || p.id), ['erebor','wasserstadt','campus']);
  assert.equal(entries[1].href, '/projects?id=erebor&area=wasserstadt');
  assert.equal(entries[1].version, 12);
  assert.equal(entries[1].area.project, 'erebor');
  assert.deepEqual(projectEntries([]), []);
  assert.equal(projectEntries([{...erebor,archivedAt:'2026-01-01'}]).length, 1);
  assert.equal(projectArea('wasserstadt').zones.join(','), 'E25,E26');
  for (const url of ['/erebor/wasserstadt','/app?project=wasserstadt','/projects?id=erebor&area=wasserstadt']) {
    assert.equal(areaFromUrl(new URL(url,'http://test')).id, 'wasserstadt');
  }
  assert.equal(areaFromUrl(new URL('http://test/projects?id=campus&area=wasserstadt')), null);
});

test('area map fits exact transformed E25/E26 geometry and retained slots, not the mountain or global counters',async()=>{
 const {projectArea}=await import('../public/assets/project-areas.js');
 const project={id:'erebor',plan:withWorldCoordinates({worldOrigin:[10,88,-10000],rotationDegrees:90,envelope:{worldBounds:[[-1000,0,-12000],[500,312,-9000]]},levels:[{y:-20},{y:0},{y:100}],cannonLayout:{stations:[{position:[-900,200,-11000]}]},zones:[
  {id:'E02',bounds:[[0,0,0],[20,48,20]],floors:[0]},
  {id:'E25',bounds:[[-894,-46,344],[-534,44,824]],floors:[-20,-14]},
  {id:'E26',bounds:[[-743,-44,184],[-686,-4,833]],floors:[-20,-14]},
 ]})};
 const area=projectArea('wasserstadt');
 const data=projectMapData(project,area,[{key:'P01A',position:[959,192,-9279]}]);
 assert.deepEqual(data.zones.map(z=>z.id),['E25','E26']);
 assert.deepEqual(data.boxes[0],[[354,42,-9466],[834,132,-9106]]);
 assert.equal(data.boxes.length,3);
 assert.deepEqual(data.stations,[]);
 assert.deepEqual(data.levels.map(l=>l.y),[-20,-14]);
 assert.ok(projectMapData(project).stations.length);
 assert.deepEqual(areaPackages([{group:'E02'},{group:'E25'},{group:'E26'},{group:'E01',finishing:true}],area).map(p=>p.group),['E25','E26']);
 assert.deepEqual(projectMapData({plan:{zones:[]}},area).boxes,[]);
});
