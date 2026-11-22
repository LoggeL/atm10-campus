"""Recognise the published sapling grove inputs in the existing Homebox guards."""
import hashlib
from pathlib import Path


# Verified Create upload identities from Campus package E01_901, V12 / R5.
# Each identity binds both the original blueprint name and its content hash.
GROVES = {
    'K01': ((-224, 128, -10848), 'campus_89186374-ea7c-8400-aeab-1d03b9a5cd07.nbt',
            'b584f64fbbabd6c006552c6455b9d3d0c36df8703073bb46c9caa9552afa5baa'),
    'K04E': ((-192, 128, -10816), 'campus_478a8754-c148-85ea-bd49-40051f6be361.nbt',
             'a5930896ed116bdcbb2acdbeea95f588be2cdd5ef52fc859610dafd8e973f119'),
    'K31': ((-1056, 96, -9440), 'campus_da0beb4e-15fe-8d9f-bea9-ecf3789eb1e8.nbt',
            '1dd10f2149b7b798cbb7759fad324483482af5fbb5aad37fcb34efd394a559c1'),
    'K31B': ((-1056, 96, -9472), 'campus_0407074a-fa43-888e-8274-f055f7d8107d.nbt',
             'e20e47115575a3e7c0186f4b01c5985903d6ab1a16e6ce6240b2ce2549425ab6'),
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
    name = f'EREBOR_E01_AUSBAU_BAU_{site[:3]}_X{x}_Y{y}_Z{z}_R5'
    return blueprint is None or blueprint == name


def insert_once(source, old, new):
    if source.count(new) == 1 and source.replace(new, '').count(old) == 0:
        return source
    if source.count(old) != 1 or new in source:
        raise ValueError('Die installierte Modulversion hat eine andere Struktur.')
    return source.replace(old, new)


def update_modules(baufolge, surface):
    branch = "        if not spec or (len(key)==3 and spec[0]!='surface'):\n"
    baufolge = insert_once(baufolge, branch,
        "        from campus_k10_groves import grove_input as matches_grove\n"
        "        primary_grove = spec and matches_grove(key, spec[1], desired.get('file'), desired.get('sha256'), desired.get('blueprint'))\n"
        "        if not spec or (len(key)==3 and spec[0]!='surface' and not primary_grove):\n")
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
        previous_release = '25e5bcd2d401d5a8d6688e48e877285a78ba388cf3b17e25b47240557e265710'
        if prior[module] not in (None, payload[module]) and hashlib.sha256(prior[module].replace(b'\r\n', b'\n')).hexdigest() != previous_release:
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
                    backup = path.with_name(path.name + '.before-sapling-revisions')
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
        print('Veröffentlichte Setzlingspläne der Hanggruppen werden im additiven Baumodus erkannt.')
    finally:
        os.close(lock)


if __name__ == '__main__':
    install(Path.home() / 'minecraft/atm10')
