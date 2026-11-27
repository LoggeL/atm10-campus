"""Homebox service for the nine Esgaroth Schematicannons."""
import argparse
import base64
import fcntl
import getpass
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import zipfile
from pathlib import Path

from legacy import container_name, mount_data, request, jsonwrite
from host import Console, power_command, world_directory, write_file
from campus_cannon import CannonBridge
from campus_start import start, verify
from campus_schematic import prepare_schematic

BASE = "/api/projects/erebor/wasserstadt/betrieb"
SITES = {
    "P01": (92,[960,192,-9278],[960,192,-9279],[960,192,-9277],[[959,192,-9279],[960,192,-9280],[961,192,-9279]]),
    "P02": (94,[770,191,-9280],[769,191,-9280],[771,191,-9280],[[768,191,-9280],[769,191,-9281],[769,191,-9279]]),
    "P03": (93,[1152,191,-9278],[1152,191,-9279],[1152,191,-9277],[[1151,191,-9279],[1152,191,-9280],[1153,191,-9279]])}
ROOT = Path.home()/".local/share/campus-wasserstadt"
STOP = threading.Event()
LOCK = threading.Lock()
BUDGET = {}
SUPPLY = {}

def read(path, default):
    try: return json.loads(path.read_text())
    except FileNotFoundError: return default

def api(token,slot,route,**fields):
    return json.loads(request(token,BASE+"/"+slot+"/"+route,dict(baseVersion=12,computer=SITES[slot[:3]][0],**fields)))

def setup_pc(console,root,site):
    cid,pc,chest,bridge,places=SITES[site]
    row=dict(computer=pc,chest=chest,bridge=bridge,cannon=places[0],computerBlock="computercraft:computer_advanced",inventoryBlock="sophisticatedstorage:netherite_chest")
    if console.computer(row)!=cid: raise ValueError(site+" Computer-ID oder Hardware abweichend.")
    disk=root/str(cid)
    if disk.is_symlink() or not disk.is_dir(): raise ValueError("Computerdisk fehlt: "+site)
    with zipfile.ZipFile(sys.argv[0]) as archive: lua=archive.read("feeder.lua")
    # Keep the existing campus.lua so its identity and the stock guard's enrolment survive.
    boot=b'-- Campus Wasserstadt Dauerbetrieb\nshell.run("/wasserstadt.lua")\n'
    if (disk/"startup").is_file(): names=["startup"]
    else: names=["startup.lua"]
    if (disk/"startup").is_file() and (disk/"startup.lua").is_file(): raise ValueError("Zwei Startprogramme bei "+site)
    name=names[0]; startup=disk/name
    if startup.is_symlink() or (disk/"wasserstadt.lua").is_symlink() or not (disk/"campus.lua").is_file():
        raise ValueError("Unbekannte CC-Installation bei "+site)
    old=startup.read_bytes() if startup.is_file() else b''
    if old and not any(n in old.lower() for n in (b'campus',b'watercity',b'wasserstadt')): raise ValueError("Fremdes Startprogramm bei "+site)
    if old==boot and (disk/"wasserstadt.lua").is_file() and (disk/"wasserstadt.lua").read_bytes()==lua:
        console.run(power_command(row,cid,"turn-on"));return disk
    backup=ROOT/"sicherung"/site
    backup.mkdir(parents=True,exist_ok=True)
    if old and old!=boot and not (backup/name).exists(): (backup/name).write_bytes(old)
    console.run(power_command(row,cid,"shutdown"))
    for _ in range(30):
        if console.number(pc,"On")==0: break
        time.sleep(.3)
    else: raise ValueError("Computer reagiert nicht: "+site)
    try:
        write_file(disk/"wasserstadt.lua",lua,disk.stat())
        write_file(startup,boot,disk.stat())
    finally: console.run(power_command(row,cid,"turn-on"))
    return disk

class Tickets:
    def __init__(self,console):
        self.console=console
        self.lock=threading.Lock()
        self.uses={}
        self.path=ROOT/"tickets.json"
        self.owned=set(read(self.path,[]))
    def set(self,owner,points):
        chunks={f"{(x//16)*16} {(z//16)*16}" for x,_,z in points}
        with self.lock:
            existing=set().union(*self.uses.values())
            for at in sorted(chunks-existing):
                if self.console.success("forceload add "+at):
                    self.owned.add(at);jsonwrite(self.path,sorted(self.owned))
                elif not self.console.success("forceload query "+at): raise ValueError("Chunk fehlt "+at)
            self.uses[owner]=chunks
            for at in sorted(self.owned-set().union(*self.uses.values())):
                if self.console.success("forceload remove "+at) or not self.console.success("forceload query "+at):
                    self.owned.remove(at);jsonwrite(self.path,sorted(self.owned))

