"""Native dispatch seam: no installed capability means no optional mutation."""
import time
import copy
from unittest.mock import Mock, patch
import unittest
import erebor_lease_publish_test as publishers
import campus_erebor


class OptionalDispatchTest(unittest.TestCase):
    setUp = publishers.PublishTest.setUp
    def request(self, slot='D'):
        return dict(site='K12'+slot, version=12, kind='stone', size=[2,2,2],
                    desired=dict(version=12, blueprint='EREBOR_STEIN_K12_ONE',
                                 file=self.lease['jobs']['K12'+slot]['file'],
                                 sha256='a'*64, owner='Erebor', rotation='none', mirror='none',
                                 anchor=[-320,110,-10240]), nbtBase64='test')

    def test_optional_prepare_reuses_native_guards_only_with_explicit_dispatch_gate(self):
        # Runtime lease mapping alone is not a dispatch authorization.
        self.bridge.optional_dispatch_gate = None
        with self.assertRaises(ValueError):
            campus_erebor.handle(self.bridge, 'erebor-prepare', self.request())
        self.bridge.inspect.assert_not_called()
        self.bridge.optional_dispatch_gate = lambda action, obj, binding: True
        with patch('campus_schematic.prepare_schematic', return_value={'applied':True}) as prepare:
            result = campus_erebor.handle(self.bridge, 'erebor-prepare', self.request())
            self.assertTrue(result['applied'])
            self.assertEqual(prepare.call_args.kwargs['erebor_kind'], 'stone')
            self.assertEqual(prepare.call_args.args[1]['x'], -319)

    def test_optional_start_checks_gate_again_immediately_before_native_write(self):
        request=self.request();request.pop('nbtBase64')
        calls=[]
        def gate(action, obj, binding):
            calls.append(action)
            return len(calls)==1
        self.bridge.optional_dispatch_gate=gate
        self.bridge.inspect.return_value=dict(at=time.time(), state='STOPPED', status='idle', amountPlaced=0,
            flyingBlocks=0, components={'create:schematic_bounds':[2,2,2]})
        with patch('campus_start.start') as start:
            with self.assertRaises(ValueError):campus_erebor.handle(self.bridge,'erebor-start',request)
            start.assert_not_called()
        self.assertEqual(len(calls),2)

    def test_optional_start_executes_real_native_guard_and_readback(self):
        from campus_start import expected_components
        request=self.request();request.pop('nbtBase64')
        self.bridge.optional_dispatch_gate=lambda *args: True
        components=expected_components(request['desired'])
        components['create:schematic_bounds']=[2,2,2]
        initial=dict(at=time.time(),state='STOPPED',status='idle',amountPlaced=0,amountToPlace=0,
            flyingBlocks=0,item='create:schematic',components=components,fileHash='a'*64,
            options=dict(replace_mode=2,skip_missing=False,replace_block_entities=False),
            printer=dict(DeferredBlocks=[],EntityProgress=-1,PrintStage='BLOCKS'))
        running=copy.deepcopy(initial);running.update(state='RUNNING',printer={'Anchor':request['desired']['anchor']})
        self.bridge.inspect.side_effect=[initial,running]
        self.bridge.file_hash.return_value='a'*64
        self.bridge.run.return_value='Modified block data'
        result=campus_erebor.handle(self.bridge,'erebor-start',request)
        self.assertTrue(result['started'])
        command=self.bridge.run.call_args.args[0]
        self.assertIn('if block -319 111 -10245 create:schematicannon',command)
        self.assertIn('FlyingBlocks:[]',command)
        self.assertIn('State set value "RUNNING"',command)
        self.assertEqual(self.bridge.inspect.call_count,2)

    def test_wrong_kind_previous_and_far_volume_never_reach_dispatch_gate(self):
        self.bridge.optional_dispatch_gate=Mock(return_value=True)
        for change in (dict(kind='build'),dict(previous={}),dict(size=[256,256,256])):
            obj=self.request();obj.update(change)
            with self.assertRaises(ValueError):campus_erebor.handle(self.bridge,'erebor-prepare',obj)
        self.bridge.optional_dispatch_gate.assert_not_called()
