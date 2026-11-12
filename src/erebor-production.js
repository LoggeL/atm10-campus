import {isDeepStrictEqual} from 'node:util';
import {DESIGN_REVISION} from './erebor-design.js';
import {tx} from './db.js';

const phaseOrder = {stone: 0, clear: 1, build: 2};

export function productionStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS erebor_automatic (
      version INTEGER NOT NULL, site TEXT NOT NULL, enabled INTEGER NOT NULL, started_upload TEXT,
      PRIMARY KEY(version,site));
    CREATE TABLE IF NOT EXISTS erebor_finished_plans (
      version INTEGER NOT NULL, site TEXT NOT NULL, name TEXT NOT NULL, finished_at TEXT,
      PRIMARY KEY(version,site,name));
    CREATE TABLE IF NOT EXISTS erebor_priority (
      id INTEGER PRIMARY KEY, version INTEGER NOT NULL, site TEXT NOT NULL, name TEXT NOT NULL,
      UNIQUE(version,site,name));
    CREATE TABLE IF NOT EXISTS erebor_history_migrations (version INTEGER PRIMARY KEY);`);
  const finish = db.prepare('INSERT OR IGNORE INTO erebor_finished_plans VALUES(?,?,?,?)');
  const getState = db.prepare('SELECT enabled,started_upload FROM erebor_automatic WHERE version=? AND site=?');
  const finishedRows = db.prepare('SELECT name,finished_at FROM erebor_finished_plans WHERE version=? AND site=?');
  const priorities = db.prepare('SELECT name FROM erebor_priority WHERE version=? AND site=? ORDER BY id DESC');
  const cache = new Map();

  // Packages are immutable. A new publication can add another package at any time.
  function catalog(project,site) {
    const version=project.current_version, key=version+':'+site, previous=cache.get(key);
    if(previous && Date.now()-previous.at<10000) return previous.files;
    const rows=db.prepare("SELECT version,part,report_json FROM project_stone_packages WHERE project_id='erebor' AND version=? AND cannon=? ORDER BY part");
    const packages=rows.all(version,site);
    const configuration=JSON.parse(project.plan_json), base=configuration.stoneStart?.preparedBaseVersion;
    if(Number.isSafeInteger(base)&&base<version){
      const old=db.prepare("SELECT plan_json FROM build_project_versions WHERE project_id='erebor' AND version=?").get(base);
      const prior=old&&JSON.parse(old.plan_json);
      if(prior&&['mountainFill','worldOrigin','rotationDegrees','cannonLayout'].every(k=>isDeepStrictEqual(configuration[k],prior[k]))){
        const found=new Set(packages.map(p=>p.part));
        packages.push(...rows.all(base,site).filter(p=>!found.has(p.part)));
      }
    }
    const files=[];
    for(const pkg of packages.sort((a,b)=>a.part-b.part)){
      for(const f of JSON.parse(pkg.report_json).files){
        if(f.cannon===site) files.push({name:f.fileName.slice(0,-4),sha256:f.sha256,stage:'stone',blocks:f.blocks,sourceVersion:pkg.version,part:pkg.part});
      }
    }
    const architecture=[];
    const arch=db.prepare("SELECT package_id,report_json FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? ORDER BY package_id").all(version,DESIGN_REVISION);
    for(const pkg of arch) for(const f of JSON.parse(pkg.report_json).files){
      if(f.cannon===site) architecture.push({name:f.fileName.slice(0,-4),sha256:f.sha256,stage:f.kind,blocks:f.blocks,y:f.origin[1],sourceVersion:version,revision:DESIGN_REVISION,part:pkg.package_id});
    }
    architecture.sort((a,b)=>phaseOrder[a.stage]-phaseOrder[b.stage] || a.y-b.y || a.name.localeCompare(b.name));
    files.push(...architecture);
    cache.set(key,{at:Date.now(),files});
    return files;
  }

  function ordered(project,site) {
    const version=project.current_version;
    const done=new Map(finishedRows.all(version,site).map(r=>[r.name,r.finished_at]));
    const priority=priorities.all(version,site).map(r=>r.name);
    const files=catalog(project,site), byName=new Map(files.map(f=>[f.name,f]));
    const preferred=priority.filter(name=>byName.has(name)&&!done.has(name));
    const seen=new Set([...preferred,...done.keys()]);
    const open=[...preferred.map(name=>byName.get(name)),...files.filter(f=>!seen.has(f.name))];
    return {open,done,preferred};
  }

  function migrate(){
    const conf=db.prepare('SELECT version,phase FROM erebor_queue_config WHERE id=1').get();
    if(!conf||db.prepare('SELECT 1 FROM erebor_history_migrations WHERE version=?').get(conf.version))return;
    tx(db,()=>{
      const {version}=conf;
      for(const {site,state} of db.prepare('SELECT site,state FROM erebor_queue_sites').all()){
        const s=JSON.parse(state);
        const manual=db.prepare("SELECT name FROM erebor_selections WHERE version=? AND site=? AND status='finished'").all(version,site);
        const reconciled=db.prepare("SELECT at,detail_json FROM activity WHERE action='erebor.plan.reconcile' AND target=?").all(site).filter(r=>{
          const name=JSON.parse(r.detail_json).file;
          return typeof name==='string'&&name.endsWith('_V'+version);
        });
        for(const r of reconciled)finish.run(version,site,JSON.parse(r.detail_json).file,r.at);
        for(const r of manual)finish.run(version,site,r.name,null);
        // A complete prefix and a matching count identify the old sequential jobs.
        // Incomplete packages or ambiguous counters cannot establish individual finishes.
        const unknown=s.completed-manual.length-reconciled.length;
        if(conf.phase==='stone'&&unknown>0&&s.cursor>0){
          const prefix=[];
          for(const r of db.prepare("SELECT part,report_json FROM project_stone_packages WHERE project_id='erebor' AND version=? AND cannon=? ORDER BY part").all(version,site)){
            if(r.part!==Math.floor(prefix.length/16)+1)break;
            const report=JSON.parse(r.report_json);
            if(!Array.isArray(report.skipped)||report.skipped.length)break;
            prefix.push(...report.files.map(f=>f.fileName.slice(0,-4)));
            if(prefix.length>=s.cursor)break;
          }
          const known=new Set(finishedRows.all(version,site).map(r=>r.name));
          const candidates=prefix.slice(0,s.cursor).filter(name=>!known.has(name));
          if(prefix.length>=s.cursor&&candidates.length===unknown)for(const name of candidates)finish.run(version,site,name,null);
        }
      }
      db.prepare('INSERT INTO erebor_history_migrations VALUES(?)').run(version);
    });
  }
  migrate();
  return {
    ordered,
    done:(v,site,name)=>!!db.prepare('SELECT 1 FROM erebor_finished_plans WHERE version=? AND site=? AND name=?').get(v,site,name),
    finish(v,site,name,at){if(name)finish.run(v,site,name,at);db.prepare('DELETE FROM erebor_priority WHERE version=? AND site=? AND name=?').run(v,site,name??'');},
    mode:(v,site)=>getState.get(v,site)??{enabled:0,started_upload:null},
    enabled:v=>db.prepare('SELECT site FROM erebor_automatic WHERE version=? AND enabled=1 ORDER BY site').all(v).map(r=>r.site),
    switch(v,site,enabled){
      db.prepare('INSERT INTO erebor_automatic VALUES(?,?,?,NULL) ON CONFLICT(version,site) DO UPDATE SET enabled=excluded.enabled,started_upload=NULL WHERE enabled<>excluded.enabled').run(v,site,Number(enabled));
    },
    started:(v,site,file)=>db.prepare('UPDATE erebor_automatic SET started_upload=? WHERE version=? AND site=? AND enabled=1').run(file,v,site),
    promote(v,site,name){db.prepare('INSERT OR REPLACE INTO erebor_priority(version,site,name) VALUES(?,?,?)').run(v,site,name);},
    priority:(v,site)=>priorities.get(v,site)?.name
  };
}
