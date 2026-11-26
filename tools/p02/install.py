"""Commission only the three western Esgaroth cannons. Run on the ATM10 Docker host."""
import argparse
import base64
from contextlib import contextmanager
import getpass
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError
from urllib.request import Request, build_opener
import uuid
import zipfile

from host import Console, NoRedirect, docker, identify, power_command, world_directory, write_file, xyz
from campus_cannon import CannonBridge
from campus_schematic import prepare_schematic
from campus_start import start, verify

URL = "https://campus.logge.top"
ROUTE = "/api/projects/erebor/wasserstadt/p02/reservierung"
POSITIONS = {"A":[768,191,-9280], "B":[769,191,-9281], "C":[769,191,-9279]}
PC = [770,191,-9280]
CHEST = [769,191,-9280]
BRIDGE = [771,191,-9280]
HUB = [315,315,-9649]
ROW = dict(site="P02", computer=PC, chest=CHEST, bridge=BRIDGE, cannon=POSITIONS["A"],
           computerBlock="computercraft:computer_advanced", inventoryBlock="sophisticatedstorage:netherite_chest")
BOOT = b'-- Campus Wasserstadt P02\nshell.run("/campus.lua")\n'

def request(token, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = Request(URL+path, data=data, headers={"Authorization":"Bearer "+token,"Content-Type":"application/json"})
    try:
        with build_opener(NoRedirect()).open(req,timeout=100) as response:
            return response.read()
    except HTTPError as e:
        raise ValueError(f"Campus HTTP {e.code}: {e.read(800).decode(errors='replace')}") from None

def plans(token, dry):
    payload=json.loads(request(token,ROUTE,{"dryRun":dry,"baseVersion":12}))
    rows=payload["rows"]
    if payload.get("version")!=12 or payload.get("revision")!=5 or payload.get("dryRun") is not dry or len(rows)!=6:
        raise ValueError("Unbekannter Campus-Paketstand.")
    index={}
    for r in rows:
        slot,phase=r["slot"],r["phase"]
        job=r["job"]
        d=dict(job["desired"])
        opt=d.pop("options")
        key=slot+"-"+phase
        if (slot not in POSITIONS or r["position"]!=POSITIONS[slot] or phase not in ("clear","build") or
                key in index or not d["blueprint"].startswith("EREBOR_E25_"+("BAU_" if phase=="build" else "AUSHUB_"))
                or job["size"]!=[32,32,32] or d["version"]!=12 or
                opt!={"replace_mode":2 if phase=="build" else 3,"skip_missing":False,"replace_block_entities":False}):
            raise ValueError("Unerwarteter Auftrag für P02.")
        index[key]=dict(r,desired=d,options=opt,key=key)
    if set(index)!={s+"-"+p for s in POSITIONS for p in ("clear","build")}:
        raise ValueError("Unvollständige Zuordnung.")
    return index

def container_name():
    override=os.environ.get("P02_CONTAINER")
    names=[override] if override else docker("ps","--format","{{.Names}}").splitlines()
    candidates=[]
    for name in names:
        try:
            docker("exec",name,"test","-f","/data/server.properties")
            docker("exec",name,"which","rcon-cli")
            candidates.append(name)
        except RuntimeError:
            continue
    if len(candidates)!=1:
        raise ValueError("Minecraft-Container nicht eindeutig. P02_CONTAINER auf dessen Namen setzen.")
    return candidates[0]

def binding(slot):
    return dict(zip(("x","y","z"),POSITIONS[slot]),dimension="minecraft:overworld",owner="Erebor")

def jsonwrite(path,obj):
    write_file(path,json.dumps(obj).encode(),path.parent.stat())

def mount_data(container):
    mounts=json.loads(docker("inspect","--format","{{json .Mounts}}",container))
    mount=next((m for m in mounts if m["Destination"]=="/data" and m["RW"]),None)
    if not mount: raise ValueError("Minecraft hat keinen beschreibbaren /data-Mount.")
    path=Path(mount["Source"]).resolve(strict=True)
    inside="/data/schematics/uploaded"
    uploads=path/"schematics/uploaded"
    if str(uploads.stat().st_ino)!=docker("exec",container,"stat","-c","%i",inside):
        raise ValueError("Schematic-Speicher auf dem Host und im Container unterscheiden sich.")
    return path

def check_manifest(data, rows):
    path=data/"kubejs/config/watercity-active.json"
    if not path.is_file(): raise ValueError("Vorhandene Wasserstadt-Betriebsdatei fehlt im gewählten Minecraft-Container.")
    doc=json.loads(path.read_text())
    if doc.get("version")!=12 or not isinstance(doc.get("jobs"),list): raise ValueError("Unbekannte Wasserstadt-Betriebsdatei.")
    files={r["desired"]["file"] for r in rows.values()}
    for job in doc["jobs"]:
        if str(job.get("key","")).startswith("P02") or job.get("desired",{}).get("file") in files or job.get("position") in POSITIONS.values():
            raise ValueError("Bestehender Wasserstadt-Controller verwaltet bereits einen P02-Platz oder einen Zielplan.")

@contextmanager
def tickets(console, rows):
    blocks={tuple(v) for v in [PC,CHEST,BRIDGE,HUB,*POSITIONS.values()]}
    for r in rows.values():
        x,y,z=r["desired"]["anchor"]
        blocks.update((a,y,b) for a in (x,x+31) for b in (z,z+31))
    owned=[]
    try:
        for cx,cz in sorted({(x//16,z//16) for x,_,z in blocks}):
            at=f"{cx*16} {cz*16}"
            if console.success("forceload add "+at): owned.append(at)
            elif not console.success("forceload query "+at): raise ValueError("Chunk nicht geladen: "+at)
        yield
    finally:
        for at in reversed(owned):
            try:
                if not console.success("forceload remove "+at): print("Chunk-Ticket prüfen:",at)
            except Exception as e: print("Chunk-Ticket prüfen:",at,e)
        console.run("data remove storage "+console.storage+" ok")

def install_pc(console,root,cid):
    disk=root/str(cid)
    if disk.is_symlink(): raise ValueError("CC-Pfad ist ein symbolischer Link.")
    disk.mkdir(exist_ok=True)
    if os.geteuid()==0 and not any(disk.iterdir()):
        os.chown(disk,root.stat().st_uid,root.stat().st_gid)
    with zipfile.ZipFile(sys.argv[0]) as z: feeder=z.read("feeder.lua")
    files={"campus.lua":feeder,"startup.lua":BOOT}
    for name in ["startup",*files,".p02-request.json",".p02-result.json"]:
        p=disk/name
        if p.is_symlink() or (name=="startup" and p.exists()) or (p.exists() and not p.is_file()):
            raise ValueError("Vorhandenes Startprogramm oder fremder Pfad: "+str(p))
        if name in files and p.exists() and p.read_bytes()!=files[name]:
            raise ValueError("Vorhandenes Programm bleibt erhalten: "+str(p))
    changed=any(not (disk/n).exists() for n in files)
    if changed:
        console.run(power_command(ROW,cid,"shutdown"))
        for _ in range(30):
            if console.number(PC,"On")==0: break
            time.sleep(.3)
        else: raise ValueError("P02-Computer konnte nicht angehalten werden.")
        try:
            for n,b in files.items(): write_file(disk/n,b,disk.stat())
        finally: console.run(power_command(ROW,cid,"turn-on"))
    else: console.run(power_command(ROW,cid,"turn-on"))
    return disk

def supply(disk,cid,targets,deadline=95):
    nonce=uuid.uuid4().hex
    end=time.monotonic()+deadline
    reason="Keine frische Antwort des Stationscomputers."
    path=disk/".p02-request.json"
    try:
        while time.monotonic()<end:
            jsonwrite(path,dict(computer=cid,run=nonce,expires=int(time.time()*1000)+9500,targets=targets))
            time.sleep(2)
            try: r=json.loads((disk/".p02-result.json").read_text())
            except (FileNotFoundError,ValueError): continue
            if r.get("run")!=nonce or r.get("computer")!=cid: continue
            if r.get("ready") is True: return
            reason=r.get("error") or str(r.get("missing"))
        raise ValueError("P02-Materialprüfung: "+reason+" · Connector 773/191/-9280, Hub 315/315/-9649.")
    finally: path.unlink(missing_ok=True)

def closed(o,rec):
    return (rec.get("seen") and o["inputEmpty"] is True and o["state"]=="STOPPED" and o["status"]=="finished"
            and o["flyingBlocks"]==0 and o.get("outputItem")=="create:empty_schematic"
            and o.get("outputCount")==rec.get("base",-100)+1)

def run(token,dry,rows):
    import fcntl
    container=container_name()
    data=mount_data(container)
    root=world_directory(container)
    state=root.parent/".campus-p02"
    if state.is_symlink(): raise ValueError("P02-Zustandspfad abweichend.")
    state.mkdir(mode=0o700,exist_ok=True)
    with (state/"lock").open("a") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        link=state/"data"
        if not link.exists(): link.symlink_to(data,target_is_directory=True)
        if link.resolve()!=data: raise ValueError("Minecraft-Datenträger seit dem ersten Lauf geändert.")
        check_manifest(data,rows)
        journal=state/"journal.json"
        j=json.loads(journal.read_text()) if journal.exists() else {}
        console=Console(container)
        bridge=CannonBridge(state,console.run)
        with tickets(console,rows):
            for _ in range(30):
                try: console.computer(ROW); break
                except ValueError: time.sleep(1)
            else: raise ValueError("P02-Computer, gemeinsame Netherite-Kiste oder ME Bridge an falscher Position.")
            obs={s:bridge.inspect(binding(s)) for s in POSITIONS}
            for s,o in obs.items():
                if o["inputEmpty"] is not True and not any(o["fileHash"]==r["desired"]["sha256"] and o["components"].get("create:schematic_file")==r["desired"]["file"] for r in rows.values() if r["slot"]==s):
                    raise ValueError("P02"+s+" hat einen fremden Bauplan im Eingang.")
            if dry: return
            cid=identify(console,[ROW])["P02"]
            if cid in (92,93) or j.get("computer",cid)!=cid: raise ValueError("Computer-ID kollidiert oder hat sich geändert.")
            disk=install_pc(console,root,cid)
            j["computer"]=cid
            for key,r in rows.items():
                old=j.get(key,{})
                if old and old["sha"]!=r["desired"]["sha256"]: raise ValueError("Reservierter Plan hat sich geändert.")
                j.setdefault(key,{"sha":r["desired"]["sha256"]})
            targets={"minecraft:gunpowder":64}
            for key,r in rows.items():
                if r["phase"]=="build" and not r["worldComplete"] and not j[key].get("done"):
                    for item,n in r["job"]["materials"].items(): targets[item]=targets.get(item,0)+n
            if not j.get("stocked"):
                print("P02 prüft ME-Verbindung und füllt die gemeinsame Kiste für alle drei Bauplätze.",flush=True)
                supply(disk,cid,targets)
                j["stocked"]=True
                jsonwrite(journal,j)
            confirmed=plans(token,False)
            if any(confirmed[k]["desired"]!=r["desired"] for k,r in rows.items()): raise ValueError("Baupläne während der Vorprüfung geändert.")
            rows=confirmed
            binaries={}
            for k,r in rows.items():
                d=r["desired"]
                path=f'/api/projects/erebor/architecture/{r["part"]}/{d["blueprint"]}.nbt?version=12&revision=5'
                data_bytes=request(token,path)
                if hashlib.sha256(data_bytes).hexdigest()!=d["sha256"]: raise ValueError("Prüfsumme abweichend: "+k)
                binaries[k]=base64.b64encode(data_bytes).decode()
            last_progress=time.monotonic()
            fuel_at=time.monotonic()
            last_print={}
            published={}
            witnessed=set()
            def report(r,stage,n):
                marker=(stage,n//64)
                if published.get(r["key"])==marker: return
                request(token,"/api/projects/erebor/wasserstadt/p02/meldung",dict(slot=r["slot"],phase=r["phase"],sha=r["desired"]["sha256"],stage=stage,placed=n,computer=cid))
                published[r["key"]]=marker
            while True:
                active=False
                for slot in POSITIONS:
                    b=binding(slot)
                    for phase in ("clear","build"):
                        key=slot+"-"+phase
                        r=rows[key]; rec=j[key]; d=r["desired"]; opts=r["options"]
                        if rec.get("done"): continue
                        o=bridge.inspect(b)
                        if r["worldComplete"] and o["inputEmpty"] and not rec.get("seen"):
                            report(r,"world-complete",0)
                            rec["done"]=True; jsonwrite(journal,j); continue
                        if closed(o,rec):
                            if key not in witnessed and not r["worldComplete"]:
                                raise ValueError(key+": Abschluss während der Unterbrechung. Nach dem nächsten Welt-Speichern erneut starten.")
                            report(r,"finished",rec.get("placed",0))
                            print(f"P02{slot} {phase}: nativer Abschluss bestätigt.",flush=True)
                            rec["done"]=True; jsonwrite(journal,j); last_progress=time.monotonic(); continue
                        if o["inputEmpty"]:
                            if rec.get("seen") or rec.get("intent"): raise ValueError(key+": Eingang nach Installation leer, Abschluss nicht eindeutig.")
                            rec["intent"]=True; jsonwrite(journal,j)
                            try:
                                prepared=prepare_schematic(bridge,b,d,binaries[key],opts,r["job"]["size"],erebor_kind=phase)
                            except Exception:
                                if bridge.inspect(b)["inputEmpty"]:
                                    rec.pop("intent",None); jsonwrite(journal,j)
                                raise
                            o=prepared["observed"]
                        verify(bridge,b,d,opts,o)
                        if o["components"].get("create:schematic_bounds")!=r["job"]["size"]:
                            raise ValueError(key+": native Abmessungen stimmen nicht.")
                        witnessed.add(key)
                        if not rec.get("seen"):
                            rec.update(seen=True,base=o["outputCount"]); jsonwrite(journal,j)
                        if o["state"]=="STOPPED" or (o["state"]=="PAUSED" and o["status"]=="ready"):
                            result=start(bridge,b,d,opts,o,erebor_clear=phase=="clear",bounds=r["job"]["size"])
                            o=result["observed"]
                        n=o["amountPlaced"]
                        if n>rec.get("placed",0):
                            rec["placed"]=n; jsonwrite(journal,j); last_progress=time.monotonic()
                        report(r,"working" if rec.get("placed",0)>0 else "loaded",rec.get("placed",0))
                        label=(phase,o["state"],o["status"],n)
                        if last_print.get(slot)!=label:
                            print(f"P02{slot} {phase} · {o['state']}/{o['status']} · {n} Blöcke",flush=True)
                            last_print[slot]=label
                        active=True
                        break
                if not active: print("P02A, P02B und P02C: alle drei Wasserstadt-Abschnitte fertig.",flush=True); return
                if time.monotonic()-fuel_at>45:
                    supply(disk,cid,{"minecraft:gunpowder":64},20)
                    fuel_at=time.monotonic()
                if time.monotonic()-last_progress>240:
                    raise ValueError("Vier Minuten ohne bestätigten Baufortschritt. Letzte Kanonenmeldung siehe oben. Erneuter Aufruf setzt am Journal fort.")
                time.sleep(3)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply",action="store_true",help="Computer einrichten, Pläne starten und bis zum Abschluss beobachten")
    args=parser.parse_args()
    if sys.platform!="linux": parser.error("Auf der Linux-Homebox ausführen.")
    token=os.environ.get("CAMPUS_TOKEN") or getpass.getpass("Campus-Schreibtoken: ").strip()
    rows=plans(token,True)
    for s in POSITIONS:
        print("P02"+s,xyz(POSITIONS[s]),"->",rows[s+"-build"]["desired"]["blueprint"],flush=True)
    run(token,not args.apply,rows)

if __name__=="__main__":
    try: main()
    except (ValueError,RuntimeError,OSError,KeyboardInterrupt) as e:
        sys.exit("P02 angehalten: "+str(e))
