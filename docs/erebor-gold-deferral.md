# Erebor: gold-only deferral staging and activation boundary

## Delivered scope

**Prepared-only, not an enabled scheduler feature.** The offline tool makes a durable,
self-contained split of one hash-verified published interior build. It does not
change a cannon, upload directory, controller, database, catalog receipt or queue.
It cannot resume construction by itself. Do not deploy this branch as if it could.

Only these exact IDs are deferred:

- `minecraft:gold_block`
- `rechiseled:gold_block_polished_connecting`
- `minecraft:raw_gold_block` (retained separately; not refined gold)

Other items, including IDs merely containing `gold`, remain in the continuation.
The supported input is a loaded, untainted, published 32³ interior `build` job,
mode 0 or 2, `skip_missing=false`, `replace_block_entities=false`, without
selection/surface/Massiv work, entities, block entities or explicit air targets.
No material is substituted, created or destroyed. Both files use full-volume
structure-void outside their own exact target set; no omitted gold becomes air.
States and properties are preserved. Target counts are gross original targets,
not exact unplaced demand: already placed cells remain in their respective file.

## Durable preparation

Using Node >=24, capture a consistent read-only current queue/helper assignment
and copy its exact original upload without altering it. Metadata is:

```json
{"version":12,"site":"K06","slot":"A","job":"REPLACE with complete actual persisted job object","originalPath":"/absolute/path/to/copied-original.nbt"}
```

The string above is explanatory, not executable sample job data. Supply the
complete actual object, including `desired`, `source`, `phase`, `interior`,
`size`, `blocks`, `loaded` and retained state.

```sh
node tools/prepare-erebor-gold-deferral.mjs INPUT.json OUTPUT.zip
node --test test/erebor-gold-deferral.test.js
```

The tool exclusively creates a mode-0600 archive, fsyncs it, then verifies its
readback hash. It refuses to overwrite any existing file. A failed/interrupted
write is NOT a valid archive; choose a new path and verify before use. Keep it
on backed-up durable storage, not only scratch. The ZIP contains:

- `original.nbt`: byte-identical original input;
- `continuation.nbt`: every original non-gold target;
- `deferred-gold.nbt`: every original gold target;
- `gold-deferral.json`: complete original job, exact target local/world positions
  and properties, hashes, derived native upload identities and prerequisites.

`activationAllowed=false` and `originalFinished=false` are intentional hard
boundaries. Dependencies are documented in the archive, NOT installed scheduler
locks. Staging does not establish native pause, current material scarcity,
world safety, support independence, reachability or receipt validity.

## Why runtime rollout is blocked

Inspected live queue and tile renderer hashes matched `ace301e` exactly on
2026-11-23. The deployed `src/erebor-interior.js::interiorFrontier` lines 11–31
keeps the lowest open build as a column predecessor. Keeping the original open
preserves that dependency, but it does not free the same occupied cannon.

`src/erebor-queue.js::finishRooms` lines 513–596 only reconciles a loaded job
against its original exact native completion or an exact full-original saved-world
check. Replacing the file without a persisted suspension/partition state does
not satisfy these gates. Marking a continuation finished under the original name
would falsely release its successors despite the deferred gold.

The existing `setzlingswechsel` route and `finishRooms` released-input path are
restricted to `oldTreeInput`/`releasedSurface` and a published sapling revision.
They are not a generic arbitrary-revision or gold-deferral API. Its installer
also had an integer-vs-byte `Slot:0` mismatch in an earlier operation; do not
reuse those commands or clear inputs manually. New split upload IDs have no
published scheduler assignment/adoption path today. A controller-only file swap
would leave a mismatched assignment and does not preserve completion semantics.

Therefore **no runtime deployment or cannon release is safe yet**. This branch
is isolated source preparation, not a claim that paused gold builds now advance.

## Required safe activation and later user-triggered resume

The next implementation must exercise the complete path in fixtures before a
live pilot. These are requirements, not a currently available API:

1. Persist an atomic original+continuation+gold ledger before native mutation,
   including exact upload hashes, version, site/slot, anchor/bounds, orientation,
   options, catalog identity, original progress and reservation/dependency state.
   Keep the original open and block its successors. Enforce compare-and-set and
   crash/restart idempotency; stage all uploads without replacing originals.
2. Prove fresh exact paused/missing-gold state, empty flight list, same native
   input/progress/options and original hash. Validate actual remaining non-gold
   world targets against protection/range and support dependencies, including
   cross-tile/multiblock attachment and gold below/adjacent. An exact partition
   alone proves neither structural safety nor valid placement order.
3. Add a supported guarded native suspension/replacement operation with exact
   backup, atomic preconditions and attributable readback. A failed/ambiguous
   guard must preserve the original reservation and must not retry a mutation.
   No generic `skip_missing`, creative supply, manual destruction or game restart.
4. Have the queue adopt only its own persisted continuation, renew matching target
   leases and normal material supply, and reconcile its exact completion WITHOUT
   an original completion receipt. Retain deferred gold and all dependencies.
5. Reactivate gold ONLY on an explicit later user request. Revalidate project,
   exact original identity, world/protection/range, partition ledger and support.
   Adopt the exact gold-only upload through the same guarded path. Retain raw
   gold separately in supply. Do not automatically trigger on ME stock changes.
6. Finish the original only after both partition proofs AND a fresh exact
   full-original world/property check; only then unblock successors. Exercise
   restart after each mutation/receipt boundary and verify unaffected live jobs.

If a guarded switch has not occurred, rollback is simply leaving the original
job/input untouched. After a switch, use the new persisted guarded rollback
operation; no ad-hoc SQLite edit or native input removal is an acceptable substitute.

## Verification evidence (not a live activation)

A read-only real K06A assignment was captured at `2026-11-23T12:38:03.897Z`:
original `campus_31fec83a-e5b0-8183-b218-4522adf9446e.nbt`, SHA-256
`2c02a77a7564c8ebf9ba4b9504964ca89780baa530adc0673f48d9a4a7ad2018`.
The prepared bundle contains 4,812 non-gold targets and 256 exact deferred gold
targets; original total 5,068. These are plan counts, not new placements.
Durable evidence lives outside the repository at
`/home/logge/.hermes/workspace/erebor-gold-deferral-evidence/`.
No original assignment was edited and no native mutation was issued.

Focused partition/interior/sapling regressions: 11/11 pass. Complete serial
Node suite: 259 tests, 257 pass, 2 fail. Both failures reproduce on the unchanged
`ace301e` base: `asset-versions.test.js` (six existing asset generations) and
`erebor-fallback-ui.test.js` (missing `filter` data at `project-blueprints.js:114`).
Logs: `serial-tests.log` and `baseline-failures.log` in the evidence directory.
The real-upload exact-union/hash/no-explicit-air proof is `verification.json`.
