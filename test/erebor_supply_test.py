import json
import re
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'controller'))
from campus_erebor import confirm_supply
from campus_discovery import proof_command, FACING, side_offset, validate_candidate


class SupplyTest(unittest.TestCase):
    def setUp(self):
        self.rows = json.loads((ROOT / 'src/erebor-fleet/stations.json').read_text())['sites']

    def prove(self, row, run, digest='a'*64):
        xyz = lambda pos: dict(zip(('x','y','z'), pos))
        b = {**xyz(row['cannon']), 'owner':'Erebor','dimension':'minecraft:overworld'}
        delta = tuple(a-b for a,b in zip(row['chest'],row['computer']))
        side,face = next((s,f) for f in FACING for s in ('left','right','front','back') if side_offset(f,s)==delta)
        c = validate_candidate({'computer':{**xyz(row['computer']), 'id':2147483647, 'facing':face,'block':row['computerBlock']},
             'chest':{**xyz(row['chest']),'side':side,'block':row['inventoryBlock']},'binding':b})
        proof = proof_command(c).replace('ComputerId:2147483647}', 'ComputerId:2147483647,Label:"erebor-'+row['site']+'"}')
        desired = {'file':'campus_00000000-0000-4000-9000-000000000000.nbt','owner':'Erebor','sha256':'a'*64,
                   'blueprint':'EREBOR_STEIN_'+row['site']+'_V12','version':12,'anchor':row['cannon'],'rotation':'none','mirror':'none'}
        target = {'desired':desired,'options':{'replace_mode':0,'skip_missing':False,'replace_block_entities':False},'size':[32,32,32]}
        return confirm_supply(Mock(run=run,file_hash=lambda *_:digest),b,proof,target,row['site'],12)

    def test_all_stations_fit_and_validate_the_same_tick(self):
        for row in self.rows:
            commands = []
            def run(cmd):
                commands.append(cmd)
                marker = cmd.split()[-1]
                self.assertRegex(marker,r'^campus:[a-f0-9]{20}$')
                self.assertLessEqual(len(cmd.encode()),950)
                for k in ('ComputerId:2147483647','Label:"erebor-'+row['site']+'"',row['inventoryBlock'].removeprefix('minecraft:'),
                          'unless block','if block ~ ~ ~ create:schematicannon{','Printer:{Anchor:', '"create:schematic_bounds"',
                          'skip_missing:0b','Inventory:{Items:[{Slot:0','State:RUNNING'):
                    self.assertIn(k,cmd)
                self.assertIn(' positioned '+' '.join(map(str,row['cannon']))+' ',cmd)
                return 'Storage '+marker+' has the following contents: {}'
            self.assertEqual(self.prove(row,run)['sha256'],'a'*64)
            self.assertEqual(len(commands),1)

    def test_foreign_reply_and_wrong_hash_never_confirm(self):
        self.assertIsNone(self.prove(self.rows[0],lambda cmd:'Storage campus:other has the following contents: {}'))
        self.assertIsNone(self.prove(self.rows[0],lambda cmd:''))
        def success(cmd):return 'Storage '+cmd.split()[-1]+' has the following contents: {}'
        with self.assertRaisesRegex(ValueError,'hash'):
            self.prove(self.rows[0],success,'b'*64)


if __name__ == '__main__':
    unittest.main()
