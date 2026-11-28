import {compileErebor} from './erebor-tiles.js';
import {buildEreborDesign,DESIGN_REVISION} from './erebor-design.js';
import {finishingScene} from './erebor-gold-halls.js';
import {sectionPredecessors} from './erebor-section-prerequisites.js';
import {hallPackage,hallParents} from './erebor-hall-split.js';
import {replacementParents} from './erebor-dispatch-repair.js';
// Read-only view: missing design packages may not silently disappear from phase gates.
export function sectionScope(db){
 let compiled,view;
 return (p,surface)=>{
  if(compiled?.plan!==p.plan_json){
   const plan=JSON.parse(p.plan_json),design=buildEreborDesign(plan),scene=compileErebor(plan,design);
   compiled={plan:p.plan_json,packages:[...scene.packages,...(plan.interiorExpansion?finishingScene(plan,design).packages:[])]};
  }
  const packs=db.prepare("SELECT package_id,sha256 FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=? ORDER BY package_id").all(p.current_version,DESIGN_REVISION);
  const published=new Set(packs.map(p=>p.package_id));
  const done=new Set(db.prepare('SELECT site,name FROM erebor_finished_plans WHERE version=?').all(p.current_version).map(x=>x.site+'|'+x.name));
  for(const row of db.prepare("SELECT site,name FROM erebor_selections WHERE version=? AND status='finished'").all(p.current_version))done.add(row.site+'|'+row.name);
  const key=JSON.stringify([p.current_version,p.plan_json,packs,[...done].sort()]);
  if(view?.key!==key){
   const retired=new Set(packs.flatMap(p=>p.package_id===hallPackage?hallParents:replacementParents(p.package_id)));
   const reports=db.prepare("SELECT report_json FROM project_architecture_packages WHERE project_id='erebor' AND base_version=? AND revision=?").all(p.current_version,DESIGN_REVISION);
   const open=reports.flatMap(p=>JSON.parse(p.report_json).files).filter(f=>!retired.has(f.fileName.slice(0,-4))&&!done.has(f.cannon+'|'+f.fileName.slice(0,-4))).map(f=>({...f,stage:f.kind,name:f.fileName.slice(0,-4)}));
   view={key,open,missing:compiled.packages.filter(p=>!published.has(p.id))};
  }
  return sectionPredecessors(surface,view.open,view.missing);
 };
}
