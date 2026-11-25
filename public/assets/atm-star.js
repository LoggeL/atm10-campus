import { api, copyText } from './campus-client.js?v=20261125-overhaul-1';
import { esc, fmt, fmtPercent, formatBerlinDateTime, formatRelativeTime } from './format.js?v=20261125-overhaul-1';
import { connectPolling } from './live-updates.js?v=20261125-overhaul-1';

const byId = (id) => document.getElementById(id);

const els = {
  page: document.querySelector('.star-page'),
  syncPill: byId('syncPill'),
  statusText: byId('stock-status'),
  refreshBtn: byId('refresh'),
  pollProgress: byId('pollProgress'),
  stockError: byId('stock-error'),
  stockWaiting: byId('stock-waiting'),
  milestoneSwitch: byId('milestoneSwitch'),
  heroDeck: byId('heroDeck'),
  heroReadiness: byId('heroReadiness'),
  heroKpis: byId('heroKpis'),
  actionDeck: byId('actionDeck'),
  craftableBadge: byId('craftableBadge'),
  craftableSub: byId('craftableSub'),
  craftableList: byId('craftableList'),
  bottleneckBadge: byId('bottleneckBadge'),
  bottleneckSub: byId('bottleneckSub'),
  bottleneckList: byId('bottleneckList'),
  netherBar: byId('netherBar'),
  netherSub: byId('netherSub'),
  netherBadges: byId('netherBadges'),
  netherTiers: byId('netherTiers'),
  netherProgress: byId('netherProgress'),
  netherNote: byId('netherNote'),
  explorer: byId('explorer'),
  viewTabs: byId('viewTabs'),
  tabPartsCount: byId('tabPartsCount'),
  tabShoppingCount: byId('tabShoppingCount'),
  toggleExpandAll: byId('toggleExpandAll'),
  copyShopping: byId('copyShopping'),
  downloadShoppingCsv: byId('downloadShoppingCsv'),
  panelParts: byId('panelParts'),
  panelShopping: byId('panelShopping'),
  panelRoadmap: byId('panelRoadmap'),
  search: byId('search'),
  partsFilterGroup: byId('partsFilterGroup'),
  partsSort: byId('partsSort'),
  partsMeta: byId('partsMeta'),
  resetPartsFilters: byId('resetPartsFilters'),
  parts: byId('parts'),
  partsEmpty: byId('partsEmpty'),
  shoppingSearch: byId('shoppingSearch'),
  shoppingGroupToggle: byId('shoppingGroupToggle'),
  shoppingFilterGroup: byId('shoppingFilterGroup'),
  shoppingSort: byId('shoppingSort'),
  shoppingMeta: byId('shoppingMeta'),
  resetShoppingFilters: byId('resetShoppingFilters'),
  shoppingContent: byId('shoppingContent'),
  shoppingEmpty: byId('shoppingEmpty'),
  roadmapContent: byId('roadmapContent'),
  announce: byId('starAnnounce'),
  toast: byId('starToast'),
  drawer: byId('itemDrawer'),
  drawerIcon: byId('drawerIcon'),
  drawerEyebrow: byId('drawerEyebrow'),
  drawerTitle: byId('drawerTitle'),
  drawerClose: byId('drawerClose'),
  drawerBody: byId('drawerBody'),
  drawerFoot: byId('drawerFoot'),
};

const state = {
  plan: null,
  milestoneId: '18',
  view: 'parts',
  partsFilter: 'all',
  partsSort: 'recipe',
  partsSearch: '',
  shoppingSearch: '',
  shoppingGroup: 'flat',
  shoppingFilter: 'all',
  shoppingSort: 'missing-desc',
  openParts: null,
  expandedBeforeSearch: null,
  drawerTarget: null,
  lastCounts: new Map(),
  flashedKeys: new Set(),
  toastTimer: null,
};

const STATUS_LABELS = {
  done: { text: 'Gedeckt', badgeClass: 'c-badge--ok' },
  craftable: { text: 'Craftbar', badgeClass: 'c-badge--craftable' },
  partial: { text: 'Teilweise', badgeClass: 'c-badge--warn' },
  missing: { text: 'Fehlt', badgeClass: 'c-badge--danger' },
  unknown: { text: 'Offen', badgeClass: 'c-badge--neutral' },
};

function announce(message) {
  if (!els.announce) return;
  els.announce.textContent = '';
  requestAnimationFrame(() => {
    els.announce.textContent = message;
  });
}

function showToast(message) {
  if (!els.toast) return;
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  state.toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2600);
}

