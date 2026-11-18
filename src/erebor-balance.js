import {slotsFor} from './erebor-groups.js';
// Preferences only. The database reservation rechecks each candidate against live work.
export function planMassifWork(tiles, slots) {
  const load = slots.map(() => 0);
  const byKey = new Map(slots.map((slot, index) => [slot.site + slot.slot, index]));
  const pending = [];
  const geometry = new Map();
  for (const tile of tiles) {
    if (tile.site) {
      const index = byKey.get(tile.site + tile.slot);
      if (index !== undefined) load[index] += tile.blocks;
      continue;
    }
    const cavity = tile.tile.endsWith('_LUFT');
    const key = [tile.x, tile.y, tile.z, cavity].join(',');
    if (!geometry.has(key)) {
      const reachable = [];
      for (const [index, slot] of slots.entries()) {
        if (!cavity && !slot.solids) continue;
        const [x, y, z] = slot.position;
        const distance = (x - tile.x) ** 2 + (y - tile.y) ** 2 + (z - tile.z) ** 2;
        if (distance < 256 ** 2) reachable.push({ index, distance });
      }
      reachable.sort((a, b) => a.distance - b.distance || a.index - b.index);
      geometry.set(key, reachable);
    }
    const options = geometry.get(key);
    if (options.length) pending.push({ tile, options, assigned: null });
  }
  // Allocate inflexible work and large plans first. Reach order breaks equal-load ties.
  pending.sort(
    (a, b) =>
      a.options.length - b.options.length ||
      b.tile.blocks - a.tile.blocks ||
      a.tile.tile.localeCompare(b.tile.tile),
  );
  const lightest = (options) => {
    let best = options[0].index;
    for (const { index } of options) if (load[index] < load[best]) best = index;
    return best;
  };
  for (const work of pending) {
    work.assigned = lightest(work.options);
    load[work.assigned] += work.tile.blocks;
  }
  // A move must reduce the heavier slot's load even after moving the entire plan.
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const work = pending[i],
        blocks = work.tile.blocks;
      const next = lightest(work.options);
      if (load[work.assigned] - load[next] <= blocks) continue;
      load[work.assigned] -= blocks;
      load[next] += blocks;
      work.assigned = next;
      moved = true;
    }
    if (!moved) break;
  }
  return new Map(pending.map(({ tile, assigned }) => [tile.tile, slots[assigned].site + slots[assigned].slot]));
}

export function availableMassifSlots(stations, report, version, mains, support, now = Date.now()) {
  if (report?.version !== version || !Number.isFinite(report.at) || report.at > now || now - report.at >= 45000)
    return [];
  const slots = [];
  for (const station of stations) {
    for (const slot of slotsFor(station.site).filter(s=>s<='C'||station[s])) {
      const main = slot === 'A';
      if (main ? !mains.has(station.site) : !support) continue;
      const signal = report.stations?.[main ? station.site : station.site + slot];
      if (!signal?.ready || !['RUNNING', 'STOPPED', 'PAUSED'].includes(signal.state)) continue;
      if (signal.upload && signal.owner !== 'Erebor') continue;
      const options = signal.options;
      slots.push({
        site: station.site,
        slot,
        position: station[main ? 'main' : slot],
        solids: main || (options?.[0] === 2 && options[1] === false && options[2] === false),
      });
    }
  }
  return slots;
}
