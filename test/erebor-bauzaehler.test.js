import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogProgress} from '../src/erebor-progress.js';

test('project counter separates overlapping ledgers, canonical stages, receipts and reservations',()=>{
 const files={K01:[{name:'S_V12',stage:'stone'},{name:'S_V11',stage:'stone'},{name:'B_V12',stage:'build'},{name:'C_V12',stage:'clear'},{name:'X',stage:'survey'}],K02:[]};
 const production={catalog:(_,s)=>files[s],finished:()=>new Map([['B_V11','now'],['old-history','now']])};
 const project={current_version:12};
 const active=[{site:'K01',job:{desired:{version:12,blueprint:'S_V12'}}},{site:'K01',job:{desired:{version:12,blueprint:'S_V12'}}}];
 const result=catalogProgress(production,project,['K01','K02'],active);
 assert.deepEqual(result.total.stone,{done:0,open:0,inProgress:1,total:1});
 assert.deepEqual(result.total.build,{done:1,open:0,inProgress:0,total:1});
 assert.equal(result.total.clear.total,1);assert.equal(result.total.survey.total,1);
 assert.equal(result.stations.K02.stone.total,0);
 // Assignment does not reduce remaining; only a matching canonical completion does.
 const idle=catalogProgress(production,project,['K01','K02'],[]);
 assert.equal(idle.total.stone.open,1);
 production.finished=()=>new Map([['S_V11','now']]);
 const finished=catalogProgress(production,project,['K01','K02'],active);
 assert.deepEqual(finished.total.stone,{done:1,open:0,inProgress:0,total:1});
});
