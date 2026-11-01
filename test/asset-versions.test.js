import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const files=dir=>readdirSync(join(root,dir),{withFileTypes:true}).filter(e=>e.isFile()&&/\.(html|js)$/.test(e.name)).map(e=>join(dir,e.name));
const sources=[...files('public'),...files('public/assets'),...files('public/viewer'),'src/materials-html.js'];
const text=file=>readFileSync(join(root,file),'utf8');

// Assets are revalidated individually, so one stale link serves new markup with old
// styles. In particular login, invite, docs and the material page also load app.css.
test('every page and module loads the same asset generation',()=>{
  const generations=new Set(sources.flatMap(file=>[...text(file).matchAll(/\?v=([0-9a-z-]+)/g)].map(m=>m[1])));
  assert.equal(generations.size,1,[...generations].join(', '));
  for(const page of ['public/app.html','public/login.html','public/invite.html','public/docs.html','public/viewer/index.html','src/materials-html.js'])
    assert.match(text(page),/\.css\?v=/,page);
});

test('shared Campus modules import each other with that generation and every target exists',()=>{
  for(const file of files('public/assets')) {
    for(const [,target] of text(file).matchAll(/^import .* from '(\.\/[^']+)'/gm)) {
      assert.match(target,/\?v=/,`${file} imports ${target} without a version`);
      assert.ok(existsSync(join(root,dirname(file),target.split('?')[0])),target);
    }
  }
});
