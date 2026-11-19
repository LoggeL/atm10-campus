"""Exercise the actual K02 Lua stock keeper with asynchronous AE2 receipts."""
import unittest
from pathlib import Path

from lupa import LuaRuntime


class PowderReserve(unittest.TestCase):
    def test_positive_stock_refill_dedup_and_missing_material(self):
        code = (Path(__file__).resolve().parents[1] / "public/cc/erebor-powder.lua").read_text(encoding="utf-8")
        lua = LuaRuntime()
        run = lua.execute("""
          GUNPOWDER="minecraft:gunpowder"; clock=0; stock=8200; orders=0
          state={}; view={}; function now() return clock end; function saveState() end
          bridge={getItems=function() return {{name=GUNPOWDER,count=stock}} end,
            getCraftingCPUs=function() return {{isBusy=external,craftingJob={resource={name=GUNPOWDER}}},{isBusy=false}} end,
            craftItem=function(f)
              orders=orders+1; qty=f.count
              return {isCraftingStarted=function() return started end, isDone=function() return done end,
              hasErrorOccurred=function() return failed end,isCalculationNotSuccessful=function()return false end,
              isCanceled=function()return false end,getDebugMessage=function()return "MISSING_ITEMS" end}
            end}
        """ + code + """
          return function() clock=clock+30;maintainPowder({low=8192,target=16384});return view.powderReserve.stage end
        """)
        g = lua.globals()
        self.assertEqual(run(), "stocked")
        g.stock, g.external = 7100, True
        self.assertEqual(run(), "crafting")
        self.assertEqual(g.orders, 0)
        g.external = False
        self.assertEqual(run(), "calculating")
        self.assertEqual(g.qty, 1024)
        g.started = True
        self.assertEqual(run(), "crafting")
        self.assertEqual(g.orders, 1)
        g.done, g.stock = True, 8300
        self.assertEqual(run(), "calculating")
        self.assertEqual(g.qty, 2048)
        g.failed = True
        self.assertEqual(run(), "retrying")
        g.failed, g.done = False, False
        self.assertEqual(run(), "calculating")
        self.assertEqual(g.qty, 1024)
        g.stock, g.done = 16384, True
        self.assertEqual(run(), "stocked")
        self.assertEqual(g.orders, 3)

if __name__ == "__main__":
    unittest.main()
