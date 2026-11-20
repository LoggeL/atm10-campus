import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import erebor_urn_test as fixtures
root=fixtures.root
encoded=fixtures.encoded

asset=root/'public/assets/erebor-urnen-v2.py'
spec=importlib.util.spec_from_file_location('campus_urns_v2',asset)
update=importlib.util.module_from_spec(spec)
spec.loader.exec_module(update)
v1=(root/'public/assets/erebor-urnen.py').read_text(encoding='utf8')


class UpgradeTest(unittest.TestCase):
    def test_tracker_preserves_regular_modes_and_loads_only_bound_chunk(self):
        tracker=(root/'controller/kubejs/erebor-target-chunks.js').read_text(encoding='utf8')
        patched=update.tracker_v2(tracker)
        self.assertIn('urnTargetTracker:2',patched)
        self.assertIn('else if (((row.empty && !preserveDigReceipt)',patched)
        self.assertIn('anchor.equals(p)',patched)
        self.assertIn('pos.distSqr(p)>=256*256',patched)
        self.assertIn('Number(job.until)>Date.now()',patched)
        self.assertEqual(patched.count('chunks.addRegionTicket(ticket,new ChunkPos(p),2,station.pos)'),1)
        self.assertNotIn('c.replaceBlockEntities=',patched)
        self.assertEqual(hashlib.sha256(v1.encode()).hexdigest(),update.V1)

    def test_all_installed_slots_use_their_own_surveyed_position(self):
        source=root/'src/erebor-fleet'
        with tempfile.TemporaryDirectory() as name:
            folder=Path(name)
            catalog=json.loads((source/'stations.json').read_text())
            for old,new in [('parallel.json','erebor-parallel.json'),*[(s,s) for s in
                                  ('k09-groups.json','expansion-groups.json','finishing-groups.json')]]:
                (folder/new).write_bytes((source/old).read_bytes())
            pair=json.loads((source/'parallel.json').read_text())['sites'][0]
            self.assertEqual(update.urn_station(catalog,'K01B',folder)['cannon'],pair['B'])
            for site in json.loads((source/'finishing-groups.json').read_text())['sites']:
                for g in site['groups']:
                    for slot,p in g['slots'].items():
                        self.assertEqual(update.urn_station(catalog,site['site']+slot,folder)['cannon'],p)
            with self.assertRaises(ValueError):
                update.urn_station(catalog,'K01Z',folder)

    def test_unloaded_chunk_keeps_reservation_until_loaded_and_checked(self):
        fixture=fixtures.UrnTest('test_normal_jobs_and_capability')
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        folder=fixture.bridge.base
        config=folder/'data/kubejs/config'
        config.mkdir(parents=True)
        (config/update.REGISTRY).write_text('{}')
        module=ModuleType('urn_test_module')
        module.__file__=str(folder/'campus_urns.py')
        exec(compile(update.module_v2(v1),module.__file__,'exec'),module.__dict__)
        run=module.with_urns(lambda *args:{'version':12,'urnTargetTracker':2})
        obj={**fixture.obj,'nbtBase64':encoded}
        self.assertEqual(run(fixture.bridge,'erebor-live',{})['urnPreparation'],2)
        self.assertEqual(module.with_urns(lambda *a:{'version':12})(fixture.bridge,'erebor-live',{})['urnPreparation'],0)
        with patch.dict(sys.modules,{'campus_urns_v2':update}),patch('campus_discovery.condition',side_effect=[False,True,False]),patch('campus_schematic.prepare_schematic',return_value={'applied':True}) as prepare:
            for _ in range(2):
                self.assertTrue(run(fixture.bridge,'erebor-prepare',obj)['urnWarming'])
                prepare.assert_not_called()
            lease=json.loads((config/update.REGISTRY).read_text())['K01']
            self.assertEqual(lease['pos'],fixture.desired['anchor'])
            self.assertEqual(lease['file'],fixture.desired['file'])
            self.assertTrue(run(fixture.bridge,'erebor-prepare',obj)['applied'])
            prepare.assert_called_once()

