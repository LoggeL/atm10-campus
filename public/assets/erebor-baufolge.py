"""Homebox extension for published Erebor landscape and later architecture stages."""
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys

SURFACE = re.compile(r'EREBOR_HAUT_R(-?[0-9]+)_(-?[0-9]+)_X(-?[0-9]+)_Y(-?[0-9]+)_Z(-?[0-9]+)')
ROOM = re.compile(r'EREBOR_(?:E[0-3][0-9][AB]?|S[1-4])(?:_AUSBAU)?_(AUSHUB|BAU)_(K[0-9]{2})_X(-?[0-9]+)_Y(-?[0-9]+)_Z(-?[0-9]+)_R[0-9]+')
HOOK = b'\nfrom campus_baufolge import wrap as _campus_baufolge\nhandle = _campus_baufolge(handle)\n'

def describe(name, key):
    surface = SURFACE.fullmatch(name)
    if surface:
        rx, rz, x, y, z = map(int, surface.groups())
        if (x // 512, z // 512) != (rx, rz):
            raise ValueError('Landschaftsregion stimmt nicht mit dem Anker überein.')
        return 'surface', [x, y, z], 0
    room = ROOM.fullmatch(name)
    if room and room[2] == key[:3]:
        clear = room[1] == 'AUSHUB'
        return ('clear' if clear else 'build'), list(map(int, room.groups()[2:])), (3 if clear else 2)
    return None

def wrap(previous):
    def handle(bridge, action, obj, **kwargs):
        if action == 'erebor-live':
            data = previous(bridge, action, obj, **kwargs)
            data['ereborProjectWork'] = 1
            return data
        key = obj.get('site', '')
        desired = obj.get('desired') or {}
        if action not in ('erebor-prepare', 'erebor-start') or not re.fullmatch(r'K(?:0[1-9]|[12][0-9]|3[0-7])[B-R]?', key):
            return previous(bridge, action, obj, **kwargs)
        spec = describe(desired.get('blueprint', ''), key)
        if not spec or (len(key)==3 and spec[0]!='surface'):
            return previous(bridge, action, obj, **kwargs)
        from campus_erebor import validate_clear
        from campus_urns_v2 import urn_station
        from campus_schematic import prepare_schematic
        from campus_start import validate_target, start
        kind, anchor, mode = spec
        fields = {'site', 'desired', 'size', 'kind', 'version'}
        if action == 'erebor-prepare':
            fields.add('nbtBase64')
        folder = Path(__file__).parent
        survey = json.loads((folder / 'erebor-stations.json').read_text())
        if (set(obj) != fields or survey['version'] != 12 or obj['version'] != 12 or desired.get('version') != 12
                or obj['kind'] != kind or obj['size'] != [32,32,32] or desired.get('anchor') != anchor
                or any(n % 32 for n in anchor) or not -64 <= anchor[1] <= 288):
            raise ValueError('Erebor-Bauplan, Bauhöhe oder Version abweichend.')
        pos = urn_station(survey, key, folder)['cannon']
        if math.hypot(*(max(abs(a-b), abs(a+31-b)) for a,b in zip(anchor,pos))) >= 256:
            raise ValueError('Bauplan außerhalb der Kanonenreichweite.')
        options = {'replace_mode':mode, 'replace_block_entities':False, 'skip_missing':False}
        binding = dict(zip(('x','y','z'),pos),dimension='minecraft:overworld',owner='Erebor')
        validate_target(binding,desired,options,erebor_clear=kind=='clear')
        if action == 'erebor-prepare':
            if len(obj['nbtBase64']) > 350000:
                raise ValueError('Erebor-Datei zu groß.')
            blob = base64.b64decode(obj['nbtBase64'],validate=True)
            if hashlib.sha256(blob).hexdigest() != desired['sha256']:
                raise ValueError('Prüfsumme stimmt nicht.')
            return prepare_schematic(bridge,binding,desired,obj['nbtBase64'],options,obj['size'],erebor_kind=kind)
        observed = bridge.inspect(binding)
        if observed.get('components',{}).get('create:schematic_bounds') != obj['size'] or bridge.file_hash('Erebor',desired['file']) != desired['sha256']:
            raise ValueError('Der Bauplan im Eingabefach hat gewechselt.')
        if kind=='clear':
            validate_clear((bridge.base/'data/schematics/uploaded/Erebor'/desired['file']).read_bytes(),obj['size'])
        return start(bridge,binding,desired,options,observed,erebor_clear=kind=='clear',bounds=obj['size'])
    return handle

def install(folder):
    controller = folder/'campus_erebor.py'
    module = folder/'campus_baufolge.py'
    backup = folder/'campus_erebor.py.before-baufolge'
    if any(p.is_symlink() for p in (controller,module,backup)) or not (folder/'campus_interior.py').is_file():
        raise ValueError('Installiertes Innenausbaumodul erforderlich.')
    sys.path.insert(0,str(folder))
    from campus_interior import atomic
    service = ['systemctl','--user']
    fd=os.open(folder,os.O_RDONLY)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        old=controller.read_bytes()
        new=old+HOOK
        payload=Path(__file__).read_bytes()
        if module.exists() and module.read_bytes()!=payload:
            raise ValueError('Lokale Moduldatei weicht vom Installer ab.')
        if HOOK in old and module.exists():
            subprocess.run(service+['is-active','--quiet','atm10-control.service'],check=True)
            return
        if HOOK in old or (backup.exists() and backup.read_bytes()!=old):
            raise ValueError('Controller und Sicherung bitte abgleichen.')
        compile(new,str(controller),'exec')
        compile(payload,str(module),'exec')
        subprocess.run(service+['is-active','--quiet','atm10-control.service'],check=True)
        mode=controller.stat().st_mode&0o777
        atomic(backup,old,mode)
        atomic(module,payload,0o644)
        atomic(controller,new,mode)
        try:
            subprocess.run(service+['restart','atm10-control.service'],check=True)
            subprocess.run(service+['is-active','--quiet','atm10-control.service'],check=True)
        except BaseException:
            atomic(controller,old,mode)
            subprocess.run(service+['restart','atm10-control.service'],check=True)
            raise
    finally:
        os.close(fd)

if __name__=='__main__':
    install(Path.home()/'minecraft/atm10/discord')
