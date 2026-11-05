import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cannonSiteRows,createCannonSites,renderCannonSites} from '../public/assets/cannon-sites.js';

const project={id:'erebor',version:12,plan:{cannonLayout:{nearEntrance:'K19',stations:[
 {id:'K01',position:[-252,32,-11010]},
 {id:'K19',position:[196,96,-10018],foundationY:999},
]}}};
const prepared={version:12,packages:[{cannon:'K19',part:1,fileCount:16,unknown:0,files:[{origin:[298,-40,-10040]}]},{cannon:'K19',part:2,fileCount:16,unknown:0}]};

test('planned cannon coordinates use the cannon block, not schematic anchors, and derive the supporting block below it',()=>{
 const rows=cannonSiteRows(project,prepared),k=rows.find(r=>r.id==='K19');
 assert.deepEqual([k.x,k.y,k.z],[196,96,-10018]);assert.equal(k.foundationY,95);assert.equal(k.files,32);assert.equal(k.packages,2);assert.equal(k.start,true);
 assert.equal(rows[0].packages,0);
 const html=renderCannonSites(project,prepared);
 assert.match(html,/X 196 \/ Y 96 \/ Z -10018/);assert.doesNotMatch(html,/298|999/);
 assert.match(html,/Noch keine veröffentlicht/);assert.match(html,/area=cannon:K19/);
});

test('a changed project version cannot show old package readiness next to new coordinates',()=>{
 assert.throws(()=>cannonSiteRows({...project,version:13},prepared),/Projektstand wurde geändert/);
});

test('a late Erebor read cannot repaint coordinates after selecting Campus',async()=>{
 let selected='erebor',resolve;const element={innerHTML:'',addEventListener(){}};
 const panel=createCannonSites({element,getProject:()=>selected,isActive:()=>true,notify(){},api:url=>url.endsWith('/erebor')?new Promise(r=>resolve=r):Promise.resolve(prepared)});
 const old=panel.load();selected='campus';await panel.load();const campus=element.innerHTML;
 resolve(project);await old;assert.equal(element.innerHTML,campus);assert.doesNotMatch(element.innerHTML,/X 196/);
});

test('a failed refresh removes old coordinates instead of presenting a stale location as current',async()=>{
 const element={innerHTML:'old coordinates',addEventListener(){}};
 const panel=createCannonSites({element,getProject:()=> 'erebor',isActive:()=>true,notify(){},api:async()=>{throw Error('Netzwerkfehler');}});
 await assert.rejects(()=>panel.load(),/Netzwerk/);assert.doesNotMatch(element.innerHTML,/old coordinates/);assert.match(element.innerHTML,/role="alert"/);
});
