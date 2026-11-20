import base64
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root/'controller'))
from campus_start import expected_components
spec = importlib.util.spec_from_file_location('urns',root/'public/assets/erebor-urnen.py')
urns = importlib.util.module_from_spec(spec)
spec.loader.exec_module(urns)
encoded = 'H4sIAAAAAAAACj2MsQqDQBBER04T7yz8H+vUKdOvMoEleifuVvn6oEEHpngMbxIQ0D3E5cXNtGSgt4ja9MuAfQSqsxH3VWa6M+3Yon7KQvSLZk6bvH0wL5mIuI1zmT6W/lZYi51nVwIac3EeENEyu7rycIAfaV999ZgAAAA='


class UrnTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name)
        (folder/'erebor-stations.json').write_text(json.dumps({'version':12,'sites':[{'site':'K01','cannon':[-252,32,-11010]}]}))
        replacement = patch.object(urns,'__file__',str(folder/'campus_urns.py'))
        replacement.start()
        self.addCleanup(replacement.stop)
        raw = base64.b64decode(encoded)
        sha = hashlib.sha256(raw).hexdigest()
        self.desired = dict(file='campus_12345678-1234-1234-1234-123456789abc.nbt',version=12,owner='Erebor',
                            rotation='none',mirror='none',anchor=[-400,-29,-10995],sha256=sha,
                            blueprint='EREBOR_STEIN_K01_MASSIV_X15_Z00_URN_-400_-29_-10995_BE_V12')
        self.obj=dict(version=12,site='K01',desired=self.desired,kind='stone',size=[1,1,1])
        self.input = dict(state='STOPPED',status='ready',amountPlaced=0,amountToPlace=0,flyingBlocks=0,
                          printer=dict(DeferredBlocks=[],EntityProgress=-1,PrintStage='BLOCKS'),item='create:schematic',
                          components={**expected_components(self.desired),'create:schematic_bounds':[1,1,1]},
                          options=urns.OPTIONS,fileHash=sha)
        self.calls=[]
        self.bridge=SimpleNamespace(base=folder,inspect=lambda b:self.input,file_hash=lambda *a:sha,run=self.calls.append)
        path=folder/'data/schematics/uploaded/Erebor'/self.desired['file']
        path.parent.mkdir(parents=True)
        path.write_bytes(raw)
        self.handle=urns.with_urns(lambda *a:{'version':12})

    def test_normal_jobs_and_capability(self):
        self.assertEqual(self.handle(self.bridge,'erebor-live',{'version':12})['urnPreparation'],1)
        self.assertEqual(self.handle(self.bridge,'erebor-start',{'desired':{'blueprint':'REGULAR'}}),{'version':12})

    def test_changed_block_is_deferred_before_loading(self):
        for loaded in [False,True]:
            with patch('campus_discovery.condition',side_effect=[loaded,True]), patch('campus_schematic.prepare_schematic') as prepare:
                result=self.handle(self.bridge,'erebor-prepare',{**self.obj,'nbtBase64':encoded})
                self.assertTrue(result['urnDeferred'])
                prepare.assert_not_called()
        self.assertEqual(self.calls,[])

    def test_replacement_is_one_type_one_position_and_survival_start(self):
        with patch('campus_discovery.condition',side_effect=[True,False]), patch('campus_start.start',return_value={'started':True}) as start:
            self.assertTrue(self.handle(self.bridge,'erebor-start',self.obj)['started'])
            self.assertEqual(start.call_args.args[3]['replace_mode'],0)
        self.assertEqual(len(self.calls),1)
        command=self.calls[0]
        self.assertIn('create:schematicannon{',command)
        self.assertIn(self.desired['file'],command)
        self.assertTrue(command.endswith('if loaded -400 -29 -10995 if block -400 -29 -10995 supplementaries:urn run setblock -400 -29 -10995 minecraft:air replace'))
        self.assertLessEqual(len(command.encode()),950)
        self.assertNotIn('replace_block_entities:1b',command)

    def test_wrong_location_file_or_plan_fails_before_world_mutation(self):
        for obj in [{**self.obj,'site':'K02'},{**self.obj,'size':[2,1,1]},
                    {**self.obj,'desired':{**self.desired,'anchor':[10,40,5]}}]:
            with self.assertRaises(ValueError):
                self.handle(self.bridge,'erebor-start',obj)
        self.input['fileHash']='0'*64
        with self.assertRaises(ValueError):
            self.handle(self.bridge,'erebor-start',self.obj)
        self.assertEqual(self.calls,[])
