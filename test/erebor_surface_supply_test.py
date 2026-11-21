import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/'public/assets'/file)
    result=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

class SurfaceSupply(unittest.TestCase):
    def test_tracker_retains_urn_and_pack_behaviour_and_compiles(self):
        urn=module('campus_urns_v2','erebor-urnen-v2.py')
        fix=module('surface','erebor-aussenhaut-modus.py')
        text=urn.tracker_v2((ROOT/'controller/kubejs/erebor-target-chunks.js').read_text())
        with patch.dict(sys.modules,{'campus_urns_v2':urn}):
            for prefix in ['trackUrn(chunks,','trackPack(level,chunks,station,row,item,c,campusInput) || trackUrn(chunks,']:
                patched=fix.update_tracker(text.replace('if (trackUrn(chunks,','if ('+prefix))
                self.assertIn('else if ('+prefix,patched)
                subprocess.run(['node','--check'],input=patched,text=True,check=True)

    def test_only_matching_published_surface_uuid_and_anchor_are_registered(self):
        import time
        fix=module('surface','erebor-aussenhaut-modus.py')
        pos=[-128,32,-10976]
        sha=hashlib.sha256(b'example nbt').hexdigest()
        source="import {ereborUploadName} from './src/erebor-file.js'; console.log(ereborUploadName('EREBOR_HAUT_R-1_-22_X-128_Y32_Z-10976.nbt','"+sha+"'));"
        file=subprocess.check_output(['node','--input-type=module','-e',source],cwd=ROOT,text=True).strip()
        row=dict(owner='Erebor',aligned=True,size=[32]*3,upload=file,anchor=pos)
        report=dict(at=int(time.time()*1000),stations={'K01B':row,'K08':dict(row,anchor=[0,32,0])})
        with tempfile.TemporaryDirectory() as root:
            folder=Path(root)/'data/kubejs/config'
            folder.mkdir(parents=True)
            bridge=types.SimpleNamespace(base=Path(root),file_hash=lambda *_:sha)
            helper=types.SimpleNamespace(atomic=lambda path,data,mode:path.write_bytes(data))
            with patch.dict(sys.modules,{'campus_interior':helper}):
                fix.wrap(lambda *_:report)(bridge,'erebor-live',{})
            self.assertEqual(json.loads((folder/fix.REGISTRY).read_text()),{'K01B':{'file':file,'pos':pos}})
