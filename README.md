# ATM10 Campus

Web-App auf der HomeBox für das Campus-Redesign unseres ATM10-Servers:

- **Baupläne** (Create/Vanilla-Structure-NBT) mit Versionen: Upload, Download (einzeln oder ZIP), Wiederherstellen, Position ändern.
- **Live-Bestand**: liest alle paar Minuten die Region-Files der Welt (read-only) und erzeugt einen Snapshot des Campus-Ausschnitts, aber nur, wenn der Server gespeichert hat.
- **Konfliktanalyse** je Bauplan gegen Live: Fortschritt, Maschinen/Block-Entities im Weg, seit Planung geänderte Zellen, Überlappungen zwischen Bauplänen, Bearbeitungskonflikte (409 bei veralteter `baseVersion`).
- **3D-Viewer** (`/viewer`, three.js): texturierte Voxel-Chunks (Greedy-Meshing + Ambient Occlusion im Web-Worker), Tageszeit mit Sonnenschatten, leuchtende Lampen (Bloom), Orbit/Fliegen/Laufen mit Kollision, Höhenschnitt, Tooltip je Block.
  Kombinierbare Ebenen (Bestand, Abriss, Gebaut, Noch setzen, Ersetzen, Maschine im Weg, Seit Planung geändert, Überlappung) mit Modus je Ebene (Echt / Farbe / Geist / Gedimmt / Aus) und Presets wie „Noch zu bauen“ oder „Konflikte“.
- **Agent-Bearbeitung**: Baupläne blockgenau per Operationen ändern (`set`, `fill`, `replace`, `clear`, `void`, `copy`, mit `dryRun`-Vorschau und Analyse), als ASCII-Schichten oder JSON lesen, echten Bestand abfragen.
- **Login per Einladung**, persönliche **API-Tokens** für Agents (`/docs`, `/api/openapi.json`).
- **Schematics direkt in die Kanone**: Rest-Plan mit Bauplan-Zielkoordinaten und Kanonen-Einstellungen automatisch vorbereiten, neue Versionen bei vollständigem Stopp übernehmen. Der Bau startet mit Play an der Kanone.

## Viewer-Assets

Die Materialtexturen und das Titelbild sind mit Codex (imagegen) erzeugt; Quellen und Prompts liegen in `assets-src/` (`PROMPTS.md`).
`python3 tools/build-textures.py` (Pillow) macht daraus `public/viewer/textures/*.png` (64 px, kachelbar, Graustufen) und `public/viewer/hero.webp`.
Die Blockfarben stammen aus den Mod-Jars (`tools/extract-texture-colors.py` → `src/data-texture-colors.json.gz`) und färben die Texturen je Block ein.

Die **Materialliste** hat zusätzlich eine bebilderte HTML-Ansicht (`/api/materials?format=html`, auch pro Bauplan).
Sie zeigt die exakte Item-ID, Connecting-Variante, Mengen und den Zeitstand von Weltaufnahme/ME-Bestand.
JSON (Standard), Text und CSV bleiben unverändert verfügbar. Unbekannte Materialien bleiben lesbar und erhalten ein neutrales Platzhalterbild.

Die 34 Materialbilder unter `public/assets/material-icons/` sind aus den tatsächlichen Item-Modellen und Texturen von Minecraft 1.21.1, Rechiseled 1.2.6, Rechiseled Create 1.1.1, Create 6.0.10, Chipped 4.0.2 und Connected Glass 1.1.14 gerendert.

Unter `/app#coordinates` stehen die Einsetzkoordinaten aller aktuellen Baupläne mit einzeln kopierbaren X-/Y-/Z-Werten und TXT-Export. Die Bauplan-Details zeigen denselben Anker; Kanonen zeigen ausdrücklich den Anker ihrer zugewiesenen Version, auch wenn eine neuere existiert. Drehung 0°, keine Spiegelung.
Connecting zeigt jeweils einen einzelnen, noch nicht mit Nachbarblöcken verbundenen Block. Die Texturen stammen von Mojang und den jeweiligen Mod-Autoren; es sind keine generierten Ersatztexturen.
Zum Aktualisieren `tools/material-items.json` ergänzen und mit Pillow ausführen:

```bash
python tools/build-material-icons.py --minecraft /pfad/1.21.1.jar --mods /pfad/zur/ATM10-Instanz/mods
```

Der Server benötigt die Jars nicht. Es werden nur die kleinen PNGs und das erzeugte Namens-/Variantenverzeichnis ausgeliefert.

## Lokal

```bash
npm install
npm test
DATA_DIR=./data WORLD_DIR=/pfad/zur/world BOOTSTRAP_INVITE=irgendein-langer-code npm start
# dann http://localhost:3000/invite/irgendein-langer-code → Admin anlegen
```

## Konfiguration (Env)

