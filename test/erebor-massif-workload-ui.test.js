import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('Massiv block workload renders under Massiv and updates on the existing live refresh',async()=>{
 const nodes=new Map();const intervals=[];
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',addEventListener(){}});return nodes.get(selector);};
 let workload={grossBlocks:140,assignedBlocks:40,manualBlocks:9};
 const ledger=()=>({done:0,total:2,open:1,inProgress:1,workload});
 const context=vm.createContext({document:{querySelector:get,querySelectorAll:()=>[]},setInterval:(fn,ms)=>intervals.push({fn,ms}),Date,Number,Set,fetch:async()=>({ok:true,json:async()=>({version:12,capturedAt:new Date().toISOString(),massif:ledger(),stages:{},stations:{},unassignedMassif:ledger()})})});
 vm.runInContext(readFileSync(new URL('../public/assets/erebor-bauzaehler.js',import.meta.url),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(get('#totals').innerHTML,/140 Cleanstone-Blöcke/);
 assert.match(get('#totals').innerHTML,/Brutto-Planblöcke/);
 assert.match(get('#totals').innerHTML,/9.*Sonderziel/);
 assert.match(get('#totals').innerHTML,/nicht exakt unplatziert/);
 workload={grossBlocks:0,assignedBlocks:0,manualBlocks:0};
 await intervals.find(i=>i.ms===15000).fn();
 assert.match(get('#totals').innerHTML,/0 Cleanstone-Blöcke/);
 workload=null;await intervals.find(i=>i.ms===15000).fn();
 assert.match(get('#totals').innerHTML,/Cleanstone-Blockumfang unbekannt/);
});
