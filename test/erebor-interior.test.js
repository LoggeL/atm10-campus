import test from 'node:test';
import assert from 'node:assert/strict';
import {Region} from '../src/region.js';
import {tileNBT} from '../src/erebor-tiles.js';
import {interiorColumns,inRange,interiorGroup,interiorWorldCheck} from '../src/erebor-interior.js';
test('interior reservation covers cross-column tiles and excludes outlying corners and outdoor groups',()=>{
 assert.deepEqual(interiorColumns([60,0,-8],[32,32,32],[0,-40,0]),[[0,-1],[0,0],[1,-1],[1,0]]);
 assert.equal(inRange([240,0,0],[32,32,32],[0,0,0]),false);
 assert.equal(interiorGroup('E25'),false);assert.equal(interiorGroup('E15'),false);assert.equal(interiorGroup('E10'),true);
});
test('interior world proof rejects unknown terrain and protects a machine just across the tile edge',t=>{
 let be=[],absent=false,block='minecraft:stone';
 t.mock.method(Region,'open',()=>({chunk:(cx,cz)=>absent?null:{xPos:cx,zPos:cz,Status:'full',sections:[{Y:0,block_states:{palette:[{Name:block}]}}],block_entities:cx===-1&&cz===0?be:[]}}));
 const cells=new Uint8Array(32768);cells[0]=1;
 const {bytes}=tileNBT([{}, {name:'minecraft:gold_block'}],cells,'surface'),args={bytes,kind:'build',anchor:[0,0,0]};
 assert.equal(interiorWorldCheck('.',args),true);
 be=[{x:-1,y:0,z:0}];assert.equal(interiorWorldCheck('.',args),false);
 be=[];block='ae2:controller';assert.equal(interiorWorldCheck('.',args),false);
 absent=true;assert.equal(interiorWorldCheck('.',args),false);
});
