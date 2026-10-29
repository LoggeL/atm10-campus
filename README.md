# ATM10 Campus

Web-App auf der HomeBox für das Campus-Redesign unseres ATM10-Servers:

- **Baupläne** (Create/Vanilla-Structure-NBT) mit Versionen: Upload, Download (einzeln oder ZIP), Wiederherstellen, Position ändern.
- **Live-Bestand**: liest alle paar Minuten die Region-Files der Welt (read-only) und erzeugt einen Snapshot des Campus-Ausschnitts, aber nur, wenn der Server gespeichert hat.
- **Konfliktanalyse** je Bauplan gegen Live: Fortschritt, Maschinen/Block-Entities im Weg, seit Planung geänderte Zellen, Überlappungen zwischen Bauplänen, Bearbeitungskonflikte (409 bei veralteter `baseVersion`).
- **3D-Viewer**: Jonnys Viewer, importiert aus seiner HTML. Er lädt die Baupläne aus der Datenbank und den Bestand live.
- **Login per Einladung**, persönliche **API-Tokens** für Agents (`/docs`, `/api/openapi.json`).

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
| `WORLD_DIR` | `/minecraft/atm10/data/world` | Live-Welt, read-only gemountet |
| `WORLD_SOURCES` | – | weitere Welten für Baselines: `name=/pfad;name2=/pfad2` |
| `CONTEXT_ORIGIN` / `CONTEXT_SIZE` | `-64,48,-96` / `288,272,320` | Campus-Ausschnitt (wie Jonnys Export) |
| `SNAPSHOT_INTERVAL_MIN` | `10` | 0 = aus |
| `BOOTSTRAP_INVITE` | – | Einladungscode für den ersten Admin, nur gültig solange es keine Accounts gibt |
| `PUBLIC_URL` | – | für Einladungslinks |

## Deploy

Dokploy-App `atm10-campus` (Dockerfile, Auto-Deploy bei Push auf `main`), Domain `campus.logge.top`.
Mounts: Volume `atm10-campus-data` → `/data`, Bind `/home/logge/minecraft` → `/minecraft` (read-only).

## Neue Version von Jonnys HTML

Als Admin unter **Admin → Campus-HTML importieren**. Geänderte NBTs werden neue Versionen. Was seit dem letzten Import in der App geändert wurde, wird nicht überschrieben und als Konflikt gemeldet.
