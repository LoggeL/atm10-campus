import {parentPort,workerData} from 'node:worker_threads';
import {Region,regionMtime} from './region.js';

export function readEndpoints(world, layout) {
  const points = [
    ...Object.entries(layout.hubs).map(([id,pos])=>({id,pos,block:'extendedae:wireless_hub'})),
    ...layout.sites.map(s=>({id:s.site,pos:s.connector,block:'extendedae:wireless_connect'})),
  ];
  const groups = new Map(), endpoints = new Map();
  for (const point of points) {
    const [x,,z]=point.pos, key=[x>>9,z>>9].join(',');
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(point);
  }
  for(const [regionKey,points] of groups) {
    const [rx,rz]=regionKey.split(',').map(Number);
    const changes=[];
    for(let attempt=0;attempt<2;attempt++) {
      changes.length=0;
      try {
        const before=regionMtime(world,rx,rz), region=Region.open(world,rx,rz);
        const chunks=new Map();
        for(const {id,pos:[x,y,z],block} of points) {
          const cx=(x>>4)&31,cz=(z>>4)&31,key=cx+','+cz;
          if(!chunks.has(key))chunks.set(key,region?.chunk(cx,cz,{preserveLongs:true}));
          const chunk=chunks.get(key);
          if(!chunk?.sections || !['full','minecraft:full'].includes(chunk.Status))continue;
          const entity=(chunk.block_entities||[]).find(b=>b.x===x && b.y===y && b.z===z && b.id===block);
          let ports=[];
          if(entity) {
            const values=block.endsWith('_hub') && !Object.hasOwn(entity,'freq') ?
              Array.from({length:8},(_,i)=>entity['freq'+i]) : [entity.freq];
            ports=values.flatMap((v,i)=>typeof v==='bigint' && v!==0n ? [{port:i+1,frequency:v}] : []);
          }
          changes.push([id,{present:!!entity,ports}]);
        }
        if(before!==regionMtime(world,rx,rz))continue;
        for(const [id,data] of changes)endpoints.set(id,data);
        break;
      } catch { /* Retry a changing save. Missing endpoint data stays unknown. */ }
    }
  }
  return endpoints;
}

export function wirelessReport(layout,endpoints) {
  const uses=new Map();
  for(const [id,end] of endpoints)for(const p of end.ports) {
    if(!uses.has(p.frequency))uses.set(p.frequency,[]);
    uses.get(p.frequency).push({id,port:p.port});
  }
  function link(hub,id) {
    const a=endpoints.get(hub), b=endpoints.get(id);
    if(!a||!b)return {hub,id,state:'unknown'};
    if(!a.present || !b.present)return {hub,id,state:'absent'};
    const pairs=a.ports.filter(p=>b.ports.some(q=>q.frequency===p.frequency));
    if(!pairs.length)return {hub,id,state:'unpaired'};
    if(pairs.length!==1 || uses.get(pairs[0].frequency).length!==2)return {hub,id,state:'ambiguous'};
    return {hub,id,state:'paired',port:pairs[0].port};
  }
  return {
    surveyedAt:new Date().toISOString(),
    hubs:Object.fromEntries(Object.keys(layout.hubs).map(id=>{
      const end=endpoints.get(id);return [id,{present:end?.present??null,ports:end?.ports.map(p=>({
        port:p.port,peers:uses.get(p.frequency).filter(s=>s.id!==id).map(s=>s.id)
      }))??[]}];
    })),
    links:[...['A1','A2','B1','B2'].map(id=>link(id,id[0]+'0')),...layout.sites.map(s=>link(s.hub,s.site))],
  };
}
if(workerData?.kind==='erebor-wireless')parentPort.postMessage(wirelessReport(workerData.layout,readEndpoints(workerData.world,workerData.layout)));
