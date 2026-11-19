"""Provision the 36 new Erebor station computers from the Homebox user account."""
import argparse
import ast
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
SITES = "K04 K06 K07 K10 K11 K12 K13 K15 K16 K17 K18 K22 K23 K24 K27 K28 K29 K32".split()
SERVICE = ["systemctl", "--user"]
UNIT = "atm10-control.service"
HOOK = "# Campus: Zusatzkanonen der 18 vermessenen Standorte"


def read_json(path):
    return json.loads(path.read_bytes())


def distance(a, b):
    return sum(abs(x-y) for x, y in zip(a, b))


def groups_for(catalog, layout, pairs):
    sites = {s["site"]: s for s in layout["sites"]}
    original = {s["site"]: s for s in pairs["sites"]}
    if (catalog["project"] != "erebor-cannon-expansion" or catalog["version"] != layout["version"]
            or pairs["version"] != layout["version"] or [s["site"] for s in catalog["sites"]] != SITES):
        raise ValueError("Standortliste oder Version weicht von der Vermessung ab.")
    occupied = set()
    for row in sites.values():
        pair = original[row["site"]]
        occupied.update(tuple(p) for p in (row["computer"], row["chest"], pair["main"], pair["B"], pair["C"], row["bridge"]))
    groups = []
    for station in catalog["sites"]:
        site = station["site"]
        base = sites[site]
        if station["bridge"] != base["bridge"] or len(station["groups"]) != 2:
            raise ValueError(site + ": ME-Bridge oder Gruppenzahl abweichend.")
        for group, letters in zip(station["groups"], ("DEF", "GHI")):
            pc, chest, slots = group["computer"], group["chest"], group["slots"]
            delta = tuple(a-b for a,b in zip(pc, base["bridge"]))
            direction = {(-1,0,0):"W",(1,0,0):"E",(0,0,-1):"N",(0,0,1):"S"}.get(delta)
            points = [tuple(p) for p in (pc, chest, *slots.values())]
            if (not direction or group["name"] != site+"-"+direction or list(slots) != list(letters)
                    or distance(pc,chest) != 1 or any(distance(chest,p) != 1 for p in slots.values())
                    or len(set(points)) != 5 or occupied.intersection(points)):
                raise ValueError(site + ": Überschneidung oder ungültige Zuordnung.")
            occupied.update(points)
            groups.append({**base, **group, "site":group["name"], "parent":site,
                           "inventoryBlock":"minecraft:chest","computerBlock":"computercraft:computer_advanced",
                           "cannon":slots[letters[0]]})
    return groups


def controller_hook(original, groups):
    keys = sorted({g["site"] for g in groups} | {g["parent"]+s for g in groups for s in g["slots"]})
    addition = ("\n\n" + HOOK + "\n_expansion_keys = frozenset(" + repr(keys) + ")\n"
                "_handle_existing_erebor = handle\n"
                "def handle(bridge, action, obj):\n"
                "    if isinstance(obj, dict) and isinstance(obj.get('site'), str) and obj['site'] in _expansion_keys:\n"
                "        from campus_erebor_expansion import handle as handle_expansion\n"
                "        return handle_expansion(bridge, action, obj)\n"
                "    return _handle_existing_erebor(bridge, action, obj)\n")
    # JsonIO commonly pretty-prints its 225 printer rows. Keep a bounded live report.
    original=original.replace("if path.stat().st_size>300000:", "if path.stat().st_size>1048576:", 1)
    if HOOK in original:
        if original.count(addition) != 1:
            raise ValueError("Abweichende bestehende Erweiterung im Controller.")
        return original
    functions = [n for n in ast.parse(original).body if isinstance(n, ast.FunctionDef) and n.name=="handle"]
    if len(functions)!=1 or [a.arg for a in functions[0].args.args]!=["bridge","action","obj"]:
        raise ValueError("Einstiegspunkt des installierten Erebor-Controllers nicht erkannt.")
    return original + addition


def tracker_hook(original, snippet):
    if snippet in original:
        return original
    anchor = re.compile(r"(?m)^[ \t]*function renew\(level, chunks, station, row\) *\{")
    if ("BEGIN campus expansion groups" in original or len(anchor.findall(original))!=1
            or not all(s in original for s in ("stations.push(", "function position(", "station.feeder", "feederId"))):
        raise ValueError("K09-Tracker abweichend: Einsprungpunkt für weitere Standorte fehlt.")
    at = anchor.search(original).start()
    return original[:at] + snippet + "\n\n" + original[at:]


