import { loadBlockPreview } from '/viewer/block-preview.js?v=20261104-erebor-rooms-3';
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
 const {mesh,blockCount}=await loadBlockPreview(preview);
 scene=new THREE.Scene();scene.background=new THREE.Color('#a6c8e5');
 camera=new THREE.PerspectiveCamera(43,1,.1,1500);
 renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
 stage.appendChild(renderer.domElement);
 scene.add(mesh);
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
 $('#detail').textContent=blockCount.toLocaleString('de-DE')+' Blöcke · Originaltexturen · Ziehen: drehen · Mausrad: zoomen';
 document.title='Erebor · Minecraft-Blockvorschau v'+preview.revision;
 renderer.domElement.setAttribute('aria-label','Erebor-Blockmodell mit LoggeL und KGZJonny');
 status.hidden=true;
 renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
}
start().catch(e=>{status.textContent=e.message;status.style.color='#ffc0b8';});
