import {parentPort,workerData} from 'node:worker_threads';
import {scanMassifColumn} from './erebor-massif-scan.js';
parentPort.on('message',({ix,iz})=>{
 try{parentPort.postMessage(scanMassifColumn(workerData.world,workerData.plan,ix,iz,workerData.stations));}
 catch(error){parentPort.postMessage({error:error.message});}
});
