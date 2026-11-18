"""K09 only: install a reviewed, context-matched controller delta and two new CC feeders."""
import argparse
import difflib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE=Path(__file__).resolve().parent
def patched(current,old,new):
    # Keep unrelated local fixes (e.g. chunk loading); never apply ambiguous edits.
    if current==new:return current
    a,b=old.splitlines(True),new.splitlines(True)
    out=current
    for ops in difflib.SequenceMatcher(None,a,b,autojunk=False).get_grouped_opcodes(3):
        before=''.join(a[ops[0][1]:ops[-1][2]])
        after=''.join(b[ops[0][3]:ops[-1][4]])
        if after and out.count(after)==1:continue
        if not before or out.count(before)!=1:raise ValueError('Installierter Quelltext weicht im K09-Änderungsbereich ab.')
        out=out.replace(before,after,1)
    return out

def atomic(path,data,mode):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        tmp=Path(f.name)
        try:
            f.write(data);f.flush();os.fsync(f.fileno());os.chmod(tmp,mode)
        except BaseException:
            tmp.unlink(missing_ok=True);raise
    try: os.replace(tmp,path)
    finally: tmp.unlink(missing_ok=True)

def host_files(base):
    folders=[base/'discord',base/'data/kubejs/server_scripts/campus',base/'data/kubejs/config']
    extra=(HERE/'k09-groups.json').read_bytes()
    out=[]
    for path in (folders[0]/'campus_erebor.py',folders[1]/'erebor-target-chunks.js',
                 folders[0]/'k09-groups.json',folders[2]/'k09-groups.json'):
        if path.is_symlink() or path.parent.resolve()!=path.parent: raise ValueError('Unerwarteter Zielpfad: '+str(path))
        old=path.read_bytes() if path.exists() else None
        if path.suffix=='.json':
            if old is not None and old!=extra:raise ValueError('Abweichender K09-Standortplan: '+str(path))
            new=extra
        else:
            if old is None:raise ValueError('Hostdatei fehlt: '+str(path))
            new=patched(old.decode(),(HERE/('before-'+path.name)).read_text(),(HERE/path.name).read_text()).encode()
            if path.suffix=='.py':compile(new,path.name,'exec')
        if old!=new:out.append((path,old,new,path.stat().st_mode&0o777 if old is not None else 0o644))
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','install'])
    p.add_argument('--container');p.add_argument('--base',type=Path,default=Path('/home/logge/minecraft/atm10'))
    args=p.parse_args()
    spec=importlib.util.spec_from_file_location('fleet',HERE/'fleet.py');fleet=importlib.util.module_from_spec(spec);spec.loader.exec_module(fleet)
    base=args.base.resolve()
    if not args.container:
        names=subprocess.check_output(['docker','ps','--format','{{.Names}}'],text=True).splitlines()
        matched=[]
        for name in names:
            mounts=json.loads(fleet.docker('inspect','--format','{{json .Mounts}}',name))
            if any(m['Destination']=='/data' and Path(m['Source']).resolve()==base/'data' for m in mounts):matched.append(name)
        if len(matched)!=1:raise ValueError('Minecraft-Container nicht eindeutig, --container NAME angeben.')
        args.container=matched[0]
    root=fleet.world_directory(args.container)
    if base/'data' not in root.parents:raise ValueError('Container gehört nicht zu diesem Server.')
    cfg=json.loads((HERE/'k09-groups.json').read_text())
    layout=json.loads((base/'discord/erebor-stations.json').read_text())
    old=next(r for r in layout['sites'] if r['site']=='K09')
    if cfg['version']!=layout['version'] or cfg['bridge']!=old['bridge']:raise ValueError('Standortplan ist nicht aktuell.')
    rows=[{**old,'site':g['name'],'computer':g['computer'],'chest':g['chest'],'cannon':next(iter(g['slots'].values())),'slots':g['slots']} for g in cfg['groups']]
    c=fleet.Console(args.container)
    def check():
        for r in rows:
            c.computer(r)
            for pos in r['slots'].values():
                if not c.run('execute if block '+fleet.xyz(pos)+' create:schematicannon run data get block '+fleet.xyz(pos)+' id').rstrip('"').endswith('create:schematicannon'):
                    raise ValueError('Kanone fehlt bei '+fleet.xyz(pos))
    changes=host_files(base)
    unit=['systemctl','--user'];service='atm10-control.service'
    subprocess.run([*unit,'is-active','--quiet',service],check=True)
    if args.action=='check':
        check(); print('K09: sechs Zusatzkanonen, zwei Rechner und Kisten gefunden. Hostdateien zu ändern:',len(changes));return
    with fleet.loaded(c,rows):
        check();ids=fleet.identify(c,rows);old_id=c.computer(old)
        if old_id is None or old_id in ids.values():raise ValueError('Ursprünglicher K09-Rechner ist nicht eindeutig getrennt.')
        disks={name:fleet.check_disk(root,cid,False) for name,cid in ids.items()}
        key=os.environ.get('CAMPUS_STATION_TOKEN')
        if not key:
            saved=root/str(old_id)/fleet.TOKEN_FILE
            if saved.resolve()==saved and saved.is_file(): key=saved.read_text().strip()
        if not key:
            import getpass
            key=getpass.getpass('Campus Station-Token: ').strip()
        if fleet.api('/api/me',key).get('scope')!='station':raise ValueError('Station-Token erforderlich.')
        registry=fleet.api('/api/cannons',key)
        old_rows={r['name']:r for r in registry}
        for name,cid in ids.items():
            for r in registry:
                prior=(r.get('status') or {}).get('computerId')
                if (r['name']=='erebor-'+name and prior not in (None,cid)) or (prior==cid and r['name']!='erebor-'+name):
                    raise ValueError('Computer-ID oder Stationsname bereits anders belegt.')
        backup=Path(tempfile.mkdtemp(prefix='.k09-before-',dir=base/'discord'))
        print('Sicherung:',backup,flush=True)
        for path,olddata,_,_ in changes:
            if olddata is not None:(backup/(path.parent.name+'-'+path.name)).write_bytes(olddata)
        applied=[]
        try:
            for path,olddata,data,mode in changes:
                atomic(path,data,mode);applied.append((path,olddata,mode))
            if changes:subprocess.run([*unit,'restart',service],check=True)
            subprocess.run([*unit,'is-active','--quiet',service],check=True)
        except BaseException:
            for path,olddata,mode in reversed(applied):
                if olddata is None:path.unlink(missing_ok=True)
                else:atomic(path,olddata,mode)
            if applied:subprocess.run([*unit,'restart',service],check=False)
            raise
        for row in rows:
            name=row['site'];cid=ids[name]
            if c.computer(row)!=cid:raise ValueError(name+': Rechner versetzt.')
            c.run(fleet.power_command(row,cid,'shutdown'))
            try:
                for _ in range(30):
                    if c.number(row['computer'],'On')==0:break
                    time.sleep(.25)
                else:raise ValueError(name+': Rechner nicht angehalten.')
                fleet.install_disk(disks[name],name,(HERE/'campus.lua').read_bytes(),key,backup)
            finally:c.run(fleet.power_command(row,cid,'turn-on'))
        if changes:
            msg=c.run('kubejs reload server_scripts')
            print('KubeJS:',msg[:280])
        end=time.monotonic()+105;pending=set(ids)
        while time.monotonic()<end:
            for row in fleet.api('/api/cannons',key):
                name=row['name'].removeprefix('erebor-');s=row.get('status') or {}
                if name in ids and row.get('online') and s.get('computerId')==ids[name] and s.get('at')!=(old_rows.get(row['name'],{}).get('status') or {}).get('at') and s.get('chestSide'):
                    pending.discard(name)
            livefile=base/'data/kubejs/config/erebor-target-live.json'
            try:
                live=json.loads(livefile.read_text()); signals=live['stations']
                ready=0<=time.time()*1000-live['at']<30000 and all(signals.get('K09'+slot,{}).get('ready') and signals['K09'+slot].get('feederId')==ids[g['name']] for g in cfg['groups'] for slot in g['slots'])
            except (OSError,ValueError,KeyError):ready=False
            if not pending and ready:print('K09-N/S online und D–I live zugeordnet. Baufortschritt im Dashboard prüfen.');return
            time.sleep(4)
        raise ValueError('Installation geschrieben, aber Live-Bestätigung fehlt. KubeJS-Server-Skripte beim nächsten regulären Serverstart laden; bei Bedarf install erneut ausführen.')

if __name__=='__main__':
    try: main()
    except (OSError,RuntimeError,ValueError,subprocess.SubprocessError) as e:sys.exit(str(e))
