// Read-only selection against the same world snapshot used to prepare rest plans.
import { readFileSync } from 'node:fs';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadGrid } from './snapshot.js';
import { loadModel } from './structure-edit.js';
import { AIR_NAMES } from './nbt.js';
import { gridLookup } from './analysis.js';
import { itemsFor } from './materials.js';
import { cannonRange } from './cannon-range.js';

export function buildProgress(model, origin, grid, binding, settings, options) {
  const live = gridLookup(grid);
  const counts = { total:0, built:0, remaining:0, blocked:0, unknown:0, unsupported:0 };
  for (const [key, cell] of model.cells) {
    if (AIR_NAMES.has(cell.name) || ['minecraft:structure_void','minecraft:light'].includes(cell.name)) continue;
    counts.total++;
    const pos = key.split(',').map((n,i) => Number(n) + origin[i]);
    if (!live?.inside(...pos)) { counts.unknown++; continue; }
    const actual = live.name(...pos);
    if (actual === cell.name) { counts.built++; continue; }
    if (!itemsFor(cell.name,cell.props).some(([item,n]) => n>0 && !/_bucket$/.test(item))) { counts.unsupported++; continue; }
    if (pos[1] < -64 || pos[1] > 319 || Math.hypot(pos[0]-binding.x,pos[1]-binding.y,pos[2]-binding.z)<2
      || (live.blockEntity(...pos) && (options.skipBlocked !== false || settings.protectBlockEntities !== false))) { counts.blocked++; continue; }
    // Snapshots carry block IDs, not modded collision shapes. In restrictive
    // replacement modes, offer only cells whose empty destination is certain.
    if ([0,1].includes(settings.replaceMode) && !AIR_NAMES.has(actual)) { counts.blocked++; continue; }
    counts.remaining++;
  }
  // Empty blueprint volume never inflates construction progress. Do not round
  // a large, nearly finished plan up to 100% while actual blocks still differ.
  return {...counts,progress:counts.total ? Math.floor(counts.built/counts.total*1000)/10 : 0};
}

// Decode NBT and compare large plans away from the HTTP/feeder event loop.
if(!isMainThread && workerData?.kind==='cannon-blueprint-choices') {
  try {
    const {plans,snapshotDir,binding,settings,options}=workerData;
    const grid=loadGrid(snapshotDir), results=Object.create(null);
    for(const plan of plans) {
      try {results[plan.id]=buildProgress(loadModel(readFileSync(plan.path)),plan.origin,grid,binding,settings,options);}
      catch {results[plan.id]=null;}
    }
    parentPort.postMessage({results});
  } catch {parentPort.postMessage({error:true});}
}

export function createCannonBlueprints(campus, alignment, schematics, app) {
  const cache=new Map(), pending=[], active=new Set();let closed=false;
  const pump=()=>{
    while(!closed && active.size<2 && pending.length) {
      const {data,resolve,reject}=pending.shift();
      const worker=new Worker(new URL(import.meta.url),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:256}});
      active.add(worker);let settled=false;
      const finish=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);active.delete(worker);
        void worker.terminate();error?reject(error):resolve(value);pump();
      };
      const timer=setTimeout(()=>finish(Error('Baustand-Prüfung dauert zu lange.')),30000);
      worker.once('message',m=>finish(m.error?Error('Weltabgleich nicht lesbar.'):null,m.results));
      worker.once('error',e=>finish(e));worker.once('exit',()=>{if(!settled)finish(Error('Baustand-Prüfung unterbrochen.'));});
    }
  };
  app?.addHook('onClose',async()=>{
    closed=true;for(const job of pending.splice(0))job.reject(Error('App wird beendet.'));
    await Promise.all([...active].map(worker=>worker.terminate()));
  });
  const summaries=(plans,snapshot,binding,settings,options)=>{
    const key=JSON.stringify([snapshot.id,plans.map(p=>p.current.id),binding.x,binding.y,binding.z,settings.replaceMode,settings.protectBlockEntities,options.skipBlocked!==false]);
    if(cache.has(key))return cache.get(key);
    if(closed || pending.length>=32)return Promise.reject(Error('Baustand-Prüfung ist gerade ausgelastet.'));
    const promise=new Promise((resolve,reject)=>{
      pending.push({resolve,reject,data:{kind:'cannon-blueprint-choices',snapshotDir:campus.snapshotDir(snapshot.id),binding,settings,options,
        plans:plans.map(bp=>({id:bp.id,origin:bp.current.origin,path:campus.versionPath(bp.id,bp.current.version)}))}});pump();
    });
    cache.set(key,promise);while(cache.size>32)cache.delete(cache.keys().next().value);
    promise.catch(()=>{if(cache.get(key)===promise)cache.delete(key);});return promise;
  };
  return async (row, snapshot) => {
    const result={items:[],snapshot:snapshot?{id:snapshot.id,capturedAt:snapshot.capturedAt}:null,
      excluded:{finished:0,range:0,assigned:0,blocked:0,unknown:0},message:null};
    const binding=alignment.binding(row.name);
    if(!binding || !alignment.locationReady(row.name)){result.message='Die Kanonen-Position muss zuerst eindeutig erkannt sein.';return result;}
    if(binding.dimension!=='minecraft:overworld'){result.message='Campus-Baupläne können nur in der Oberwelt gebaut werden.';return result;}
    if(!snapshot){result.message='Noch kein Weltabgleich vorhanden. Der Baustand kann noch nicht geprüft werden.';return result;}
    const plans=campus.listBlueprints().filter(bp=>bp.current);
    const settings=schematics.settingsFor(row.name),options=JSON.parse(row.options_json||'{}');
    let progressById;
    try {progressById=await summaries(plans,snapshot,binding,settings,options);}
    catch {result.message='Der Baustand konnte gerade nicht geprüft werden. Die Auswahl wird erneut geladen.';return result;}
    const assigned=new Set(campus.db.prepare('SELECT blueprint_id FROM cannons WHERE name<>? COLLATE NOCASE AND blueprint_id IS NOT NULL').all(row.name).map(r=>r.blueprint_id));
    for(const bp of plans) {
      const v=bp.current;
      if(assigned.has(bp.id)){result.excluded.assigned++;continue;}
      const range=cannonRange(binding,v.origin);
      if(range.state!=='inrange'){result.excluded.range++;continue;}
      const progress=progressById[bp.id];
      if(!progress || progress.unknown){result.excluded.unknown++;continue;}
      if(!progress.total || progress.built===progress.total){result.excluded.finished++;continue;}
      if(!progress.remaining){result.excluded.blocked++;continue;}
      result.items.push({id:bp.id,name:bp.name,version:v.version,origin:v.origin,distance:range.distance,...progress});
    }
    result.items.sort((a,b)=>b.progress-a.progress || a.distance-b.distance || a.name.localeCompare(b.name,'de'));
    if(!result.items.length)result.message='Kein freier Bauplan mit baubaren Restblöcken in Reichweite.';
    return result;
  };
}
