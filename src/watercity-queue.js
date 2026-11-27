import {requireActor,HttpError} from './auth.js';
import {tx} from './db.js';
import {publishedPlan} from './erebor-selection.js';
import {inRange} from './erebor-interior.js';
import {DESIGN_REVISION} from './erebor-design.js';
import {terrain,P02} from './watercity-p02.js';
import {WATER_GROUPS} from './watercity.js';
import {Worker} from 'node:worker_threads';
import {ereborUploadName} from './erebor-file.js';

export const positions=Object.fromEntries([
  ...WATER_GROUPS.filter(g=>g.positions).flatMap(g=>Object.entries(g.positions).map(([s,p])=>[g.id+s,p])),
  ...P02.map(([s,p])=>['P02'+s,p])
]);
const fail=m=>{throw new HttpError(409,m);};
const version=12, revision=5, base='/api/projects/erebor/wasserstadt/betrieb';
const computer={P01:92,P02:94,P03:93};

export function registerWaterQueue(app,campus,check=terrain){
  const db=campus.db, world=campus.config.worldSources.live;
  db.exec(`CREATE TABLE IF NOT EXISTS watercity_dispatch(
    id INTEGER PRIMARY KEY, slot TEXT NOT NULL, closed INTEGER NOT NULL DEFAULT 0,
    at INTEGER, state TEXT, placed INTEGER, total INTEGER, detail TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS watercity_open_slot ON watercity_dispatch(slot) WHERE closed=0;`);
  const current=()=>db.prepare("SELECT * FROM build_projects WHERE id='erebor'").get();
  const active=slot=>db.prepare('SELECT s.*,w.closed FROM watercity_dispatch w JOIN erebor_selections s ON s.id=w.id WHERE w.slot=? AND w.closed=0').get(slot);
  const records=()=>db.prepare("SELECT id,name,status,job FROM erebor_selections WHERE version=?").all(version);
  const doc=r=>JSON.parse(r.job);
  const tileKey=f=>f.origin.join(',');
  let cache, busy=false;
  const skipped=new Map();
  function index(){
    const packs=db.prepare("SELECT package_id,sha256 FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? AND (package_id LIKE 'E25_%' OR package_id LIKE 'E26_%') ORDER BY package_id").all(version,revision);
    const stamp=packs.map(p=>p.sha256).join('/');
    if(cache?.stamp===stamp)return cache;
    const tiles=new Map(),byName=new Map();
    const stmt=db.prepare("SELECT report_json FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? AND package_id=?");
    for(const p of packs)for(const f of JSON.parse(stmt.get(version,revision,p.package_id).report_json).files){
      if(!['E25','E26'].includes(f.group)||!['clear','build'].includes(f.kind))continue;
      const key=tileKey(f), t=tiles.get(key)??{};
      t[f.kind]={...f,part:p.package_id}; tiles.set(key,t);byName.set(f.id,t[f.kind]);
      if(f.unknownCells||f.clearOmitted)t.unsafe=true;
    }
    skipped.clear();cache={stamp,tiles,byName};return cache;
  }
  function valid(slot,b){
    if(!Object.hasOwn(positions,slot)||b.baseVersion!==version||DESIGN_REVISION!==revision||current()?.current_version!==version||
      b.computer!==computer[slot.slice(0,3)])fail('Standort, Computer oder Projektversion abweichend.');
  }
  function ownership(slot){
    const open=active(slot);
    if(open)return open;
    const prev=records().filter(r=>{
      const j=doc(r);return ['waiting','loaded'].includes(r.status)&&(j.watercity?.slot===slot||j.p02?.slot===slot);
    });
    if(prev.length>1)fail('Mehrere alte Aufträge müssen mit dem eingelegten Plan abgeglichen werden.');
    return prev[0];
  }
  function desc(f){
    return publishedPlan(db,current(),{version,sourceVersion:version,revision,part:f.part,site:f.cannon,file:f.fileName,sha256:f.sha256});
  }
  function materialize(row,f){
    const {job}=desc(f);
    if(row&&row.sha!==f.sha256)fail('Veröffentlichter Plan hat sich geändert.');
    return {id:row?.id??null,part:f.part,job,adopted:!!(row&&(doc(row).watercity||doc(row).p02||doc(row).adopted))};
  }
  function usage(){
    const used=new Map(records().map(r=>[r.name,r.status]));
    for(const r of db.prepare('SELECT name FROM erebor_finished_plans WHERE version=?').all(version))used.set(r.name,'finished');
    for(const r of db.prepare('SELECT name FROM erebor_helpers WHERE version=?').all(version))if(r.name)used.set(r.name,'busy');
    for(const r of db.prepare("SELECT json_extract(state,'$.job.desired.blueprint') name FROM erebor_queue_sites").all())if(r.name)used.set(r.name,'busy');
    return used;
  }
  function candidate(tile,used){
    if(tile.unsafe)return null;
    if(tile.build&&used.has(tile.build.id))return null;
    if(tile.clear&&used.get(tile.clear.id)!=='finished')return used.has(tile.clear.id)?null:tile.clear;
    return tile.build;
  }
  app.post(base+'/:slot/plan',async req=>{
    requireActor(req,'write');
    const b=req.body??{},slot=req.params.slot; valid(slot,b);
    if(typeof b.dryRun!=='boolean')throw new HttpError(400,'dryRun angeben.');
    if(busy)throw new HttpError(429,'Andere Wasserstadt-Vergabe läuft.');
    busy=true;
    try{
      const idx=index(),existing=ownership(slot);
      if(existing){
        const f=idx.byName.get(existing.name);
        if(!f||!inRange(f.origin,f.size,positions[slot]))fail('Aktiver Plan ist für diese Kanone nicht mehr gültig.');
        if(!b.dryRun){
          if(b.expect!==f.id)fail('Vorprüfung wiederholen.');
          db.prepare('INSERT OR IGNORE INTO watercity_dispatch(id,slot) VALUES(?,?)').run(existing.id,slot);
        }
        return materialize(existing,f);
      }
      const used=usage(), options=[];
      if(b.input){
        const f=[...idx.byName.values()].find(f=>ereborUploadName(f.fileName,f.sha256)===b.input.file);
        if(!f||!inRange(f.origin,f.size,positions[slot])||f.sha256!==b.input.sha||String(f.origin)!==String(b.input.anchor)||
            used.has(f.id))fail('Eingelegter Plan ist unbekannt, bereits verbucht oder anderweitig vergeben.');
        if(b.dryRun)return {...materialize(null,f),adopted:true};
        if(b.expect!==f.id)fail('Eingelegter Plan geändert.');
        return tx(db,()=>{
          if(ownership(slot)||usage().has(f.id))fail('Eingelegter Plan inzwischen vergeben.');
          const {job}=desc(f);
          const id=Number(db.prepare("INSERT INTO erebor_selections(version,site,name,sha,job,status) VALUES(?,?,?,?,?,'loaded')").run(version,'WC-'+slot,f.id,f.sha256,JSON.stringify({...job,adopted:true})).lastInsertRowid);
          db.prepare('INSERT INTO watercity_dispatch(id,slot) VALUES(?,?)').run(id,slot);
          return {id,part:f.part,job,adopted:true};
        });
      }
      for(const tile of idx.tiles.values()){
        const f=candidate(tile,used);
        if(!f||!inRange(f.origin,f.size,positions[slot])||(skipped.get(f.id)??0)>Date.now())continue;
        const distance=Math.hypot(...f.origin.map((n,i)=>n-positions[slot][i]));
        options.push({f,distance,tile});
      }
      options.sort((a,b)=>a.f.origin[1]-b.f.origin[1]||a.distance-b.distance||a.f.id.localeCompare(b.f.id));
      for(const {f,tile} of options.slice(0,6)){
        if(!b.dryRun&&b.expect!==f.id)fail('Vergabe geändert. Vorprüfung wiederholen.');
        const {job,bytes}=desc(f);
        const approved=await check(world,{bytes,anchor:f.origin,kind:f.kind,watercity:true});
        if(approved!==true){skipped.set(f.id,Date.now()+1800000);continue;}
        if(b.dryRun)return {id:null,part:f.part,job};
        return tx(db,()=>{
          valid(slot,b);
          if(ownership(slot)||candidate(tile,usage())?.id!==f.id)fail('Bauplan inzwischen vergeben.');
          const id=Number(db.prepare("INSERT INTO erebor_selections(version,site,name,sha,job,status) VALUES(?,?,?,?,?,'waiting')").run(version,'WC-'+slot,f.id,f.sha256,JSON.stringify(job)).lastInsertRowid);
          db.prepare('INSERT INTO watercity_dispatch(id,slot) VALUES(?,?)').run(id,slot);
          return {id,part:f.part,job};
        });
      }
      return {id:null,job:null};
    }finally{busy=false;}
  });
  app.post(base+'/:slot/meldung',async req=>{
    requireActor(req,'write');
    const b=req.body??{},slot=req.params.slot;valid(slot,b);
    const stored=db.prepare('SELECT s.*,w.closed FROM watercity_dispatch w JOIN erebor_selections s ON w.id=s.id WHERE w.slot=? AND w.id=?').get(slot,b.id);
    if(!stored||stored.sha!==b.sha)fail('Auftrag stimmt nicht.');
    if(stored.closed)return {closed:true};
    if(!['RUNNING','PAUSED','LOADED','FINISHED','CHECK','WAIT'].includes(b.state)||!Number.isSafeInteger(b.placed)||b.placed<0)throw new HttpError(400,'Ungültige Kanonenmeldung.');
    const last=db.prepare('SELECT state,placed FROM watercity_dispatch WHERE id=?').get(b.id);
    let finished=false;
    if(b.state==='CHECK'||b.state==='FINISHED'){
      const f=index().byName.get(stored.name),{bytes}=desc(f);
      finished=await check(world,{bytes,anchor:f.origin,kind:f.kind,watercity:true,completed:true})===true;
      if(!finished&&b.state==='FINISHED'&&['RUNNING','LOADED','PAUSED'].includes(last.state)&&
         b.witness===true&&Number.isSafeInteger(b.outputBefore)&&b.outputBefore>=0&&b.outputAfter===b.outputBefore+1&&b.placed>=last.placed)finished=true;
      if(!finished)return {closed:false};
    }
    return tx(db,()=>{
      valid(slot,b);
      if(active(slot)?.id!==b.id)return {closed:true};
      const j=doc(stored);j.loaded ||= ['RUNNING','PAUSED','LOADED'].includes(b.state);
      j.started ||= b.placed>0;
      const placed=Math.max(b.placed,last.placed||0);
      db.prepare('UPDATE watercity_dispatch SET closed=?,at=?,state=?,placed=?,total=?,detail=? WHERE id=?')
        .run(finished?1:0,Date.now(),finished?'FINISHED':b.state,placed,Number.isSafeInteger(b.total)?b.total:null,String(b.detail??'').slice(0,900),b.id);
      db.prepare('UPDATE erebor_selections SET job=?,status=? WHERE id=?').run(JSON.stringify(j),finished?'finished':j.loaded?'loaded':'waiting',b.id);
      return {closed:finished};
    });
  });
  const report=()=>db.prepare(`SELECT w.slot,w.id,w.closed,w.at,w.state,w.detail,w.placed,w.total,s.name FROM watercity_dispatch w JOIN erebor_selections s ON s.id=w.id ORDER BY w.id DESC`).all();
  campus.waterQueueReport=report;
  app.get(base,async(req,reply)=>{requireActor(req,'read');return reply.header('Cache-Control','no-store').send({version,at:Date.now(),rows:report()});});
  let saved;
  app.get(base+'/weltstand',async(req,reply)=>{
    requireActor(req,'read');
    if(!saved||Date.now()-saved.at>15000){
      const promise=new Promise((resolve,reject)=>{
        const w=new Worker(new URL('./watercity-saved-worker.js',import.meta.url),{workerData:{world,positions}});
        const timer=setTimeout(()=>{void w.terminate();reject(new HttpError(503,'Zeitlimit beim Lesen der Welt.'));},20000);
        w.once('error',e=>{clearTimeout(timer);reject(e);});
        w.once('message',rows=>{clearTimeout(timer);resolve({at:Date.now(),source:'saved-chunks',rows});});
      });
      saved={at:Date.now(),promise};
    }
    return reply.header('Cache-Control','no-store').send(await saved.promise);
  });
}
