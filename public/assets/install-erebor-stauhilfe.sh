#!/usr/bin/env bash
set -euo pipefail

base="$HOME/minecraft/atm10"
target="$base/data/kubejs/server_scripts/campus/erebor-stauhilfe.js"
test -f "$base/data/kubejs/config/erebor-parallel.json" || {
  echo "Die Erebor-Standortdatei fehlt unter $base/data/kubejs/config."
  exit 1
}

containers=()
running=$(docker ps -q)
for candidate in $running; do
  source=$(docker inspect --format \
    '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' \
    "$candidate")
  if [[ "$source" == "$base/data" ]]; then
    containers+=("$candidate")
  fi
done
if [[ ${#containers[@]} -ne 1 ]]; then
  echo "Minecraft-Container konnte nicht eindeutig ermittelt werden."
  exit 1
fi
mc="${containers[0]}"
docker exec "$mc" sh -c 'command -v rcon-cli >/dev/null'

mkdir -p "$(dirname "$target")"
download=$(mktemp "${target}.download.XXXXXX")
trap 'rm -f -- "$download"' EXIT
curl --fail --show-error --location --retry 3 --max-time 90 \
  https://campus.logge.top/assets/erebor-stauhilfe.js \
  --output "$download"
printf '%s  %s\n' \
  '4566ee239902b83e53f53ab0fca25d0d45959fa27d287ac5aa490942d758fb4f' \
  "$download" | sha256sum --check -
if [[ -f "$target" ]]; then
  cp -p -- "$target" "${target}.backup-$(date +%Y%m%d-%H%M%S)"
fi
chmod 644 "$download"
mv -- "$download" "$target"
docker exec "$mc" timeout 60s rcon-cli "minecraft:reload"
echo "Ladehilfe v2 installiert und Reload ausgelöst."
sleep 8
docker logs --since 30s --tail 60 "$mc" 2>&1

# Read the local tracker twice to show actual progress after the reload.
python3 - "$base/data/kubejs/config/erebor-target-live.json" <<'PY'
import datetime
import json
import pathlib
import sys
import time

path = pathlib.Path(sys.argv[1])
for sample in range(2):
    if sample:
        time.sleep(20)
    report = json.loads(path.read_text())
    age = time.time() - report['at'] / 1000
    print(datetime.datetime.now().astimezone().isoformat(timespec='seconds'), flush=True)
    print(f'Weltmeldung {age:.1f} Sekunden alt', flush=True)
    for name in ('K12', 'K12B', 'K12C', 'K27', 'K27B', 'K27C'):
        row = report.get('stations', {}).get(name, {})
        print(name, row.get('state'), row.get('status'), 'Blöcke', row.get('placed'),
              'Plan', row.get('upload'), flush=True)
PY
