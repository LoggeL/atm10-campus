# Regular Cleanstone / Massiv audit (2026-11-17)

Scope: reversible production presentation only. No automatic-candidate filtering,
plan deletion, completion changes, active-job changes or Minecraft restart.

## Read-only snapshot findings

Live current project v12; consistent SQLite `VACUUM INTO` snapshot passed
`PRAGMA integrity_check`. Canonical current-version regular catalog contains
11,637 files: 7,728 unfinished, 3,909 with recorded completion. Massiv snapshot
contains 15,537 tiles: 6,071 recorded done, 9,466 not done.
7,727 of the unfinished regular files have a single containing Massiv bounding
box. This is **not** proof of redundancy. Zero files were certified redundant.
Numbers are timestamped observations, not stable production totals.

## Why no backend filter is safe yet

- `productionStore.catalog()` selects current prepared packages (plus only an
  explicitly compatible prepared-base version), then clear/build architecture.
- Regular exports and `scanMassifColumn()` share mountain intent, not identical
  target semantics: regular filling skips existing solids, Massiv distinguishes
  non-stone repair, cavities, and selected special block entities.
- Massiv omits protected boxes, station/chest buffers, technical blocks and
  machine buffers; unknown chunks and unknown adjacent machine-buffer fringes
  defer target generation. Bounds cannot establish voxel/material inclusion.
- A Massiv tile may be only planned, assigned or recorded done. A completion
  receipt does not certify every current world voxel or future regular target.
- Candidate availability must also preserve dimension, target material/block
  state, placement/options and cannon reachability. No combined exact
  material/world/protection/reachability/completion certificate was established.

Backend candidate selection and every state/history table remain unchanged.
A future suppression filter needs exact parsed NBT/world-coordinate set coverage,
compatible material/options and protections, usable reachable replacement work,
explicit completion semantics, and adversarial regression fixtures. Do not infer
these from volume overlap, filename, block counts or station totals.

## Presentation contract

Massiv unfinished count stays primary and unchanged; A/B/C progress stays separate.
Regular prepared-stone entries move into closed, clearly named fallback details.
The main current job and architecture/aushub entries stay outside that group,
even beyond the regular-list pagination limit. Search, NBT downloads, plan loading,
priority actions and completed history remain available. Unknown/unmapped plans
stay visible, never silently classified as regular fallback. Catalog counts stay
available in closed details and are explicitly not additive to Massiv demand.

Regression seam: `createProjectBlueprints` read-only response-to-render boundary,
plus existing selected-station Massiv counter seam. Initial new UI test failed
before implementation; after implementation the serial complete suite passed.
