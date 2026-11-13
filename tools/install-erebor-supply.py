"""Install the Campus Erebor controller module on the Minecraft Linux host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def digest(path):
    return hashlib.sha256(path.read_bytes().replace(b'\r\n', b'\n')).hexdigest()


def replace(source, dest):
    stat = dest.stat()
    with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as f:
        name = Path(f.name)
    try:
        name.write_bytes(source.read_bytes())
        if name.stat().st_gid != stat.st_gid:
            os.chown(name, -1, stat.st_gid)
        os.chmod(name, stat.st_mode & 0o777)
        os.replace(name, dest)
    finally:
        name.unlink(missing_ok=True)


def restart():
    subprocess.run(['systemctl','--user','restart','atm10-control.service'], check=True)
    subprocess.run(['systemctl','--user','is-active','--quiet','atm10-control.service'], check=True)


def owns_service_directory(directory):
    return os.geteuid()!=0 and directory.stat().st_uid==os.geteuid()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check','install','rollback'])
    args = parser.parse_args()
    if not sys.platform.startswith('linux'):
        sys.exit('Bitte im Linux-Terminal der Minecraft-Homebox ausführen.')
    kit = Path(__file__).resolve().parent
    directory = Path('/home/logge/minecraft/atm10/discord')
    if not owns_service_directory(directory):
        sys.exit('Als Besitzer des Controllers im Benutzer-Terminal der Homebox ausführen (ohne sudo).')
    manifest = json.loads((kit/'manifest.json').read_text())
    if not all((directory/p).is_file() for p in ('control.py','campus_probe.py','campus_discovery.py','campus_start.py','campus_snbt.py','erebor-stations.json')):
        sys.exit('Erwartete Controller-Dateien fehlen.')
    layout=json.loads((directory/'erebor-stations.json').read_text())
    if layout.get('version')!=12 or len(layout.get('sites',[]))!=37:
        sys.exit('Standortliste des Hosts passt nicht zu Erebor V12.')
    unit = subprocess.check_output(['systemctl','--user','show','-p','LoadState','--value','atm10-control.service'],text=True).strip()
    if unit!='loaded':
        sys.exit('Der Benutzerdienst atm10-control.service ist nicht geladen.')
    changes=[]
    for name in ('campus_erebor.py','campus_cannon.py'):
        target,source=directory/name,kit/name
        spec=manifest[name]
        if target.is_symlink() or not target.is_file() or digest(source)!=spec['new']:
            sys.exit('Installationspfad oder Paket passt nicht: '+name)
        before=digest(target)
        if before not in (*spec['old'], spec['new']):
            sys.exit('Abweichende Host-Version: '+name+'. Bitte zuerst mit Logge abgleichen.')
        compile(source.read_bytes(),str(source),'exec')
        backup=directory/(name+'.before-supply-v2')
        if backup.is_symlink() or (backup.exists() and digest(backup) not in spec['old']):
            sys.exit('Vorhandene Sicherung passt nicht: '+str(backup))
        if args.action=='rollback':
            if before==spec['new'] and backup.exists():
                changes.append((target,backup,source))
        elif before!=spec['new']:
            if backup.exists() and digest(backup)!=before:
                sys.exit('Vorhandene Sicherung weicht vom Ausgangsstand ab: '+name)
            changes.append((target,source,backup))
    if args.action=='check':
        print('Prüfung OK. '+('Installation möglich.' if changes else 'Update ist bereits installiert.'))
        return
    if not changes:
        print('Gewünschte Version bereits vorhanden.')
        return
    applied=[]
    try:
        for target,source,undo in changes:
            if args.action=='install' and not undo.exists():
                with undo.open('xb') as out:
                    out.write(target.read_bytes())
            replace(source,target)
            applied.append((target,undo))
        restart()
    except (OSError, subprocess.CalledProcessError):
        for target,undo in reversed(applied):
            replace(undo,target)
        if applied:
            restart()
        sys.exit('Controller-Neustart fehlgeschlagen. Vorherige Version wiederhergestellt.')
    print('Benutzerdienst aktiv. Sicherungen liegen neben den aktualisierten Modulen.')


if __name__=='__main__':
    main()
