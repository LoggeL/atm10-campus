# Wasserstadt

The continuous dispatcher for P01–P03 uses E25 and E26 tiles and runs on the
Minecraft Homebox. As the Docker-enabled user who runs the existing controller:

```sh
curl -fSsL https://campus.logge.top/assets/wasserstadt-dauerbetrieb.pyz -o "$HOME/wasserstadt-dauerbetrieb.pyz" &&
python3 "$HOME/wasserstadt-dauerbetrieb.pyz" --install
```

The installer prompts for the Campus write token if one has not been supplied.
The service is `campus-wasserstadt.service` under `systemctl --user`.
The Campus fleet page shows the latest receipt for each slot. Authenticated
`GET /api/projects/erebor/wasserstadt/betrieb` includes assignment history.
The separate `/weltstand` endpoint reads native counters with per-chunk save times.

## Legacy fleet view

The login-protected **Wasserstadt** main-menu item opens `/erebor/wasserstadt`.
Its session-only, no-store GET is `/api/projects/erebor/wasserstadt`.
This is a complete **read-only presentation/adoption** of the six commissioned
P01/P03 slots, not general-purpose dispatch, completion reconciliation or a new
material authority. Automatic next-job allocation is **not implemented**.

## Persistence and identity

`src/watercity.js` reads the existing `erebor_selections` records containing
`job.watercity`. It preserves their IDs, AP source-site keys, `waiting`/`loaded`
status, uploads, native loaded/started receipts and scheduler exclusions. It
creates no rows, schema or writes. A duplicate slot/upload, changed physical
mapping, foreign project version or incomplete metadata is a visible conflict,
not an instruction to queue, start, release or close work. P02 is separately
shown as not commissioned; it is not counted as an active builder. Physical
hardware/checklist details remain in the independent private Aufstellung page.

## Measured data and expiry

`controller/campus_watercity.py` attaches an optional `watercity` object to the
existing HMAC-authenticated `erebor-live` report. It reads only fixed existing
`data/kubejs/config/watercity-active.json`, `watercity-live.json`, and the two
commissioned CC supply-report paths. No arbitrary path, RCON, controller lock,
world mutation, chunk loading, ticket renewal, supply permission or crafting is
introduced. The usual paused-server/authentication/nonce gates stay in place.
Malformed, oversized, stale or missing optional files leave legacy Erebor data
available and Watercity unknown. Existing app mounts/environment are sufficient;
the world mount does **not** expose its sibling KubeJS directory, hence the
controller-side read instead of assuming that path exists inside the app.

The API independently joins the retained reservation to the manifest's selection
ID, project version, batch, expiry, blueprint, hash and upload; it checks the
native position, owner, exact anchor, bounds, rotation, mirror and safe options.
Each card has its own native placed/total/state/status/time. A zero or invalid
native total is unknown, never replaced by plan block totals. Plan workloads are
explicitly gross metadata, not an exact remaining-world denominator.

Native freshness expires at 45 seconds, on HTTP/auth failure, or at the existing
fixed permission deadline. Client-side checks continue even if requests stop.
A persisted native snapshot is always labelled historical. CC stock reports have
their own observation time and never prove native progress or current permission;
shared ME counts are not added. The protected 500-item reserve is unchanged.
Nothing here extends the Minecraft-first permission deadline or short CC leases.

## Scoped controller installation

The source controller includes the optional wrapper. Existing installations may
have additional controller wrappers not identical to repository source: **do not
replace their whole module**. Discover its exact bytes and preserve all of them:

```sh
sha256sum /verified/controller/directory/campus_erebor.py
python3 tools/install-watercity-read.py \
  --controller-dir /verified/controller/directory \
  --expected-erebor-sha256 EXACT_DISCOVERED_HASH
# After reviewing the dry-run hashes, repeat with --apply.
# Restart ONLY the existing user controller service, never Minecraft.
```

The installer defaults to no writes, refuses unexpected hashes/existing hooks,
backs up the complete original and appends only the read wrapper. After a user
controller restart, poll a signed read report for bounded socket readiness rather
than treating `systemctl is-active` as HTTP proof. Verify the installed module
hash and original-prefix-plus-hook hash, unchanged Minecraft StartedAt, legacy
station data, and all six matching native uploads.

## Rollback and verification

Roll back only the app revision via its normal GitHub/Dokploy deployment and/or
restore the exact controller module backup, archive the new reader and restart
only that user controller. Preserve active cannon inputs, original selections,
clear receipts, leases, tickets, mounts, environment and private placement file.
Never restore a whole live database over concurrent fleet activity.

Focused regressions: `test/watercity*.test.js`, `test/watercity_read_test.py`.
Check anonymous page redirect/API 401, member-session rendering/no-store,
forbidden mutation route, exact six retained IDs and unchanged DB changes,
independent counters, stale/future/expired/mismatched telemetry, missing totals,
malformed optional reports, XSS escaping, mobile cards and menu discovery.
Distinguish an actual authenticated production browser test from a local render
of independently captured signed native data when browser credentials are absent.
