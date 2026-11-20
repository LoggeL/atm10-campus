"""Campus · Erebor V12. Run with check or install as the Homebox service owner."""
import base64
import gzip
import hashlib
import io
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

SINGLE_STONE = 'a90e779e2593fd7483703c44d4364065fd443b8bc5807e3d1c5190e82515c02b'
NAME = re.compile(r'EREBOR_STEIN_(K\d\d)_MASSIV_X\d\d_Z\d\d_URN_(-?\d+)_(-?\d+)_(-?\d+)_BE_V12')
OPTIONS = dict(replace_mode=0, skip_missing=False, replace_block_entities=False)
HOOK = """

# Campus Erebor: Urnen-Einzelziele V1
from campus_urns import with_urns as _campus_with_urns
handle = _campus_with_urns(handle)
"""


def check_bytes(data, digest):
    if len(data) > 1024 or hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('Urnenplan stimmt nicht mit dem veröffentlichten Hash überein.')
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        raw = stream.read(1025)
    if hashlib.sha256(raw).hexdigest() != SINGLE_STONE:
        raise ValueError('Der Urnenplan muss exakt einen Block minecraft:stone enthalten.')


def with_urns(previous):
    def handle(bridge, action, obj):
        if action == 'erebor-live':
            report = previous(bridge, action, obj)
            if report.get('version') == 12:
                report['urnPreparation'] = 1
            return report
        desired = obj.get('desired') or {}
        name = desired.get('blueprint', '')
        if action not in ('erebor-prepare', 'erebor-start') or '_URN_' not in name:
            return previous(bridge, action, obj)
        from campus_start import validate_target, verify, start_command, start
        from campus_discovery import condition
        from campus_schematic import prepare_schematic
        match = NAME.fullmatch(name)
        fields = {'desired','site','version','kind','size'}
        if action == 'erebor-prepare':
            fields.add('nbtBase64')
        if (set(obj) != fields or not match or match[1] != obj['site'] or obj['version'] != 12
                or desired.get('version') != 12 or obj['size'] != [1,1,1] or obj['kind'] != 'stone'
                or [int(n) for n in match.groups()[1:]] != desired.get('anchor')):
            raise ValueError('Urnenposition, Kanone oder Projektversion abweichend.')
        catalog = json.loads(Path(__file__).with_name('erebor-stations.json').read_text())
        station = next(s for s in catalog['sites'] if s['site'] == obj['site'])
        if catalog['version'] != 12:
            raise ValueError('Standortplan gehört nicht zu Erebor V12.')
        binding = dict(zip(('x','y','z'),station['cannon']), dimension='minecraft:overworld', owner='Erebor')
        validate_target(binding, desired, OPTIONS)
        pos = ' '.join(map(str, desired['anchor']))
        prefix = 'execute in minecraft:overworld if loaded ' + pos
        # Check before inserting the plan. A sleeping chunk or a changed target leaves the cannon free.
        if action == 'erebor-prepare':
            encoded = obj['nbtBase64']
            if not isinstance(encoded,str) or len(encoded) > 1400:
                raise ValueError('Urnenplan zu groß.')
            check_bytes(base64.b64decode(encoded,validate=True),desired['sha256'])
            if not condition(bridge, prefix):
                return dict(applied=False, urnDeferred=True, reason='Chunk ungeladen')
            allowed = ('supplementaries:urn','minecraft:air','minecraft:cave_air','minecraft:void_air','minecraft:stone')
            if condition(bridge, prefix+''.join(' unless block '+pos+' '+block for block in allowed)):
                return dict(applied=False, urnDeferred=True, reason='Zielblock hat sich geändert')
            return prepare_schematic(bridge,binding,desired,encoded,OPTIONS,[1,1,1],erebor_kind='stone')
        observed = bridge.inspect(binding)
        verify(bridge,binding,desired,OPTIONS,observed)
        if observed['components'].get('create:schematic_bounds') != [1,1,1]:
            raise ValueError('Eingelegter Plan umfasst mehr als einen Block.')
        path = bridge.base/'data/schematics/uploaded/Erebor'/desired['file']
        with path.open('rb') as handle_file:
            check_bytes(handle_file.read(1025),desired['sha256'])
        if observed['state'] != 'RUNNING':
            guard = start_command(binding,desired,OPTIONS,observed,[1,1,1]).split(' run data modify block ',1)[0]
            command = guard+' if loaded '+pos+' if block '+pos+' supplementaries:urn run setblock '+pos+' minecraft:air replace'
            if len(command.encode()) > 950:
                raise ValueError('Urnenprüfung überschreitet die RCON-Grenze.')
            bridge.run(command)
            if not condition(bridge, prefix) or condition(bridge, prefix+' if block '+pos+' supplementaries:urn'):
                raise ValueError('Urne oder Zielchunk noch nicht bereit.')
        return start(bridge,binding,desired,OPTIONS,observed,bounds=[1,1,1])
    return handle


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
        os.replace(tmp,path)
    finally:
        tmp.unlink(missing_ok=True)


