import * as THREE from 'three';

// Surface of sampled columns, omitting shared/internal faces. No world-sized grid.
export function columnGeometry(columns) {
  const positions = [], cells = new Map();
  for (const c of columns) {
    const key = `${c[0]},${c[2]}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(c);
  }
  const quad = (a, b, c, d) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  for (const [x, y, z, w, h, d] of columns) {
    const X = x + w, Y = y + h, Z = z + d;
    quad([x,Y,z], [x,Y,Z], [X,Y,Z], [X,Y,z]);
    quad([x,y,Z], [x,y,z], [X,y,z], [X,y,Z]);
    for (const [dx, dz, side] of [[w,0,0],[-w,0,1],[0,d,2],[0,-d,3]]) {
      let spans = [[y, Y]];
      for (const n of cells.get(`${x+dx},${z+dz}`) || []) {
        spans = spans.flatMap(([a,b]) => n[1]+n[4] <= a || n[1] >= b ? [[a,b]] : [[a,Math.min(b,n[1])],[Math.max(a,n[1]+n[4]),b]].filter(([u,v]) => v>u));
      }
      for (const [a,b] of spans) {
        if (side === 0) quad([X,a,z],[X,b,z],[X,b,Z],[X,a,Z]);
        if (side === 1) quad([x,a,Z],[x,b,Z],[x,b,z],[x,a,z]);
        if (side === 2) quad([X,a,Z],[X,b,Z],[x,b,Z],[x,a,Z]);
        if (side === 3) quad([x,a,z],[x,b,z],[X,b,z],[X,a,z]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export class ProjectGeometry {
  constructor(view, data) {
    this.view = view; this.data = data;
    this.clip = new THREE.Plane(new THREE.Vector3(0,-1,0), 1e6);
    view.renderer.localClippingEnabled = true;
    this.groups = new Map(); this.objects = new Map(); this.pickables = []; this.labels = [];
    for (const id of ['mountain','terrain','zones','protected','cannons','preview']) {
      const group = new THREE.Group(); this.groups.set(id, group); view.scene.add(group);
    }
    if (data.mountain) this.add('mountain', new THREE.Mesh(columnGeometry(data.mountain.columns), this.material('#8e9598')));
    this.makeTerrain();
    for (const zone of data.zones) this.makeVolume('zones', zone, zone.color);
    for (const area of data.protectedAreas) this.makeVolume('protected', area, '#ffae67');
    for (const cannon of data.cannons) this.makeCannon(cannon);
  }

  material(color, opacity = 1) {
    return new THREE.MeshLambertMaterial({ color, opacity, transparent: opacity < 1, depthWrite: opacity === 1, side: THREE.DoubleSide, clippingPlanes: [this.clip] });
  }
  add(layer, object, item = null) {
    this.groups.get(layer).add(object);
    if (item) { object.userData.item = item; this.pickables.push(object); }
    object.traverse(o => { if (o.material) { o.material.clippingPlanes = [this.clip]; o.material.clipShadows = true; } });
    return object;
  }
  makeVolume(layer, item, color) {
    const [lo,hi] = item.bounds, size = hi.map((v,i) => v-lo[i]);
    const group = new THREE.Group();
    let geometry;
    if (item.footprint) {
      const shape = new THREE.Shape(item.footprint.map(([x,z]) => new THREE.Vector2(x,-z)));
      geometry = new THREE.ExtrudeGeometry(shape, {depth:size[1],bevelEnabled:false});
      geometry.rotateX(-Math.PI/2); geometry.translate(0,lo[1],0);
    } else {
      geometry = new THREE.BoxGeometry(...size); geometry.translate(...lo.map((v,i) => v+size[i]/2));
    }
    const mesh = new THREE.Mesh(geometry, this.material(color, .22)); group.add(mesh);
    mesh.userData.item = item; this.pickables.push(mesh);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({color,clippingPlanes:[this.clip]})); group.add(edge);
    this.add(layer,group); this.objects.set(item.kind+':'+item.id,group);
  }
  makeCannon(item) {
    const group = new THREE.Group();
    const marker = new THREE.Mesh(new THREE.OctahedronGeometry(8),this.material('#73d8e5'));
    marker.position.set(...item.position); marker.position.y += 8;
    marker.userData.item = item; this.pickables.push(marker); group.add(marker);
    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#142530'; ctx.fillRect(0,0,128,64);
    ctx.strokeStyle = '#73d8e5'; ctx.lineWidth = 4; ctx.strokeRect(2,2,124,60);
    ctx.fillStyle = '#e8f0f5'; ctx.font = 'bold 36px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(item.id,64,32);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthTest:false,clippingPlanes:[this.clip]}));
    label.position.set(...item.position); label.position.y += 36; label.scale.set(44,22,1); label.renderOrder=10;
    label.userData.item=item; this.pickables.push(label); group.add(label);
    this.labels.push(label);
    this.add('cannons',group); this.objects.set('cannon:'+item.id,group);
  }
  makeTerrain() {
    const p=[], c=[];
    for (const [x,z,y,water] of this.data.terrain) {
      // Each patch represents a saved height sample, not a block-exact surface.
      const color = new THREE.Color(water ? '#4b849d' : '#6e8267');
      for (const [dx,dz] of [[0,0],[0,30],[30,30],[0,0],[30,30],[30,0]]) {
        p.push(x+dx,y+1,z+dz); c.push(color.r,color.g,color.b);
      }
    }
    if (!p.length) return;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(p,3)); geometry.setAttribute('color',new THREE.Float32BufferAttribute(c,3)); geometry.computeVertexNormals();
    const material = this.material('#ffffff'); material.vertexColors=true;
    this.add('terrain',new THREE.Mesh(geometry,material));
  }
  setMode(layer, mode) {
    const group = this.groups.get(layer); group.visible = mode !== 'off';
    group.traverse(o => {
      if (!o.material || o.isLineSegments || o.isSprite) return;
      const opacity = mode === 'ghost' ? (layer === 'terrain' ? .3 : .18) : layer === 'zones' || layer === 'protected' ? .6 : 1;
      o.material.transparent = opacity < 1; o.material.opacity = opacity; o.material.depthWrite = opacity === 1; o.material.needsUpdate = true;
    });
    this.view.markShadows();
  }
  setVisible(key, visible) { const o=this.objects.get(key); if(o)o.visible=visible; }
  setClip(y) { this.clip.constant=y; this.view.markShadows(); }
  updateLabels(camera, viewportHeight) {
    for (const label of this.labels) {
      const units = 2 * camera.position.distanceTo(label.position) * Math.tan(camera.fov * Math.PI / 360) / viewportHeight;
      label.scale.set(48*units,24*units,1);
    }
  }
  highlight(item) {
    if (this.selection) { this.view.scene.remove(this.selection); this.selection.geometry.dispose(); this.selection.material.dispose(); this.selection=null; }
    if (!item) return;
    const [lo,hi]=item.bounds, box=new THREE.Box3(new THREE.Vector3(...lo),new THREE.Vector3(...hi));
    this.selection=new THREE.Box3Helper(box,0xffdf8c); this.selection.material.clippingPlanes=[this.clip]; this.view.scene.add(this.selection);
  }
  pick(ray) {
    const visible = o => { for (let p=o;p;p=p.parent) if(!p.visible)return false; return true; };
    return ray.intersectObjects(this.pickables.filter(visible),false).find(h=>h.point.y<=this.clip.constant)?.object.userData.item || null;
  }
  async loadPreview(preview) {
    const { loadBlockPreview } = await import('./block-preview.js?v=20261104-project-coordinates-1');
    const { mesh, bounds, blockCount } = await loadBlockPreview(preview);
    mesh.rotation.y = this.data.rotationDegrees * Math.PI/180;
    mesh.position.set(...this.data.origin); mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    const item = {id:'prototype',kind:'preview',title:preview.title,description:preview.description,bounds:[b.min.toArray(),b.max.toArray()],blockCount};
    this.add('preview',mesh,item); this.objects.set('preview:prototype',mesh);
    return item;
  }
}
