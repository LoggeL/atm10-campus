import {mountainTop} from './project-stone.js';

// World X/Z offsets from the mountain peak. Keep the summit, eastern gate and
// routes completely open. The spots follow three separate lower ridge shoulders.
const groves=[
  [-684,-348,[[0,0],[10,6],[-9,7],[5,-10],[-11,-7],[17,-6]]],
  [-674,565,[[0,0],[-8,8],[11,4],[5,-9],[-13,-5]]],
  [152,-805,[[0,0],[9,7],[-10,4],[-5,-11],[13,-8],[21,2]]],
];

export function drawHillsideGroves(d){
  const p=d.plan;if(!p.mountainFill)return;
  const [px,,pz]=p.mountainFill.peak,[ox,oy,oz]=p.worldOrigin;
  d.group='E01';
  const block=(x,y,z,state)=>d.p(oz-z-1,y-oy,x-ox,state);
  for(const [dx,dz,positions] of groves)for(const [i,[a,b]] of positions.entries()){
    const x=px+dx+a,z=pz+dz+b,ground=mountainTop(p,x,z);
    if(ground==null)throw Error('Gehölz liegt außerhalb des Bergprofils');
    const birch=i===2&&dz>0,species=birch?'birch':'spruce';
    for(let u=-3;u<=3;u++)for(let v=-3;v<=3;v++){
      if(u*u+v*v>7+(i%3))continue;
      const h=mountainTop(p,x+u,z+v);
      if(h!=null&&Math.abs(h-ground)<=2)block(x+u,h+1,z+v,(u+v+i)%3===0?'minecraft:moss_block':birch?'minecraft:grass_block':'minecraft:podzol');
    }
    block(x,ground+2,z,'minecraft:'+species+'_sapling');
  }
}
