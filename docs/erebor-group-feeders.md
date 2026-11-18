# K12 grouped feeder API slice (not activated)

`POST /api/erebor/groups/K12/{DEF|GHI}/plan` accepts a dedicated bearer
credential and `{computerId,chestSide}`. It does not accept general app tokens,
station tokens, browser sessions or a caller-selected slot list. Credentials are
random, stored only as SHA-256 digests in `erebor_group_feeders`, and do not
appear in `api_tokens`, so they cannot authenticate unrelated application routes.
The trusted `registerGroupFeeders(...).register(mapping)` provisioner is a code
interface, not a public registration route. There are no default credentials or
bindings. Provision only after independent physical mapping and safe-start checks.
Do not print or commit issued credentials. Delete a binding to revoke it; there
is deliberately no implicit rebinding/upsert.

## Executable integrated path

Authenticated HTTP poll → exact K12/group/computer/chest binding → current-version
enabled queue → three loaded, untainted, uniquely reserved helper jobs → persistent
SQLite in-flight claim → production `ereborFeeder` → group-specific signed
`erebor-supply` request → exact complete confirmations → bounded material plan.
The original feeder still queries only A/B/C. New groups never fall back to the
legacy single-cannon probe. A missing/partial/error result yields an empty paused
plan; queue changes, duplicate uploads and changed jobs fail closed. Auto-crafting,
leftover return and gunpowder delivery are disabled for this slice.

A 30-second compare-and-set claim serializes probes across app processes. Before
returning, the service rechecks claim ownership/expiry, credential existence,
queue version/enabled state, job snapshots and upload uniqueness. A changed job
cannot inherit an in-flight response. The existing ten-second feeder lease and
assignment identity remain unchanged. This is arbitration of persisted job supply
leases, NOT a new scheduler that allocates Massiv jobs or steals reservations.

## Verified locally

`test/erebor-group-integration.test.js` exercises Fastify injection, real SQLite,
production feeder demand and a deterministic controller adapter. It proves DEF
requests only D/E/F and returns 192 stone for three 64-block fixtures. It tests
cross-group authentication, partial confirmations, controller errors, duplicate
uploads and queue disablement. `erebor-group-auth` tests concurrent poll exclusion
and revocation when a job disappears during a pending probe. Existing
`erebor-group-supply` protects the original A/B/C isolation fix.

## Remaining activation gates

This commit does NOT install credentials, change ComputerCraft startup, deploy
Campus/controller/tracker, reload KubeJS, restart Minecraft or activate D–I.
The current controller rejects the new `group` field; it intentionally cannot
silently service these requests as A/B/C. A future controller must consume a
separate explicit runtime mapping (never observe-only mappings), prove local
computer/chest/three-consumer identity, and confirm all exact targets. The CC
transport must use this dedicated POST route/credential and halt on errors.
Atomic scheduler allocation, authenticated target-lease publication, guarded
prepare/start, verified physical mapping and measured same-upload placement
remain required. No claim of live nine-cannon construction follows from these
local integration tests.
