"""Urnen V2 for the Erebor Homebox. Install over the verified V1 module."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time

V1 = 'd6fc78de01f44cb44727a9051ee22e38d0f23d2f92787234ffd38f6b34ff80ea'
REGISTRY = 'erebor-urn-targets-v2.json'


def atomic(path, data, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
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


def urn_station(catalog, key, folder):
    if not isinstance(key,str) or not re.fullmatch(r'K\d\d[B-R]?',key):
        raise ValueError('Unbekannter Kanonenplatz.')
    site,slot=key[:3],key[3:]
    origin=next(s for s in catalog['sites'] if s['site']==site)
    if not slot:
        return origin
    pair=json.loads((folder/'erebor-parallel.json').read_text())
    row=next(s for s in pair['sites'] if s['site']==site)
    if pair['version']!=12 or row['main']!=origin['cannon']:
        raise ValueError('Abweichender Standortplan.')
    if slot in ('B','C'):
        return dict(cannon=row[slot])
    found=[]
    for name in ('k09-groups.json','expansion-groups.json','finishing-groups.json'):
        path=folder/name
        if not path.exists():
            continue
        data=json.loads(path.read_text())
        if data['version']!=12:
            raise ValueError('Abweichender Gruppenplan.')
        for s in data.get('sites',[data]):
            if s['site']==site:
                found.extend(g['slots'][slot] for g in s['groups'] if slot in g['slots'])
    if len(found)!=1:
        raise ValueError('Zusatzkanone nicht eindeutig im installierten Standortplan.')
    return dict(cannon=found[0])


def remember(bridge,key,desired):
    # Signed controller calls run under the existing host mutex.
    path=bridge.base/'data/kubejs/config'/REGISTRY
    jobs=json.loads(path.read_text())
    now=int(time.time()*1000)
    prior=jobs.get(key,{})
    same=prior.get('file')==desired['file'] and prior.get('pos')==desired['anchor']
    if not same or prior.get('until',0)<now+60000:
        jobs[key]={'file':desired['file'],'pos':desired['anchor'],'until':now+600000}
        atomic(path,json.dumps(jobs,separators=(',',':')).encode(),0o644)
    return not same


def change(text,old,new):
    if text.count(old)!=1:
        raise ValueError('Installierte Schnittstelle nicht eindeutig: '+old.splitlines()[0])
    return text.replace(old,new)


def module_v2(source):
    text=change(source,"report['urnPreparation'] = 1","report['urnPreparation'] = 2 if report.get('urnTargetTracker') == 2 else 0")
    text=change(text,"match[1] != obj['site']","match[1] != obj['site'][:3]")
    text=change(text,"station = next(s for s in catalog['sites'] if s['site'] == obj['site'])",
                "from campus_urns_v2 import urn_station, remember\n        station = urn_station(catalog,obj['site'],Path(__file__).parent)")
    text=change(text,"if not condition(bridge, prefix):\n                return dict(applied=False, urnDeferred=True, reason='Chunk ungeladen')",
                "if remember(bridge,obj['site'],desired) or not condition(bridge,prefix):\n                return dict(applied=False,urnWarming=True,reason='Zielchunk lädt')")
    return text


TRACK = """
  var urnRequests = {}
  function trackUrn(chunks,station,row,item,c,campusInput) {
    var job=urnRequests[station.site]
    if(!job || !row.ready || !job.pos || job.pos.length!==3) return false
    var p=new BlockPos(job.pos[0],job.pos[1],job.pos[2])
    if(station.pos.distSqr(p)>=256*256) return false
    var anchor=item.get(Components.SCHEMATIC_ANCHOR), size=item.get(Components.SCHEMATIC_BOUNDS)
    var match=campusInput && row.upload===job.file && anchor && anchor.equals(p) && size &&
      size.getX()===1 && size.getY()===1 && size.getZ()===1 &&
      String(item.get(Components.SCHEMATIC_DEPLOYED))==='true' &&
      String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase()==='none' &&
      String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase()==='none'
    if(match || (row.empty && row.state==='STOPPED' && Number(job.until)>Date.now())) {
      chunks.addRegionTicket(ticket,new ChunkPos(p),2,station.pos)
    }
    return !!match
  }
