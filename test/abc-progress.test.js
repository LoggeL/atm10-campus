import test from 'node:test';
import assert from 'node:assert/strict';
import {cannonProgressRows} from '../src/cannon-progress-rows.js';
import {renderCannonStrip} from '../public/assets/erebor-queue.js';
test('missing telemetry timestamp is unknown, never live',()=>{
 const html=renderCannonStrip([{station:'K01',live:{state:'RUNNING',placed:3,total:10}}],'K01');
 assert.ok(!html.includes('aria-valuenow'));
});
test('stale, absent and zero-total telemetry stays unknown without NaN',()=>{
 const rows=[{station:'K01',live:{at:Date.now()-46000,state:'RUNNING',placed:5,total:10}},{station:'K01B',live:{at:Date.now(),state:'RUNNING',placed:0,total:0}}];
 const html=renderCannonStrip(rows,'K01');
 assert.equal((html.match(/Unbekannt/g)||[]).length,3);
 assert.ok(!/NaN|Infinity|aria-valuenow/.test(html));
});
test('maps native station IDs only to their loaded assignment, never another site',()=>{
 const job=file=>({loaded:true,desired:{file,blueprint:file}});
 const mains=[{site:'K01',job:job('a')}];
 const helpers=[{site:'K02',slot:'B',job:job('wrong')},{site:'K01',slot:'B',job:job('b')},{site:'K01',slot:'C',job:job('c')}];
 const report={at:Date.now(),stations:{K01:{upload:'a',placed:1,total:11},K01B:{upload:'b',placed:2,total:22},K01C:{upload:'other',placed:3,total:33}}};
 const rows=cannonProgressRows(mains,helpers,report);
 assert.deepEqual(rows.map(r=>[r.station,r.file,r.live?.placed]),[['K01','a',1],['K01B','b',2],['K01C','c',undefined]]);
 assert.ok(cannonProgressRows(mains,helpers,null).every(r=>r.live===null));
});
test('compact strip maps independent A B C counters and escapes plan names',()=>{
 const at=Date.now();
 const rows=['K01','K01B','K01C'].map((station,i)=>({station,site:'K01',slot:'ABC'[i],file:i===1?'<img>':'plan'+i,live:{at,state:'RUNNING',placed:(i+1)*10,total:100+i}}));
 const html=renderCannonStrip(rows,'K01');
 for(const text of ['A','B','C','10 / 100','20 / 101','30 / 102','&lt;img&gt;'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('<img>'));
 assert.equal((html.match(/role="progressbar"/g)||[]).length,3);
});
