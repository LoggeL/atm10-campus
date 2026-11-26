import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {P02,registerP02} from '../src/watercity-p02.js';
import {selectionStore} from '../src/erebor-selection.js';
import {zipStore} from '../src/zip.js';

test('P02 reserves three disjoint clear/build pairs atomically, resumes its own rows and keeps other slots',async()=>{
 const db=new DatabaseSync(':memory:'),routes={};
 selectionStore(db);
 db.exec(`CREATE TABLE build_projects(id TEXT,current_version INTEGER);
 INSERT INTO build_projects VALUES('erebor',12);
 CREATE TABLE project_architecture_packages(project_id,base_version,revision,package_id,report_json,zip);
 CREATE TABLE erebor_queue_sites(state);
 CREATE TABLE erebor_helpers(version,name);
 CREATE TABLE erebor_finished_plans(version,name);`);
 let conflict;
 for(const [slot,pos,part,origin] of P02){
   const files=[],entries=[];
   for(const kind of ['clear','build']){
     const id='EREBOR_E25_'+slot+'_'+kind,data=Buffer.from(id),fileName=id+'.nbt';
     files.push({id,fileName,origin,cannon:'AP'+slot,kind,size:[32,32,32],group:'E25',protectedCells:0,unknownCells:0,clearOmitted:0,sha256:createHash('sha256').update(data).digest('hex')});
     entries.push({name:fileName,data});conflict=id;
   }
   db.prepare('INSERT INTO project_architecture_packages VALUES(?,?,?,?,?,?)').run('erebor',12,5,part,JSON.stringify({files}),zipStore(entries));
 }
 registerP02({post:(k,cb)=>{routes[k.split('/').pop()]=cb;}},{db,config:{worldSources:{live:'.'}}},async(_w,q)=>!q.completed);
 const req={actor:{via:'token',scope:'write',user:{role:'admin'}},body:{dryRun:true,baseVersion:12}};
 const reply={header(){return this;},send(x){return x;}};
 const count=()=>db.prepare('SELECT count(*) n FROM erebor_selections').get().n;
 assert.equal((await routes.reservierung(req,reply)).rows.length,6);assert.equal(count(),0);
 db.prepare("INSERT INTO erebor_selections(version,site,name,sha,job,status) VALUES(12,'APC',?,'foreign','{}','waiting')").run(conflict);
 req.body.dryRun=false;
 await assert.rejects(routes.reservierung(req,reply),/anderweitig/);assert.equal(count(),1);
 db.exec('DELETE FROM erebor_selections');
 await routes.reservierung(req,reply);await routes.reservierung(req,reply);assert.equal(count(),6);
 const row=db.prepare('SELECT * FROM erebor_selections ORDER BY id LIMIT 1').get();
 const native={slot:'A',phase:'clear',sha:row.sha,stage:'working',placed:10,computer:96};
 await routes.meldung({...req,body:native});await routes.meldung({...req,body:{...native,stage:'finished'}});
 await routes.meldung({...req,body:{...native,stage:'loaded',placed:0}});
 assert.equal(db.prepare('SELECT status FROM erebor_selections WHERE id=?').get(row.id).status,'finished');
 await assert.rejects(routes.meldung({...req,body:{...native,slot:'B'}}),/Reservierung/);
 db.close();
});
