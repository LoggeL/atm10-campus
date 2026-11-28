import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionPredecessors} from '../src/erebor-section-prerequisites.js';
test('surface waits for local published and unpublished work but not another column',()=>{
 const f={origin:[0,256,0]};
 const open=[{name:'clear',origin:[0,32,0],size:[32,32,32],stage:'clear'},{name:'other',origin:[32,32,0],size:[32,32,32],stage:'build'}];
 const missing=[{id:'E08_001',tiles:[{origin:[0,64,0],size:[32,32,32]}]}];
 assert.deepEqual(sectionPredecessors(f,open,missing),['clear','E08_001']);
 assert.deepEqual(sectionPredecessors({origin:[64,256,0]},open,missing),[]);
});
