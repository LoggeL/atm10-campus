# Bildprompts für den ATM10-Campus-Viewer

## Erzeugung und Prüfung

Alle 19 Bilder wurden mit dem eingebauten `image_gen`-Tool nach dem Skill `imagegen` erzeugt. Pro Datei gab es genau einen Aufruf, insgesamt 19. Kein CLI-Fallback, keine Referenzbilder, `transparent_background: false` bei allen Aufrufen. Die folgenden Promptblöcke enthalten den jeweils vollständig übergebenen Prompt.

Die Originalausgaben wurden unverändert als PNG an die angegebenen Pfade kopiert und per SHA-256 mit der jeweiligen Quelldatei verglichen. Alle 19 Dateien lassen sich vollständig dekodieren. Alle Motive wurden visuell geprüft.

**Technischer Prüfstatus: Die Texturen erfüllen die exakten Produktionsvorgaben noch nicht.** Alle 18 Texturen wurden trotz der Promptvorgaben mit 1254×1254 Pixeln ausgegeben. Das sichtbare Pixelraster ist feiner als 32×32 Zellen; es sind außerdem geringe Farbabweichungen von neutralem Grau vorhanden. Gegenüberliegende Bildkanten sind bei keiner Textur pixelgleich. Einige Helligkeitswerte liegen außerhalb der vorgesehenen Bereiche. Die schwarzen Flächen in `leaves.png` und `plant.png` sind noch nicht durchgängig auf reines Schwarz normalisiert. Eine lokale technische Normalisierung wurde angefragt, aber noch nicht freigegeben und nicht durchgeführt.

Das Titelbild liegt in der geforderten Größe 1536×1024 vor. Die Sichtprüfung zeigt den Voxel-Campus mit Glastürmen, beleuchteter Halle, Maschinenhöfen, Bäumen, cyanfarbenen Akzenten und warmen Fenstern. Das linke Drittel ist deutlich ruhiger und dunkler. Keine sichtbaren Texte oder Logos.

## `assets-src/textures/stone.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Rough natural stone, irregular mottled mineral patches and a few fine cracks, expressed only with coarse square pixels.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/cobble.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Cobblestone masonry of irregular rounded stones with dark joints. Several varied interlocking stones, chunky stepped silhouettes, subtle light and dark stone facets.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/bricks.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Small rectangular masonry bricks in running bond, EXACTLY FOUR horizontal rows, clear mortar joints. Alternate rows offset by half a brick. Each row occupies eight logical pixels including its joint.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/tiles.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Large polished stone floor tiles in an EXACT 2 x 2 arrangement. Each tile is 16 x 16 logical pixels including its joint. Slightly beveled edges using single-pixel light and dark strips; broad quiet tile interiors.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/smooth.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: A smooth polished quartz/concrete block surface, very subtle low-contrast structure and a discreet narrow material edge. The edge is a texture seam that tiles seamlessly, not a decorative picture frame.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/planks.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Horizontal wooden planks, EXACTLY FOUR boards spanning the width. Each board is eight logical pixels high including its seam. Clearly readable horizontal wood grain and small nail holes, all in neutral grayscale.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/log.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Vertical tree bark with deep irregular vertical furrows and broad coarse bark ridges. No cut end or tree rings, only bark.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/leaves.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Dense foliage of many small overlapping leaves with coarse angular leaf silhouettes and a few internal highlight pixels. Gaps between leaves MUST be pure black #000000 (R=G=B=0), an explicit exception to the 35%-85% brightness range. Leaves themselves remain neutral gray. No transparency.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/dirt.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Earth/soil with small scattered pebbles, irregular clods and restrained chunky granular brightness variation.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/grass.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: A dense grass lawn seen directly from above, closely packed short grass blades in varied stepped pixel clusters. A full covering texture, with no bare background, no side view and no horizon.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/sand.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Grainy sand/gravel, mostly fine clusters at the single-logical-pixel scale and a few larger grains, low-contrast neutral gray.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/metal.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: A flat metal plate with a rivet near each of the four corners and a subtly brushed horizontal surface. Corner rivets must remain legible on the coarse 32 x 32 logical grid. No outer border.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/machine.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: A flat technology machine panel with ventilation slits, a small blank display area, screws and a cable channel. Arrange recognizable compact components inside the tile. Everything is coarse pixel art and neutral grayscale, including the screen; no letters, numerals or symbols.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/crystal.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Faceted crystals and gemstone inclusions embedded in stone. Several sharply angular stepped crystal shapes with distinct light and dark facets against rough rock, entirely grayscale.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/wool.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Coarse wool/fabric weave with clearly interlaced chunky threads and small repeating loops, flat and evenly distributed. No cloth folds or drapery.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/water.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Water surface seen from directly above with gentle wave lines, made of restrained coarse stepped light-gray ripple bands. Flat seamless material map, no horizon, reflections of objects, foam, or scene.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/lamp.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: A luminous panel with a bright center and a regular grid structure. EXCEPTION to the common brightness range: use very bright neutral grays and white, 70%-100% brightness (179-255). Render the light as flat pixel brightness steps, no blurry bloom. The panel grid repeats seamlessly.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/textures/plant.png`

