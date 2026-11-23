import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {CANNON_ME_RESERVE} from '../src/me-stock.js';

const source = readFileSync(new URL('../controller/kubejs/campus-stock.js', import.meta.url), 'utf8');

test('two station requests share one live reserve, including components, failed and partial transfers', () => {
  let plain = 560, variant = 60, space = 40, clock = 1000;
  const item = {};
  class ItemKey {
    static ['of(net.minecraft.world.level.ItemLike)']() { return plainKey; }
    getId() { return 'minecraft:stone'; }
  }
  const plainKey = new ItemKey(), variantKey = new ItemKey();
  const service = {
    getInventory:() => ({extract:(key, limit) => Math.min(limit, key === plainKey ? plain : variant)}),
    getCachedInventory:() => ({findFuzzy:() => ({iterator:() => {
      const entries = [plainKey, variantKey];
      return {hasNext:() => entries.length > 0, next:() => ({getKey:() => entries.shift()})};
    }})}),
  };
  class Bridge {
    isAvailable() { return true; }
    getBridge() { return {getGridNode:() => ({getGrid:() => ({getStorageService:() => service})})}; }
    forEachConnectedComputers(visit) {
      for (const id of [1, 2]) visit({getID:() => id, getAttachmentName:() => 'back'});
    }
    exportItem(access, to, filter) {
      const n = Math.min(filter.get('count'), space), first = Math.min(n, plain);
      plain -= first;
      variant -= n - first;
      return {getResult:() => [n]};
    }
  }
  const bridge = new Bridge();
  const queue = [], guards = [], computers = [1, 2].map(id => ({
    getID:() => id, getInstanceUUID:() => String(id), isOn:() => true, getPeripheral:() => bridge,
    createRootMount:() => ({exists:() => true}), queueEvent:(_, [api]) => guards.push(api),
  }));
  const classes = {
    ServerContext:{get:() => ({registry:() => ({getComputers:() => computers})})},
    ComputerSide:{values:() => ['back'],valueOfInsensitive:name => name},
    IDynamicLuaObject:class {constructor(methods) { Object.assign(this,methods); }},
    WiredModemPeripheral:class {}, MEBridgePeripheral:Bridge,
    BuiltInRegistries:{ITEM:{containsKey:() => true,get:() => item}},
    ResourceLocation:{tryParse:id => id}, AEItemKey:ItemKey, Actionable:{SIMULATE:'simulate'},
    FuzzyMode:{IGNORE_ALL:0}, HashMap:class extends Map {put(k,v) { this.set(k,v); }},
    Objects:{equals:(a,b) => a === b}, Optional:{of:filter => filter},
  };
  runInNewContext(source,{Date:{now:() => clock}, Java:{loadClass:path => classes[path.split('.').at(-1)]},
    ServerEvents:{tick:run => run({server:{}})}});
  const request = (guard, count) => {
    const args = ['back','left','minecraft:stone',count,CANNON_ME_RESERVE,clock + 1000];
    guard.callMethod({executeMainThreadTask:task => queue.push(task)}, 0,
      {getString:i => args[i],getInt:i => args[i],getFiniteDouble:i => args[i]});
  };
  request(guards[0], 200);
  request(guards[1], 200);
  assert.equal(queue.shift()()[0], 40);
  space = 4096;
  assert.deepEqual(Array.from(queue.shift()()), [80, 'ME_RESERVE', 500]);
  request(guards[0], 64);
  assert.deepEqual(Array.from(queue.shift()()), [0, 'ME_RESERVE', 500]);
  plain -= 30; // A player takes some of their reserve.
  request(guards[1], 64);
  assert.deepEqual(Array.from(queue.shift()()), [0, 'ME_RESERVE', 470]);
  plain += 31;
  request(guards[1], 64);
  assert.deepEqual(Array.from(queue.shift()()), [1, 'ME_RESERVE', 500]);
  request(guards[0], 64);
  clock += 1000;
  assert.equal(queue.shift()()[0], 0);
  assert.equal(plain + variant, 500);
});