def refill(disks):
    while not STOP.is_set():
        stamp=time.time()
        with LOCK: entries=dict(BUDGET)
        desired={site:{} for site in disks}
        generations={site:[] for site in disks}
        for slot,(at,row) in entries.items():
            if stamp-at>90: continue
            site=slot[:3]
            generations[site].append(str(row["id"]))
            stock=desired[site];stock["minecraft:gunpowder"]=64
            for item,n in row["job"]["materials"].items():
                stock[item]=min(512,stock.get(item,0)+min(n,192))
        reports={}
        for site,disk in disks.items():
            generation=",".join(sorted(generations[site]))
            try:
                r=read(disk/".wc-report",{})
                if (r.get("generation")==generation and r.get("computer")==SITES[site][0]
                    and 0 <= stamp-r.get("at",0)/1000 < 20): reports[site]=r
            except (OSError,ValueError): pass
        with LOCK: SUPPLY.clear();SUPPLY.update(reports)
        craft={site:{} for site in disks}
        needs={}
        for site,r in sorted(reports.items()):
            for item,m in r.get("missing",{}).items():
                if item in desired[site] and m.get("reason")=="ME_RESERVE" and isinstance(m.get("need"),int):
                    needs.setdefault(item,[]).append((site,min(m["need"],desired[site][item])))
        leaders=sorted(s for s,r in reports.items() if generations[s] and not r.get("error"))
        if leaders:
            for item,sites in needs.items():
                craft[leaders[0]][item]=sum(n for _,n in sites)
        for site,disk in disks.items():
            jsonwrite(disk/".wc-request",dict(computer=SITES[site][0],generation=",".join(sorted(generations[site])),
                      targets=desired[site],craft=craft[site],expires=int(time.time()*1000)+9000))
        STOP.wait(2)

def checked(row,slot):
    job=row["job"];d=job["desired"];phase=job["phase"]
    pos=SITES[slot[:3]][4][ord(slot[-1])-65]
    if (phase not in ("clear","build") or not re.fullmatch(r'E2[56]_\d{3}',row["part"])
        or not d["blueprint"].startswith("EREBOR_"+row["part"][:3]+("_AUSHUB_" if phase=="clear" else "_BAU_"))
        or d["owner"]!="Erebor" or d["version"]!=12 or d["rotation"]!="none" or d["mirror"]!="none"
        or d["options"]!={"replace_mode":3 if phase=="clear" else 2,"skip_missing":False,"replace_block_entities":False}
        or job["size"]!=[32]*3 or sum(max(abs(n-p),abs(n+31-p))**2 for n,p in zip(d["anchor"],pos))>=256**2):
        raise ValueError("Ungültiger Campusauftrag für "+slot)
    return row

def service_slot(token,slot,bridge,tickets,rec,rows):
    site=slot[:3]; pos=SITES[site][4][ord(slot[-1])-65]
    binding=dict(zip(("x","y","z"),pos),dimension="minecraft:overworld",owner="Erebor")
    o=bridge.inspect(binding)
    if slot not in rows:
        native={}
        if o["inputEmpty"] is False and o["fileHash"]:
            comp=o["components"]
            native={"input":{"file":comp.get("create:schematic_file"),"anchor":comp.get("create:schematic_anchor"),"sha":o["fileHash"]}}
        preview=api(token,slot,"plan",dryRun=True,**native)
        if not preview.get("job"): return
        checked(preview,slot)
        if not o["inputEmpty"] and o["fileHash"]!=preview["job"]["desired"]["sha256"]:
            raise ValueError("Anderer Plan im Eingang von "+slot)
        name=preview["job"]["desired"]["blueprint"]
        rows[slot]=checked(api(token,slot,"plan",dryRun=False,expect=name,**native),slot)
    row=rows[slot];job=row["job"];d=dict(job["desired"]);opt=d.pop("options")
    x,y,z=d["anchor"]
    tickets.set(slot,[(a,y,b) for a in (x,x+31) for b in (z,z+31)])
    key=str(row["id"])
    if rec.get("id")!=key: rec.clear();rec.update(id=key,placed=0)
    journal=ROOT/(slot+".json")
    def report(state,detail="",**more):
        return api(token,slot,"meldung",id=row["id"],sha=d["sha256"],state=state,placed=rec["placed"],
                   total=o.get("amountToPlace"),detail=detail,**more)
    def finish():
        rows.pop(slot,None)
        with LOCK: BUDGET.pop(slot,None)
        tickets.set(slot,[])
    if o["inputEmpty"] is True:
        native=(rec.get("seen") and o["state"]=="STOPPED" and o["status"]=="finished" and o["flyingBlocks"]==0
            and o["outputItem"]=="create:empty_schematic" and o["outputCount"]==rec.get("base",-2)+1)
        if native:
            if report("FINISHED",witness=True,outputBefore=rec["base"],outputAfter=o["outputCount"])["closed"]: finish()
            return
        if not rec.get("checked") or rec.get("seen"):
            if report("CHECK")["closed"]: finish();return
            if rec.get("seen") or row.get("adopted"): raise ValueError("Alter Plan fehlt im Eingang; warte auf bestätigten Weltstand")
            rec["checked"]=True
        data=request(token,f'/api/projects/erebor/architecture/{row["part"]}/{d["blueprint"]}.nbt?version=12&revision=5')
        if hashlib.sha256(data).hexdigest()!=d["sha256"]: raise ValueError("Hash stimmt nicht")
        o=prepare_schematic(bridge,binding,d,base64.b64encode(data).decode(),opt,job["size"],erebor_kind=job["phase"])["observed"]
    verify(bridge,binding,d,opt,o)
    if o["components"].get("create:schematic_bounds")!=job["size"]: raise ValueError("Bauplangröße abweichend")
    if not rec.get("seen"):
        rec.update(seen=True,base=o["outputCount"]);jsonwrite(journal,rec)
    with LOCK:
        BUDGET[slot]=(time.time(),row)
        supply=SUPPLY.get(site,{})
    if o["flyingBlocks"]==0 and (o["state"]=="STOPPED" or (o["state"]=="PAUSED" and o["status"]=="ready")):
        o=start(bridge,binding,d,opt,o,erebor_clear=job["phase"]=="clear",bounds=job["size"])["observed"]
    rec["placed"]=max(rec["placed"],o["amountPlaced"])
    jsonwrite(journal,rec)
    detail=str(o["status"])+" · "+json.dumps({k:supply[k] for k in ("missing","orders","error") if k in supply},ensure_ascii=False)
    report(o["state"] if o["state"] in ("RUNNING","PAUSED") else "LOADED",detail)

