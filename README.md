# ATM10 Campus

Web-App auf der HomeBox für das Campus-Redesign unseres ATM10-Servers:

- **Baupläne** (Create/Vanilla-Structure-NBT) mit Versionen: Upload, Download (einzeln oder ZIP), Wiederherstellen, Position ändern.
- **Live-Bestand**: liest alle paar Minuten die Region-Files der Welt (read-only) und erzeugt einen Snapshot des Campus-Ausschnitts, aber nur, wenn der Server gespeichert hat.
- **Konfliktanalyse** je Bauplan gegen Live: Fortschritt, Maschinen/Block-Entities im Weg, seit Planung geänderte Zellen, Überlappungen zwischen Bauplänen, Bearbeitungskonflikte (409 bei veralteter `baseVersion`).
- **3D-Viewer** (`/viewer`, three.js): texturierte Voxel-Chunks (Greedy-Meshing + Ambient Occlusion im Web-Worker), Tageszeit mit Sonnenschatten, leuchtende Lampen (Bloom), Orbit/Fliegen/Laufen mit Kollision, Höhenschnitt, Tooltip je Block.
  Kombinierbare Ebenen (Bestand, Abriss, Gebaut, Noch setzen, Ersetzen, Maschine im Weg, Seit Planung geändert, Überlappung) mit Modus je Ebene (Echt / Farbe / Geist / Gedimmt / Aus) und Presets wie „Noch zu bauen“ oder „Konflikte“.
- **Agent-Bearbeitung**: Baupläne blockgenau per Operationen ändern (`set`, `fill`, `replace`, `clear`, `void`, `copy`, mit `dryRun`-Vorschau und Analyse), als ASCII-Schichten oder JSON lesen, echten Bestand abfragen.
- **Login per Einladung**, persönliche **API-Tokens** für Agents (`/docs`, `/api/openapi.json`).

## Viewer-Assets

Die Materialtexturen und das Titelbild sind mit Codex (imagegen) erzeugt; Quellen und Prompts liegen in `assets-src/` (`PROMPTS.md`).
`python3 tools/build-textures.py` (Pillow) macht daraus `public/viewer/textures/*.png` (64 px, kachelbar, Graustufen) und `public/viewer/hero.webp`.
Die Blockfarben stammen aus den Mod-Jars (`tools/extract-texture-colors.py` → `src/data-texture-colors.json.gz`) und färben die Texturen je Block ein.

Die **Materialliste** hat zusätzlich eine bebilderte HTML-Ansicht (`/api/materials?format=html`, auch pro Bauplan).
Sie zeigt die exakte Item-ID, Connecting-Variante, Mengen und den Zeitstand von Weltaufnahme/ME-Bestand.
JSON (Standard), Text und CSV bleiben unverändert verfügbar. Unbekannte Materialien bleiben lesbar und erhalten ein neutrales Platzhalterbild.

Die 32 Materialbilder unter `public/assets/material-icons/` sind aus den tatsächlichen Item-Modellen und Texturen von Minecraft 1.21.1, Rechiseled 1.2.6, Rechiseled Create 1.1.1, Create 6.0.10, Chipped 4.0.2 und Connected Glass 1.1.14 gerendert.
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

## Neue Version von Jonnys HTML

Als Admin unter **Admin → Campus-HTML importieren**. Geänderte NBTs werden neue Versionen. Was seit dem letzten Import in der App geändert wurde, wird nicht überschrieben und als Konflikt gemeldet.
