// Optional real-browser regression: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node --test test/erebor-placement.browser.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {buildServer} from '../src/server.js';

test('mobile placement checklist stays manual, local, revision-scoped and separate from observations',async()=>{
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
 const dir=mkdtempSync(join(process.env.TMPDIR,'placement-browser-'));
 const path=join(dir,'plan.json');
 const pos={x:12,y:64,z:-3};
 const artifact={schemaVersion:1,planId:'browser-fixture',revision:'r1',generatedAt:new Date().toISOString(),source:'BROWSER TEST ONLY',stations:[{id:'TEST-01',label:'<img src=x onerror=alert(1)>',dimension:'minecraft:overworld',equipment:{receiver:pos,cable:[pos],bridge:pos,computer:pos,chest:pos},cannons:{A:pos,B:pos,C:null},observed:{at:new Date().toISOString(),source:'SAVED WORLD TEST ONLY',computerId:42,blocks:[{position:pos,blockId:'minecraft:chest'}]}}]};
 writeFileSync(path,JSON.stringify(artifact));
 const app=await buildServer({dataDir:dir,placementDraftPath:path,worldSources:{},bootstrapInvite:'browser-fixture',publicUrl:'http://localhost',cookieSecure:false,snapshotIntervalMin:0});
 let browser;
 try{
  await app.listen({host:'127.0.0.1',port:0});const base=app.listeningOrigin;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/sbin/chromium-browser',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await context.request.post(base+'/api/auth/register',{data:{code:'browser-fixture',username:'browser',password:'browser-fixture-password'}});
  await page.goto(base+'/erebor/aufstellung');
  await page.getByRole('link',{name:'Aufstellung',exact:true}).waitFor();
  await page.locator('#placement-stations details.station').first().waitFor();
  await page.locator('#placement-stations details.station > summary').click();
  assert.equal(await page.locator('#placement-stations img').count(),0);
  assert.match(await page.locator('#placement-stations').innerText(),/Live-Betrieb: unbekannt/);
  await page.locator('.metadata > summary').click();
  assert.match(await page.locator('#placement-stations').innerText(),/Computer-ID: 42/);
  assert.match(await page.locator('#placement-stations').innerText(),/12 · 64 · -3/);
  const checkbox=page.getByRole('checkbox',{name:'A · Lauf beobachtet (manuell)'});
  await checkbox.check();assert.equal(await checkbox.isChecked(),true);
  assert.match(await page.locator('#placement-stations').innerText(),/Live-Betrieb: unbekannt/);
  await page.reload();await page.locator('#placement-stations details.station > summary').click();
  assert.equal(await checkbox.isChecked(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(process.env.TMPDIR,'erebor-placement-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  assert.equal(await page.getByRole('link',{name:'Aufstellung',exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:join(process.env.TMPDIR,'erebor-placement-desktop.png'),fullPage:true});
  await page.locator('#search').fill('not-a-station');assert.equal(await page.locator('details.station:visible').count(),0);
  artifact.revision='r2';writeFileSync(path,JSON.stringify(artifact));
  await page.reload();await page.locator('#placement-stations details.station > summary').click();
  assert.equal(await checkbox.isChecked(),false);
  writeFileSync(path,'{}');await page.reload();
  await page.locator('#plan-error:visible').waitFor();
  assert.equal(await page.locator('details.station').count(),0);
  assert.equal(await page.locator('#search').isDisabled(),true);
  await context.clearCookies();await page.reload();assert.match(page.url(),/\/login$/);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});}
});
