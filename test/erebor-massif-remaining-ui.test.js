import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEreborQueue} from '../public/assets/erebor-queue.js';

// Seam: selected-station UI rendered from the existing read-only planfolge response.
test('selected station shows unfinished Massiv tiles, falling on completion, independently of catalog and A/B/C',async()=>{
 const elements=new Map();
 const element=()=>({textContent:'',innerHTML:'',children:[],dataset:{},classList:{toggle(){}},setAttribute(){},append(...items){this.children.push(...items);}});
 const find=selector=>{if(!elements.has(selector))elements.set(selector,element());return elements.get(selector);};
 const root={querySelector:find,querySelectorAll:()=>[]};
 const prior={document:globalThis.document,location:globalThis.location,setInterval:globalThis.setInterval};
 globalThis.document={hidden:false,getElementById:()=>root,createElement:element};
 globalThis.location={href:'https://campus.example/?kanone=K01'};
 globalThis.setInterval=()=>0;
 let massif={open:9,inProgress:2,done:4};
 const data=()=>({stations:[{site:'K01'}],queue:{site:'K01',pending:[],counts:{catalog:{open:100,inProgress:3,done:7},massif}},counts:{stations:{K01:{catalog:{open:100,inProgress:3,done:7},massif}}}});
 try{
  const ui=setupEreborQueue({api:async()=>data(),admin:()=>false,active:()=>true,notify(){}});
  await ui.refresh();
  assert.equal(find('[data-massif-remaining]').textContent,'11');
  assert.equal(find('[data-open-count]').textContent,'103');
  assert.match(find('[data-cannon-strip]').innerHTML,/Kanone A/);
  assert.match(find('[data-cannon-strip]').innerHTML,/Kanone B/);
  assert.match(find('[data-cannon-strip]').innerHTML,/Kanone C/);
  massif={open:9,inProgress:1,done:5};
  await ui.refresh();
  assert.equal(find('[data-massif-remaining]').textContent,'10');
  massif={open:0,inProgress:0,done:15};
  await ui.refresh();
  assert.equal(find('[data-massif-remaining]').textContent,'0');
  massif=null;
  await ui.refresh();
  assert.equal(find('[data-massif-remaining]').textContent,'Unbekannt');
 }finally{Object.assign(globalThis,prior);}
});
