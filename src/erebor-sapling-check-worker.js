import {parentPort,workerData} from 'node:worker_threads';
import {interiorWorldCheck} from './erebor-interior.js';

const {world,bytes,anchor,minimumSave}=workerData;
const check={bytes,anchor,kind:'surface'};
if(interiorWorldCheck(world,{...check,completed:true,minimumSave})){
 parentPort.postMessage({state:'complete'});
}else{
 const result=interiorWorldCheck(world,{...check,resumeSurface:true,details:true});
 parentPort.postMessage(result===true?{state:'ready'}:{state:'blocked',reason:typeof result==='string'?result:'Weltprüfung offen'});
}
