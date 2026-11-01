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

    def reporter(self):
        code=(Path(__file__).resolve().parents[1]/'public/cc/campus.lua').read_text()
        helper=code.split('-- status-reporting-start')[1].split('-- status-reporting-end')[0]
        lua=LuaRuntime(unpack_returned_tuples=True)
        lua.execute(helper+'''
          clock = 0
          attempts = 0
          fail = false
          throw = false
          sent = {}
          report = statusReporter(function() return clock end, function(payload)
            attempts = attempts + 1
            sent[#sent+1] = statusSignature(payload)
            if throw then error("network exception") end
            if fail then return nil, "offline" end
            return {ok=true}
          end)
          signature = statusSignature
        ''')
        return lua

    def test_initial_changes_and_heartbeat_are_reported(self):
        lua=self.reporter()
        lua.execute('p={state="feeding", assignment=7, chest={used=2,slots=27}, delivered={}, shortages={}}')
        g=lua.globals()
        self.assertTrue(g.report(g.p,30)[2])
        g.clock=5
        self.assertFalse(g.report(g.p,30)[2])
        lua.execute('p.chest.used=3')
        self.assertTrue(g.report(g.p,30)[2])
        lua.execute('p.delivered["minecraft:stone"]=64')
        g.clock=10
        self.assertTrue(g.report(g.p,30)[2])
        lua.execute('p.shortages={{item="minecraft:stone",missing=32,inME=0}}; p.state="waiting"')
        g.clock=15
        self.assertTrue(g.report(g.p,30)[2])
        g.clock=44
        self.assertFalse(g.report(g.p,30)[2])
        g.clock=45
        self.assertTrue(g.report(g.p,30)[2])
        self.assertEqual(g.attempts,5)

    def test_map_insertion_order_does_not_generate_false_changes(self):
        lua=self.reporter()
        lua.execute('''
          a={state="feeding",delivered={}}; a.delivered.stone=1; a.delivered.glass=2
          b={delivered={},state="feeding"}; b.delivered.glass=2; b.delivered.stone=1
        ''')
        g=lua.globals()
        self.assertEqual(g.signature(g.a),g.signature(g.b))
        g.report(g.a,30)
        g.clock=5
        self.assertFalse(g.report(g.b,30)[2])
        self.assertEqual(g.attempts,1)

    def test_failed_changes_are_retried_with_latest_state_and_bounded_backoff(self):
        lua=self.reporter()
        lua.execute('p={state="feeding"}; fail=true')
        g=lua.globals()
        self.assertEqual(g.report(g.p,30),(None,'offline',True))
        for clock in [1,4]:
            g.clock=clock
            self.assertFalse(g.report(g.p,30)[2])
        g.clock=5
        self.assertTrue(g.report(g.p,30)[2])
        g.clock=14
        self.assertFalse(g.report(g.p,30)[2])
        g.clock=15
        self.assertTrue(g.report(g.p,30)[2])
        g.clock=35
        self.assertTrue(g.report(g.p,30)[2])
        g.clock=64
        self.assertFalse(g.report(g.p,30)[2])
        lua.execute('p.state="paused"; fail=false')
        g.clock=65
        self.assertTrue(g.report(g.p,30)[2])
        self.assertEqual(g.sent[5],g.signature(g.p))
        g.clock=70
        self.assertFalse(g.report(g.p,30)[2])
        lua.execute('p.state="feeding"')
        self.assertTrue(g.report(g.p,30)[2], 'successful delivery resets the retry delay')

    def test_network_exception_and_failed_heartbeat_keep_previous_acknowledgement(self):
        lua=self.reporter()
        lua.execute('p={state="feeding"}')
        g=lua.globals()
        g.report(g.p,30)
        g.clock=30
        g.throw=True
        result=g.report(g.p,30)
        self.assertIsNone(result[0])
        self.assertIn('network exception',result[1])
        self.assertTrue(result[2])
        g.clock=34
        self.assertFalse(g.report(g.p,30)[2])
        g.clock=35
        g.throw=False
        self.assertTrue(g.report(g.p,30)[2], 'failed heartbeat does not postpone the next heartbeat for 30 seconds')

if __name__=='__main__':unittest.main()
