#!/usr/bin/env python3
"""Install the Campus feeder on the 37 surveyed Erebor computers from the Docker host."""
import argparse
import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from urllib.request import HTTPRedirectHandler, Request, build_opener

HERE = Path(__file__).resolve().parent
URL = "https://campus.logge.top"
MANAGED = "-- ATM10 Campus Erebor fleet"
OLD_STARTUP = 'shell.run("campus.lua")'
TOKEN_FILE = ".campus-station-token"
FILES = ("campus.lua", TOKEN_FILE, "startup.lua")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def api(path, token):
    req = Request(URL + path, headers={"Authorization": "Bearer " + token})
    with build_opener(NoRedirect()).open(req, timeout=20) as response:
        return json.load(response)


def docker(*args):
    result = subprocess.run(["docker", *args], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "Docker-Aufruf fehlgeschlagen.")
    return re.sub(r"\x1b\[[0-9;]*m", "", result.stdout).strip()


def world_directory(container):
    mounts = json.loads(docker("inspect", "--format", "{{json .Mounts}}", container))
    props = docker("exec", container, "cat", "/data/server.properties")
    level = next((s.partition("=")[2].strip() for s in props.splitlines() if s.startswith("level-name=")), "world")
    if not level or PurePosixPath(level).is_absolute() or ".." in PurePosixPath(level).parts:
        raise ValueError("level-name im Container ist kein relativer Weltpfad.")
    inside = PurePosixPath("/data") / level / "computercraft" / "computer"
    for m in sorted(mounts, key=lambda x: len(x["Destination"]), reverse=True):
        mount = PurePosixPath(m["Destination"])
        if inside == mount or mount in inside.parents:
            if not m.get("RW"):
                raise ValueError("Der Minecraft-Datenträger ist schreibgeschützt.")
            source = Path(m["Source"]).resolve(strict=True)
            root = source.joinpath(*inside.relative_to(mount).parts)
            if root.resolve(strict=True) != root or not root.is_dir():
                raise ValueError("CC-Verzeichnis fehlt oder enthält einen symbolischen Link.")
            if str(root.stat().st_ino) != docker("exec",container,"stat","-c","%i",str(inside)):
                raise ValueError("Host und Minecraft-Container sehen unterschiedliche Computerverzeichnisse.")
            return root
    raise ValueError("Kein zugänglicher Docker-Datenträger für " + str(inside))


def xyz(values):
    if len(values) != 3 or any(type(v) is not int for v in values):
        raise ValueError("Ungültige Blockkoordinaten.")
    return " ".join(map(str, values))


def power_command(row, cid, action):
    if action not in ("shutdown", "turn-on") or type(cid) is not int or cid < 0:
        raise ValueError("Ungültiger Computerbefehl.")
    x,y,z=row["computer"]
    return f"execute positioned {x+.5} {y+.5} {z+.5} run computercraft {action} @c[id={cid},distance=..0.1]"


def layout():
    rows = json.loads((HERE / "stations.json").read_text(encoding="utf-8"))["sites"]
    if sorted(r["site"] for r in rows) != [f"K{i:02d}" for i in range(1, 38)]:
        raise ValueError("Es werden genau K01 bis K37 erwartet.")
    for row in rows:
        for a, b in (("cannon", "chest"), ("chest", "computer"), ("computer", "bridge")):
            xyz(row[a])
            xyz(row[b])
            if sum(abs(i-j) for i, j in zip(row[a],row[b])) != 1:
                raise ValueError("Ungültige Nachbarschaft bei " + row["site"])
        if row["computerBlock"] not in ("computercraft:computer_advanced", "computercraft:computer_normal") or row["inventoryBlock"] not in ("minecraft:chest","minecraft:barrel"):
            raise ValueError("Unerwarteter Block bei " + row["site"])
    return rows


class Console:
    def __init__(self, container):
        self.container = container
        self.storage = "erebor_install:run_" + uuid.uuid4().hex

    def run(self, command):
        return docker("exec", self.container, "rcon-cli", "execute in minecraft:overworld run " + command)

    def success(self, command):
        self.run("data remove storage " + self.storage + " ok")
        self.run("execute store success storage " + self.storage + " ok byte 1 run " + command)
        result = self.run("data get storage " + self.storage + " ok")
        match = re.search(r":\s*([01])b\s*$", result, flags=re.I)
        if not match:
            raise RuntimeError("RCON-Antwort nicht lesbar: " + result)
        return match[1] == "1"

    def computer(self, row):
        guard = "execute"
        for key, block in (("cannon","create:schematicannon"),("chest",row["inventoryBlock"]),("computer",row["computerBlock"]),("bridge","advancedperipherals:me_bridge")):
            guard += " if block " + xyz(row[key]) + " " + block
        check = guard + " run data get block " + xyz(row["computer"]) + " id"
        reply = self.run(check)
        if not reply.rstrip('"').endswith(row["computerBlock"]) and row["inventoryBlock"] == "minecraft:chest":
            expected = " if block " + xyz(row["chest"]) + " minecraft:chest"
            upgrade = " if block " + xyz(row["chest"]) + " sophisticatedstorage:netherite_chest[type=single]"
            reply = self.run(check.replace(expected, upgrade))
        if not reply.rstrip('"').endswith(row["computerBlock"]):
            raise ValueError(row["site"] + ": Station nicht geladen oder Aufbau abweichend.")
        return self.number(row["computer"], "ComputerId")

    def number(self, pos, key):
        reply = self.run("data get block " + xyz(pos) + " " + key)
        match = re.search(r":\s*(\d+)[bB]?\s*$",reply)
        return int(match[1]) if match else None


