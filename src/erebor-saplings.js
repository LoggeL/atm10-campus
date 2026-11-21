import {createHash} from 'node:crypto';
import {parseStructure} from './nbt.js';
import {tileNBT,TILE} from './erebor-tiles.js';
import {storedZipEntry,zipStore} from './zip.js';

const tree=/^minecraft:(oak|birch|spruce)_(log|leaves)$/;
export const saplingSoil=name=>/^minecraft:(?:dirt|grass_block|podzol|moss_block|rooted_dirt|coarse_dirt|mycelium)$/.test(name);
const hash=data=>createHash('sha256').update(data).digest('hex');

// Keep the published surface elevations. A vertical tile boundary may cut a
// trunk in half, so find all the roots in a column before rewriting its tiles.
export function convertSurfaceTrees(report,input){
 const output=new Map(),zip=Buffer.from(input);
 let count=0,omitted=0;
 function read(f){
  const data=storedZipEntry(zip,f.fileName);
  if(!data||hash(data)!==f.sha256)throw Error('Original-NBT oder Prüfsumme fehlt: '+f.fileName);
  return data;
 }
 for(const files of Object.values(Object.groupBy(report.files,f=>[f.origin[0],f.origin[2]].join(',')))){
  const roots=new Map(),tiles=new Map();
  const parsed=f=>{
   if(!tiles.has(f.fileName)){
    const p=parseStructure(read(f),true);
    if(p.entities||p.blockEntities||p.clear.length||p.size.some(n=>n!==TILE))throw Error('Unerwarteter Inhalt im Landschaftsplan.');
    tiles.set(f.fileName,p.placed);
   }
   return tiles.get(f.fileName);
  };
  const woody=files.filter(f=>Object.keys(f.materials).some(n=>tree.test(n)));
  for(const f of woody)for(const p of parsed(f)){
   const m=tree.exec(p.name);
   if(m?.[2]!=='log')continue;
   const column=p.x+TILE*p.z,y=f.origin[1]+p.y,old=roots.get(column);
   if(old&&old.species!==m[1])throw Error('Verschiedene Stämme an derselben Position.');
   if(!old||y<old.y)roots.set(column,{y,species:m[1],supported:false});
  }
  for(const f of files){
   if(![...roots.values()].some(r=>r.y-1>=f.origin[1]&&r.y-1<f.origin[1]+TILE))continue;
   for(const p of parsed(f)){
    const r=roots.get(p.x+TILE*p.z);
    if(r&&r.y===f.origin[1]+p.y+1&&saplingSoil(p.name))r.supported=true;
   }
  }
  for(const r of roots.values())if(r.supported)count++;else omitted++;
  for(const f of files){
   if(!woody.includes(f)){output.set(f.fileName,{entry:f,data:read(f)});continue;}
   const palette=[{name:'minecraft:structure_void'}],ids=new Map(),cells=new Uint16Array(TILE**3);
   for(const p of parsed(f)){
    let name=p.name,props=p.properties;
    if(tree.test(name)){
     const r=roots.get(p.x+TILE*p.z);
     if(!name.endsWith('_log')||!r?.supported||r.y!==f.origin[1]+p.y)continue;
     name='minecraft:'+r.species+'_sapling';props=undefined;
    }
    const key=name+JSON.stringify(props??{});
    if(!ids.has(key)){ids.set(key,palette.length);palette.push({name,props});}
    cells[p.x+TILE*(p.z+TILE*p.y)]=ids.get(key);
   }
   if(!cells.some(Boolean))continue;
   const {bytes,placed,materials}=tileNBT(palette,cells,'surface');
   output.set(f.fileName,{data:bytes,entry:{...f,blocks:placed,materials,sha256:hash(bytes)}});
  }
 }
 if(count+omitted!==report.trees)throw Error('Baumstämme stimmen nicht mit der veröffentlichten Baumzahl überein.');
 const entries=report.files.map(f=>output.get(f.fileName)).filter(Boolean);
 const result={...report,treeMode:'saplings',trees:count,omittedTreeSites:omitted,files:entries.map(r=>r.entry),blocks:entries.reduce((n,r)=>n+r.entry.blocks,0)};
 const manifest={settings:{replace_mode:0,replace_block_entities:false},...result};
 return {report:result,zip:zipStore([...entries.map(({entry,data})=>({name:entry.fileName,data})),{name:'Baufolge.json',data:Buffer.from(JSON.stringify(manifest))}])};
}
