import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('advanced binding fallback retains explicit coordinates and confirmation; automatic discovery is the primary explanation',()=>{
 const src=readFileSync(new URL('../public/assets/app.js',import.meta.url),'utf8');
 assert.ok(src.includes('function alignmentCard('),'alignment UI missing');
 const code=src.slice(src.indexOf('function alignmentCard('),src.indexOf('// alignment-card-end'));
 const ctx={me:{user:{role:'admin'}},esc:s=>String(s??'').replaceAll('<','&lt;').replaceAll('"','&quot;')};vm.createContext(ctx);vm.runInContext(code,ctx);
 const html=ctx.alignmentCard({alignment:{state:'disabled',message:'<script>',binding:null}});
 assert.match(html,/data-bind="dimension"/);assert.match(html,/data-bind="x"/);assert.match(html,/data-bind="owner"/);
 assert.match(html,/Erweitert: Position und Ausrichtung/);assert.match(html,/normalerweise automatisch erkannt/);
 assert.match(html,/Beispiel.*94.*64.*21/);assert.doesNotMatch(html,/value="94"/);assert.match(html,/native Create-GUI/);assert.doesNotMatch(html,/<script>/);
 ctx.me.user.role='member';assert.doesNotMatch(ctx.alignmentCard({alignment:{state:'disabled'}}),/data-act="alignment-probe"/);
});
