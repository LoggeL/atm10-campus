import importlib.util
import json
import shutil
import sys
import tempfile
import time
import unittest
from contextlib import nullcontext, redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"controller"))
import campus_erebor
from campus_discovery import FACING, side_offset, validate_candidate, proof_command


class Expansion(unittest.TestCase):
    def setUp(self):
        temp=tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.temp=Path(temp.name)
        kit=self.temp/"kit"
        with ZipFile(ROOT/"public/assets/erebor-ausbau-18.zip") as z:
            self.assertIsNone(z.testzip())
            z.extractall(kit)
        spec=importlib.util.spec_from_file_location("expansion_installer",kit/"install.py")
        self.inst=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.inst)
        self.base=self.temp/"homebox"
        self.host=self.base/"discord"
        tracker=self.base/"data/kubejs/server_scripts/campus"
        for d in [self.host,tracker,self.base/"data/kubejs/config"]:d.mkdir(parents=True)
        with ZipFile(ROOT/"public/assets/erebor-k09-ausbau.zip") as old:
            self.old=old.read("campus_erebor.py").decode().replace("    key = obj['site']", "    # K12 local customization\n    key = obj['site']")
            (self.host/"campus_erebor.py").write_text(self.old,encoding="utf-8")
            self.old_tracker=old.read("erebor-target-chunks.js").decode()+"\n// operator K12 chunk fix\n"
            (tracker/"erebor-target-chunks.js").write_text(self.old_tracker,encoding="utf-8")
        for name in ("stations","parallel"):
            shutil.copyfile(ROOT/"src/erebor-fleet"/(name+".json"),self.host/("erebor-"+name+".json"))
        self.layout=self.inst.read_json(self.host/"erebor-stations.json")
        self.groups=self.inst.groups_for(self.inst.read_json(kit/"expansion-groups.json"),self.layout,
                                       self.inst.read_json(self.host/"erebor-parallel.json"))

    def test_additive_install_is_repeatable_and_existing_routes_are_preserved(self):
        self.assertEqual(len(self.groups),36)
        self.assertNotIn("K09",{g["parent"] for g in self.groups})
        before=self.inst.host_changes(self.base,self.groups)
        self.assertEqual(len(before),5)
        backup=self.base/"backup"
        with patch.object(self.inst.subprocess,"run"):
            self.inst.apply_host(before,backup,self.base)
        self.assertEqual(self.inst.host_changes(self.base,self.groups),[])
        self.assertEqual((backup/"discord/campus_erebor.py").read_text(encoding="utf-8"),self.old)
        host=(self.host/"campus_erebor.py").read_text(encoding="utf-8")
        self.assertTrue(host.startswith(self.old.replace("st_size>300000","st_size>1048576")))
        tracker=(self.base/"data/kubejs/server_scripts/campus/erebor-target-chunks.js").read_text(encoding="utf-8")
        self.assertIn("// operator K12 chunk fix",tracker)
        self.assertEqual(tracker.count("BEGIN campus expansion groups"),1)
        scope={"__file__":str(self.host/"campus_erebor.py")}
        exec(compile(host,"host","exec"),scope)
        original=Mock(return_value="existing")
        scope["_handle_existing_erebor"]=original
        extra=Mock()
        with patch.dict(sys.modules,{"campus_erebor_expansion":extra}):
            for key in ("K12","K12B","K12C","K09D","K09-N","K01D","K24-N"):
                self.assertEqual(scope["handle"](None,"erebor-inspect",{"site":key}),"existing")
            for g in self.groups:
                for key in [g["site"],*(g["parent"]+s for s in g["slots"])]:
                    scope["handle"](None,"erebor-inspect",{"site":key})
                    extra.handle.assert_called_with(None,"erebor-inspect",{"site":key})

    def test_one_run_programs_36_distinct_new_disks_and_retry_does_not_reboot_them(self):
        root=self.base/"data/world/computercraft/computer"
        root.mkdir(parents=True)
        ids={g["site"]:100+i for i,g in enumerate(self.groups)}
        parents={s:i for i,s in enumerate(self.inst.SITES)}
        console=Mock(storage="erebor_install:fixture")
        console.computer.side_effect=lambda r: {**parents,**ids}[r["site"]]
        on={tuple(g["computer"]):1 for g in self.groups}
        def command(cmd):
            if isinstance(cmd,tuple):
                pos,action=cmd
                on[pos]=int(action=="turn-on")
            return ""
        console.run.side_effect=command
        console.number.side_effect=lambda pos,key:on[tuple(pos)]
        fleet=Mock(TOKEN_FILE=".campus-station-token")
        fleet.Console.return_value=console
        fleet.world_directory.return_value=root
        fleet.loaded.side_effect=lambda c,rows:nullcontext()
        fleet.identify.return_value=ids
        fleet.check_disk.side_effect=lambda root,cid,replace: root/str(cid)
        fleet.api.side_effect=lambda p,k: {"scope":"station"} if p=="/api/me" else []
        fleet.power_command.side_effect=lambda g,cid,act:(tuple(g["computer"]),act)
        fleet.startup.side_effect=lambda name:name.encode()
        def install(disk,name,code,token,backup):
            disk.mkdir()
            for key,data in {"campus.lua":code, "startup.lua":name.encode(),fleet.TOKEN_FILE:(token+"\n").encode()}.items():
                (disk/key).write_bytes(data)
        fleet.install_disk.side_effect=install
        args=SimpleNamespace(action="install",container="test",wait=10)
        with (patch.dict(sys.modules,{"fleet":fleet}),patch.dict("os.environ",{"CAMPUS_STATION_TOKEN":"test-fixture"}),
              patch.object(self.inst.subprocess,"run"),patch.object(self.inst,"monitor",return_value=True),redirect_stdout(StringIO())):
            self.inst.run(args,self.base)
            self.assertEqual({p.name for p in root.iterdir()},{str(i) for i in ids.values()})
            self.assertEqual(fleet.install_disk.call_count,36)
            for name,cid in ids.items():
                self.assertEqual((root/str(cid)/"startup.lua").read_text(),name)
            console.run.reset_mock()
            self.inst.run(args,self.base)
            self.assertEqual(fleet.install_disk.call_count,36)
            self.assertFalse(any(isinstance(call.args[0],tuple) for call in console.run.call_args_list))

    def test_all_108_positions_and_36_shared_inventory_guards(self):
        shutil.copyfile(self.inst.HERE/"expansion-groups.json",self.host/"expansion-groups.json")
        xyz=lambda p:dict(zip("xyz",p))
        with patch.object(campus_erebor,"__file__",str(self.host/"campus_erebor.py")):
            for g in self.groups:
                bridge=Mock()
                for s,p in g["slots"].items():
                    campus_erebor.handle(bridge,"erebor-inspect",{"site":g["parent"]+s,"version":12})
                    binding=bridge.inspect.call_args.args[0]
                    self.assertEqual([binding[k] for k in "xyz"],p)
                delta=tuple(a-b for a,b in zip(g["chest"],g["computer"]))
                face,side=next((f,s) for f in FACING for s in ("front","back","left","right") if side_offset(f,s)==delta)
                first=next(iter(g["slots"].values()))
                candidate=validate_candidate({"binding":{**xyz(first),"owner":"Erebor","dimension":"minecraft:overworld"},
                    "computer":{**xyz(g["computer"]),"facing":face,"id":2147483647,"block":g["computerBlock"]},
                    "chest":{**xyz(g["chest"]),"block":"minecraft:chest","side":side}})
                proof=proof_command(candidate).replace("ComputerId:2147483647}","ComputerId:2147483647,Label:\"erebor-"+g["site"]+"\"}")
                proof=proof.replace("minecraft:chest[type=single]","sophisticatedstorage:netherite_chest[type=single]")
                targets={};reports={}
                for idx,slot in enumerate(g["slots"]):
                    file="campus_"+str(idx)*36+".nbt"
                    targets[slot]=dict(file=file,anchor=first,size=[64,16,64],options=[2,False,False],sha256="a"*64)
                    reports[g["parent"]+slot]={**targets[slot],"empty":False,"upload":file,"owner":"Erebor","aligned":True,"state":"RUNNING","placed":15}
                def run(cmd):
                    self.assertLessEqual(len(cmd.encode()),950)
                    return "Storage "+cmd.split()[-1]+" has the following contents: {}"
                bridge.run=run
                bridge.file_hash.return_value="a"*64
                site={**g,"site":g["parent"],"cannon":first}
                with patch.object(campus_erebor,"handle",return_value=dict(at=time.time()*1000,sharedChest=4,stations=reports)):
                    result=campus_erebor.shared_supply(bridge,self.layout,site,{"targets":targets},proof,g)
                    self.assertEqual(set(result["confirmed"]),set(g["slots"]))
                    with self.assertRaises(ValueError):
                        campus_erebor.shared_supply(bridge,self.layout,site,{"targets":{"A":{}}},proof,g)

    def test_partial_live_world_never_counts_registration_or_a_new_plan_as_placement(self):
        g=self.groups[0];ids={g["site"]:23};slot=g["parent"]+"D"
        row={"ready":True,"feederId":23,"owner":"Erebor","aligned":True,"upload":"campus_"+"1"*36+".nbt","placed":5}
        seen,built={},set()
        def poll(): self.inst.register_progress({slot:row},ids,[g],seen,built)
        poll();poll()
        row.update(upload="campus_"+"2"*36+".nbt",placed=100);poll()
        row.update(feederId=24,placed=105);poll()
        self.assertFalse(built)
        row["feederId"]=23;poll()
        self.assertEqual(built,{slot})

    def test_chunk_tickets_cover_only_the_16_neighbor_chunks_and_preserve_existing_tickets(self):
        parents={s["site"]:s for s in self.layout["sites"] if s["site"] in self.inst.SITES}
        chunks=self.inst.extra_chunks(self.groups,parents)
        self.assertEqual(len(chunks),16)
        preexisting=set(chunks[:4]);loaded=set(preexisting);console=Mock(storage="test")
        def success(cmd):
            _,action,x,z=cmd.split()
            k=(int(x)//16,int(z)//16)
            if action=="query":return k in loaded
            if action=="add" and k not in loaded:
                loaded.add(k);return True
            if action=="remove":
                loaded.remove(k);return True
            return False
        console.success.side_effect=success
        record=self.temp/"chunks.json"
        self.inst.keep_chunk_footprint(console,chunks,record)
        self.assertEqual(loaded,set(chunks))
        self.assertEqual(set(map(tuple,self.inst.read_json(record)["addedChunks"])),set(chunks)-preexisting)
        self.inst.keep_chunk_footprint(console,chunks,record)
        self.assertEqual(self.inst.read_json(record)["addedChunks"],[])
