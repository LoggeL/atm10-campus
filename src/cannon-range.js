// Create checks the 3D distance to the structure anchor, strictly below 256 blocks.
export const CANNON_RANGE = 256;

export function cannonRange(binding, origin) {
  const base = { limit: CANNON_RANGE, distance: null, origin: origin ?? null, position: binding ? [binding.x, binding.y, binding.z] : null };
  if (!origin) return { ...base, state: 'unassigned', message: 'Kein Bauplan gewählt.' };
  if (!binding) return { ...base, state: 'unbound', message: 'Kanonen-Position unter Ausrichtung bestätigen, um die Entfernung zu prüfen.' };
  if (binding.dimension !== 'minecraft:overworld') return { ...base, state: 'dimension', message: 'Der Campus-Bauplan gehört zur Oberwelt.' };
  const distance = Math.hypot(...origin.map((n, i) => n - base.position[i]));
  return { ...base, distance, state: distance < CANNON_RANGE ? 'inrange' : 'outofrange',
    message: distance < CANNON_RANGE ? 'Bauplan-Anker in Reichweite.' : 'Bauplan-Anker außerhalb der Reichweite. Eine nähere Kanone wählen oder die Kanone näher aufstellen und neu binden.' };
}

export function cannonTarget(campus, row, settings) {
  if (!row.blueprint_id) return null;
  const bp = campus.getBlueprint(row.blueprint_id);
  if (bp.archived) return null;
  const v = campus.version(bp.id, settings.enabled && settings.autoUpdate ? bp.currentVersion : row.version);
  return { id: bp.id, name: bp.name, version: v.version, origin: v.origin, size: v.size };
}

export function reachableCannons(rows, source, origin, bindingFor, busy, clock = Date.now()) {
  return rows.filter(r => r.name.toLowerCase() !== source.toLowerCase()).flatMap(r => {
    const binding = bindingFor(r.name), range = cannonRange(binding, origin);
    if (range.state !== 'inrange') return [];
    const online = !!r.last_seen_at && clock - Date.parse(r.last_seen_at) < 180000;
    const status = JSON.parse(r.status_json || 'null');
    const fresh = ['1.1.0','1.2.0','1.3.0','1.4.0'].includes(status?.script) && Number.isFinite(Date.parse(status?.at)) && clock - Date.parse(status.at) < 180000;
    const availability = r.blueprint_id ? 'assigned' : busy(r.name) ? 'applying' : !online ? 'offline' : !fresh ? 'outdated' : 'free';
    return [{ name: r.name, assignment: r.assignment, distance: range.distance, position: range.position, online, availability, blueprint: r.blueprint_id }];
  }).sort((a, b) => Number(b.availability === 'free') - Number(a.availability === 'free') || a.distance - b.distance || a.name.localeCompare(b.name));
}
