// three.js scene: textured voxel chunks with per-face categories, day/night sky, sun shadows and bloom.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Layer modes per category: 0 aus, 1 Textur, 2 Statusfarbe, 3 Geist (Raster-Transparenz), 4 gedimmt.
export const MODE = { OFF: 0, TEXTURE: 1, COLOR: 2, GHOST: 3, DIM: 4 };
export const CATEGORY_COUNT = 32;

const SHARED = {
  uAtlas: { value: null },
  uMode: { value: new Float32Array(CATEGORY_COUNT) },
  uCatColor: { value: Array.from({ length: CATEGORY_COUNT }, () => new THREE.Color(1, 1, 1)) },
  uOverlap: { value: 0 },
  uClipY: { value: 1e6 },
  uNight: { value: 0 },
  uLampLayer: { value: 16 },
  uCutoutMask: { value: 0 },
  uSelMin: { value: new THREE.Vector3(1e9, 1e9, 1e9) },
  uSelMax: { value: new THREE.Vector3(-1e9, -1e9, -1e9) },
  uTime: { value: 0 },
};

const VERT_DECL = `
attribute vec2 aUv; attribute float aLayer; attribute float aInfo; attribute float aAo; attribute vec3 aTint;
varying vec2 vTUv; varying float vLayer; varying float vInfo; varying float vAo; varying vec3 vTint; varying vec3 vWPos;`;
const VERT_BODY = `
vTUv = aUv; vLayer = aLayer; vInfo = aInfo; vAo = aAo; vTint = aTint; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`;
const FRAG_DECL = `
uniform mediump sampler2DArray uAtlas;
uniform float uMode[${CATEGORY_COUNT}]; uniform vec3 uCatColor[${CATEGORY_COUNT}];
uniform float uOverlap, uClipY, uNight, uLampLayer, uCutoutMask, uTime;
uniform vec3 uSelMin, uSelMax;
varying vec2 vTUv; varying float vLayer; varying float vInfo; varying float vAo; varying vec3 vTint; varying vec3 vWPos;
float bayer4(vec2 p) { ivec2 i = ivec2(mod(p, 4.0)); int b[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5); return float(b[i.y * 4 + i.x]) / 16.0; }
int catMode(out vec3 statusColor, out bool overlap) {
  float info = floor(vInfo + 0.5);
  float cat = mod(info, 32.0);
  overlap = info >= 32.0 && uOverlap > 0.5;
  statusColor = overlap ? vec3(0.93, 0.36, 0.86) : uCatColor[int(cat)];
  int m = int(uMode[int(cat)] + 0.5);
  if (overlap && m != 0) m = 2;
  return m;
}`;

function patchMain(shader) {
  Object.assign(shader.uniforms, SHARED);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>' + VERT_DECL)
    .replace('#include <begin_vertex>', '#include <begin_vertex>' + VERT_BODY);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>' + FRAG_DECL)
    .replace('#include <map_fragment>', `
      vec3 statusColor; bool overlap;
      int mode = catMode(statusColor, overlap);
      if (mode == 0 || vWPos.y > uClipY) discard;
      float layerIdx = floor(vLayer + 0.5);
      vec4 tex = texture(uAtlas, vec3(vTUv, layerIdx)); // repeat wrapping, no fract → no mip seams
      vec3 detail = tex.rgb * 2.0;               // atlas stores luminance detail around 0.5
      bool cutout = mod(floor(uCutoutMask / pow(2.0, layerIdx)), 2.0) > 0.5;
      if (cutout && tex.a < 0.5) discard;
      vec3 albedo = pow(vTint, vec3(2.2)) * detail;
      float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
      if (mode == 2) albedo = statusColor * (0.6 + 0.4 * detail.g);
      if (mode == 3) {
        if (bayer4(gl_FragCoord.xy) > 0.42) discard;
        albedo = mix(albedo, statusColor, 0.65);
      }
      if (mode == 4) albedo = mix(albedo, vec3(lum), 0.75) * 0.7;
      diffuseColor.rgb = albedo * vAo;
      diffuseColor.a *= tex.a;
      vec3 selD = max(uSelMin - vWPos, vWPos - uSelMax);
      float inSel = step(max(max(selD.x, selD.y), selD.z), 0.02);
    `)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (abs(layerIdx - uLampLayer) < 0.5) totalEmissiveRadiance += albedo * (0.25 + 2.2 * uNight);
      if (mode == 2 || overlap) totalEmissiveRadiance += statusColor * 0.18;
      if (mode == 3) totalEmissiveRadiance += statusColor * (0.25 + 0.15 * sin(uTime * 3.0));
      totalEmissiveRadiance += inSel * vec3(0.10, 0.35, 0.40) * (0.6 + 0.4 * sin(uTime * 2.5));
    `);
}

function patchDepth(shader) {
  Object.assign(shader.uniforms, SHARED);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aInfo; varying float vInfo; varying vec3 vWPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInfo = aInfo; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      uniform float uMode[${CATEGORY_COUNT}]; uniform float uClipY; varying float vInfo; varying vec3 vWPos;`)
    .replace('void main() {', `void main() {
      float cat = mod(floor(vInfo + 0.5), 32.0);
      int m = int(uMode[int(cat)] + 0.5);
      if (m == 0 || m == 3 || vWPos.y > uClipY) discard;`);
}