def host_changes(base, groups):
    host = base/"discord"
    kube = base/"data/kubejs"
    controller = host/"campus_erebor.py"
    tracker = kube/"server_scripts/campus/erebor-target-chunks.js"
    catalog = (HERE/"expansion-groups.json").read_bytes()
    additions = {host/"campus_erebor_expansion.py":(HERE/"campus_erebor_expansion.py").read_bytes(),
                 host/"expansion-groups.json":catalog, kube/"config/expansion-groups.json":catalog}
    paths = [*additions, controller, tracker]
    changes = []
    for path in paths:
        if path.resolve()!=path or not path.parent.is_dir():
            raise ValueError("Unerwarteter Hostpfad: "+str(path))
        old = path.read_bytes() if path.exists() else None
        if path in additions:
            new = additions[path]
            if old not in (None,new):
                raise ValueError("Abweichende vorhandene Erweiterung: "+str(path))
        else:
            if old is None:
                raise ValueError("Hostdatei fehlt: "+str(path))
            before = old.decode("utf-8")
            if path==controller:
                new = controller_hook(before,groups).encode()
            else:
                snippet = (HERE/"extra-tracker.js").read_text(encoding="utf-8").strip("\n")
                new = tracker_hook(before,snippet).encode()
        if path.suffix==".py":
            compile(new,str(path),"exec")
        if old != new:
            changes.append((path,old,new,path.stat().st_mode & 0o777 if old is not None else 0o644))
    return changes


def write_atomic(path, data, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent,delete=False) as f:
        tmp=Path(f.name)
        try:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
            tmp.chmod(mode)
        except BaseException:
            tmp.unlink(missing_ok=True)
            raise
    try:
        os.replace(tmp,path)
    finally:
        tmp.unlink(missing_ok=True)


def apply_host(changes, backup, base):
    written=[]
    try:
        for path,old,new,mode in changes:
            current=path.read_bytes() if path.exists() else None
            if current!=old:
                raise ValueError("Datei während der Vorprüfung geändert: "+str(path))
            if old is not None:
                saved=backup/path.relative_to(base)
                saved.parent.mkdir(parents=True,exist_ok=True)
                saved.write_bytes(old)
            write_atomic(path,new,mode)
            written.append((path,old,mode))
        if changes:
            subprocess.run([*SERVICE,"restart",UNIT],check=True)
        subprocess.run([*SERVICE,"is-active","--quiet",UNIT],check=True)
    except BaseException:
        for path,old,mode in reversed(written):
            if old is None:
                path.unlink(missing_ok=True)
            else:
                write_atomic(path,old,mode)
        if written:
            subprocess.run([*SERVICE,"restart",UNIT],check=False)
        raise


def get_container(fleet, base):
    names=fleet.docker("ps","--format","{{.Names}}").splitlines()
    matches=[]
    for name in names:
        mounts=json.loads(fleet.docker("inspect","--format","{{json .Mounts}}",name))
        if any(m["Destination"]=="/data" and Path(m["Source"]).resolve()==base/"data" for m in mounts):
            matches.append(name)
    if len(matches)!=1:
        raise ValueError("Minecraft-Container nicht eindeutig. --container NAME angeben.")
    return matches[0]


def live_rows(path):
    try:
        data=read_json(path)
        if 0 <= time.time()*1000-data["at"] < 30000:
            return data["stations"]
    except (OSError,ValueError,KeyError,TypeError):
        pass
    return {}


def extra_chunks(groups, parents):
    def chunk(p):
        return p[0]//16,p[2]//16
    original={chunk(s["cannon"]) for s in parents.values()}
    return sorted({chunk(p) for g in groups for p in (g["computer"],g["chest"],*g["slots"].values())}-original)


