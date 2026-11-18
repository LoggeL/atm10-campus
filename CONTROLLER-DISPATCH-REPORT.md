# K12 continuation from c5291dc — PARTIAL, NOT ACTIVATED

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
