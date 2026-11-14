# Connection / power diagnostics

The existing signed `erebor-live` read route now transports `network` telemetry.
The installed KubeJS tracker samples the 37 surveyed ME Bridge positions and
three fixed power-chain observation positions every 240 ticks (about 12 seconds
at 20 TPS). It tests `level.hasChunk` before reading block entities. The new
telemetry path neither changes energy nor adds tickets; existing native cannon
target leases are unchanged. It does not discover or relocate moved devices.

`GET /api/cannons` includes `network` for Erebor stations. The authenticated
Dreierbetrieb HTML and `?format=json` expose all 37 diagnostics. No new privileged
API or arbitrary coordinates/commands are accepted. Browser and fleet views
share the fault renderer; computer-online, ME-online, powered, channel availability,
booting, missing reports and stale diagnostics are distinct states. Taints and
assignment safety gates are not cleared or overridden. Missing telemetry on an
older controller is unknown, never implicitly powerless. Network data older than
45 seconds is not presented as a current power measurement. Fleet page polls
read-only every 15 seconds and displays failures rather than retaining a healthy
banner. The main cannon view retains editable forms during fault refreshes.

Deploy the matching tracker via the included shared-v4 host archive or a guarded
backup/atomic replacement. Reload only `kubejs reload server-scripts`; do not
restart Minecraft. The archive manifest accepts the prior shared-v4 tracker hash.

## Read-only finding (2026-11-14)

A repeated server-thread probe found all 37 bridges loaded, offline and without
power (0 AE); at the repeat their channel requirements were also unsatisfied.
All 37 wireless links remained paired. Delivery and the separate P2P transport
grid had no power, while the external base storage grid was powered. The normal
base controller at 70/66/32 independently passed its online block-state test.
The energy acceptor at -367/316/-9998 is fed by the adjacent Flux Point at
-368/316/-9998 on network 399700002. That network's only Plug is at -46/62/69;
native loaded queries and block reads prove that source chunk [-3,4] is unloaded.
No vanilla force ticket exists there; vanilla output alone does not enumerate
FTB tickets.

Saved region NBT (not live state) identifies the Plug above a Flux Controller and
below a Draconic Evolution energy pylon at -46/63/69. Its linked storage core is
at -39/64/76, also chunk [-3,4], with a saved active tier-8 state and stored energy
1018757041374745 FE. This is a stored-energy export chain, not proof of a broken
reactor/generator. Present storage and pylon mode cannot be measured while the
chunk is unloaded. No loading, power injection or taint reset was performed.
Restoring source loading requires separate approval, then live re-verification
of the complete storage/pylon/Flux/transport/delivery chain and channel recovery.
