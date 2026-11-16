import test from 'node:test';
import assert from 'node:assert/strict';

test('UI labels independent ledgers and reports unavailable counts as unknown',async()=>{
 const {counterText}=await import('../public/assets/erebor-queue.js');
 assert.equal(counterText(null),'Zähler unbekannt');
 assert.equal(counterText({catalog:{open:12,inProgress:1,done:3},massif:{open:9,inProgress:2,done:4}}),'Katalog · 12 offen · 1 zugewiesen · 3 erledigt | Massiv · 9 offen · 2 zugewiesen · 4 erledigt');
});
