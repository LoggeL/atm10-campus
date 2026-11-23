// Offline queue transaction seam. No runtime import, native command or receipt API.
import {isDeepStrictEqual as equal} from 'node:util';
import {storedZipEntry} from './zip.js';
import {prepareGoldDeferral,DEFERRED_GOLD_IDS} from './erebor-gold-deferral.js';
import {parseStructure} from './nbt.js';
import {goldLedger} from './erebor-gold-ledger.js';

export function goldQueue(db){
 const ledger=goldLedger(db);
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_gold_adoptions(id TEXT PRIMARY KEY,version INTEGER NOT NULL,manifest TEXT NOT NULL,state TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS erebor_gold_lock_retained BEFORE DELETE ON erebor_gold_adoptions BEGIN SELECT RAISE(ABORT,'Gold dependency lock retained'); END;
 CREATE TRIGGER IF NOT EXISTS erebor_gold_lock_immutable BEFORE UPDATE OF id,version,manifest ON erebor_gold_adoptions BEGIN SELECT RAISE(ABORT,'Gold dependency lock immutable'); END;`);
 const pending=id=>{const r=db.prepare('SELECT * FROM erebor_gold_adoptions WHERE id=?').get(id);return r?{...JSON.parse(r.manifest),state:r.state}:null;};
 function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}}
 function assignment(r){
  if(r.slot==='A'){
   const raw=db.prepare('SELECT state FROM erebor_queue_sites WHERE site=?').get(r.site)?.state;
   const state=raw&&JSON.parse(raw);
   return {job:state?.job,write(job){state.job=job;db.prepare('UPDATE erebor_queue_sites SET state=? WHERE site=? AND state=?').run(JSON.stringify(state),r.site,raw);}};
  }
  const raw=db.prepare('SELECT job FROM erebor_helpers WHERE version=? AND site=? AND slot=?').get(r.version,r.site,r.slot)?.job;
  return {job:raw&&JSON.parse(raw),write(job){db.prepare('UPDATE erebor_helpers SET job=? WHERE version=? AND site=? AND slot=? AND job=?').run(JSON.stringify(job),r.version,r.site,r.slot,raw);}};
 }
 const validate=(r,args)=>validateGoldArchive(r.archive,{...args,job:r.originalJob,version:r.version,site:r.site,slot:r.slot});
 return {pending,locks(version){return db.prepare('SELECT manifest FROM erebor_gold_adoptions WHERE version=?').all(version).map(r=>JSON.parse(r.manifest).original.job.source);},
  reserve(args){return transaction(()=>{
   const r=ledger.get(args.id);if(!r||r.revision!==args.revision||r.operation)throw Error('Missing/stale reservation');
   if(!equal(assignment(r).job,r.originalJob))throw Error('Original assignment changed');
   const m=validate(r,args);ledger.claim(r.id,r.revision,'suspend');
   db.prepare('INSERT INTO erebor_gold_adoptions VALUES(?,?,?,?)').run(r.id,r.version,JSON.stringify(m),'reserved');
   return pending(r.id);
  });},
  adopt(args){return transaction(()=>{
   const r=ledger.get(args.id),p=pending(args.id);
   if(!r||r.revision!==args.revision||r.operation!=='suspend'||p?.state!=='reserved')throw Error('Missing/stale adoption');
   const a=assignment(r);if(!equal(a.job,r.originalJob))throw Error('Original assignment changed');
   const m=validate(r,args),d=r.originalJob.desired;
   if(!equal(args.native,{file:m.continuation.upload,sha256:m.continuation.sha256,anchor:d.anchor,options:d.options}))throw Error('Exact native readback required');
   // Native evidence is injected by a future authenticated guarded switch adapter.
   // No native mutation/retry takes place here, including after restart.
   a.write({...r.originalJob,goldDeferral:r.id,blocks:m.continuation.blocks,desired:{...d,blueprint:m.continuation.name.replace(/\.nbt$/,''),file:m.continuation.upload,sha256:m.continuation.sha256}});
   args.afterWrite?.();
   db.prepare("UPDATE erebor_gold_adoptions SET state='adopted' WHERE id=?").run(r.id);
   return pending(r.id);
  });}
 };
}
export function validateGoldArchive(archive,{job,version,site,slot,readWorld,allowed}){
 const manifest=JSON.parse(storedZipEntry(archive,'gold-deferral.json'));
 if(!equal(manifest.original.job,job))throw Error('Exact original job mismatch');
 // Rebuild independently from original NBT: includes exact properties, identities,
 // counts, partition disjointness and union, not merely manifest assertions.
 const rebuilt=prepareGoldDeferral({bytes:storedZipEntry(archive,'original.nbt'),job,version,site,slot});
 if(!equal(manifest,rebuilt.manifest))throw Error('Partition manifest mismatch');
 for(const name of ['continuation.nbt','deferred-gold.nbt'])
  if(!storedZipEntry(archive,name).equals(storedZipEntry(rebuilt.zip,name)))throw Error('Exact partition mismatch');
 const points=parseStructure(storedZipEntry(archive,'continuation.nbt'),true).placed;
 const deferred=new Set(manifest.deferred.targets.map(p=>p.world.join(',')));
 for(const p of points){
  const pos=[p.x,p.y,p.z].map((n,i)=>n+job.desired.anchor[i]);
  if(allowed(pos,p)!==true)throw Error('Range/protection rejected');
  const current=readWorld(pos);
  if(!current)throw Error('Unknown world target');
  if(current.blockEntity)throw Error('Protected technical target');
  if(current.name===p.name&&equal(current.properties??{},p.properties??{}))continue;
  // Deliberately tiny audited class: stone has no gravity/attachment/multiblock
  // dependency. Unknown states (including stairs, rails, doors) stay blocked.
  if(p.name!=='minecraft:stone'||Object.keys(p.properties??{}).length)throw Error('Unsupported structural dependency');
  if(!['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(current.name))throw Error('World target conflict');
  for(const delta of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
   const at=pos.map((n,i)=>n+delta[i]);
   if(deferred.has(at.join(',')))throw Error('Deferred gold support dependency');
   const neighbour=readWorld(at);
   if(!neighbour)throw Error('Unknown support neighbour');
   if(DEFERRED_GOLD_IDS.includes(neighbour.name)||neighbour.blockEntity)throw Error('Gold/technical support dependency');
  }
 }
 return manifest;
}
