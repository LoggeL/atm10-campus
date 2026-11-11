import {parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {mountainTiles,exportMountainTile} from './project-stone.js';
import {nearestStoneCannon,stoneFileName} from '../public/assets/stone-placement.js';
import {compileErebor} from './erebor-tiles.js';
import {architecturePackage} from './erebor-export.js';
import {storedZipEntry} from './zip.js';

const {project,world}=workerData;
const bySite=Object.groupBy(mountainTiles(project.plan).tiles,t=>nearestStoneCannon(project.plan,t.origin)?.id);
let scene;
function next({site,cursor,phase,architecture}) {
 if(phase==='stone'){
  const tiles=bySite[site]||[],end=Math.min(cursor+8,tiles.length);
  for(let i=cursor;i<end;i++){
   const tile=tiles[i],{bytes,stats}=exportMountainTile(world,project.plan,tile);
   if(!stats.blocks)continue;
   return {next:i+1,file:stoneFileName(project.id,project.version,tile,project.plan),size:tile.size,origin:tile.origin,blocks:stats.blocks,bytes};
  }
  return {next:end,exhausted:end===tiles.length};
 }
 if(!architecture)return {next:cursor,exhausted:true};
 scene??=compileErebor(project.plan);
 const pack=scene.packages.find(p=>p.id===architecture.pack);
 const tile=pack?.tiles.find(t=>t.cannon===site&&t.origin.every((v,i)=>v===architecture.origin[i]));
 if(!tile)throw Error('Veröffentlichter Abschnitt fehlt im aktuellen Bauplan.');
 const out=architecturePackage(scene,{...pack,tiles:[tile]},world,project);
 const file=out.report.files.find(f=>f.fileName===architecture.fileName&&f.kind===phase);
 if(!file)return {next:cursor+1,exhausted:false};
 const bytes=storedZipEntry(out.bytes,file.fileName);
 if(!bytes||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('Architekturdatei unvollständig.');
 return {next:cursor+1,file:file.fileName,size:file.size,origin:file.origin,blocks:file.blocks,bytes};
}
parentPort.on('message',req=>{try{parentPort.postMessage({result:next(req)});}catch(e){parentPort.postMessage({error:e.message});}});
