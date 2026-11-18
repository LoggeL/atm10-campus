# K12 integrated scheduler slice — source preparation, NOT activation

This extends `c2fdf55`. Default runtime remains disabled. No optional mapping,
feeder credential or queue job is provisioned at startup. Do not set
`config.ereborPilot` on a live installation yet.

## Implemented

- `massif.reserveGroup(version, 'K12', 'DEF'|'GHI', positions)` reserves exactly
  three canonical published ordinary Massiv tiles and writes their helper jobs
  in one immediate SQLite transaction. Insufficient work rolls back everything.
  Existing reservations are reconciled with canonical jobs. Full bounding-volume
  corners must be strictly within 256 blocks, inside build height; special targets,
  assigned tiles and active catalog anchors are excluded. Legacy A/B/C selection
  remains unchanged.
- `pilotScheduler` is wired into the queue behind an absent-by-default trusted
  source mapping. Optional failures are isolated from legacy helper processing.
  It requires a matching provisioned group identity, current enabled stone queue,
  unpaused site, persistent CAS ownership and exact job snapshots after every
  asynchronous operation. Revocation, changed jobs and expired claims fail closed.
- Native prepare/readback uses the existing full hash/owner/file/anchor/rotation/
  mirror/bounds/options guards. Start additionally requires acknowledged target
  leases, the production group material plan, independent fresh physical group
  proof and a fresh zero-placement/in-flight native inspection. No plan permission
  is misrepresented as actual chest delivery.
- The internal group-plan method reuses the authenticated HTTP route's production
  planner, binding checks, claims and post-await revalidation; it is not another
  public route or a generic station-token authority.
- Signed controller `/campus/erebor-target-leases` is an actual atomic file
  publisher with readback, behind existing HMAC/nonce/controller-lock/paused-server
  handling. It accepts only complete K12 optional groups, unique exact upload IDs,
  stone options, valid short TTLs and full-volume reachability. The complete explicit
  runtime mapping is independently validated against both installed surveys and
  must equal the actual KubeJS consumer mapping. Observation mappings never grant
  this capability. An unexpired other-group lease cannot be silently overwritten.

## Verification boundaries

Tests exercise real SQLite reservations, real stone NBT, authenticated Fastify
requests, the production feeder, actual Python atomic publication/readback and
unsigned HTTP denial. Native inspect/prepare/start and physical group proof in the
coordinator test are deterministic adapters, NOT Minecraft observations.

## Remaining runtime gates — do not deploy as an activated pilot

1. Python controller still deliberately rejects optional prepare/start mutations
   and grouped supply. `erebor-group-proof` is a required protocol gate but has
   **no controller implementation**, so it cannot authorize a live start.
2. Authenticated CC POST transport, exact physical identity/chest readback and
   measured group delivery must be implemented and verified on #50/#51 without
   altering the original feeder. No CC program/settings/credentials were changed.
3. Add independent sub-10-second lease renewal before activation. The legacy queue
   wakes every 10 seconds; the coordinator's 8-second lease deliberately expires
   earlier and is not a sustained renewal mechanism. The publisher refuses a
   fresh other-group overwrite; simultaneous DEF/GHI operation needs a single
   validated aggregate renewal containing both groups.
4. Optional completion/receipt reconciliation and production lifecycle must be
   integrated, not inferred from RUNNING or a successful start response.
5. Install exact reviewed components and explicit verified K12 mappings only;
   re-observe A–C, then prove exact-upload new-slot delivery and placement deltas.
   No second site may be enabled until that real proof exists. Minecraft restart
   remains prohibited; any future tracker installation needs supported script reload.

This change performs no deployment, controller restart, Minecraft restart,
credential provisioning, CC modification or live world/queue mutation.
