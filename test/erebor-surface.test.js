import test from 'node:test';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {Region} from '../src/region.js';
import {buildSurfacePart,summitHeight} from '../src/erebor-surface.js';
import {loadModel} from '../src/structure-edit.js';
import {storedZipEntry} from '../src/zip.js';
import {readySurface} from '../src/erebor-landscape-work.js';
test('only an untouched, matching and fueled additive plan qualifies for priority inspection',()=>{
 const desired={file:'campus_test.nbt',owner:'Erebor',anchor:[32,64,96],options:{replace_mode:0,skip_missing:false,replace_block_entities:false}};
 const job={phase:'build',surface:true,desired,size:[32,32,32],loaded:false};
 const signal={state:'PAUSED',status:'ready',ready:true,aligned:true,fuel:1,placed:0,
  owner:desired.owner,upload:desired.file,anchor:desired.anchor,size:job.size,options:[0,false,false]};
 const report={ereborProjectWork:1,surfaceModeTracker:1,stations:{K01B:signal}};
 assert.ok(readySurface(job,report,'K01B'));
 assert.ok(!readySurface(job,{...report,surfaceModeTracker:0},'K01B'));
 for(const change of [{options:[2,false,false]},{anchor:[0,0,0]},{upload:'other'},{fuel:0},{placed:1},{status:'missingBlock'}])
  assert.ok(!readySurface(job,{...report,stations:{K01B:{...signal,...change}}},'K01B'));
 for(const change of [{started:true},{tainted:true},{surface:false}])assert.ok(!readySurface({...job,...change},report,'K01B'));
});
test('additive summit preserves occupied columns and emits only surveyed blocks above the stone profile',t=>{
 const plan={worldOrigin:[500,88,500],mountainFill:{peak:[0,232,0],bounds:[[-32,-40,-32],[32,313,32]],roofReserves:[],protectedBoxes:[]},zones:[],cannonLayout:{stations:[]}};
 const draft={summit:[0,319,0],profile:[[-20,250],[0,319],[20,250]]};
 t.mock.method(Region,'open',()=>({chunk:(cx,cz)=>cx===0&&cz===0?{Status:'full',sections:[{Y:12,block_states:{palette:[{Name:'minecraft:stone'}]}}],block_entities:[{x:10,y:205,z:10}]}:null}));
 const {report,zip}=buildSurfacePart(plan,draft,{rx:0,rz:0,id:'R0_0'},tmpdir());
 assert.ok(report.unknown.length);assert.ok(report.blocks);let tip=0,seen=0;
 for(const f of report.files)for(const [k,cell] of loadModel(storedZipEntry(zip,f.fileName)).cells){
  const [x,y,z]=k.split(',').map((v,i)=>Number(v)+f.origin[i]);
  assert.ok(x<16&&z<16&&y>207&&y<=319);assert.ok(Math.abs(x-10)>2||Math.abs(z-10)>2);
  assert.ok(!['minecraft:air','minecraft:structure_void'].includes(cell.name));
  if(y===319){assert.deepEqual([x,z,cell.name],[0,0,'minecraft:snow_block']);tip++;}
  seen++;
 }
 assert.equal(tip,1);assert.equal(seen,report.blocks);assert.equal(summitHeight(draft,0,200,232),232);
});
