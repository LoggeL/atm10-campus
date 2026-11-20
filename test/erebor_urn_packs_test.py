import base64
import hashlib
import json
from pathlib import Path
import runpy
import subprocess
import unittest

ROOT=Path(__file__).resolve().parents[1]
PACK=runpy.run_path(str(ROOT/'public/assets/erebor-urnen-v3.py'))
V2=runpy.run_path(str(ROOT/'public/assets/erebor-urnen-v2.py'))


class PackTest(unittest.TestCase):
    def test_exact_sparse_nbt_identity_and_range(self):
        code="import {stoneNBT} from './src/project-stone.js'; console.log(stoneNBT([4,1,1],[[0,0,0],[3,0,0]]).toString('base64'))"
        data=base64.b64decode(subprocess.check_output(['node','--input-type=module','-e',code],cwd=ROOT))
        points=[[-16,47,22],[-13,47,22]]
        token=hashlib.sha256(json.dumps(points,separators=(',',':')).encode()).hexdigest()[:24]
        desired=dict(anchor=points[0],blueprint='EREBOR_STEIN_K19_MASSIV_M_URN_PACK_'+token+'_V12',sha256=hashlib.sha256(data).hexdigest())
        self.assertEqual(PACK['targets'](data,desired,[4,1,1],[0,47,22]),points)
        for altered,size,cannon in [(dict(desired,anchor=[100,47,22]),[4,1,1],[0,47,22]),(desired,[4,1,2],[0,47,22]),(desired,[4,1,1],[-270,47,22])]:
            with self.assertRaises(ValueError):
                PACK['targets'](data,altered,size,cannon)

    def test_tracker_checks_every_target_and_exact_input_before_removing_urns(self):
        fixture="""
        const assert=require('node:assert/strict');
        class Pos {constructor(x,y,z){Object.assign(this,{x,y,z})}
         getX(){return this.x}getY(){return this.y}getZ(){return this.z}
         distSqr(p){return (p.x-this.x)**2+(p.y-this.y)**2+(p.z-this.z)**2}
         equals(p){return this.distSqr(p)===0}}
        const position=a=>new Pos(...a), Java={loadClass:()=>({AIR:{defaultBlockState:()=>0}})};
        const ChunkPos=Pos, ticket={}, Components=new Proxy({},{get:(o,k)=>k}),Registries={BLOCK:{getKey:s=>s}};
        """
        check="""
        const j={file:'file',pos:[0,60,0],size:[4,1,1],points:[[0,60,0],[3,60,0]],until:Date.now()+50000};
        packRequests.K01=j;const s={site:'K01',pos:position([10,60,0])},c={replaceMode:0,blocksPlaced:0,flyingBlocks:{isEmpty:()=>true}};
        const row={ready:true,empty:true,state:'STOPPED',upload:''};
        let blocks=['supplementaries:urn','ae2:controller'],loaded=true;
        const level={getBlockState:p=>({getBlock:()=>blocks[p.x/3]}),setBlock:p=>{blocks[p.x/3]='minecraft:air';return true}};
        const chunks={getChunkNow:()=>loaded,addRegionTicket:()=>{}};
        const vals={SCHEMATIC_BOUNDS:position(j.size),SCHEMATIC_ANCHOR:position(j.pos),SCHEMATIC_DEPLOYED:true,SCHEMATIC_ROTATION:'none',SCHEMATIC_MIRROR:'none'};
        const run=()=>{delete row.packState;return trackPack(level,chunks,s,row,{get:k=>vals[k]},c,!row.empty)};
        run();assert.equal(row.packState,'changed');assert.equal(blocks[0],'supplementaries:urn');
        blocks[1]='minecraft:stone';run();assert.equal(row.packState,'valid');
        Object.assign(row,{empty:false,state:'PAUSED',status:'ready',upload:'file'});
        assert.equal(run(),true);assert.equal(blocks[0],'supplementaries:urn');
        j.armed=true;loaded=false;run();assert.equal(blocks[0],'supplementaries:urn');
        loaded=true;row.upload='other';assert.equal(run(),false);assert.equal(blocks[0],'supplementaries:urn');
        row.upload='file';run();assert.equal(row.packState,'clear');assert.deepEqual(blocks,['minecraft:air','minecraft:stone']);
        """
        subprocess.run(['node','-'],input=fixture+PACK['TRACK']+check,text=True,check=True)
        native=(ROOT/'controller/kubejs/erebor-target-chunks.js').read_text()
        installed=V2['tracker_v2'](native)
        self.assertEqual(installed.count('    if (trackUrn(chunks,'),1)
        self.assertEqual(installed.count('    var report={}'),1)

if __name__=='__main__':
    unittest.main()