"""


def tracker_v2(text):
    text=change(text,'  var stations = []',TRACK+'\n  var stations = []')
    text=change(text,'    var report={}',"    if(ticks%40===0 || ticks===10) urnRequests=JsonIO.read('kubejs/config/"+REGISTRY+"')||{}\n    var report={}")
    old='    if (((row.empty && !preserveDigReceipt)'
    new="""    if (trackUrn(chunks,station,row,item,c,campusInput)) {
      if ((Number(c.replaceMode)===2 || Number(c.replaceMode)===1) &&
          !c.replaceBlockEntities && !c.skipMissing) {
        c.replaceMode=0
        c.setChanged()
        c.sendData()
      }
    } else if (((row.empty && !preserveDigReceipt)"""
    text=change(text,old,new)
    return change(text,"'kubejs/config/erebor-target-live.json',{version:survey.version,",
                  "'kubejs/config/erebor-target-live.json',{version:survey.version,urnTargetTracker:2,")


def container_for(base):
    def docker(*args):
        return subprocess.check_output(['docker',*args],text=True,timeout=25).strip()
    matches=[]
    for cid in docker('ps','-q').split():
        mounts=json.loads(docker('inspect','--format','{{json .Mounts}}',cid))
        if any(m['Destination']=='/data' and Path(m['Source']).resolve()==base/'data' for m in mounts):
            matches.append(cid)
    if len(matches)!=1:
        raise ValueError('Laufenden ATM10-Container mit diesem /data-Mount prüfen.')
    docker('exec',matches[0],'sh','-c','command -v rcon-cli')
    return matches[0]


def install(action,base):
    import fcntl
    host=base/'discord'
    kube=base/'data/kubejs'
    tracker=kube/'server_scripts/campus/erebor-target-chunks.js'
    module=host/'campus_urns.py'
    helper=host/'campus_urns_v2.py'
    config=kube/'config'/REGISTRY
    report=kube/'config/erebor-target-live.json'
    controller=host/'campus_erebor.py'
    lock=os.open(host,os.O_RDONLY)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        for path in (tracker,module,helper,config,controller):
            if path.resolve()!=path:
                raise ValueError('Unerwarteter Dateipfad: '+str(path))
        if 'from campus_urns import with_urns' not in controller.read_text():
            raise ValueError('Zuerst Urnen V1 auf der Homebox installieren.')
        changes=[]
        for path,make in ((module,module_v2),(tracker,tracker_v2)):
            old=path.read_bytes()
            backup=path.with_name(path.name+'.before-urnen-v2')
            if backup.is_symlink():
                raise ValueError('Unerwarteter Sicherungspfad.')
            before=backup.read_bytes() if backup.exists() else old
            if path==module and hashlib.sha256(before).hexdigest()!=V1:
                raise ValueError('Installiertes Urnenmodul weicht von V1 ab.')
            new=make(before.decode()).encode()
            if path==module:
                compile(new,str(path),'exec')
            if old!=new:
                if old!=before:
                    raise ValueError('Datei seit der Sicherung geändert: '+str(path))
                changes.append((path,old,new))
        payload=Path(__file__).read_bytes()
        if helper.exists() and helper.read_bytes()!=payload:
            raise ValueError('Abweichendes V2-Modul am Zielpfad.')
        if config.exists() and not isinstance(json.loads(config.read_text()),dict):
            raise ValueError('Ungültige Zielchunk-Liste.')
        container=container_for(base)
        unit=['systemctl','--user']
        service='atm10-control.service'
        subprocess.run([*unit,'is-active','--quiet',service],check=True)
        if action=='check':
            print('V1, Tracker, Benutzerdienst und Minecraft-Container geprüft.')
            return
        if not config.exists():
            atomic(config,b'{}',0o644)
        if not helper.exists():
            atomic(helper,payload,0o644)
        def reload():
            subprocess.run(['docker','exec',container,'rcon-cli','minecraft:reload'],check=True,timeout=90)
        written=[]
        try:
            for path,old,new in changes:
                mode=path.stat().st_mode & 0o777
                backup=path.with_name(path.name+'.before-urnen-v2')
                if not backup.exists():
                    atomic(backup,old,mode)
                atomic(path,new,mode)
                written.append((path,old,mode))
            def live():
                try:
                    data=json.loads(report.read_text())
                    return data.get('urnTargetTracker')==2 and 0<=time.time()*1000-data['at']<20000
                except (OSError,ValueError,KeyError):
                    return False
            if changes or not live():
                subprocess.run([*unit,'restart',service],check=True)
                reload()
            for attempt in range(45):
                if live():
                    subprocess.run([*unit,'is-active','--quiet',service],check=True)
                    print('Urnen V2 aktiv. Minecraft meldet den neuen Zielchunk-Tracker.')
                    return
                time.sleep(2)
            raise RuntimeError('Keine frische V2-Meldung vom Minecraft-Tracker.')
        except BaseException:
            for path,old,mode in reversed(written):
                atomic(path,old,mode)
            if written:
                subprocess.run([*unit,'restart',service],check=True)
                reload()
            raise
    finally:
        os.close(lock)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['check','install'])
    parser.add_argument('--base',type=Path,default=Path.home()/'minecraft/atm10')
    args=parser.parse_args()
    install(args.action,args.base.resolve(strict=True))
