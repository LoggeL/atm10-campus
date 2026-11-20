"""Enable verified Erebor room plans on auxiliary cannons. Uses the existing Urnen V2 station survey."""
import argparse
import base64
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOM = re.compile(r'EREBOR_(?:E(?:0[5-9]|1[0-46-9]|21[AB]|3[0-9])|S[1-4])_(BAU|AUSHUB)_(K[0-9]{2})_X(-?[0-9]+)_Y(-?[0-9]+)_Z(-?[0-9]+)_R[0-9]+')
HOOK = '\nfrom campus_interior import wrap as _campus_interior\nhandle = _campus_interior(handle)\n'

def wrap(original):
    def handle(bridge, action, obj, **kwargs):
        key = obj.get('site','')
        if action == 'erebor-live':
            data = original(bridge, action, obj, **kwargs)
            data['interiorHelpers'] = 1
            return data
        desired = obj.get('desired') or {}
        match = ROOM.fullmatch(desired.get('blueprint',''))
        if not match or not re.fullmatch(r'K[0-9]{2}[B-R]',key) or action not in ('erebor-prepare','erebor-start'):
            return original(bridge, action, obj, **kwargs)
        from campus_erebor import validate_clear
        from campus_schematic import prepare_schematic
        from campus_start import validate_target, start
        from campus_urns_v2 import urn_station
        fields = {'desired','site','version','kind','size'}
        if action=='erebor-prepare':
            fields.add('nbtBase64')
        clear = match[1]=='AUSHUB'
        anchor = list(map(int,match.groups()[2:]))
        if (set(obj)!=fields or desired.get('version')!=12 or obj['version']!=12 or key[:3]!=match[2] or
            obj['kind']!=('clear' if clear else 'build') or obj['size']!=[32,32,32] or desired.get('anchor')!=anchor):
            raise ValueError('Innenplan, Standort oder Anker abweichend.')
        folder=Path(__file__).parent
        sites=json.loads((folder/'erebor-stations.json').read_text())
        if sites['version']!=12:
            raise ValueError('Standortplan geändert.')
        pos=urn_station(sites,key,folder)['cannon']
        if math.hypot(*(max(abs(a-b),abs(a+31-b)) for a,b in zip(anchor,pos)))>=256:
            raise ValueError('Innenplan außerhalb der Reichweite.')
        opts={'replace_mode':3 if clear else 2,'replace_block_entities':False,'skip_missing':False}
        binding=dict(zip(('x','y','z'),pos),dimension='minecraft:overworld',owner='Erebor')
        validate_target(binding,desired,opts,erebor_clear=clear)
        if action=='erebor-prepare':
            if len(obj['nbtBase64'])>350000:
                raise ValueError('Innenplan zu groß.')
            data=base64.b64decode(obj['nbtBase64'],validate=True)
            if hashlib.sha256(data).hexdigest()!=desired['sha256']:
                raise ValueError('Prüfsumme des Innenplans abweichend.')
            return prepare_schematic(bridge,binding,desired,obj['nbtBase64'],opts,obj['size'],erebor_kind=obj['kind'])
        observed=bridge.inspect(binding)
        if observed.get('components',{}).get('create:schematic_bounds')!=obj['size'] or bridge.file_hash('Erebor',desired['file'])!=desired['sha256']:
            raise ValueError('Innenplan wurde gewechselt.')
        if clear:
            validate_clear((bridge.base/'data/schematics/uploaded/Erebor'/desired['file']).read_bytes(),obj['size'])
        return start(bridge,binding,desired,opts,observed,erebor_clear=clear,bounds=obj['size'])
    return handle

def atomic(path,data,mode):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        temp=Path(f.name)
        try:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        finally:
            f.close()
    try:
        temp.chmod(mode)
        os.replace(temp,path)
    finally:
        temp.unlink(missing_ok=True)

def install(base):
    folder=base/'discord'
    fd=os.open(folder,os.O_RDONLY)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        controller=folder/'campus_erebor.py'
        module=folder/'campus_interior.py'
        backup=folder/'campus_erebor.py.before-interior'
        if any(p.is_symlink() for p in (controller,module,backup)) or not (folder/'campus_urns_v2.py').is_file():
            raise ValueError('Urnen V2 und reguläre Controllerdateien erforderlich.')
        old=controller.read_bytes()
        payload=Path(__file__).read_bytes()
        if module.exists() and module.read_bytes()!=payload:
            raise ValueError('Vorhandenes Innenausbaumodul wurde geändert.')
        service=['systemctl','--user']
        if HOOK.encode() in old and module.exists():
            subprocess.run(service+['is-active','--quiet','atm10-control.service'],check=True)
            return
        if backup.exists() and backup.read_bytes()!=old:
            raise ValueError('Controller seit der Sicherung geändert.')
        new=old+HOOK.encode()
        compile(new,str(controller),'exec')
        compile(payload,str(module),'exec')
        subprocess.run(service+['is-active','--quiet','atm10-control.service'],check=True)
        atomic(backup,old,controller.stat().st_mode&0o777)
        atomic(module,payload,0o644)
        atomic(controller,new,controller.stat().st_mode&0o777)
        try:
            subprocess.run(service+['restart','atm10-control.service'],check=True)
            subprocess.run(service+['is-active','--quiet','atm10-control.service'],check=True)
        except BaseException:
            atomic(controller,old,backup.stat().st_mode&0o777)
            subprocess.run(service+['restart','atm10-control.service'],check=True)
            raise
    finally:
        os.close(fd)

if __name__=='__main__':
    args=argparse.ArgumentParser()
    args.add_argument('--base',type=Path,default=Path.home()/'minecraft/atm10')
    install(args.parse_args().base.resolve(strict=True))
