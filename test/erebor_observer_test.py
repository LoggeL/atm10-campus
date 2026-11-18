"""Read-only expansion is deliberately independent of scheduler/feed opt-in."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'controller'))
import campus_erebor


def config():
    return dict(schema=1, version=12, mode='observe-only', sites=[dict(
        site='K12', main=[-316,111,-10242], bridge=[-316,111,-10245], groups=[
            dict(computerId=50, computer=[-317,111,-10245], chest=[-318,111,-10245],
                 slots=dict(D=[-319,111,-10245], E=[-318,111,-10246], F=[-318,111,-10244])),
            dict(computerId=51, computer=[-315,111,-10245], chest=[-314,111,-10245],
                 slots=dict(G=[-313,111,-10245], H=[-314,111,-10246], I=[-314,111,-10244]))])])


class ObserverTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        for name in ('stations', 'parallel'):
            (self.path / ('erebor-' + name + '.json')).write_bytes(
                (ROOT / ('src/erebor-fleet/' + name + '.json')).read_bytes())
        self.context = patch.object(campus_erebor, '__file__', str(self.path / 'campus_erebor.py'))
        self.context.start()
        self.addCleanup(self.context.stop)
        self.bridge = Mock()
        self.bridge.inspect.return_value = dict(amountPlaced=0, state='STOPPED', inputEmpty=True)

    def save(self, value):
        (self.path / 'erebor-observers.json').write_text(json.dumps(value))

    def test_explicit_mapping_exposes_native_counters_without_enabling_mutations(self):
        value = config()
        self.save(value)
        for group in value['sites'][0]['groups']:
            for slot, position in group['slots'].items():
                result = campus_erebor.handle(self.bridge, 'erebor-inspect', dict(version=12, site='K12'+slot))
                self.assertTrue(result['observerOnly'])
                self.assertEqual(result['observed']['amountPlaced'], 0)
                self.assertEqual(self.bridge.inspect.call_args.args[0],
                                 dict(zip('xyz', position), dimension='minecraft:overworld', owner='Erebor'))
        self.assertEqual(self.bridge.method_calls, [call for call in self.bridge.method_calls if call[0]=='inspect'])

    def test_missing_opt_in_and_unmapped_site_fail_before_world_access(self):
        with self.assertRaises(ValueError):
            campus_erebor.handle(self.bridge, 'erebor-inspect', dict(version=12, site='K12D'))
        for value in (None, config()):
            if value is not None:
                self.save(value)
            for site in ('K24D', 'K12A', 'K12J', 'K12DD'):
                with self.assertRaises(ValueError):
                    campus_erebor.handle(self.bridge, 'erebor-inspect', dict(version=12, site=site))
        self.bridge.inspect.assert_not_called()

    def test_new_slots_reject_all_mutating_actions_even_with_mapping(self):
        self.save(config())
        for action in ('erebor-prepare', 'erebor-start', 'erebor-supply'):
            obj = dict(version=12, site='K12D')
            if action == 'erebor-supply':
                obj.update(computerId=50, chestSide='front')
            else:
                obj.update(desired={}, kind='stone', size=[32,32,32])
                if action == 'erebor-prepare':
                    obj['nbtBase64']=''
            with self.assertRaisesRegex(ValueError, 'Beobachtung'):
                campus_erebor.handle(self.bridge, action, obj)
        self.assertFalse(self.bridge.method_calls)

    def test_invalid_mapping_is_rejected_atomically(self):
        mutations = [
            lambda c: c.update(version=11),
            lambda c: c.update(mode='enabled'),
            lambda c: c.update(schema=True),
            lambda c: c['sites'].append(copy.deepcopy(c['sites'][0])),
            lambda c: c['sites'][0].update(main=[0,0,0]),
            lambda c: c['sites'][0].update(bridge=[0,0,0]),
            lambda c: c['sites'][0]['groups'][1].update(computerId=50),
            lambda c: c['sites'][0]['groups'][1].update(computerId=True),
            lambda c: c['sites'][0]['groups'][1]['slots'].update(I=[-314,111,-10246]),
            lambda c: c['sites'][0]['groups'][1]['slots'].update(I=[0,0,0]),
            lambda c: c['sites'][0]['groups'][1]['slots'].update(I=[0.5,0,0]),
            lambda c: c['sites'][0]['groups'][1]['slots'].update(A=[0,0,0]),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutations.index(mutate)):
                value=config()
                mutate(value)
                self.save(value)
                with self.assertRaises(ValueError):
                    campus_erebor.handle(self.bridge, 'erebor-inspect', dict(version=12, site='K12D'))
        self.assertFalse(self.bridge.method_calls)

    def test_legacy_inspection_does_not_depend_on_observer_file(self):
        self.save(dict(mode='corrupt'))
        for key in ('K12','K12B','K12C','K24B'):
            result=campus_erebor.handle(self.bridge, 'erebor-inspect', dict(version=12,site=key))
            self.assertNotIn('observerOnly', result)
        self.assertEqual(self.bridge.inspect.call_count,4)


if __name__=='__main__':
    unittest.main()
