// Isometric raster previews of isolated blueprints. Like the viewer, blocks use cube
// geometry with the modpack's average colours and shared material detail textures.
import { readFileSync } from 'node:fs';
import { blockStyle } from '../blockstyle.js';
import { decodePng, encodePng } from './png.js';

export const WIDTH = 640, HEIGHT = 400;
const SCALE = 2, W = WIDTH * SCALE, H = HEIGHT * SCALE;
const RIGHT = Math.SQRT1_2, UP = 1 / Math.sqrt(6), RISE = Math.sqrt(2 / 3);
const BG = [16,25,35];
const tiles = new Map();
function texture(material) {
  if (tiles.has(material)) return tiles.get(material);
  let tile = null;
  if (material !== 'glass') {
    tile = decodePng(readFileSync(new URL(`../../public/viewer/textures/${material}.png`, import.meta.url)));
    let total = 0, count = 0;
    for (let i = 0; i < tile.pixels.length; i += 4) {
      const l = .299 * tile.pixels[i] + .587 * tile.pixels[i+1] + .114 * tile.pixels[i+2];
      tile.pixels[i] = l;
      if (tile.pixels[i+3] > 127) { total += l; count++; }
    }
    const mean = count ? total / count : 128;
    tile.detail = new Float32Array(tile.width * tile.height);
    for (let i = 0; i < tile.detail.length; i++) tile.detail[i] = Math.max(.55, Math.min(1.4, 1 + (tile.pixels[i*4] / Math.max(1,mean) - 1) * .6));
  }
  tiles.set(material,tile); return tile;
}

const corners = [
  [[1,0,0],[1,0,1],[1,1,1],[1,1,0]], // +X
  [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], // +Y
  [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], // +Z
];
const normals = [[1,0,0],[0,1,0],[0,0,1]];
const light = [.78,1.08,.92];
const project = (x,y,z) => [(x-z)*RIGHT,(x+z)*UP-y*RISE,x+y+z];

