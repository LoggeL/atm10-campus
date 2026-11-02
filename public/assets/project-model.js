import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $=s=>document.querySelector(s), stage=$('#stage'), status=$('#status');
const id=new URL(location.href).searchParams.get('id')||'erebor';
$('#back').href='/projects?id='+encodeURIComponent(id);
let renderer,scene,camera,controls;
async function start(){
 const response=await fetch('/api/projects/'+encodeURIComponent(id),{cache:'no-store'});
 if(response.status===401){location.assign('/login');return;}
 if(!response.ok)throw Error('Projekt konnte nicht geladen werden ('+response.status+').');
 const project=await response.json(), preview=project.plan.blockPreview;
 if(!preview)throw Error('Dieses Projekt besitzt noch kein Blockmodell.');
 const packed=Uint8Array.from(atob(preview.dataGzipBase64),c=>c.charCodeAt(0));
 if(packed.length>400000)throw Error('Blockmodell ist zu groß.');
 const stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
 const reader=stream.getReader(),chunks=[];let decodedBytes=0;
 for(;;){const {done,value}=await reader.read();if(done)break;decodedBytes+=value.length;if(decodedBytes>16000000){await reader.cancel();throw Error('Entpacktes Modell ist zu groß.');}chunks.push(value);}
 const model=JSON.parse(await new Blob(chunks).text());
 const integer=v=>Number.isSafeInteger(v)&&Math.abs(v)<100000;
 if(model.format!=='minecraft-block-runs-v1'||!Array.isArray(model.runs)||model.runs.length>100000||!Array.isArray(model.palette)||model.palette.length>32||!Array.isArray(model.bounds)||model.bounds.length!==2||model.bounds.some(v=>!Array.isArray(v)||v.length!==3||!v.every(integer)))throw Error('Unbekanntes Blockformat.');
 const [lo,hi]=model.bounds, size=hi.map((v,i)=>v-lo[i]);
 if(size.some(n=>n<1)||size.reduce((a,b)=>a*b,1)>16000000)throw Error('Modellabmessungen sind zu groß.');
 const cells=new Uint8Array(size[0]*size[1]*size[2]);
 const offset=(x,y,z)=>((y-lo[1])*size[2]+z-lo[2])*size[0]+x-lo[0];
 let blockCount=0;
 for(const run of model.runs){
  if(!Array.isArray(run)||run.length!==5||!run.every(integer))throw Error('Ungültige Blockzeile.');
  const [x,y,z,len,p]=run;
  if(len<1||p<0||p>=model.palette.length||x<lo[0]||x+len>hi[0]||y<lo[1]||y>=hi[1]||z<lo[2]||z>=hi[2])throw Error('Block außerhalb der Modellgrenze.');
  blockCount+=len;if(blockCount>500000)throw Error('Mehr als 500.000 Blöcke sind in dieser Vorschau nicht vorgesehen.');
  cells.fill(p+1,offset(x,y,z),offset(x,y,z)+len);
 }
 const at=(x,y,z)=>x<lo[0]||y<lo[1]||z<lo[2]||x>=hi[0]||y>=hi[1]||z>=hi[2]?0:cells[offset(x,y,z)];
 if(preview.textureAtlas!=='/assets/erebor-blocks-v1/atlas.png')throw Error('Texturatlas nicht unterstützt.');
 const atlas=await new THREE.TextureLoader().loadAsync(preview.textureAtlas);
 atlas.magFilter=THREE.NearestFilter;atlas.minFilter=THREE.NearestMipmapLinearFilter;atlas.generateMipmaps=true;atlas.colorSpace=THREE.SRGBColorSpace;
 const positions=[],normals=[],uvs=[],colors=[];
 const faces=[
  {n:[1,0,0],v:[[1,0,0],[1,1,0],[1,1,1],[1,0,1]],light:.82},
  {n:[-1,0,0],v:[[0,0,1],[0,1,1],[0,1,0],[0,0,0]],light:.82},
  {n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],light:1},
  {n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],light:.5},
  {n:[0,0,1],v:[[1,0,1],[1,1,1],[0,1,1],[0,0,1]],light:.94},
  {n:[0,0,-1],v:[[0,0,0],[0,1,0],[1,1,0],[1,0,0]],light:.74}
 ];
 let faceCount=0;
 for(const [rx,y,z,len,p] of model.runs){
  const ax=(p%8)*20+2,ay=Math.floor(p/8)*20+2;
  const quadUV=[[ax/160,1-(ay+16)/80],[ax/160,1-ay/80],[(ax+16)/160,1-ay/80],[(ax+16)/160,1-(ay+16)/80]];
  for(let x=rx;x<rx+len;x++)for(const face of faces){
   const [nx,ny,nz]=face.n;if(at(x+nx,y+ny,z+nz))continue;
   faceCount++;
   for(const vi of [0,1,2,0,2,3]){
    const v=face.v[vi];positions.push(x+v[0],y+v[1],z+v[2]);normals.push(nx,ny,nz);uvs.push(...quadUV[vi]);
    const light=p===6?1:face.light;colors.push(light,light,light);
   }
  }
 }
 const geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.computeBoundingSphere();
 scene=new THREE.Scene();scene.background=new THREE.Color('#a6c8e5');
 camera=new THREE.PerspectiveCamera(43,1,.1,1500);
 renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 stage.appendChild(renderer.domElement);
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:atlas,vertexColors:true}));scene.add(mesh);
 // Minecraft-like fixed face shading, no fake bevels, interpolated texture blur or cinematic bloom.
 controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.minDistance=8;controls.maxDistance=450;controls.maxPolarAngle=Math.PI*.53;
 const frame=(pos,target)=>{camera.position.set(...pos);controls.target.set(...target);controls.update();};
 const front=()=>frame([0,34,146],[0,32,0]);
 $('#front').onclick=front;
 $('#overview').onclick=()=>frame([58,46,147],[0,32,1]);
 $('#logge').onclick=()=>frame([-64,34,94],[-46,32,6]);
 $('#jonny').onclick=()=>frame([63,34,94],[46,32,6]);
 $('#save').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.href=renderer.domElement.toDataURL('image/png');a.download='Erebor-Minecraft-Blockvorschau-v'+preview.revision+'.png';a.click();};
 const resize=()=>{const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();};
 new ResizeObserver(resize).observe(stage);resize();front();
 $('#detail').textContent=blockCount.toLocaleString('de-DE')+' Blöcke · '+model.palette.length+' Materialien · Ziehen: drehen · Mausrad: zoomen';
 document.title='Erebor · Minecraft-Blockvorschau v'+preview.revision;
 renderer.domElement.setAttribute('aria-label','Erebor-Blockmodell mit LoggeL und KGZJonny');
 status.hidden=true;
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
}
start().catch(e=>{status.textContent=e.message;status.style.color='#ffc0b8';});
