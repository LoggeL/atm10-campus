import {parentPort,workerData} from 'node:worker_threads';
import {buildSurfacePart} from './erebor-surface.js';
try{
 const {plan,draft,part,world}=workerData;
 const {report,zip}=buildSurfacePart(plan,draft,part,world);
 parentPort.postMessage({report,zip},[zip.buffer]);
}catch(e){parentPort.postMessage({error:e.message});}
