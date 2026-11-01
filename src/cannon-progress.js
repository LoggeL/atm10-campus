import { isDeepStrictEqual as same } from 'node:util';

const count=n=>Number.isSafeInteger(n)&&n>=0;
const fresh=at=>Number.isFinite(at)&&Math.abs(Date.now()/1000-at)<=15;
const resetPrinter=p=>p&&typeof p==='object'&&!('Anchor' in p)&&!('CurrentPos' in p)&&
  Array.isArray(p.DeferredBlocks)&&p.DeferredBlocks.length===0&&p.EntityProgress===-1&&p.PrintStage==='BLOCKS';

// Native counters count launches, then reset to zero at finish. Persist the
// exact managed run before its input disappears; never add launches to a world
// snapshot (which may already contain those same blocks).
export function createCannonProgress(db, publish=()=>{}) {
  db.exec(`CREATE TABLE IF NOT EXISTS cannon_progress (
    job TEXT PRIMARY KEY, blueprint TEXT NOT NULL, version INTEGER NOT NULL,
    context_json TEXT NOT NULL, progress_json TEXT NOT NULL, created_at TEXT NOT NULL
  ); CREATE INDEX IF NOT EXISTS cannon_progress_version ON cannon_progress(blueprint,version);`);
  const read=job=>{
    const r=db.prepare('SELECT * FROM cannon_progress WHERE job=?').get(job);
    return r?{context:JSON.parse(r.context_json),data:JSON.parse(r.progress_json)}:null;
  };
  const expose=(context,d)=>({job:context.job,blueprint:context.blueprint,version:context.version,assignment:context.assignment,
    state:d.state,sent:d.sent,total:d.total,percent:d.state==='completed'?100:d.total>0?Math.min(99.9,Math.floor(d.sent/d.total*1000)/10):null,
    at:new Date(d.lastTrusted*1000).toISOString(),completedAt:d.completedAt||null,fresh:d.state==='completed'||(d.valid&&fresh(d.at))});
  const save=(context,d,createdAt)=>db.prepare(`INSERT INTO cannon_progress VALUES(?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET
    context_json=excluded.context_json,progress_json=excluded.progress_json`).run(context.job,context.blueprint,context.version,JSON.stringify(context),JSON.stringify(d),createdAt);
  const observe=({name,job,desired,receipt,binding,observed:o,aligned})=>{
    if(job?.state!=='ready'||!desired||!same(desired,receipt)||job.blueprint!==desired.blueprint||job.version!==desired.version||
      job.fileName!==desired.file||job.sha256!==desired.sha256||!same(job.origin,desired.anchor))return null;
    const context={name,job:job.id,blueprint:job.blueprint,version:job.version,assignment:desired.assignment,binding,desired};
    const previous=read(job.id),stored=previous&&same(previous.context,context)?previous.data:null;
    if(stored?.state==='completed')return expose(context,stored);
    if(!o||!fresh(o.at))return stored?{...expose(context,stored),fresh:false}:null;
    if(stored&&o.at<=stored.at)return expose(context,stored);
    let d=stored?{...stored}:null;
    if(aligned&&count(o.amountPlaced)&&count(o.amountToPlace)) {
      const outputKnown=count(o.outputCount)&&(o.outputCount===0||o.outputItem==='create:empty_schematic');
      const tainted=!!d?.tainted||o.options?.skip_missing!==false||o.status==='skipping'||(d&&o.amountPlaced<d.sent);
      d={state:'active',sent:o.amountPlaced,total:o.amountToPlace,at:o.at,lastTrusted:o.at,valid:true,
        outputBaseline:outputKnown?o.outputCount:null,armed:outputKnown&&!tainted,tainted};
    } else if(d) {
      const finishing=d.armed&&!d.tainted&&o.at-d.lastTrusted<=30&&o.state==='STOPPED'&&o.status==='finished'&&
        o.inputEmpty===true&&o.outputItem==='create:empty_schematic'&&o.outputCount===d.outputBaseline+1&&
        same(o.options,desired.options)&&o.options?.skip_missing===false&&resetPrinter(o.printer)&&
        o.amountPlaced===0&&o.amountToPlace===0&&count(o.flyingBlocks);
      if(finishing) {
        d.state=o.flyingBlocks===0?'completed':'finishing';d.lastTrusted=o.at;d.valid=true;
        if(d.state==='completed')d.completedAt=new Date(o.at*1000).toISOString();
      } else {
        // A reset, foreign input or changed options breaks the observed run.
        // A later valid sample may track counts again, but cannot erase a skip
        // or counter reset and turn a partial pass into a completion claim.
        d.armed=false;d.tainted=true;d.valid=false;d.state='active';
      }
      d.at=o.at;
    }
    if(!d)return null;
    save(context,d,job.createdAt||new Date().toISOString());
    if(d.state==='completed'&&stored?.state!=='completed')publish();
    return {...expose(context,d),fresh:!!aligned||d.state==='finishing'||d.state==='completed'};
  };
  const forVersion=(blueprint,version)=>{
    const rows=db.prepare('SELECT * FROM cannon_progress WHERE blueprint=? AND version=? ORDER BY created_at DESC,rowid DESC').all(blueprint,version);
    if(!rows.length)return null;
    const r=rows[0],context=JSON.parse(r.context_json),d=JSON.parse(r.progress_json);
    // An explicit new rest-plan supersedes the old completion even before its
    // first native observation. Unassigning a finished job preserves history.
    for(const s of db.prepare('SELECT job_json FROM cannon_schematics WHERE job_json IS NOT NULL').all()) {
      const job=JSON.parse(s.job_json);
      if(job&&job.blueprint===blueprint&&job.version===version&&job.id!==r.job&&job.createdAt>=r.created_at)return null;
    }
    return expose(context,d);
  };
  return {observe,forVersion};
}
