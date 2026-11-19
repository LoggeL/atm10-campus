import test from 'node:test';
import assert from 'node:assert/strict';
import {k09,groupSites,slotsFor,supplyGroup,groupOf} from '../src/erebor-groups.js';
import {parallelLayout} from '../src/erebor-parallel.js';
import {availableMassifSlots} from '../src/erebor-balance.js';
import {isEreborStation} from '../src/erebor-feeder.js';
import {registerMassif} from '../src/erebor-massif.js';
import {DatabaseSync} from 'node:sqlite';
import {cannonProgressRows} from '../src/cannon-progress-rows.js';

test('planned K19 helpers appear in operating counts once their hardware reports ready',()=>{
 const sites=[{site:'K19'}];
 assert.deepEqual(cannonProgressRows(sites,[],null).map(r=>r.slot),[...'ABC']);
 const stations={K19D:{ready:true,state:'STOPPED'},K19E:{ready:true}};
 assert.deepEqual(cannonProgressRows(sites,[],{stations}).map(r=>r.slot),[...'ABCD']);
});

test('existing and planned groups have independent slots and inventories, including the asymmetric K24 build',()=>{
 assert.equal(groupSites.size,23);
 assert.deepEqual(groupSites.get('K24').map(g=>g.name),['K24-W','K24-S','K24-2E']);
 const all=Object.fromEntries([...'ABCDEFGHIJKLMNOPQR'].map(s=>[s,s]));
 const extras=new Set();
 for(const station of parallelLayout.sites){
  const groups=groupSites.get(station.site);
  const letters=slotsFor(station.site);
  assert.equal(new Set(letters).size,letters.length);
  assert.deepEqual(letters,['A','B','C',...(groups??[]).flatMap(g=>Object.keys(g.slots))]);
  for(const g of (groups??[])){
   assert.equal(groupOf('erebor-'+g.name),g);
   assert.equal(isEreborStation('erebor-'+g.name),true);
   assert.deepEqual(Object.values(supplyGroup(all,g)),Object.keys(g.slots));
   for(const [s,position] of Object.entries(g.slots)){
    assert.deepEqual(station[s],position);
    assert.ok(!extras.has(position.join(',')));
    extras.add(position.join(','));
   }
  }
 }
 assert.equal(extras.size,150);
});

test('K09 separates three inventories and does not count other groups as providers',()=>{
 const all=Object.fromEntries(slotsFor('K09').map(x=>[x,{file:x}]));
 const distance=(a,b)=>a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0);
 assert.equal(Object.keys(supplyGroup(all,null)).join(''),'ABC');
 assert.equal(slotsFor('K01').join(''),'ABC');
 assert.equal(isEreborStation('erebor-K10-N'),false);
 for(const [i,g] of k09.groups.entries()){
  assert.equal(groupOf('erebor-'+g.name),g);
  assert.equal(isEreborStation('erebor-'+g.name),true);
  assert.equal(Object.keys(supplyGroup(all,g)).join(''),i?'GHI':'DEF');
  assert.equal(distance(g.computer,k09.bridge),1);
  assert.equal(distance(g.computer,g.chest),1);
  for(const [slot,p] of Object.entries(g.slots)){
   assert.equal(distance(p,g.chest),1);
   assert.deepEqual(parallelLayout.sites.find(s=>s.site==='K09')[slot],p);
  }
 }
 const live={version:12,at:1234,stations:{K09D:{state:'STOPPED',ready:true,options:[2,false,false]},K09I:{state:'STOPPED',ready:false}}};
 assert.deepEqual(availableMassifSlots(parallelLayout.sites,live,12,new Set(),true,1235).map(s=>s.site+s.slot),['K09D']);
});

test('K09 D–I claim six distinct blocks of work and keep their claims after retry',async()=>{
 const db=new DatabaseSync(':memory:'), hooks=[];
 db.exec('CREATE TABLE erebor_queue_sites(state TEXT); CREATE TABLE erebor_helpers(version INTEGER,job TEXT)');
 const massif=registerMassif({addHook:(_,f)=>hooks.push(f),get(){},post(){}},
   {db,config:{worldSources:{}}},parallelLayout.sites);
 try{
  db.exec("INSERT INTO erebor_massif_runs(v) VALUES(12); INSERT INTO erebor_massif_blobs VALUES('fixture',x'01')");
  const add=db.prepare("INSERT INTO erebor_massif_tiles(v,tile,x,y,z,sx,sy,sz,blocks,sha,home,priority,special) VALUES(12,?,?,48,-10240,1,1,1,1,'fixture','K09',1,0)");
  const claimed=new Set();
  for(let i=0;i<6;i++)add.run('TILE_'+i,-1240+i);
  for(const slot of 'DEFGHI'){
   const job=massif.reserve(12,'K09',slot,true);
   assert.ok(job);
   assert.deepEqual(massif.reserve(12,'K09',slot,true),job);
   claimed.add(job.job.massif);
  }
  assert.equal(claimed.size,6);
 }finally{
  for(const close of hooks)await close();
  db.close();
 }
});
