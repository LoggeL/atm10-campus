# Optional nine-cannon preparation — LOCAL ONLY

Status: tested concrete subset, **not a working nine-cannon runtime**. Do not push,
open a PR, deploy, install, reload scripts, restart a service or change queues/world
until the owner explicitly reports the hardware built and authorizes completion.
This branch deliberately leaves all existing dispatch, telemetry and feeder paths
unchanged. Three-slot production remains the default.

## Scope and test seam

Requested Campus/controller/telemetry/feeder safety seams were inspected. This
subset implements only the pure offline `ninePreflight(config, observation, jobs,
now)` seam plus a local JSON CLI. It has no controller, database, network or world
side effects. Its output is always `prepared-only`, `runtimeEnabled:false` after
opt-in; it is NOT a material lease, trusted hardware proof or start permission.
The observation must eventually come from independent trusted native/controller
and CC read-only collection, not be copied from the intended mapping.

## Read-only observed baseline (2026-11-18)

Fresh upstream base: `acd24f5271b0f2c4b59fa595a6581faf05b5960a`.
Worktree: `/home/logge/.hermes/workspace/campus-nine-preflight`.
Branch: `feat/erebor-nine-preflight`.

The actual container `atm10` mounts `/home/logge/minecraft/atm10/data` at `/data`.
The persisted, actively refreshed `kubejs/config/erebor-target-live.json` sample
at `1795010339786` was 2.78 seconds old when read: 111 cannon rows, 37 network
station rows, `version:12`, `sharedChest:4`, `chestTracker:5`. These are existing
three-cannon groups, not nine-cannon readiness. No diagnostic script was installed.

K01 was inspected as an actual existing example, not a template for new positions:

- Survey: computer `[-252,32,-11012]`, bridge `[-252,32,-11013]`, chest
  `[-252,32,-11011]`; A `[-252,32,-11010]`, B `[-253,32,-11011]`,
  C `[-251,32,-11011]`. Each cannon neighbours that one chest.
- Fresh tracker reports all three chest blocks as
  `sophisticatedstorage:netherite_chest`, ready, with independently loaded and
  advancing-capable RUNNING inputs. Survey still says `minecraft:chest`: static
  survey identity alone is insufficient to establish actual chest type.
- Computer filesystem `world/computercraft/computer/12/startup.lua` sets
  `erebor-K01` and its label, then runs `campus.lua`. It does not pin bridge/chest
  peripheral settings. No `.settings` was present there. This identifies a saved
  installation, not a new independent live physical-ID attestation.
- K01 network telemetry measured bridge loaded, powered, online, channels satisfied,
  not booting. No extra bridge or new computer/chest identity was invented.

Installed bytes differ from fresh repository. Reviewed normalized source diffs:

- Host `campus_erebor.py`: installed stone prepare mode is 0, repository is 2.
- Tracker: installed version lacks repository's tick-time native mode normalization
  and emits options only with an input. Preserve network telemetry and existing
  target-ticket semantics; never blindly install repository tracker over it.
- Computer 12 feeder is 1.4.3 versus repository 1.4.9; newer source adds the K02
  crafting worker. This worker is not a nine-cannon requirement or authorization.

## Seam audit and remaining integration

