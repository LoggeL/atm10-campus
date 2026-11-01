"""Web-start and bounded status probes use fixtures only, never a real Minecraft world."""
import copy
import hashlib
import io
import sys
import tempfile
import threading
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'controller'))
from campus_cannon import CannonBridge, parse_snbt
from campus_probe import read_fields
from campus_snbt import dumps
from campus_start import start, start_command, expected_components

BINDING = dict(dimension='minecraft:overworld', x=94, y=64, z=21, owner='Campus')
DESIRED = dict(file='campus_00000000-0000-0000-0000-000000000000.nbt', sha256=hashlib.sha256(b'plan').hexdigest(),
               owner='Campus', anchor=[64, 138, 26], rotation='none', mirror='none', blueprint='tower', version=2)
OPTIONS = dict(replace_mode=2, skip_missing=False, replace_block_entities=False)


def observed(state='STOPPED'):
    printer = dict(DeferredBlocks=[], EntityProgress=-1, PrintStage='BLOCKS')
    if state != 'STOPPED':
        printer.update(Anchor=DESIRED['anchor'], CurrentPos=[0, 0, 0])
    return dict(state=state, status='ready', amountPlaced=0, amountToPlace=0, flyingBlocks=0,
                printer=printer, item='create:schematic', components=expected_components(DESIRED),
                options=OPTIONS, fileHash=DESIRED['sha256'])


class StartTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.calls = []
        self.bridge = CannonBridge(self.temp.name, lambda c: self.calls.append(c) or 'Modified block data')
        path = Path(self.temp.name) / 'data/schematics/uploaded/Campus' / DESIRED['file']
        path.parent.mkdir(parents=True); path.write_bytes(b'plan')

    def test_one_click_initializes_then_starts_with_second_guard(self):
        states = iter([observed('PAUSED'), observed('RUNNING')])
        self.bridge.inspect = lambda _: next(states)
        result = start(self.bridge, BINDING, DESIRED, OPTIONS, observed())
        self.assertTrue(result['started'])
        self.assertEqual(len(self.calls), 2)
        self.assertIn('unless data block 94 64 21 Printer.Anchor', self.calls[0])
        self.assertIn('State:"PAUSED"', self.calls[1])
        for command in self.calls:
            self.assertIn('create:schematic_anchor', command)
            self.assertIn('Options:{replace_mode:2,skip_missing:0b,replace_block_entities:0b}', command)
            self.assertIn('State set value "RUNNING"', command)
            self.assertNotIn('merge value', command)
            self.assertLessEqual(len(command.encode()), 950)

    def test_resume_preserves_progress_and_running_is_idempotent(self):
        o = observed('PAUSED');o.update(amountPlaced=100, amountToPlace=1000, flyingBlocks=0)
        after = copy.deepcopy(o);after['state'] = 'RUNNING';after['amountPlaced'] = 101
        self.bridge.inspect = lambda _: after
        result = start(self.bridge, BINDING, DESIRED, OPTIONS, o)
        self.assertEqual(result['observed']['amountPlaced'], 101)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('AmountPlaced:100', self.calls[0])
        self.assertIn('CurrentPos:[I;0,0,0]', self.calls[0])
        self.assertIn('FlyingBlocks:[]', self.calls[0])
        self.calls.clear()
        after['flyingBlocks'] = 3
        self.assertTrue(start(self.bridge, BINDING, DESIRED, OPTIONS, after)['alreadyRunning'])
        self.assertEqual(self.calls, [])
        o['flyingBlocks'] = 3
        with self.assertRaisesRegex(ValueError,'im Flug'):
            start(self.bridge, BINDING, DESIRED, OPTIONS, o)
        self.assertEqual(self.calls, [], 'resume with flights must never rewrite block NBT')

    def test_drift_cached_stopped_and_untrusted_inputs_never_write(self):
        for patch in [dict(fileHash='0'*64), dict(options={**OPTIONS, 'skip_missing':True}), dict(amountPlaced=1),
                      dict(flyingBlocks=1), dict(printer={}), dict(state='UNKNOWN'), dict(item='minecraft:stone')]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                start(self.bridge, BINDING, DESIRED, OPTIONS, {**observed(), **patch})
            self.assertEqual(self.calls, [])
        for target in [{**DESIRED,'file':'../../bad.nbt'}, {**DESIRED,'anchor':[9999,64,0]}, {**DESIRED,'version':True}]:
            with self.assertRaises(ValueError):start(self.bridge, BINDING, target, OPTIONS, observed())
        changed = observed('PAUSED');changed['printer']['Anchor'] = [1, 2, 3]
        with self.assertRaises(ValueError):start(self.bridge,BINDING,DESIRED,OPTIONS,changed)

    def test_write_race_and_changed_plan_after_initialization_never_resume(self):
        self.bridge.run = lambda command: self.calls.append(command) or 'Test failed'
        with self.assertRaisesRegex(ValueError,'nicht ausgeführt'):
            start(self.bridge,BINDING,DESIRED,OPTIONS,observed())
        self.assertEqual(len(self.calls),1)
        self.calls.clear();self.bridge.run = lambda command: self.calls.append(command) or 'Modified block data'
        changed = observed('PAUSED');changed['components']['create:schematic_file']='other.nbt'
        self.bridge.inspect = lambda _: changed
        with self.assertRaisesRegex(ValueError,'Schematic'):
            start(self.bridge,BINDING,DESIRED,OPTIONS,observed())
        self.assertEqual(len(self.calls),1)


