# Erebor · A, B und C an einer Kiste

An jedem Standort von K01 bis K37 gibt es eine eigene Liste von Bauabschnitten. Die ursprüngliche Kanone A und die Zusatzkanonen B und C reservieren unterschiedliche Abschnitte dieser Liste. B und C bauen Cleanstone. Der Campus bestätigt den Abschluss jeder einzelnen Kanone, bevor er ihren nächsten Abschnitt einlegt.

1. Als Benutzer logge V5 installieren und das Minecraft-Serverskript beim Serverstart laden. Sobald die Campus-Seite im Dreierbetrieb »Oak Netherite Chest bereit« meldet, kann eine einzelne Oak Netherite Chest von Sophisticated Storage am selben Kistenblock eingesetzt werden. Vor dem Austausch den Inhalt sichern. Die Bestandsprüfung kontrolliert die gemeinsame Kiste und alle belegten Kanonen. Die Stationscomputer verwenden ihre gespeicherte Kistenseite weiter.
2. Am Standort die vorhandene Einzelkiste suchen. B und C auf die angegebenen Blöcke direkt an den Seiten der Kiste stellen. Bei K09 steht C direkt unter der Kiste; so liegen alle drei Kanonen im Stationschunk. Kiste, Computer, Bridge und Hauptkanone bleiben an ihren vorhandenen Plätzen. Pro Standort werden nur zwei weitere Schematicannons benötigt, insgesamt 74.
3. Stationschunk und ME-Verbindung geladen halten. Die Eingaben von B und C leer lassen. Der vorhandene Stationscomputer füllt die gemeinsame Kiste auf den eingestellten Stein- und Pulvervorrat auf. Alle drei Kanonen entnehmen daraus.
4. Unter **Erebor → Kanonen → Aufstellkoordinaten → Dreierbetrieb** die Aufstellkoordinaten und B/C prüfen. Neue Zusatzaufträge müssen freigegeben sein. Die Hauptkanone baut mit eingeschalteter Standortautomatik. Über die gemeinsame Starttaste können die 37 Hauptkanonen und die Zusatzvergabe in einem Schritt aktiviert werden. Bei drei freien, erreichbaren Cleanstone-Abschnitten sind dann drei verschiedene Pläne gleichzeitig möglich.

## Homebox · vor dem Start von Minecraft

Als Benutzer `logge` den folgenden Block im Homebox-Terminal ausführen. Das Paket enthält den Stand von V2 und aktualisiert den Zielchunk-Tracker für die Zusatzkanonen. Der Installer prüft die vorhandenen Versionen und sichert die ersetzten Dateien. Der Minecraft-Server kann dabei ausgeschaltet bleiben.

```bash
(
  set -e
  mkdir -p "$HOME/erebor-shared-v5"
  cd "$HOME/erebor-shared-v5"
  curl -fL --retry 2 'https://campus.logge.top/assets/erebor-shared-v5.zip' -o update.zip ||
    curl -fL 'https://raw.githubusercontent.com/LoggeL/atm10-campus/main/public/assets/erebor-shared-v5.zip' -o update.zip
  python3 -m zipfile -e update.zip .
  python3 install.py check
  python3 install.py install
  python3 install.py check
  systemctl --user is-active atm10-control.service
)
```

Anschließend Minecraft wie gewohnt starten. Falls Minecraft während der Installation bereits lief, muss das geänderte KubeJS-Serverskript neu geladen werden, etwa beim nächsten Serverstart. Beide Campus-Komponenten müssen den Dreierbetrieb unterstützen. Zur Rückkehr auf die gesicherten Hostdateien im Dreierbetrieb neue Aufträge pausieren, laufende Zusatzaufträge abschließen lassen und `python3 "$HOME/erebor-shared-v5/install.py" rollback` ausführen. Den Minecraft-Server anschließend mit dem wiederhergestellten Skript starten.
