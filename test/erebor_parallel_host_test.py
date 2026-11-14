import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from zipfile import ZipFile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'controller'))
import campus_erebor


class ParallelHost(unittest.TestCase):
    def test_shared_supply_checks_all_three_inputs_in_one_rcon_command(self):
        from campus_discovery import FACING, side_offset, validate_candidate, proof_command
        layout=json.loads((ROOT/'src/erebor-fleet/stations.json').read_bytes())
        pairs=json.loads((ROOT/'src/erebor-fleet/parallel.json').read_bytes())
        xyz=lambda p:dict(zip('xyz',p))
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)
            (path/'erebor-parallel.json').write_text(json.dumps(pairs))
            for site,row in zip(layout['sites'],pairs['sites']):
                delta=tuple(a-b for a,b in zip(row['chest'],site['computer']))
                face,side=next((f,s) for f in FACING for s in ('front','back','left','right') if side_offset(f,s)==delta)
                binding={**xyz(row['main']),'owner':'Erebor','dimension':'minecraft:overworld'}
                candidate=validate_candidate({'binding':binding,'computer':{**xyz(site['computer']),'facing':face,'id':2147483647,'block':site['computerBlock']},
                    'chest':{**xyz(row['chest']),'block':site['inventoryBlock'],'side':side}})
                proof=proof_command(candidate).replace('ComputerId:2147483647}','ComputerId:2147483647,Label:"erebor-'+site['site']+'"}')
                targets={};signals={}
                for slot in 'ABC':
                    file='campus_'+slot.lower()*36+'.nbt'
                    targets[slot]=dict(file=file,anchor=row['main'],size=[64,16,64],options=[0,False,False],sha256='1'*64)
                    signals[site['site']+('' if slot=='A' else slot)]={**targets[slot],'empty':False,'upload':file,'owner':'Erebor','aligned':True,'state':'RUNNING','placed':12}
                def run(cmd):
                    self.assertLessEqual(len(cmd.encode()),950)
                    if 'computercraft:' not in cmd:
                        return ''  # Sleeping neighbour chunk; the final guard must prove it is still asleep.
                    self.assertIn('minecraft:chest[type=single]',cmd)
                    if site['site']=='K09':
                        self.assertIn(' unless loaded ',cmd)
                    self.assertIn('Label:"erebor-'+site['site']+'"',cmd)
                    return 'Storage '+cmd.split()[-1]+' has the following contents: {}'
                bridge=Mock(run=run,file_hash=lambda *_:'1'*64)
                report=dict(at=time.time()*1000,sharedChest=4,stations=signals)
                with patch.object(campus_erebor,'__file__',str(path/'campus_erebor.py')),patch.object(campus_erebor,'handle',return_value=report):
                    result=campus_erebor.shared_supply(bridge,layout,site,{'targets':targets},proof)
                    self.assertEqual(set(result['confirmed']),set('ABC'))
                    signals[site['site']]={'empty':True}
                    result=campus_erebor.shared_supply(bridge,layout,site,{'targets':targets},proof)
                    self.assertEqual(set(result['confirmed']),set('BC'))
                    signals[site['site']+'C']['upload']='foreign'
                    with self.assertRaisesRegex(ValueError,'Bauplan'):
                        campus_erebor.shared_supply(bridge,layout,site,{'targets':targets},proof)

    def test_install_rollback_and_addressing_all_helpers(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            host=root/'discord'
            host.mkdir()
            kit=root/'kit'
            cfg=root/'data/kubejs/config'
            cfg.mkdir(parents=True)
            script=root/'data/kubejs/server_scripts/campus/erebor-target-chunks.js'
            script.parent.mkdir(parents=True)
            with ZipFile(ROOT/'public/assets/erebor-shared-v4.zip') as archive:
                archive.extractall(kit)
            with ZipFile(ROOT/'public/assets/erebor-controller-material-v2.zip') as old:
                for name in ('campus_cannon.py','campus_erebor.py'):
                    (host/name).write_bytes(old.read(name))
            for path in (cfg,host):
                (path/'erebor-stations.json').write_bytes((ROOT/'src/erebor-fleet/stations.json').read_bytes())
            script.write_bytes(b'fixture tracker')
            manifest=json.loads((kit/'manifest.json').read_bytes())
            spec=importlib.util.spec_from_file_location('parallel_installer',kit/'install.py')
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            manifest[script.name]['old']=[module.digest(script.read_bytes())]
            (kit/'manifest.json').write_text(json.dumps(manifest))
            owner=host.stat().st_uid
            with patch.object(module,'BASE',root),patch.object(module.os,'geteuid',create=True,return_value=owner or 1234),patch.object(module,'subprocess') as proc,patch.object(Path,'stat',autospec=True,side_effect=self.stat_wrapper(owner or 1234)):
                proc.check_output.return_value='loaded'
                module.deploy('check')
                self.assertFalse((host/'erebor-parallel.json').exists())
                module.deploy('install')
                module.deploy('install')
                module.deploy('check')
                self.assertEqual((cfg/'erebor-parallel.json').read_bytes(),(host/'erebor-parallel.json').read_bytes())
                bridge=Mock()
                with patch.object(campus_erebor,'__file__',str(host/'campus_erebor.py')):
                    for row in json.loads((host/'erebor-parallel.json').read_bytes())['sites']:
                        for slot in ('B','C'):
                            campus_erebor.handle(bridge,'erebor-inspect',dict(version=12,site=row['site']+slot))
                            binding=bridge.inspect.call_args.args[0]
                            self.assertEqual([binding[a] for a in 'xyz'],row[slot])
                    with self.assertRaisesRegex(ValueError,'Cleanstone'):
                        campus_erebor.handle(bridge,'erebor-start',dict(version=12,site='K37C',kind='clear',desired={},size=[1,1,1]))
                module.deploy('rollback')
                self.assertFalse((host/'erebor-parallel.json').exists())
                self.assertEqual(script.read_bytes(),b'fixture tracker')

    @staticmethod
    def stat_wrapper(owner):
        original=Path.stat
        def stat(path,*args,**kwargs):
            result=original(path,*args,**kwargs)
            return Mock(wraps=result,st_uid=owner,st_mode=result.st_mode)
        return stat


if __name__=='__main__':
    unittest.main()
