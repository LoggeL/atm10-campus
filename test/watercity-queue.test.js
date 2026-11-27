import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {selectionStore} from '../src/erebor-selection.js';
import {zipStore} from '../src/zip.js';
import {registerWaterQueue} from '../src/watercity-queue.js';

test('all nine slots get distinct jobs, recover after restart, and hand off clear to build',async()=>{
 const db=new DatabaseSync(':memory:'),routes={};
 selectionStore(db);
 db.exec(`CREATE TABLE build_projects(id,current_version); INSERT INTO build_projects VALUES('erebor',12);
 CREATE TABLE project_architecture_packages(project_id,base_version,revision,package_id,report_json,zip,sha256);
 CREATE TABLE erebor_helpers(version,name); CREATE TABLE erebor_queue_sites(state); CREATE TABLE erebor_finished_plans(version,name);`);
 const files=[],entries=[];
 for(let x=768;x<=1152;x+=32)for(const kind of ['clear','build']){
   const id='EREBOR_E25_'+(kind==='clear'?'AUSHUB':'BAU')+'_AP720_M9200_X'+x+'_Y64_Z-9280_R5',data=Buffer.from(id),fileName=id+'.nbt';
   files.push({id,fileName,origin:[x,64,-9280],size:[32,32,32],materials:{},protectedCells:0,unknownCells:0,clearOmitted:0,group:'E25',kind,cannon:'AP720_M9200',sha256:createHash('sha256').update(data).digest('hex')});
   entries.push({name:fileName,data});
 }
 db.prepare("INSERT INTO project_architecture_packages VALUES('erebor',12,5,'E25_001',?,?,?)").run(JSON.stringify({files}),zipStore(entries),'v1');
 const app={get(){},post(path,cb){routes[path.split('/').pop()]=cb;}};
 const campus={db,config:{worldSources:{live:'.'}}};
 registerWaterQueue(app,campus,async(_w,check)=>!check.completed);
 const post=(slot,route,b)=>routes[route]({actor:{via:'token',scope:'write',user:{role:'admin'}},params:{slot},
   body:{baseVersion:12,computer:({P01:92,P02:94,P03:93})[slot.slice(0,3)],...b}});
 const get=async(slot)=>{
   const before=await post(slot,'plan',{dryRun:true});
   return post(slot,'plan',{dryRun:false,expect:before.job.desired.blueprint});
 };
 const rows=[];
 for(const s of ['P01','P02','P03'])for(const l of 'ABC')rows.push(await get(s+l));
 assert.equal(new Set(rows.map(r=>r.job.desired.blueprint)).size,9);
 assert.equal((await get('P01A')).id,rows[0].id);
 const job=rows[0], msg={id:job.id,sha:job.job.desired.sha256,placed:12};
 assert.equal((await post('P01A','meldung',{...msg,state:'CHECK'})).closed,false);
 await post('P01A','meldung',{...msg,state:'RUNNING'});
 assert.equal((await post('P01A','meldung',{...msg,state:'FINISHED',witness:true,outputBefore:0,outputAfter:1})).closed,true);
 const next=await get('P01A');assert.notEqual(next.id,job.id);
 assert.deepEqual(next.job.desired.anchor,job.job.desired.anchor);assert.equal(next.job.phase,'build');
 assert.equal((await post('P01A','meldung',{...msg,state:'FINISHED'})).closed,true);
 assert.equal((await get('P01A')).id,next.id);
 db.close();
});