| Seam | Existing constraint | Work still required before nine-slot operation |
| --- | --- | --- |
| `src/erebor-parallel.js` | B/C loop, main plus helpers; durable helper jobs and reservations | Explicit site/group mapping for D–I; globally unique work/reservation semantics; preserve restart reconciliation, phase, mode, taint, completion and reachability gates |
| `src/erebor-massif.js` | Physical position lookup via `main`/B/C; slot-sensitive solid mode | All nine measured positions; exact target reachability (not just anchor); preserve special/manual exclusions and active overlap checks |
| `src/erebor-queue.js` | Manual start/resume/repair and telemetry loops whitelist A/B/C | Extend only for opted-in sites with measured mappings; retain current-version and guarded-write checks |
| `src/erebor-feeder.js` | One `erebor-Knn` feeder row, group A/B/C targets; assignment hash from uploads; read limiter 2 active/37 pending | Three separately authenticated feeders and status rows per site; group-only demand/leases/assignment ledgers; no cross-group returns, crafting or delivery caps; recheck mapping/job after await; assess limiter capacity rather than multiplying concurrency |
| `controller/campus_erebor.py` | Helper regex B/C; shared supply accepts max 3 targets from A/B/C, physically proves local computer/chest/inputs | Keep three consumers PER CHEST, not nine targets in one chest call; independent computer ID/label/chest proof per group, exact file/hash/options and fail-closed unknown neighbouring cannon checks |
| `controller/campus_discovery.py`, `campus_cannon.py`, `campus_start.py` | Physical candidate proof, canonical NBT and guarded native writes | Preserve narrow allowlists and serialized RCON; add named wired inventory attestation without arbitrary command endpoint |
| `controller/kubejs/erebor-target-chunks.js` | Survey main + B/C; 37 bridge diagnostics, readiness, finish receipts, target leases | Explicit nine-cannon observations with per-group identity; keep one shared bridge observation/site, telemetry freshness and network body; never infer bridge count from cannon count |
| `public/cc/campus.lua`, `src/api-stations.js` | Auto bridge and unambiguous inventory discovery; export target uses bridge namespace; short alignment lease, persisted assignment delivery caps | Three wired computers sharing one physically verified ME bridge require explicit named bridge/chest and empty direction override; unique tokens/labels/state. Do NOT use an arbitrary computer-local `left` as shared-bridge export target |
| `src/cannon-progress-rows.js`, `src/api-erebor-fleet.js`, queue/project assets | A/B/C displays and one feeder per site | Nine distinct progress identities and three feeder warnings only on opted-in sites; missing/stale remains unknown; do not sum shared ME stock three times |
| `src/erebor-fleet/install.py`, `tools/build-erebor-parallel.py`, `tools/install-erebor-parallel.py`, ZIP kits | Survey-specific 37-site generation and hash allowlists | New optional manifest/version, live-byte reconciliation, old-hash prerequisites, backups and activation separation; do not edit generated ZIPs or install anything in this preparation |
| Bauzähler/rate/connection views | Physical cannon identity plus exact upload; 37 network identities | Ensure D–I rates do not collide and diagnostics remain one bridge/site; no invented total/ETA |

This is an audit inventory, not a claim all paths have been implemented/tested for
nine slots. No database migration, scheduler expansion, new station auth, CC wired
mapping, trusted telemetry producer, host handler, UI or installer is shipped here.

## Implemented preflight contract

Absent opt-in yields `{mode:'legacy', slots:['A','B','C']}`. Nonboolean supplied
opt-in is rejected. For `enabled:true` the JSON `config` requires:

- `schema:1`, exact site K01–K37, current positive integer `version`,
  `dimension:'minecraft:overworld'`, measured integer `bridge:[x,y,z]`.
- Exactly three `groups`, each with unique `id`, nonnegative integer `computerId`,
  measured `computer` and `chest` positions, explicit wired `chestName` and
  `bridgeName`, and exactly three `slots:[{slot,position}]`.
- A–I exactly once; A/B/C stay together. D–I are proposed logical slot names, NOT
  inferred existing hardware identities. All physical positions are distinct;
  each computer/cannon neighbours its own chest; no mapped cannon may also
  neighbour another group's chest. Chest names must be distinct across groups.

`observation` requires matching site/version/dimension, millisecond `at` younger
than ten seconds and not future-dated, powered/online measured bridge position,
exactly three matching group identities, native Netherite chest types and every
mapped cannon position. Per-cannon `empty` is explicit. `jobs` is an array with
unique slots/uploads and exact `file`, `sha256`, `anchor`, `size`, `options`.
Loaded observations must independently match all of those, with owner Erebor and
`aligned:true`. Only mode `[2,false,false]` is admitted by this preparatory
contract; existing mode-0 production is unchanged, not silently migrated.
An unassigned nonempty cannon blocks preparation. Jobs are returned only within
their mapped feed group, never aggregated across all nine.

