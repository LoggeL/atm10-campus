import sys, unittest, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'controller'))
from campus_dispatch import DispatchArbiter

class ArbiterTest(unittest.TestCase):
    def setUp(self):
        self.now=100000
        self.jobs={ 'K12'+s:{'desired':{'file':s,'anchor':[1,2,3],'sha256':'a'*64},'size':[1,1,1]} for s in 'DEF'}
        self.a=DispatchArbiter(lambda:self.now)
        self.mapping={'site':'K12','group':'DEF','version':12,'computerId':50,'chestSide':'front'}
    def grant(self):
        return self.a.grant(dict(self.mapping,jobs=self.jobs,expiresAt=self.now+8000))
    def test_prepare_requires_complete_bounded_grant(self):
        obj={'site':'K12D','version':12,**self.jobs['K12D']}
        self.assertFalse(self.a.authorize('erebor-prepare',obj))
        self.grant()
        self.assertTrue(self.a.authorize('erebor-prepare',obj))
        self.now+=8000
        self.assertFalse(self.a.authorize('erebor-prepare',obj))
    def test_start_requires_native_delivery_and_live_exact_lease(self):
        self.grant();obj={'site':'K12D','version':12,**self.jobs['K12D']}
        self.assertFalse(self.a.authorize('erebor-start',obj))
        challenge=self.a.begin(self.mapping,0,64)
        self.a.commit(self.mapping,challenge['id'],{'before':0,'after':64,'exported':64},64)
        self.assertFalse(self.a.authorize('erebor-start',obj))
        jobs={k:{'file':v['desired']['file'],'anchor':v['desired']['anchor'],'size':v['size'],'options':[2,False,False]} for k,v in self.jobs.items()}
        self.a.renew({'jobs':jobs,'expiresAt':self.now+8000})
        self.assertTrue(self.a.authorize('erebor-start',obj))
        obj['desired']={**obj['desired'],'sha256':'b'*64}
        self.assertFalse(self.a.authorize('erebor-start',obj))
    def test_replay_wrong_binding_and_false_delta_fail(self):
        self.grant();c=self.a.begin(self.mapping,0,32)
        with self.assertRaises(ValueError):self.a.commit(dict(self.mapping,computerId=51),c['id'],{'before':0,'after':32,'exported':32},32)
        with self.assertRaises(ValueError):self.a.commit(self.mapping,c['id'],{'before':0,'after':32,'exported':32},0)
        with self.assertRaises(ValueError):self.a.commit(self.mapping,c['id'],{'before':0,'after':32,'exported':32},32)
    def test_server_aggregate_chest_cap_prevents_repeated_buffer_growth(self):
        self.grant()
        with self.assertRaises(ValueError):self.a.begin(self.mapping,160,64)

    def test_partial_and_future_grants_rejected(self):
        with self.assertRaises(ValueError): self.a.grant(dict(self.mapping,jobs={'K12D':self.jobs['K12D']},expiresAt=self.now+8000))
        with self.assertRaises(ValueError): self.a.grant(dict(self.mapping,jobs=self.jobs,expiresAt=self.now+8001))

