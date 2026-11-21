import {mountainTop} from './project-stone.js';
import {chunkBlockReader} from './terrain.js';
import {Region,regionMtime} from './region.js';
import {tileNBT,TILE} from './erebor-tiles.js';
import {zipStore} from './zip.js';
import {createHash} from 'node:crypto';

const AIR=new Set(['minecraft:air','minecraft:cave_air','minecraft:void_air']);
const GROUND=new Set(['stone','andesite','diorite','granite','tuff','deepslate','sand','gravel','clay','dirt','grass_block','podzol','coarse_dirt','rooted_dirt','moss_block','snow_block','calcite'].map(n=>'minecraft:'+n));
const names=['structure_void','stone','andesite','tuff','dirt','grass_block','podzol','rooted_dirt','coarse_dirt','moss_block','snow_block','spruce_sapling','oak_sapling','birch_sapling'];
const palette=names.map(n=>({name:'minecraft:'+n}));
const index=Object.fromEntries(names.map((n,i)=>[n,i]));
const external=/^(E0[23]|E15|E20|E2[2-8])$/;
const within=(x,z,b)=>x>=b[0][0]&&x<b[1][0]&&z>=b[0][2]&&z<b[1][2];
function seed(x,z){let h=Math.imul(x,374761393)+Math.imul(z,668265263);h=Math.imul(h^(h>>>13),1274126177);return (h^(h>>>16))>>>0;}
export function surfaceParts(p,draft){
 const [lo,hi]=p.mountainFill.bounds,parts=[];
 for(let rz=lo[2]>>9;rz<=(hi[2]-1)>>9;rz++)for(let rx=lo[0]>>9;rx<=(hi[0]-1)>>9;rx++)parts.push({id:'R'+rx+'_'+rz,rx,rz});
 const [x,,z]=draft.summit;
 return parts.sort((a,b)=>Math.hypot(a.rx-(x>>9),a.rz-(z>>9))-Math.hypot(b.rx-(x>>9),b.rz-(z>>9)));
}
export function summitHeight(d,x,z,base){
 const points=d.profile,[sx,,sz]=d.summit;
 const i=points.findIndex(([px])=>px>=x);
 if(i<0||x<points[0][0])return base;
 const [bx,by]=points[i],[ax,ay]=points[Math.max(0,i-1)];
 const crest=ax===bx?by:ay+(by-ay)*(x-ax)/(bx-ax);
 const dz=Math.abs(z-sz),dx=x-sx;
 const rib=dx>0?Math.max(0,1-Math.abs(dz-dx*.67)/17)*Math.min(1,dz/14):0;
 return Math.max(base,Math.floor(crest-dz*(1.9-rib*.88)));
}
function boxes(p){
 const spans=[...p.mountainFill.protectedBoxes.map(e=>e.bounds),...p.zones.filter(e=>external.test(e.id)).map(e=>e.worldBounds)];
 for(const {position:[x,,z]} of p.cannonLayout.stations)spans.push([[x-12,0,z-12],[x+13,320,z+13]]);
 const [gx,,gz]=p.worldOrigin;
 spans.push([[gx-36,0,gz-125],[gx+144,320,gz+125]],[[-395,0,-10024],[-335,320,-9976]]);
 return spans;
}
export function buildSurfacePart(p,d,part,world){
 const {rx,rz,id}=part,region=Region.open(world,rx,rz),mtime=regionMtime(world,rx,rz);
 const protectedAreas=boxes(p),tiles=new Map(),unknown=[],entries=[],files=[];
 let supportedLater=0,columns=0,trees=0;
 const [lo,hi]=p.mountainFill.bounds;
 function put(x,y,z,n){
  const origin=[x>>5<<5,y>>5<<5,z>>5<<5],key=origin.join(',');
  let t=tiles.get(key);
  if(!t){t={origin,cells:new Uint8Array(TILE**3)};tiles.set(key,t);}
  t.cells[((y&31)*32+(z&31))*32+(x&31)]=index[n];
 }
 for(let cz=rz*32;cz<rz*32+32;cz++)for(let cx=rx*32;cx<rx*32+32;cx++){
  const x0=cx*16,z0=cz*16;
  if(x0+16<=lo[0]||x0>=hi[0]||z0+16<=lo[2]||z0>=hi[2])continue;
  const nearX=Math.max(x0,Math.min(x0+15,p.mountainFill.peak[0])),nearZ=Math.max(z0,Math.min(z0+15,p.mountainFill.peak[2]));
  if(mountainTop(p,nearX,nearZ)==null&&[0,15].every(a=>[0,15].every(b=>mountainTop(p,x0+a,z0+b)==null)))continue;
  const chunk=region?.chunk(cx,cz);
  if(!['full','minecraft:full'].includes(chunk?.Status)||!chunk.sections?.length){unknown.push([cx,cz]);continue;}
  const at=chunkBlockReader(chunk),sections=chunk.sections.filter(s=>s.block_states?.palette?.some(b=>!AIR.has(b.Name))).sort((a,b)=>b.Y-a.Y);
  const protections=protectedAreas.filter(b=>x0+16>b[0][0]&&x0<b[1][0]&&z0+16>b[0][2]&&z0<b[1][2]);
  const entities=chunk.block_entities||[];
  for(let z=z0;z<z0+16;z++)for(let x=x0;x<x0+16;x++){
   const planned=mountainTop(p,x,z);
   if(planned==null||protections.some(b=>within(x,z,b))||entities.some(b=>Math.abs(b.x-x)<=2&&Math.abs(b.z-z)<=2))continue;
   let observed=-65,block;
   scan:for(const s of sections)for(let y=Math.min(319,s.Y*16+15);y>=Math.max(-64,s.Y*16);y--){
    const n=at(x,y,z);if(!AIR.has(n)){observed=y;block=n;break scan;}
   }
   if(observed===-65||observed>=319||(!GROUND.has(block)&&!(observed<planned&&block==='minecraft:water')))continue;
   const base=Math.max(planned,observed),profile=summitHeight(d,x,z,base);
   const wave=Math.sin(x/23+z/43)+Math.cos(z/17-x/45),alt=base+wave*5;
   const forest=Math.sin(x/17+z/27)+Math.cos(z/29-x/18);
   const slope=Math.max(...[[1,0],[-1,0],[0,1],[0,-1]].map(([a,b])=>Math.abs(planned-(mountainTop(p,x+a,z+b)??planned))));
   let top=base;
   if(profile>base){
    for(let y=base+1;y<=profile;y++)put(x,y,z,y===profile&&(y>297||wave>-.4)?'snow_block':y<profile-2?'stone':wave>0?'andesite':'tuff');
    top=profile;
   }else if(alt<215&&slope<=2){
    if(base+2>319)continue;
    put(x,++top,z,'dirt');put(x,++top,z,alt>193&&wave>.7?'coarse_dirt':forest>1&&alt>100?'podzol':wave>1.45?'moss_block':'grass_block');
   }else if(base<319&&(alt>=296||alt>258&&wave>-.8||alt>240&&wave>1.42)){
    put(x,++top,z,'snow_block');
   }else if(base<319&&wave>1&&slope<4){put(x,++top,z,wave>1.65?'tuff':'andesite');}
   if(top===base)continue;
   columns++;if(observed<planned)supportedLater++;
   const r=seed(cx,cz),ax=x0+4+r%8,az=z0+4+(r>>>8)%8;
   if(profile===base&&x===ax&&z===az&&alt<207&&slope<=1&&forest>(alt>176?1.12:-.35)){
    const species=alt>116||r%3===0?'spruce':r%3===1?'oak':'birch';
    put(x,top+1,z,species+'_sapling');trees++;
   }
  }
 }
 for(const t of [...tiles.values()].sort((a,b)=>a.origin[1]-b.origin[1]||a.origin[2]-b.origin[2]||a.origin[0]-b.origin[0])){
  const {bytes,placed,materials}=tileNBT(palette,t.cells,'surface'),[x,y,z]=t.origin;
  const fileName='EREBOR_HAUT_'+id+'_X'+x+'_Y'+y+'_Z'+z+'.nbt';
  const station=p.cannonLayout.stations.map(s=>({id:s.id,d:Math.hypot(...s.position.map((v,i)=>Math.max(Math.abs(v-t.origin[i]),Math.abs(v-t.origin[i]-31))))})).sort((a,b)=>a.d-b.d)[0];
  files.push({fileName,origin:t.origin,blocks:placed,materials,cannon:station?.d<256?station.id:null,sha256:createHash('sha256').update(bytes).digest('hex')});
  entries.push({name:fileName,data:bytes});
 }
 const report={id,files,columns,trees,treeMode:'saplings',supportedLater,unknown,blocks:files.reduce((sum,f)=>sum+f.blocks,0),region:[rx,rz],savedAt:mtime?new Date(mtime).toISOString():null};
 entries.push({name:'Baufolge.json',data:Buffer.from(JSON.stringify({settings:{replace_mode:0,replace_block_entities:false},...report}))});
 return {report,zip:zipStore(entries)};
}
