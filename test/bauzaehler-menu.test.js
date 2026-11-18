import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('shared desktop and mobile Campus main navigation exposes Bauzähler directly',()=>{
 const html=readFileSync(new URL('../public/app.html',import.meta.url),'utf8');
 const nav=html.match(/<nav class="tabs"[^>]*>([\s\S]*?)<\/nav>/)[1];
 assert.match(nav,/<a href="\/erebor\/bauzaehler">Bauzähler<\/a>/);
});