class NativeDeliveryTest(unittest.TestCase):
    def test_bridge_routes_signed_protocol_actions_to_real_handlers(self):
        import tempfile
        import campus_erebor
        from campus_cannon import CannonBridge
        from unittest.mock import patch
        import os
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as d:
            b=CannonBridge(Path(d),lambda command:'')
            for action in ('erebor-dispatch-grant','erebor-group-delivery'):
                with patch.object(campus_erebor,'handle',return_value={'routed':True}) as handle:
                    self.assertEqual(b.handle(action,{}),{'routed':True})
                    handle.assert_called_once_with(b,action,{})

    def test_signed_dispatch_installs_real_gate_not_boolean_adapter(self):
        import campus_erebor
        from unittest.mock import patch
        self.assertTrue(callable(getattr(campus_erebor,'dispatch_grant',None)))
        class Bridge: pass
        b=Bridge();b.dispatch_arbiter=DispatchArbiter();now=int(time.time()*1000)
        jobs={'K12'+s:{'desired':{'file':s,'anchor':[1,2,3]},'size':[1,1,1]} for s in 'DEF'}
        obj=dict(site='K12',group='DEF',version=12,computerId=50,chestSide='front',jobs=jobs,expiresAt=now+8000)
        mapping={'sites':[{'site':'K12','groups':[{'computerId':50,'slots':dict.fromkeys('DEF')}]}]}
        with patch.object(campus_erebor,'runtime_mapping',return_value=mapping),patch.object(campus_erebor,'observer_binding',return_value={}),patch.object(campus_erebor,'validate_optional_request'):
            self.assertTrue(campus_erebor.dispatch_grant(b,{'version':12},obj)['authorized'])
            self.assertTrue(b.optional_dispatch_gate('erebor-prepare',dict(site='K12D',version=12,**jobs['K12D']),{}))
            self.assertFalse(b.optional_dispatch_gate('erebor-start',dict(site='K12D',version=12,**jobs['K12D']),{}))
        self.assertFalse(b.optional_dispatch_gate('erebor-prepare',dict(site='K12D',version=12,**jobs['K12D']),{}))
    def test_delivery_handler_joins_native_delta_to_full_group_identity(self):
        import campus_erebor
        from unittest.mock import patch
        class Bridge:
            count=0
            dispatch_arbiter=DispatchArbiter()
            def inspect(self,b):return dict(state='STOPPED',amountPlaced=0,flyingBlocks=0)
            def run(self,command):
                self.command=command
                items='' if self.count==0 else '{Slot:0b,id:"minecraft:stone",count:'+str(self.count)+'}'
                return '1, 2, 3 has the following block data: {id:"minecraft:chest",Items:['+items+']}'
        b=Bridge();b.dispatch_arbiter=DispatchArbiter();now=int(time.time()*1000)
        jobs={'K12'+s:dict(desired=dict(file=s,anchor=[1,2,3]),size=[1,1,1]) for s in 'DEF'}
        identity=dict(site='K12',group='DEF',version=12,computerId=50,chestSide='front')
        b.dispatch_arbiter.grant(dict(identity,jobs=jobs,expiresAt=now+8000))
        mapping={'sites':[{'site':'K12','groups':[{'slots':dict.fromkeys('DEF'),'chest':[1,2,3]}]}]}
        with patch.object(campus_erebor,'runtime_mapping',return_value=mapping),patch.object(campus_erebor,'observer_binding',return_value={}),patch.object(campus_erebor,'group_physical_proof') as proof:
            challenge=campus_erebor.group_delivery(b,{'version':12},dict(identity,phase='begin',cap=32))
            b.count=32
            result=campus_erebor.group_delivery(b,{'version':12},dict(identity,phase='commit',challenge=challenge['id'],receipt=dict(before=0,after=32,exported=32)))
            self.assertTrue(result['verified']);self.assertEqual(proof.call_count,2)
            self.assertEqual(set(proof.call_args.args[2]['jobs']),set(jobs))
            with self.assertRaises(ValueError):campus_erebor.group_delivery(b,{'version':12},dict(identity,phase='commit',challenge=challenge['id'],receipt=dict(before=0,after=32,exported=32)))

    def test_native_inventory_rejects_unknown_and_counts_exact_stone(self):
        import campus_dispatch
        self.assertTrue(callable(getattr(campus_dispatch,'chest_count',None)))
        class Bridge:
            def run(self,command):
                self.command=command
                return '1, 2, 3 has the following block data: {id:"minecraft:chest",Items:[{Slot:0b,id:"minecraft:stone",count:12},{Slot:1b,id:"minecraft:dirt",count:9}]}'
        b=Bridge()
        self.assertEqual(campus_dispatch.chest_count(b,[1,2,3]),12)
        self.assertIn('data get block 1 2 3',b.command)
        b.run=lambda c:'ambiguous concurrent reply'
        with self.assertRaises(ValueError):campus_dispatch.chest_count(b,[1,2,3])

if __name__=='__main__':unittest.main()
