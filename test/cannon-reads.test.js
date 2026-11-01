import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCannonReads} from '../src/cannon-reads.js';

test('concurrent UI and feeder probes share one read, different jobs serialize, subsequent polls are fresh',async()=>{
  const calls=[];let release;
  const read=createCannonReads(async(_,data)=>{
    calls.push(data.station);
    if(calls.length===1)await new Promise(resolve=>{release=resolve;});
    return {number:calls.length};
  });
  const first=read('one','job-a'),same=read('ONE','job-a'),changed=read('one','job-b'),other=read('two','job-c');
  assert.equal(first,same);await Promise.resolve();assert.deepEqual(calls,['one']);
  release();assert.deepEqual(await Promise.all([first,same,changed,other]),[{number:1},{number:1},{number:2},{number:3}]);
  assert.deepEqual(calls,['one','one','two']);
  assert.deepEqual(await read('one','job-a'),{number:4},'no cached proof is reused after completion');
});

test('failed native reads release their queue and can be retried',async()=>{
  let calls=0;const read=createCannonReads(async()=>{if(++calls===1)throw Error('offline');return {ok:true};});
  await assert.rejects(read('one','job'),/offline/);assert.deepEqual(await read('one','job'),{ok:true});
});
