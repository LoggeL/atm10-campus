# ATM10 Campus

Web-App auf der HomeBox für das Campus-Redesign unseres ATM10-Servers:

- **Baupläne** (Create/Vanilla-Structure-NBT) mit Versionen: Upload, Download (einzeln oder ZIP), Wiederherstellen, Position ändern.
- **Bauplan-Vorschauen** aus den tatsächlichen NBT-Blöcken: als Bild in Bauplan- und Koordinatenlisten, Details, Kanonenkarten und Viewer-Auswahl. Kanonen zeigen die zugewiesene Version.
- **Live-Bestand**: liest alle paar Minuten die Region-Files der Welt (read-only) und erzeugt einen Snapshot des Campus-Ausschnitts, aber nur, wenn der Server gespeichert hat.
- **Konfliktanalyse** je Bauplan gegen Live: Fortschritt, Maschinen/Block-Entities im Weg, seit Planung geänderte Zellen, Überlappungen zwischen Bauplänen, Bearbeitungskonflikte (409 bei veralteter `baseVersion`).
- **3D-Viewer** (`/viewer`, three.js): texturierte Voxel-Chunks (Greedy-Meshing + Ambient Occlusion im Web-Worker), Tageszeit mit Sonnenschatten, leuchtende Lampen (Bloom), Orbit/Fliegen/Laufen mit Kollision, Höhenschnitt, Tooltip je Block.
  Kombinierbare Ebenen (Bestand, Abriss, Gebaut, Noch setzen, Ersetzen, Maschine im Weg, Seit Planung geändert, Überlappung) mit Modus je Ebene (Echt / Farbe / Geist / Gedimmt / Aus) und Presets wie „Noch zu bauen“ oder „Konflikte“.
- **Agent-Bearbeitung**: Baupläne blockgenau per Operationen ändern (`set`, `fill`, `replace`, `clear`, `void`, `copy`, mit `dryRun`-Vorschau und Analyse), als ASCII-Schichten oder JSON lesen, echten Bestand abfragen.
- **Login per Einladung**, persönliche **API-Tokens** für Agents (`/docs`, `/api/openapi.json`).
- **Schematics direkt in die Kanone**: Rest-Plan mit Bauplan-Zielkoordinaten und Kanonen-Einstellungen automatisch vorbereiten, neue Versionen bei vollständigem Stopp übernehmen. Browser-Admins starten oder setzen den bestätigten Plan mit „Starten“ / „Fortsetzen“ fort; Play im Spiel bleibt verfügbar.

## Viewer-Assets

Die Materialtexturen und das Titelbild sind mit Codex (imagegen) erzeugt; Quellen und Prompts liegen in `assets-src/` (`PROMPTS.md`).
`python3 tools/build-textures.py` (Pillow) macht daraus `public/viewer/textures/*.png` (64 px, kachelbar, Graustufen) und `public/viewer/hero.webp`.
Die Blockfarben stammen aus den Mod-Jars (`tools/extract-texture-colors.py` → `src/data-texture-colors.json.gz`) und färben die Texturen je Block ein.

### Bauplan-Vorschauen

`GET /api/blueprints/:id/preview.png?version=N` liefert ein authentifiziertes PNG (640 × 400). Ohne Versionsangabe gilt die aktuelle Revision. Die Vorschau zeigt den vollständigen Bauplan ohne Weltbestand oder Baufortschritt. Wie der Viewer verwendet sie Würfelgeometrie, die Blockfarben aus dem Modpack und die gemeinsamen Materialtexturen; spezielle Blockmodelle wie Treppen und Maschinen sind vereinfacht. Luft und Structure Void werden ausgelassen. Reine Abrisspläne zeigen ein leeres Raster.

Die App lädt Bilder erst in der Nähe des sichtbaren Bereichs. Der Server rendert bei Bedarf in einem separaten Worker und speichert unter `DATA_DIR/previews`. Inhalts- und Renderer-Hash verhindern veraltete Bilder nach NBT- oder Rendereränderungen. Änderungen nur am Weltanker verwenden dasselbe Bild. Private ETags erlauben eine erneute Zugriffskontrolle bei jedem Abruf. Parallele Anfragen desselben Inhalts teilen einen Renderauftrag. Maximal ein Worker läuft gleichzeitig (30 Sekunden, 512 MB Heap, bis zu 128 wartende Aufträge); der Bildcache bleibt auf 1.000 Bilder beziehungsweise 128 MB begrenzt. Fehler erscheinen als lesbarer Platzhalter, die Bauplanfunktionen bleiben verfügbar.

