"""Install the Erebor three-cannon controller and target tracker as logge."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

KIT=Path(__file__).resolve().parent
BASE=Path('/home/logge/minecraft/atm10')
UNIT='atm10-control.service'


def digest(data):
    return hashlib.sha256(data.replace(b'\r\n',b'\n')).hexdigest()


def atomic(path, data, mode=0o644):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        tmp=Path(f.name)
        try:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    try:
        tmp.chmod(mode)
        os.replace(tmp,path)
    finally:
        tmp.unlink(missing_ok=True)


def deploy(action):
    directory=BASE/'discord'
    kube=BASE/'data/kubejs'
    if os.geteuid()==0 or directory.stat().st_uid!=os.geteuid():
        raise ValueError('Als logge in dessen Benutzersitzung ausführen.')
    state=subprocess.check_output(['systemctl','--user','show','-p','LoadState','--value',UNIT],text=True).strip()
    if state!='loaded':
        raise ValueError('Benutzerdienst fehlt.')
    manifest=json.loads((KIT/'manifest.json').read_bytes())
    pairs=json.loads((KIT/'erebor-parallel.json').read_bytes())
    for path in (directory/'erebor-stations.json',kube/'config/erebor-stations.json'):
        survey=json.loads(path.read_bytes())
        if survey['version']!=pairs['version'] or len(pairs['sites'])!=37 or {s['site']:s['cannon'] for s in survey['sites']}!={s['site']:s['main'] for s in pairs['sites']}:
            raise ValueError('Standorte weichen ab: '+str(path))
    files=[(directory/n,n) for n in ('campus_erebor.py','campus_cannon.py','erebor-parallel.json')]
    files += [(kube/'config/erebor-parallel.json','erebor-parallel.json'),(kube/'server_scripts/campus/erebor-target-chunks.js','erebor-target-chunks.js')]
    changes=[]
    for path,name in files:
        src=(KIT/name).read_bytes()
        spec=manifest[name]
        backup=path.with_name(path.name+'.before-parallel-v3')
        if digest(src)!=spec['new'] or path.is_symlink() or backup.is_symlink() or not path.parent.is_dir():
            raise ValueError('Paket oder Ziel prüfen: '+str(path))
        if name.endswith('.py'):
            compile(src,name,'exec')
        old=path.read_bytes() if path.exists() else None
        if old is None and spec['old']:
            raise ValueError('Bestehendes Modul fehlt: '+str(path))
        if old is not None and digest(old) not in spec['old']+[spec['new']]:
            raise ValueError('Unbekannte Hostversion: '+str(path))
        if backup.exists() and digest(backup.read_bytes()) not in spec['old']+[spec['new']]:
            raise ValueError('Sicherung prüfen: '+str(backup))
        if action=='rollback':
            if old is None or digest(old)!=spec['new']:
                continue
            if not backup.exists() and spec['old']:
                continue  # Already identical before this installation.
            new=backup.read_bytes() if backup.exists() else None
        else:
            if old is not None and digest(old)==spec['new']:
                continue
            if old is not None and backup.exists() and backup.read_bytes()!=old:
                raise ValueError('Sicherung unterscheidet sich vom Ausgangsstand: '+str(backup))
            new=src
        changes.append((path,old,new,backup,path.stat().st_mode&0o777 if old is not None else 0o644))
    if action=='check' or not changes:
        print('Prüfung OK. '+('Installation möglich.' if changes else 'Gewünschter Stand vorhanden.'))
        return
    applied=[]
    def write(path,data,mode):
        if data is None:
            path.unlink()
        else:
            atomic(path,data,mode)
    def restart():
        subprocess.run(['systemctl','--user','restart',UNIT],check=True)
        subprocess.run(['systemctl','--user','is-active','--quiet',UNIT],check=True)
    try:
        for path,old,new,backup,mode in changes:
            if action=='install' and old is not None and not backup.exists():
                atomic(backup,old,mode)
            write(path,new,mode)
            applied.append((path,old,mode))
        restart()
    except Exception:
        for path,old,mode in reversed(applied):
            write(path,old,mode)
        if applied:
            restart()
        raise
    print('Benutzerdienst aktiv. Minecraft liest das Zielchunk-Skript beim nächsten Serverstart.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('check','install','rollback'))
    try:
        deploy(parser.parse_args().action)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        raise SystemExit(str(exc))