export function renderBlueprint(structure) {
  const pixels = new Uint8ClampedArray(W * H * 4), depth = new Float32Array(W * H).fill(-Infinity);
  for (let i = 0; i < W*H; i++) { pixels.set(BG,i*4); pixels[i*4+3] = 255; }
  const {placed,size} = structure;
  if (placed.length > 2_000_000) throw new Error('Bauplan ist zu groß für eine Vorschau.');
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity], styles=[], palette=new Map(), cells=new Map();
  const sx=size[0], syStride=size[0]*size[2];
  for (const b of placed) {
    const p=[b.x,b.y,b.z];
    for(let a=0;a<3;a++){lo[a]=Math.min(lo[a],p[a]);hi[a]=Math.max(hi[a],p[a]+1);}
    let id=palette.get(b.name);
    if(id===undefined){id=styles.length;palette.set(b.name,id);styles.push({...blockStyle(b.name),name:b.name});}
    cells.set(b.y*syStride+b.z*sx+b.x,id);
  }
  if (!placed.length) {
    // An empty/demolition-only plan has no placed geometry. Show an empty ground grid.
    lo.fill(0);hi[0]=Math.min(size[0],32);hi[1]=1;hi[2]=Math.min(size[2],32);
  }
  let minU=Infinity,maxU=-Infinity,minV=Infinity,maxV=-Infinity;
  for(const x of [lo[0],hi[0]])for(const y of [lo[1],hi[1]])for(const z of [lo[2],hi[2]]){
    const [u,v]=project(x,y,z);minU=Math.min(minU,u);maxU=Math.max(maxU,u);minV=Math.min(minV,v);maxV=Math.max(maxV,v);
  }
  const scale=Math.min((W-100)/(maxU-minU||1),(H-88)/(maxV-minV||1),80*SCALE);
  const ox=(W-(maxU+minU)*scale)/2,oy=(H-(maxV+minV)*scale)/2-8*SCALE;
  const vertex=(x,y,z,u=0,v=0)=>{const q=project(x,y,z);return [q[0]*scale+ox,q[1]*scale+oy,q[2],u,v];};

  function triangle(a,b,c,tint,tile,shade,alpha=1,ground=false) {
    const denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(denominator)<1e-8)return;
    const minX=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),maxX=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0])));
    const minY=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),maxY=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
      const p=x+.5,q=y+.5;
      const wa=((b[1]-c[1])*(p-c[0])+(c[0]-b[0])*(q-c[1]))/denominator;
      const wb=((c[1]-a[1])*(p-c[0])+(a[0]-c[0])*(q-c[1]))/denominator,wc=1-wa-wb;
      if(wa<0||wb<0||wc<0)continue;
      const at=y*W+x,z=wa*a[2]+wb*b[2]+wc*c[2];
      if(z<=depth[at])continue;
      const u=wa*a[3]+wb*b[3]+wc*c[3],v=wa*a[4]+wb*b[4]+wc*c[4];
      const fu=u-Math.floor(u),fv=v-Math.floor(v);
      let detail=1,opacity=alpha;
      if(tile){
        const index=Math.min(tile.height-1,Math.floor(fv*tile.height))*tile.width+Math.min(tile.width-1,Math.floor(fu*tile.width));
        detail=tile.detail[index];
        if(tile.pixels[index*4+3]<80)continue;
      } else if(alpha<1) {
        const border=fu<.035||fv<.035||fu>.965||fv>.965;
        opacity=border?.7:alpha; detail=border?1.2:1;
      }
      if(ground) {
        const grid=fu<.025||fv<.025;
        detail=grid?1.25:1;
      }
      const px=at*4;
      for(let k=0;k<3;k++)pixels[px+k]=pixels[px+k]*(1-opacity)+Math.min(255,tint[k]*shade*detail)*opacity;
      if(alpha===1)depth[at]=z;
    }
  }
  function quad(v,tint,tile,shade,alpha=1,ground=false){triangle(v[0],v[1],v[2],tint,tile,shade,alpha,ground);triangle(v[0],v[2],v[3],tint,tile,shade,alpha,ground);}

  // A quiet one-block margin gives the render a readable base without adding world geometry.
  const baseY=lo[1]-.04;
  quad([[lo[0]-.35,baseY,lo[2]-.35],[hi[0]+.35,baseY,lo[2]-.35],[hi[0]+.35,baseY,hi[2]+.35],[lo[0]-.35,baseY,hi[2]+.35]].map(p=>vertex(...p,p[0]/4,p[2]/4)),[28,42,53],null,1,1,true);
  const transparent=[];
  function face(x,y,z,d,style) {
    const tile=texture(d===1&&style.material==='grass'?'grass':style.material==='grass'?'dirt':style.material);
    const tint=d===1&&style.top?style.top:style.color;
    const vertices=corners[d].map(c=>{
      const p=[x+c[0],y+c[1],z+c[2]];
      return vertex(...p,d===0?p[2]:p[0],d===1?p[2]:p[1]);
    });
    const glass=['glass','water'].includes(style.material);
    quad(vertices,tint,tile,style.emissive?1.25:light[d],glass?(style.material==='glass'?.24:.6):1);
  }
  // Only the three camera-facing sides can be visible from this fixed isometric angle.
  for(const [key,id] of cells){
    const x=key%sx,y=Math.floor(key/syStride),z=Math.floor(key/sx)%size[2],style=styles[id];
    for(let d=0;d<3;d++){
      const n=normals[d],nx=x+n[0],ny=y+n[1],nz=z+n[2];
      const other=nx<size[0]&&ny<size[1]&&nz<size[2]?cells.get(ny*syStride+nz*sx+nx):undefined;
      if(other!==undefined&&(!styles[other].translucent||other===id))continue;
      if(['glass','water'].includes(style.material))transparent.push({x,y,z,d,id,depth:x+y+z});
      else face(x,y,z,d,style);
    }
  }
  transparent.sort((a,b)=>a.depth-b.depth);
  for(const f of transparent)face(f.x,f.y,f.z,f.d,styles[f.id]);

  const result=new Uint8Array(WIDTH*HEIGHT*4);
  for(let y=0;y<HEIGHT;y++)for(let x=0;x<WIDTH;x++){
    const target=(y*WIDTH+x)*4;
    for(let k=0;k<3;k++){
      let sum=0;for(let dy=0;dy<SCALE;dy++)for(let dx=0;dx<SCALE;dx++)sum+=pixels[((y*SCALE+dy)*W+x*SCALE+dx)*4+k];
      result[target+k]=Math.round(sum/(SCALE*SCALE));
    }
    result[target+3]=255;
  }
  return encodePng(WIDTH,HEIGHT,result);
}
