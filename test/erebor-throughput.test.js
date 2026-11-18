import test from 'node:test';
import assert from 'node:assert/strict';
import {placementThroughput} from '../src/erebor-throughput.js';
const at=1700000000000;
const report=(time,placed,upload='one',total=1000)=>({version:12,at:time,stations:{K01:{upload,placed,total,state:'RUNNING'}}});
const rows=[{station:'K01',file:'plan',live:{},workloadBlocks:1000}];
test('measured same-cannon same-upload delta gives rate and current-job ETA only',()=>{
 const meter=placementThroughput();meter.observe(report(at,100),at);meter.observe(report(at+20000,140),at+20000);
 const result=meter.read(report(at+20000,140),rows,at+20000);
 assert.equal(result.blocksPerSecond,2);assert.equal(result.blocksPerHour,7200);
 assert.equal(result.cannons[0].remaining,860);assert.equal(result.cannons[0].etaSeconds,430);
 assert.equal(result.covered,1);assert.equal(result.cannons[0].seconds,20);
});
test('missing reports, duplicate timestamps, resets, changed uploads/totals and stale gaps never invent a rate',()=>{
 for(const next of [report(at+20000,90),report(at+20000,140,'two'),report(at+20000,140,'one',2000),report(at+45000,140)]){
  const meter=placementThroughput();meter.observe(report(at,100),at);meter.observe(next,next.at);
  assert.equal(meter.read(next,rows,next.at).blocksPerSecond,null);
 }
 const meter=placementThroughput();meter.observe(report(at,100),at);meter.observe(report(at,140),at);
 assert.equal(meter.read(report(at,140),rows,at).blocksPerSecond,null);
 meter.observe(report(at+20000,140),at+20000);
 assert.equal(meter.read(report(at+20000,140),rows,at+65000).blocksPerSecond,null);
 assert.equal(meter.read(null,rows,at+20000).blocksPerSecond,null);
 assert.equal(meter.read(report(at+20000,140),[{...rows[0],live:null}],at+20000).covered,0);
});
test('unknown or contradictory native totals still allow measured placement rate but never an ETA',()=>{
 for(const total of [0,100,null]){
  const meter=placementThroughput();meter.observe(report(at,400,total===null?'x':'one',total),at);
  const latest=report(at+20000,440,total===null?'x':'one',total);meter.observe(latest,at+20000);
  const result=meter.read(latest,rows,at+20000);
  assert.equal(result.blocksPerSecond,2);assert.equal(result.cannons[0].remaining,null);assert.equal(result.cannons[0].etaSeconds,null);
 }
});
test('zero measured progress has zero throughput but no ETA; coverage excludes unmapped jobs',()=>{
 const meter=placementThroughput();meter.observe(report(at,100),at);meter.observe(report(at+20000,100),at+20000);
 const result=meter.read(report(at+20000,100),[...rows,{station:'K01B',file:'other',live:null}],at+20000);
 assert.equal(result.blocksPerSecond,0);assert.equal(result.cannons[0].etaSeconds,null);
 assert.equal(result.covered,1);assert.equal(result.assigned,2);
});
test('missing cannon and version change reset history; future samples and short windows are unknown',()=>{
 const meter=placementThroughput();meter.observe(report(at,100),at);
 meter.observe({...report(at+10000,120),stations:{}},at+10000);
 meter.observe(report(at+20000,140),at+20000);
 assert.equal(meter.read(report(at+20000,140),rows,at+20000).blocksPerSecond,null);
 const changed={...report(at+40000,180),version:13};meter.observe(changed,at+40000);
 assert.equal(meter.read(changed,rows,at+40000).blocksPerSecond,null);
 assert.equal(meter.read(changed,rows,at+39999).blocksPerSecond,null);
});
