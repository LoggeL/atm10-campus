"""Keep published additive Erebor schematics out of the legacy stone-mode rule."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import threading
import time
import uuid

REGISTRY = 'erebor-surface-inputs.json'
HOOK = b'\nfrom campus_surface_mode import wrap as _surface_mode\nhandle = _surface_mode(handle)\n'
GUARD = """
    var surface = surfaceInputs[station.site]
    var surfaceAnchor = item.get(Components.SCHEMATIC_ANCHOR)
    var surfaceSize = item.get(Components.SCHEMATIC_BOUNDS)
    var surfaceMatch = surface && campusInput && row.upload===surface.file && surfaceAnchor && surfaceSize &&
      surfaceSize.getX()===32 && surfaceSize.getY()===32 && surfaceSize.getZ()===32 &&
      surfaceAnchor.getX()===surface.pos[0] && surfaceAnchor.getY()===surface.pos[1] && surfaceAnchor.getZ()===surface.pos[2] &&
      String(item.get(Components.SCHEMATIC_DEPLOYED))==='true' &&
      String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase()==='none' &&
      String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase()==='none'
    if(surfaceMatch || (surface && row.empty && row.state==='STOPPED' && row.status==='finished')) {
      if(Number(c.replaceMode)!==0 && !c.replaceBlockEntities && !c.skipMissing) {
        c.replaceMode=0
        c.setChanged()
        c.sendData()
      }
    } else """

def identity(pos, sha):
    x,y,z = pos
    name = f'EREBOR_HAUT_R{x//512}_{z//512}_X{x}_Y{y}_Z{z}.nbt'
    raw = bytearray(hashlib.sha256((name+'\n'+sha).encode()).digest()[:16])
    raw[6] = raw[6] & 15 | 128
    raw[8] = raw[8] & 63 | 128
    return 'campus_'+str(uuid.UUID(bytes=bytes(raw)))+'.nbt'

def wrap(previous):
    lock = threading.Lock()
    known, last = {}, None
    def handle(bridge, action, obj, **kw):
        nonlocal last
        data = previous(bridge, action, obj, **kw)
        if action != 'erebor-live' or not data.get('stations') or abs(time.time()*1000-data['at'])>20000:
            return data
        if not lock.acquire(blocking=False):
            return data
        try:
            if last == data['at']:
                return data
            from campus_interior import atomic
            path = bridge.base/'data/kubejs/config'/REGISTRY
            old = json.loads(path.read_text()) if path.exists() else {}
            selected = {}
            for key, row in data['stations'].items():
                file, pos = row.get('upload',''), row.get('anchor')
                if row.get('empty') and row.get('state')=='STOPPED' and row.get('status')=='finished':
                    if key in old and (row.get('finish') or {}).get('file')==old[key]['file']:
                        selected[key]=old[key]
                    continue
                if (not row.get('aligned') or row.get('owner')!='Erebor' or row.get('size')!=[32,32,32] or
                        not isinstance(pos,list) or len(pos)!=3 or any(type(n)!=int or n%32 for n in pos) or
                        not re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt',file)):
                    continue
                k=(file,*pos)
                if k not in known:
                    sha=bridge.file_hash('Erebor',file)
                    if not sha:
                        continue
                    known[k]=identity(pos,sha)==file
                if known[k]:
                    selected[key]={'file':file,'pos':pos}
            if selected!=old:
                atomic(path,json.dumps(selected,separators=(',',':')).encode(),0o644)
            last=data['at']
        except (OSError, ValueError):
            pass  # A failed sample cannot authorise another input.
        finally:
            lock.release()
        return data
    return handle

def update_tracker(text):
    from campus_urns_v2 import change
    text=change(text,'  var stations = []',"  var surfaceInputs = {}\n  var stations = []")
    text=change(text,'    var report={}',"    if(ticks%40===0 || ticks===10) surfaceInputs=JsonIO.read('kubejs/config/"+REGISTRY+"')||{}\n    var report={}")
    prefix='if (trackPack(level,chunks,' if '    if (trackPack(level,chunks,' in text else 'if (trackUrn(chunks,'
    text=change(text,'    '+prefix,GUARD+prefix)
    return change(text,"urnTargetTracker:2,","surfaceModeTracker:1,urnTargetTracker:2,")

def install(base):
    import fcntl
    import sys
    host=base/'discord'
    sys.path.insert(0,str(host))
    from campus_interior import atomic
    from campus_urns_v2 import container_for
    kube=base/'data/kubejs'
    tracker=kube/'server_scripts/campus/erebor-target-chunks.js'
    controller=host/'campus_erebor.py'
    extension=host/'campus_surface_mode.py'
    with_lock=os.open(host,os.O_RDONLY)
    try:
        fcntl.flock(with_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if not (host/'campus_baufolge.py').is_file() or any(p.is_symlink() for p in (extension,controller,tracker)):
            raise ValueError('Aktives Baufolgemodul und reguläre Installationsdateien erforderlich.')
        previous=controller.read_bytes()
        before=tracker.read_bytes()
        content=Path(__file__).read_bytes()
        if extension.exists():
            installed=extension.read_bytes()
            # A rolled-back first installation can leave the original published module.
            # Its imported tracker code is identical. Only its installer used the old command.
            if installed!=content and hashlib.sha256(installed).hexdigest()!='e3741b055b12f8d7545cbe284d6c16ee7e5a35194eb12b8ab246eddbb03725e7':
                raise ValueError('Abweichende lokale Moduldatei.')
        after=before if b'surfaceModeTracker:1' in before else update_tracker(before.decode()).encode()
        new=previous if HOOK in previous else previous+HOOK
        compile(new,str(controller),'exec')
        def healthy():
            try:
                r=json.loads((kube/'config/erebor-target-live.json').read_text())
                return r.get('surfaceModeTracker')==1 and 0<=time.time()*1000-r['at']<15000
            except (OSError,ValueError,KeyError):
                return False
        service=['systemctl','--user']
        unit='atm10-control.service'
        subprocess.run([*service,'is-active','--quiet',unit],check=True)
        if after==before and previous==new and extension.exists() and healthy():
            print('Außenhaut-Modus bereits aktiv.')
            return
        container=container_for(base)
        reload_cmd=['docker','exec',container,'rcon-cli','reload']
        registry=kube/'config'/REGISTRY
        if not registry.exists():
            atomic(registry,b'{}',0o644)
        if not extension.exists():
            atomic(extension,content,0o644)
        changed=[]
        try:
            for path,old,result in [(tracker,before,after),(controller,previous,new)]:
                if old==result: continue
                mode=path.stat().st_mode & 0o777
                backup=path.with_name(path.name+'.before-surface-mode')
                if not backup.exists(): atomic(backup,old,mode)
                atomic(path,result,mode)
                changed.append((path,old,mode))
            subprocess.run([*service,'restart',unit],check=True)
            subprocess.run(reload_cmd,check=True,timeout=90)
            for _ in range(45):
                if healthy():
                    subprocess.run([*service,'is-active','--quiet',unit],check=True)
                    print('Außenhaut-Modus vom Minecraft-Tracker bestätigt.')
                    return
                time.sleep(2)
            raise RuntimeError('Keine aktuelle Bestätigung des Minecraft-Trackers.')
        except BaseException:
            for path,old,mode in reversed(changed): atomic(path,old,mode)
            if changed:
                subprocess.run([*service,'restart',unit],check=True)
                subprocess.run(reload_cmd,check=True,timeout=90)
            raise
    finally:
        os.close(with_lock)

if __name__=='__main__':
    install(Path.home()/'minecraft/atm10')
