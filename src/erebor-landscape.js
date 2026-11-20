import {requireActor,HttpError} from './auth.js';
import {tx,logActivity} from './db.js';
import {mountainTop} from './project-stone.js';

export function registerLandscape(app,db){
 const path='/api/projects/erebor/landschaft';
 db.exec('CREATE TABLE IF NOT EXISTS erebor_landscape(project_version INTEGER PRIMARY KEY,revision INTEGER NOT NULL,draft TEXT NOT NULL)');
 const row=v=>db.prepare('SELECT revision,draft FROM erebor_landscape WHERE project_version=?').get(v);
 const text=s=>typeof s==='string'&&s.length>0&&s.length<=650;
 const list=(a,min,max,valid)=>Array.isArray(a)&&a.length>=min&&a.length<=max&&a.every(valid);
 function validate(d,p){
  const [lo,hi]=p.mountainFill.bounds;
  const inside=(x,z)=>Number.isSafeInteger(x)&&x>=lo[0]&&x<hi[0]&&Number.isSafeInteger(z)&&z>=lo[2]&&z<hi[2];
  const height=y=>Number.isSafeInteger(y)&&y>=-64&&y<=319;
  return text(d?.summary)&&list(d.bands,1,10,r=>list(r,3,3,text))&&list(d.steps,1,12,text)&&
   list(d.sites,1,15,r=>Array.isArray(r)&&r.length===4&&inside(r[0],r[2])&&height(r[1])&&text(r[3]))&&
   Array.isArray(d.summit)&&d.summit.length===3&&inside(d.summit[0],d.summit[2])&&height(d.summit[1])&&
   list(d.profile,2,40,r=>Array.isArray(r)&&r.length===2&&inside(r[0],d.summit[2])&&height(r[1])&&mountainTop(p,r[0],d.summit[2])!=null)&&
   d.profile.every((r,i)=>i===0||r[0]>d.profile[i-1][0])&&d.profile.some(r=>r[0]===d.summit[0]&&r[1]===d.summit[1]);
 }
 function source(){
  const r=db.prepare("SELECT current_version,plan_json FROM build_projects WHERE id='erebor'").get();
  if(!r)throw new HttpError(404,'Erebor fehlt.');
  const p=JSON.parse(r.plan_json);
  if(!p.mountainFill?.bounds)throw new HttpError(409,'Erebor hat noch kein Bergprofil.');
  return {v:r.current_version,p};
 }
 function read(v,p){
  const saved=row(v),draft=saved?JSON.parse(saved.draft):null;
  return {projectVersion:v,revision:saved?.revision??0,draft,profile:draft?.profile.map(([x,y])=>[x,mountainTop(p,x,draft.summit[2]),y])??[]};
 }
 app.get(path,async(req,reply)=>{requireActor(req,'read');const {v,p}=source();return reply.header('Cache-Control','private, no-store').send(read(v,p));});
 app.put(path,{bodyLimit:32*1024},async req=>{
  const actor=requireActor(req,'write'),b=req.body;
  return tx(db,()=>{
   const {v,p}=source(),old=row(v);
   if(b?.projectVersion!==v||b?.baseVersion!==(old?.revision??0))throw new HttpError(409,'Berg- oder Entwurfsversion inzwischen geändert.');
   if(typeof b.dryRun!=='boolean'||!validate(b.draft,p))throw new HttpError(400,'Landschaftsentwurf und Höhenprofil prüfen.');
   const data=JSON.stringify(b.draft),changed=old?.draft!==data,revision=b.baseVersion+Number(changed);
   if(!b.dryRun&&changed){
    db.prepare('INSERT INTO erebor_landscape VALUES(?,?,?) ON CONFLICT(project_version) DO UPDATE SET revision=excluded.revision,draft=excluded.draft').run(v,revision,data);
    logActivity(db,actor,'project.landscape','erebor',{projectVersion:v,revision});
   }
   return {dryRun:b.dryRun,projectVersion:v,revision,changed};
  });
 });
}
