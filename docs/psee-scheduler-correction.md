# Scoped P-SEE scheduler correction (local only)

Base: `3140774` (origin/main). Its `src/erebor-queue.js` SHA-256 matches the captured deployed source in `../erebor-fallback-live/erebor-queue.js`: `afba9acb4e147d54f4da5f25b35f08baa93aa6b695737497e919b27443685336`.

Only the outdoors protected-box predicate in `interiorCandidate` changes: P-SEE no longer blanket-rejects trusted published architecture. Bridge/Esgaroth are intentional design exceptions. All other protections, including unnamed boxes, remain rejecting. No change to site protections, Massiv filling, target validation, published-file resolution, water handling, natural outdoor material whitelist, surface generation or completion semantics.

The new regression exercises the actual scheduler closure body with injected persistence/worker boundaries and the real frontier, column and range functions. It is not a complete native-controller dispatch integration test. Separate real NBT/exact-world-check tests verify that outdoor build/clear continue rejecting water and foreign structures. Existing natural shore materials remain allowed only by the unchanged exact-target outdoor whitelist; this is not a promise to preserve every dirt/sand target or an all-export shoreline census.

Verification:
- RED before patch: new scheduler tests failed on P-SEE blanket rejection and failure to reach published-file resolution.
- New focused suite: 4 passed, 0 failed.
- Existing interior + queue plus initial focused tests: 11 passed, 0 failed (before adding the fourth water regression).
- Full serial suite: 255 tests, 253 passed, 2 failed. Both failures reproduced on unchanged base 3140774: `asset-versions.test.js` (six existing asset generations) and `erebor-fallback-ui.test.js` (fixture missing response array / undefined.filter). Unrelated UI fixes intentionally excluded.
- Full output: workspace `erebor-fallback-live/psee-full-tests.log`.

No deployment, remote push, live DB/controller/world writes or completion receipts. Parent review remains required before external changes; local verification does not establish every affected published file is currently schedulable or unfinished in the live world.
