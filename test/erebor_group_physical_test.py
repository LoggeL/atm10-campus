import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'controller'))
import campus_erebor

class PhysicalProof(unittest.TestCase):
    def test_physical_proof_never_substitutes_for_authenticated_delivery(self):
        self.assertTrue(callable(getattr(campus_erebor,'group_physical_proof',None)), 'production physical proof missing')
        jobs={f'K12{s}':dict(file='campus_00000000-0000-0000-0000-'+str(i).zfill(12)+'.nbt',anchor=[1,2,3],size=[1,1,1],options=[2,False,False]) for i,s in enumerate('DEF')}
        group=dict(computerId=50,computer=[0,0,0],chest=[0,0,-1],slots=dict(D=[1,0,-1],E=[-1,0,-1],F=[0,1,-1]))
        mapping=dict(sites=[dict(site='K12',bridge=[0,0,1],groups=[group])])
        class Bridge:
            def inspect(self,b):
                slot=next(s for s,p in group['slots'].items() if p==[b[k] for k in 'xyz'])
                return dict(at=time.time(),components={'create:schematic_file':jobs['K12'+slot]['file'],'create:schematic_owner':'Erebor','create:schematic_anchor':[1,2,3],'create:schematic_bounds':[1,1,1]},options=dict(replace_mode=2,skip_missing=False,replace_block_entities=False))
        bindings=lambda l,k,**kw:dict(zip('xyz',group['slots'][k[-1]]),dimension='minecraft:overworld',owner='Erebor')
        obj=dict(site='K12',version=1,group='DEF',computerId=50,chestSide='front',jobs=jobs)
        with patch.object(campus_erebor,'observer_binding',side_effect=bindings),patch.object(campus_erebor,'runtime_mapping',return_value=mapping,create=True),patch('campus_discovery.condition',return_value=True) as condition:
            result=campus_erebor.group_physical_proof(Bridge(),{'version':1},obj)
            self.assertTrue(result['physicalVerified'])
            self.assertFalse(result['verified'])
            commands=[c.args[1] for c in condition.call_args_list]
            self.assertTrue(any('ComputerId:50' in c for c in commands))
            self.assertTrue(any('unless block' in c for c in commands))
            condition.return_value=False
            with self.assertRaises(ValueError):campus_erebor.group_physical_proof(Bridge(),{'version':1},obj)

if __name__=='__main__':unittest.main()
