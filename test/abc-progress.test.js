import test from 'node:test';
import assert from 'node:assert/strict';
import {cannonProgressRows} from '../src/cannon-progress-rows.js';
test('maps native station IDs only to their loaded assignment, never another site',()=>{
 const job=file=>({loaded:true,desired:{file,blueprint:file}});
 const mains=[{site:'K01',job:job('a')}];
 const helpers=[{site:'K02',slot:'B',job:job('wrong')},{site:'K01',slot:'B',job:job('b')},{site:'K01',slot:'C',job:job('c')}];
 const report={at:Date.now(),stations:{K01:{upload:'a',placed:1,total:11},K01B:{upload:'b',placed:2,total:22},K01C:{upload:'other',placed:3,total:33}}};
 const rows=cannonProgressRows(mains,helpers,report);
 assert.deepEqual(rows.map(r=>[r.station,r.file,r.live?.placed]),[['K01','a',1],['K01B','b',2],['K01C','c',undefined]]);
 assert.ok(cannonProgressRows(mains,helpers,null).every(r=>r.live===null));
});
