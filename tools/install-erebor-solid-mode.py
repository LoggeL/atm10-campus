"""Install the two Erebor V6 changes on the running V5 Homebox."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def atomic(path, data, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
        try:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    try:
        tmp.chmod(mode)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def install(base):
    delta = json.loads(Path(__file__).with_name("changes.json").read_text())
    paths = [base / "discord/campus_erebor.py", base / "data/kubejs/server_scripts/campus/erebor-target-chunks.js"]
    changes = []
    for path in paths:
        spec = delta[path.name]
        if path.is_symlink() or not path.is_file():
            raise ValueError("Hostdatei prüfen: " + str(path))
        text = path.read_text(encoding="utf-8")
        if digest(text) == spec["new"]:
            continue
        if digest(text) != spec["old"]:
            raise ValueError("Installierter Controller oder Tracker weicht von V5 ab: " + str(path))
        lines = text.splitlines(keepends=True)
        for start, stop, replacement in reversed(spec["edits"]):
            lines[start:stop] = replacement
        new = "".join(lines)
        if digest(new) != spec["new"]:
            raise ValueError("Ausgabedatei passt nicht zur Version.")
        if path.suffix == ".py":
            compile(new, path.name, "exec")
        changes.append((path, path.read_bytes(), new.encode(), path.stat().st_mode & 0o777))
    unit = ["systemctl", "--user"]
    service = "atm10-control.service"
    subprocess.run([*unit, "is-active", "--quiet", service], check=True)
    for path, old, _, mode in changes:
        backup = path.with_name(path.name + ".before-solid-v6")
        if backup.is_symlink() or (backup.exists() and backup.read_bytes() != old):
            raise ValueError("Abweichende Sicherung: " + str(backup))
        if not backup.exists():
            atomic(backup, old, mode)
    written = []
    try:
        for path, old, new, mode in changes:
            atomic(path, new, mode)
            written.append((path, old, mode))
        if changes:
            subprocess.run([*unit, "restart", service], check=True)
            subprocess.run([*unit, "is-active", "--quiet", service], check=True)
    except BaseException:
        for path, old, mode in reversed(written):
            atomic(path, old, mode)
        if written:
            subprocess.run([*unit, "restart", service], check=True)
        raise
    print("V6 installiert. In der Minecraft-Serverkonsole einmal minecraft:reload ausführen.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", type=Path, default=Path.home() / "minecraft/atm10")
    install(parser.parse_args().base)