function formatDurationHours(hours) {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours === 0) return 'Bereit';
  if (hours < 1) return `ca. ${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `ca. ${hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Std.`;
  const days = Math.floor(hours / 24);
  const rem = Math.round(hours % 24);
  return rem > 0 ? `ca. ${days} T ${rem} Std.` : `ca. ${days} Tage`;
}

function activeMilestone() {
  if (!state.plan) return null;
  return state.plan.milestones?.[state.milestoneId] ?? state.plan.milestones?.['18'] ?? null;
}

function spritePosition(iconIndex) {
  const grid = state.plan?.iconGrid ?? { columns: 11, rows: 10 };
  const x = (iconIndex % grid.columns) * 100 / Math.max(1, grid.columns - 1);
  const y = Math.floor(iconIndex / grid.columns) * 100 / Math.max(1, grid.rows - 1);
  return `${x}% ${y}%`;
}

function iconHtml(iconIndex, { size = '', title = '', badge = '' } = {}) {
  if (!Number.isInteger(iconIndex)) return '';
  const sizeClass = size ? ` star-icon--${size}` : '';
  const badgeHtml = badge === 'ok'
    ? '<span class="star-icon-badge star-icon-badge--ok" aria-hidden="true">✓</span>'
    : badge === 'craft'
      ? '<span class="star-icon-badge star-icon-badge--craft" aria-hidden="true">+</span>'
      : '';
  return `<span class="star-icon${sizeClass}" title="${esc(title)}" aria-hidden="true"><span class="star-sprite" style="background-position:${spritePosition(iconIndex)}"></span>${badgeHtml}</span>`;
}

function dualProgressHtml(directPct, craftablePct, { size = '', label = '', partialPct = 0 } = {}) {
  const d = Math.max(0, Math.min(100, Number(directPct) || 0));
  const c = Math.max(0, Math.min(100 - d, Number(craftablePct) || 0));
  const p = Math.max(0, Math.min(100 - d - c, Number(partialPct) || 0));
  const sizeClass = size ? ` c-progress--${size}` : '';
  const total = Math.min(100, Math.round((d + c + p) * 10) / 10);
  return `<div class="c-progress${sizeClass}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${total}"${label ? ` aria-label="${esc(label)}"` : ''}>${d > 0 ? `<span class="c-progress-bar c-progress-bar--ok" style="width:${d}%"></span>` : ''}${c > 0 ? `<span class="c-progress-bar c-progress-bar--craftable" style="width:${c}%"></span>` : ''}${p > 0 ? `<span class="c-progress-bar star-progress-bar--partial" style="width:${p}%"></span>` : ''}</div>`;
}

function nbtChipHtml(req, attrs = '') {
  const kindClass = req.kind ? ` star-pill--nbt-${esc(req.kind)}` : '';
  return `<button type="button" class="star-pill star-pill--nbt${kindClass}" title="${esc(req.detail || req.label)}" ${attrs}>${esc(req.badge)}</button>`;
}

function deltaChipHtml(delta, key) {
  if (delta == null || delta === 0) return '';
  const sign = delta > 0 ? '+' : '';
  const flash = state.flashedKeys.has(key) ? ' star-flash' : '';
  if (delta < 0) return `<span class="star-pill${flash}" title="Änderung zur letzten Meldung">${sign}${fmt(delta)}</span>`;
  return `<span class="star-pill star-pill--delta${flash}" title="Zuwachs seit letzter Meldung">${sign}${fmt(delta)}</span>`;
}

function collectCurrentCounts(plan) {
  const map = new Map();
  if (!plan?.stock) return map;
  if (plan.atmStar?.inMe != null) map.set(plan.atmStar.key, plan.atmStar.inMe);
  if (plan.atmStarBlock?.inMe != null) map.set(plan.atmStarBlock.key, plan.atmStarBlock.inMe);
  for (const tier of plan.netherStars || []) {
    if (tier.inMe != null) map.set(tier.key, tier.inMe);
  }
  for (const part of plan.groups || []) {
    for (const opt of part.alternatives || []) {
      if (opt.inMe != null) map.set(opt.key, opt.inMe);
    }
    for (const ing of part.ingredients || []) {
      for (const opt of ing.alternatives || []) {
        if (opt.inMe != null) map.set(opt.key, opt.inMe);
      }
    }
  }
  return map;
}

function updateLiveDeltas(plan) {
  const nextCounts = collectCurrentCounts(plan);
  const flashed = new Set();
  if (state.lastCounts.size > 0) {
    for (const [key, val] of nextCounts) {
      const prev = state.lastCounts.get(key);
      if (prev !== undefined && val > prev) flashed.add(key);
    }
  }
  state.lastCounts = nextCounts;
  state.flashedKeys = flashed;
  if (flashed.size > 0) {
    showToast(`ME-Update: ${flashed.size} ${flashed.size === 1 ? 'Item' : 'Items'} im Bestand gestiegen`);
  }
}

/* ---------- Render: Status & Sync Pill ---------- */
function renderStatus(pollState) {
  const plan = state.plan;
  const isRefreshing = pollState?.phase === 'refreshing';
  els.refreshBtn.disabled = isRefreshing;
  els.refreshBtn.classList.toggle('is-spinning', isRefreshing);
  if (pollState && Number.isFinite(pollState.progress)) {
    els.pollProgress.value = isRefreshing ? 1 : pollState.progress;
  }

  if (!plan) {
    if (pollState?.phase === 'error') {
      els.syncPill.dataset.state = 'error';
      els.statusText.textContent = 'ME-Stand nicht erreichbar';
    }
    return;
  }

  const hasStock = plan.stock !== null;
  const stale = hasStock && plan.stock.at && Date.now() - Date.parse(plan.stock.at) > 20 * 60_000;
  const stateKey = pollState?.phase === 'error'
    ? 'error'
    : !hasStock
      ? 'unknown'
      : stale
        ? 'stale'
        : 'current';
  els.syncPill.dataset.state = stateKey;

  if (!hasStock) {
    els.statusText.textContent = 'Keine ME-Meldung · Rezeptmodus';
  } else {
    const rel = formatRelativeTime(plan.stock.at);
    const stamp = formatBerlinDateTime(plan.stock.at);
    const source = plan.stock.source ? ` · ${plan.stock.source}` : '';
    const staleNote = stale ? ' · ältere Meldung' : '';
    els.statusText.textContent = `ME ${rel} (${stamp} Uhr)${source}${staleNote}`;
  }

  els.stockWaiting.hidden = hasStock;
  if (!hasStock) {
    els.stockWaiting.textContent =
      'Warte auf die erste ME-Meldung vom Stationscomputer. Bis dahin zeigen alle Ansichten den vollständigen Bedarf, alle Sonder-NBT-Regeln und die Einkaufsliste für das gewählte Ziel.';
  }
}

/* ---------- Render: Zone 1 Hero Readiness & KPIs ---------- */
function renderHero() {
  const plan = state.plan;
  const ms = activeMilestone();
  if (!plan || !ms) return;
  const hasStock = plan.stock !== null;

  for (const btn of els.milestoneSwitch.querySelectorAll('button[data-milestone]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.milestone === state.milestoneId));
  }

  const readinessText = hasStock ? fmtPercent(ms.overallReadinessPct) : '–';
  const directPct = hasStock ? (ms.overallDirectPct ?? 0) : 0;
  const craftPct = hasStock ? (ms.overallCraftablePct ?? 0) : 0;
  const partialPct = hasStock
    ? Math.max(0, Math.round(((ms.overallReadinessPct ?? 0) - directPct - craftPct) * 10) / 10)
    : 0;

  els.heroReadiness.innerHTML = `
    ${iconHtml(plan.atmStar?.icon ?? 0, { size: 'xl', title: 'ATM Star' })}
    <div class="star-readiness-body">
      <div class="star-readiness-top">
        <span class="star-readiness-label">Gesamt-Fortschritt · ${esc(ms.label)}</span>
        <strong class="star-readiness-pct">${esc(readinessText)}</strong>
      </div>
      ${dualProgressHtml(directPct, craftPct, { size: 'lg', partialPct, label: `Gesamt-Fortschritt für ${ms.label}` })}
      <div class="star-readiness-legend">
        <span class="star-legend-dot" style="--dot-color:var(--accent)">Direkt im ME: ${hasStock ? esc(fmtPercent(directPct)) : '–'}</span>
        <span class="star-legend-dot" style="--dot-color:var(--sky)">Sofort craftbar: ${hasStock ? esc(fmtPercent(craftPct)) : '–'}</span>
        ${hasStock && partialPct > 0 ? `<span class="star-legend-dot" style="--dot-color:var(--star-partial)">Zutaten im ME: ${esc(fmtPercent(partialPct))}</span>` : ''}
      </div>
    </div>`;

  // KPI 1: Goal Progress
  const loose = plan.looseStars ?? plan.stars;
  const blocks = plan.blocks;
  const avail = plan.availableStars;
  const craftableStars = plan.starsCraftableWithSubParts;
  const kpi1Main = !hasStock
    ? `– / ${fmt(ms.goalStars)}`
    : ms.mode === 'next'
      ? `${fmt(avail)} im ME`
      : `${fmt(ms.completedForGoal)} / ${fmt(ms.goalStars)}`;

  const kpi1Parts = [];
  if (hasStock) {
    if (ms.mode === 'next') {
      kpi1Parts.push(`Plan für <strong>+1</strong> weiteren Star`);
    } else if (ms.remainingStars > 0) {
      kpi1Parts.push(`Noch <strong>${fmt(ms.remainingStars)}</strong> offen`);
    } else {
      kpi1Parts.push(`<span class="is-ok">Ziel erreicht</span>`);
    }
    kpi1Parts.push(`${fmt(loose)} lose · ${fmt(blocks)} Blöcke`);
    if ((craftableStars ?? 0) > 0) {
      kpi1Parts.push(`<span class="is-sky">+${fmt(craftableStars)} sofort craftbar</span>`);
    }
  } else {
    kpi1Parts.push(`Bedarf für ${fmt(ms.remainingStars)} ${ms.remainingStars === 1 ? 'Star' : 'Stars'}`);
  }
  const surplusBadge = hasStock && (plan.surplusStars ?? 0) > 0 && ms.id === '18'
    ? `<span class="c-badge c-badge--ok">+${fmt(plan.surplusStars)} Überschuss</span>`
    : '';

  // KPI 2: Parts Ready
  const kpi2Main = hasStock ? `${fmt(ms.partsReadyCount)} / ${fmt(ms.partsTotalCount)}` : `– / ${fmt(ms.partsTotalCount)}`;
  const kpi2Sub = !hasStock
    ? '13 Altar-Komponenten je Star'
    : ms.partsCraftableCount > 0
      ? `<span class="is-sky">+${fmt(ms.partsCraftableCount)} sofort craftbar</span> · ${fmt(ms.partsTotalCount - ms.partsReadyCount - ms.partsCraftableCount)} offen`
      : ms.partsReadyCount === ms.partsTotalCount
        ? '<span class="is-ok">Alle 13 Bauteile gedeckt</span>'
        : `${fmt(ms.partsTotalCount - ms.partsReadyCount)} Bauteile noch offen`;

  // KPI 3: Nether Stars
  const ns = ms.netherStarSummary;
  const rate = ns.ratePerHour ?? plan.history?.netherStarRatePerHour;
  const etaText = formatDurationHours(ns.etaHours);
  const kpi3Main = hasStock ? fmt(ns.totalEquivalent) : '–';
  const kpi3Badge = hasStock && ns.coveragePct != null
    ? `<span class="c-badge ${ns.coveragePct >= 100 ? 'c-badge--ok' : 'c-badge--neutral'}">${esc(fmtPercent(ns.coveragePct))}</span>`
    : '';
  const kpi3Bits = [`Bedarf: <strong>${fmt(ns.neededNetherStars)}</strong>`];
  if (hasStock && rate != null && rate > 0) {
    kpi3Bits.push(`<span class="is-ok">+${fmt(Math.round(rate))}/h</span>`);
    if (etaText) kpi3Bits.push(`ETA ${esc(etaText)}`);
  } else if (hasStock && ns.missingNetherStars === 0) {
    kpi3Bits.push('<span class="is-ok">Vollständig gedeckt</span>');
  }

  els.heroKpis.innerHTML = `
    <div class="star-kpi">
      <div class="star-kpi-head">
        <span class="star-kpi-label">${ms.mode === 'next' ? 'ATM Stars Bestand' : 'Ziel-Fortschritt'}</span>
        ${iconHtml(ms.goalStars >= 9 ? (plan.atmStarBlock?.icon ?? 1) : (plan.atmStar?.icon ?? 0), { size: 'sm', title: 'ATM Star' })}
      </div>
      <div class="star-kpi-value-row">
        <strong class="star-kpi-value star-kpi-value--accent">${esc(kpi1Main)}</strong>
        ${surplusBadge}
      </div>
      <p class="star-kpi-sub">${kpi1Parts.join(' · ')}</p>
    </div>
    <div class="star-kpi">
      <div class="star-kpi-head">
        <span class="star-kpi-label">Bauteile bereit</span>
        ${iconHtml(plan.groups?.[12]?.icon ?? 102, { size: 'sm', title: 'Altar-Bauteile' })}
      </div>
      <div class="star-kpi-value-row">
        <strong class="star-kpi-value">${esc(kpi2Main)}</strong>
      </div>
      <p class="star-kpi-sub">${kpi2Sub}</p>
    </div>
    <div class="star-kpi">
      <div class="star-kpi-head">
        <span class="star-kpi-label">Nethersterne gesamt</span>
        ${iconHtml(ns.tiers?.[0]?.icon ?? 2, { size: 'sm', title: 'Netherstern' })}
      </div>
      <div class="star-kpi-value-row">
        <strong class="star-kpi-value">${esc(kpi3Main)}</strong>
        ${kpi3Badge}
      </div>
      <p class="star-kpi-sub">${kpi3Bits.join(' · ')}</p>
    </div>`;

  els.heroDeck.hidden = false;
}

/* ---------- Render: Zone 2 Action Deck ---------- */
function renderActionDeck() {
  const plan = state.plan;
  const ms = activeMilestone();
  if (!plan || !ms) return;
  const hasStock = plan.stock !== null;

  // Left: Craftable Now
  const craftable = ms.craftableParts || [];
  els.craftableBadge.textContent = hasStock ? `${fmt(craftable.length)} bereit` : '–';
  els.craftableBadge.className = `c-badge ${craftable.length > 0 ? 'c-badge--craftable' : 'c-badge--neutral'}`;

  if (!hasStock) {
    els.craftableSub.textContent = 'Wird nach der ersten ME-Meldung automatisch berechnet.';
    els.craftableList.innerHTML = `<div class="star-action-empty">Sobald das ME-System Bestände meldet, erscheinen hier alle Bauteile, die du direkt ohne weiteres Farmen craften kannst.</div>`;
  } else if (ms.remainingStars === 0) {
    els.craftableSub.textContent = `Alle ${fmt(ms.goalStars)} ATM Stars für dieses Ziel liegen im ME.`;
    els.craftableList.innerHTML = `<div class="star-action-empty star-action-empty--done">Ziel „${esc(ms.label)}“ vollständig gedeckt — keine weiteren Crafts für diesen Meilenstein nötig.</div>`;
  } else if (craftable.length > 0) {
    els.craftableSub.textContent = 'Klicken, um direkt zum Bauteil im Rezeptbaum zu springen.';
    els.craftableList.innerHTML = craftable.slice(0, 6).map((item) => `
      <button type="button" class="star-action-item" data-jump-part="${esc(item.key)}">
        ${iconHtml(item.icon, { size: 'md', title: item.label, badge: 'craft' })}
        <span class="star-action-item-body">
          <span class="star-action-item-title">${esc(item.label)}</span>
          <span class="star-action-item-meta">
            <span class="star-pill star-pill--station">${esc(item.station)}</span>
            <span>${item.fullyCraftable ? 'Restbedarf komplett deckbar' : `${fmt(item.effectiveMissing)} danach noch offen`}</span>
          </span>
        </span>
        <span class="star-action-item-end">
          <span class="c-badge c-badge--craftable">+${fmt(item.craftableNow)} craftbar</span>
        </span>
      </button>`).join('');
  } else if (ms.closestPart) {
    const c = ms.closestPart;
    els.craftableSub.textContent = 'Aktuell kein komplettes Bauteil direkt craftbar — hier bist du am nächsten dran:';
    els.craftableList.innerHTML = `
      <button type="button" class="star-closest-card" data-jump-part="${esc(c.key)}">
        <div class="star-closest-top">
          ${iconHtml(c.icon, { size: 'md', title: c.label })}
          <span class="star-action-item-body">
            <span class="star-action-item-title">Am nächsten dran: ${esc(c.label)}</span>
            <span class="star-action-item-meta">
              <span class="star-pill star-pill--station">${esc(c.station)}</span>
              <span>${fmt(c.ingredientsReadyCount)} / ${fmt(c.ingredientsTotalCount)} Zutaten gedeckt</span>
              <span>noch ${fmt(c.missingIngredientsCount)} ${c.missingIngredientsCount === 1 ? 'Zutat' : 'Zutaten'} offen</span>
            </span>
          </span>
          <span class="c-badge c-badge--warn">${esc(fmtPercent(c.readinessPct))}</span>
        </div>
        ${dualProgressHtml(0, 0, { size: 'sm', partialPct: c.readinessPct, label: `${c.label} Fortschritt` })}
      </button>`;
  } else {
    els.craftableSub.textContent = 'Alle Bauteile für dieses Ziel sind bereits gedeckt.';
    els.craftableList.innerHTML = `<div class="star-action-empty star-action-empty--done">Alle 13 Bauteile sind vollständig im ME vorhanden — bereit für den Runic Star Altar!</div>`;
  }

  // Right: Top 5 Bottlenecks
  const bottlenecks = (ms.bottlenecks || []).slice(0, 5);
  els.bottleneckBadge.textContent = bottlenecks.length ? `Top ${bottlenecks.length}` : 'Keine';
  els.bottleneckBadge.className = `c-badge ${bottlenecks.length ? 'c-badge--warn' : 'c-badge--ok'}`;

  if (!bottlenecks.length) {
    els.bottleneckSub.textContent = 'Keine offenen Engpässe für dieses Ziel.';
    els.bottleneckList.innerHTML = `<div class="star-action-empty star-action-empty--done">Keine fehlenden Zutaten mehr für „${esc(ms.label)}“.</div>`;
  } else {
    els.bottleneckSub.textContent = hasStock
      ? 'Klicken, um Item-ID, NBT-Regeln und betroffene Bauteile im Inspektor zu öffnen.'
      : 'Kritische Engpässe nach geteilten Pools, Sonder-NBT und Gesamtmenge.';
    els.bottleneckList.innerHTML = bottlenecks.map((b) => {
      const chips = [];
      if (b.shared) chips.push(`<span class="star-pill star-pill--shared">Geteilt · ${fmt(b.usedBy.length)}</span>`);
      if (b.hasSpecialRequirements) chips.push(`<span class="star-pill star-pill--nbt">Sonder-NBT</span>`);
      const usedNames = b.usedBy.map((u) => u.partLabel).join(', ');
      return `
        <button type="button" class="star-action-item" data-inspect-shopping="${esc(b.key)}">
          ${iconHtml(b.icon, { size: 'md', title: b.label })}
          <span class="star-action-item-body">
            <span class="star-action-item-title">${esc(b.label)}</span>
            <span class="star-action-item-meta">
              ${chips.join('')}
              <span>${esc(usedNames)}</span>
            </span>
          </span>
          <span class="star-action-item-end">
            <span class="star-action-missing">${hasStock ? `−${fmt(b.missing)}` : fmt(b.totalNeeded)}</span>
            <span class="star-action-pct">${hasStock ? esc(fmtPercent(b.coveragePct)) : esc(b.mod.label)}</span>
          </span>
        </button>`;
    }).join('');
  }

  els.actionDeck.hidden = false;
}

/* ---------- Render: Zone 3 Nether Star Compression Strip ---------- */
function renderNetherBar() {
  const plan = state.plan;
  const ms = activeMilestone();
  if (!plan || !ms) return;
  const hasStock = plan.stock !== null;
  const ns = ms.netherStarSummary;
  const rate = ns.ratePerHour ?? plan.history?.netherStarRatePerHour;
  const eta = formatDurationHours(ns.etaHours);

  els.netherSub.textContent = hasStock
    ? `${fmt(ns.effective3xAvailable)} / ${fmt(ns.needed3x)} effektive 3x-Blöcke (${fmt(ns.direct3x)} direkt + ${fmt(ns.compressible3xFromLower)} komprimierbar)`
    : `15× 3x-Blöcke (= 98.415 Nethersterne) je Star · ${fmt(ns.needed3x)} Blöcke für ${esc(ms.label)}`;

  const badges = [];
  if (hasStock) {
    badges.push(`<span class="c-badge ${ns.missing3xEffective === 0 ? 'c-badge--ok' : 'c-badge--warn'}">${ns.missing3xEffective === 0 ? '3x-Bedarf gedeckt' : `${fmt(ns.missing3xEffective)}× 3x fehlen effektiv`}</span>`);
    if (ns.compressible3xFromLower > 0) {
      badges.push(`<span class="c-badge c-badge--craftable">+${fmt(ns.compressible3xFromLower)}× 3x komprimierbar</span>`);
    }
    if (rate != null && rate > 0) {
      badges.push(`<span class="c-badge c-badge--ok">+${fmt(Math.round(rate))} Sterne/h${eta ? ` · ETA ${esc(eta)}` : ''}</span>`);
    }
  } else {
    badges.push(`<span class="c-badge c-badge--neutral">${fmt(ns.neededNetherStars)} Sterne Bedarf</span>`);
  }
  els.netherBadges.innerHTML = badges.join('');

  els.netherTiers.innerHTML = ns.tiers.map((tier, index) => {
    const arrow = index > 0 ? '<span class="star-nether-arrow" aria-hidden="true">→</span>' : '';
    const isFinal = index === ns.tiers.length - 1;
    const eqText = hasStock
      ? (tier.units === 1 ? 'Basisstufe' : `= ${fmt(tier.equivalentNetherStars)} Sterne`)
      : `${fmt(tier.units)} Sterne/Stück`;
    return `${arrow}<button type="button" class="star-tier${isFinal ? ' star-tier--final' : ''}" data-inspect-nether="${esc(tier.key)}">
      ${iconHtml(tier.icon, { size: 'md', title: tier.label })}
      <span class="star-tier-copy">
        <span class="star-tier-name"><span>${esc(tier.label.replace('Nethersternblock', 'Block'))}</span><span class="star-tier-units">×${fmt(tier.units)}</span></span>
        <strong class="star-tier-count">${hasStock ? fmt(tier.inMe) : '–'}</strong>
        <span class="star-tier-eq">${esc(eqText)}</span>
      </span>
    </button>`;
  }).join('');

  const direct3xPct = hasStock && ns.neededNetherStars > 0
    ? Math.min(100, ((ns.direct3x * 6561) / ns.neededNetherStars) * 100)
    : hasStock && ns.neededNetherStars === 0 ? 100 : 0;
  const lowerPct = hasStock && ns.neededNetherStars > 0
    ? Math.min(100 - direct3xPct, (ns.lowerThan3xUnits / ns.neededNetherStars) * 100)
    : 0;
  els.netherProgress.setAttribute('aria-valuenow', String(hasStock ? (ns.coveragePct ?? 0) : 0));
  els.netherProgress.innerHTML = `
    <span class="c-progress-bar c-progress-bar--ok" style="width:${direct3xPct}%"></span>
    ${lowerPct > 0 ? `<span class="c-progress-bar c-progress-bar--craftable" style="width:${lowerPct}%"></span>` : ''}`;

  els.netherNote.textContent = hasStock
    ? `${fmt(ns.totalEquivalent)} / ${fmt(ns.neededNetherStars)} Nethersterne im ME (${fmtPercent(ns.coveragePct)})${ns.missingNetherStars > 0 ? ` · noch ${fmt(ns.missingNetherStars)} Nethersterne zu farmen` : ' · vollständig gedeckt'}.`
    : 'Niedrigere Kompressionsstufen (Netherstern bis 2x) werden automatisch auf den 3x-Bedarf angerechnet.';

  els.netherBar.hidden = false;
}

/* ---------- Search & Filtering Helpers ---------- */
function partSearchBlob(part) {
  const own = [
    part.label,
    part.id,
    part.mod?.label,
    part.mod?.id,
    part.station,
    part.stationDetail,
    ...(part.requirements || []).map((r) => `${r.badge} ${r.label} ${r.detail}`),
  ];
  return own.filter(Boolean).join(' ').toLocaleLowerCase('de');
}

function ingredientSearchBlob(ing) {
  const bits = [
    ing.label,
    ing.id,
    ing.mod?.label,
    ing.mod?.id,
    ...(ing.alternatives || []).flatMap((a) => [a.label, a.id, a.mod?.label, a.mod?.id]),
    ...(ing.requirements || []).map((r) => `${r.badge} ${r.label} ${r.detail}`),
    ing.shared ? 'geteilt shared pool' : '',
  ];
  return bits.filter(Boolean).join(' ').toLocaleLowerCase('de');
}

function matchesPartFilter(part, filter) {
  if (filter === 'all') return true;
  if (filter === 'open') return part.status !== 'done';
  if (filter === 'craftable') return (part.craftableNow ?? 0) > 0;
  if (filter === 'done') return part.status === 'done';
  if (filter === 'nbt') return part.hasSpecialRequirements || part.hasSpecialIngredientRequirements;
  return true;
}

function sortParts(parts, sortKey) {
  const list = [...parts];
  if (sortKey === 'readiness-asc') {
    return list.sort((a, b) => (a.readinessPct ?? -1) - (b.readinessPct ?? -1) || b.missing - a.missing);
  }
  if (sortKey === 'readiness-desc') {
    return list.sort((a, b) => (b.readinessPct ?? -1) - (a.readinessPct ?? -1) || a.missing - b.missing);
  }
  if (sortKey === 'missing-desc') {
    return list.sort((a, b) => (b.effectiveMissing ?? b.missing) - (a.effectiveMissing ?? a.missing));
  }
  if (sortKey === 'craftable-first') {
    return list.sort((a, b) => (b.craftableNow ?? 0) - (a.craftableNow ?? 0) || (b.readinessPct ?? 0) - (a.readinessPct ?? 0));
  }
  return list;
}

/* ---------- Render: Zone 4A Parts & Recipe Tree ---------- */
function renderIngredientRow(part, ing, hasStock) {
  const isNbt = ing.hasSpecialRequirements;
  const icons = ing.alternatives
    .filter((opt) => Number.isInteger(opt.icon))
    .map((opt) => iconHtml(opt.icon, {
      size: 'md',
      title: opt.label,
      badge: hasStock && ing.effectiveMissing === 0 && ing.alternatives.length === 1 ? 'ok' : '',
    }))
    .join('');

  const chips = [];
  if (ing.shared && ing.sharedPool) {
    chips.push(`<span class="star-pill star-pill--shared" title="Wird von ${ing.sharedPool.consumersCount} Bauteilen gemeinsam genutzt (${fmt(ing.sharedPool.perStar)}/Star gesamt)">Geteilt · ${fmt(ing.sharedPool.consumersCount)} Bauteile</span>`);
  }
  for (const req of ing.requirements || []) {
    chips.push(nbtChipHtml(req, `data-inspect-ing="${esc(ing.key)}" data-inspect-part="${esc(part.key)}"`));
  }
  if (hasStock && ing.compressibleFromLower > 0) {
    chips.push(`<span class="star-pill star-pill--delta">+${fmt(ing.compressibleFromLower)} komprimierbar</span>`);
  }
  if (hasStock && ing.delta) {
    chips.push(deltaChipHtml(ing.delta, ing.key));
  }

  const altStrip = ing.isAlternativeGroup
    ? `<div class="star-alt-strip">${ing.alternatives.map((opt) => `
        <span class="star-alt-pill">
          ${iconHtml(opt.icon, { size: 'sm', title: opt.label })}
          <span>${esc(opt.label)}:</span>
          <strong>${hasStock ? fmt(opt.inMe) : '–'}</strong>
        </span>`).join('')}</div>`
    : '';

  const facts = [
    `${fmt(ing.perRecipe)} je Bauteil`,
    `${fmt(ing.totalForGoal)} für Ziel`,
    esc(ing.mod?.label || ''),
  ].filter(Boolean);
  if (hasStock && ing.missing > 0 && ing.allocated < (ing.inMe ?? 0)) {
    facts.push(`${fmt(ing.allocated)} hier eingeplant`);
  }

  const missingDisplay = !hasStock
    ? '<span class="star-val star-val--muted">–</span>'
    : ing.effectiveMissing === 0
      ? '<span class="c-badge c-badge--ok">Gedeckt</span>'
      : `<span class="star-val star-val--warn">${fmt(ing.effectiveMissing)}</span>`;

  const craftDisplay = hasStock && ing.compressibleFromLower > 0
    ? `<span class="star-val star-val--craft">+${fmt(ing.compressibleFromLower)}</span>`
    : '<span class="star-val star-val--muted">–</span>';

  const meVal = hasStock ? fmt(ing.inMe) : '–';
  const meClass = hasStock ? (state.flashedKeys.has(ing.key) ? 'star-val star-flash' : 'star-val') : 'star-val star-val--muted';

  return `
    <li class="star-ing-row" data-ing-key="${esc(ing.key)}">
      <div class="star-ing-main">
        <div class="star-ing-icons">${icons}</div>
        <div class="star-ing-copy">
          <button type="button" class="star-ing-title-btn" data-inspect-ing="${esc(ing.key)}" data-inspect-part="${esc(part.key)}">${esc(ing.label)}</button>
          ${chips.length ? `<div class="star-ing-chips">${chips.join('')}</div>` : ''}
          ${altStrip}
          <div class="star-ing-meta">${facts.map((f) => `<span>${f}</span>`).join('')}</div>
          ${hasStock ? `<div class="star-ing-progress">${dualProgressHtml(ing.coveragePct, 0, { size: 'sm' })}</div>` : ''}
        </div>
      </div>
      <div class="star-cell"><span class="star-cell-label">Bedarf</span><span class="star-val">${fmt(ing.needed)}</span></div>
      <div class="star-cell"><span class="star-cell-label">Im ME</span><span class="${meClass}">${esc(meVal)}</span></div>
      <div class="star-cell"><span class="star-cell-label">Craftbar</span>${craftDisplay}</div>
      <div class="star-cell"><span class="star-cell-label">Fehlt</span>${missingDisplay}</div>
      <div class="star-row-end">
        <button type="button" class="c-btn c-btn--ghost c-btn--sm star-detail-btn" data-inspect-ing="${esc(ing.key)}" data-inspect-part="${esc(part.key)}"${isNbt ? ' title="NBT-Bedingungen und Item-ID anzeigen"' : ''}>Details</button>
      </div>
    </li>`;
}

function renderPartsView() {
  const plan = state.plan;
  const ms = activeMilestone();
  if (!plan || !ms) return;
  const hasStock = plan.stock !== null;
  const term = state.partsSearch.trim().toLocaleLowerCase('de');

  if (term && !state.expandedBeforeSearch) {
    state.expandedBeforeSearch = new Set(state.openParts);
  } else if (!term && state.expandedBeforeSearch) {
    state.openParts = new Set(state.expandedBeforeSearch);
    state.expandedBeforeSearch = null;
  }

  // Update filter pill counts & active state
  const filterCounts = {
    all: ms.parts.length,
    open: ms.parts.filter((p) => p.status !== 'done').length,
    craftable: ms.parts.filter((p) => (p.craftableNow ?? 0) > 0).length,
    done: ms.parts.filter((p) => p.status === 'done').length,
    nbt: ms.parts.filter((p) => p.hasSpecialRequirements || p.hasSpecialIngredientRequirements).length,
  };
  for (const btn of els.partsFilterGroup.querySelectorAll('button[data-filter]')) {
    const f = btn.dataset.filter;
    btn.setAttribute('aria-pressed', String(f === state.partsFilter));
    const baseLabel = { all: 'Alle', open: 'Offen', craftable: 'Craftbar', done: 'Gedeckt', nbt: 'Sonder-NBT' }[f];
    btn.textContent = `${baseLabel} (${filterCounts[f]})`;
  }

  const sorted = sortParts(ms.parts, state.partsSort);
  const visibleEntries = [];
  for (const part of sorted) {
    if (!matchesPartFilter(part, state.partsFilter)) continue;
    const parentMatches = !term || partSearchBlob(part).includes(term);
    let visibleIngredients = part.ingredients;
    if (term && !parentMatches) {
      visibleIngredients = part.ingredients.filter((ing) => ingredientSearchBlob(ing).includes(term));
      if (!visibleIngredients.length) continue;
    } else if (state.partsFilter === 'nbt' && !part.hasSpecialRequirements) {
      visibleIngredients = part.ingredients.filter((ing) => ing.hasSpecialRequirements);
    }
    const autoOpen = Boolean(term && !parentMatches);
    visibleEntries.push({ part, visibleIngredients, autoOpen });
  }

  const isFiltered = Boolean(term || state.partsFilter !== 'all' || state.partsSort !== 'recipe');
  els.resetPartsFilters.hidden = !isFiltered;
  els.partsMeta.textContent = `Zeige ${fmt(visibleEntries.length)} von ${fmt(ms.parts.length)} Altar-Bauteilen für „${ms.label}“`;

  if (!visibleEntries.length) {
    els.parts.innerHTML = '';
    els.partsEmpty.hidden = false;
    els.partsEmpty.textContent = term
      ? `Kein Bauteil und keine Zutat für „${state.partsSearch.trim()}“ gefunden.`
      : 'Keine Bauteile passen zum gewählten Filter.';
    updateExpandAllButton();
    return;
  }

  els.partsEmpty.hidden = true;
  els.parts.innerHTML = visibleEntries.map(({ part, visibleIngredients, autoOpen }) => {
    const isOpen = autoOpen || state.openParts.has(part.key);
    const stInfo = STATUS_LABELS[part.status] || STATUS_LABELS.unknown;
    const iconBadge = part.status === 'done' ? 'ok' : part.status === 'craftable' ? 'craft' : '';
    const partReqChips = (part.requirements || []).map((r) => nbtChipHtml(r, `data-inspect-part="${esc(part.key)}"`)).join('');
    const deltaChip = hasStock && part.delta ? deltaChipHtml(part.delta, part.key) : '';

    const craftCell = !hasStock
      ? '<span class="star-val star-val--muted">–</span>'
      : part.craftableNow > 0
        ? `<span class="star-val star-val--craft">+${fmt(part.craftableNow)}</span>`
        : '<span class="star-val star-val--muted">0</span>';

    const missingCell = !hasStock
      ? '<span class="star-val star-val--muted">–</span>'
      : part.missing === 0
        ? '<span class="c-badge c-badge--ok">Gedeckt</span>'
        : part.fullyCraftable
          ? '<span class="c-badge c-badge--craftable">Craftbar</span>'
          : `<span class="star-val star-val--warn">${fmt(part.missing)}</span>${part.craftableNow > 0 ? `<span class="star-cell-sub">eff. ${fmt(part.effectiveMissing)}</span>` : ''}`;

    const meClass = hasStock ? (state.flashedKeys.has(part.key) ? 'star-val star-flash' : 'star-val') : 'star-val star-val--muted';
    const partPartialPct = hasStock
      ? Math.max(0, Math.round(((part.readinessPct ?? 0) - (part.directPct ?? 0) - (part.craftablePct ?? 0)) * 10) / 10)
      : 0;

    return `
      <details class="star-part" data-part-key="${esc(part.key)}" data-status="${esc(part.status)}"${isOpen ? ' open' : ''}>
        <summary class="star-part-summary">
          <div class="star-part-main">
            ${iconHtml(part.icon, { size: 'lg', title: part.label, badge: iconBadge })}
            <div class="star-part-copy">
              <div class="star-part-title-line">
                <span class="star-part-title">${esc(part.label)}</span>
                <span class="c-badge ${stInfo.badgeClass}">${esc(stInfo.text)}</span>
                ${partReqChips}
                ${deltaChip}
              </div>
              <div class="star-part-meta">
                <span class="star-pill">${esc(part.mod?.label || '')}</span>
                <span class="star-pill star-pill--station">${esc(part.station)}</span>
                <span>${fmt(part.perRecipe)} je Star · ${fmt(part.totalForGoal)} für Ziel</span>
                ${hasStock ? `<span>${fmt(part.ingredientsReadyCount)}/${fmt(part.ingredientsTotalCount)} Zutaten</span>` : ''}
              </div>
              ${hasStock ? `<div class="star-part-progress">${dualProgressHtml(part.directPct, part.craftablePct, { size: 'sm', partialPct: partPartialPct, label: `${part.label} Deckung` })}<span class="star-part-pct">${esc(fmtPercent(part.readinessPct))}</span></div>` : ''}
            </div>
          </div>
          <div class="star-cell"><span class="star-cell-label">Bedarf</span><span class="star-val">${fmt(part.needed)}</span></div>
          <div class="star-cell"><span class="star-cell-label">Im ME</span><span class="${meClass}">${hasStock ? fmt(part.inMe) : '–'}</span></div>
          <div class="star-cell"><span class="star-cell-label">Craftbar</span>${craftCell}</div>
          <div class="star-cell"><span class="star-cell-label">Fehlt</span>${missingCell}</div>
          <div class="star-row-end">
            <button type="button" class="c-btn c-btn--ghost c-btn--sm star-detail-btn" data-inspect-part="${esc(part.key)}">Details</button>
            <span class="star-chevron" aria-hidden="true"></span>
          </div>
        </summary>
        <ul class="star-ingredients">
          ${visibleIngredients.map((ing) => renderIngredientRow(part, ing, hasStock)).join('')}
        </ul>
      </details>`;
  }).join('');

  updateExpandAllButton();
}

function updateExpandAllButton() {
  const details = [...els.parts.querySelectorAll('details.star-part')];
  const allOpen = details.length > 0 && details.every((d) => d.open);
  els.toggleExpandAll.textContent = allOpen ? 'Alle zuklappen' : 'Alle aufklappen';
  els.toggleExpandAll.disabled = details.length === 0;
}

/* ---------- Render: Zone 4B Shopping List View ---------- */
function filteredShoppingItems() {
  const ms = activeMilestone();
  if (!ms) return [];
  const term = state.shoppingSearch.trim().toLocaleLowerCase('de');
  let items = [...(ms.shoppingList || [])];

  if (state.shoppingFilter === 'shared') items = items.filter((i) => i.shared);
  else if (state.shoppingFilter === 'nbt') items = items.filter((i) => i.hasSpecialRequirements);

  if (term) {
    items = items.filter((i) => {
      const hay = [
        i.label,
        i.id,
        i.mod?.label,
        i.mod?.id,
        ...(i.usedBy || []).map((u) => u.partLabel),
        ...(i.requirements || []).map((r) => `${r.badge} ${r.label} ${r.detail}`),
        ...(i.alternatives || []).flatMap((a) => [a.label, a.id]),
      ].filter(Boolean).join(' ').toLocaleLowerCase('de');
      return hay.includes(term);
    });
  }

  if (state.shoppingSort === 'missing-desc') {
    items.sort((a, b) => b.missing - a.missing || a.label.localeCompare(b.label, 'de'));
  } else if (state.shoppingSort === 'coverage-asc') {
    items.sort((a, b) => (a.coveragePct ?? 0) - (b.coveragePct ?? 0) || b.missing - a.missing);
  } else if (state.shoppingSort === 'nbt-first') {
    items.sort((a, b) => Number(b.hasSpecialRequirements) - Number(a.hasSpecialRequirements) || Number(b.shared) - Number(a.shared) || b.missing - a.missing);
  } else if (state.shoppingSort === 'name-asc') {
    items.sort((a, b) => a.label.localeCompare(b.label, 'de'));
  }
  return items;
}

function renderShoppingRow(item, hasStock) {
  const chips = [];
  if (item.shared) chips.push(`<span class="star-pill star-pill--shared">Geteilt · ${fmt(item.usedBy.length)}</span>`);
  for (const req of item.requirements || []) {
    chips.push(nbtChipHtml(req, `data-inspect-shopping="${esc(item.key)}"`));
  }
  if (hasStock && item.compressibleFromLower > 0) {
    chips.push(`<span class="star-pill star-pill--delta">+${fmt(item.compressibleFromLower)} komprimierbar</span>`);
  }

  const usedByHtml = (item.usedBy || []).map((u) => `
    <button type="button" class="star-used-chip" data-jump-part="${esc(u.partKey)}" title="Zu ${esc(u.partLabel)} springen">${esc(u.partLabel)}</button>
  `).join('');

  return `
    <div class="star-shop-row">
      <div class="star-shop-item">
        ${iconHtml(item.icon, { size: 'md', title: item.label })}
        <div class="star-shop-item-copy">
          <button type="button" class="star-ing-title-btn" data-inspect-shopping="${esc(item.key)}">${esc(item.label)}</button>
          <div class="star-ing-chips">
            <span class="star-pill">${esc(item.mod?.label || '')}</span>
            ${chips.join('')}
          </div>
          ${hasStock ? `<div class="star-ing-progress">${dualProgressHtml(item.coveragePct, 0, { size: 'sm' })}</div>` : ''}
        </div>
      </div>
      <div class="star-used-by">${usedByHtml}</div>
      <div class="star-cell"><span class="star-cell-label">Bedarf</span><span class="star-val">${fmt(item.totalNeeded)}</span></div>
      <div class="star-cell"><span class="star-cell-label">Im ME</span><span class="${hasStock ? 'star-val' : 'star-val star-val--muted'}">${hasStock ? fmt(item.inStock) : '–'}</span></div>
      <div class="star-cell"><span class="star-cell-label">Fehlt</span><span class="star-val ${hasStock ? 'star-val--warn' : 'star-val--muted'}">${hasStock ? fmt(item.missing) : fmt(item.totalNeeded)}</span></div>
      <div class="star-row-end">
        <button type="button" class="c-btn c-btn--ghost c-btn--sm star-detail-btn" data-inspect-shopping="${esc(item.key)}">Details</button>
      </div>
    </div>`;
}

function renderShoppingView() {
  const plan = state.plan;
  const ms = activeMilestone();
  if (!plan || !ms) return;
  const hasStock = plan.stock !== null;
  const items = filteredShoppingItems();
  const totalCount = (ms.shoppingList || []).length;

  for (const btn of els.shoppingGroupToggle.querySelectorAll('button[data-group]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.group === state.shoppingGroup));
  }
  for (const btn of els.shoppingFilterGroup.querySelectorAll('button[data-sfilter]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.sfilter === state.shoppingFilter));
  }

  const isFiltered = Boolean(state.shoppingSearch.trim() || state.shoppingFilter !== 'all');
  els.resetShoppingFilters.hidden = !isFiltered;
  els.copyShopping.disabled = items.length === 0;
  els.downloadShoppingCsv.disabled = items.length === 0;

  const totalMissingUnits = items.reduce((sum, i) => sum + i.missing, 0);
  els.shoppingMeta.textContent = totalCount === 0
    ? `Alle Zutaten für „${ms.label}“ sind gedeckt!`
    : `${fmt(items.length)} von ${fmt(totalCount)} fehlenden Positionen · ${fmt(totalMissingUnits)} Stück gesamt offen`;

  if (!items.length) {
    els.shoppingContent.innerHTML = '';
    els.shoppingEmpty.hidden = false;
    els.shoppingEmpty.textContent = totalCount === 0
      ? `Für „${ms.label}“ fehlen aktuell keine Zutaten mehr.`
      : 'Keine Einträge passen zum gewählten Suchbegriff oder Filter.';
    return;
  }

  els.shoppingEmpty.hidden = true;
  const headerHtml = `
    <div class="star-shop-head" aria-hidden="true">
      <span>Item &amp; Bedingungen</span>
      <span>Verwendet in</span>
      <span class="num">Bedarf</span>
      <span class="num">Im ME</span>
      <span class="num">Fehlt</span>
      <span></span>
    </div>`;

  if (state.shoppingGroup === 'mod') {
    const groups = new Map();
    for (const item of items) {
      const modName = item.mod?.label || 'Sonstige';
      if (!groups.has(modName)) groups.set(modName, []);
      groups.get(modName).push(item);
    }
    const sortedMods = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'));
    els.shoppingContent.innerHTML = sortedMods.map(([modName, modItems]) => `
      <details class="star-mod-group" open>
        <summary>
          <span>${esc(modName)}</span>
          <span class="c-badge c-badge--warn">${fmt(modItems.length)} ${modItems.length === 1 ? 'Item' : 'Items'}</span>
        </summary>
        <div class="star-shop-table">
          ${headerHtml}
          ${modItems.map((item) => renderShoppingRow(item, hasStock)).join('')}
        </div>
      </details>`).join('');
  } else {
    els.shoppingContent.innerHTML = `
      <div class="star-shop-table">
        ${headerHtml}
        ${items.map((item) => renderShoppingRow(item, hasStock)).join('')}
      </div>`;
  }
}

/* ---------- Render: Zone 4C Starry-Bee Roadmap ---------- */
function renderRoadmapView() {
  const plan = state.plan;
  if (!plan?.starryBeeRoadmap) return;
  const map = plan.starryBeeRoadmap;
  const hasStock = plan.stock !== null;
  const firstPendingIndex = map.steps.findIndex((s) => !s.done);

  els.roadmapContent.innerHTML = `
    <div class="c-card c-card--accent star-roadmap-hero">
      <div>
        <p class="c-eyebrow">Phase 2 · Endlose Produktion</p>
        <h2>${esc(map.title)}</h2>
        <p class="star-action-sub">${esc(map.subtitle)}</p>
      </div>
      <div class="star-roadmap-links">
        ${(map.links || []).map((link) => `<a class="c-btn c-btn--sm" href="${esc(link.href)}" target="_blank" rel="noopener noreferrer">${esc(link.label)} ↗</a>`).join('')}
      </div>
    </div>
    <div class="star-roadmap-grid">
      ${map.steps.map((step, idx) => {
        const isDone = hasStock && step.done;
        const isCurrent = hasStock && !isDone && idx === firstPendingIndex;
        const cardClass = isDone ? ' star-step-card--done' : isCurrent ? ' star-step-card--active' : '';
        const statusBadge = isDone
          ? '<span class="c-badge c-badge--ok">Erreicht</span>'
          : isCurrent
            ? '<span class="c-badge c-badge--craftable">Aktueller Schritt</span>'
            : '<span class="c-badge c-badge--neutral">Ausstehend</span>';
        const tags = [];
        if (step.targetStars) tags.push(`<span class="star-pill">Ziel: ${fmt(step.targetStars)} ATM Stars</span>`);
        if (step.targetBlocks) tags.push(`<span class="star-pill">${fmt(step.targetBlocks)} ATM Star ${step.targetBlocks === 1 ? 'Block' : 'Blöcke'}</span>`);
        if (step.shardsPerStar) tags.push(`<span class="star-pill">${fmt(step.shardsPerStar)} Shards / Star</span>`);
        return `
          <article class="star-step-card${cardClass}">
            <div class="star-step-top">
              <span class="star-step-num">${String(step.step).padStart(2, '0')}</span>
              ${statusBadge}
            </div>
            <h3>${esc(step.title)}</h3>
            <p class="star-step-detail">${esc(step.detail)}</p>
            ${tags.length ? `<div class="star-step-foot">${tags.join('')}</div>` : ''}
          </article>`;
      }).join('')}
    </div>`;
}

/* ---------- Slide-Over Item Inspector Drawer ---------- */
function findPart(milestone, partKey) {
  return milestone?.parts?.find((p) => p.key === partKey) ?? null;
}

function findIngredientAcrossMilestone(milestone, ingKey, preferredPartKey = null) {
  if (!milestone) return null;
  if (preferredPartKey) {
    const p = findPart(milestone, preferredPartKey);
    const match = p?.ingredients?.find((i) => i.key === ingKey);
    if (match) return { part: p, ing: match };
  }
  for (const p of milestone.parts || []) {
    const match = p.ingredients?.find((i) => i.key === ingKey);
    if (match) return { part: p, ing: match };
  }
  return null;
}

function renderInspector() {
  const target = state.drawerTarget;
  const plan = state.plan;
  if (!target || !plan) return;
  const hasStock = plan.stock !== null;
  const milestones = ['1', '9', '18'].map((id) => plan.milestones[id]).filter(Boolean);

  let title = '';
  let eyebrow = '';
  let icon = null;
  let idBars = [];
  let milestoneCardsHtml = '';
  let requirements = [];
  let rawRule = null;
  let alternatives = [];
  let sharedPool = null;
  let relationsHtml = '';
  let jumpPartKey = null;

  if (target.type === 'part') {
    const curMs = activeMilestone();
    const part = findPart(curMs, target.key);
    if (!part) return;
    title = part.label;
    eyebrow = `Altar-Bauteil · ${part.mod?.label || ''} · ${part.station}`;
    icon = part.icon;
    idBars = part.alternatives.map((a) => ({ label: a.label, id: a.id }));
    requirements = part.requirements || [];
    rawRule = part.rawRule;
    alternatives = part.alternatives || [];
    jumpPartKey = part.key;

    milestoneCardsHtml = milestones.map((m) => {
      const mp = findPart(m, target.key);
      const active = m.id === state.milestoneId ? ' star-m-card--active' : '';
      return `
        <div class="star-m-card${active}">
          <div class="star-m-card-label">${esc(m.shortLabel)}</div>
          <dl>
            <dt>Bedarf</dt><dd>${fmt(mp?.needed)}</dd>
            <dt>Im ME</dt><dd>${hasStock ? fmt(mp?.inMe) : '–'}</dd>
            <dt>Craftbar</dt><dd>${hasStock ? `+${fmt(mp?.craftableNow)}` : '–'}</dd>
            <dt>Fehlt</dt><dd>${hasStock ? fmt(mp?.missing) : '–'}</dd>
          </dl>
        </div>`;
    }).join('');

    relationsHtml = `
      <div class="star-drawer-section">
        <h3>Direkte Zutaten (${fmt(part.ingredients.length)})</h3>
        <div class="star-drawer-list">
          ${part.ingredients.map((ing) => `
            <button type="button" class="star-drawer-link-row" data-inspect-ing="${esc(ing.key)}" data-inspect-part="${esc(part.key)}">
              <span class="star-drawer-link-left">
                ${iconHtml(ing.icon, { size: 'sm', title: ing.label })}
                <span>${esc(ing.label)}</span>
              </span>
              <span class="star-drawer-link-meta">${hasStock ? (ing.effectiveMissing === 0 ? 'Gedeckt' : `−${fmt(ing.effectiveMissing)}`) : `${fmt(ing.needed)} Bedarf`}</span>
            </button>`).join('')}
        </div>
      </div>`;
  } else if (target.type === 'ingredient' || target.type === 'shopping') {
    const curMs = activeMilestone();
    const found = findIngredientAcrossMilestone(curMs, target.key, target.partKey);
    const shopItem = curMs?.shoppingList?.find((s) => s.key === target.key);
    const ing = found?.ing;
    if (!ing && !shopItem) return;

    title = ing?.label || shopItem.label;
    const modLabel = ing?.mod?.label || shopItem?.mod?.label || '';
    eyebrow = `Zutat · ${modLabel}`;
    icon = ing?.icon ?? shopItem?.icon;
    const opts = ing?.alternatives || shopItem?.alternatives || [];
    idBars = opts.map((a) => ({ label: a.label, id: a.id }));
    requirements = ing?.requirements || shopItem?.requirements || [];
    rawRule = ing?.rawRule || shopItem?.rawRule || null;
    alternatives = opts;
    sharedPool = ing?.sharedPool || curMs?.sharedPools?.find((sp) => sp.key === target.key) || null;
    jumpPartKey = found?.part?.key || shopItem?.usedBy?.[0]?.partKey || null;

    milestoneCardsHtml = milestones.map((m) => {
      const mFound = findIngredientAcrossMilestone(m, target.key, target.partKey);
      const mPool = m.sharedPools?.find((sp) => sp.key === target.key);
      const mIng = mFound?.ing;
      const needed = mPool ? mPool.totalNeeded : (mIng?.needed ?? 0);
      const inStock = mPool ? mPool.inStock : (mIng?.inMe ?? null);
      const missing = mPool ? mPool.missing : (mIng?.effectiveMissing ?? mIng?.missing ?? 0);
      const active = m.id === state.milestoneId ? ' star-m-card--active' : '';
      return `
        <div class="star-m-card${active}">
          <div class="star-m-card-label">${esc(m.shortLabel)}</div>
          <dl>
            <dt>${mPool ? 'Gesamtbedarf' : 'Bedarf'}</dt><dd>${fmt(needed)}</dd>
            <dt>Im ME</dt><dd>${hasStock ? fmt(inStock) : '–'}</dd>
            <dt>Fehlt</dt><dd>${hasStock ? fmt(missing) : '–'}</dd>
          </dl>
        </div>`;
    }).join('');

    const consumers = sharedPool?.consumers || shopItem?.usedBy || (found?.part ? [{
      partKey: found.part.key,
      partLabel: found.part.label,
      partIcon: found.part.icon,
      needed: ing.needed,
      allocated: ing.allocated,
      missing: ing.effectiveMissing,
    }] : []);

    if (consumers.length) {
      relationsHtml = `
        <div class="star-drawer-section">
          <h3>${consumers.length > 1 ? `Geteilter Pool (${consumers.length} Bauteile)` : 'Verwendet in Bauteil'}</h3>
          <div class="star-drawer-list">
            ${consumers.map((c) => `
              <button type="button" class="star-drawer-link-row" data-inspect-part="${esc(c.partKey)}">
                <span class="star-drawer-link-left">
                  ${iconHtml(c.partIcon, { size: 'sm', title: c.partLabel })}
                  <span>${esc(c.partLabel)}</span>
                </span>
                <span class="star-drawer-link-meta">Bedarf ${fmt(c.needed)}${hasStock ? ` · zugeteilt ${fmt(c.allocated)} · fehlt ${fmt(c.missing)}` : ''}</span>
              </button>`).join('')}
          </div>
        </div>`;
    }
  } else if (target.type === 'nether') {
    const curMs = activeMilestone();
    const tier = curMs?.netherStarSummary?.tiers?.find((t) => t.key === target.key);
    if (!tier) return;
    title = tier.label;
    eyebrow = `Nether-Stern-Kompression · ×${fmt(tier.units)} Sterne`;
    icon = tier.icon;
    idBars = [{ label: tier.label, id: tier.id }];
    jumpPartKey = 'allthecompressed:nether_star_block_3x';
    milestoneCardsHtml = milestones.map((m) => {
      const mNs = m.netherStarSummary;
      const active = m.id === state.milestoneId ? ' star-m-card--active' : '';
      return `
        <div class="star-m-card${active}">
          <div class="star-m-card-label">${esc(m.shortLabel)}</div>
          <dl>
            <dt>3x-Bedarf</dt><dd>${fmt(mNs.needed3x)}</dd>
            <dt>Effektiv 3x</dt><dd>${hasStock ? fmt(mNs.effective3xAvailable) : '–'}</dd>
            <dt>Sterne fehlen</dt><dd>${hasStock ? fmt(mNs.missingNetherStars) : fmt(mNs.neededNetherStars)}</dd>
          </dl>
        </div>`;
    }).join('');
    relationsHtml = `
      <div class="star-drawer-section">
        <h3>Bestand dieser Stufe</h3>
        <div class="c-notice c-notice--info">
          Im ME: <strong>${hasStock ? fmt(tier.inMe) : '–'}</strong> Stück · entspricht <strong>${hasStock ? fmt(tier.equivalentNetherStars) : '–'}</strong> einzelnen Nethersternen (Faktor ×${fmt(tier.units)}).
        </div>
      </div>`;
  }

  els.drawerIcon.innerHTML = iconHtml(icon, { size: 'drawer', title });
  els.drawerEyebrow.textContent = eyebrow;
  els.drawerTitle.textContent = title;

  const idSectionHtml = `
    <div class="star-drawer-section">
      <h3>Minecraft Item-ID (AE2 / JEI)</h3>
      ${idBars.map((bar) => `
        <div class="star-id-bar">
          <code class="star-id-code">${esc(bar.id)}</code>
          <button type="button" class="c-btn c-btn--sm" data-copy-id="${esc(bar.id)}">ID kopieren</button>
        </div>`).join('')}
    </div>`;

  const altSectionHtml = alternatives.length > 1
    ? `<div class="star-drawer-section">
        <h3>Rezept-Alternativen (${alternatives.length} Optionen)</h3>
        <div class="star-drawer-list">
          ${alternatives.map((opt) => `
            <div class="star-drawer-link-row" style="cursor:default">
              <span class="star-drawer-link-left">
                ${iconHtml(opt.icon, { size: 'sm', title: opt.label })}
                <span>${esc(opt.label)} <small class="star-cell-sub">(${esc(opt.mod?.label || '')})</small></span>
              </span>
              <span class="star-drawer-link-meta">Im ME: ${hasStock ? fmt(opt.inMe) : '–'}</span>
            </div>`).join('')}
        </div>
      </div>`
    : '';

  const reqSectionHtml = requirements.length > 0
    ? `<div class="star-drawer-section">
        <h3>Sonderbedingungen &amp; NBT</h3>
        <div class="star-req-list">
          ${requirements.map((req) => `
            <div class="star-req-item">
              <div class="star-req-item-head">
                <span class="star-pill star-pill--nbt star-pill--nbt-${esc(req.kind)}" style="cursor:default">${esc(req.badge)}</span>
                <strong>${esc(req.label)}</strong>
              </div>
              <p>${esc(req.detail)}</p>
            </div>`).join('')}
        </div>
        ${rawRule ? `<details class="star-raw-rule"><summary>Exakte CC:Tweaked-Regel (JSON)</summary><pre>${esc(JSON.stringify(rawRule, null, 2))}</pre></details>` : ''}
      </div>`
    : '';

  els.drawerBody.innerHTML = `
    ${idSectionHtml}
    <div class="star-drawer-section">
      <h3>Vergleich über alle Ziele</h3>
      <div class="star-milestone-grid">${milestoneCardsHtml}</div>
    </div>
    ${reqSectionHtml}
    ${altSectionHtml}
    ${relationsHtml}`;

  els.drawerFoot.innerHTML = `
    ${jumpPartKey ? `<button type="button" class="c-btn c-btn--sm" data-drawer-jump="${esc(jumpPartKey)}">Im Rezeptbaum öffnen</button>` : ''}
    <button type="button" class="c-btn c-btn--primary c-btn--sm" data-drawer-close>Schließen</button>`;
}

function openInspector(target) {
  state.drawerTarget = target;
  renderInspector();
  if (!els.drawer.open) els.drawer.showModal();
}

function closeInspector() {
  state.drawerTarget = null;
  if (els.drawer.open) els.drawer.close();
}

/* ---------- View Switching & Navigation Helpers ---------- */
function setView(nextView) {
  state.view = nextView;
  for (const tab of els.viewTabs.querySelectorAll('[role="tab"]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === nextView));
  }
  els.panelParts.hidden = nextView !== 'parts';
  els.panelShopping.hidden = nextView !== 'shopping';
  els.panelRoadmap.hidden = nextView !== 'roadmap';
  els.toggleExpandAll.hidden = nextView !== 'parts';
  els.copyShopping.hidden = nextView !== 'shopping';
  els.downloadShoppingCsv.hidden = nextView !== 'shopping';
}

function jumpToPart(partKey) {
  closeInspector();
  if (state.view !== 'parts') setView('parts');
  if (state.partsFilter !== 'all' || state.partsSearch.trim()) {
    state.partsFilter = 'all';
    state.partsSearch = '';
    els.search.value = '';
  }
  state.openParts.add(partKey);
  renderPartsView();
  const node = els.parts.querySelector(`details.star-part[data-part-key="${CSS.escape(partKey)}"]`);
  if (node) {
    node.open = true;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('is-highlighted');
    void node.offsetWidth;
    node.classList.add('is-highlighted');
    node.querySelector('summary')?.focus({ preventScroll: true });
  }
}

/* ---------- Export: Markdown Copy & CSV ---------- */
async function handleCopyShopping() {
  const ms = activeMilestone();
  const items = filteredShoppingItems();
  if (!ms || !items.length) return;
  const hasStock = state.plan?.stock !== null;
  const header = `# ATM-Star Einkaufsliste · ${ms.label} (${items.length} Positionen)`;
  const lines = items.map((item) => {
    const tags = [
      item.mod?.label,
      item.shared ? 'Geteilt' : '',
      ...(item.requirements || []).map((r) => r.badge),
    ].filter(Boolean);
    const qty = hasStock ? fmt(item.missing) : fmt(item.totalNeeded);
    const stockNote = hasStock ? ` (${fmt(item.inStock)} im ME)` : '';
    return `- [ ] ${qty}× ${item.label} (\`${item.id}\`)${stockNote}${tags.length ? ` — ${tags.join(', ')}` : ''}`;
  });
  const text = `${header}\n\n${lines.join('\n')}`;
  try {
    const ok = await copyText(text);
    if (!ok) throw new Error('Clipboard API nicht verfügbar');
    showToast(`Einkaufsliste (${items.length} Positionen) als Markdown kopiert`);
    announce('Einkaufsliste in die Zwischenablage kopiert');
  } catch {
    showToast('Kopieren fehlgeschlagen — bitte Browser-Berechtigung prüfen');
  }
}

