import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hallParents,splitHall,stationSupport} from '../src/erebor-hall-split.js';
import {tileNBT} from '../src/erebor-tiles.js';
import {interiorFrontier} from '../src/erebor-interior.js';
import {parseStructure} from '../src/nbt.js';

test('Five complete masks cover precisely the original remaining stone outside the station',()=>{
 const sources=[],expected=new Set();
 const world={protected:stationSupport,at:(x,y,z)=>x===215?'minecraft:air':x===214?'ae2:cable_bus':'minecraft:stone'};
 for(const id of hallParents){
  const origin=id.match(/X(\d+)_Y(\d+)_Z(-\d+)/).slice(1).map(Number),cells=new Int16Array(32**3).fill(-1);
  for(let i=0;i<32**3;i+=3){
   cells[i]=0;
   const p=[origin[0]+i%32,origin[1]+(i>>10),origin[2]+((i>>5)%32)];
   if(!world.protected(...p)&&world.at(...p)==='minecraft:stone')expected.add(p.join(','));
  }
  const {bytes,air}=tileNBT([{name:'minecraft:air'}],cells,'clear');
  sources.push({bytes,f:{id,origin,kind:'clear',group:'E05',cannon:'K19',blocks:air,sha256:createHash('sha256').update(bytes).digest('hex')}});
 }
 const {entries,files}=splitHall(sources,world);
 assert.deepEqual(files.map(f=>f.slot),[...'CDEGI']);
 assert.equal(new Set(files.map(f=>f.id)).size,5);
 for(const [i,{data}] of entries.entries()){
  const {clear,placed}=parseStructure(data); assert.equal(placed.length,0);
  for(let j=0;j<clear.length;j+=3)assert.ok(expected.delete(files[i].origin.map((v,k)=>v+clear[j+k]).join(',')));
 }
 assert.equal(expected.size,0);
});
test('Overlapping bounds allow only disjoint sibling reservations before assembly',()=>{
 const base={group:'E05',origin:[192,96,-10016],size:[32,32,32]},open=[
  {...base,stage:'clear',slot:'G',parent:'original',name:'g'},
  {...base,stage:'clear',slot:'I',parent:'original',name:'i'},
  {...base,stage:'build',name:'walls'}];
 assert.deepEqual(interiorFrontier(open,new Set(['g']),true,'I').map(r=>r.name),['i']);
 assert.deepEqual(interiorFrontier(open,new Set(['g']),true,'A'),[]);
 assert.deepEqual(interiorFrontier(open,new Set(['walls']),true,'I'),[]);
});
