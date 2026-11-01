import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { structureNbt } from './helpers.js';
import { parseStructure } from '../src/nbt.js';
import { encodePng, decodePng } from '../src/preview/png.js';
import { renderBlueprint, WIDTH, HEIGHT } from '../src/preview/render.js';
import { createPreviewService } from '../src/preview/service.js';
import { buildServer } from '../src/server.js';
import { blueprintPreview } from '../public/assets/blueprint-preview.js';

const block = (name = 'minecraft:gold_block', pos = [0,0,0]) => ({name,pos});
const nbt = (name, pos) => structureNbt([4,4,4], [block(name,pos)]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('PNG round-trip retains pixels and reads the bundled material format', () => {
  const pixels = Buffer.from([255,0,0,255, 0,255,0,80, 0,0,255,0, 20,30,40,255]);
  assert.deepEqual(decodePng(encodePng(2,2,pixels)), {width:2,height:2,pixels});
  const tile = decodePng(readFileSync(new URL('../public/viewer/textures/stone.png',import.meta.url)));
  assert.equal(tile.width,64); assert.equal(tile.height,64);
  assert.throws(() => decodePng(Buffer.from('not a png')), /PNG/);
});

test('renders actual placed blocks with stable colours, excluding air and structure void', () => {
  const gold = renderBlueprint(parseStructure(nbt())), stone = renderBlueprint(parseStructure(nbt('minecraft:stone')));
  const image = decodePng(gold);
  assert.equal(image.width,WIDTH); assert.equal(image.height,HEIGHT);
  assert.notDeepEqual(stone,gold);
  assert.deepEqual(renderBlueprint(parseStructure(nbt())),gold);
  const extra = structureNbt([4,4,4],[block(),block('minecraft:air',[3,3,3]),block('minecraft:structure_void',[2,3,3])]);
  assert.deepEqual(renderBlueprint(parseStructure(extra)),gold);
  const empty = renderBlueprint(parseStructure(structureNbt([4,4,4],[block('minecraft:air')])));
  assert.notDeepEqual(empty,gold);
  assert.equal(decodePng(empty).pixels.length,WIDTH*HEIGHT*4);
});

test('sparse huge declared bounds use the actual geometry and tall plans fit the image', () => {
  const tiny = parseStructure(nbt());
  assert.deepEqual(renderBlueprint({...tiny,size:[8192,8192,8192]}),renderBlueprint(tiny));
  const placed = Array.from({length:122},(_,y)=>({x:0,y,z:0,name:'minecraft:quartz_block'}));
  const image = decodePng(renderBlueprint({size:[1,122,1],placed}));
  const bg = [16,25,35,255];
  for(let x=0;x<WIDTH;x++){
    assert.deepEqual([...image.pixels.subarray(x*4,x*4+4)],bg);
    const at=((HEIGHT-1)*WIDTH+x)*4;
    assert.deepEqual([...image.pixels.subarray(at,at+4)],bg);
  }
  let bright=0;for(let i=0;i<image.pixels.length;i+=4)if(image.pixels[i]>100)bright++;
  assert.ok(bright>500,'the full tower is visible, not only the background');
});

test('cache deduplicates concurrent content, survives restart, and workers recover from invalid input', async t => {
  const dir=mkdtempSync(join(tmpdir(),'campus-preview-cache-'));
  const file=join(dir,'plan.nbt'), bytes=nbt();writeFileSync(file,bytes);
  const campus={config:{dataDir:dir},versionPath:()=>file};
  let service=createPreviewService(campus);
  t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
  const v={version:1,sha256:hash(bytes)}, first=service.get('one',v), second=service.get('two',v);
  assert.equal(first,second,'same bytes share one render even across plan IDs');
  const result=await first;
  await service.close();
  const files=readdirSync(join(dir,'previews'));assert.equal(files.length,1);assert.match(files[0],/\.png$/);
  const cache=join(dir,'previews',files[0]), mtime=statSync(cache).mtimeMs;
  unlinkSync(file);service=createPreviewService(campus);
  assert.deepEqual(await service.get('one',v),result,'cached preview needs no source read after restart');
  assert.equal(statSync(cache).mtimeMs,mtime);
  writeFileSync(file,'broken NBT');
  await assert.rejects(service.get('bad',{version:2,sha256:hash('bad')}),e=>e.statusCode===503);
  writeFileSync(file,nbt('minecraft:stone'));
  assert.notDeepEqual(await service.get('new',{version:3,sha256:hash('new')}),result);
});

test('worker deadline and shutdown settle pending requests', async t => {
  const dir=mkdtempSync(join(tmpdir(),'campus-preview-close-')), file=join(dir,'plan.nbt'), bytes=nbt();
  writeFileSync(file,bytes);
  const campus={config:{dataDir:dir},versionPath:()=>file}, version={version:1,sha256:hash(bytes)};
  const service=createPreviewService(campus,{timeoutMs:1});
  t.after(async()=>{await service.close();rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(service.get('one',version),e=>e.statusCode===503 && /lange/.test(e.message));
  const pending=service.get('two',version);
  const rejected=assert.rejects(pending,e=>e.statusCode===503);
  await service.close();await rejected;
});

test('preview API authenticates, pins revisions and revalidates private cached images', async t => {
  const dir=mkdtempSync(join(tmpdir(),'campus-preview-api-'));mkdirSync(join(dir,'world'));
  const config={port:0,host:'127.0.0.1',dataDir:join(dir,'data'),worldSources:{live:join(dir,'world')},contextOrigin:[0,0,0],contextSize:[16,16,16],snapshotIntervalMin:0,snapshotKeepRecent:10,bootstrapInvite:'preview-test-invite-123',publicUrl:'http://test',cookieSecure:false,maxUploadBytes:32*1024*1024};
  const app=await buildServer(config);
  t.after(async()=>{await app.close();app.campus.db.close();rmSync(dir,{recursive:true,force:true});});
  const reg=await app.inject({method:'POST',url:'/api/auth/register',payload:{code:config.bootstrapInvite,username:'preview',password:'preview-test-123'}});
  assert.equal(reg.statusCode,200,reg.body);
  const headers={cookie:`campus_session=${reg.cookies.find(c=>c.name==='campus_session').value}`,'x-campus-csrf':'1'};
  const req=(method,url,payload,extra={})=>app.inject({method,url,payload,headers:{...headers,...extra}});
  const put=bytes=>req('PUT','/api/blueprints/house/nbt?origin=1,64,1',bytes,{'content-type':'application/octet-stream'});
  assert.equal((await put(nbt())).statusCode,200);
  const url='/api/blueprints/house/preview.png';
  const first=await req('GET',url);
  assert.equal(first.statusCode,200,first.body);
  assert.equal(first.headers['content-type'],'image/png');
  assert.equal(first.headers['cache-control'],'private, no-cache');
  assert.equal(first.headers['x-blueprint-version'],'1');
  assert.equal(decodePng(first.rawPayload).width,640);
  assert.equal((await req('GET',url,undefined,{'if-none-match':first.headers.etag})).statusCode,304);
  assert.equal((await app.inject({url,headers:{'if-none-match':first.headers.etag}})).statusCode,401);
  for(const version of ['0','-1','1.2','abc','9007199254740992','1&version=2'])assert.equal((await req('GET',url+'?version='+version)).statusCode,400,version);
  assert.equal((await req('GET',url+'?version=99')).statusCode,404);
  assert.equal((await req('GET','/api/blueprints/missing/preview.png')).statusCode,404);
  const token=(await req('POST','/api/tokens',{name:'preview-reader',scope:'read'})).json().token;
  assert.equal((await app.inject({url,headers:{authorization:'Bearer '+token}})).statusCode,200);
  assert.equal((await put(nbt('minecraft:stone'))).statusCode,200);
  const second=await req('GET',url,undefined,{'if-none-match':first.headers.etag});
  assert.equal(second.statusCode,200);assert.equal(second.headers['x-blueprint-version'],'2');
  assert.notEqual(second.headers.etag,first.headers.etag);assert.notDeepEqual(second.rawPayload,first.rawPayload);
  assert.deepEqual((await req('GET',url+'?version=1')).rawPayload,first.rawPayload);
  const moved=await req('PATCH','/api/blueprints/house',{origin:[200,75,-100],baseVersion:2});
  assert.equal(moved.statusCode,200,moved.body);
  const third=await req('GET',url);
  assert.equal(third.headers['x-blueprint-version'],'3');assert.equal(third.headers.etag,second.headers.etag);
  assert.deepEqual(third.rawPayload,second.rawPayload,'changing the world origin preserves the isolated render');
});

test('preview markup preserves pinned versions and escapes plan names and identifiers', () => {
  const html=blueprintPreview({id:'bad"/><script>',name:'<img onerror="evil">',version:2,currentVersion:3});
  assert.match(html,/preview\.png\?version=2/);assert.doesNotMatch(html,/<script>|<img onerror=/);
  assert.match(html,/&lt;img onerror=&quot;evil&quot;&gt;/);
  assert.match(html,/loading="lazy"/);
  assert.match(blueprintPreview({id:'house',currentVersion:4},{eager:true,size:'large'}),/version=4/);
  assert.doesNotMatch(blueprintPreview({id:'house',version:null}),/<img/);
});
