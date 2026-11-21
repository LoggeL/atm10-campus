import {parentPort,workerData} from 'node:worker_threads';
import {spawnPackage} from './erebor-spawn-plan.js';
try{parentPort.postMessage(spawnPackage(workerData));}
catch(e){parentPort.postMessage({error:e.message});}
