"""Read-only bridge tests; never connect these fixtures to Minecraft."""
import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'controller'))

class AlignmentTests(unittest.TestCase):
    def test_binding_validation_rejects_commands_and_requires_confirmation(self):
        try:
            from campus_cannon import validate_binding
        except ImportError:
            self.fail('trusted binding validator is not implemented')
        valid = dict(dimension='minecraft:overworld', x=94, y=64, z=21, owner='KGZJonny')
        self.assertEqual(validate_binding(valid), valid)
        for change in [dict(x=True), dict(x=30000001), dict(owner='../admin'), dict(dimension='overworld run kill @a'), dict(z=1.5), dict(extra='command')]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_binding({**valid, **change})

    def test_apply_stopped_empty_printer_preserves_inventory_and_readback(self):
        import campus_cannon as c
        import tempfile, hashlib
        with tempfile.TemporaryDirectory() as d:
            bridge = c.CannonBridge(Path(d), lambda cmd: '')
            self.assertTrue(hasattr(bridge, 'apply'), 'guarded apply missing')
            b = dict(dimension='minecraft:overworld', x=94,y=64,z=21,owner='KGZJonny')
            desired = dict(file='test.nbt', sha256=hashlib.sha256(b'blueprint').hexdigest(), owner='KGZJonny', anchor=[62,191,24], rotation='none', mirror='none', blueprint='bp', version=1)
            path = Path(d)/'data/schematics/uploaded/KGZJonny/test.nbt'; path.parent.mkdir(parents=True); path.write_bytes(b'blueprint')
            obs = dict(state='STOPPED', amountPlaced=0, amountToPlace=0, printer={'EntityProgress':-1,'PrintStage':'BLOCKS','DeferredBlocks':[]}, item='create:schematic', components={'create:schematic_file':'test.nbt','create:schematic_owner':'KGZJonny'}, fileHash=desired['sha256'])
            calls = []
            after = {**obs, 'components':{**obs['components'], 'create:schematic_anchor':desired['anchor'], 'create:schematic_rotation':'none', 'create:schematic_mirror':'none', 'create:schematic_deployed':1}}
            bridge.inspect = lambda _: after
            bridge.run = lambda cmd: calls.append(cmd) or 'Modified block data'
            result = bridge.apply(b, desired, obs)
            self.assertEqual(result['observed']['amountPlaced'], 0)
            self.assertEqual(len(calls), 1)
            self.assertIn('unless data block 94 64 21 Printer.Anchor', calls[0])
            self.assertIn('Inventory.Items[{Slot:0,id:"create:schematic"}].components merge value', calls[0])
            self.assertIn('[I;62,191,24]', calls[0])
            self.assertNotIn('Slot:0b', calls[0])
            self.assertNotIn('set value', calls[0])
            for changed in [dict(state='RUNNING'),dict(state='PAUSED'),dict(amountPlaced=1),dict(printer={'Anchor':[1,2,3]}),dict(amountPlaced=None),dict(fileHash='0'*64)]:
                calls.clear()
                with self.subTest(changed=changed), self.assertRaises(ValueError): bridge.apply(b, desired, {**obs, **changed})
                self.assertEqual(calls, [])
            calls.clear(); bridge.inspect = lambda _: {**after,'amountPlaced':1}
            with self.assertRaises(ValueError): bridge.apply(b, desired, obs)

class ProbeTests(unittest.TestCase):
    def test_live_snbt_parser_preserves_integer_arrays_and_slot(self):
        import campus_cannon as c
        self.assertTrue(hasattr(c, 'parse_snbt'), 'read-only NBT parser missing')
        n = c.parse_snbt('{State:"RUNNING", AmountPlaced:1356, Inventory:{Items:[{Slot:0, components:{"create:schematic_anchor":[I;62,191,24], "create:schematic_deployed":1b}}]}, Progress:0.5f}')
        self.assertEqual(n['Inventory']['Items'][0]['Slot'], 0)
        self.assertEqual(n['Inventory']['Items'][0]['components']['create:schematic_anchor'], [62,191,24])
        self.assertEqual(n['Progress'], .5)
        for bad in ['{} junk', '{a:1,a:2}', '{x:[I;1,2}', '{a:}']:
            with self.subTest(bad=bad), self.assertRaises(ValueError): c.parse_snbt(bad)