```text
Use case: stylized-concept
Asset type: one production-ready seamless voxel-game material texture, original pixel art, PNG.
Canvas: exactly 1024 x 1024 pixels, square, opaque, full bleed.
Pixel construction: EXACTLY 32 columns by 32 rows of large square logical pixels, each logical pixel exactly 32 x 32 output pixels, uniformly one solid color per cell. Every feature aligns to this coarse 32 x 32 grid. Crisp hard stair-step edges; no anti-aliasing, blur, gradients inside cells, fine raster noise, outlines smaller than a logical pixel, or visible grid overlay.
View: perfectly flat frontal orthographic texture; no perspective, 3D block, cast shadows, vignette, outer frame, margin, text, logo, watermark or branding.
Palette: strictly neutral desaturated light grayscale, R=G=B, brightness approximately 35%-85% (89-217). Color will be applied later by the renderer, so communicate the material using brightness only. Use a restrained grayscale palette.
Tiling: seamless periodic texture in BOTH directions. Left and right edges match exactly; top and bottom edges match exactly. Features crossing an edge continue at the opposite edge. Distribute detail evenly and fill the whole image edge to edge.
Subject: Small tufts of grass and small flowers SEEN FROM THE SIDE, with stems, blades and simple blossoms clearly readable on the coarse grid. Arrange several tufts naturally across the tile. Background MUST be pure black #000000 (R=G=B=0), an explicit exception to the 35%-85% brightness range. Plants and flowers remain neutral grayscale; opaque black background, no transparency. Keep top and bottom edges black, with consistent black side edges, so the tile repeats cleanly.
Deliver exactly one texture image; no contact sheet, no comparison panel, no scene mockup.
```

## `assets-src/hero.png`

```text
Use case: stylized-concept
Asset type: cinematic title/hero image for a futuristic voxel-campus viewer.
Canvas: exactly 1536 x 1024 pixels, landscape 3:2, opaque PNG.
Primary request: an original futuristic campus built from blocks, seen in an isometric bird's-eye view, in atmospheric evening twilight.
Architecture and environment: slender towers with glass facades, a hall with a glowing glass floor clearly visible through its glazing, paths with embedded lights, machine yards and a few block-built trees. All buildings, terrain and machines share a coherent sophisticated voxel geometry.
Composition: keep the LEFT THIRD of the image quiet and darker, with low-detail dark ground and sky suitable for a later UI overlay. Concentrate the illuminated campus buildings in the center and right. Compose the full campus as a cinematic scene, not an isolated floating model. Show the isometric aerial campus and a deep blue twilight sky with the first faint stars above it.
Lighting and palette: deep blue twilight, cyan accent lighting in #73d8e5, warm window light, atmospheric depth and restrained cinematic glow.
Style: polished, high-quality stylized voxel architectural illustration, detailed block forms, elegant glass facades, cinematic atmosphere.
Constraints: no text, no lettering, no logos, no watermark, no branding, no recognizable game characters. Generate exactly one finished image, no collage, no UI elements.
```

## Nachbearbeitung (erledigt)

Die oben genannten technischen Abweichungen (Größe, Raster, Graustufen, Kanten, Schwarz bei Laub/Pflanzen) behebt `tools/build-textures.py` beim Erzeugen der Viewer-Assets: Verkleinern auf 64×64, Umwandeln in Graustufen, Überblenden der Kanten zu kachelbaren Texturen, Alpha-Schnitt für `leaves`/`plant`. Die Helligkeit normalisiert `public/viewer/atlas.js` im Browser. Die Originale hier bleiben unverändert.
