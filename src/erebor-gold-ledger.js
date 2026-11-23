// Inert persistence boundary, deliberately NOT imported by the runtime queue.
// Claims are durable intent, never permission to mutate a cannon or finish a job.
import {createHash} from 'node:crypto';

export function goldLedger(db){
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_gold_preparations (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL, site TEXT NOT NULL, slot TEXT NOT NULL,
  original_job TEXT NOT NULL, archive BLOB NOT NULL, archive_hash TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, operation TEXT,
  UNIQUE(version,site,slot)
 );
 CREATE TRIGGER IF NOT EXISTS erebor_gold_original_immutable
 BEFORE UPDATE OF id,version,site,slot,original_job,archive,archive_hash ON erebor_gold_preparations
 BEGIN SELECT RAISE(ABORT,'Gold original is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS erebor_gold_original_retained
 BEFORE DELETE ON erebor_gold_preparations
 BEGIN SELECT RAISE(ABORT,'Gold original must be retained'); END`);
 const getRow=db.prepare('SELECT * FROM erebor_gold_preparations WHERE id=?');
 function get(id){
  const r=getRow.get(id); if(!r)return null;
  const archive=Buffer.from(r.archive);
  if(createHash('sha256').update(archive).digest('hex')!==r.archive_hash)throw Error('Archive integrity failure');
  return {id:r.id,version:r.version,site:r.site,slot:r.slot,originalJob:JSON.parse(r.original_job),archive,
   archiveHash:r.archive_hash,revision:r.revision,operation:r.operation,
   originalFinished:false,blockSuccessors:true,activationAllowed:false};
 }
 return {get,
  prepare({version,site,slot,originalJob,archive}){
   if(!Number.isSafeInteger(version)||version<1||!/^K(?:0[1-9]|[12]\d|3[0-7])$/.test(site)||! /^[A-R]$/.test(slot))throw Error('Invalid identity');
   if(!originalJob||typeof originalJob!=='object'||Array.isArray(originalJob)||!Buffer.isBuffer(archive)||!archive.length)throw Error('Original job and archive required');
   const job=JSON.stringify(originalJob),bytes=Buffer.from(archive);
   const digest=createHash('sha256').update(bytes).digest('hex');
   const id=`${version}:${site}:${slot}`;
   const result=db.prepare(`INSERT INTO erebor_gold_preparations
    (id,version,site,slot,original_job,archive,archive_hash) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT DO NOTHING`).run(id,version,site,slot,job,bytes,digest);
   if(result.changes!==1)throw Error('Original slot already reserved');
   return get(id);
  },
  claim(id,revision,operation){
   if(operation==='resume-gold')throw Error('Gold requires explicit user request and integrated guarded resume; unavailable');
   if(operation!=='suspend')throw Error('Unsupported operation');
   if(!Number.isSafeInteger(revision)||revision<0)throw Error('Invalid revision');
   // Single statement CAS: no read/await/write gap. No reclaim or retry API:
   // a crash after this write leaves an ambiguous pending operation for review.
   const result=db.prepare(`UPDATE erebor_gold_preparations SET operation=?, revision=revision+1
    WHERE id=? AND revision=? AND operation IS NULL`).run(operation,id,revision);
   if(result.changes!==1){
    const r=get(id);
    if(!r||r.revision!==revision)throw Error('Missing or stale revision');
    throw Error('Operation already pending; reconcile without replay');
   }
   return get(id);
  }
 };
}
