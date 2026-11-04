import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preparedBlueprints,filterPreparedBlueprints,architectureBlueprints,projectBlueprintPreview} from '../public/assets/project-blueprints.js';
import {zipStore,storedZipEntry} from '../src/zip.js';

test('project blueprint listing preserves distinct anchors, versions, cannon and package downloads',()=>{
 const file=(tile,origin)=>({tile,fileName:`EREBOR_STEIN_K19_${tile}_V6.nbt`,origin,cannon:'K19',cannonPosition:[-1152,96,448],blocks:48});
 const packages=[{cannon:'K19',part:1,version:6,files:[file('X27_Z15_H00',[-986,-40,426])],sourceRegions:[]},{cannon:'K19',part:2,version:6,files:[file('X26_Z15_H00',[-1050,-40,426])],sourceRegions:[]}];
 const rows=preparedBlueprints({id:'erebor'},packages);assert.equal(rows.length,2);assert.equal(new Set(rows.map(b=>b.id)).size,2);
 assert.deepEqual(rows[0].origin,[-986,-40,426]);assert.deepEqual(rows[0].cannonPosition,[-1152,96,448]);
 assert.equal(rows[1].download,'/api/projects/erebor/stone/prepared/K19/2/X26_Z15_H00.nbt?version=6');
 assert.match(projectBlueprintPreview(rows[1]),/\/api\/projects\/erebor\/stone\/prepared\/K19\/2\/X26_Z15_H00\/preview.png\?version=6/);
 assert.deepEqual(filterPreparedBlueprints(rows,'-1050'),[rows[1]]);assert.deepEqual(filterPreparedBlueprints(rows,'K19','K19:1'),[rows[0]]);assert.equal(filterPreparedBlueprints(rows,'nothing').length,0);
});

test('architecture images keep their package, file, project version and design revision',()=>{
 const [row]=architectureBlueprints({id:'erebor'},[{id:'E30_001',version:7,revision:2,title:'Archiv',group:'E30',files:[{id:'EREBOR_E30_BUILD',kind:'build',cannon:'K19',origin:[-1200,88,500]}]}]);
 const html=projectBlueprintPreview(row,{size:'large',eager:true});
 assert.match(html,/architecture\/E30_001\/EREBOR_E30_BUILD\/preview.png\?version=7&amp;revision=2/);
 assert.match(html,/loading="eager"/);assert.doesNotMatch(html,/project-blocks\/minecraft__stone/);
});

test('stored ZIP entry lookup returns only the named bytes and rejects damaged data',()=>{
 const zip=zipStore([{name:'A.nbt',data:Buffer.from([1,2,3])},{name:'B.nbt',data:Buffer.from([7,8,9])}]);
 assert.deepEqual(storedZipEntry(zip,'B.nbt'),Buffer.from([7,8,9]));assert.equal(storedZipEntry(zip,'missing.nbt'),null);
 const broken=Buffer.from(zip);broken[35]^=1;assert.throws(()=>storedZipEntry(broken,'A.nbt'),/Prüfsumme/);
 assert.throws(()=>storedZipEntry(zip.subarray(0,12),'A.nbt'),/Header/);
});
