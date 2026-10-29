// Camera navigation: orbit (default), free fly and walking with voxel collision.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const EYE = 1.62, HALF = 0.3, HEIGHT = 1.8;

export class Navigation {
  constructor(camera, dom) {
    this.camera = camera; this.dom = dom;
    this.mode = 'orbit';
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.screenSpacePanning = false;
    this.orbit.zoomToCursor = true;
    this.keys = new Set();
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.onGround = false;
    this.solid = null;
    this.speed = 1;
    this.listeners = new Set();
    this.drag = null;

    addEventListener('keydown', e => {
      if (e.target.closest?.('input, select, textarea')) return;
      this.keys.add(e.code);
      if (this.mode !== 'orbit' && ['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    dom.addEventListener('pointerdown', e => {
      if (this.mode === 'orbit') return;
      this.drag = { x: e.clientX, y: e.clientY };
      dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', e => {
      if (!this.drag || this.mode === 'orbit') return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag = { x: e.clientX, y: e.clientY };
      this.yaw -= dx * 0.004; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -1.55, 1.55);
    });
    dom.addEventListener('pointerup', () => { this.drag = null; });
    dom.addEventListener('wheel', e => {
      if (this.mode === 'orbit') return;
      this.speed = THREE.MathUtils.clamp(this.speed * (e.deltaY > 0 ? 0.85 : 1.18), 0.2, 8);
      this.emit('speed');
    }, { passive: true });
    this.orbit.addEventListener('end', () => this.emit('moved'));
  }

  on(fn) { this.listeners.add(fn); }
  emit(type) { for (const fn of this.listeners) fn(type, this); }

  setSolid(s) { this.solid = s; }

  isSolid(x, y, z) {
    const s = this.solid;
    if (!s) return false;
    const lx = Math.floor(x) - s.lo[0], ly = Math.floor(y) - s.lo[1], lz = Math.floor(z) - s.lo[2];
    if (ly < 0) return true;
    if (lx < 0 || lz < 0 || lx >= s.size[0] || ly >= s.size[1] || lz >= s.size[2]) return false;
    const i = (ly * s.size[2] + lz) * s.size[0] + lx;
    return (s.bits[i >> 3] >> (i & 7)) & 1;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    const prev = this.mode;
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    if (mode === 'orbit') {
      const t = this.camera.position.clone().addScaledVector(dir, 40);
      this.orbit.target.copy(t);
      this.orbit.update();
    } else {
      this.yaw = Math.atan2(-dir.x, -dir.z);
      this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      this.vel.set(0, 0, 0);
      // From orbit, start walking where the orbit looked at (usually the ground), not under the high camera.
      if (mode === 'walk' && prev === 'orbit') this.camera.position.set(this.orbit.target.x, this.orbit.target.y + 2, this.orbit.target.z);
      if (mode === 'walk' && prev !== 'walk') this.dropToGround();
    }
    this.emit('mode');
  }

  // Put the walker on the first free standing spot below (or above) the camera.
  dropToGround() {
    const p = this.camera.position;
    let y = Math.floor(p.y);
    for (let i = 0; i < 300 && !this.isSolid(p.x, y - 1, p.z); i++) y--;
    for (let i = 0; i < 300 && (this.isSolid(p.x, y, p.z) || this.isSolid(p.x, y + 1, p.z)); i++) y++;
    p.y = y + EYE;
    this.pitch = Math.min(this.pitch, 0.2);
  }

  lookAt(pos, target) {
    this.camera.position.set(...pos);
    if (this.mode === 'orbit') { this.orbit.target.set(...target); this.orbit.update(); }
    else {
      const d = new THREE.Vector3(target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]).normalize();
      this.yaw = Math.atan2(-d.x, -d.z); this.pitch = Math.asin(d.y);
    }
    this.emit('moved');
  }

