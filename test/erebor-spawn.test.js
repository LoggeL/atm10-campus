import test from 'node:test';
import assert from 'node:assert/strict';
import {placeProtection,spawnBundles,torch,enclosedCore} from '../src/erebor-spawn-plan.js';
import {loadModel} from '../src/structure-edit.js';

test('coverage checks every corner, including upper floors, and reports inaccessible cells',()=>{
 const cells=new Map();
 for(let x=-7;x<7;x++)for(let y=-3;y<16;y++)for(let z=0;z<7;z++)cells.set([x,y,z].join(','),[x,y,z]);
 const rock=new Map(Array.from({length:377},(_,i)=>[i-60,'minecraft:stone']));
 const result=placeProtection(cells,()=>rock);
 assert.equal(result.uncovered.length,0);
 for(const p of cells.values())assert.ok(result.sites.some(s=>p.every((v,i)=>Math.max(Math.abs(v*16-s.pos[i]),Math.abs(v*16+15-s.pos[i]))<=63)));
 assert.ok(result.sites.length<20);
 assert.deepEqual(placeProtection(new Map([['0,0,0',[0,0,0]]]),()=>new Map()).uncovered,[[0,0,0]]);
});
test('batch files reconstruct exactly the targets within range, with no air or demolition entries',()=>{
 const coords=[[-120,-40,-75],[8,65,-72],[56,65,24],[600,50,-550],[600,165,-550],[65,140,35]];
 const sites=coords.map((pos,i)=>({pos,phase:i===5?'nach Steinfüllung':'bereit'}));
 const result=spawnBundles(sites,[{id:'K01',position:[0,70,0]}]),rebuilt=[];
 for(const r of result.runs){
  const m=loadModel(result.files.get(r.file));assert.equal(r.count,m.cells.size);
  for(const [k,c] of m.cells){assert.equal(c.name,torch);assert.equal(c.props.waterlogged,'false');const point=k.split(',').map((v,i)=>Number(v)+r.origin[i]);
   assert.ok(Math.hypot(...point.map((n,i)=>n-r.cannon[i]))<255);rebuilt.push(point.join(','));}
 }
 assert.deepEqual(rebuilt.sort(),coords.map(p=>p.join(',')).sort());
});
test('finish-stage cores need opaque masonry on every side, including diagonal openings',()=>{
 assert.equal(enclosedCore(()=>'minecraft:stone_bricks'),true);
 for(const unsafe of [null,'minecraft:air','minecraft:stone_brick_slab','minecraft:chest','minecraft:glass'])
  assert.equal(enclosedCore((x,y,z)=>x===1&&y===-1&&z===1?unsafe:'minecraft:stone_bricks'),false);
});
