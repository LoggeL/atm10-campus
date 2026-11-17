import {parentPort,workerData} from 'node:worker_threads';
import {scanMassifColumn,combineRepairLayers} from './erebor-massif-scan.js';
parentPort.on('message',({ix,iz,generation})=>{
 try{
  const result=scanMassifColumn(workerData.world,workerData.plan,ix,iz,workerData.stations);
  if(generation!==undefined&&!result.missing.length)result.rows=combineRepairLayers(result.rows,workerData.stations);
  parentPort.postMessage(result);
 }
 catch(error){parentPort.postMessage({error:error.message});}
});