export class VoxelRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 4000);
    this.chunks = new THREE.Group();
    this.scene.add(this.chunks);
    this.meshes = new Map();
    this.uniforms = SHARED;

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3020, 1.1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.sky = this.makeSky();
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(0x9fc3e0, 300, 1400);

    this.materials = {
      opaque: this.makeMaterial(false),
      transparent: this.makeMaterial(true),
    };
    this.depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.depthMaterial.onBeforeCompile = patchDepth;
    this.depthMaterial.customProgramCacheKey = () => 'voxel-depth';

    this.grid = new THREE.GridHelper(1, 1, 0x3c6f7a, 0x22414a);
    this.grid.material.transparent = true; this.grid.material.opacity = 0.35;
    this.scene.add(this.grid);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.bloomEnabled = true;
    this.setTimeOfDay(15.5);
  }

  makeMaterial(transparent) {
    const m = new THREE.MeshLambertMaterial({ transparent, depthWrite: !transparent, side: THREE.FrontSide, opacity: transparent ? 0.62 : 1 });
    m.onBeforeCompile = patchMain;
    m.customProgramCacheKey = () => 'voxel-' + transparent;
    return m;
  }

  makeSky() {
    const geo = new THREE.SphereGeometry(3000, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uNight: SHARED.uNight },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 uTop, uHorizon, uSunDir, uSunColor; uniform float uNight; varying vec3 vDir;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,45.164))) * 43758.5453); }
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 c = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
          float s = max(dot(vDir, uSunDir), 0.0);
          c += uSunColor * (pow(s, 900.0) * 6.0 + pow(s, 12.0) * 0.35);
          vec3 cell = floor(vDir * 420.0);
          float star = step(0.9975, hash(cell)) * uNight * smoothstep(0.0, 0.25, h);
          c += vec3(star);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -1;
    return m;
  }

  // hour 0..24 → sun position, light colours, sky gradient, lamp glow.
  setTimeOfDay(hour) {
    this.hour = hour;
    const t = (hour - 6) / 12 * Math.PI;           // 6h sunrise, 18h sunset
    const elev = Math.sin(t), az = t * 0.9 + 0.6;
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(Math.asin(Math.max(-1, Math.min(1, elev)))), elev, Math.sin(az) * 0.6 + 0.3).normalize();
    const day = THREE.MathUtils.smoothstep(elev, -0.12, 0.25);
    const dusk = Math.max(0, 1 - Math.abs(elev) / 0.3) * (elev > -0.2 ? 1 : 0);
    SHARED.uNight.value = 1 - day;
    const sunColor = new THREE.Color().setRGB(1, 0.93, 0.82).lerp(new THREE.Color(1, 0.55, 0.3), dusk);
    this.sun.color.copy(sunColor);
    this.sun.intensity = 0.15 + 2.6 * day;
    if (elev < 0) { this.sun.color.setRGB(0.55, 0.65, 1.0); this.sun.intensity = 0.35; dir.set(-dir.x, Math.abs(dir.y) + 0.4, -dir.z).normalize(); }
    this.sunDir = dir;
    this.hemi.intensity = 0.25 + 0.95 * day;
    this.hemi.color.setRGB(0.55 + 0.2 * day, 0.65 + 0.2 * day, 0.95);
    const top = new THREE.Color(0x0a1428).lerp(new THREE.Color(0x3d7bd0), day);
    const horizon = new THREE.Color(0x16223a).lerp(new THREE.Color(0xb9d6ee), day).lerp(new THREE.Color(0xf09a62), dusk * 0.55);
    const u = this.sky.material.uniforms;
    u.uTop.value.copy(top); u.uHorizon.value.copy(horizon); u.uSunDir.value.copy(dir); u.uSunColor.value.copy(sunColor).multiplyScalar(day);
    this.scene.fog.color.copy(horizon);
    this.bloom.strength = 0.18 + 0.55 * (1 - day);
    this.placeSun();
  }

  setBounds(lo, size) {
    this.lo = lo; this.size = size;
    this.center = new THREE.Vector3(lo[0] + size[0] / 2, lo[1] + 64, lo[2] + size[2] / 2);
    const span = Math.max(size[0], size[2]);
    this.grid.geometry.dispose();
    const g = new THREE.GridHelper(Math.ceil(span / 16) * 16 + 64, Math.ceil(span / 16) + 4, 0x3c6f7a, 0x22414a);
    this.grid.geometry = g.geometry;
    this.grid.position.set(this.center.x, 63.01, this.center.z);
    const cam = this.sun.shadow.camera, half = span * 0.62;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 1; cam.far = span * 3;
    cam.updateProjectionMatrix();
    this.scene.fog.near = span * 1.2; this.scene.fog.far = span * 4.5;
    this.placeSun();
  }

  placeSun() {
    if (!this.center || !this.sunDir) return;
    const span = Math.max(this.size[0], this.size[2]);
    this.sun.position.copy(this.center).addScaledVector(this.sunDir, span * 1.4);
    this.sun.target.position.copy(this.center);
    this.markShadows();
  }

  setAtlas(texture, layers) {
    SHARED.uAtlas.value = texture;
    SHARED.uLampLayer.value = layers.indexOf('lamp');
    let mask = 0;
    for (const n of ['leaves', 'plant']) { const i = layers.indexOf(n); if (i >= 0) mask += 2 ** i; }
    SHARED.uCutoutMask.value = mask;
  }

  setChunk(key, kind, data) {
    const id = key + ':' + kind;
    for (const part of ['opaque', 'transparent']) {
      const old = this.meshes.get(id + ':' + part);
      if (old) { this.chunks.remove(old); old.geometry.dispose(); this.meshes.delete(id + ':' + part); }
      const g = data?.[part];
      if (!g) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(g.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(g.normal, 3, true));
      geo.setAttribute('aTint', new THREE.BufferAttribute(g.color, 3, true));
      geo.setAttribute('aUv', new THREE.BufferAttribute(g.uv, 2));
      geo.setAttribute('aLayer', new THREE.BufferAttribute(g.layer, 1));
      geo.setAttribute('aInfo', new THREE.BufferAttribute(g.info, 1));
      geo.setAttribute('aAo', new THREE.BufferAttribute(g.ao, 1, true));
      geo.setIndex(new THREE.BufferAttribute(g.index, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, this.materials[part]);
      mesh.position.set(...g.offset);
      mesh.castShadow = part === 'opaque';
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = this.depthMaterial;
      if (part === 'transparent') mesh.renderOrder = 2;
      this.chunks.add(mesh);
      this.meshes.set(id + ':' + part, mesh);
    }
    this.markShadows();
  }

  markShadows() { this.renderer.shadowMap.needsUpdate = true; }

  setShadows(on) {
    this.sun.castShadow = on;
    this.markShadows();
  }

  removeAll() {
    for (const m of this.meshes.values()) { this.chunks.remove(m); m.geometry.dispose(); }
    this.meshes.clear();
    this.markShadows();
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt) {
    SHARED.uTime.value += dt;
    if (this.bloomEnabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  stats() {
    let tris = 0;
    for (const m of this.meshes.values()) tris += m.geometry.index.count / 3;
    return { meshes: this.meshes.size, triangles: tris };
  }
}
