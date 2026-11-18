# K12 continuation from db1df73 — TESTED PROTOCOL INCREMENT, NOT ACTIVATED

## Latest outcome

Implemented concrete DEF controller dispatch state and authenticated delivery
protocol source, but **not the complete production vertical slice**. No deployment
was attempted: required runtime mapping and a connected production delivery client
are absent in this checkout. A–C and every other site remain untouched.

### Added

- `controller/campus_dispatch.py`: complete DEF job grant, exact desired/size
  authorization, eight-second expiry, single-use random delivery challenge,
  native before/after stone delta matching the CC receipt, server-side aggregate
  192-stone chest buffer cap, complete exact target-lease requirement for start.
  In-memory state disappears on restart; no default grants or credentials.
- Signed controller routes `erebor-dispatch-grant` / `erebor-group-delivery` retain
  existing HMAC/nonce, serialized controller and paused-server handling. A valid
  grant installs the real arbiter instead of a boolean test callback. The native
  start path still performs its second gate check. Gate checks exact current
  mapping and disk lease readback, not just remembered publication permission.
- Delivery requires fresh full-group physical identity and three stopped,
  zero-placement, zero-flight cannons. Native ordinary chest NBT is parsed with
  coordinate-attributable replies; malformed/truncated replies and unverified
  SophisticatedStorage inventory encoding fail closed. Existing physical proof
  becomes verified only with matching authenticated native delivery evidence.
- Dedicated feeder-auth `/delivery/begin` and `/delivery/commit` API source uses
  persistent CAS claims, current loaded job snapshots, credential and phase
  revalidation after awaits, production material demand cap, and explicit
  `dispatchProtocol:1` opt-in. Caller cannot supply jobs, coordinates or baseline.
- `controller/computercraft/erebor-group-delivery.lua`: one-shot #50 DEF exporter,
  local back bridge/front chest, dedicated HTTPS POSTs, persistent pre-export
  attempt marker, local inventory delta and server receipt. Failed or ambiguous
  receipt never causes re-export. Not startup and not installed anywhere.

### Verification

- Full serial Node suite: **284 passed**, no failures/skips.
- Full Python/Lua suite: **89 passed**, using isolated scratch lupa venv.
- Logs: `/home/logge/.hermes/cache/scratch/k12-dispatch-node.log` and
  `/home/logge/.hermes/cache/scratch/k12-dispatch-python.log`.
- `git diff --check` passed. Tests use actual SQLite/Fastify, production Lua and
  native SNBT parser; world/HTTP peripherals remain deterministic fixtures, not
  live Minecraft delivery or progress evidence.

### Precise outstanding blockers

1. `campus.ereborGroupRequest` is deliberately NOT connected by production startup;
   delivery routes therefore remain fail-closed. The new protocol's controller
   actions are real signed routes, but application runtime integration is incomplete.
2. Existing optional scheduler does NOT issue pre-prepare dispatch grants, wait
   for authenticated CC receipt or wake immediately on receipt. Its ten-second
   cadence cannot guarantee use of this eight-second grant/receipt window. Do not
   solve this by lengthening or bypassing guards; integrate bounded event-driven
   dispatch and existing independent renewal coherently.
3. Production controller `erebor-supply` still rejects grouped requests. The
   existing planner therefore cannot supply a production material permission yet.
4. One-shot initial delivery is not sustained feeding or completion/receipt
   reconciliation. Those lifecycle paths remain incomplete.
5. No runtime mapping, provisioned feeder credential, exact component installation,
   native own-chest delivery, same-upload D/E/F placement deltas or continuing
   A–C placement evidence was collected. No live progress is claimed.

No deployment, service/Minecraft restart, KubeJS reload, queue/world mutation,
CC installation or credential provisioning occurred. Pre-existing untracked
`scratch/` was left alone. The user requested prompt feature-branch publication;
this is a partial source handoff, not a pilot release. Reusing program bytes is
safe only with independently provisioned identity/chest/settings: never clone
credentials or the original A–C computer's configuration.

---

# Earlier continuation from c5291dc — PARTIAL, NOT ACTIVATED

The requested CONTROLLER-DISPATCH-REPORT.md did not exist in this checkout or the workspace search. This is the new explicit continuation record; it is not recovered prior evidence.

## Implemented

- Signed/controller-locked `/campus/erebor-group-proof` read-only production route. It validates the complete runtime mapping, K12 group/computer binding and computer-local chest side, checks loaded physical computer ID/facing, supported single chest, shared ME bridge, exactly the three adjacent cannon consumers (rejecting additional consumers), and fresh native upload/owner/anchor/bounds/options for all group jobs.
- The result deliberately separates `physicalVerified=true` from `verified=false`, with `authenticated-delivery-required`. It does not install an optional dispatch authorizer or pretend a physical inventory identity is proof of authenticated CC material delivery.
- Independent two-second target-renewal loop, separate from the ten-second scheduler. Eight-second leases remain bounded. Renewal only arms after the complete scheduler's guarded dispatch succeeds; it rechecks credential, phase/version/pause/Massiv gates, unchanged complete-group reservations and duplicate main/helper upload reservations. It serializes publications, validates exact readback/expiry and never retains an omitted mapping/group. Shutdown clears the timer and awaits an in-flight renewal.
- Renewal is intentionally single-configured-group ownership, not multi-group aggregate scheduling. A change from DEF to GHI disables the old renewal; the existing controller rejects replacing any still-live omitted group lease. No group is implicitly extended.

## Verification

- Serial full Node suite: 284 passed, zero failed/skipped. Log: `/home/logge/.hermes/cache/scratch/k12-continuation-node.log`.
- Full Python suite using existing isolated lupa venv: 79 passed. Log: `/home/logge/.hermes/cache/scratch/k12-continuation-python-venv.log`.
- System Python attempt failed on two missing-lupa imports; the isolated rerun resolved those environment failures.
- Added failure-first regression coverage for renewal, authoritative revocation/pause/duplicate ownership, omitted groups, serialization, and physical proof not substituting for authenticated delivery. Native block execution is tested with a deterministic read-only condition adapter, NOT a live Minecraft readback.
- `git diff --check` passed.

## Still missing — mandatory deployment blockers

- Production optional dispatch arbiter joining persisted exact reservation proof, physical proof, authenticated CC delivery and sustained renewal. The injected optional_dispatch_gate seam remains uninstalled.
- Authenticated ComputerCraft group transport and measured own-chest delivery, including a bounded server-validated receipt protocol. Existing authenticated plan permission alone is insufficient.
- Live runtime mapping and host command connection in this worker. No local SSH config was found; this says nothing about access retained by the parent session.
- Physical D/E/F loaded upload, material arrival and same-upload placement deltas, plus continuing A–C placement evidence. None were measured here.
- Optional completion/receipt reconciliation and later multi-group ownership need further work before wider rollout.

No push, deployment, service/Minecraft restart, queue/world mutation, credential provisioning or CC file modification was performed. A–C dispatch/material guards remain unchanged. No other site or group was enabled. K12 DEF is NOT claimed operational; the requested full activation remains incomplete.
