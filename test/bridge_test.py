import copy
import importlib.util
from pathlib import Path
import sys
import unittest
import tempfile
import base64
import gzip
import hashlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'controller'))
from campus_snbt import loads, dumps
spec = importlib.util.spec_from_file_location('bridge', Path(__file__).resolve().parents[1] / 'controller/campus_schematic.py')
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

JOB = {'owner': 'Owner', 'fileName': 'campus_00000000-0000-0000-0000-000000000000.nbt', 'origin': [10, 64, -3], 'size': [2, 1, 2],
       'settings': {'position': [0, 64, 0], 'dimension': 'minecraft:overworld', 'replaceMode': 2, 'skipMissing': False, 'protectBlockEntities': True}}
BLOCK = '{id:"create:schematicannon",State:"STOPPED",FlyingBlocks:[],AmountPlaced:0,AmountToPlace:0,Printer:{PrintStage:"BLOCKS",DeferredBlocks:[],EntityProgress:-1},Inventory:{Size:5,Items:[{Slot:1,id:"create:empty_schematic",count:1},{Slot:2,id:"minecraft:written_book",count:1,components:{"minecraft:custom_data":{long:9223372036854775807L,arr:[I;1,-2,3],title:"my book"}}}]}}'


class BridgeTest(unittest.TestCase):
    def test_snbt_roundtrip_preserves_types(self):
        encoded = dumps(loads(BLOCK))
        self.assertIn('9223372036854775807L', encoded)
        self.assertIn('[I;1,-2,3]', encoded)
        self.assertEqual(encoded, dumps(loads(encoded)))

    def test_atomic_command_preserves_book_and_guards_empty_slots(self):
        command = bridge.apply_command(loads(BLOCK), JOB)
        self.assertIn('if block 0 64 0 create:schematicannon', command)
        self.assertIn('"State":"STOPPED"', command)
        self.assertIn('unless data block 0 64 0 Printer.Anchor', command)
        self.assertIn('unless data block 0 64 0 Inventory.Items[{Slot:0}]', command)
        payload = loads(command.split(' run data merge block 0 64 0 ', 1)[1])
        self.assertEqual([int(i['Slot']) for i in payload['Inventory']['Items']], [2, 0])
        self.assertIn('9223372036854775807L', dumps(payload))
        self.assertTrue(bridge.installed({**loads(BLOCK), **payload}, JOB))
        self.assertNotIn('RUNNING', command)

    def test_busy_cannon_is_never_changed(self):
        for state in ('RUNNING', 'PAUSED'):
            block = loads(BLOCK)
            block['State'] = state
            with self.assertRaises(bridge.Waiting):
                bridge.apply_command(block, JOB)
        block = loads(BLOCK)
        block['FlyingBlocks'] = [{}]
        with self.assertRaises(bridge.Waiting):
            bridge.apply_command(block, JOB)
        block = loads(BLOCK)
        block['Printer']['Anchor'] = [0, 64, 0]
        with self.assertRaises(bridge.Waiting):
            bridge.apply_command(block, JOB)

    def test_foreign_plan_and_invalid_targets_are_rejected(self):
        block = loads(BLOCK)
        block['Inventory']['Items'].append({'Slot': 0, 'id': 'create:schematic', 'components': {'create:schematic_owner': 'LoggeL'}})
        with self.assertRaises(bridge.Waiting):
            bridge.apply_command(block, JOB)
        job = copy.deepcopy(JOB)
        job['settings']['replaceMode'] = 3
        with self.assertRaises(ValueError):
            bridge.apply_command(loads(BLOCK), job)

    def test_full_controller_prepare_preserves_inventory_and_retries_idempotently(self):
        from campus_cannon import CannonBridge
        with tempfile.TemporaryDirectory() as directory:
            state = loads(BLOCK)
            commands = []
            def run(command):
                nonlocal state
                commands.append(command)
                if ' run data merge block ' in command:
                    state.update(loads(command.split(' run data merge block 0 64 0 ', 1)[1]))
                    return 'Modified block data'
                return '0, 64, 0 has the following block data: ' + dumps(state)
            controller = CannonBridge(directory, run)
            binding = dict(dimension='minecraft:overworld', x=0, y=64, z=0, owner='Owner')
            data = gzip.compress(b'\x0a\x00\x00\x00')
            desired = dict(file=JOB['fileName'], sha256=hashlib.sha256(data).hexdigest(), owner='Owner', anchor=JOB['origin'],
                           rotation='none', mirror='none', blueprint='test', version=1)
            result = bridge.prepare_schematic(controller, binding, desired, base64.b64encode(data).decode(), bridge.options(JOB), JOB['size'])
            self.assertEqual(result['observed']['components']['create:schematic_anchor'], JOB['origin'])
            self.assertEqual(result['observed']['fileHash'], desired['sha256'])
            self.assertEqual(result['observed']['options'], bridge.options(JOB))
            self.assertIn('9223372036854775807L', dumps(state))
            self.assertEqual(len(list((Path(directory) / 'discord/campus-schematic-backups').iterdir())), 1)
            before = len([c for c in commands if ' run data merge block ' in c])
            bridge.prepare_schematic(controller, binding, desired, base64.b64encode(data).decode(), bridge.options(JOB), JOB['size'])
            self.assertEqual(len([c for c in commands if ' run data merge block ' in c]), before)

    def test_native_start_between_read_and_write_is_not_acknowledged(self):
        from campus_cannon import CannonBridge
        with tempfile.TemporaryDirectory() as directory:
            state = loads(BLOCK)
            def run(command):
                if ' run data merge block ' in command:
                    state['State'] = 'RUNNING'  # The real command's STOPPED guard refuses this race.
                    return 'Test failed'
                return '0, 64, 0 has the following block data: ' + dumps(state)
            controller = CannonBridge(directory, run)
            binding = dict(dimension='minecraft:overworld', x=0, y=64, z=0, owner='Owner')
            data = gzip.compress(b'\x0a\x00\x00\x00')
            desired = dict(file=JOB['fileName'], sha256=hashlib.sha256(data).hexdigest(), owner='Owner', anchor=JOB['origin'], rotation='none', mirror='none', blueprint='test', version=1)
            with self.assertRaisesRegex(ValueError, 'Keine Freigabe'):
                bridge.prepare_schematic(controller, binding, desired, base64.b64encode(data).decode(), bridge.options(JOB), JOB['size'])
            self.assertFalse(bridge.installed(state, JOB))
        job = copy.deepcopy(JOB)
        job['origin'] = [10000, 64, 0]
        with self.assertRaises(ValueError):
            bridge.apply_command(loads(BLOCK), job)


if __name__ == '__main__':
    unittest.main()
