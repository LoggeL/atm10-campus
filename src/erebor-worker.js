import {parentPort,workerData as d} from 'node:worker_threads';
import {compileErebor} from './erebor-tiles.js';
import {architecturePackage} from './erebor-export.js';
import {ereborMesh} from './erebor-mesh.js';
try{const scene=compileErebor(d.project.plan);let result;
 if(d.preview)result=ereborMesh(scene,d.project.plan,d.preview,d.cut);
 else if(d.package){const p=scene.packages.find(p=>p.id===d.package);if(!p)throw Error('Unbekanntes Architekturpaket');result=architecturePackage(scene,p,d.worldDir,d.project);}
 else result={revision:scene.revision,features:scene.design.features,palette:scene.palette,packages:scene.packages.map(({tiles,...p})=>({...p,tiles:tiles.length})),tileCount:scene.tiles.size,rooms:scene.design.rooms};
 parentPort.postMessage({ok:true,result});
}catch(e){parentPort.postMessage({ok:false,error:e.message});}
