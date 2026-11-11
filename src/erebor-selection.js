import {createHash} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';
import {DESIGN_REVISION} from './erebor-design.js';
import {HttpError} from './auth.js';
import {storedZipEntry} from './zip.js';
import {ereborUploadName} from './erebor-file.js';

export function publishedPlan(db,p,b){
 if(!b||p.current_version!==b.version||!Number.isSafeInteger(b.sourceVersion)||!/^EREBOR_[A-Za-z0-9_-]+\.nbt$/.test(b.file||'')||!/^([a-f0-9]{64})$/.test(b.sha256||''))throw new HttpError(409,'Die Bauplanliste hat sich geändert. Bitte neu laden.');
 let row;
 if(Number.isInteger(b.part)&&b.revision==null){
  if(b.sourceVersion!==b.version){
   const plan=JSON.parse(p.plan_json),old=db.prepare("SELECT plan_json FROM build_project_versions WHERE project_id='erebor' AND version=?").get(b.sourceVersion);
   if(plan.stoneStart?.preparedBaseVersion!==b.sourceVersion||!old||!['mountainFill','worldOrigin','rotationDegrees','cannonLayout'].every(k=>same(plan[k],JSON.parse(old.plan_json)[k]))||
    db.prepare("SELECT 1 FROM project_stone_packages WHERE project_id='erebor' AND version=? AND cannon=? AND part=?").get(b.version,b.site,b.part))throw new HttpError(409,'Veraltetes Cleanstone-Paket.');
  }
  row=db.prepare("SELECT report_json,zip FROM project_stone_packages WHERE project_id='erebor' AND version=? AND cannon=? AND part=?").get(b.sourceVersion,b.site,b.part);
 }else if(b.sourceVersion===b.version&&b.revision===DESIGN_REVISION&&typeof b.part==='string'){
  row=db.prepare("SELECT report_json,zip FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? AND package_id=?").get(b.version,b.revision,b.part);
 }
 const f=row&&JSON.parse(row.report_json).files.find(f=>f.fileName===b.file&&f.cannon===b.site&&f.sha256===b.sha256);
 if(!f)throw new HttpError(409,'Diese Datei ist für die ausgewählte Kanone nicht veröffentlicht.');
 const bytes=storedZipEntry(row.zip,f.fileName);
 if(!bytes||createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw new HttpError(503,'Bauplandatei konnte nicht geprüft werden.');
 const phase=f.kind||'stone',mode={stone:0,build:2,clear:3}[phase];
 if(mode==null)throw new HttpError(409,'Unbekannte Bauplanart.');
 const desired={file:ereborUploadName(f.fileName,f.sha256),sha256:f.sha256,blueprint:f.fileName.slice(0,-4),owner:'Erebor',anchor:f.origin,version:b.version,rotation:'none',mirror:'none',options:{replace_mode:mode,skip_missing:false,replace_block_entities:false}};
 return {job:{desired,phase,size:f.size,blocks:f.blocks,materials:f.materials,loaded:false,seen:0},bytes};
}

export function unstarted(job,o){
 if(!job||job.tainted||job.started||o.amountPlaced!==0||o.flyingBlocks!==0||!Number.isSafeInteger(o.amountToPlace)||o.amountToPlace<0)return false;
 const p=o.printer;
 if(!p||p.PrintStage!=='BLOCKS'||p.EntityProgress!==-1||p.DeferredBlocks?.length!==0)return false;
 if(o.state==='STOPPED')return o.amountToPlace===0&&!p.Anchor&&!p.CurrentPos;
 return o.state==='PAUSED'&&['ready','noGunpowder'].includes(o.status)&&same(p.Anchor,job.desired.anchor)&&same(p.CurrentPos,[-1,0,0]);
}

export function selectionStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS erebor_selections(id INTEGER PRIMARY KEY,version INTEGER NOT NULL,site TEXT NOT NULL,name TEXT NOT NULL,sha TEXT NOT NULL,job TEXT NOT NULL,bytes BLOB,previous TEXT,status TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS erebor_selection_pending ON erebor_selections(version,site,name,sha) WHERE status='waiting';`);
 return {
  add(v,site,job,bytes,previous){
   const key=[v,site,job.desired.blueprint,job.desired.sha256];
   const existing=db.prepare("SELECT id,status FROM erebor_selections WHERE version=? AND site=? AND name=? AND sha=? AND status='waiting'").get(...key);
   if(existing)return existing;
   const id=db.prepare("INSERT INTO erebor_selections(version,site,name,sha,job,bytes,previous,status) VALUES(?,?,?,?,?,?,?,'waiting')").run(...key,JSON.stringify(job),bytes,previous).lastInsertRowid;
   return {id:Number(id),status:'waiting'};
  },
  next:(v,site)=>db.prepare("SELECT id,job,previous FROM erebor_selections WHERE version=? AND site=? AND status='waiting' ORDER BY id LIMIT 1").get(v,site),
  bytes:id=>db.prepare('SELECT bytes FROM erebor_selections WHERE id=?').get(id).bytes,
  mark:(id,status)=>{if(id)db.prepare('UPDATE erebor_selections SET status=?,bytes=NULL WHERE id=?').run(status,id);},
  completed:(v,site,name)=>!!db.prepare("SELECT 1 FROM erebor_selections WHERE version=? AND site=? AND name=? AND status='finished'").get(v,site,name),
  waiting:v=>db.prepare("SELECT id,site,name,sha FROM erebor_selections WHERE version=? AND status='waiting' ORDER BY id").all(v),
  active:v=>db.prepare("SELECT DISTINCT site FROM erebor_selections WHERE version=? AND status IN ('waiting','loaded')").all(v).map(r=>r.site)
 };
}
