"""Automatic station binding uses fixture worlds and never changes Minecraft blocks."""
import copy
import io
import json
import re
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'controller'))
from campus_cannon import CannonBridge, RequestAuth, serve_campus
from campus_discovery import validate_candidate, side_offset, proof_command, parse_settings, condition

CANDIDATE = {
    'computer': {'id': 4, 'x': 96, 'y': 64, 'z': 23, 'block': 'computercraft:computer_advanced', 'facing': 'south'},
    'chest': {'x': 95, 'y': 64, 'z': 23, 'block': 'minecraft:chest', 'side': 'left'},
    'binding': {'dimension': 'minecraft:overworld', 'x': 94, 'y': 64, 'z': 23, 'owner': 'Campus'},
}
BINDING = CANDIDATE['binding']
OLD = {**BINDING, 'x': 32}


def pos(record):
    return tuple(record[k] for k in ('x', 'y', 'z'))


def idle():
    return {'state': 'STOPPED', 'amountPlaced': 0, 'amountToPlace': 0, 'flyingBlocks': 0,
            'printer': {'DeferredBlocks': [], 'EntityProgress': -1, 'PrintStage': 'BLOCKS'}}


class World:
    def __init__(self):
        self.blocks = {
            (96, 64, 23): ('computercraft:computer_advanced', {'facing': 'south'}, {'ComputerId': 4}),
            (95, 64, 23): ('minecraft:chest', {'type': 'single'}, {}),
            (94, 64, 23): ('create:schematicannon', {}, {}),
            pos(OLD): ('create:schematicannon', {}, {}),
        }
        self.loaded = {(x // 16, z // 16) for x, _, z in self.blocks}
        self.calls = []
        self.observed = {pos(BINDING): idle(), pos(OLD): idle()}

    def run(self, command):
        self.calls.append(command)
        parts = command.split()
        assert parts[:3] == ['execute', 'in', 'minecraft:overworld'], command
        assert parts[-5:-1] == ['run', 'data', 'get', 'storage'], 'only read-only storage proof allowed'
        marker = parts[-1]
        assert re.fullmatch(r'campus:discovery_[0-9a-f]{32}', marker)
        parts = parts[:-5]
        i = 3
        while i < len(parts):
            mode, kind = parts[i:i+2]; p = tuple(map(int, parts[i+2:i+5]));i += 5
            if kind == 'loaded':
                match = (p[0] // 16, p[2] // 16) in self.loaded
            else:
                assert kind == 'block'
                spec = parts[i];i += 1
                found = re.fullmatch(r'([a-z0-9_:]+)(?:\[([^]]+)\])?(?:\{ComputerId:(\d+)\})?', spec)
                assert found, spec
                name, props, computer_id = found.groups()
                block, states, nbt = self.blocks.get(p, ('minecraft:air', {}, {}))
                match = block == name
                if props:
                    key, value = props.split('=');match = match and states.get(key) == value
                if computer_id:
                    match = match and nbt.get('ComputerId') == int(computer_id)
            if match != (mode == 'if'):
                return '\n'
        return f'Storage {marker} has the following contents: {{}}\n\x1b[0m\n'


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.world = World()
        self.bridge = CannonBridge(self.tmp.name, self.world.run)
        self.bridge.inspect = lambda binding: copy.deepcopy(self.world.observed[pos(binding)])
        self.settings = Path(self.tmp.name) / 'data/world/computercraft/computer/4/.settings'
        self.settings.parent.mkdir(parents=True)
        self.settings.write_text(json.dumps({'campus.cannon': 'kanone-4'}))

    def discover(self, candidate=None):
        return self.bridge.handle('discover', {'station': 'kanone-4', 'candidate': candidate or CANDIDATE})

    def test_new_exact_station_binding_is_persisted_only_after_live_proof(self):
        result = self.discover()
        self.assertEqual(result['binding'], BINDING)
        self.assertTrue(result['discovered'])
        self.assertEqual(self.bridge.registry(), {'kanone-4': BINDING})
        self.assertEqual(len(self.world.calls), 2)
        self.assertEqual(self.bridge.path.stat().st_mode & 0o777, 0o600)
        self.assertLessEqual(len(proof_command(CANDIDATE).encode()), 950)

    def test_existing_same_binding_is_read_only_even_when_running(self):
        self.bridge.save_registry({'kanone-4': BINDING})
        before = (self.bridge.path.stat().st_mtime_ns, self.bridge.path.read_bytes())
        self.world.observed[pos(BINDING)] = {**idle(), 'state': 'RUNNING', 'amountPlaced': 300, 'flyingBlocks': 7}
        self.assertEqual(self.discover()['observed']['state'], 'RUNNING')
        self.assertEqual((self.bridge.path.stat().st_mtime_ns, self.bridge.path.read_bytes()), before)

    def test_condition_correlates_its_own_reply_and_retries_only_once(self):
        calls = []
        def mixed_then_clean(command):
            calls.append(command)
            marker = command.rsplit(' ', 1)[1]
            own = f'Storage {marker} has the following contents: {{}}'
            return 'Test failed\n' + own if len(calls) == 1 else own
        bridge = SimpleNamespace(run=mixed_then_clean)
        self.assertTrue(condition(bridge, proof_command(CANDIDATE)))
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0], calls[1], 'each attempt needs a fresh correlation marker')
        for reply in ['Test passed', 'Test passed, count: 1', 'Test failed',
                      'Storage campus:discovery_' + '0'*32 + ' has the following contents: {}',
                      'Test passed\nTest failed']:
            with self.subTest(reply=reply):
                calls.clear()
                def unrelated(command):calls.append(command);return reply
                with self.assertRaisesRegex(ValueError, 'keine eindeutige RCON-Antwort'):
                    condition(SimpleNamespace(run=unrelated), proof_command(CANDIDATE))
                self.assertEqual(len(calls), 2)
        calls.clear()
        def empty(command):calls.append(command);return '\n'
        self.assertFalse(condition(SimpleNamespace(run=empty), proof_command(CANDIDATE)))
        self.assertEqual(len(calls), 2)

    def test_mixed_or_missing_proof_never_persists_a_binding(self):
        for reply in ['Test passed\nTest failed', '\n']:
            with self.subTest(reply=reply):
                self.bridge.run = lambda _: reply
                with self.assertRaises(ValueError):self.discover()
                self.assertFalse(self.bridge.path.exists())

    def test_wrong_computer_chest_ambiguity_and_unloaded_neighbors_never_bind(self):
        mutations = [lambda w: w.blocks.__setitem__((96,64,23), ('computercraft:computer_advanced', {'facing':'south'}, {'ComputerId':5})),
                     lambda w: w.blocks.__setitem__((96,64,23), ('computercraft:computer_advanced', {'facing':'north'}, {'ComputerId':4})),
                     lambda w: w.blocks.__setitem__((95,64,23), ('minecraft:chest', {'type':'left'}, {})),
                     lambda w: w.blocks.__setitem__((95,65,23), ('create:schematicannon', {}, {})),
                     lambda w: w.blocks.__setitem__((94,64,23), ('minecraft:stone', {}, {})),
                     lambda w: w.loaded.discard((6,1))]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                self.world = World();mutate(self.world);self.bridge.run = self.world.run
                with self.assertRaises(ValueError):self.discover()
                self.assertFalse(self.bridge.path.exists())

    def test_station_settings_and_other_station_ownership_are_authoritative(self):
        for value in [{'campus.cannon':'other'}, {'campus.cannon':'kanone-4','campus.chest':'right'}]:
            self.settings.write_text(json.dumps(value))
            with self.assertRaises(ValueError):self.discover()
            self.assertFalse(self.bridge.path.exists())
        self.settings.write_text(json.dumps({'campus.cannon':'kanone-4','campus.chest':'left'}))
        self.bridge.save_registry({'other':BINDING})
        with self.assertRaisesRegex(ValueError,'anderen Station'):self.discover()
        self.assertEqual(self.bridge.registry(),{'other':BINDING})

    def test_real_cc_lua_settings_are_read_without_execution_or_duplicate_keys(self):
        raw = '{\n  [ "campus.cannon" ] = "kanone-4",\n  [ "campus.url" ] = "https://example.test",\n  [ "campus.token" ] = "fixture-token",\n  other = true,\n}'
        self.settings.write_text(raw)
        self.assertEqual(self.discover()['binding'], BINDING)
        self.assertEqual(parse_settings(raw)['other'], True)
        for bad in ['{"campus.cannon":"other","campus.cannon":"kanone-4"}',
                    '{ ["campus.cannon"]="other", ["campus.cannon"]="kanone-4" }',
                    '{ ["campus.cannon"]="kanone-4", ["campus.chest"]="left", ["campus.chest"]="right" }',
                    '{ ["campus.cannon"]=os.execute("anything") }',
                    '{ ["campus.cannon"]="kanone-4", nested={ ["campus.cannon"]="other" } }',
                    ' ' * 65537]:
            with self.subTest(bad=bad[:50]), self.assertRaises(ValueError):
                parse_settings(bad)

    def test_rebind_requires_idle_or_loaded_absent_old_and_idle_new(self):
        for old_state in ['idle','absent','active','unloaded']:
            with self.subTest(old=old_state):
                self.world=World();self.bridge.run=self.world.run
                self.bridge.save_registry({'kanone-4':OLD})
                if old_state=='absent':self.world.blocks.pop(pos(OLD))
                if old_state=='active':self.world.observed[pos(OLD)]['state']='PAUSED'
                if old_state=='unloaded':self.world.loaded.discard((2,1))
                if old_state in ('idle','absent'):
                    self.assertEqual(self.discover()['binding'],BINDING)
                else:
                    with self.assertRaises(ValueError):self.discover()
                    self.assertEqual(self.bridge.registry(),{'kanone-4':OLD})
        self.world=World();self.bridge.run=self.world.run;self.bridge.save_registry({'kanone-4':OLD})
        self.world.observed[pos(BINDING)]['state']='RUNNING'
        with self.assertRaises(ValueError):self.discover()
        self.assertEqual(self.bridge.registry(),{'kanone-4':OLD})

    def test_repeated_proof_rejects_changes_before_registry_write(self):
        for change in ('started','computer','settings','registry'):
            with self.subTest(change=change):
                self.world=World();self.bridge.run=self.world.run
                self.bridge.path.unlink(missing_ok=True)
                self.settings.write_text(json.dumps({'campus.cannon':'kanone-4'}))
                count=0
                def inspect(binding):
                    nonlocal count
                    count+=1
                    if count==2:
                        if change=='started':self.world.observed[pos(binding)]['state']='RUNNING'
                        if change=='computer':self.world.blocks[(96,64,23)][2]['ComputerId']=99
                        if change=='settings':self.settings.write_text(json.dumps({'campus.cannon':'other'}))
                        if change=='registry':self.bridge.save_registry({'other':OLD})
                    return copy.deepcopy(self.world.observed[pos(binding)])
                self.bridge.inspect=inspect
                with self.assertRaises(ValueError):self.discover()
                if change=='registry':self.assertEqual(self.bridge.registry(),{'other':OLD})
                else:self.assertFalse(self.bridge.path.exists())

    def test_validation_rejects_command_inputs_wrong_side_and_unknown_types(self):
        for part,key,value in [('computer','id',True),('computer','x',30_000_001),('computer','block','minecraft:stone run kill @a'),
                               ('computer','facing','south] run say hi'),('chest','side','inventory_1'),('chest','x',97),
                               ('binding','x',90),('binding','dimension','minecraft:the_nether'),('binding','owner','../bad')]:
            candidate=copy.deepcopy(CANDIDATE);candidate[part][key]=value
            with self.subTest(part=part,key=key), self.assertRaises(ValueError):self.discover(candidate)
        self.assertEqual(self.world.calls,[])
        self.assertEqual(side_offset('south','left'),(-1,0,0))
        self.assertEqual(side_offset('north','left'),(1,0,0))
        self.assertEqual(side_offset('east','right'),(0,0,-1))

    def test_discovery_route_requires_signed_request(self):
        handler=SimpleNamespace(path='/campus/discover',headers={'Content-Length':'2'},rfile=io.BytesIO(b'{}'),connection=SimpleNamespace(settimeout=lambda _:None))
        replies=[];handler.reply=lambda code,body:replies.append((code,body))
        controller=SimpleNamespace(base=Path(self.tmp.name),lock=threading.Lock())
        serve_campus(handler,controller,self.bridge,RequestAuth('s'*64))
        self.assertEqual(replies[0][0],401)
        self.assertFalse(self.bridge.path.exists())


if __name__=='__main__':unittest.main()