The validator only checks supplied evidence consistency. Independent detection of
unmapped neighbouring consumers, shared wired namespace/reachability, actual file
hashes, all inventory accesses and trusted collection freshness still require the
native/CC/controller integration above. It cannot establish those from JSON.

CLI: `node tools/erebor-nine-preflight.js INPUT.json`, with keys `config`,
`observation`, `jobs`; invalid input exits 1. No real future mapping/example with
invented coordinates, computer IDs or peripheral names is provided. The synthetic
fixture in `test/erebor-nine-preflight.test.js` is test data only.

## Inputs after hardware is built

Operator chooses ONE pilot site. Capture its complete existing assignments first.
Collect exact dimension/positions of one shared bridge, three computers, three
Netherite chests and nine cannons; per-computer native ID/facing/label; observed
wired bridge/chest names in each computer AND bridge export namespace; token and
station identity plan without putting secrets in Git. Enumerate every adjacent
inventory consumer (including unmapped cannons), prove wired reachability using
read-only methods, verify loaded source/power/cable/target chunks, and confirm each
cannon group physically matches the intended chest. Do not derive offsets from
K01 or allocate guessed IDs. Preserve existing three machines/jobs unchanged.

## Authorized future single-site rollout / load test

1. Wait for explicit hardware-built/completion authorization. Re-fetch upstream,
   re-read all installed hashes and config, reconcile live-only telemetry/mode
   differences, then implement remaining seams and regressions before any push.
2. Capture consistent Campus backup, queue/helper/reservation ledger, existing
   force-load baseline, per-computer startup/settings/state bytes and controller/
   tracker manifests. Do not clear active jobs, counters, taints or completions.
3. Default expansion off everywhere. Enable only pilot mapping after independent
   native/CC attestation; extra six slots initially paused. No new broad force loads
   or Minecraft restart implied. Controller install and script activation need
   separate authorization and verified manifest prerequisites.
4. Compare three-cannon baseline, then six, then nine on this site only. At each
   step sample at least five minutes: actual per-upload placed deltas, TPS/MSPT,
   controller latency/timeouts/read queue, feeder lease freshness, ME power/channels,
   export deltas per chest, chest buffers, gunpowder/stock shortages and target
   loaded state. Three groups share one bridge/network; stock observations are not
   additive. Require sustained placement, not merely RUNNING flags or idle TPS.
5. Stop escalation on stale/missing identity, duplicate reservation/upload,
   cross-feed, unconfirmed job/target, lease expiry, controller backlog or sustained
   performance regression. Record actual operator-agreed performance thresholds
   against measured baseline; do not invent a capacity guarantee.
6. Exercise one-group chest/computer loss and changed peripheral/job identity with
   bounded authorized controls: only that feed must stop, no craft/export on stale
   lease, no job theft or delivery-ledger reset. Native manual Create starts are
   not prevented by a Campus material gate.
7. Disable only new dispatch on rollback, preserve active assignments and their
   completion evidence, restore owned files/mapping from backups if authorized;
   do not steal jobs, remove pre-existing chunk tickets or automatically reset
   native printers. Verify original A/B/C operation separately.

## Verification evidence

- `evidence/preflight-red.log`: actual RED for malformed opt-in/cross-group consumer.
- `evidence/preflight-green.log`: focused GREEN (22 tests).
- `evidence/node-suite.log`: full serial Node suite; rerun after final changes.
- `evidence/python-suite.log`: initial run failed on missing `lupa` (environment).
- `evidence/python-suite-with-lupa.log`: isolated scratch Python + lupa 2.8, 65 pass.
  Installer-looking messages in these logs are fixture tests in temporary local
  directories, NOT live installation/service changes.
- Python test environment: `/home/logge/.hermes/cache/scratch/erebor-nine-tests`.

No push, PR, deployment, live config/queue/world write, reload or restart performed.
