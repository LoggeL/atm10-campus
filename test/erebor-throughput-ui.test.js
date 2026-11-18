import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('Bauzähler renderer labels measured coverage and per-job ETA; refresh failure clears throughput',async()=>{
 const elements=Object.fromEntries(['#status','#throughput','#totals','#stations','#refresh','#throughput details'].map(id=>[id,{innerHTML:'',addEventListener(){}}]));
 let fail=false;const timers=[];
 const throughput={at:Date.now(),blocksPerSecond:2,blocksPerHour:7200,covered:1,assigned:2,cannons:[{station:'K01',file:'<unsafe>',blocksPerSecond:2,blocksPerHour:7200,delta:40,seconds:20,remaining:860,etaSeconds:430}]};
 const context=vm.createContext({Date,Set,Number,Object,String,Math,Error,setInterval(fn){timers.push(fn);},document:{querySelector:id=>elements[id],querySelectorAll:()=>[]},fetch:async()=>{if(fail)throw Error('offline');return {ok:true,json:async()=>({throughput,stations:{},stages:{},capturedAt:Date.now(),version:12})};}});
 vm.runInContext(readFileSync(new URL('../public/assets/erebor-bauzaehler.js',import.meta.url),'utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(elements['#throughput'].innerHTML,/Gemessener Blockdurchsatz/);
 assert.match(elements['#throughput'].innerHTML,/1 \/ 2 zugewiesene/);
 assert.match(elements['#throughput'].innerHTML,/Restzeit aktueller Auftrag: 8 min/);
 assert.match(elements['#throughput'].innerHTML,/&lt;unsafe&gt;/);
 fail=true;await timers[1]();
 assert.match(elements['#throughput'].innerHTML,/unbekannt Blöcke\/s/);
 assert.match(elements['#status'].textContent,/fehlgeschlagen/);
});
