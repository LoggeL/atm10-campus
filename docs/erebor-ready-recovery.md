# Retained helper first-ready recovery

A lost coordinate-attributable inspect/prepare response can leave the exact reserved
input at native `PAUSED/ready`, sometimes with `job.loaded=false`. A full helper
rotation can take minutes. `startFueledExtras` now revisits ordinary clear/build
helpers with that exact stored ambiguity through the existing serialized `service`.
Normal surface priority also receives the current-publication/dependency validation;
the existing special grove/released-surface and stone/urn eligibility remains separate.

## Scope and guards

- Reuse the full immutable upload derived from blueprint plus SHA256, owner,
  version, anchor, bounds, orientation and exact safe options. Require current
  shared-chest/project-work/helper/tracker capabilities, a report younger than
  15 seconds, positive fuel and an untouched matching `PAUSED/ready` input.
- Re-enter the normal candidate gates in **validation-only** mode: exact current
  published bytes, frontier, full-volume range, released/nonbusy columns,
  protections and unchanged saved-world checks. Do not assign new work, release
  reservations or mark columns. Surface additionally requires its exact current
  dispatch/revision and lowest open column, and no local published/unpublished
  clear/build predecessor. Recheck publication/ownership after the worker await.
- Inspect natively through normal service. Require matching file/hash/options,
  initial printer cursor `[-1,0,0]`, no deferred/entity progress or flights, zero
  placement and a valid output baseline. Persist `loaded` and baseline before start.
- The existing budget remains three ready candidates plus one existing cold-urn
  retry per invocation, a 30-second same-upload cooldown, and the fresh-report
  deadline. There is no new timer or parallel controller request path.

Only `Minecraft hat keine eindeutige Antwort für diese Kanonenposition geliefert.
Bitte erneut prüfen.` permits one additional **read-only inspect**, while assignment,
lease, enablement and freshness still match. Neither timeouts nor safety refusals
are generalized into retry authorization. In particular, `Kanone während
Vorbereitung geändert` is not treated as this read ambiguity.

## Ambiguous start replies

Helper first starts persist `job.startPending=true` **before** the native request.
A matching acknowledged result clears it; the installed controller's exact resource-wait
refusal also clears it because that refusal precedes any start mutation. Unknown or
ambiguous failures retain it across app restarts and serial helper revisits. Normal
inspection can still adopt actual running progress; an unconfirmed input that remains
paused needs operator reconciliation, not deletion of the marker to force a retry.
No start/prepare mutation is retried by the new priority recovery path.

## Verification boundary

`test/erebor-ready-recovery.test.js` exercises the public helper fast-lane seam with
real SQLite persistence/reopen, immutable publication hashing and the production
closed-over candidate/validator body. Native controller replies, world-worker results
and policy boundaries are injected; these are local regressions, not Minecraft or
installed-controller operation proof. Existing interior/P-SEE regressions separately
exercise the unchanged actual NBT world checks. No controller, feeder or API module
change, Minecraft restart, deployment or live write is required by this source patch.

Run serially:

```sh
node --test --test-concurrency=1 test/erebor-ready-recovery.test.js test/erebor-first-fuel.test.js test/erebor-parallel.test.js test/erebor-queue.test.js test/erebor-selection.test.js test/erebor-surface.test.js test/erebor-interior.test.js test/erebor-psee-scheduler.test.js test/erebor-section-prerequisites.test.js test/erebor-section-scope.test.js test/erebor-urn-packs.test.js test/erebor-urn-receipts.test.js
node --test --test-concurrency=1 test/*.test.js
```
