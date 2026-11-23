import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {goldLedger} from '../src/erebor-gold-ledger.js';

test('durable immutable originals and revision claims survive reopening and isolate slots',()=>{
 const db=new DatabaseSync(':memory:');
 const a=goldLedger(db), b=goldLedger(db);
 const input={version:12,site:'K06',slot:'A',originalJob:{desired:{file:'original.nbt'},retained:{placed:7}},archive:Buffer.from('exact original archive')};
 const row=a.prepare(input);
 assert.equal(row.revision,0);
 assert.deepEqual(row.originalJob,input.originalJob);
 input.originalJob.retained.placed=99;
 assert.equal(b.get(row.id).originalJob.retained.placed,7);
 assert.deepEqual(b.get(row.id).archive,Buffer.from('exact original archive'));
 assert.throws(()=>b.prepare(input),/reserved/);
 const other=a.prepare({...input,slot:'B'});
 const claim=a.claim(row.id,0,'suspend');
 assert.equal(claim.revision,1);
 assert.throws(()=>b.claim(row.id,0,'suspend'),/stale/);
 assert.throws(()=>b.claim(row.id,1,'suspend'),/pending/);
 assert.equal(goldLedger(db).get(row.id).operation,'suspend');
 assert.equal(b.get(other.id).revision,0);
 assert.equal(claim.originalFinished,false);
 assert.equal(claim.blockSuccessors,true);
 assert.equal(claim.activationAllowed,false);
 assert.throws(()=>a.claim(other.id,0,'resume-gold'),/explicit/);
 assert.throws(()=>a.claim(other.id,0,'finish'),/Unsupported/);
});

test('disk restart and independent writers retain the original and reject replay',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gold-ledger-'));
 let db,second;
 try {
  const path=join(dir,'ledger.sqlite');
  db=new DatabaseSync(path); db.exec('PRAGMA journal_mode=WAL; CREATE TABLE unrelated (job TEXT); INSERT INTO unrelated VALUES (\'untouched\')');
  const a=goldLedger(db);
  const r=a.prepare({version:12,site:'K06',slot:'A',originalJob:{retained:'exact'},archive:Buffer.from('retained archive')});
  second=new DatabaseSync(path); const b=goldLedger(second);
  a.claim(r.id,0,'suspend');
  assert.throws(()=>b.claim(r.id,0,'suspend'),/stale/);
  assert.throws(()=>db.prepare('UPDATE erebor_gold_preparations SET original_job=? WHERE id=?').run('{}',r.id),/immutable/);
  assert.throws(()=>db.prepare('DELETE FROM erebor_gold_preparations WHERE id=?').run(r.id),/retained/);
  second.close(); second=null; db.close();
  db=new DatabaseSync(path);
  const reopened=goldLedger(db).get(r.id);
  assert.equal(reopened.operation,'suspend');
  assert.deepEqual(reopened.originalJob,{retained:'exact'});
  assert.deepEqual(reopened.archive,Buffer.from('retained archive'));
  assert.equal(db.prepare('SELECT job FROM unrelated').get().job,'untouched');
 } finally {second?.close(); db?.close(); rmSync(dir,{recursive:true,force:true});}
});
