import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectBlueprints} from '../public/assets/project-blueprints.js';

// Existing public response-to-render seam; no live mutation endpoints exercised.
test('regular stone catalog is collapsed fallback; architecture and active job remain visible',async()=>{
 const elements=new Map();
 const get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',querySelector:()=>null});return elements.get(id);};
 const prior={document:globalThis.document,fetch:globalThis.fetch};
 globalThis.document={getElementById:get,addEventListener(){},querySelectorAll:()=>[]};
 globalThis.fetch=async()=>({json:async()=>({})});
 const file=(name,kind)=>({id:name,fileName:name+'.nbt',kind,cannon:'K01',origin:[0,0,0],size:[1,1,1],blocks:1,sha256:'a'});
 const stone=file('REGULAR'),active=file('ACTIVE'),arch=file('ARCH','build');
 const queue={pending:['ACTIVE','REGULAR','ARCH'],done:[],preferred:[]};
 try{
  const ui=createProjectBlueprints({api:async url=>url==='/api/projects/erebor'?{id:'erebor',version:1}:url.includes('/stone/prepared')?{packages:[{version:1,cannon:'K01',part:1,files:[stone,active]}]}:url.includes('/manifest')?{packages:[{}]}:{packages:[{version:1,revision:2,id:'A',title:'Architecture',files:[arch]}]},isSelected:()=>true,getSite:()=> 'K01',getQueue:()=>queue,getStation:()=>({file:'ACTIVE'}),closeDrawer(){}});
  await ui.load();
  const html=get('bpRows').innerHTML;
  assert.match(html,/<details data-regular-fallback><summary>Reguläre Cleanstone-Fallbackpläne/);
  assert.doesNotMatch(html,/<details[^>]*\bopen\b/);
  const fallback=html.indexOf('<details data-regular-fallback>');
  assert.ok(html.indexOf('data-stone-id="ACTIVE"')<fallback,'active job stays outside fallback');
  assert.ok(html.indexOf('data-stone-id="ARCH"')<fallback,'architecture stays outside fallback');
  assert.ok(html.indexOf('data-stone-id="REGULAR"')>fallback,'regular plan retained inside fallback');
  assert.match(get('cards').innerHTML,/Massiv-Baupläne und Sonderziele/);
  assert.match(html,/REGULAR.nbt/,'download retained');
  get('search').value='REGULAR';ui.rows();
  assert.match(get('bpRows').innerHTML,/data-stone-id="REGULAR"/,'search finds collapsed fallback');
  assert.doesNotMatch(get('bpRows').innerHTML,/data-stone-id="ARCH"/);
  get('search').value='';
  queue.pending=Array.from({length:151},(_,i)=>'UNKNOWN'+i).concat(['ACTIVE','REGULAR','ARCH']);ui.rows();
  const paged=get('bpRows').innerHTML;
  assert.match(paged,/data-stone-id="ACTIVE"/,'current job survives fallback pagination');
  assert.match(paged,/data-stone-id="ARCH"/,'architecture survives fallback pagination');
 }finally{Object.assign(globalThis,prior);}
});
