import {parentPort,workerData} from 'node:worker_threads';
import {mountainTiles,exportMountainTile} from './project-stone.js';
import {countMountainRegion} from './project-stone-count.js';
try {parentPort.postMessage({ok:true,result:workerData.countRegion?countMountainRegion(workerData.worldDir,workerData.plan,workerData.countRegion):workerData.tile?exportMountainTile(workerData.worldDir,workerData.plan,workerData.tile):mountainTiles(workerData.plan)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
