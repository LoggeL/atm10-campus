import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {massifProgress} from '../src/erebor-progress.js';
import {readyUrnPack} from '../src/erebor-manual-urn.js';
import {surfaceOverview} from '../src/api-erebor-surface.js';
import { dashboardData } from '../src/erebor-dashboard.js';

test('ready pack needs the correct unstarted input, identity, options, and fuel',()=>{
 const job={massif:'M_URN_PACK_123',size:[4,2,2],desired:{file:'pack',owner:'Erebor',anchor:[2,3,4]}};
 const signal={ready:true,aligned:true,state:'PAUSED',status:'ready',placed:0,fuel:1,options:[0,false,false],upload:'pack',owner:'Erebor',anchor:[2,3,4],size:[4,2,2]};
 assert.ok(readyUrnPack(job,signal));
 for(const changed of [{upload:'other'},{fuel:0},{placed:1},{options:[2,false,false]},{status:'missingBlock'}])assert.ok(!readyUrnPack(job,{...signal,...changed}));
 assert.ok(!readyUrnPack({...job,started:true},signal));
});

test('exterior publication uses only the current draft revision',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE erebor_landscape(project_version,revision,draft);CREATE TABLE erebor_surface_parts(v,r,summary)');
  const project={current_version:12,plan_json:JSON.stringify({mountainFill:{bounds:[[0,0,0],[600,320,100]]}})};
  assert.equal(surfaceOverview(db,project),null);
  db.prepare('INSERT INTO erebor_landscape VALUES(12,2,?)').run(JSON.stringify({summit:[1,319,2]}));
  const add=db.prepare('INSERT INTO erebor_surface_parts VALUES(12,?,?)');
  for(const revision of [1,2])add.run(revision,JSON.stringify({files:8,blocks:139,trees:2}));
  assert.deepEqual(surfaceOverview(db,project),{regions:2,revision:2,summitY:319,files:8,blocks:139,trees:2,published:1});
 }finally{db.close();}
});

test('dashboard separates published tasks, reports actual slot/home, and expires all native progress', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE erebor_urn_jobs(v,site,points); CREATE TABLE erebor_massif_tiles(v,tile,home,site,slot,special,done,blocks);
      INSERT INTO erebor_massif_tiles VALUES (12,'FIX_R2_LUFT','K01','K02','B',0,0,80),(12,'SOLID','K02','K02','C',0,1,5),
      (12,'MANUAL','K02',NULL,NULL,1,0,2),(12,'X01_Z00_URN_10_2_5_BE','K02',NULL,NULL,1,0,1),
      (12,'FREE','K01',NULL,NULL,0,0,10),(11,'OLD','K01',NULL,NULL,0,0,20)`);
    const report = {
      at: 1000,
      version: 12,
      stations: {
        K01: { state: 'STOPPED', empty: true },
        K02B: { state: 'RUNNING', status: 'placing', upload: 'current', aligned: true, placed: 23, total: 80 },
      },
    };
    const jobs = new Map([['K02B', { loaded: true, desired: { file: 'current', blueprint: 'STONE' } }]]);
    const read = (now) =>
      dashboardData(
        db,
        12,
        ['K01', 'K02'],
        report,
        jobs,
        massifProgress(db,12,['K01','K02']).filling,
        { enabled: () => true, lastBalancedAt: () => null },
        now,
      );
    const before = db.prepare('SELECT total_changes() n').get().n;
    const view = read(1200);
    assert.equal(view.fleet.length, 6);
    assert.equal(view.filling.solid.done, 1);
    assert.equal(view.filling.solid.open, 1);
    assert.equal(view.filling.cavity.inProgress, 1);
    assert.equal(view.filling.manual.open, 1);
    assert.equal(view.filling.urn.open, 1);
    assert.equal(view.fleet[0].state, 'idle');
    assert.equal(view.fleet[1].state, 'unknown');
    const helper = view.fleet.find((r) => r.site === 'K02' && r.slot === 'B');
    assert.equal(helper.home, 'K01');
    assert.equal(helper.placed, 23);
    assert.equal(helper.state, 'placing');
    assert.ok(read(47000).fleet.every((r) => r.state === 'unknown' && r.placed === null));
    report.stations.K02B.upload = 'other';
    assert.equal(read(1200).fleet[4].state, 'unverified');
    assert.equal(db.prepare('SELECT total_changes() n').get().n, before);
    // A sparse pack reserves one queue slot but owns every remaining target in it.
    db.exec("UPDATE erebor_massif_tiles SET site='K02',slot='C' WHERE tile='X01_Z00_URN_10_2_5_BE'; INSERT INTO erebor_massif_tiles VALUES(12,'X01_Z00_URN_11_2_5_BE','K01',NULL,NULL,1,0,1)");
    const members=['X01_Z00_URN_10_2_5_BE','X01_Z00_URN_11_2_5_BE'].map(tile=>({tile}));
    db.prepare('INSERT INTO erebor_urn_jobs VALUES(12,?,?)').run('K02',JSON.stringify(members));
    jobs.set('K02C',{massif:'M_URN_PACK_x',blocks:2,desired:{blueprint:'Paket'}});
    const packs=read(1200);
    assert.equal(packs.filling.urn.inProgress,2);
    assert.equal(packs.filling.urn.open,0);
    assert.equal(packs.fleet.find(r=>r.site==='K02'&&r.slot==='C').planBlocks,2);
  } finally {
    db.close();
  }
});
