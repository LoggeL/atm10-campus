"""Execute the actual Lua safety helper and compile the entire feeder (lupa)."""
from pathlib import Path
import unittest
from lupa import LuaRuntime

class FeederTests(unittest.TestCase):
    def test_alignment_lease_expires_and_offline_cannot_feed(self):
        code=(Path(__file__).resolve().parents[1]/'public/cc/campus.lua').read_text()
        self.assertIn('-- alignment-lease-start',code,'feeder has no alignment lease gate')
        helper=code.split('-- alignment-lease-start')[1].split('-- alignment-lease-end')[0]
        lua=LuaRuntime(unpack_returned_tuples=True)
        fn=lua.execute(helper+'\nreturn alignmentReady')
        make=lua.eval('function(enabled,state,lease) return {alignment={enabled=enabled,state=state,leaseSeconds=lease}} end')
        self.assertTrue(fn(make(False,'disabled',10),0,100))
        self.assertTrue(fn(make(True,'aligned',10),100,105))
        self.assertFalse(fn(make(True,'aligned',10),100,110))
        self.assertFalse(fn(make(True,'pending',10),100,101))
        self.assertFalse(fn(make(True,'offline',10),100,101))
        self.assertFalse(fn(make(True,'aligned',None),100,101))
        self.assertFalse(fn(make(True,'aligned',10),100,99))
        lua.execute('assert(load(...))',code)

if __name__=='__main__':unittest.main()
