"""Recognise the two published K10 grove inputs in the existing Homebox guards."""
from pathlib import Path


# Verified Create upload identities from Campus package E01_901, V12 / R5.
# Each identity binds both the original blueprint name and its content hash.
GROVES = {
    'K10G': ((-1088, 128, -10368), 'campus_1654dedb-23a5-8427-955a-d3de9f496102.nbt',
             '3cb0ba4edec2d8efb2338e599b0af15e6854f754dfeca5ca7c81b9e28cae31c3'),
    'K10I': ((-1056, 128, -10368), 'campus_3a13c7e9-debf-86e4-aa32-cce7ddd262aa.nbt',
             '690e4fdd54b648993df4d568f604e141afba70f26ad18e74cec165cc22f0d18f'),
}


def grove_input(site, pos, upload, sha, blueprint=None):
    ref = GROVES.get(site)
    if not ref or pos != list(ref[0]) or upload != ref[1] or sha != ref[2]:
        return False
    x, y, z = pos
    name = f'EREBOR_E01_AUSBAU_BAU_K10_X{x}_Y{y}_Z{z}_R5'
    return blueprint is None or blueprint == name


def insert_once(source, old, new):
    if source.count(new) == 1 and source.replace(new, '').count(old) == 0:
        return source
    if source.count(old) != 1 or new in source:
        raise ValueError('Die installierte Modulversion hat eine andere Struktur.')
    return source.replace(old, new)


def update_modules(baufolge, surface):
    line = '        kind, anchor, mode = spec\n'
    baufolge = insert_once(baufolge, line, line +
        "        from campus_k10_groves import grove_input\n"
        "        if kind == 'build' and grove_input(key, anchor, desired.get('file'), desired.get('sha256'), desired.get('blueprint')):\n"
        "            mode = 0\n")
    surface = insert_once(surface, '                k=(file,*pos)\n', '                k=(key,file,*pos)\n')
    line = '                    known[k]=identity(pos,sha)==file\n'
    surface = insert_once(surface, line,
        '                    from campus_k10_groves import grove_input\n' +
        '                    known[k]=identity(pos,sha)==file or grove_input(key,pos,file,sha)\n')
    return baufolge, surface


def install(base):
    import fcntl
    import os
    import subprocess
    import sys

    host = base / 'discord'
    registry = base / 'data/kubejs/server_scripts/campus/erebor-target-chunks.js'
    if not registry.is_file() or 'surfaceModeTracker:1' not in registry.read_text():
        raise ValueError('Der vorhandene Außenhaut-Tracker wird benötigt.')
    sys.path.insert(0, str(host))
    from campus_interior import atomic

    service = ['systemctl', '--user']
    unit = 'atm10-control.service'
    lock = os.open(host, os.O_RDONLY)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        module, rules, tracker = (host / f for f in (
            'campus_k10_groves.py', 'campus_baufolge.py', 'campus_surface_mode.py'))
        paths = (module, rules, tracker)
        if any(p.is_symlink() for p in paths) or not all(p.is_file() for p in (rules, tracker)):
            raise ValueError('Baufolgemodul und Außenhautmodul müssen regulär installiert sein.')
        prior = {p: p.read_bytes() if p.exists() else None for p in paths}
        new_rules, new_tracker = update_modules(prior[rules].decode(), prior[tracker].decode())
        payload = {module: Path(__file__).read_bytes(), rules: new_rules.encode(), tracker: new_tracker.encode()}
        if prior[module] not in (None, payload[module]):
            raise ValueError('Die lokale K10-Moduldatei weicht ab.')
        for path in paths:
            compile(payload[path], str(path), 'exec')
        subprocess.run(service + ['is-active', '--quiet', unit], check=True)
        changed = []
        try:
            for path in paths:
                if prior[path] == payload[path]:
                    continue
                mode = path.stat().st_mode & 0o777 if path.exists() else 0o644
                if prior[path] is not None:
                    backup = path.with_name(path.name + '.before-k10-groves')
                    if backup.is_symlink() or (backup.exists() and backup.read_bytes() != prior[path]):
                        raise ValueError(f'Abweichende Sicherung für {path.name}.')
                    if not backup.exists():
                        atomic(backup, prior[path], mode)
                atomic(path, payload[path], mode)
                changed.append((path, mode))
            if changed:
                subprocess.run(service + ['restart', unit], check=True)
            subprocess.run(service + ['is-active', '--quiet', unit], check=True)
        except BaseException:
            for path, mode in reversed(changed):
                if prior[path] is None:
                    path.unlink()
                else:
                    atomic(path, prior[path], mode)
            if changed:
                subprocess.run(service + ['restart', unit], check=True)
            raise
        print('K10G/K10I: Hangplan-Erkennung installiert. Der nächste Livebericht prüft beide Eingaben.')
    finally:
        os.close(lock)


if __name__ == '__main__':
    install(Path.home() / 'minecraft/atm10')
