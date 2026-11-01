import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { MATERIALS } from '../blockstyle.js';
import { HttpError, requireActor } from '../auth.js';

// A renderer or material change invalidates both the disk cache and browser ETags.
const rendererHash = createHash('sha256');
for (const path of ['./render.js','./worker.js','./png.js','../nbt.js','../blockstyle.js','../data-texture-colors.json.gz', ...MATERIALS.filter(m=>m!=='glass').map(m=>`../../public/viewer/textures/${m}.png`)]) {
  rendererHash.update(readFileSync(new URL(path,import.meta.url)));
}
export const PREVIEW_REVISION = rendererHash.digest('hex').slice(0,16);

export function createPreviewService(campus, { timeoutMs = 30_000 } = {}) {
  const dir=join(campus.config.dataDir,'previews'), pending=new Map(), queue=[];
  let active=null,closed=false,pruning=null;
  async function prune() {
    const files=await readdir(dir);
    const entries=await Promise.all(files.filter(f=>/^[a-f0-9]{16}-[a-f0-9]{64}\.png$/.test(f)).map(async f=>{
      try { const s=await stat(join(dir,f));return {file:f,size:s.size,time:s.mtimeMs}; } catch { return null; }
    }));
    const ordered=entries.filter(Boolean).sort((a,b)=>b.time-a.time);
    let bytes=0;
    for(let i=0;i<ordered.length;i++){
      bytes+=ordered[i].size;
      if(i>=1000||bytes>128*1024*1024)await unlink(join(dir,ordered[i].file)).catch(()=>{});
    }
  }
  function pump() {
    if(active||closed||!queue.length)return;
    const task=queue.shift();
    const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{file:task.file},resourceLimits:{maxOldGenerationSizeMb:512}});
    active={worker,task};
    let finished=false;
    const finish=async(error,image)=>{
      if(finished)return;finished=true;clearTimeout(timer);
      await worker.terminate();active=null;
      if(error)task.reject(error);else task.resolve(Buffer.from(image));
      pump();
    };
    const timer=setTimeout(()=>finish(new HttpError(503,'Die Bauplan-Vorschau braucht zu lange. Bitte später erneut versuchen.')),timeoutMs);
    worker.once('message',message=>finish(message.error?new HttpError(503,message.error):null,message.image));
    worker.once('error',error=>finish(new HttpError(503,'Vorschau konnte nicht erstellt werden: '+error.message)));
    worker.once('exit',code=>{if(!finished)finish(new HttpError(503,'Vorschau-Prozess wurde beendet ('+code+').'));});
  }
  function render(file) {
    if(closed)return Promise.reject(new HttpError(503,'Vorschau-Dienst wird beendet.'));
    if(queue.length>=128)return Promise.reject(new HttpError(503,'Vorschauen werden noch erstellt. Bitte kurz warten.'));
    return new Promise((resolve,reject)=>{queue.push({file,resolve,reject});pump();});
  }
  function get(bpId,version) {
    const key=`${PREVIEW_REVISION}-${version.sha256}`;
    if(pending.has(key))return pending.get(key);
    const operation=(async()=>{
      await mkdir(dir,{recursive:true});
      const path=join(dir,key+'.png');
      try{return await readFile(path);}catch(error){if(error.code!=='ENOENT')throw error;}
      const image=await render(campus.versionPath(bpId,version.version));
      const temp=join(dir,key+'.'+randomUUID()+'.tmp');
      try{await writeFile(temp,image,{flag:'wx'});await rename(temp,path);}
      finally{await unlink(temp).catch(()=>{});}
      if(!pruning)pruning=prune().catch(()=>{}).finally(()=>pruning=null);
      return image;
    })();
    pending.set(key,operation);
    operation.finally(()=>pending.delete(key)).catch(()=>{});
    return operation;
  }
  async function close() {
    closed=true;
    const error=new HttpError(503,'Vorschau-Dienst wird beendet.');
    for(const task of queue.splice(0))task.reject(error);
    if(active){active.task.reject(error);await active.worker.terminate();}
    await Promise.allSettled([...pending.values()]);
    if(pruning)await pruning;
  }
  return {get,close};
}

export function registerPreviewRoutes(app,campus) {
  const previews=createPreviewService(campus);
  app.addHook('onClose',()=>previews.close());
  app.get('/api/blueprints/:id/preview.png',async(req,reply)=>{
    requireActor(req,'read');
    const bp=campus.getBlueprint(req.params.id);
    const input=req.query.version;
    if(input!==undefined&&(!/^[1-9]\d*$/.test(String(input))||!Number.isSafeInteger(Number(input))))throw new HttpError(400,'Ungültige Bauplan-Version.');
    const version=campus.version(bp.id,input===undefined?bp.currentVersion:Number(input));
    const etag=`"${PREVIEW_REVISION}-${version.sha256}"`;
    reply.header('ETag',etag).header('Cache-Control','private, no-cache').header('X-Blueprint-Version',String(version.version));
    if(req.headers['if-none-match']?.split(',').map(s=>s.trim().replace(/^W\//,'')).includes(etag))return reply.code(304).send();
    const image=await previews.get(bp.id,version);
    return reply.type('image/png').send(image);
  });
}
