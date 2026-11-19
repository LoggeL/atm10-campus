import argparse
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile


class FinishingInstaller(unittest.TestCase):
    def test_upper_and_lower_bridges_preserve_prior_groups_and_guard_addresses(self):
        root=Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp).resolve()
            kit=base/'kit'
            with ZipFile(root/'public/assets/erebor-schlussausbau.zip') as z:z.extractall(kit)
            sys.path.insert(0,str(kit))
            try:
                import importlib.util
                spec=importlib.util.spec_from_file_location('finish_install_check',kit/'install.py')
                tool=importlib.util.module_from_spec(spec)
                with patch.dict(sys.modules,{'fcntl':types.ModuleType('fcntl')}):spec.loader.exec_module(tool)
                host=base/'discord';host.mkdir()
                kube=base/'data/kubejs';(kube/'server_scripts/campus').mkdir(parents=True);(kube/'config').mkdir()
                layout=json.loads((root/'src/erebor-fleet/stations.json').read_bytes())
                pairs=json.loads((root/'src/erebor-fleet/parallel.json').read_bytes())
                (host/'erebor-stations.json').write_text(json.dumps(layout))
                (host/'erebor-parallel.json').write_text(json.dumps(pairs))
                ctrl=host/'campus_erebor.py'
                ctrl.write_text(tool.provision.HOOK+'\ndef handle(bridge,action,obj): return "previous"\n')
                tracker=kube/'server_scripts/campus/erebor-target-chunks.js'
                tracker.write_bytes((root/'controller/kubejs/erebor-target-chunks.js').read_bytes())
                keys=[]
                for selection in ['K19,K25','K12,K24,K27,K29,K03,K14']:
                    args=argparse.Namespace(sites=selection)
                    groups,changes=tool.prepare(args,base,layout,pairs)
                    for path,old,new,mode in changes:path.write_bytes(new)
                    self.assertFalse(tool.prepare(args,base,layout,pairs)[1])
                    keys.extend(groups)
                self.assertEqual(len(keys),12)
                self.assertEqual(sum(len(g['slots']) for g in keys),36)
                self.assertEqual(next(g for g in keys if g['site']=='K25-E')['slots']['F'],[38,144,-9766])
                self.assertEqual(len(json.loads((host/tool.CONFIG).read_bytes())['sites']),8)
                self.assertEqual(tracker.read_text(encoding='utf8').count(tool.TRACKER),1)
                self.assertEqual(ctrl.read_text(encoding='utf8').count(tool.TAG),1)
                sys.path.insert(0,str(root/'controller'))
                sys.path.insert(0,str(host))
                namespace={'__file__':str(ctrl)}
                exec(compile(ctrl.read_bytes(),str(ctrl),'exec'),namespace)
                fake=types.SimpleNamespace(base=base,inspect=lambda binding:binding)
                for g in keys:
                    for slot,pos in g['slots'].items():
                        res=namespace['handle'](fake,'erebor-inspect',{'version':12,'site':g['parent']+slot})['observed']
                        self.assertEqual([res[k] for k in ('x','y','z')],pos)
                self.assertEqual(namespace['handle'](fake,'erebor-inspect',{'site':'K12D'}),'previous')
            finally:
                for folder in (str(base/'discord'),str(root/'controller')):
                    if folder in sys.path:sys.path.remove(folder)
                sys.path.remove(str(kit))
                for name in ('provision','campus_erebor_finishing'):sys.modules.pop(name,None)


if __name__=='__main__':unittest.main()
