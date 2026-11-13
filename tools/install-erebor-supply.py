"""Install the Campus Erebor controller module on the Minecraft Linux host."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
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
        shutil.copyfile(source, name)
        os.chown(name, stat.st_uid, stat.st_gid)
        os.chmod(name, stat.st_mode & 0o777)
        os.replace(name, dest)
    finally:
        name.unlink(missing_ok=True)


def restart():
    subprocess.run(['systemctl','restart','atm10-control.service'], check=True)
    subprocess.run(['systemctl','is-active','--quiet','atm10-control.service'], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check','install','rollback'])
    args = parser.parse_args()
    if not sys.platform.startswith('linux'):
        sys.exit('Bitte im Linux-Terminal der Minecraft-Homebox ausführen.')
    kit = Path(__file__).resolve().parent
    target = Path('/home/logge/minecraft/atm10/discord/campus_erebor.py')
    source = kit / 'campus_erebor.py'
    manifest = json.loads((kit/'manifest.json').read_text())
    if target.is_symlink() or not target.is_file() or digest(source)!=manifest['new']:
        sys.exit('Installationspfad oder Paket passt nicht.')
    if not all((target.parent/p).is_file() for p in ('control.py','campus_cannon.py','campus_probe.py','campus_discovery.py','campus_start.py','campus_snbt.py','erebor-stations.json')):
        sys.exit('Erwartete Controller-Dateien fehlen.')
    layout=json.loads((target.parent/'erebor-stations.json').read_text())
    if layout.get('version')!=12 or len(layout.get('sites',[]))!=37:
        sys.exit('Standortliste des Hosts passt nicht zu Erebor V12.')
    before = digest(target)
    if before not in (manifest['old'],manifest['new']):
        sys.exit('Eigene oder abweichende Host-Version gefunden. Bitte zuerst mit Logge abgleichen.')
    compile(source.read_bytes(),str(source),'exec')
    backup = target.with_name('campus_erebor.py.before-compact-supply-'+manifest['old'][:12])
    if args.action=='check':
        print('Prüfung OK. '+('Update ist bereits installiert.' if before==manifest['new'] else 'Installation möglich.'))
        return
    if os.geteuid()!=0:
        sys.exit('Für Installation und Rücknahme sudo verwenden.')
    if (args.action=='install' and before==manifest['new']) or (args.action=='rollback' and before==manifest['old']):
        print('Gewünschte Version bereits vorhanden.')
        return
    if args.action=='install' and not backup.exists():
        with backup.open('xb') as out, target.open('rb') as inp:
            shutil.copyfileobj(inp,out)
    if backup.is_symlink() or not backup.is_file() or digest(backup)!=manifest['old']:
        sys.exit('Sicherung fehlt oder ist ungültig.')
    install = args.action=='install'
    replace(source if install else backup, target)
    try:
        restart()
    except (OSError, subprocess.CalledProcessError):
        replace(backup if install else source, target)
        restart()
        sys.exit('Controller-Neustart fehlgeschlagen. Vorherige Version wiederhergestellt.')
    print('Controller aktiv. Sicherung: '+str(backup))


if __name__=='__main__':
    main()