Die **Materialliste** hat zusätzlich eine bebilderte HTML-Ansicht (`/api/materials?format=html`, auch pro Bauplan).
Sie zeigt die exakte Item-ID, Connecting-Variante, Mengen und den Zeitstand von Weltaufnahme/ME-Bestand.
JSON (Standard), Text und CSV bleiben unverändert verfügbar. Unbekannte Materialien bleiben lesbar und erhalten ein neutrales Platzhalterbild.

Die 34 Materialbilder unter `public/assets/material-icons/` sind aus den tatsächlichen Item-Modellen und Texturen von Minecraft 1.21.1, Rechiseled 1.2.6, Rechiseled Create 1.1.1, Create 6.0.10, Chipped 4.0.2 und Connected Glass 1.1.14 gerendert.

Die App verwendet eine gemeinsame schlichte Oberfläche: Baupläne, Koordinaten, Kanonen und Live-Bestand stehen in der Hauptnavigation; Agent-Zugang, Aktivität und Verwaltung unter „Mehr“. Downloads und seltenere Details sind aufklappbar. Materiallisten bieten eine Suche und optional zusätzliche Planmengen. Im 3D-Viewer stehen Ebenen und Darstellungsoptionen in eigenen aufklappbaren Bereichen.

Kanonen-Einstellungen werden erst mit „Speichern“ übernommen. „Verwerfen“ setzt den Entwurf zurück. Während der Bearbeitung erhalten automatische Statusaktualisierungen die Eingaben; nur geänderte Optionen werden gesendet. Änderungen an der Materialversorgung lösen deshalb keine erneute Schematic-Vorbereitung aus. Gebundene Kanonen bleiben nur für Browser-Admins bearbeitbar. „Materialzufuhr pausieren“ steuert ausschließlich den ME-Versorger.

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
| `CANNON_DISCOVERY_ENABLED` | `true` | Kanonen im Campus-Ausschnitt anhand Computer-ID und Kiste erkennen und live prüfen |
| `CANNON_SCHEMATIC_OWNER` | `Campus` | Upload-Verzeichnis für automatisch erkannte Kanonen; bestehende Bindungen behalten ihren Owner |

## Deploy

Dokploy-App `atm10-campus` (Dockerfile, Auto-Deploy bei Push auf `main`), Domain `campus.logge.top`.
Mounts: Volume `atm10-campus-data` → `/data`, Bind `~/minecraft/atm10/data/world` → `/worlds/live`, Bind `~/minecraft/atm10-backup-20261021/world` → `/worlds/backup-20261021`, Bind `~/atm10-campus-seed` → `/seed`.

## Automatische Schematic-Vorbereitung (Create 1.21.1-6.0.10)

Im Kanonen-Tab den Bauplan zuweisen. Feeder 1.4.0 meldet seine Computer-ID und die angeschlossene Kistenseite. Die App sucht den Computer in den gespeicherten Weltblöcken des Campus-Ausschnitts und ordnet die Kanone über diese Kiste zu. Die Host-Brücke prüft Computer, Kiste und Kanone unmittelbar im Spiel. Neue, eindeutig erkannte Stationen erhalten automatisch die Schematic-Vorbereitung; eine zuvor ausdrücklich deaktivierte Automatik bleibt aus. Bei fehlenden oder mehrdeutigen Verbindungen zeigt die Karte den Grund und „Erneut suchen“. Die manuelle Positionseingabe bleibt unter den erweiterten Einstellungen verfügbar.

Die App erzeugt und überträgt den Rest-Plan mit den Zielkoordinaten der Bauplanversion und den gewählten Ersetzungs-/Material-/Maschinenschutz-Einstellungen. „Bauplan und Position“ öffnet den Bauplan; eine Positionsänderung wird als neue Version gespeichert. Ausrichtung und Spiegelung entsprechen der NBT. Automatische Rest-Pläne verwenden den Live-Bestand der Oberwelt. Der automatische Aufbau erwartet eine direkt angeschlossene einzelne Kiste mit genau einer benachbarten Kanone. Netzwerk-Peripherie und mehrdeutige Aufbauten benötigen eine manuelle Zuordnung. Neue oder versetzte Blöcke werden erst nach dem nächsten Speichern der Welt gefunden.

Die signierte Controller-Anbindung verwendet `/campus/discover` für die Zuordnung und `/campus/prepare` für das Einsetzen. Neben `campus_cannon.py` müssen `controller/campus_discovery.py`, `controller/campus_schematic.py`, `controller/campus_snbt.py`, `controller/campus_probe.py` und `controller/campus_start.py` neben dem vorhandenen `control.py` auf dem Host liegen. Danach nur den Controller-Service neu starten. Die bisherigen Bridge-Adresse, Signatur und Block-Registry werden weiterverwendet; ein zusätzlicher Station-Token ist nicht erforderlich. Details zur Host-Anbindung stehen in `docs/cannon-alignment.md`.

