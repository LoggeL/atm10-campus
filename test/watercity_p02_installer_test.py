import hashlib
import json
from pathlib import Path
import runpy
import sys
import unittest
from unittest.mock import patch

ARCHIVE = Path(__file__).resolve().parents[1]/"public/assets/wasserstadt-p02-v1.pyz"
sys.path.insert(0,str(ARCHIVE))
app = runpy.run_path(str(ARCHIVE))

class P02Installer(unittest.TestCase):
    def rows(self):
        result=[]
        for slot,position in app["POSITIONS"].items():
            for phase,prefix,mode in [("build","BAU",2),("clear","AUSHUB",3)]:
                name="EREBOR_E25_"+prefix+"_"+slot
                options=dict(replace_mode=mode,skip_missing=False,replace_block_entities=False)
                desired=dict(blueprint=name,version=12,options=options,sha256=hashlib.sha256(name.encode()).hexdigest())
                result.append(dict(slot=slot,phase=phase,position=position,job=dict(desired=desired,size=[32,32,32])))
        return result

    def read(self,rows):
        f=app["plans"]
        response=json.dumps(dict(rows=rows,version=12,revision=5,dryRun=True)).encode()
        with patch.dict(f.__globals__,{"request":lambda *args:response}):
            return f("test",True)

    def test_exact_native_slots_and_modes(self):
        self.assertEqual(len(self.read(self.rows())),6)
        rows=self.rows();rows[-1]["position"]=rows[0]["position"]
        with self.assertRaises(ValueError): self.read(rows)
        rows=self.rows();rows[0]["job"]["desired"]["options"]["replace_mode"]=3
        with self.assertRaises(ValueError): self.read(rows)

    def test_finished_needs_output_increment_and_verified_input_history(self):
        o=dict(inputEmpty=True,state="STOPPED",status="finished",flyingBlocks=0,outputItem="create:empty_schematic",outputCount=1)
        self.assertTrue(app["closed"](o,dict(seen=True,base=0)))
        self.assertFalse(app["closed"](o,dict(seen=False,base=0)))
        self.assertFalse(app["closed"](o,dict(seen=True,base=1)))

if __name__=="__main__":
    unittest.main()
