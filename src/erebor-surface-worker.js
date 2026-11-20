import {parentPort,workerData} from 'node:worker_threads';
import {buildSurfacePart} from './erebor-surface.js';
try{
 const {plan,draft,part,world}=workerData;
 const {report,zip}=buildSurfacePart(plan,draft,part,world);
 // Small ZIPs can share Node's non-transferable pooled Buffer.
 parentPort.postMessage({report,zip});
}catch(e){parentPort.postMessage({error:e.message});}