Jeder Auftrag friert Rest-NBT, SHA256, Version, Live-Snapshot, Ziel und Einstellungen ein. Neue Planversionen werden bei aktivierter Versionsübernahme vorgemerkt und alle zehn Sekunden erneut versucht. Ein anderer Live-Snapshot allein unterbricht keinen Bau. „Rest-Plan neu vorbereiten“ erzeugt einen Auftrag aus dem neuesten vorhandenen Snapshot. Die Materialfreigabe bleibt bis zur bestätigten Übergabe gesperrt und prüft anschließend auch die Kanonen-Einstellungen live. Der CC-Versorger 1.4.0 lädt sich über sein vorhandenes Auto-Update nach.

Die Brücke verlangt `STOPPED`, Null-Zähler, leere `FlyingBlocks` und einen uninitialisierten Drucker. Kurze Befehle bereiten Inventar und Einstellungen in temporärem Command-Storage vor. Der abschließende einzelne Server-Befehl prüft Blocktyp, Zustand, Zähler und das zuvor gelesene Inventar erneut. Die Vorbereitung verändert keine laufenden oder pausierten Kanonen. Manuelle Schematics im Eingang müssen zuerst entfernt werden. Vorhandene Campus-Schematics werden neu beschrieben, leere Schematics im Ausgabefach wiederverwendet. Ist keine Vorlage vorhanden, erstellt die Brücke ein Campus-Schematic. Andere Inventarslots und ihre NBT-Typen bleiben erhalten. Der vorherige Kanonenzustand liegt unter `discord/campus-schematic-backups`. Der Modus zum Leerräumen wird bei den dünn besetzten Rest-Plänen nicht angeboten. Der Bau startet über den gesonderten Webknopf oder Play im Spiel.

Bei jedem Auftrag zeigt die Kanonen-Karte die Entfernung zum Anker der tatsächlich ausgewählten Version (bei automatischen Updates zur neuen vorgemerkten Version). Ab 256 Blöcken, einschließlich Höhenunterschied, bleibt der Auftrag als „Außer Reichweite“ sichtbar. Die App liefert einen gesperrten Materialplan und schreibt kein neues Schematic. Passende bestätigte Kanonen in der Oberwelt werden nach Verfügbarkeit und Entfernung vorgeschlagen; belegte, offline oder veraltete Stationen bleiben als solche gekennzeichnet.

Mit „Auftrag hierhin verschieben“ kann ein Browser-Admin eine freie Kanone auswählen. Die App prüft beide physischen Kanonen live auf STOPPED, Null-Zähler, leeren Drucker und keine fliegenden Blöcke. Auftrags-/Versions-/Bindungsänderungen während der Prüfung werden abgelehnt. Beide App-Stationen sind währenddessen gegen weitere Änderungen gesperrt. Danach werden Zuordnungen und Material-/Schematic-Einstellungen gemeinsam übertragen, die alte Zuordnung aufgehoben und die neue Rest-NBT vorbereitet. Scheitert die physische Vorbereitung nach dem Wechsel, bleibt der neue Auftrag sichtbar ausstehend und ohne Materialfreigabe. Es gibt keinen automatischen Wechsel auf belegte Kanonen und keinen automatischen Baustart. Native GUI und bereits vorhandene Materialien bleiben außerhalb des App-Interlocks.

Prüfen: `LOG_LEVEL=silent npm test`, `python3 test/bridge_test.py`, `python3 test/controller_alignment_test.py` auf dem Controller-Host sowie `uv run --with lupa python test/feeder_alignment_test.py`.

## Bauplanauswahl je Kanone

Die Auswahl zeigt nur freie aktuelle Bauplanversionen in Reichweite, für die im letzten Weltabgleich noch baubare Blöcke fehlen. Fertige, anderweitig zugewiesene, unbekannte und vollständig blockierte Pläne bleiben ausgeblendet. Geschützte Block-Entities, fehlende Item-Entsprechungen, Flüssigkeiten und der Sicherheitsabstand zur Kanone zählen nicht als baubarer Rest. Bei den restriktiven Ersetzungsmodi werden konservativ nur sicher freie Zielzellen gezählt, da der Weltabgleich keine modabhängigen Kollisionsformen enthält. Fehlender ME-Vorrat versteckt einen baubaren Plan nicht; Nachlieferung und Crafting bleiben möglich.

