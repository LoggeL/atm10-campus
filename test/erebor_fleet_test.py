import importlib.util
import json
import os
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from unittest.mock import patch

base=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("fleet",base/"src/erebor-fleet/install.py")
fleet=importlib.util.module_from_spec(spec)
spec.loader.exec_module(fleet)


class FleetTest(unittest.TestCase):
    def test_foreign_startup_and_rollback(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); disk=root/"14"; disk.mkdir(); backups=root/"backups";backups.mkdir()
            (disk/"startup.lua").write_text('print("local")')
            with self.assertRaises(ValueError):fleet.check_disk(root,14,False)
            self.assertEqual(fleet.check_disk(root,14,True),disk)
            (disk/"campus.lua").write_bytes(b"previous")
            old=fleet.write_file
            def fail_token(path,*args):
                if path.name==fleet.TOKEN_FILE: raise OSError("write failed")
                old(path,*args)
            with patch.object(fleet.os,"geteuid",return_value=1000,create=True),patch.object(fleet,"write_file",side_effect=fail_token):
                with self.assertRaises(OSError):fleet.install_disk(disk,"K02",b"new","fixture",backups)
            self.assertEqual((disk/"campus.lua").read_bytes(),b"previous")
            self.assertEqual((disk/"startup.lua").read_text(),'print("local")')

    def test_all_37_install_and_repeat(self):
        rows=fleet.layout()
        class Simulated:
            def __init__(self):
                self.on={};self.ids={};self.power=[]
            def computer(self,row):return self.ids.get(row["site"])
            def number(self,pos,key):return 0
            def run(self,cmd):
                if "data merge block" in cmd:
                    r=next(x for x in rows if ("data merge block "+fleet.xyz(x["computer"])+" ") in cmd)
                    self.ids[r["site"]]=100+int(r["site"][1:])
                elif " turn-on " in cmd:self.power.append(cmd)
        c=Simulated()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/"computer";root.mkdir()
            files=Path(tmp)/"kit";files.mkdir()
            (files/"stations.json").write_bytes((fleet.HERE/"stations.json").read_bytes())
            (files/"campus.lua").write_bytes((base/"public/cc/campus.lua").read_bytes())
            def api(path,token):
                if path=="/api/me":return {"scope":"station"}
                return [{"name":"erebor-"+site,"online":True,"status":{"at":str(len(c.power)),"computerId":cid,"state":"unassigned"}} for site,cid in c.ids.items()]
            with (patch.object(fleet,"HERE",files),patch.object(fleet,"api",side_effect=api),
                  patch.object(fleet,"Console",return_value=c),patch.object(fleet,"loaded",return_value=nullcontext()),
                  patch.object(fleet,"world_directory",return_value=root),patch.object(fleet.time,"sleep"),
                  patch.object(fleet.sys,"platform","linux"),patch.object(fleet.os,"geteuid",return_value=root.stat().st_uid,create=True),
                  patch.object(fleet.os,"fchown",create=True),patch.object(fleet.os,"chown",create=True),
                  patch.dict(os.environ,CAMPUS_STATION_TOKEN="fixture"),patch.object(fleet.sys,"argv",["install.py","--container","minecraft","--apply"])):
                fleet.main();fleet.main()
            self.assertEqual(len(c.power),74)
            for site,cid in c.ids.items():
                disk=root/str(cid)
                self.assertIn("erebor-"+site,(disk/"startup.lua").read_text())
                self.assertEqual((disk/fleet.TOKEN_FILE).read_text(),"fixture\n")
                self.assertEqual((disk/"campus.lua").read_bytes(),(files/"campus.lua").read_bytes())

if __name__=="__main__":unittest.main()