class BridgeTests(unittest.TestCase):
    def test_registry_confirmation_read_only_probe_and_running_refusal(self):
        import campus_cannon as c
        import tempfile, json
        self.assertTrue(hasattr(c, 'CannonBridge'), 'station bridge missing')
        with tempfile.TemporaryDirectory() as d:
            calls = []
            def run(command):
                calls.append(command)
                return '94, 64, 21 has the following block data: {id:"create:schematicannon", State:"RUNNING", AmountPlaced:1356, Printer:{Anchor:[I;62,191,24]}, Inventory:{Items:[{Slot:0,id:"create:schematic",components:{"create:schematic_owner":"KGZJonny", "create:schematic_file":"test.nbt"}}]}}\n\x1b[0m\n'
            bridge = c.CannonBridge(Path(d), run)
            b = dict(dimension='minecraft:overworld', x=94,y=64,z=21,owner='KGZJonny')
            p = bridge.handle('probe', {'binding':b})
            self.assertEqual(p['observed']['amountPlaced'], 1356)
            self.assertFalse((Path(d)/'discord/cannon-registry.json').exists())
            with self.assertRaises(ValueError): bridge.handle('inspect', {'station':'not-registered'})
            with self.assertRaises(ValueError): bridge.handle('bind', {'station':'one','binding':b,'nonce':'fake'})
            r = bridge.handle('bind', {'station':'one','binding':b,'nonce':p['nonce']})
            self.assertEqual(r['binding'], b)
            self.assertEqual(bridge.handle('inspect', {'station':'one'})['observed']['state'], 'RUNNING')
            with self.assertRaises(ValueError): bridge.handle('apply', {'station':'one','desired':{}})
            self.assertTrue(all('data get block' in x for x in calls))

class AuthTests(unittest.TestCase):
    def test_signed_requests_reject_origin_replay_wrong_key_and_expiry(self):
        import campus_cannon as c
        import hmac, hashlib, time
        self.assertTrue(hasattr(c, 'RequestAuth'), 'bridge request authentication missing')
        a = c.RequestAuth('s'*64); body=b'{"station":"one"}'; path='/campus/inspect'
        stamp=str(int(time.time())); nonce='n'*32
        headers={'X-Campus-Time':stamp, 'X-Campus-Nonce':nonce}
        headers['X-Campus-Signature']=hmac.new(b's'*64, path.encode()+b'\n'+stamp.encode()+b'\n'+nonce.encode()+b'\n'+body, hashlib.sha256).hexdigest()
        self.assertFalse(a.verify(path, {**headers,'Origin':'https://evil.test'}, body))
        self.assertFalse(a.verify(path, {**headers,'X-Campus-Signature':'0'*64}, body))
        self.assertFalse(a.verify(path, {**headers,'X-Campus-Time':'0'}, body))
        self.assertTrue(a.verify(path, headers, body))
        self.assertFalse(a.verify(path, headers, body))
        self.assertFalse(c.RequestAuth('').verify(path, headers, body))

class HttpTests(unittest.TestCase):
    def test_actual_controller_bridge_requires_signature_and_has_no_general_rcon(self):
        import campus_cannon as c
        import tempfile, threading, urllib.request, urllib.error, hmac, hashlib, time, json
        sys.path.insert(0,'/home/logge/minecraft/atm10/discord')
        import control
        import inspect
        self.assertIn('campus_bridge',inspect.signature(control.make_server).parameters,'controller has no narrow bridge hook')
        with tempfile.TemporaryDirectory() as d:
            class Controller:
                base=Path(d)
                lock=threading.Lock()
            seen=[]
            class Bridge:
                def handle(self,action,obj): seen.append((action,obj));return {'ok':True}
            server=control.make_server(('127.0.0.1',0),'old-token',Controller(),campus_bridge=Bridge(),campus_secret='s'*64)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                def req(path,headers,raw=b'{"station":"one"}'):
                    try:
                        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:'+str(server.server_port)+path,data=raw,headers=headers)) as res:return res.status
                    except urllib.error.HTTPError as e:
                        code=e.code;e.close();return code
                self.assertEqual(req('/campus/inspect',{}),401)
                self.assertEqual(req('/campus/inspect',{'Authorization':'Bearer old-token'}),401)
                path='/campus/inspect';stamp=str(int(time.time()));nonce='z'*32;raw=b'{"station":"one"}'
                headers={'X-Campus-Time':stamp,'X-Campus-Nonce':nonce,'X-Campus-Signature':hmac.new(b's'*64,(path+'\n'+stamp+'\n'+nonce+'\n').encode()+raw,hashlib.sha256).hexdigest()}
                self.assertEqual(req(path,headers),200)
                self.assertEqual(req(path,headers),401)
                self.assertEqual(req('/campus/rcon',headers),404)
                self.assertEqual(seen,[('inspect',{'station':'one'})])
            finally:server.shutdown();server.server_close();thread.join()

if __name__ == '__main__': unittest.main()