def keep_chunk_footprint(console, chunks, record):
    # After the temporary installer tickets are released, retain just the
    # hardware outside the original station chunks. Record our additions.
    added=[]
    try:
        for cx,cz in chunks:
            coords=f"{cx*16} {cz*16}"
            if console.success("forceload add "+coords):
                added.append((cx,cz))
            elif not console.success("forceload query "+coords):
                raise ValueError("Zusatzchunk konnte nicht geladen werden: "+str((cx,cz)))
        record.write_text(json.dumps({"dimension":"minecraft:overworld","addedChunks":added},indent=2)+"\n")
    except BaseException:
        for cx,cz in reversed(added):
            if not console.success(f"forceload remove {cx*16} {cz*16}"):
                print(f"Eigenes Chunk-Ticket prüfen: {cx} / {cz}",file=sys.stderr)
        raise
    finally:
        console.run("data remove storage "+console.storage+" ok")
    print(f"{len(chunks)} zusätzliche Hardware-Chunks abgedeckt, {len(added)} neue Vanilla-Tickets.",flush=True)


def register_progress(rows, ids, groups, seen, built):
    for group in groups:
        for slot in group["slots"]:
            key=group["parent"]+slot
            row=rows.get(key) or {}
            if (not row.get("ready") or row.get("feederId")!=ids[group["site"]]
                    or row.get("owner")!="Erebor" or not row.get("aligned")
                    or not re.fullmatch(r"campus_[a-f0-9-]{36}\.nbt", row.get("upload") or "")
                    or type(row.get("placed"))!=int):
                continue
            current=(row["upload"],row["placed"])
            previous=seen.get(key)
            if previous and current[0]==previous[0] and current[1]>previous[1]:
                built.add(key)
            seen[key]=current


def monitor(fleet, path, groups, ids, token, seconds):
    seen, built, online = {}, set(), set()
    expected=(len(groups),sum(len(g['slots']) for g in groups))
    deadline=time.monotonic()+seconds
    next_api=0
    last=None
    while time.monotonic()<deadline:
        rows=live_rows(path)
        register_progress(rows,ids,groups,seen,built)
        if time.monotonic()>=next_api:
            try:
                registry=fleet.api("/api/cannons",token)
                online={r["name"].removeprefix("erebor-") for r in registry if r.get("online")
                        and (r.get("status") or {}).get("chestSide") and r["name"].removeprefix("erebor-") in ids
                        and r["status"].get("computerId")==ids[r["name"].removeprefix("erebor-")]}
            except (OSError,ValueError):
                online=set()
            next_api=time.monotonic()+30
        counts=(len(online),len(built))
        if counts!=last:
            print(f"{counts[0]}/{expected[0]} Rechner online, {counts[1]}/{expected[1]} mit gestiegenem Bauzähler.",flush=True)
            last=counts
        if counts==expected:
            return True
        time.sleep(4)
    for group in groups:
        pending=[s for s in group["slots"] if group["parent"]+s not in built]
        if pending or group["site"] not in online:
            print(group["site"], "online" if group["site"] in online else "ohne aktuelle Rechnerbestätigung",
                  " | ".join(s+": "+str((rows.get(group["parent"]+s) or {}).get("status") or "keine Weltmeldung") for s in pending))
    return False


