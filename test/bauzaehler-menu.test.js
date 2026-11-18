import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const page=name=>readFileSync(new URL('../public/'+name+'.html',import.meta.url),'utf8');
test('dashboard, orders and project planning share one set of workspace destinations',()=>{
  const nav=page('campus-header');
  for(const key of ['dashboard','orders','tech','projects'])assert.equal(nav.split('data-section="'+key+'"').length,2);
  for(const key of ['app','projects','erebor-dashboard'])assert.match(page(key),/<!-- campus-navigation -->/);
  assert.doesNotMatch(nav,/bauzaehler|dreierbetrieb/);
});
