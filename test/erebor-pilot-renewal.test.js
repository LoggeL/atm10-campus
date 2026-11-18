import {test} from 'node:test';
import assert from 'node:assert/strict';
import {targetRenewal} from '../src/erebor-pilot-renewal.js';

test('renewal uses fresh authoritative snapshots and never retains omitted groups',async()=>{
 let current={version:1,jobs:Object.fromEntries([...'DEF'].map(s=>['K12'+s,{file:s,anchor:[0,0,0],size:[1,1,1],options:[2,false,false]}]))};
 const calls=[];
 const r=targetRenewal(()=>current,async(a,lease)=>{calls.push(structuredClone(lease));return {published:true,lease};});
 for(let n=0;n<5;n++)assert.equal((await r.tick()).state,'renewed');
 assert.equal(calls.length,5);
 assert.ok(calls.every(l=>l.expiresAt-l.at===8000));
 current=null;
 assert.equal((await r.tick()).state,'disabled');
 assert.equal(calls.length,5);
});

test('renewal serializes slow publications and rejects changed ownership',async()=>{
 let resolve,current={version:1,jobs:{K12D:{file:'a'}}};
 const r=targetRenewal(()=>current,async(a,lease)=>{await new Promise(r=>resolve=r);return {published:true,lease};});
 const pending=r.tick();
 assert.equal((await r.tick()).state,'busy');
 current=null;resolve();
 await assert.rejects(pending,/changed/);
});