def install(action, base):
    import ast
    import fcntl
    folder = base.resolve(strict=True)/'discord'
    unit = ['systemctl','--user']
    service = 'atm10-control.service'
    lock = os.open(folder,os.O_RDONLY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        controller = folder/'campus_erebor.py'
        module = folder/'campus_urns.py'
        backup = folder/'campus_erebor.py.before-urnen-v1'
        if any(p.is_symlink() for p in (folder,controller,module,backup)) or not controller.is_file():
            raise ValueError('Controllerpfad prüfen.')
        old = controller.read_bytes()
        source = old.decode()
        payload = Path(__file__).read_bytes()
        if module.exists() and module.read_bytes()!=payload:
            raise ValueError('Eine abweichende Urnen-Erweiterung ist bereits installiert.')
        if source.endswith(HOOK) and module.exists():
            subprocess.run([*unit,'is-active','--quiet',service],check=True)
            print('Urnen-Erweiterung bereits installiert, Benutzerdienst aktiv.')
            return
        if '_campus_with_urns' in source or not any(isinstance(n,ast.FunctionDef) and n.name=='handle' for n in ast.parse(source).body):
            raise ValueError('Vorhandenen Erebor-Einstiegspunkt prüfen.')
        for name in ('campus_start.py','campus_schematic.py','campus_discovery.py','erebor-stations.json'):
            if not (folder/name).is_file():
                raise ValueError('Fehlende Abhängigkeit: '+name)
        layout = json.loads((folder/'erebor-stations.json').read_text())
        if layout['version']!=12 or len(layout['sites'])!=37:
            raise ValueError('Erebor-V12-Standortplan fehlt.')
        new = old+HOOK.encode()
        compile(new,str(controller),'exec')
        compile(payload,str(module),'exec')
        if backup.exists() and backup.read_bytes()!=old:
            raise ValueError('Vorhandene Sicherung weicht vom laufenden Controller ab.')
        subprocess.run([*unit,'is-active','--quiet',service],check=True)
        if action=='check':
            print('Vorprüfung erfolgreich. 37 Standorte erkannt.')
            return
        mode=controller.stat().st_mode & 0o777
        if not backup.exists():
            atomic(backup,old,mode)
        atomic(module,payload,0o644)
        atomic(controller,new,mode)
        try:
            subprocess.run([*unit,'restart',service],check=True)
            subprocess.run([*unit,'is-active','--quiet',service],check=True)
        except BaseException:
            atomic(controller,old,mode)
            subprocess.run([*unit,'restart',service],check=True)
            raise
        print('Urnen-Erweiterung installiert, Benutzerdienst aktiv.')
    finally:
        os.close(lock)


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=('check','install'))
    parser.add_argument('--base',type=Path,default=Path.home()/'minecraft/atm10')
    args=parser.parse_args()
    install(args.action,args.base)