Jeder Eintrag zeigt Prozent gesetzt, noch baubare Blöcke und Entfernung. Die ausgewählte Version erhält eine Vorschau mit Fortschrittsbalken und Snapshot-Zeitstempel. Leere NBT-Zellen erhöhen den Baufortschritt nicht; ein unvollständiger Plan wird auch bei wenigen fehlenden Blöcken nicht auf 100 Prozent gerundet. Bestehende Aufträge bleiben erhalten, wenn sie aus der Auswahl herausfallen. Die App bindet die Auswahl an Version und Auftragsnummer und prüft sie vor der Zuweisung nochmals. Weltvergleich und NBT-Dekodierung laufen in begrenzten Workern, ohne Feeder-Abfragen zu blockieren.

Automatisch vorbereitete Aufträge zeigen zusätzlich den nativen Kanonen-Fortschritt. Die signierte Prüfung liest ihn bei Feeder-Abfragen (alle fünf Sekunden) und beim Aktualisieren der Kanonenansicht. Gleichzeitige Abfragen desselben Auftrags teilen eine laufende Prüfung; native Leseanfragen werden nacheinander ausgeführt. Der Vorbereitungszyklus prüft fertige Vorbereitungen nicht zusätzlich. Create zählt abgeschickte Blöcke; diese Auftragswerte werden deshalb getrennt vom Weltabgleich angezeigt und nicht zu dessen gesetzten Blöcken addiert. Erst `finished`, der zurückgegebene Leerbauplan, ein leerer Printer und keine fliegenden Blöcke bestätigen den Abschluss eines zuvor exakt geprüften Auftrags. Null-Zähler, Stoppen oder eine leere Kanone allein gelten nicht als Abschluss. Nach übersprungenen Materialien oder einem beobachteten Reset bleibt die Abschlussbestätigung aus.

Bestätigte Abschlüsse werden gespeichert, stoppen Nachlieferung und Crafting und entfernen die betreffende Version beim nächsten Aktualisieren aus allen Kanonenauswahlen, auch bei offenen Formularen. Andere ungespeicherte Einstellungen bleiben erhalten. Eine neue Bauplanversion oder ein ausdrücklich neu vorbereiteter Rest-Plan hebt die alte Abschlussmarkierung auf. Der Abschluss betrifft den vorbereiteten Rest-Auftrag; geschützte oder technisch nicht baubare Blöcke sind damit nicht als gebaut bestätigt. Wird das Ausgabeschematic vor der nächsten Live-Prüfung entfernt oder ist die Verbindung während des Abschlusses länger unterbrochen, bleibt der Weltabgleich maßgeblich.

## Live-Status und Web-Start

App und Viewer verwenden 30-Sekunden-Polling mit sichtbarem Countdown-Balken und manueller Aktualisierung. Es gibt keine SSE-Verbindung im Browser. Nur der sichtbare Bereich wird abgefragt; im Hintergrund pausiert der Takt, bei der Rückkehr wird aktualisiert. Laufende Abfragen überlappen nicht. Fehler bleiben sichtbar und werden im nächsten Takt erneut versucht. Offene Eingaben bleiben erhalten; die Kanonenauswahl und ihr Fortschritt werden trotzdem aktualisiert. Der Viewer prüft neue Welt- oder Planstände und meldet sie, ohne die gewählte Ansicht zurückzusetzen. Der SSE-Endpunkt bleibt für ältere Clients kompatibel.

Feeder 1.4.0 sendet erkannte Statusänderungen unmittelbar nach der Prüfung im Hauptlauf. Dieser prüft weiterhin im Fünf-Sekunden-Takt; Peripherie-, Crafting- und manuelle Aktualisierungsereignisse wecken ihn zusätzlich. Unveränderter Status wird alle 30 Sekunden bestätigt. Fehlgeschlagene Meldungen bleiben offen und werden mit begrenzter Verzögerung erneut versucht. Der native Auftragsfortschritt kommt aus der signierten Kanonenprüfung; der vollständige Blockvergleich mit der Welt bleibt Teil der Weltaufnahme.

„Starten“ und „Fortsetzen“ sind eigene Aktionen für Browser-Admins an bestätigten, automatisch vorbereiteten Kanonen. Der Server prüft Auftrag und Version erneut und vergleicht das eingelegte Schematic, dessen Datei, Ziel, Ausrichtung, Einstellungen und nativen Druckerzustand. Ein pausierter Bau kann nur mit demselben geprüften Plan fortgesetzt werden. Die Initialisierung von Create wird vor dem anschließenden Start bestätigt. Inventar und Zähler werden dabei nicht zurückgesetzt. Bei Abweichungen erscheint der konkrete Grund; Einstellungen speichern und Schematic vorbereiten starten keinen Bau.

## Neue Version von Jonnys HTML

Als Admin unter **Mehr → Verwaltung → Campus importieren**. Geänderte NBTs werden neue Versionen. Was seit dem letzten Import in der App geändert wurde, wird nicht überschrieben und als Konflikt gemeldet.
