import test from 'node:test';
import assert from 'node:assert/strict';
import {finishingScene,goldHallNotes} from '../src/erebor-gold-halls.js';
import {readDesignBlock} from '../src/erebor-tiles.js';

const plan={worldOrigin:[384,88,-10000],zones:[],packages:[]};
const scene=finishingScene(plan,{ops:[]});
const at=(x,y,z)=>readDesignBlock(scene,384+z,88+y,-10001-x);
const name=(x,y,z)=>at(x,y,z)?.name;
const glass='connectedglass:clear_glass_black',pipe='mekanism:basic_mechanical_pipe';

test('ten glass courses cover both level floors, lit four-candle groups and solid supports',()=>{
  for(const [half,y,lo,hi] of [[7,-96,-1054,-935],[2,0,-720,-630]]){
    let candles=0;
    for(let x=-half;x<half;x++)for(let z=lo;z<hi;z++){
      if(y===-96&&z>=-998&&z< -985&&(x< -2||x>=2)){
        assert.equal(name(x,y-1,z),'minecraft:polished_blackstone_bricks');
        if(z>=-996&&z<=-988)assert.equal(name(x,y-12,z),undefined);
        continue;
      }
      for(let i=1;i<=10;i++)assert.equal(name(x,y-i,z),glass);
      const c=at(x,y-11,z);
      if(c.name==='minecraft:candle'){assert.equal(c.props.candles,'4');assert.equal(c.props.lit,'true');candles++;}
      else assert.equal(c.name,'minecraft:air');
      assert.equal(name(x,y-11,z),name(-1-x,y-11,z));
      assert.equal(name(x,y-12,z),'minecraft:polished_blackstone_bricks');
    }
    assert.ok(candles>=20);
  }
});

test('the two covered gold channels have a continuous lumen, end pool and sealed banks',()=>{
  for(const x of [-11,10]){
    for(let z=-1053;z<-940;z++){
      assert.equal(name(x,-97,z),glass);
      assert.equal(name(x,-98,z),'minecraft:air');
      for(const side of [x-1,x+1])assert.equal(name(side,-98,z),'minecraft:polished_blackstone_bricks');
    }
    for(let z=-940;z<-935;z++)assert.equal(name(x,-99,z),'minecraft:air');
    for(const [dx,dz] of [[1,0],[-1,0],[0,-1]])assert.equal(name(x+dx,-95,-1056+dz),'minecraft:chiseled_polished_blackstone');
  }
});

test('both machine bays stay free and the intake connects continuously to the gallery tank',()=>{
  for(const cx of [-318,-295])for(let x=cx-3;x<cx+4;x++)for(let z=-631;z<=-625;z++){
    for(let y=-63;y<-56;y++)assert.equal(name(x,y,z),undefined);
  }
  const stops=[[-318,-61,-632],[-318,-72,-632],[-318,-72,-804],[-318,-13,-804],[-306,-13,-804],[-306,-13,-1045],[-306,2,-1045]];
  for(let i=1;i<stops.length;i++){
    const a=stops[i-1],delta=stops[i].map((v,k)=>v-a[k]);
    for(let j=0;j<=Math.max(...delta.map(Math.abs));j++)assert.equal(name(...a.map((v,k)=>v+j*Math.sign(delta[k]))),pipe);
  }
  assert.equal(name(-306,3,-1045),undefined);
  assert.match(goldHallNotes(plan,'E19').join(' '),/Pull/);
});

test('the king has a 28-block silhouette with crown, split mould and a contained shoulder fall',()=>{
  assert.equal(name(-306,27,-1036),'minecraft:gold_block');
  for(let y=-3;y<=18;y++)assert.equal(name(-297,y,-1031),'minecraft:air');
  for(let y=0;y<=18;y++)assert.equal(name(-297,y,-1030),glass);
  for(const x of [-319,-294])assert.equal(name(x,21,-1040),'minecraft:iron_block');
  assert.equal(name(-306,-4,-1024),'minecraft:polished_blackstone_bricks');
  assert.deepEqual([...new Set(scene.packages.map(p=>p.group))].sort(),['E07','E10','E12','E19']);
});
