import copy
import json
import sys
import time
from pathlib import Path
from unittest.mock import patch
import unittest
import erebor_observer_test as observers
import campus_erebor

class PublishTest(unittest.TestCase):
    def setUp(self):
        import tempfile
        from unittest.mock import Mock
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)
        for name in ('stations','parallel'):
            (self.path/('erebor-'+name+'.json')).write_bytes((observers.ROOT/('src/erebor-fleet/'+name+'.json')).read_bytes())
        context=patch.object(campus_erebor,'__file__',str(self.path/'campus_erebor.py'))
        context.start();self.addCleanup(context.stop)
        self.bridge=Mock()
        self.bridge.base = self.path
        (self.path/'data/kubejs/config').mkdir(parents=True)
        c=observers.config(); c['mode']='leased-targets'
        (self.path/'erebor-runtime-tracker.json').write_text(json.dumps(c))
        (self.path/'data/kubejs/config/erebor-runtime-tracker.json').write_text(json.dumps(c))
        now=int(time.time()*1000)
        self.lease=dict(schema=1,version=12,phase='stone',at=now,expiresAt=now+8000,jobs={
            'K12'+s:dict(file='campus_00000000-0000-0000-0000-'+str(i).zfill(12)+'.nbt',anchor=[-320,110,-10240],size=[2,2,2],options=[2,False,False])
            for i,s in enumerate('DEF')})
    def test_authenticated_dispatch_publishes_exact_short_lived_queue_lease(self):
        result=campus_erebor.handle(self.bridge,'erebor-target-leases',self.lease)
        self.assertTrue(result['published'])
        self.assertEqual(json.loads((self.path/'data/kubejs/config/erebor-runtime-leases.json').read_text()), self.lease)
        self.assertEqual(result['lease'],self.lease)
    def test_invalid_lease_does_not_replace_previous_bytes(self):
        target=self.path/'data/kubejs/config/erebor-runtime-leases.json'
        target.write_text('old')
        variants=[]
        for key,val in [('at',int(time.time()*1000)+50000),('expiresAt',self.lease['at']+10001),('phase','build'),('version',True)]:
            value=copy.deepcopy(self.lease);value[key]=val;variants.append(value)
        value=copy.deepcopy(self.lease);value['jobs']['K12D']['size']=[1000,1,1];variants.append(value)
        value=copy.deepcopy(self.lease);value['jobs']['K13D']=value['jobs'].pop('K12D');variants.append(value)
        value=copy.deepcopy(self.lease);value['jobs']['K12E']['file']=value['jobs']['K12D']['file'];variants.append(value)
        for value in variants:
            with self.assertRaises(ValueError):campus_erebor.handle(self.bridge,'erebor-target-leases',value)
            self.assertEqual(target.read_text(),'old')
    def test_unsigned_publisher_never_reaches_bridge(self):
        import io
        import threading
        from types import SimpleNamespace
        from unittest.mock import Mock
        from campus_cannon import serve_campus, RequestAuth
        raw=json.dumps(self.lease).encode()
        handler=SimpleNamespace(path='/campus/erebor-target-leases',headers={'Content-Length':str(len(raw))},rfile=io.BytesIO(raw),connection=Mock(),reply=Mock())
        serve_campus(handler,SimpleNamespace(base=self.path,lock=threading.Lock()),self.bridge,RequestAuth('s'*64))
        self.assertEqual(handler.reply.call_args.args[0],401)
        self.bridge.handle.assert_not_called()
    def test_mapping_mismatch_and_cross_group_overwrite_fail_closed(self):
        campus_erebor.handle(self.bridge,'erebor-target-leases',self.lease)
        path=self.path/'data/kubejs/config/erebor-runtime-tracker.json'
        path.write_text('{}')
        with self.assertRaises(ValueError):campus_erebor.handle(self.bridge,'erebor-target-leases',self.lease)
        path.write_bytes((self.path/'erebor-runtime-tracker.json').read_bytes())
        previous=self.path/'data/kubejs/config/erebor-runtime-leases.json'
        existing=json.loads(previous.read_text())
        existing['jobs']={'K12G':next(iter(existing['jobs'].values()))}
        previous.write_text(json.dumps(existing))
        with self.assertRaises(ValueError):campus_erebor.handle(self.bridge,'erebor-target-leases',self.lease)
        self.assertEqual(json.loads(previous.read_text()),existing)

