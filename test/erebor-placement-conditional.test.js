import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validatePlacementDraft} from '../public/assets/erebor-placement-model.js';
test('conditional artifacts fail closed on missing station blockers',()=>{
 const plan={schemaVersion:1,planId:'test',revision:'r1',generatedAt:'2026-11-23T12:00:00Z',source:'fixture',planning:{status:'conditional-not-build-ready',notes:['Reuse first']},stations:[{id:'P1'}]};
 assert.throws(()=>validatePlacementDraft(plan),/Freigabesperren/);
});
test('conditional checklist cannot commission and scope warning is rendered as text',()=>{
 const ui=readFileSync(new URL('../public/assets/erebor-placement.js',import.meta.url),'utf8');
 assert.match(ui,/input.disabled=!station.cannons\[slot\]\|\|station.readiness==='conditional-not-build-ready'/);
 assert.match(ui,/GESPERRTER PLANUNGSENTWURF · NICHT BAUFREIGEGEBEN/);
 assert.match(ui,/for\(const note of plan.planning.notes\)scope.append\(element\('p',note\)\)/);
});