| Variable | Default | |
|---|---|---|
| `DATA_DIR` | `/data` (Docker) | SQLite, NBT-Versionen, Snapshots, Viewer-Template |
| `WORLD_DIR` | `/worlds/live` | Live-Welt (Container läuft als nobody → nur lesbar) |
| `WORLD_SOURCES` | – | weitere Welten für Baselines: `name=/pfad;name2=/pfad2` |
| `CONTEXT_ORIGIN` / `CONTEXT_SIZE` | `-64,48,-96` / `288,272,320` | Campus-Ausschnitt (wie Jonnys Export) |
| `SNAPSHOT_INTERVAL_MIN` | `10` | 0 = aus |
| `BOOTSTRAP_INVITE` | – | Einladungscode für den ersten Admin, nur gültig solange es keine Accounts gibt |
| `PUBLIC_URL` | – | für Einladungslinks |
| `SEED_BASELINE_SOURCE` / `SEED_BASELINE_LABEL` | – | beim ersten Start angepinnter Planungsstand aus dieser Weltquelle |
| `SEED_HTML` | – | beim ersten Start importierte Viewer-HTML (Planungsstand = Baseline) |

## Deploy

Dokploy-App `atm10-campus` (Dockerfile, Auto-Deploy bei Push auf `main`), Domain `campus.logge.top`.
Mounts: Volume `atm10-campus-data` → `/data`, Bind `~/minecraft/atm10/data/world` → `/worlds/live`, Bind `~/minecraft/atm10-backup-20261021/world` → `/worlds/backup-20261021`, Bind `~/atm10-campus-seed` → `/seed`.

## Automatische Schematic-Vorbereitung (Create 1.21.1-6.0.10)

Im Kanonen-Tab den Bauplan zuweisen und unter „Ausrichtung“ als Browser-Admin den physischen Kanonen-Block prüfen und bestätigen. Danach „Schematic automatisch vorbereiten“ aktivieren. Die App überträgt den Rest-Plan mit den Zielkoordinaten der Bauplanversion und den gewählten Ersetzungs-/Material-/Maschinenschutz-Einstellungen. „Zielkoordinaten ändern“ öffnet den Bauplan; eine Positionsänderung wird als neue Version gespeichert. Ausrichtung und Spiegelung entsprechen der NBT. Automatische Rest-Pläne verwenden den Live-Bestand der Oberwelt.

Die bestehende signierte Controller-Anbindung wird um `/campus/prepare` erweitert. Neben `campus_cannon.py` müssen `controller/campus_schematic.py` und `controller/campus_snbt.py` neben dem vorhandenen `control.py` auf dem Host liegen. Danach nur den Controller-Service neu starten. Die bisherigen Bridge-Adresse, Signatur und Block-Registry werden weiterverwendet; ein zusätzlicher Worker oder Station-Token ist nicht erforderlich. Details zur Host-Anbindung stehen in `docs/cannon-alignment.md`.

Jeder Auftrag friert Rest-NBT, SHA256, Version, Live-Snapshot, Ziel und Einstellungen ein. Neue Planversionen werden bei aktivierter Versionsübernahme vorgemerkt und alle zehn Sekunden erneut versucht. Ein anderer Live-Snapshot allein unterbricht keinen Bau. „Rest-Plan neu vorbereiten“ erzeugt einen Auftrag aus dem neuesten vorhandenen Snapshot. Die Materialfreigabe bleibt bis zur bestätigten Übergabe gesperrt und prüft anschließend auch die Kanonen-Einstellungen live. Der CC-Versorger 1.2.0 lädt sich über sein vorhandenes Auto-Update nach.

Die Brücke verlangt `STOPPED`, Null-Zähler, leere `FlyingBlocks` und einen uninitialisierten Drucker. Kurze Befehle bereiten Inventar und Einstellungen in temporärem Command-Storage vor. Der abschließende einzelne Server-Befehl prüft Blocktyp, Zustand, Zähler und das zuvor gelesene Inventar erneut. Laufende oder pausierte Kanonen werden nicht verändert. Manuelle Schematics im Eingang müssen zuerst entfernt werden. Vorhandene Campus-Schematics werden neu beschrieben, leere Schematics im Ausgabefach wiederverwendet. Ist keine Vorlage vorhanden, erstellt die Brücke ein Campus-Schematic. Andere Inventarslots und ihre NBT-Typen bleiben erhalten. Der vorherige Kanonenzustand liegt unter `discord/campus-schematic-backups`. Der Modus zum Leerräumen wird bei den dünn besetzten Rest-Plänen nicht angeboten. Play startet den Bau im Spiel.

Prüfen: `LOG_LEVEL=silent npm test`, `python3 test/bridge_test.py`, `python3 test/controller_alignment_test.py` auf dem Controller-Host sowie `uv run --with lupa python test/feeder_alignment_test.py`.

## Neue Version von Jonnys HTML

Als Admin unter **Admin → Campus-HTML importieren**. Geänderte NBTs werden neue Versionen. Was seit dem letzten Import in der App geändert wurde, wird nicht überschrieben und als Konflikt gemeldet.
