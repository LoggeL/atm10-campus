import { DESIGN_REVISION } from './erebor-design.js';

const ledger = () => ({ open: 0, inProgress: 0, done: 0 });
const group = () => ({ ...ledger(), total: 0 });
const stages = () => ({ stone: group(), clear: group(), build: group() });
const workload = () => ({ grossBlocks: 0, assignedBlocks: 0, manualBlocks: 0 });
const massif = () => ({ ...group(), workload: workload() });
const geometry = (name) => name.replace(/_V\d+$/, '');
const measure = () => ({ ...group(), blocks: 0, finishedBlocks: 0 });
function add(row, state, amount = 1) {
  row[state] += amount;
  row.total += amount;
}

export function catalogProgress(production, project, sites, active) {
  const version = project.current_version,
    total = stages(),
    stations = {};
  const busy = new Map(sites.map((site) => [site, new Set()]));
  for (const { site, job } of active) {
    if (!job?.massif && job?.desired?.version === version && job.desired.blueprint)
      busy.get(site)?.add(geometry(job.desired.blueprint));
  }
  for (const site of sites) {
    const own = (stations[site] = stages()),
      seen = new Set();
    const finished = new Set([...production.finished(version, site).keys()].map(geometry));
    for (const file of production.catalog(project, site)) {
      const name = geometry(file.name);
      if (seen.has(name)) continue;
      seen.add(name);
      const stage = file.stage || 'unknown';
      const state = finished.has(name) ? 'done' : busy.get(site).has(name) ? 'inProgress' : 'open';
      add((own[stage] ??= group()), state);
      add((total[stage] ??= group()), state);
    }
  }
  return { stations, total };
}

export function massifProgress(db, version, sites) {
  const stations = Object.fromEntries(sites.map((id) => [id, massif()]));
  const total = massif(),
    unassigned = massif(),
    filling = { solid: measure(), cavity: measure(), manual: measure() };
  const rows = db
    .prepare(
      `SELECT coalesce(site,home) AS owner,
    CASE WHEN special THEN 'manual' WHEN tile GLOB '*_LUFT' THEN 'cavity' ELSE 'solid' END AS kind,
    CASE WHEN done THEN 'done' WHEN site IS NOT NULL THEN 'inProgress' ELSE 'open' END AS state,
    count(*) AS parts, sum(blocks) AS blocks FROM erebor_massif_tiles WHERE v=? GROUP BY 1,2,3`,
    )
    .all(version);
  for (const { owner, kind, state, parts, blocks } of rows) {
    const task = filling[kind];
    add(task, state, parts);
    task.blocks += blocks;
    if (state === 'done') task.finishedBlocks += blocks;
    for (const row of [total, stations[owner] ?? unassigned]) {
      add(row, state, parts);
      if (state === 'done') continue;
      if (kind === 'manual') row.workload.manualBlocks += blocks;
      else {
        row.workload.grossBlocks += blocks;
        if (state === 'inProgress') row.workload.assignedBlocks += blocks;
      }
    }
  }
  return { stations, total, unassigned, filling };
}

function compact(row) {
  return { open: row.open, inProgress: row.inProgress, done: row.done };
}
function catalogTotals(byStage) {
  const sum = ledger();
  for (const stage of Object.values(byStage)) for (const state of Object.keys(sum)) sum[state] += stage[state];
  return sum;
}

// Queue clients keep their existing compact ledgers. Both representations come from the same count.
export function projectProgress(db, production, project, sites, active) {
  const version = project.current_version;
  const published = !!db.prepare('SELECT 1 FROM erebor_massif_runs WHERE v=?').get(version);
  const catalog = catalogProgress(production, project, sites, active),
    rock = massifProgress(db, version, sites);
  const stations = {},
    compactStations = {};
  for (const site of sites) {
    stations[site] = { stages: catalog.stations[site], massif: published ? rock.stations[site] : null };
    compactStations[site] = {
      catalog: catalogTotals(catalog.stations[site]),
      massif: compact(rock.stations[site]),
    };
  }
  return {
    counts: {
      version,
      revision: DESIGN_REVISION,
      stations: compactStations,
      total: { catalog: catalogTotals(catalog.total), massif: compact(rock.total) },
      unassigned: { catalog: ledger(), massif: compact(rock.unassigned) },
    },
    counter: {
      version,
      capturedAt: new Date().toISOString(),
      basis: 'published/cataloged',
      targetTotal: null,
      stages: catalog.total,
      stations,
      massif: published ? rock.total : null,
      unassignedMassif: published ? rock.unassigned : null,
    },
    filling: published ? rock.filling : null,
  };
}

// Completed plan volume and unfinished plan volume use the same unit. The rolling
// wall-clock window includes pauses and plan changes and survives a server restart.
export function massifForecast(db, version, filling, enabled, now = Date.now()) {
  if (!filling || filling.solid.total + filling.cavity.total === 0) return { state: 'unknown' };
  const remainingBlocks =
    filling.solid.blocks + filling.cavity.blocks - filling.solid.finishedBlocks - filling.cavity.finishedBlocks;
  if (filling.solid.done + filling.cavity.done === filling.solid.total + filling.cavity.total)
    return { state: 'complete', remainingBlocks: 0 };
  if (!(remainingBlocks > 0)) return { state: 'unknown' };
  if (!enabled) return { state: 'paused', remainingBlocks };

  const published = db.prepare('SELECT created FROM erebor_massif_runs WHERE v=?').get(version);
  const started = Date.parse(published?.created);
  const since = Math.max(now - 2 * 3600000, Number.isFinite(started) ? started : 0);
  const windowSeconds = (now - since) / 1000;
  const receipts = db
    .prepare(
      `SELECT count(*) AS parts, coalesce(sum(t.blocks),0) AS blocks, max(f.finished_at) AS latest
    FROM erebor_massif_tiles t JOIN erebor_finished_plans f
    ON f.version=t.v AND f.site=t.site AND f.name='EREBOR_STEIN_' || t.site || '_MASSIV_' || t.tile || '_V' || t.v
    WHERE t.v=? AND t.done=1 AND t.special=0 AND f.finished_at BETWEEN ? AND ?`,
    )
    .get(version, new Date(since).toISOString(), new Date(now).toISOString());
  const sample = { remainingBlocks, windowSeconds, completedParts: receipts.parts };
  if (windowSeconds < 900 || receipts.parts < 2 || !receipts.blocks) return { state: 'sampling', ...sample };
  if (now - Date.parse(receipts.latest) > 30 * 60000) return { state: 'inactive', ...sample };

  const blocksPerHour = (receipts.blocks * 3600) / windowSeconds;
  const seconds = Math.ceil((remainingBlocks * windowSeconds) / receipts.blocks);
  return { state: 'estimated', ...sample, blocksPerHour, seconds, finishAt: now + seconds * 1000 };
}
