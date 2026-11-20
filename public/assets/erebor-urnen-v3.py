"""Erebor V12: install sparse urn packs alongside the existing V2 and optional extensions."""
import argparse
import base64
import gzip
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time

REGISTRY = 'erebor-urn-packs-v3.json'
HOOK = '\nfrom campus_urn_packs import wrap as _campus_urn_packs\nhandle = _campus_urn_packs(handle)\n'
NAME = re.compile(r'EREBOR_STEIN_(K\d\d)_MASSIV_M_URN_PACK_([0-9a-f]{24})_V12')
OPTIONS = dict(replace_mode=0, skip_missing=False, replace_block_entities=False)


def targets(data, desired, size, cannon):
    if (not isinstance(size, list) or len(size) != 3 or
            any(type(n) is not int or not 1 <= n <= 128 for n in size) or math.prod(size) > 65536):
        raise ValueError('Unzulässiger Druckbereich.')
    if len(data) > 16384 or hashlib.sha256(data).hexdigest() != desired['sha256']:
        raise ValueError('Prüfsumme oder Größe des Urnenpakets abweichend.')
    origin = desired['anchor']
    if math.prod((origin[i]+size[i]-1)//16-origin[i]//16+1 for i in (0,2)) > 16:
        raise ValueError('Zu viele Zielchunks.')
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as archive:
        raw = archive.read(16385)
    if len(raw) > 16384:
        raise ValueError('Urnenpaket zu groß.')
    # Decode only the exact canonical stoneNBT grammar. Explicit air, other
    # palettes, entities, per-block NBT and additional tags are all rejected.
    stream = io.BytesIO(raw)
    def expect(b):
        if stream.read(len(b)) != b:
            raise ValueError('Ungültiges Stein-NBT.')
    def name(t, text):
        b = text.encode()
        return bytes([t])+struct.pack('>H', len(b))+b
    def ints(*values):
        return struct.pack('>'+'i'*len(values), *values)
    expect(b'\x0a\0\0'+name(3,'DataVersion')+ints(3955)+name(9,'size')+b'\x03'+ints(3,*size))
    expect(name(9,'palette')+b'\x0a'+ints(1)+name(8,'Name')+b'\0\x0fminecraft:stone\0')
    expect(name(9,'blocks')+b'\x0a')
    count = struct.unpack('>i',stream.read(4))[0]
    if not 2 <= count <= 256:
        raise ValueError('Unzulässige Zielanzahl.')
    points = []
    for _ in range(count):
        expect(name(9,'pos')+b'\x03'+ints(3))
        local = struct.unpack('>iii',stream.read(12))
        expect(name(3,'state')+ints(0)+b'\0')
        p = [a+b for a,b in zip(origin,local)]
        if any(not 0 <= v < limit for v,limit in zip(local,size)) or not -64 <= p[1] <= 319 or math.dist(p,cannon) >= 256:
            raise ValueError('Urnenziel außerhalb der Freigabe.')
        points.append(p)
    expect(name(9,'entities')+b'\x0a'+ints(0)+b'\0')
    digest = hashlib.sha256(json.dumps(points,separators=(',',':')).encode()).hexdigest()[:24]
    if (stream.read(1) or len(set(map(tuple,points))) != count or
            any(min(p[i] for p in points)!=origin[i] or max(p[i] for p in points)!=origin[i]+size[i]-1 for i in range(3))
            or NAME.fullmatch(desired['blueprint'])[2] != digest):
        raise ValueError('Urnenliste und Bauplanname passen nicht zusammen.')
    return points


def registry(bridge, key, desired, size, points, arm=False):
    from campus_urns_v2 import atomic
    path = bridge.base/'data/kubejs/config'/REGISTRY
    jobs = json.loads(path.read_text())
    prior = jobs.get(key, {})
    same = prior.get('file') == desired['file'] and prior.get('points') == points and prior.get('pos') == desired['anchor']
    now = int(time.time()*1000)
    if not same or (arm and not prior.get('armed')) or prior.get('until',0) < now+60000:
        jobs[key] = dict(file=desired['file'],pos=desired['anchor'],size=size,points=points,
                         until=now+600000,armed=arm or bool(same and prior.get('armed')))
        atomic(path,json.dumps(jobs,separators=(',',':')).encode(),0o644)


def ack(bridge,key,file):
    report = json.loads((bridge.base/'data/kubejs/config/erebor-target-live.json').read_text())
    row = report.get('stations',{}).get(key,{})
    if (report.get('version') == 12 and report.get('urnPackTracker') == 3 and
            0 <= time.time()*1000-report['at'] < 15000 and row.get('packFile') == file):
        return row.get('packState')


def wrap(previous):
    def handle(bridge,action,obj,**kwargs):
        def other():
            return previous(bridge,action,obj,**kwargs) if kwargs else previous(bridge,action,obj)
        if action == 'erebor-live':
            result=other()
            if result.get('urnPreparation')==2 and result.get('urnPackTracker')==3:
                result['urnPacks']=3
            return result
        desired=obj.get('desired') or {}
        if action not in ('erebor-prepare','erebor-start') or '_URN_PACK_' not in desired.get('blueprint',''):
            return other()
        from campus_urns_v2 import urn_station
        from campus_schematic import prepare_schematic
        from campus_start import validate_target, verify, start
        key=obj['site']
        fields={'desired','site','version','kind','size'} | ({'nbtBase64'} if action=='erebor-prepare' else set())
        match=NAME.fullmatch(desired['blueprint'])
        if set(obj)!=fields or not match or match[1]!=key[:3] or obj['version']!=12 or desired['version']!=12 or obj['kind']!='stone':
            raise ValueError('Ungültiger Urnenauftrag.')
        folder=Path(__file__).parent
        layout=json.loads((folder/'erebor-stations.json').read_text())
        if layout['version']!=12:
            raise ValueError('Erebor-Standorte abweichend.')
        cannon=urn_station(layout,key,folder)['cannon']
        binding=dict(zip(('x','y','z'),cannon),dimension='minecraft:overworld',owner='Erebor')
        validate_target(binding,desired,OPTIONS)
        size=obj['size']
        if action=='erebor-prepare':
            encoded=obj['nbtBase64']
            if not isinstance(encoded,str) or len(encoded)>24000:
                raise ValueError('Urnenpaket zu groß.')
            points=targets(base64.b64decode(encoded,validate=True),desired,size,cannon)
            registry(bridge,key,desired,size,points)
            stage=ack(bridge,key,desired['file'])
            if stage=='changed':
                return dict(applied=False,urnDeferred=True,reason='Zielblock verändert')
            if stage not in ('valid','clear'):
                return dict(applied=False,urnWarming=True,reason='Zielchunks oder Weltprüfung ausstehend')
            return prepare_schematic(bridge,binding,desired,encoded,OPTIONS,size,erebor_kind='stone')
        observed=bridge.inspect(binding)
        verify(bridge,binding,desired,OPTIONS,observed)
        if observed['components'].get('create:schematic_bounds')!=size:
            raise ValueError('Abweichender Druckbereich.')
        path=bridge.base/'data/schematics/uploaded/Erebor'/desired['file']
        if path.is_symlink() or path.stat().st_size>16384:
            raise ValueError('Unpassende Urnendatei.')
        points=targets(path.read_bytes(),desired,size,cannon)
        if observed['state']!='RUNNING':
            from campus_start import start_command
            start_command(binding,desired,OPTIONS,observed,size)
            registry(bridge,key,desired,size,points,arm=True)
            for _ in range(10):
                if ack(bridge,key,desired['file'])=='clear':
                    break
                time.sleep(0.4)
            else:
                return dict(started=False,observed=observed)
        return start(bridge,binding,desired,OPTIONS,observed,bounds=size)
    return handle


TRACK = """
  var packRequests = {}
  var PackAir = Java.loadClass('net.minecraft.world.level.block.Blocks').AIR
  function trackPack(level,chunks,station,row,item,c,campusInput) {
    var job=packRequests[station.site]
    if(!job || !row.ready || !job.points || job.points.length<2 || job.points.length>256) return false
    var p=position(job.pos), size=item.get(Components.SCHEMATIC_BOUNDS), anchor=item.get(Components.SCHEMATIC_ANCHOR)
    var match=campusInput && row.upload===job.file && anchor && anchor.equals(p) && size &&
      size.getX()===job.size[0] && size.getY()===job.size[1] && size.getZ()===job.size[2] && String(item.get(Components.SCHEMATIC_DEPLOYED))==='true' &&
      String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase()==='none' &&
      String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase()==='none'
    if(!match && !(row.empty && row.state==='STOPPED' && Number(job.until)>Date.now())) return false
    row.packFile=job.file
    var held={}, ready=true, pts=[]
    for(var i=0;i<job.points.length;i++){
      var a=job.points[i], q=position(a)
      if(station.pos.distSqr(q)>=65536 || station.pos.distSqr(p)>=65536) return false
      var x=a[0]>>4,z=a[2]>>4,key=x+','+z
      if(!held[key]){
        chunks.addRegionTicket(ticket,new ChunkPos(q),2,station.pos)
        held[key]=true
        if(!chunks.getChunkNow(x,z)) ready=false
      }
      pts.push(q)
    }
    if(!ready || (match && row.state==='RUNNING')) return !!match
    var urns=[]
    for(var j=0;j<pts.length;j++){
      var state=level.getBlockState(pts[j]), id=String(Registries.BLOCK.getKey(state.getBlock()))
      if(id==='supplementaries:urn') urns.push(pts[j])
      else if(['minecraft:air','minecraft:cave_air','minecraft:void_air','minecraft:stone'].indexOf(id)<0){
        row.packState='changed'
        return !!match
      }
    }
    row.packState='valid'
    if(match && job.armed && Number(job.until)>Date.now() && Number(c.replaceMode)===0 && !c.replaceBlockEntities && !c.skipMissing &&
       Number(c.blocksPlaced)===0 && c.flyingBlocks.isEmpty() &&
       (row.state==='STOPPED'||row.state==='PAUSED' && (row.status==='ready'||row.status==='noGunpowder'))){
      // All targets were checked together on this server tick. Consume stone through Create.
      var cleared=true
      for(var u=0;u<urns.length;u++){
        if(String(Registries.BLOCK.getKey(level.getBlockState(urns[u]).getBlock()))!=='supplementaries:urn'){cleared=false;continue}


        if(!level.setBlock(urns[u],PackAir.defaultBlockState(),3)) cleared=false
      }
      if(cleared) row.packState='clear'
    }
    return !!match
  }
"""


def install(action,base):
    import fcntl
    folder=base/'discord'
    sys.path.insert(0,str(folder))
    from campus_urns_v2 import atomic,change,container_for
    controller=folder/'campus_erebor.py'
    module=folder/'campus_urn_packs.py'
    tracker=base/'data/kubejs/server_scripts/campus/erebor-target-chunks.js'
    config=base/'data/kubejs/config'/REGISTRY
    report=config.with_name('erebor-target-live.json')
    payload=Path(__file__).read_bytes()
    lock=os.open(folder,os.O_RDONLY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for path in (controller,module,tracker,config):
            if path.resolve()!=path: raise ValueError('Unerwarteter Pfad: '+str(path))
        before=controller.read_text()
        if 'from campus_urns import with_urns' not in before: raise ValueError('Installierte Urnen V2 erforderlich.')
        if module.exists() and module.read_bytes()!=payload: raise ValueError('Abweichendes Paketmodul vorhanden.')
        if config.exists() and not isinstance(json.loads(config.read_text()),dict): raise ValueError('Paketregister ungültig.')
        old=tracker.read_text()
        text=old
        if 'urnPackTracker:3' not in old:
            text=change(text,'  var urnRequests = {}',TRACK+'\n  var urnRequests = {}')
            text=change(text,'    if (trackUrn(chunks,','    if (trackPack(level,chunks,station,row,item,c,campusInput) || trackUrn(chunks,')
            text=change(text,'    var report={}',"    if(ticks%40===0 || ticks===10) packRequests=JsonIO.read('kubejs/config/"+REGISTRY+"')||{}\n    var report={}")
            text=change(text,'urnTargetTracker:2,','urnTargetTracker:2,urnPackTracker:3,')
        elif TRACK not in old or 'trackPack(level,chunks,station,row,item,c,campusInput) || trackUrn(' not in old:
            raise ValueError('Abweichender V3-Tracker vorhanden.')
        source=before if HOOK in before else before+HOOK
        compile(source,str(controller),'exec')
        compile(payload,str(module),'exec')
        cid=container_for(base)
        unit=['systemctl','--user']
        service='atm10-control.service'
        subprocess.run([*unit,'is-active','--quiet',service],check=True)
        if action=='check':
            print('Vorprüfung erfolgreich.')
            return
        def live():
            try:
                r=json.loads(report.read_text())
                return r.get('urnPackTracker')==3 and r.get('urnTargetTracker')==2 and 0<=time.time()*1000-r['at']<20000
            except (OSError,ValueError,KeyError): return False
        def restart():
            subprocess.run([*unit,'restart',service],check=True)
            subprocess.run(['docker','exec',cid,'rcon-cli','minecraft:reload'],check=True,timeout=90)
        written=[]
        try:
            if not config.exists(): atomic(config,b'{}',0o644)
            if not module.exists(): atomic(module,payload,0o644)
            for path,new in ((tracker,text),(controller,source)):
                oldbytes=path.read_bytes()
                if oldbytes==new.encode(): continue
                backup=path.with_name(path.name+'.before-urn-packs-v3')
                if backup.is_symlink() or backup.exists() and backup.read_bytes()!=oldbytes:
                    raise ValueError('V3-Sicherung abweichend: '+str(backup))
                mode=path.stat().st_mode&0o777
                if not backup.exists(): atomic(backup,oldbytes,mode)
                atomic(path,new.encode(),mode)
                written.append((path,oldbytes,mode))
            if written or not live(): restart()
            for _ in range(45):
                if live():
                    subprocess.run([*unit,'is-active','--quiet',service],check=True)
                    print('Urnen-Sammelpläne V3 bereit. Campus übernimmt offene Pakete automatisch.')
                    return
                time.sleep(2)
            raise RuntimeError('Keine aktuelle V3-Meldung vom Minecraft-Tracker.')
        except BaseException:
            for path,data,mode in reversed(written): atomic(path,data,mode)
            if written: restart()
            raise
    finally: os.close(lock)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=('check','install'))
    p.add_argument('--base',type=Path,default=Path.home()/'minecraft/atm10')
    args=p.parse_args()
    install(args.action,args.base.resolve(strict=True))
