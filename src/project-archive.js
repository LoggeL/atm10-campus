import {tx,now,logActivity} from './db.js';
import {HttpError} from './auth.js';

export function setProjectArchive(db,id,version,archived,actor=null){
 return tx(db,()=>{
  const p=db.prepare('SELECT current_version,plan_json FROM build_projects WHERE id=?').get(id);
  if(!p||p.current_version!==version||typeof archived!=='boolean')throw new HttpError(409,'Projektversion oder Archivstatus stimmt nicht.');
  if(JSON.parse(p.plan_json).kind!=='blueprint_collection')throw new HttpError(409,'Nur bestehende Bauplansammlungen können hier archiviert werden.');
  const changed=archived?db.prepare('INSERT OR IGNORE INTO project_archive(project_id,archived_at) VALUES(?,?)').run(id,now()):db.prepare('DELETE FROM project_archive WHERE project_id=?').run(id);
  if(changed.changes)logActivity(db,actor,archived?'project.archive':'project.restore',id,{version});
  return {id,version,archived};
 });
}
