import {parentPort,workerData} from 'node:worker_threads';
import {Region} from './region.js';
const regions=new Map(),chunks=new Map(),rows=[];
for(const [slot,[x,y,z]] of Object.entries(workerData.positions)){
  const row={slot,savedAt:null,state:null,status:null,placed:null,input:null,known:false};
  try{
    const regionKey=[x>>9,z>>9].join(','),chunkKey=[x>>4,z>>4].join(',');
    if(!regions.has(regionKey))regions.set(regionKey,Region.open(workerData.world,x>>9,z>>9));
    const region=regions.get(regionKey);
    if(region){
      if(!chunks.has(chunkKey))chunks.set(chunkKey,region.chunk(x>>4,z>>4));
      const be=chunks.get(chunkKey)?.block_entities?.find(b=>b.id==='create:schematicannon'&&b.x===x&&b.y===y&&b.z===z);
      if(be&&Array.isArray(be.Inventory?.Items)){
        const input=be.Inventory.Items.find(i=>i.Slot===0);
        Object.assign(row,{savedAt:region.buf.readUInt32BE(4096+4*(((x>>4)&31)+32*((z>>4)&31)))*1000,
          state:be.State,status:be.Status,placed:be.AmountPlaced,known:true,input:input?.components?.['create:schematic_file']??input?.id??null,
          missing:be.MissingItem?.id??null});
      }
    }
  }catch{/* Unknown if a chunk has gone missing or was saved during the read. */}
  rows.push(row);
}
parentPort.postMessage(rows);
