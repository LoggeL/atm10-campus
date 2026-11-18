const emptyGroup = () => ({ done: 0, inProgress: 0, open: 0, total: 0, blocks: 0, finishedBlocks: 0 });

function cannonState(signal, job) {
  if (!signal?.state) return 'unknown';
  if (!signal.upload && signal.empty && signal.state === 'STOPPED') return job ? 'handover' : 'idle';
  if (!job?.loaded || job.tainted || signal.upload !== job.desired.file || !signal.aligned) return 'unverified';
  if (signal.state === 'RUNNING') return signal.status === 'placing' ? 'placing' : 'searching';
  return 'waiting';
}

export function dashboardData(db, version, sites, report, jobs, published, massif, now = Date.now()) {
  const current =
    report?.version === version && Number.isFinite(report.at) && now >= report.at && now - report.at < 45000;
  const filling = published ? { solid: emptyGroup(), cavity: emptyGroup(), manual: emptyGroup() } : null;
  if (filling) {
    const groups = db
      .prepare(
        `SELECT CASE WHEN special THEN 'manual' WHEN tile GLOB '*_LUFT' THEN 'cavity' ELSE 'solid' END AS kind,
      CASE WHEN done THEN 'done' WHEN site IS NOT NULL THEN 'inProgress' ELSE 'open' END AS state,
      count(*) AS parts, sum(blocks) AS blocks FROM erebor_massif_tiles WHERE v=? GROUP BY 1,2`,
      )
      .all(version);
    for (const { kind, state, parts, blocks } of groups) {
      const group = filling[kind];
      group[state] += parts;
      group.total += parts;
      group.blocks += blocks;
      if (state === 'done') group.finishedBlocks += blocks;
    }
  }
  const active = db
    .prepare(
      'SELECT site,slot,tile,home,blocks FROM erebor_massif_tiles WHERE v=? AND done=0 AND site IS NOT NULL',
    )
    .all(version);
  const reserved = new Map(active.map((r) => [r.site + r.slot, r]));
  const fleet = sites.flatMap((site) =>
    ['A', 'B', 'C'].map((slot) => {
      const key = slot === 'A' ? site : site + slot;
      const job = jobs.get(key);
      const signal = current ? report.stations?.[key] : null;
      const state = cannonState(signal, job);
      const matched = ['placing', 'searching', 'waiting'].includes(state);
      const tile = reserved.get(site + slot);
      return {
        site,
        slot,
        state,
        reason: signal?.status ?? null,
        file: job?.desired?.blueprint ?? null,
        tile: tile?.tile ?? null,
        home: tile?.home ?? null,
        planBlocks: tile?.blocks ?? job?.blocks ?? null,
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
    balance: { enabled: massif.enabled(version), plannedAt: massif.lastBalancedAt(version) },
  };
}