def site_loop(token,site,container,base,tickets):
    console=Console(container);bridge=CannonBridge(base,console.run)
    slots=[site+c for c in "ABC"];records={s:read(ROOT/(s+".json"),{}) for s in slots};rows={}
    while not STOP.is_set():
        for s in slots:
            if STOP.is_set():break
            try: service_slot(token,s,bridge,tickets,records[s],rows)
            except Exception as e:
                print(s,str(e),flush=True)
                if s in rows:
                    try:
                        r=rows[s]
                        api(token,s,"meldung",id=r["id"],sha=r["job"]["desired"]["sha256"],state="WAIT",
                            placed=records[s].get("placed",0),detail=str(e))
                    except Exception as report_error: print(s,report_error,flush=True)
        STOP.wait(3)

def daemon(token):
    container=container_name();data=mount_data(container);root=world_directory(container)
    legacy=root.parent/".campus-p02";legacy.mkdir(exist_ok=True)
    with (legacy/"lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        old=read(data/"kubejs/config/watercity-active.json",{})
        if old.get("expires",0)>time.time()*1000: raise ValueError("Vorheriger Wasserstadt-Controller hat noch eine gültige Freigabe.")
        console=Console(container);tickets=Tickets(console);disks={}
        base=ROOT/"bridge";base.mkdir(exist_ok=True)
        link=base/"data"
        if not link.exists():link.symlink_to(data,target_is_directory=True)
        if link.resolve()!=data:raise ValueError("Minecraft-Datenträger wurde gewechselt")
        try:
            tickets.set("stations",[p for _,pc,chest,bridge,cannons in SITES.values() for p in [pc,chest,bridge,*cannons]]+[[315,315,-9649]])
            for site in SITES: disks[site]=setup_pc(console,root,site)
            workers=[threading.Thread(target=site_loop,args=(token,s,container,base,tickets),daemon=True) for s in SITES]
            for w in workers:w.start()
            try: refill(disks)
            finally:
                STOP.set()
                for w in workers:w.join(35)
        finally:
            for owner in list(tickets.uses):tickets.set(owner,[])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--install",action="store_true");parser.add_argument("--run",action="store_true")
    flags=parser.parse_args()
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    secret=ROOT/"campus-token"
    if flags.install:
        token=os.environ.get("CAMPUS_TOKEN") or (secret.read_text().strip() if secret.is_file() else getpass.getpass("Campus-Schreibschlüssel: ").strip())
        api(token,"P02A","plan",dryRun=True)
        dst=ROOT/"wasserstadt.pyz"
        if Path(sys.argv[0]).resolve()!=dst: shutil.copyfile(sys.argv[0],dst)
        with os.fdopen(os.open(secret,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600),"w") as f:f.write(token)
        unit=Path.home()/".config/systemd/user/campus-wasserstadt.service"
        unit.parent.mkdir(parents=True,exist_ok=True)
        unit.write_text('[Unit]\nDescription=Campus Wasserstadt P01-P03\nAfter=network-online.target\n[Service]\nExecStart=/usr/bin/python3 "%h/.local/share/campus-wasserstadt/wasserstadt.pyz" --run\nRestart=always\nRestartSec=12\n[Install]\nWantedBy=default.target\n')
        for args in (["daemon-reload"],["enable","campus-wasserstadt.service"],["restart","campus-wasserstadt.service"]):
            subprocess.run(["systemctl","--user",*args],check=True)
    elif flags.run:
        signal.signal(signal.SIGTERM,lambda *_:STOP.set())
        daemon(secret.read_text().strip())
    else:parser.error("--install zum Einrichten oder --run für den Dienst verwenden")

if __name__=="__main__":main()
