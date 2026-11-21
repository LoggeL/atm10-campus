import {slotsFor,isFinishingSlot} from './erebor-groups.js';
function cannonState(signal, job) {
  if (!signal?.state) return 'unknown';
  if (!signal.upload && signal.empty && signal.state === 'STOPPED') return job ? 'handover' : 'idle';
  if (!job?.loaded || job.tainted || signal.upload !== job.desired.file || !signal.aligned) return 'unverified';
  if (signal.state === 'RUNNING') {
    if (signal.status === 'clearing' && job.phase === 'clear') return 'clearing';
    return signal.status === 'placing' ? 'placing' : 'searching';
  }
  return 'waiting';
}

export function dashboardData(db, version, sites, report, jobs, filling, massif, now = Date.now()) {
  const current =
    report?.version === version && Number.isFinite(report.at) && now >= report.at && now - report.at < 45000;
  const active = db
    .prepare(
      'SELECT site,slot,tile,home,blocks FROM erebor_massif_tiles WHERE v=? AND done=0 AND site IS NOT NULL',
    )
    .all(version);
  const reserved = new Map(active.map((r) => [r.site + r.slot, r]));
  const fleet = sites.flatMap((site) =>
    slotsFor(site).filter(slot => !isFinishingSlot(site,slot) || jobs.has(site+slot) || reserved.has(site+slot) ||
      (current && report.stations?.[site+slot]?.ready && report.stations[site+slot].state)).map((slot) => {
      const key = slot === 'A' ? site : site + slot;
      const job = jobs.get(key);
      const signal = current ? report.stations?.[key] : null;
      const state = cannonState(signal, job);
      const matched = ['placing', 'searching', 'waiting'].includes(state);
      const tile = reserved.get(site + slot);
      const packed = job?.massif?.includes('_URN_PACK_');
      return {
        site,
        slot,
        state,
        reason: signal?.status ?? null,
        file: job?.desired?.blueprint ?? null,
        tile: packed ? job.massif : tile?.tile ?? null,
        home: tile?.home ?? null,
        planBlocks: packed ? job.blocks : tile?.blocks ?? job?.blocks ?? null,
        placed: matched && Number.isSafeInteger(signal.placed) ? signal.placed : null,
        total:
          matched && Number.isSafeInteger(signal.total) && signal.total > 0 && signal.total >= signal.placed
            ? signal.total
            : null,
      };
    }),
  );
  return {
    filling,
    fleet,
    telemetryAt: current ? report.at : null,
    auxiliaryInteriorEnabled: current ? report.interiorHelpers === 1 : null,
    landscapeAutomationEnabled: current ? report.ereborProjectWork === 1 : null,
    balance: { enabled: massif.enabled(version), plannedAt: massif.lastBalancedAt(version) },
  };
}
