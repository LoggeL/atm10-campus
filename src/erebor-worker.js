import {parentPort,workerData as d} from 'node:worker_threads';
import {compileErebor} from './erebor-tiles.js';
import {architecturePackage} from './erebor-export.js';
import {ereborMesh} from './erebor-mesh.js';
import {buildEreborDesign} from './erebor-design.js';
import {drawGoldHalls,finishingScene,finishId,finishRoom} from './erebor-gold-halls.js';
try{const plan=d.project.plan,withFinish=Boolean(plan.interiorExpansion&&finishRoom(d.preview));
 const design=buildEreborDesign(plan,withFinish?drawGoldHalls:undefined);
 const extra=plan.interiorExpansion&&(!d.preview&&!d.package||finishId(d.package))?finishingScene(plan,design):null;
 const scene=d.package&&extra?extra:compileErebor(plan,design);let result;
 if(d.preview)result=ereborMesh(scene,d.project.plan,d.preview,d.cut,d.navigation);
 else if(d.package){const p=scene.packages.find(p=>p.id===d.package);if(!p)throw Error('Unbekanntes Architekturpaket');result=architecturePackage(scene,p,d.worldDir,d.project);}
 else result={revision:scene.revision,features:scene.design.features,palette:scene.palette,packages:[...scene.packages,...(extra?.packages||[])].map(({tiles,...p})=>({...p,tiles:tiles.length})),tileCount:scene.tiles.size+(extra?.tiles.size||0),rooms:scene.design.rooms};
 parentPort.postMessage({ok:true,result});
}catch(e){parentPort.postMessage({ok:false,error:e.message});}
