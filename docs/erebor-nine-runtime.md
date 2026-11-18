# Nine-cannon runtime: bounded observation increment

This is **not nine-cannon activation**. The offline `ninePreflight` remains
`prepared-only`, and no scheduler, material lease, feeder identity or target
lease is created by this increment.

## Working controller path

The existing authenticated `POST /campus/erebor-inspect` accepts K01D–K37I
**only when explicitly mapped** in `erebor-observers.json` beside
`campus_erebor.py`. The checked-in `.example.json` maps only the six physically
verified K12 additions. It is not loaded automatically and installers are not
modified to copy it fleet-wide.

Requests retain the existing HMAC, nonce, origin, paused-server and serialized
controller-lock checks. Body: `{"version":12,"site":"K12D"}`. Response:
`{"observerOnly":true,"observed":{...}}`, with the native cannon's own
`at`, `state`, `amountPlaced`, `amountToPlace`, fuel, input, printer and options.
Unknown/unmapped sites fail closed. `erebor-prepare`, `erebor-start` and
`erebor-supply` reject D–I before touching Minecraft or reading opt-in config.
No arbitrary coordinates or console commands are accepted from callers.

The complete optional map is validated before any new inspection: exact schema,
current survey version, explicit observe-only mode, unique sites and computers,
unchanged main/bridge, disjoint physical positions (including all existing A/B/C
hardware), independent local chest adjacency, exact D/E/F and G/H/I groups and
no cross-group cannon/chest adjacency. Computer IDs identify the map; this path
does **not** claim a fresh physical computer/chest/export proof or supply lease.
A/B/C inspection deliberately does not depend on the optional file's validity.

## Deployment boundaries

Back up and hash-check the installed module against its reviewed predecessor,
validate the optional map against installed survey files, replace only that
module plus the K12-only optional file, and restart only the existing
`systemctl --user restart atm10-control.service`. No Minecraft restart, KubeJS
reload, chunk ticket, cannon-mode edit, feed test or queue mutation is necessary.
Read back exact installed bytes and exercise the signed HTTP path, unsigned
rejection and unmapped K24D rejection. Keep the signed body and secrets private.

The Campus app and KubeJS tracker do not gain D–I scheduling from this change.
A controller-only deployment does not imply the Campus app is on this commit.
Pull inspection counters are not the persisted tracker or a sustained placement
proof. Native `placed > total` must not be rendered as a trustworthy percentage.

## Remaining activation blocker

A safe prepare/start path must be integrated together with:

1. Fresh D–I tracker upload/anchor/options/finish observations and supported
   target leases; preserve the installed AE2/network telemetry and legacy modes.
2. Persisted group-specific feeder registration/auth for #50 and #51, exact
   local `back` bridge / `front` chest proofs, short fail-closed per-group material
   leases, aggregate export caps and no stock summation across the shared ME.
3. Atomic queue/helper/Massiv arbitration across all nine physical slots,
   preserved active reservations, full target reachability/protection checks,
   existing stone-only global phase and independently reconciled completions.
4. Independently labelled A–I UI with unknown/stale states and runtime capability
   gates. Enable **only K12** after end-to-end fixtures and signed readbacks;
   prove actual new-upload placement deltas before claiming activation.

Do not relax the existing B/C regex or redirect six cannons to the original
A/B/C chest to work around these missing integrations. K24 and all other sites
remain untouched. The requested future 19-station installation is not a batch
activation instruction; retain the original “über 200 Blöcke” wording without
inventing a different geometric constraint.

## Regression checks

- `python -m unittest discover -s test -p erebor_observer_test.py`
- `python -m unittest discover -s test -p '*_test.py'` (requires `lupa`)
- `node --test --test-concurrency=1 test/*.test.js`
