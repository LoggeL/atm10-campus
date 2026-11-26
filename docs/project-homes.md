# Shared project and area homes

Construction project homes use `projects.html`, `projects.css` and the reusable
hero/metrics/navigation/section components in `project-shell.js`. Keep new real
construction projects on this shell rather than adding independent page designs.
The existing Campus blueprint archive keeps its existing collection behavior.

A project **area** is a view of its real parent's saved plan, version and published
catalog, not a new `build_projects` record. Declare real areas in `project-areas.js`.
Index entries exist only with an active parent. The shared map uses an area's
transformed zone bounds, levels and actual retained slot positions; it does not
include the mountain envelope or its counters in an area viewport. Unavailable
geometry or catalog data remains unknown, not an empty completed project.

## Wasserstadt

- Bauprojekte → Wasserstadt: `/projects?id=erebor&area=wasserstadt`
- Bauaufträge → Bauprojekt → Wasserstadt opens that same project home.
- `/app?project=wasserstadt` and the existing `/erebor/wasserstadt` render the
  same actual shell, without redirecting to the previous standalone design.
- Erebor's hero, blueprint quick links and map controls expose the area even
  while the main map is focused on the mountain.
- Source scope: the parent's E25 Esgaroth and E26 bridge geometry and current
  architecture publications. Viewer links retain `project=erebor&room=E25|E26`.
- The six P01/P03 cards still use the unchanged session-private retained-selection
  endpoint. Physical P slots and AP catalog source keys remain distinct. P02 stays
  uncommissioned. Historical, missing, expired or failed-refresh observations never
  become current operating permission. No automatic successor allocation is added.
- The shared fleet mount refreshes status read-only and preserves expanded details.
  It performs no start, load, adoption, material or deadline mutation.

## Focused verification

Run the `project-area-view`, `project-areas`, `project-shell`, `watercity`,
`watercity-view`, `projects`, `project-coordinates`, `project-viewer`,
`asset-versions`, `alignment-ui`, `cannon-ui`, `cannon-live-ui` and
`erebor-fallback-ui` Node tests serially. Check actual desktop/mobile routes,
viewport fit, room selection, plan links, retained detail expansion and refresh
failure. A loopback rendering check with real production read-only data is not an
authenticated production browser login; record that boundary explicitly.