  // Smooth camera flight to pos/target.
  flyTo(pos, target, ms = 900) {
    const fromP = this.camera.position.clone();
    const fromT = this.mode === 'orbit' ? this.orbit.target.clone() : fromP.clone().add(new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ')).multiplyScalar(30));
    const toP = new THREE.Vector3(...pos), toT = new THREE.Vector3(...target);
    const t0 = performance.now();
    this.anim = now => {
      const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const p = fromP.clone().lerp(toP, e), t = fromT.clone().lerp(toT, e);
      this.lookAt(p.toArray(), t.toArray());
      if (k >= 1) this.anim = null;
    };
  }

  target() {
    if (this.mode === 'orbit') return this.orbit.target.clone();
    const d = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    return this.camera.position.clone().addScaledVector(d, 30);
  }

  update(dt) {
    dt = Math.min(dt, 0.05);
    if (this.anim) this.anim(performance.now());
    if (this.mode === 'orbit') {
      // Keyboard panning in orbit mode too.
      const k = this.keys, move = new THREE.Vector3();
      if (k.has('KeyW') || k.has('ArrowUp')) move.z -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) move.z += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) move.x -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) move.x += 1;
      if (move.lengthSq()) {
        const dir = new THREE.Vector3(); this.camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
        const right = new THREE.Vector3().crossVectors(dir, this.camera.up).normalize();
        const dist = this.camera.position.distanceTo(this.orbit.target);
        const off = dir.multiplyScalar(-move.z).add(right.multiplyScalar(move.x)).multiplyScalar(dist * 0.9 * dt);
        this.camera.position.add(off); this.orbit.target.add(off);
      }
      this.orbit.update();
      return;
    }
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const k = this.keys;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) wish.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) wish.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) wish.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) wish.sub(right);
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    if (this.mode === 'fly') {
      if (k.has('Space') || k.has('KeyE')) wish.y += 1;
      if (k.has('KeyQ') || k.has('ControlLeft')) wish.y -= 1;
      if (wish.lengthSq()) wish.normalize();
      const v = 22 * this.speed * (sprint ? 3 : 1);
      this.vel.lerp(wish.multiplyScalar(v), 1 - Math.exp(-dt * 8));
      this.camera.position.addScaledVector(this.vel, dt);
      if (this.vel.lengthSq() > 0.01) this.moved = true;
    } else {
      if (wish.lengthSq()) wish.normalize();
      const v = 4.3 * (sprint ? 1.6 : 1) * Math.max(1, this.speed);
      const accel = this.onGround ? 14 : 3;
      this.vel.x += (wish.x * v - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (wish.z * v - this.vel.z) * Math.min(1, accel * dt);
      this.vel.y -= 30 * dt;
      if (this.onGround && k.has('Space')) { this.vel.y = 8.6; this.onGround = false; }
      this.collideMove(dt);
      if (this.vel.lengthSq() > 0.01) this.moved = true;
    }
    if (this.moved && !this.drag && !wish.lengthSq()) { this.moved = false; this.emit('moved'); }
  }

  // Axis-separated AABB vs voxel collision; steps up single blocks like the game does with auto-jump off.
  collideMove(dt) {
    const p = this.camera.position;
    const feet = new THREE.Vector3(p.x, p.y - EYE, p.z);
    const blocked = (x, y, z) => {
      for (let yy = Math.floor(y); yy <= Math.floor(y + HEIGHT - 0.01); yy++)
        for (const ox of [-HALF, HALF]) for (const oz of [-HALF, HALF]) if (this.isSolid(x + ox, yy, z + oz)) return true;
      return false;
    };
    for (const a of ['x', 'z']) {
      const next = feet.clone(); next[a] += this.vel[a] * dt;
      if (!blocked(next.x, next.y, next.z)) feet.copy(next);
      else if (this.onGround && !blocked(next.x, next.y + 1.01, next.z)) { next.y += 1.01; feet.copy(next); }
      else this.vel[a] = 0;
    }
    const ny = feet.y + this.vel.y * dt;
    if (this.vel.y < 0 && blocked(feet.x, ny, feet.z)) { feet.y = Math.floor(ny) + 1; this.vel.y = 0; this.onGround = true; }
    else if (this.vel.y > 0 && blocked(feet.x, ny + 0.02, feet.z)) { this.vel.y = 0; }
    else { feet.y = ny; this.onGround = false; }
    if (feet.y < -80) { feet.y = 200; this.vel.y = 0; }
    p.set(feet.x, feet.y + EYE, feet.z);
  }
}
