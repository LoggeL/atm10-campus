import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';

const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Watercity aliases serve the actual protected project home shell, not the old independent page', async()=>{
 const dir=mkdtempSync(join(process.env.TMPDIR,'project-shell-'));
 const app=await buildServer({dataDir:dir,worldSources:{},bootstrapInvite:'shell-test',cookieSecure:false,snapshotIntervalMin:0,publicUrl:'http://test'});
 try {
  const urls=['/projects?id=erebor&area=wasserstadt','/erebor/wasserstadt','/app?project=wasserstadt'];
  for(const url of urls)assert.equal((await app.inject(url)).statusCode,302);
  const login=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:'shell-test',username:'shell-test',password:'shell-test-password'}});
  const headers={cookie:login.headers['set-cookie'].split(';')[0]};
  for(const url of urls){
   const r=await app.inject({url,headers});assert.equal(r.statusCode,200);
   assert.match(r.body,/class="projects-page"/);
   assert.match(r.body,/id="projectToolbar"/);
   assert.match(r.body,/assets\/projects\.js/);
   assert.doesNotMatch(r.body,/assets\/watercity\.css/);
   assert.match(r.headers['cache-control'],/private.*no-store/);
  }
  const orders=await app.inject({url:'/app?project=erebor',headers});
  assert.match(orders.body,/<option value="wasserstadt">Wasserstadt/);
  assert.match(orders.body,/assets\/app\.js/);
  const archive=await app.inject({url:'/app?project=campus',headers});
  assert.match(archive.body,/<option value="campus">Campus \(Archiv\)/);
 }finally{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('Erebor and its real areas use the same hero, metrics, section and nav components',async()=>{
 const {projectHero,projectNav,projectSection}=await import('../public/assets/project-shell.js');
 const hero=projectHero({title:'Wasserstadt',status:'Teilbereich · Erebor',summary:'E25 & E26',metrics:[['6','Belegte Plätze']],actions:'<a href="#layout">Karte</a>'});
 for(const cls of ['project-hero','project-metrics','project-metric'])assert.ok(hero.includes(cls));
 assert.match(hero,/E25 &amp; E26/);
 assert.match(projectNav([['layout','Karte']]),/class="project-nav"/);
 assert.match(projectSection('layout','Karte','<svg></svg>',true),/project-section-card/);
 const renderer=file('public/assets/projects.js');
 assert.match(renderer,/projectHero\(/);
 assert.doesNotMatch(renderer,/<header class="project-hero">/);
});
