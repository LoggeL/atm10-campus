import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionIssues,renderConnectionIssues,renderFleetIssues} from '../public/assets/connection-status.js';
test('fresh offline bridge remains visible even when the assignment is paused or done; never invent power cause',()=>{
 const c={name:'K05',online:true,state:'done',status:{state:'error',message:'ME Bridge offline (Kanal/Strom?)',at:'2026-11-14T17:00:00Z'}};
 assert.match(renderConnectionIssues(c),/ME-Verbindung offline/);
 assert.match(renderConnectionIssues(c),/Ursache unbekannt/);
 assert.doesNotMatch(renderConnectionIssues(c),/Kein Strom/);
 assert.equal(connectionIssues(c).length,1);
 const measured={...c,network:{at:Date.now(),source:'AE2 server-thread',loaded:true,powered:false,online:false,channelsSatisfied:false,booting:true}};
 assert.match(renderConnectionIssues(measured),/Kein Strom/);
 assert.match(renderConnectionIssues(measured),/Kanalmangel/);
 assert.match(renderConnectionIssues(measured),/Netz startet/);
 assert.match(renderConnectionIssues({...c,network:{at:Date.now(),loaded:false}}),/Chunk ungeladen/);
 assert.match(renderConnectionIssues({...measured,network:{...measured.network,at:1}}),/Netzdiagnose veraltet/);
 assert.doesNotMatch(renderConnectionIssues({...measured,network:{...measured.network,at:1}}),/Kein Strom/);
 assert.match(renderFleetIssues(Array.from({length:37},(_,i)=>({...c,name:'K'+i}))),/37\/37/);
});
