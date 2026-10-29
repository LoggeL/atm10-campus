// Material detail atlas: one 64×64 greyscale tile per material (mean ≈ 0.5), tinted per block in the shader.
// Tiles come from /viewer/textures/<material>.png (built from the image-gen sources); missing ones are generated.
import * as THREE from 'three';

const N = 64;

async function loadTile(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const bmp = await createImageBitmap(await res.blob());
  const c = new OffscreenCanvas(N, N), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = bmp.width > N * 2;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, N, N);
  return g.getImageData(0, 0, N, N).data;
}

// Small deterministic noise for generated tiles.
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) + 0x6d2b79f5 >>> 0) / 4294967296); }
function procedural(name) {
  const px = new Uint8ClampedArray(N * N * 4), r = rng([...name].reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const set = (x, y, v, a = 255) => { const i = (y * N + x) * 4; px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = a; };
  // Patterns are drawn on a 32-grid and scaled up to N.
  for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) {
    const x = (X * 32 / N) | 0, y = (Y * 32 / N) | 0;
    let v = 128 + (r() - 0.5) * 34, a = 255;
    switch (name) {
      case 'bricks': { const row = y >> 3, off = row & 1 ? 8 : 0; if (y % 8 === 0 || (x + off) % 16 === 0) v = 78; break; }
      case 'tiles': if (x % 16 === 0 || y % 16 === 0) v = 92; break;
      case 'planks': { v = 128 + Math.sin(y * 1.7 + r()) * 10 + (r() - 0.5) * 18; if (y % 8 === 0) v = 84; if ((x + (y >> 3) * 11) % 32 === 0) v = 90; break; }
      case 'log': v = 120 + Math.sin(x * 1.3) * 18 + (r() - 0.5) * 20; break;
      case 'smooth': v = 128 + (r() - 0.5) * 8 + (x === 0 || y === 0 ? -16 : 0); break;
      case 'metal': v = 132 + (r() - 0.5) * 10 + Math.sin(y * 0.9) * 4 - ((x === 2 || x === 29) && (y === 2 || y === 29) ? 50 : 0); break;
      case 'machine': { const edge = x < 3 || y < 3 || x > 28 || y > 28; v = edge ? 150 : 110 + (r() - 0.5) * 14; if (x > 9 && x < 22 && y > 9 && y < 22) v = 80 + ((x ^ y) & 3) * 12; break; }
      case 'crystal': v = 128 + ((x + y) % 11 < 2 ? 50 : 0) + (r() - 0.5) * 30; break;
      case 'wool': v = 128 + (r() - 0.5) * 22 + ((x + y) % 4 === 0 ? -8 : 0); break;
      case 'water': v = 128 + Math.sin(x * 0.5 + y * 0.3) * 10 + (r() - 0.5) * 8; a = 210; break;
      case 'lamp': { const cx = Math.abs(x - 15.5), cy = Math.abs(y - 15.5); v = 200 - Math.max(cx, cy) * 4 + (r() - 0.5) * 20; break; }
      case 'leaves': case 'plant': a = r() < (name === 'plant' ? 0.45 : 0.72) ? 255 : 0; v = 100 + r() * 70; break;
      case 'glass': { const frame = x === 0 || y === 0 || x === 31 || y === 31; v = frame ? 210 : 175; a = frame ? 255 : (x - y === 6 || x - y === 9 ? 150 : 60); break; }
      case 'cobble': { const cell = ((Math.floor(x / 6 + Math.sin(y / 4) * 0.6) * 7 + Math.floor(y / 6) * 13) % 5); v = 108 + cell * 9 + (r() - 0.5) * 26; if (r() < 0.07) v = 70; break; }
      default: break;
    }
    set(X, Y, Math.max(0, Math.min(255, v)), a);
  }
  return px;
}

// Greyscale, mean luminance → 128 over opaque pixels, gentle contrast cap so tints stay readable.
function normalize(src, name) {
  const out = new Uint8Array(N * N * 4);
  let sum = 0, n = 0;
  for (let i = 0; i < N * N; i++) {
    const l = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2];
    out[i * 4] = l; out[i * 4 + 3] = src[i * 4 + 3];
    if (src[i * 4 + 3] > 127) { sum += l; n++; }
  }
  const mean = n ? sum / n : 128, contrast = name === 'glass' ? 0.5 : 0.85;
  for (let i = 0; i < N * N; i++) {
    const v = 128 + (out[i * 4] / Math.max(1, mean) * 128 - 128) * contrast;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(v)));
  }
  return out;
}

export async function buildAtlas(materials, renderer) {
  const data = new Uint8Array(N * N * 4 * materials.length);
  const sources = await Promise.all(materials.map(async m => {
    if (m === 'glass') return { m, px: procedural(m), generated: true };
    try { const px = await loadTile(`/viewer/textures/${m}.png`); if (px) return { m, px, generated: false }; } catch { /* fall back */ }
    return { m, px: procedural(m), generated: true };
  }));
  sources.forEach(({ m, px }, i) => data.set(normalize(px, m), i * N * N * 4));
  const tex = new THREE.DataArrayTexture(data, N, N, materials.length);
  tex.format = THREE.RGBAFormat;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return { texture: tex, generated: sources.filter(s => s.generated).map(s => s.m) };
}
