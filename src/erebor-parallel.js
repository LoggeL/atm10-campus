import {readFileSync} from 'node:fs';
import {isDeepStrictEqual as same} from 'node:util';
import {verifyAlignment,cannonReset} from './alignment.js';
import {publishedPlan} from './erebor-selection.js';
import {tx} from './db.js';

export const parallelLayout=JSON.parse(readFileSync(new URL('./erebor-fleet/parallel.json',import.meta.url)));
const slots=['B','C'];
export function parallelFleet(db,production,choices,request,recordedFinish){
  db.exec(`CREATE TABLE IF NOT EXISTS erebor_helpers(
    version INTEGER NOT NULL, site TEXT NOT NULL, slot TEXT NOT NULL, name TEXT,
    job TEXT, completed INTEGER NOT NULL DEFAULT 0, message TEXT, PRIMARY KEY(version,site,slot),
    UNIQUE(version,site,name))`);
  const lookup=db.prepare('SELECT * FROM erebor_helpers WHERE version=? AND site=? AND slot=?');
  db.exec('CREATE TABLE IF NOT EXISTS erebor_helper_mode(version INTEGER PRIMARY KEY,enabled INTEGER NOT NULL)');
  const isEnabled=version=>db.prepare('SELECT enabled FROM erebor_helper_mode WHERE version=?').get(version)?.enabled!==0;
  function switchAll(version,enabled){
    db.prepare('INSERT INTO erebor_helper_mode VALUES(?,?) ON CONFLICT(version) DO UPDATE SET enabled=excluded.enabled').run(version,Number(enabled));
  }
  const save=db.prepare('UPDATE erebor_helpers SET job=?,message=? WHERE version=? AND site=? AND slot=?');
  const reserved=(version,site)=>new Set(db.prepare('SELECT name FROM erebor_helpers WHERE version=? AND site=? AND name IS NOT NULL').all(version,site).map(r=>r.name));
  function list(version){
    return db.prepare('SELECT site,slot,name,completed,message FROM erebor_helpers WHERE version=? ORDER BY site,slot').all(version);
  }
  async function service(p,pair,slot,signal,at,enabled,main,current){
    const site=pair.site,key=site+slot,v=p.current_version;
    const row=lookup.get(v,site,slot);
    let job=row?.job&&JSON.parse(row.job);
    if(!signal?.state||(!job&&(!signal.ready||!enabled()||signal.upload||signal.state!=='STOPPED')))return;
    if(job?.loaded && !job.tainted && signal.upload===job.desired.file && signal.state==='RUNNING'){
      if(at<job.seen*1000)return;
      if(signal.status==='skipping' || signal.placed<(job.placed||0))job.tainted=true;
      job.started=true;job.seen=at/1000;job.placed=signal.placed;
      save.run(JSON.stringify(job),'Baut',v,site,slot);return;
    }
    if(!job){
      // Reserve before the first network await. SQLite persists the exact job across restarts.
      const taken=reserved(v,site);
      if(main.job)taken.add(main.job.desired.blueprint);
      if(main.job && main.job.phase!=='stone')return;
      for(const entry of choices.waiting(v))if(entry.site===site){
        if(!entry.name.startsWith('EREBOR_STEIN_'))return;
        taken.add(entry.name);
      }
      const {open,done}=production.ordered(p,site);
      // Published packages can be carried over from an identical previous mountain.
      // The generator names the same geometry with the current version suffix.
      const geometry=name=>name.replace(/_V\d+$/,'');
      const occupied=new Set([...taken,...done.keys()].map(geometry));
      const entry=open.find(f=>f.stage==='stone'&&!occupied.has(geometry(f.name))&&Array.isArray(f.origin)&&
        Math.hypot(...f.origin.map((n,i)=>n-pair[slot][i]))<256);
      if(!entry)return;
      const result=publishedPlan(db,p,{...entry,version:v,site,file:entry.name+'.nbt'});
      job={...result.job,source:entry};
      db.prepare(`INSERT INTO erebor_helpers(version,site,slot,name,job,message) VALUES(?,?,?,?,?,'Reserviert')
        ON CONFLICT(version,site,slot) DO UPDATE SET name=excluded.name,job=excluded.job,message=excluded.message`).run(v,site,slot,entry.name,JSON.stringify(job));
    }
    const set=message=>save.run(JSON.stringify(job),message,v,site,slot);
    const args={site:key,version:v};
    const {options,...desired}=job.desired;
    const operation={...args,desired,kind:'stone',size:job.size};
    const matches=o=>!verifyAlignment(job.desired,o,job.desired)&&same(o.components?.['create:schematic_bounds'],job.size);
    try{
      let {observed}=await request('erebor-inspect',args);
      if(!current())return;
      if(job.loaded && recordedFinish(observed,job,signal.finish,Date.now(),{signal,at})){
        tx(db,()=>{
          production.finish(v,site,desired.blueprint,new Date().toISOString());
          db.prepare("UPDATE erebor_helpers SET name=NULL,job=NULL,completed=completed+1,message='Abschnitt fertig' WHERE version=? AND site=? AND slot=?").run(v,site,slot);
        });
        return true;
      }
      if(job.tainted){set('Baufortschritt prüfen');return;}
      if(!matches(observed)){
        if(job.loaded || !observed.inputEmpty || !cannonReset(observed)){set('Wartet auf passenden Bauplan oder bestätigten Abschluss');return;}
        if(!enabled()||!signal.ready)return;
        const entry=job.source;
        const {bytes}=publishedPlan(db,p,{...entry,version:v,site,file:entry.name+'.nbt'});
        const result=await request('erebor-prepare',{...operation,nbtBase64:bytes.toString('base64')});
        if(!current())return;
        observed=result.observed;
        if(!result.applied||!matches(observed))throw Error('Einlegen noch nicht bestätigt');
      }
      job.loaded=true;
      job.baseline=observed.outputCount===0||observed.outputItem==='create:empty_schematic'?observed.outputCount:null;
      job.tainted=observed.status==='skipping'||observed.amountPlaced<(job.placed||0);
      job.seen=observed.at;job.placed=observed.amountPlaced;
      if(observed.state==='RUNNING')job.started=true;
      set(observed.status||'Eingelegt');
      if(!enabled()||!signal.ready||job.started||job.tainted||!Number.isInteger(job.baseline)||observed.flyingBlocks!==0 ||
         !['PAUSED','STOPPED'].includes(observed.state)||['missingItem','missingBlock','noGunpowder','targetNotLoaded'].includes(observed.status))return;
      const result=await request('erebor-start',operation);
      if(current()&&result.started&&matches(result.observed)){job.started=true;set('Gestartet');}
    }catch(e){if(current())set(e.message);}
  }
  return {reserved,list,isEnabled,switchAll,async tick(p,report,enabled,read,current,refresh){
    if(report?.version!==parallelLayout.version||report.sharedChest!==4||!report.stations)return;
    for(const pair of parallelLayout.sites){
      for(const slot of slots){
        if(!current())return;
        if(Date.now()-report.at>=30000&&refresh){
          report=await refresh();
          if(report?.version!==parallelLayout.version||report.sharedChest!==4||!report.stations||!current())return;
        }
        const signal=report.stations[pair.site+slot];
        if(signal?.state && Date.now()-report.at<45000){
          try{
            const active=()=>enabled(pair.site);
            const finished=await service(p,pair,slot,signal,report.at,active,read(pair.site),current);
            if(finished&&current()&&active()){
              // Re-check the empty cannon before loading its next reserved section this round.
              await service(p,pair,slot,signal,report.at,active,read(pair.site),current);
            }
          }
          catch(e){
            // A missing or corrupt package at one site cannot hold up the other 36.
            if(current())db.prepare(`INSERT INTO erebor_helpers(version,site,slot,message) VALUES(?,?,?,?)
              ON CONFLICT(version,site,slot) DO UPDATE SET message=excluded.message`).run(p.current_version,pair.site,slot,e.message);
          }
        }
      }
    }
  }};
}
