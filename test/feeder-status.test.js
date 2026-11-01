import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from '../src/api-stations.js';
import { reachableCannons } from '../src/cannon-range.js';

test('computer identity is an explicit bounded integer, never inferred from missing or coercible input', () => {
  for (const computerId of [0, 11, 2147483647]) {
    const status = normalizeStatus({computerId,chest:{name:'left',slots:27,used:2}});
    assert.equal(status.computerId,computerId);
    assert.equal(status.chest.name,'left');
  }
  assert.equal(normalizeStatus().computerId,null);
  for (const computerId of [null, undefined, false, true, '', '0', '11', [], {}, -1, 1.5, 2147483648, NaN, Infinity]) {
    assert.equal(normalizeStatus({computerId}).computerId,null, String(computerId));
  }
});

test('chestSide supports local and explainable remote names without reusing an old chest view', () => {
  for (const chestSide of ['top','bottom','left','right','front','back','minecraft:chest_12']) {
    assert.equal(normalizeStatus({chestSide,chest:null}).chestSide,chestSide);
  }
  assert.equal(normalizeStatus({chest:{name:'left'}}).chestSide,null);
  assert.equal(normalizeStatus({chestSide:null,chest:{name:'left'}}).chestSide,null);
  assert.equal(normalizeStatus({chestSide:'a'.repeat(100)}).chestSide,'a'.repeat(60));
  assert.equal(normalizeStatus({chestSide:' left '}).chestSide,'left');
  for (const chestSide of [null,undefined,'',' ',0,false,[],{}]) {
    assert.equal(normalizeStatus({chestSide}).chestSide,null);
  }
});

test('feeder 1.4.0 remains eligible for confirmed nearby transfer suggestions', () => {
  const at = new Date().toISOString();
  const rows = [{name:'next',assignment:3,blueprint_id:null,last_seen_at:at,status_json:JSON.stringify({script:'1.4.0',at,computerId:4})}];
  const binding = {dimension:'minecraft:overworld',x:2,y:64,z:0,owner:'Campus'};
  const [next] = reachableCannons(rows,'source',[0,64,0],()=>binding,()=>false);
  assert.equal(next.name,'next');
  assert.equal(next.availability,'free');
});
