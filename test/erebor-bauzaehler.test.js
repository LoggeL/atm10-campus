import test from 'node:test';
import assert from 'node:assert/strict';
import {constructionCounter} from '../src/erebor-bauzaehler.js';

test('project counter separates overlapping ledgers, canonical stages, receipts and reservations',()=>{
 const files={K01:[{name:'S_V12',stage:'stone'},{name:'S_V11',stage:'stone'},{name:'B_V12',stage:'build'},{name:'C_V12',stage:'clear'},{name:'X',stage:'survey'}],K02:[]};
 const production={catalog:(_,s)=>files[s],ordered:()=>({done:new Map([['B_V11','now'],['old-history','now']])})};
 const counts={version:12,total:{massif:{done:2,open:3,inProgress:1}},stations:{K01:{massif:{done:1,open:2,inProgress:1}},K02:{massif:{done:1,open:1,inProgress:0}}},unassigned:{massif:{done:0,open:0,inProgress:0}}};
 const project={current_version:12};
 const active=[{site:'K01',job:{desired:{version:12,blueprint:'S_V12'}}},{site:'K01',job:{desired:{version:12,blueprint:'S_V12'}}}];
 const result=constructionCounter(production,project,['K01','K02'],active,counts,true);
 assert.deepEqual(result.stages.stone,{done:0,open:0,inProgress:1,total:1});
 assert.deepEqual(result.stages.build,{done:1,open:0,inProgress:0,total:1});
 assert.equal(result.stages.clear.total,1);assert.equal(result.stages.survey.total,1);
 assert.equal(result.massif.total,6);assert.equal(result.projectTotal,undefined);
 assert.equal(result.stations.K02.stages.stone.total,0);
 // Assignment does not reduce remaining; only a matching canonical completion does.
 const idle=constructionCounter(production,project,['K01','K02'],[],counts,true);
 assert.equal(idle.stages.stone.open,1);
 production.ordered=()=>({done:new Map([['S_V11','now']])});
 const finished=constructionCounter(production,project,['K01','K02'],active,counts,true);
 assert.deepEqual(finished.stages.stone,{done:1,open:0,inProgress:0,total:1});
 assert.equal(constructionCounter(production,project,['K01','K02'],[],counts,false).massif,null);
});
