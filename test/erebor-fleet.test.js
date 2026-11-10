import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseNBT} from '../src/nbt.js';
import {wirelessReport} from '../src/erebor-wireless.js';
import {buildServer} from '../src/server.js';

test('wireless pairing distinguishes adjacent 64-bit frequencies, unused slots and duplicate endpoints',()=>{
  const bytes=Buffer.from('0a000004000166002000000000000100','hex');
  const first=parseNBT(bytes,{preserveLongs:true}).value.f;
  assert.equal(first,9007199254740993n);
  const layout={hubs:{A0:[],A1:[]},sites:[{site:'K02',hub:'A1'},{site:'K03',hub:'A1'}]};
  const device=(...f)=>({present:true,ports:f.map((frequency,i)=>({frequency,port:i+1}))});
  const points=new Map([['A1',device(first,first+2n)],['A0',device(first+2n)],['K02',device(first-1n)],['K03',device(first)]]);
  const state=r=>Object.fromEntries(r.links.filter(l=>l.hub==='A1').map(l=>[l.id,l.state]));
  assert.deepEqual(state(wirelessReport(layout,points)),{A0:'paired',K02:'unpaired',K03:'paired'});
  points.set('K02',device(first));
  assert.equal(state(wirelessReport(layout,points)).K03,'ambiguous');
});

test('operator ZIP contains current feeder and all station mappings, only for the intended project layout',async()=>{
  const temp=mkdtempSync(join(tmpdir(),'fleet-'));
  const app=await buildServer({dataDir:temp,worldSources:{},snapshotIntervalMin:0,publicUrl:'http://test',bootstrapInvite:'fleet-test',cookieSecure:false});
  try{
    const url='/api/projects/erebor/cannon-sites/installer.zip';
    assert.equal((await app.inject(url)).statusCode,401);
    const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'fleet-test',username:'fleet-admin',password:'fleet-test-password'}});
    const headers={cookie:'campus_session='+login.cookies.find(c=>c.name==='campus_session').value,'x-campus-csrf':'1'};
    assert.equal((await app.inject({url,headers})).statusCode,409);
    const layout=JSON.parse(readFileSync(new URL('../src/erebor-fleet/stations.json',import.meta.url)));
    const plan={title:'Erebor',summary:'',status:'planning',worldOrigin:null,cannonLayout:{stations:layout.sites.map(s=>({id:s.site,position:s.planned}))}};
    assert.equal((await app.inject({method:'PUT',url:'/api/projects/erebor',headers,payload:{baseVersion:0,plan}})).statusCode,200);
    const zip=await app.inject({url,headers});assert.equal(zip.statusCode,200);
    const data=zip.rawPayload;const files=new Map();let i=0;
    while(data.readUInt32LE(i)===0x04034b50){
      const len=data.readUInt32LE(i+18),n=data.readUInt16LE(i+26),start=i+30+n+data.readUInt16LE(i+28);
      files.set(data.subarray(i+30,i+30+n).toString(),data.subarray(start,start+len));i=start+len;
    }
    assert.deepEqual([...files.keys()].sort(),['ANLEITUNG.txt','Funkverbindungen.csv','campus.lua','install.py','stations.json']);
    assert.deepEqual(files.get('campus.lua'),readFileSync(new URL('../public/cc/campus.lua',import.meta.url)));
    assert.equal(JSON.parse(files.get('stations.json')).sites.length,37);
    assert.equal(files.get('Funkverbindungen.csv').toString().trim().split('\r\n').length,38);
  }finally{await app.close();app.campus.db.close();rmSync(temp,{recursive:true,force:true});}
});