def run(args, base, prepare=None):
    import fleet
    container=args.container or get_container(fleet,base)
    root=fleet.world_directory(container)
    if base/"data" not in root.parents:
        raise ValueError("Container gehört nicht zum gewählten Weltverzeichnis.")
    layout=read_json(base/"discord/erebor-stations.json")
    pairs=read_json(base/"discord/erebor-parallel.json")
    if prepare:
        groups,changes=prepare(args,base,layout,pairs)
    else:
        groups=groups_for(read_json(HERE/"expansion-groups.json"),layout,pairs)
        changes=host_changes(base,groups)
    subprocess.run([*SERVICE,"is-active","--quiet",UNIT],check=True)
    console=fleet.Console(container)
    parents={r["site"]:r for r in layout["sites"] if any(g["parent"]==r["site"] for g in groups)}
    feeders=(HERE/"campus.lua").read_bytes()
    livepath=base/"data/kubejs/config/erebor-target-live.json"
    # Each of the three physical printers can lie in a different chunk.
    footprints=[{**g,"cannon":p} for g in groups for p in g["slots"].values()]
    print(f"Prüfe {len(parents)} Standorte mit {len(groups)} Rechnern und {len(footprints)} Zusatzkanonen in",container,flush=True)
    with fleet.loaded(console,[*parents.values(),*footprints]):
        for g in groups:
            print(g["site"],"→"," / ".join(g["slots"]), "Kiste",fleet.xyz(g["chest"]),flush=True)
        if args.action=="check":
            print(f"{len(groups)} Gruppen und {len(footprints)} Zusatzkanonen physisch geprüft. Hostdateien zu ändern:",len(changes))
            print("Zusätzliche Hardware-Chunks:",extra_chunks(groups,parents))
            return
        ids=fleet.identify(console,groups)
        old_ids=[console.computer(row) for row in parents.values()]
        if None in old_ids or set(old_ids).intersection(ids.values()) or len(set(old_ids))!=len(old_ids):
            raise ValueError("Bestandsrechner nicht eindeutig von den neuen Rechnern getrennt.")
        disks={name:fleet.check_disk(root,cid,False) for name,cid in ids.items()}
        token=os.environ.get("CAMPUS_STATION_TOKEN")
        for cid in old_ids:
            if token:
                break
            saved=root/str(cid)/fleet.TOKEN_FILE
            if saved.resolve()==saved and saved.is_file():
                token=saved.read_text().strip()
        if not token:
            from getpass import getpass
            token=getpass("Campus Station-Token: ").strip()
        if fleet.api("/api/me",token).get("scope")!="station":
            raise ValueError("Der hinterlegte Zugang benötigt den Scope Station.")
        registry=fleet.api("/api/cannons",token)
        by_id={cid:"erebor-"+name for name,cid in ids.items()}
        for station in registry:
            cid=(station.get("status") or {}).get("computerId")
            name=station["name"]
            if (cid in by_id and by_id[cid]!=name) or (name in by_id.values() and cid is not None and by_id.get(cid)!=name):
                raise ValueError("Bereits anders zugeordneter Stationsrechner: "+name)
        backup=Path(tempfile.mkdtemp(prefix=".ausbau18-before-",dir=base/"discord"))
        print("Sicherung:",backup,flush=True)
        apply_host(changes,backup,base)
        for g in groups:
            name=g["site"]
            cid=ids[name]
            if console.computer(g)!=cid:
                raise ValueError(name+": Rechner während der Einrichtung versetzt.")
            disk=disks[name]
            files={"campus.lua":feeders,"startup.lua":fleet.startup(name),fleet.TOKEN_FILE:(token+"\n").encode()}
            installed=all((disk/k).is_file() and (disk/k).read_bytes()==v for k,v in files.items())
            if not installed:
                console.run(fleet.power_command(g,cid,"shutdown"))
                try:
                    for _ in range(32):
                        on=console.number(g["computer"],"On")
                        if on==0 or (on is None and console.success("execute if block "+fleet.xyz(g["computer"])
                                +" computercraft:computer_advanced[state=off]{ComputerId:"+str(cid)+"}")):
                            break
                        time.sleep(.25)
                    else:
                        raise ValueError(name+": Computer hat das Anhalten nicht bestätigt.")
                    fleet.install_disk(disk,name,feeders,token,backup)
                finally:
                    console.run(fleet.power_command(g,cid,"turn-on"))
            elif console.number(g["computer"],"On")!=1:
                console.run(fleet.power_command(g,cid,"turn-on"))
            print(name,"eingerichtet",flush=True)
        expected={g["parent"]+s for g in groups for s in g["slots"]}
        if changes or not expected.issubset(live_rows(livepath)):
            print("Minecraft lädt seine Server-Skripte neu:",console.run("minecraft:reload"),flush=True)
    keep_chunk_footprint(console,extra_chunks(groups,parents),backup/"zusatzchunks.json")
    if not monitor(fleet,livepath,groups,ids,token,args.wait):
        raise ValueError("Einrichtung abgeschlossen; Baufortschritt noch nicht für alle Zusatzkanonen bestätigt. Details oben.")


def main():
    import fcntl
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("action",choices=["check","install"])
    p.add_argument("--base",type=Path,default=Path.home()/"minecraft/atm10")
    p.add_argument("--container")
    p.add_argument("--wait",type=int,default=600,help="Sekunden Baufortschrittskontrolle (Standard: 600)")
    args=p.parse_args()
    if args.wait<10: p.error("--wait muss mindestens zehn Sekunden betragen.")
    base=args.base.resolve()
    fd=os.open(base/"discord",os.O_RDONLY)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        run(args,base)
    finally:
        os.close(fd)


if __name__=="__main__":
    try:
        main()
    except (OSError,RuntimeError,ValueError,subprocess.SubprocessError) as error:
        sys.exit(str(error))
