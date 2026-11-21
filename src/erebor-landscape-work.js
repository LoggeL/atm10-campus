import {createHash} from 'node:crypto';
import {storedZipEntry} from './zip.js';
import {ereborUploadName} from './erebor-file.js';
import {inRange} from './erebor-interior.js';
import {isDeepStrictEqual as same} from 'node:util';

export function readySurface(job,report,key){
 const signal=report?.stations?.[key],d=job?.desired;
 const grove=(key==='K10G'||key==='K10I')&&job?.interior===true&&job.source?.part==='E01_901';
 return report?.ereborProjectWork===1&&report.surfaceModeTracker===1&&(job?.surface===true||grove)&&
  job.phase==='build'&&!job.started&&!job.tainted&&!job.placed&&d?.owner==='Erebor'&&
  d.options?.replace_mode===0&&d.options.skip_missing===false&&d.options.replace_block_entities===false&&
  signal?.state==='PAUSED'&&signal.status==='ready'&&signal.ready&&signal.aligned&&
  signal.fuel>0&&signal.placed===0&&signal.owner===d.owner&&signal.upload===d.file&&
  same(signal.anchor,d.anchor)&&same(signal.size,job.size)&&same(signal.options,[0,false,false]);
}

const catalogs=new WeakMap();
export function initLandscapeWork(db){
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_surface_dispatch(v INTEGER,r INTEGER,file TEXT,sha TEXT,site TEXT,slot TEXT,done INTEGER DEFAULT 0,PRIMARY KEY(v,r,file,sha))`);
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_surface_legacy(v INTEGER,r INTEGER,file TEXT,sha TEXT,next_sha TEXT,entry TEXT,nbt BLOB,PRIMARY KEY(v,r,file,sha))`);
}
export function carrySurfaceJobs(db,v,r,old,zip,next){
 const updated=new Map(next.files.map(f=>[f.fileName,f.sha256]));
 const find=db.prepare('SELECT site,slot,done FROM erebor_surface_dispatch WHERE v=? AND r=? AND file=? AND sha=?');
 const keep=db.prepare('INSERT INTO erebor_surface_legacy VALUES(?,?,?,?,?,?,?)');
 const carry=db.prepare('INSERT INTO erebor_surface_dispatch(v,r,file,sha,site,slot,done) VALUES(?,?,?,?,?,?,?)');
 for(const f of old.files){
  const sha=updated.get(f.fileName);
  if(sha===f.sha256)continue;
  const key=[v,r,f.fileName,f.sha256],row=find.get(...key);
  if(!row)continue;
  if(!row.done){
   const data=storedZipEntry(zip,f.fileName);
   if(!data||createHash('sha256').update(data).digest('hex')!==f.sha256)throw Error('Vorherige aktive NBT nicht bestätigt.');
   keep.run(...key,sha??null,JSON.stringify(f),data);
  }
  if(sha)carry.run(v,r,f.fileName,sha,row.site,row.slot,row.done);
 }
}
export function landscapeFiles(db,v,r){
 const parts=db.prepare('SELECT id,version FROM erebor_surface_parts WHERE v=? AND r=? ORDER BY id').all(v,r);
 const key=JSON.stringify([v,r,parts]);
 const cached=catalogs.get(db);
 if(cached?.key===key)return cached.files;
 const query=db.prepare('SELECT report FROM erebor_surface_parts WHERE v=? AND r=? AND id=?');
 const files=[];
 for(const part of parts)for(const f of JSON.parse(query.get(v,r,part.id).report).files){
  files.push({...f,part:part.id,r});
 }
 files.sort((a,b)=>a.origin[1]-b.origin[1]||a.fileName.localeCompare(b.fileName));
 catalogs.set(db,{key,files});
 return files;
}
function book(db,v,r){
 return new Map(db.prepare('SELECT file,sha,done FROM erebor_surface_dispatch WHERE v=? AND r=?').all(v,r).map(e=>[e.file+'|'+e.sha,e]));
}
export function landscapeProgress(db,v,r){
 const task={total:0,done:0,inProgress:0,open:0};
 const booked=book(db,v,r);
 for(const f of landscapeFiles(db,v,r)){
  const row=booked.get(f.fileName+'|'+f.sha256);
  task.total++;task[row?(row.done?'done':'inProgress'):'open']++;
 }
 return task;
}
export function landscapeQueue(db){
 initLandscapeWork(db);
 const revision=v=>db.prepare('SELECT revision FROM erebor_landscape WHERE project_version=?').get(v)?.revision;
 function restore(v,source){
  const row=db.prepare('SELECT report,zip FROM erebor_surface_parts WHERE v=? AND r=? AND id=?').get(v,source.r,source.part);
  let f=row&&JSON.parse(row.report).files.find(f=>f.fileName===source.fileName&&f.sha256===source.sha256);
  let bytes;
  if(f)bytes=storedZipEntry(row.zip,f.fileName);
  else{
   const previous=db.prepare('SELECT entry,nbt FROM erebor_surface_legacy WHERE v=? AND r=? AND file=? AND sha=?').get(v,source.r,source.fileName,source.sha256);
   if(previous){f=JSON.parse(previous.entry);bytes=Buffer.from(previous.nbt);}
  }
  if(!f)throw Error('Veröffentlichter Landschaftsplan hat sich geändert.');
  if(!bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('Landschaftsdatei stimmt nicht mit dem Paket überein.');
  const desired={file:ereborUploadName(f.fileName,f.sha256),blueprint:f.fileName.slice(0,-4),sha256:f.sha256,anchor:f.origin,version:v,owner:'Erebor',mirror:'none',rotation:'none',options:{replace_mode:0,replace_block_entities:false,skip_missing:false}};
  return {bytes,job:{desired,size:[32,32,32],blocks:f.blocks,materials:f.materials,source,phase:'build',surface:true,loaded:false,seen:0}};
 }
 const deferred=new Map();
 // These two operators requested an in-progress revision change. The native
 // printer must release the old input before the new reservation is adopted.
 const requestedSwitch=new Map([
  ['K20C','campus_88d06245-a7f8-8d0d-95f6-f57c2d1e7b00.nbt'],
  ['K36C','campus_cec97c6f-482e-8dcc-90b3-eb8186b1ab16.nbt'],
 ]);
 function successor(v,site,slot,job){
  if(!job?.surface||!job.loaded||requestedSwitch.get(site+slot)!==job.desired.file)return null;
  const s=job.source;
  const next=db.prepare(`SELECT l.next_sha sha FROM erebor_surface_legacy l
   JOIN erebor_surface_dispatch old ON old.v=l.v AND old.r=l.r AND old.file=l.file AND old.sha=l.sha
   JOIN erebor_surface_dispatch n ON n.v=l.v AND n.r=l.r AND n.file=l.file AND n.sha=l.next_sha
   WHERE l.v=? AND l.r=? AND l.file=? AND l.sha=? AND old.site=? AND old.slot=?
    AND n.site=old.site AND n.slot=old.slot AND n.done=0 AND old.done=0`).get(v,s.r,s.fileName,s.sha256,site,slot);
  if(!next||revision(v)!==s.r)return null;
  return {...s,sha256:next.sha};
 }
 return {restore,successor,releasePrevious(v,site,slot,job){
  const s=job.source;
  if(!db.prepare('DELETE FROM erebor_surface_dispatch WHERE v=? AND r=? AND file=? AND sha=? AND site=? AND slot=? AND done=0').run(v,s.r,s.fileName,s.sha256,site,slot).changes)throw Error('Vorherige Reservierung hat gewechselt.');
 },finish(v,site,slot,job){
  const s=job.source;
  const changed=db.prepare('UPDATE erebor_surface_dispatch SET done=1 WHERE v=? AND r=? AND site=? AND slot=? AND file=? AND sha=? AND done=0').run(v,s.r,site,slot,s.fileName,s.sha256);
  if(!changed.changes)throw Error('Landschaftsreservierung passt nicht zur Kanone.');
  const old=db.prepare('SELECT next_sha FROM erebor_surface_legacy WHERE v=? AND r=? AND file=? AND sha=?').get(v,s.r,s.fileName,s.sha256);
  if(old?.next_sha)db.prepare('UPDATE erebor_surface_dispatch SET done=1 WHERE v=? AND r=? AND site=? AND slot=? AND file=? AND sha=?').run(v,s.r,site,slot,s.fileName,old.next_sha);
 },async candidate(p,site,slot,pos,verify){
  const v=p.current_version,r=revision(v);
  if(r==null)return null;
  const booked=book(db,v,r),columns=new Set();
  const occupied=new Set(db.prepare('SELECT file FROM erebor_surface_dispatch WHERE v=? AND done=0').all(v).map(row=>row.file));
  let checks=0;
  for(const f of landscapeFiles(db,v,r)){
   const col=f.origin[0]+','+f.origin[2],existing=booked.get(f.fileName+'|'+f.sha256);
   if(existing?.done)continue;
   if(columns.has(col))continue;
   columns.add(col);
   if(occupied.has(f.fileName)||!inRange(f.origin,[32,32,32],pos)||(deferred.get(f.fileName+f.sha256)??0)>Date.now())continue;
   if(++checks>3)break;
   const source={r,part:f.part,fileName:f.fileName,sha256:f.sha256};
   const pkg=restore(v,source);
   if(!await verify(pkg)){
    deferred.set(f.fileName+f.sha256,Date.now()+300000);continue;
   }
   return {...pkg,entry:source,release(){
    if(revision(v)!==r||!landscapeFiles(db,v,r).some(g=>g.fileName===f.fileName&&g.sha256===f.sha256))throw Error('Landschaftsrevision hat gewechselt.');
    db.prepare('INSERT INTO erebor_surface_dispatch(v,r,file,sha,site,slot) VALUES(?,?,?,?,?,?)').run(v,r,f.fileName,f.sha256,site,slot);
   }};
  }
  return null;
 }};
}
