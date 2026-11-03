import { HttpError } from './auth.js';
import { worldPoint, validPlacement } from './project-placement.js';
import { mountainTop, validateMountain } from './project-stone.js';

const point = p => Array.isArray(p) && p.length === 3 && p.every(v => Number.isSafeInteger(v) && Math.abs(v) < 30_000_000);
const box = b => Array.isArray(b) && b.length === 2 && b.every(point) && b[0].every((v, i) => v < b[1][i]);
const list = (v, limit) => Array.isArray(v) && v.length <= limit ? v : [];
const text = v => typeof v === 'string' ? v : '';

export function viewerProjects(campus) {
  return campus.db.prepare('SELECT id, current_version, plan_json FROM build_projects ORDER BY id').all().map(r => {
    const plan = JSON.parse(r.plan_json);
    return { id: r.id, version: r.current_version, title: plan.title, kind: plan.kind === 'blueprint_collection' ? 'blueprints' : 'planning' };
  });
}

export function viewerProject(campus, id) {
  if (!id) return null;
  const row = campus.db.prepare('SELECT * FROM build_projects WHERE id = ?').get(id);
  if (!row) throw new HttpError(404, 'Bauprojekt nicht gefunden.');
  return { id: row.id, version: row.current_version, updatedAt: row.updated_at, plan: JSON.parse(row.plan_json) };
}

// Project geometry is deliberately separate from analysed NBT cells. Room reserves
// and coarse survey samples must never acquire build-progress or collision status.
export function projectScene(project) {
  const p = project.plan, placed = p.worldOrigin !== null;
  if (!validPlacement(p)) throw new HttpError(422, 'Ungültiger Projektstandort.');
  const transform = v => placed ? worldPoint(p, v) : v;
  const transformBox = b => {
    const a = transform(b[0]), c = transform(b[1]);
    return [a.map((v, i) => Math.min(v, c[i])), a.map((v, i) => Math.max(v, c[i]))];
  };
  const styles = new Map(list(p.styles, 100).map(s => [s.id, /^#[a-f\d]{6}$/i.test(s.color) ? s.color : '#73d8e5']));
  const zones = list(p.zones, 1000).filter(z => box(z.bounds)).map(z => ({
    id: text(z.id), title: text(z.title), bounds: transformBox(z.bounds),
    footprint: placed && Array.isArray(z.worldFootprint) && z.worldFootprint.length >= 3 && z.worldFootprint.length <= 100 && z.worldFootprint.every(v => Array.isArray(v) && v.length === 2 && v.every(Number.isSafeInteger)) ? z.worldFootprint : null,
    floors: list(z.floors, 100).filter(Number.isSafeInteger).map(y => y + (placed ? p.worldOrigin[1] : 0)),
    color: styles.get(z.style) || '#73d8e5', features: list(z.features, 100).map(text), kind: 'zone',
  }));
  const cannons = placed ? list(p.cannonLayout?.stations, 100).filter(c => point(c.position)).map(c => ({
    id: text(c.id), title: text(c.id), position: c.position, setup: text(c.setup), assigned: c.assigned,
    bounds: [c.position.map(v => v - 4), c.position.map(v => v + 5)], kind: 'cannon',
  })) : [];
  const protectedAreas = placed ? list(p.site?.protectedAreas, 100).filter(a => box(a.bounds)).map(a => ({
    id: text(a.id), title: text(a.title), bounds: a.bounds, reason: text(a.reason), kind: 'protected',
  })) : [];
  const terrain = placed ? list(p.site?.terrainSamples, 20_000).filter(s => Array.isArray(s) && s.length === 4 && s.every(Number.isSafeInteger) && Math.abs(s[0]) < 30_000_000 && Math.abs(s[1]) < 30_000_000 && s[2] >= -64 && s[2] < 320) : [];
  let mountain = null;
  if (p.mountainFill) {
    try { validateMountain(p); } catch (e) { throw new HttpError(422, e.message); }
    const [lo, hi] = p.mountainFill.bounds, step = 16, columns = [];
    for (let z = lo[2]; z < hi[2]; z += step) for (let x = lo[0]; x < hi[0]; x += step) {
      const top = mountainTop(p, x + step / 2, z + step / 2);
      if (top === null) continue;
      // Split each sample column around protected vertical intervals.
      let spans = [[lo[1], top + 1]];
      for (const { bounds: [a, b] } of p.mountainFill.protectedBoxes) {
        if (x + step <= a[0] || x >= b[0] || z + step <= a[2] || z >= b[2]) continue;
        spans = spans.flatMap(([y0, y1]) => b[1] <= y0 || a[1] >= y1 ? [[y0, y1]] : [[y0, Math.min(y1, a[1])], [Math.max(y0, b[1]), y1]].filter(([u, v]) => v > u));
      }
      for (const [bottom, roof] of spans) columns.push([x, bottom, z, Math.min(step, hi[0] - x), roof - bottom, Math.min(step, hi[2] - z)]);
    }
    mountain = { step, bounds: p.mountainFill.bounds, columns };
  }
  const boxes = [...zones, ...cannons, ...protectedAreas].map(o => o.bounds);
  if (box(p.envelope?.bounds)) boxes.push(transformBox(p.envelope.bounds));
  if (mountain) boxes.push(mountain.bounds);
  if (!boxes.length) throw new HttpError(422, 'Dieses Projekt enthält noch keine räumliche Planung.');
  const bounds = [0, 1].map(side => [0, 1, 2].map(axis => side ? Math.max(...boxes.map(b => b[side][axis])) : Math.min(...boxes.map(b => b[side][axis]))));
  return {
    id: project.id, title: p.title, version: project.version, updatedAt: project.updatedAt,
    placed, origin: placed ? p.worldOrigin : [0, 0, 0], rotationDegrees: p.rotationDegrees || 0,
    bounds, zones, cannons, protectedAreas, terrain, surveyedAt: p.site?.surveyedAt || null, mountain,
    levels: list(p.levels, 100).filter(l => Number.isSafeInteger(l.y)).map(l => ({ y: l.y + (placed ? p.worldOrigin[1] : 0), title: text(l.title) })),
    preview: p.blockPreview ? { title: text(p.blockPreview.title), description: text(p.blockPreview.description), revision: p.blockPreview.revision } : null,
  };
}
