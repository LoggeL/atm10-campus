# Erebor placement draft: integration contract

Prepared UI only. Nothing in this change deploys the app, places blocks, assigns stations, supplies items or starts cannons.

## Entry points

- Session-authenticated page: **Campus → Aufstellung**, `/erebor/aufstellung`.
- Session-authenticated read-only JSON: `GET /api/projects/erebor/placement-draft`.
- Supply a **private file outside `public/`**, through `PLACEMENT_DRAFT_PATH=/absolute/path/to/placement.json` or `buildServer({..., placementDraftPath: path})`.
- The file is re-read and validated on each GET; install complete artifacts atomically. No artifact is bundled. Missing, unreadable or invalid artifacts return 503, not invented coordinates or an empty success. Anonymous callers receive page redirect / API 401. Responses use `Cache-Control: no-store`.
- No POST endpoint, database migration, controller call, RCON action or world write is introduced.

## JSON input, schemaVersion 1

```ts
type Position = { x: number; y: number; z: number }; // safe integers, exact world block coordinates
interface PlacementDraft {
  schemaVersion: 1;
  planId: string;       // stable identity, nonempty
  revision: string;     // change whenever physical positions/bindings change
  generatedAt: string; // ISO timestamp, date + T time
  source: string;      // truthful provenance: survey/geometry artifact identity
  stations: Array<{
    id: string;        // unique, nonempty; not restricted to old K01–K37 registry
    label: string;
    dimension: string; // exact dimension resource location
    equipment: {
      receiver: Position | null;
      cable: Position[]; // every planned cable block, not just endpoints
      bridge: Position | null;
      computer: Position | null;
      chest: Position | null;
    };
    cannons: {
      A: Position;        // initial cannon serving THIS chest
      B: Position | null; // optional reserved expansion position
      C: Position | null; // optional reserved expansion position
    };
    observed?: null | {
      at: string;        // observation time, not artifact-generation time
      source: string;    // saved-world scan/native snapshot provenance
      computerId: number | null; // nonnegative safe integer; null for unbooted/unknown
      blocks: Array<{ position: Position; blockId: string }>;
    };
  }>;
}
```

Each station is one chest/feed group, initially A only, with B/C reserved. Add as many stations as required; do not force new groups into the existing physical registry. All equipment keys and A/B/C keys must exist; explicit `null` means unknown/not yet specified, and an empty cable array means no cable coordinates supplied. Coordinates are never rounded, transformed or guessed by the UI. A requires a real position; B/C may be unknown and then their checkboxes are disabled. Labels/provenance are rendered as text, not HTML.

Use `public/assets/erebor-placement-model.js::validatePlacementDraft` to validate producer output offline. This checks shape, provenance, integer coordinates and unique IDs, **not** collision safety, adjacency, build-height limits, cable connectivity, reachability, inventory identity or authorization. Those proofs belong to the geometry/survey producer and later integration. Never put tokens, credentials or unrelated inventory dumps in this artifact. The endpoint returns the validated artifact; keep the file restricted to this contract.

## Checklist / known metadata separation

Three independent flags per physical slot: `placed`, `commissioned`, `runningObserved`. The labels explicitly identify the last as a manual observation. Optional B/C are not enabled or added to a runtime fleet by checking them.

Current adapter: localStorage namespace is JSON-encoded `['campus-placement-manual-v1', userId, planId, revision]`; keys within its object are JSON-encoded `[stationId, slot, flag]` with boolean values. This is **personal browser-local draft state**, not a shared checklist, server ledger or verified observation. Revising the plan does not inherit old confirmations. Storage failures visibly warn that notes cannot persist. A later shared persistence adapter must retain manual provenance and user/time auditing, and must never write these booleans into a telemetry record.

Known metadata is shown separately under **Bekannte Metadaten · nur lesbar**, with its own source and timestamp. Saved block presence/CC ID proves neither commissioning nor a running cannon. **Live-Betrieb always remains unbekannt**: this UI has no live telemetry input. A manual `runningObserved=true` cannot change that label. If live evidence is integrated later, bind it independently to exact physical slot/job identities, show its report timestamp, and expire it fail-closed; do not map manual flags to running status.

## Verification

```sh
LOG_LEVEL=silent node --test test/erebor-placement.test.js
# optional real Chromium regression; Playwright may be installed outside the repo
LOG_LEVEL=silent PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
  CHROMIUM_PATH=/usr/sbin/chromium-browser \
  node --test test/erebor-placement.browser.js
LOG_LEVEL=silent node --test --test-concurrency=1 test/*.test.js
```

The browser regression creates an explicitly synthetic artifact only in scratch, registers a temporary local test account, exercises actual authenticated HTTP/DOM behavior at 390px and 1440px, checks injection safety, coordinate rendering, checkbox persistence, revision isolation, search, logout redirect and manual/unknown separation. It writes `erebor-placement-mobile.png` and `erebor-placement-desktop.png` into `$TMPDIR`. This is local browser coverage, not authenticated production verification.

Baseline used: remote `origin/main` at `ace301ec2ac87ec98f03a8ba7820953f8c726663`; public `/healthz` reported 0.14.2. This does not establish exact deployed source hash equality. On that unchanged baseline, `asset-versions.test.js` already reports six generations and `erebor-fallback-ui.test.js` already throws at `project-blueprints.js:114`; both were reproduced in a detached baseline worktree. The new assets reuse the existing dashboard generation plus a focused `revision`, without sweeping unrelated asset versions.

Local verification result: 4/4 focused Node checks and 1/1 real Chromium regression passed. Serial full suite: 257/259 passed, with only the two reproduced baseline failures above. Evidence logs: `$TMPDIR/campus-placement-tests.log` and `$TMPDIR/campus-placement-baseline-tests.log`; browser screenshots use the paths above.