class ProbeTests(unittest.TestCase):
    def fixture(self, change=False, finished=False, change_output=False):
        item = {'Slot':0,'id':'create:schematic','components':expected_components(DESIRED)}
        values = {'id':'create:schematicannon','State':'RUNNING','Options':OPTIONS,'Inventory.Items[{Slot:0}]':item,
                  'Inventory.Items[{Slot:1}]':{'Slot':1,'id':'create:empty_schematic','count':4},
                  'Printer.Anchor':DESIRED['anchor'],'Printer.CurrentPos':[0,1,2], 'Printer.PrintStage':'BLOCKS',
                  'Printer.EntityProgress':-1, 'AmountPlaced':500, 'AmountToPlace':2000,'Status':'placing'}
        if finished:
            values.update({'State':'STOPPED','Status':'finished','Inventory.Items[{Slot:0}]':None,
                           'Printer.Anchor':None,'Printer.CurrentPos':None,'AmountPlaced':0,'AmountToPlace':0})
        calls=[];identities=0
        def run(command):
            nonlocal identities
            calls.append(command)
            if command == 'execute in minecraft:overworld run data get block 94 64 21':
                return '94, 64, 21 has the following block data: {Inventory:{Items:[{components:{book:"' + 'x'*4096
            if ' run data get storage ' in command:
                self.assertIn('unless data block 94 64 21 FlyingBlocks[]', command)
                return f'Storage {command.rsplit(" ",1)[1]} has the following contents: {{}}'
            if ' if data ' in command:
                return 'Test passed, count: 3' if 'FlyingBlocks' in command and not finished else 'Test failed'
            path=command.split('data get block 94 64 21 ',1)[1]
            if path=='id':identities+=1
            value=values[path]
            if change and identities==2 and path=='State':value='STOPPED'
            if change_output and identities==2 and path=='Inventory.Items[{Slot:1}]':value={**value,'count':5}
            if value is None:return 'Found no elements matching ' + path
            return '94, 64, 21 has the following block data: ' + dumps(value)
        return run,calls

    def test_large_unrelated_book_does_not_break_critical_status(self):
        run,calls=self.fixture()
        bridge=CannonBridge('/unused',run)
        result=bridge.inspect(BINDING)
        self.assertEqual(result['state'],'RUNNING')
        self.assertEqual(result['amountPlaced'],500)
        self.assertEqual(result['flyingBlocks'],3)
        self.assertFalse(result['inputEmpty'])
        self.assertEqual((result['outputItem'], result['outputCount']), ('create:empty_schematic', 4))
        self.assertEqual(result['printer']['Anchor'],DESIRED['anchor'])
        self.assertTrue(all('data get block' in c or ' if data ' in c for c in calls))

    def test_finished_fallback_preserves_output_and_proves_all_flights_landed(self):
        run, calls = self.fixture(finished=True)
        result = CannonBridge('/unused', run).inspect(BINDING)
        self.assertEqual((result['state'], result['status']), ('STOPPED', 'finished'))
        self.assertTrue(result['inputEmpty'])
        self.assertEqual((result['outputItem'], result['outputCount']), ('create:empty_schematic', 4))
        self.assertEqual((result['amountPlaced'], result['amountToPlace'], result['flyingBlocks']), (0, 0, 0))
        self.assertNotIn('Anchor', result['printer'])
        self.assertNotIn('CurrentPos', result['printer'])
        self.assertEqual(len(calls), 22, 'one full read, twenty bounded fields and one flight proof')

    def test_finished_fallback_rejects_unproved_zero_flights_and_output_changes(self):
        run, _ = self.fixture(finished=True)
        def unknown_proof(command):
            return 'Test passed' if ' run data get storage ' in command else run(command)
        with self.assertRaisesRegex(ValueError, 'keine eindeutige RCON-Antwort'):
            CannonBridge('/unused', unknown_proof).inspect(BINDING)
        run, _ = self.fixture(finished=True, change_output=True)
        with self.assertRaisesRegex(ValueError, 'während der Statusprüfung geändert'):
            CannonBridge('/unused', run).inspect(BINDING)

    def test_full_snapshot_reports_inventory_evidence_without_inventing_completion(self):
        for status, items, expected_empty, expected_output in [
            ('finished', [{'Slot':1,'id':'create:empty_schematic','count':5}], True, 5),
            ('schematicExpired', [{'Slot':1,'id':'create:empty_schematic','count':1}], True, 1),
            ('idle', [], True, 0),
            ('finished', [{'Slot':0,'id':'create:schematic'},{'Slot':0,'id':'create:schematic'}], None, 0),
            ('finished', [{'id':'create:empty_schematic','count':1}], None, None),
        ]:
            with self.subTest(status=status,items=items):
                block = {'id':'create:schematicannon','State':'STOPPED','Status':status,'Inventory':{'Items':items},
                         'AmountPlaced':0,'AmountToPlace':0,'FlyingBlocks':[],'Printer':{'DeferredBlocks':[],'PrintStage':'BLOCKS','EntityProgress':-1}}
                result = CannonBridge('/unused', lambda _: '94, 64, 21 has the following block data: ' + dumps(block)).inspect(BINDING)
                self.assertEqual(result['status'], status)
                self.assertEqual(result['inputEmpty'], expected_empty)
                self.assertEqual(result['outputCount'], expected_output)

    def test_mixed_identity_probe_is_rejected(self):
        run,_=self.fixture(change=True)
        with self.assertRaisesRegex(ValueError,'während der Statusprüfung geändert'):
            read_fields(run,BINDING,parse_snbt)

    def test_another_cannons_rcon_reply_never_satisfies_inspect_or_field_probe(self):
        run, calls = self.fixture()
        def other_cannon(command):
            return run(command).replace('94, 64, 21 has the following block data:', '94, 64, 25 has the following block data:')
        with self.assertRaisesRegex(ValueError, 'keine eindeutige Antwort für diese Kanonenposition'):
            CannonBridge('/unused', other_cannon).inspect(BINDING)
        self.assertEqual(len(calls), 1, 'wrong coordinates must not enter the truncated-NBT fallback')
        calls.clear()
        with self.assertRaisesRegex(ValueError, 'keine eindeutige Antwort für diese Kanonenposition'):
            read_fields(other_cannon, BINDING, parse_snbt)
        self.assertEqual(len(calls), 1)

    def test_unrelated_response_prefix_never_satisfies_inspect(self):
        run, calls = self.fixture()
        def mixed(command):
            return 'Test passed\n' + run(command)
        with self.assertRaisesRegex(ValueError, 'keine eindeutige Antwort für diese Kanonenposition'):
            CannonBridge('/unused', mixed).inspect(BINDING)
        self.assertEqual(len(calls), 1)


class HttpTests(unittest.TestCase):
    def test_start_route_is_signed_and_not_a_general_command_endpoint(self):
        from campus_cannon import RequestAuth, serve_campus
        from types import SimpleNamespace
        handler=SimpleNamespace(path='/campus/start',headers={'Content-Length':'2'},rfile=io.BytesIO(b'{}'),
                                connection=SimpleNamespace(settimeout=lambda _:None))
        replies=[];handler.reply=lambda status,body:replies.append((status,body))
        controller=SimpleNamespace(base=Path('/unused'),lock=threading.Lock())
        bridge=SimpleNamespace(handle=lambda *_:self.fail('unsigned start reached controller'))
        serve_campus(handler,controller,bridge,RequestAuth('s'*64))
        self.assertEqual(replies[0][0],401)
        handler.path='/campus/command';replies.clear()
        serve_campus(handler,controller,bridge,RequestAuth('s'*64))
        self.assertEqual(replies[0][0],404)


if __name__ == '__main__':unittest.main()