@contextmanager
def loaded(console, rows):
    chunks = {(row[k][0]//16,row[k][2]//16) for row in rows for k in ("cannon","chest","computer","bridge")}
    added = []
    try:
        for cx, cz in sorted(chunks):
            pos = f"{cx*16} {cz*16}"
            if console.success("forceload add " + pos):
                added.append(pos)
            elif not console.success("forceload query " + pos):
                raise RuntimeError("Chunk konnte nicht geladen werden: " + pos)
        deadline = time.monotonic() + 60
        for row in rows:
            while True:
                try:
                    console.computer(row)
                    break
                except ValueError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(1)
        yield
    finally:
        for pos in reversed(added):
            try:
                if not console.success("forceload remove " + pos):
                    print("Chunk-Ticket prüfen: " + pos,file=sys.stderr)
            except Exception as err:
                print("Chunk-Ticket prüfen: " + pos + " (" + str(err) + ")",file=sys.stderr)
        console.run("data remove storage " + console.storage + " ok")


def identify(console, rows):
    ids = {}
    for row in rows:
        cid = console.computer(row)
        if cid is None:
            pos = xyz(row["computer"])
            console.run("execute if block " + pos + " " + row["computerBlock"] + " run data merge block " + pos + " {On:1b}")
            for _ in range(20):
                time.sleep(.25)
                cid = console.computer(row)
                if cid is not None:
                    break
        if cid is None or cid in ids.values():
            raise ValueError(row["site"] + ": fehlende oder doppelte Computer-ID.")
        ids[row["site"]] = cid
    return ids


def startup(site):
    return (MANAGED + '\nlocal f = assert(fs.open("/' + TOKEN_FILE + '","r"))\n'
            'local token = f.readLine()\nf.close()\n'
            'settings.set("campus.url","' + URL + '")\n'
            'settings.set("campus.token",token)\n'
            'settings.set("campus.cannon","erebor-' + site + '")\n'
            'os.setComputerLabel("erebor-' + site + '")\n'
            'shell.run("/campus.lua")\n').encode()


def check_disk(root, cid, replace):
    disk = root / str(cid)
    if disk.is_symlink() or (disk.exists() and not disk.is_dir()):
        raise ValueError("Ungültiges Computerverzeichnis: " + str(disk))
    for name in (*FILES, "startup"):
        f = disk / name
        if f.is_symlink() or (name != "startup" and f.exists() and not f.is_file()):
            raise ValueError("Ungeeignete Zieldatei: " + str(f))
    owner=(disk if disk.exists() else root).stat().st_uid
    if hasattr(os,"geteuid") and os.geteuid() not in (0,owner):
        raise ValueError("Als Minecraft-Dateieigentümer oder root ausführen: "+str(disk))
    if (disk/"startup").is_file():
        raise ValueError(str(disk/"startup") + " ist ein vorhandenes Startprogramm. Zuerst von Hand mit dem Campus-Start abstimmen.")
    if (disk/"startup").is_dir() and any((disk/"startup").iterdir()) and not replace:
        raise ValueError(str(disk/"startup") + " enthält eigene Startprogramme. Nach Prüfung --replace-startup verwenden.")
    boot = disk / "startup.lua"
    if boot.exists() and not replace:
        content = boot.read_bytes().strip()
        if not (content.startswith(MANAGED.encode()) or content == OLD_STARTUP.encode()):
            raise ValueError(str(boot) + " enthält ein eigenes Programm. Nach Prüfung --replace-startup verwenden.")
    return disk


def write_file(path, data, owner):
    fd, name = tempfile.mkstemp(dir=path.parent,prefix=".erebor-")
    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            if os.geteuid() == 0:
                os.fchown(file.fileno(),owner.st_uid,owner.st_gid)
            file.flush()
            os.fsync(file.fileno())
        os.replace(name,path)
    finally:
        Path(name).unlink(missing_ok=True)


def install_disk(disk, site, feeder, token, backups):
    owner = disk.stat() if disk.exists() else disk.parent.stat()
    if not disk.exists():
        disk.mkdir(mode=0o700)
        if os.geteuid()==0:
            os.chown(disk,owner.st_uid,owner.st_gid)
    content = {"campus.lua":feeder,TOKEN_FILE:(token+"\n").encode(),"startup.lua":startup(site)}
    changed = [name for name in FILES if not (disk/name).exists() or (disk/name).read_bytes()!=content[name]]
    if not changed:
        return
    backup = backups / (site+"-"+disk.name)
    backup.mkdir(mode=0o700)
    for name in changed:
        if (disk/name).exists():
            shutil.copy2(disk/name,backup/name)
    written = []
    try:
        for name in changed:
            write_file(disk/name,content[name],owner)
            written.append(name)
    except BaseException:
        for name in reversed(written):
            saved = backup / name
            if saved.exists():
                write_file(disk/name,saved.read_bytes(),owner)
            else:
                (disk/name).unlink()
        raise


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container",required=True,help="Name des laufenden Minecraft-Containers")
    parser.add_argument("--apply",action="store_true",help="Alle Stationen gemeinsam einrichten")
    parser.add_argument("--replace-startup",action="store_true",help="Eigenes startup.lua nach Sicherung ersetzen")
    args=parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*",args.container):
        parser.error("Ungültiger Containername.")
    rows=layout()
    root=world_directory(args.container)
    console=Console(args.container)
    if not args.apply:
        print("Vorschau für",root)
        for row in rows:
            try:
                cid=console.computer(row)
                if cid is not None:
                    check_disk(root,cid,args.replace_startup)
                state="Computer "+str(cid) if cid is not None else "erhält beim ersten Start seine ID"
            except ValueError as err:
                state=str(err)
            print(row["site"],xyz(row["computer"]),state)
        return
    if sys.platform!="linux":
        parser.error("--apply auf dem Linux-Docker-Host ausführen.")
    token=os.environ.get("CAMPUS_STATION_TOKEN") or getpass.getpass("Campus Station-Token: ").strip()
    if api("/api/me",token).get("scope")!="station":
        raise ValueError("Bitte einen Token mit Berechtigung Station verwenden.")
    previous={r["name"]:r.get("status") or {} for r in api("/api/cannons",token)}
    feeder=(HERE/"campus.lua").read_bytes()
    with loaded(console,rows):
        ids=identify(console,rows)
        disks={site:check_disk(root,cid,args.replace_startup) for site,cid in ids.items()}
        for site,cid in ids.items():
            known=previous.get("erebor-"+site,{}).get("computerId")
            if known is not None and known!=cid:
                raise ValueError(site+": Der Stationsname ist bereits einer anderen Computer-ID zugeordnet.")
        backups=Path(tempfile.mkdtemp(prefix="erebor-backup-",dir=root.parent))
        print("Sicherungen:",backups,flush=True)
        for row in rows:
            site=row["site"];cid=ids[site]
            if console.computer(row)!=cid:
                raise RuntimeError(site+": Computer wurde versetzt.")
            print(f"{site} -> Computer {cid}",flush=True)
            console.run(power_command(row,cid,"shutdown"))
            for _ in range(20):
                if console.number(row["computer"],"On")==0:
                    break
                time.sleep(.25)
            else:
                raise RuntimeError(site+": Computer ließ sich nicht anhalten.")
            try:
                install_disk(disks[site],site,feeder,token,backups)
            finally:
                console.run(power_command(row,cid,"turn-on"))
        print("37 Computer eingerichtet. Warte auf die Rückmeldungen.",flush=True)
        until=time.monotonic()+90
        pending=set(ids)
        errors={}
        while pending and time.monotonic()<until:
            for entry in api("/api/cannons",token):
                site=entry["name"].removeprefix("erebor-")
                status=entry.get("status") or {}
                fresh=status.get("at") and status["at"]!=previous.get(entry["name"],{}).get("at")
                if entry["name"]=="erebor-"+site and site in ids and entry.get("online") and status.get("computerId")==ids[site] and fresh and not status.get("stale"):
                    pending.discard(site)
                    if status.get("state")=="error":
                        errors[site]=status.get("message") or "Versorgung prüfen"
                    else:
                        errors.pop(site,None)
            if pending:
                time.sleep(3)
        print(f"{37-len(pending)}/37 zugeordnete Stationen melden sich am Campus.")
        if pending:
            print("Rückmeldung offen:",", ".join(sorted(pending)))
        for site,message in sorted(errors.items()):
            print(site,message)
        if pending or errors:
            raise SystemExit(2)


if __name__=="__main__":
    try:
        main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError) as exc:
        sys.exit("Installation: "+str(exc))
