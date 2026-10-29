# Bildauftrag für den ATM10-Campus-Viewer (Codex imagegen)

Nutze den Skill **imagegen** (eingebautes `image_gen`-Tool, kein CLI-Fallback). Pro Asset genau ein `image_gen`-Aufruf.
Kopiere jedes finale Bild in dieses Repo unter dem angegebenen Pfad (PNG). Nichts anderes im Repo ändern.
Schreibe am Ende `assets-src/PROMPTS.md` mit dem finalen Prompt je Datei.

## A) Material-Texturen (18 Stück) → `assets-src/textures/<name>.png`

Gemeinsame Vorgaben für ALLE Texturen (in jeden Prompt übernehmen):
- Quadratisch, 1024×1024, **nahtlos kachelbar** (linke/rechte und obere/untere Kante passen exakt zusammen).
- Original-Pixel-Art im Voxel-Spiel-Stil: sichtbares Raster aus genau **32×32 großen Pixeln**, harte Kanten, kein Anti-Aliasing, kein Rauschen zwischen den Pixeln.
- Frontal, flach, keine Perspektive, keine Schlagschatten, kein Rahmen, kein Text, kein Logo.
- **Neutrale, entsättigte hellgraue Palette** (Werte ca. 35–85 % Helligkeit). Die Textur wird später pro Block eingefärbt. Nur Helligkeitsdetails zählen.
- Füllt das ganze Bild randlos aus.

| Datei | Motiv |
|---|---|
| stone.png | rauer Naturstein, unregelmäßige Flecken und feine Risse |
| cobble.png | Kopfsteinpflaster aus unregelmäßigen, abgerundeten Steinen mit dunklen Fugen |
| bricks.png | kleine rechteckige Ziegel im Läuferverband mit klaren Fugen, 4 Reihen |
| tiles.png | große polierte Steinfliesen 2×2 mit leicht abgeschrägten Kanten |
| smooth.png | glatter polierter Block mit sehr subtiler Struktur und dezentem Rand (Quarz/Beton-Look) |
| planks.png | horizontale Holzdielen, 4 Bretter, Maserung, Nagellöcher |
| log.png | senkrechte Baumrinde mit tiefen Furchen |
| leaves.png | dichtes Laub aus kleinen Blättern; Lücken zwischen Blättern **rein schwarz** (#000) |
| dirt.png | Erde mit kleinen Steinchen |
| grass.png | Grasdecke von oben, dichte Halme |
| sand.png | Sand/Kies, körnig, ein paar größere Körner |
| metal.png | Metallplatte mit Nieten an den Ecken und gebürsteter Oberfläche |
| machine.png | Tech-Maschinenpanel: Lüftungsschlitze, kleine Bildschirmfläche, Schrauben, Kabelkanal |
| crystal.png | facettierte Kristalle/Edelstein-Einschlüsse in Gestein |
| wool.png | grobes Woll-/Stoffgewebe |
| water.png | Wasseroberfläche mit sanften Wellenlinien |
| lamp.png | Leuchtpanel: helles Zentrum, Gitterstruktur, sehr hell (Werte 70–100 %) |
| plant.png | Grasbüschel und kleine Blüten von der Seite; Hintergrund **rein schwarz** (#000) |

## B) Titelbild → `assets-src/hero.png`

1536×1024 (Querformat). Cinematic, atmosphärische Abendstimmung: ein futuristischer Voxel-Campus aus Blöcken in isometrischer Vogelperspektive.
Schlanke Türme mit Glasfassaden, eine Halle mit leuchtendem Glasboden, Wege mit eingelassenen Lichtern, Maschinenhöfe, ein paar Bäume.
Tiefblauer Dämmerungshimmel mit ersten Sternen, cyanfarbene (#73d8e5) Akzentlichter, warmes Fensterlicht.
Stilisiert, hochwertig, kein Text, keine Logos, keine bekannten Spielfiguren und kein Branding. Linkes Drittel ruhiger/dunkler (dort liegt später UI).
