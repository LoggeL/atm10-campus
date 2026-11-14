# Erebor mit drei Kanonen je Standort

Die bisherige Kanone übernimmt weiter ihre Baufolge. B und C bauen die veröffentlichten Cleanstone-Abschnitte ihres Standorts parallel. Jeder Abschnitt wird einmal vergeben. Die Zuordnung überlebt einen Neustart. Zwischen Standort und Schematic-Anker müssen weniger als 256 Blöcke liegen.

## Einmal in der Base

Zwei EnderStorage-Enderkisten aufstellen (JEI: `enderstorage:ender_chest`). Zwei freie Farbcodes wählen, einen für normalen Stein (`minecraft:stone`), den anderen für Schießpulver. Einen ME-Exportbus pro Kiste anschließen und auf genau das jeweilige Item filtern. Zwei freie Kanäle in der Base einplanen. Bei Bedarf Beschleunigungskarten einsetzen. Beide Kisten und das ME-Netz geladen halten. Einen ersten Stack jeder Sorte durch die Verbindung schicken. An allen Enden dieselbe Farbe und bei privaten Frequenzen denselben Besitzer verwenden.

## Je Standort

Im geladenen Stationschunk ein Quadrat von 2 × 2 nach der Koordinatenliste aufbauen. B und C bezeichnen die Kanonenblöcke. Auf die zwei übrigen Ecken kommen eine EnderStorage-Kiste auf der Steinfrequenz und eine auf der Pulverfrequenz. Beide Kisten berühren beide Kanonen mit einer ganzen Blockseite. Der alte Computer versorgt weiterhin seine eigene Einzelkiste. Das neue Paar benötigt vor Ort zwei Kanonen und zwei EnderStorage-Kisten. Bei allen 37 Standorten sind das 74 Zusatzkanonen und 74 Kisten vor Ort plus zwei Kisten in der Base. Die Liste beruht auf dem gespeicherten Standortplan. Die vier Felder vor dem Bauen auf vorhandene Kabel oder Maschinen prüfen.

Beide Kanoneneingänge leer lassen, die zwei EnderStorage-Kisten füllen lassen und den Stationschunk geladen halten. Die Zusatzautomatik ist für alle 37 Standorte standardmäßig aktiv, sobald die Erebor-Planfolge eingerichtet ist. Auf der Seite Dreierbetrieb können Admins die Vergabe für alle Zusatzkanonen gemeinsam pausieren und freigeben. Der Campus erkennt die gebauten Zusatzkanonen im Zielchunk-Bericht, legt je einen freien Plan ein und startet ihn. Die Zusatzkanonen starten auch einzeln. Während des Aufbaus müssen die beiden Kisten und wenigstens eine Zusatzkanone stehen. Ein fremder Bauplan im Eingang hält diesen Platz an.

Unter **Kanonen → Aufstellkoordinaten → Dreierbetrieb** stehen Koordinaten und Status für B und C. Der Zeitstempel bezieht sich auf die letzte Meldung der Minecraft-Welt. Für den ersten Test K01 aufbauen und dort zwei unterschiedliche Plannamen sowie steigende Blockzähler ablesen.

## Homebox · vor dem Start von Minecraft

Als Benutzer `logge` den folgenden Block im Homebox-Terminal ausführen. Das Paket enthält den Stand von V2 und aktualisiert den Zielchunk-Tracker für die Zusatzkanonen. Der Installer prüft die vorhandenen Versionen und sichert die ersetzten Dateien. Der Minecraft-Server kann dabei ausgeschaltet bleiben.

```bash
(
  set -e
  mkdir -p "$HOME/erebor-parallel-v3"
  cd "$HOME/erebor-parallel-v3"
  curl -fL --retry 2 'https://campus.logge.top/assets/erebor-parallel-v3.zip' -o update.zip ||
    curl -fL 'https://raw.githubusercontent.com/LoggeL/atm10-campus/main/public/assets/erebor-parallel-v3.zip' -o update.zip
  python3 -m zipfile -e update.zip .
  python3 install.py check
  python3 install.py install
  python3 install.py check
  systemctl --user is-active atm10-control.service
)
```

Anschließend Minecraft wie gewohnt starten. Falls Minecraft während der Installation bereits lief, muss das geänderte KubeJS-Serverskript neu geladen werden, etwa beim nächsten Serverstart. Beide Campus-Komponenten müssen den Dreierbetrieb unterstützen. Zur Rückkehr auf die gesicherten Hostdateien im Dreierbetrieb neue Aufträge pausieren, laufende Zusatzaufträge abschließen lassen und `python3 "$HOME/erebor-parallel-v3/install.py" rollback` ausführen. Den Minecraft-Server anschließend mit dem wiederhergestellten Skript starten.
