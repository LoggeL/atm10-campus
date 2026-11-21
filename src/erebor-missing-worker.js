import {parentPort,workerData} from 'node:worker_threads';
import {Region} from './region.js';

// Read a common saved chunk once for neighbouring printers. The input slot,
// native status and placed count must all agree with signed game telemetry.
const found=[];
for(const rows of Object.values(Object.groupBy(workerData.rows,({pos:[x,,z]})=>[x>>9,z>>9].join(',')))){
 const [x,,z]=rows[0].pos;
 try{
  const region=Region.open(workerData.world,x>>9,z>>9);
  if(!region)continue;
  for(const group of Object.values(Object.groupBy(rows,({pos:[x,,z]})=>[x>>4,z>>4].join(',')))){
   const [cx,,cz]=group[0].pos;
   const entities=region.chunk(cx>>4,cz>>4)?.block_entities??[];
   for(const row of group){
    const [px,py,pz]=row.pos;
    const be=entities.find(e=>e.x===px&&e.y===py&&e.z===pz&&e.id==='create:schematicannon');
    const upload=be?.Inventory?.Items?.find(i=>i.Slot===0)?.components?.['create:schematic_file'];
    if(upload===row.file&&be?.State==='PAUSED'&&be.Status===row.status&&be.AmountPlaced===row.placed&&typeof be.MissingItem?.id==='string')
     found.push({...row,item:be.MissingItem.id});
   }
  }
 }catch{/* A missing or partially saved region supplies no positive evidence. */}
}
parentPort.postMessage(found);