function csvEscape(value) {
  const str = String(value ?? '');
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function handleDownloadCsv() {
  const ms = activeMilestone();
  const items = filteredShoppingItems();
  if (!ms || !items.length) return;
  const hasStock = state.plan?.stock !== null;
  const header = ['Item', 'Item-ID', 'Mod', 'Bedarf', 'Im ME', 'Fehlt', 'Deckung %', 'Geteilt', 'Sonder-NBT', 'Verwendet in'];
  const rows = items.map((i) => [
    i.label,
    i.id,
    i.mod?.label || '',
    i.totalNeeded,
    hasStock ? i.inStock : '',
    hasStock ? i.missing : i.totalNeeded,
    hasStock && i.coveragePct != null ? i.coveragePct : '',
    i.shared ? 'Ja' : 'Nein',
    (i.requirements || []).map((r) => r.badge).join(' | '),
    (i.usedBy || []).map((u) => u.partLabel).join(' | '),
  ]);
  const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `atm-star-einkaufsliste-${ms.id}-stars.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('CSV-Einkaufsliste heruntergeladen');
}

/* ---------- Master Render ---------- */
function renderAll() {
  const plan = state.plan;
  const ms = activeMilestone();
  if (!plan || !ms) return;

  const grid = plan.iconGrid ?? { columns: 11, rows: 10 };
  const atlasSize = `${grid.columns * 100}% ${grid.rows * 100}%`;
  els.page.style.setProperty('--star-atlas-size', atlasSize);
  els.drawer.style.setProperty('--star-atlas-size', atlasSize);

  if (state.openParts === null) {
    const firstIncomplete = ms.parts.find((p) => p.status !== 'done') ?? ms.parts[0];
    state.openParts = new Set(firstIncomplete ? [firstIncomplete.key] : []);
  }

  els.tabPartsCount.textContent = fmt(ms.parts.length);
  els.tabShoppingCount.textContent = fmt((ms.shoppingList || []).length);

  renderHero();
  renderActionDeck();
  renderNetherBar();
  renderPartsView();
  renderShoppingView();
  renderRoadmapView();
  setView(state.view);
  els.explorer.hidden = false;

  if (els.drawer.open && state.drawerTarget) {
    renderInspector();
  }
}

/* ---------- Event Listeners ---------- */
els.milestoneSwitch.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-milestone]');
  if (!btn || btn.dataset.milestone === state.milestoneId) return;
  state.milestoneId = btn.dataset.milestone;
  renderAll();
  const ms = activeMilestone();
  if (ms) announce(`Ziel gewechselt auf ${ms.label}`);
});

els.viewTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('button[data-view]');
  if (!tab) return;
  setView(tab.dataset.view);
});

els.partsFilterGroup.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-filter]');
  if (!btn) return;
  state.partsFilter = btn.dataset.filter;
  renderPartsView();
});

els.partsSort.addEventListener('change', () => {
  state.partsSort = els.partsSort.value;
  renderPartsView();
});

els.search.addEventListener('input', () => {
  state.partsSearch = els.search.value;
  renderPartsView();
});

els.resetPartsFilters.addEventListener('click', () => {
  state.partsFilter = 'all';
  state.partsSort = 'recipe';
  state.partsSearch = '';
  els.search.value = '';
  els.partsSort.value = 'recipe';
  renderPartsView();
});

els.toggleExpandAll.addEventListener('click', () => {
  const details = [...els.parts.querySelectorAll('details.star-part')];
  const shouldOpen = !details.every((d) => d.open);
  for (const d of details) {
    d.open = shouldOpen;
    if (shouldOpen) state.openParts.add(d.dataset.partKey);
    else state.openParts.delete(d.dataset.partKey);
  }
  updateExpandAllButton();
});

els.parts.addEventListener('toggle', (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('star-part')) return;
  if (!state.partsSearch.trim()) {
    if (details.open) state.openParts.add(details.dataset.partKey);
    else state.openParts.delete(details.dataset.partKey);
  }
  updateExpandAllButton();
}, true);

els.shoppingSearch.addEventListener('input', () => {
  state.shoppingSearch = els.shoppingSearch.value;
  renderShoppingView();
});

els.shoppingGroupToggle.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-group]');
  if (!btn) return;
  state.shoppingGroup = btn.dataset.group;
  renderShoppingView();
});

els.shoppingFilterGroup.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-sfilter]');
  if (!btn) return;
  state.shoppingFilter = btn.dataset.sfilter;
  renderShoppingView();
});

els.shoppingSort.addEventListener('change', () => {
  state.shoppingSort = els.shoppingSort.value;
  renderShoppingView();
});

els.resetShoppingFilters.addEventListener('click', () => {
  state.shoppingSearch = '';
  state.shoppingFilter = 'all';
  els.shoppingSearch.value = '';
  renderShoppingView();
});

els.copyShopping.addEventListener('click', handleCopyShopping);
els.downloadShoppingCsv.addEventListener('click', handleDownloadCsv);

// Delegated clicks for inspect & jump triggers across the whole page
document.addEventListener('click', async (event) => {
  const copyBtn = event.target.closest('[data-copy-id]');
  if (copyBtn) {
    event.preventDefault();
    event.stopPropagation();
    const id = copyBtn.dataset.copyId;
    try {
      const ok = await copyText(id);
      if (!ok) throw new Error('Clipboard unavailable');
      const prev = copyBtn.textContent;
      copyBtn.textContent = 'Kopiert ✓';
      showToast(`Kopiert: ${id}`);
      setTimeout(() => {
        if (copyBtn.isConnected) copyBtn.textContent = prev;
      }, 1600);
    } catch {
      showToast(`Item-ID: ${id}`);
    }
    return;
  }

  const drawerCloseBtn = event.target.closest('[data-drawer-close]');
  if (drawerCloseBtn) {
    closeInspector();
    return;
  }

  const drawerJumpBtn = event.target.closest('[data-drawer-jump]');
  if (drawerJumpBtn) {
    jumpToPart(drawerJumpBtn.dataset.drawerJump);
    return;
  }

  const jumpBtn = event.target.closest('[data-jump-part]');
  if (jumpBtn) {
    event.preventDefault();
    jumpToPart(jumpBtn.dataset.jumpPart);
    return;
  }

  const inspectIng = event.target.closest('[data-inspect-ing]');
  if (inspectIng) {
    event.preventDefault();
    event.stopPropagation();
    openInspector({ type: 'ingredient', key: inspectIng.dataset.inspectIng, partKey: inspectIng.dataset.inspectPart || null });
    return;
  }

  const inspectPart = event.target.closest('[data-inspect-part]');
  if (inspectPart) {
    event.preventDefault();
    event.stopPropagation();
    openInspector({ type: 'part', key: inspectPart.dataset.inspectPart });
    return;
  }

  const inspectShop = event.target.closest('[data-inspect-shopping]');
  if (inspectShop) {
    event.preventDefault();
    event.stopPropagation();
    openInspector({ type: 'shopping', key: inspectShop.dataset.inspectShopping });
    return;
  }

  const inspectNether = event.target.closest('[data-inspect-nether]');
  if (inspectNether) {
    event.preventDefault();
    openInspector({ type: 'nether', key: inspectNether.dataset.inspectNether });
  }
});

els.drawerClose.addEventListener('click', closeInspector);
els.drawer.addEventListener('click', (event) => {
  if (event.target === els.drawer) closeInspector();
});
els.drawer.addEventListener('close', () => {
  state.drawerTarget = null;
});

// Keyboard shortcuts: / focus search, 1/2/3 milestone switch, Esc clear search
document.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const activeTag = document.activeElement?.tagName;
  const inField = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || document.activeElement?.isContentEditable;

  if (event.key === 'Escape') {
    if (els.drawer.open) return; // native <dialog> closes cleanly
    if (state.view === 'parts' && state.partsSearch) {
      state.partsSearch = '';
      els.search.value = '';
      renderPartsView();
      announce('Suche geleert');
    } else if (state.view === 'shopping' && state.shoppingSearch) {
      state.shoppingSearch = '';
      els.shoppingSearch.value = '';
      renderShoppingView();
      announce('Suche geleert');
    }
    return;
  }

  if (inField || els.drawer.open) return;

  if (event.key === '/') {
    event.preventDefault();
    if (state.view === 'roadmap') setView('parts');
    const targetInput = state.view === 'shopping' ? els.shoppingSearch : els.search;
    targetInput?.focus();
    targetInput?.select();
    return;
  }

  const shortcutMilestone = { 1: '1', 2: '9', 3: '18' }[event.key];
  if (shortcutMilestone && state.plan?.milestones?.[shortcutMilestone]) {
    if (state.milestoneId !== shortcutMilestone) {
      state.milestoneId = shortcutMilestone;
      renderAll();
      const ms = activeMilestone();
      if (ms) announce(`Ziel gewechselt auf ${ms.label}`);
    }
  }
});

/* ---------- Live Polling ---------- */
const polling = connectPolling({
  intervalMs: 30_000,
  immediate: true,
  async refresh() {
    try {
      const next = await api('/api/atm-star');
      updateLiveDeltas(next);
      state.plan = next;
      els.stockError.hidden = true;
      renderAll();
      return true;
    } catch (failure) {
      els.stockError.textContent = `ME-Stand konnte nicht geladen werden: ${failure.message}`;
      els.stockError.hidden = false;
      throw failure;
    }
  },
  onState(pollState) {
    renderStatus(pollState);
  },
});

els.refreshBtn.addEventListener('click', () => {
  polling.refreshNow('manual');
});
