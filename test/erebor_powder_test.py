"""Exercise the actual K02 Lua stock keeper with asynchronous AE2 receipts."""
import unittest
from pathlib import Path

from lupa import LuaRuntime


class PowderReserve(unittest.TestCase):
    def test_moss_and_podzol_orders_are_independent_and_demand_limited(self):
        code = (Path(__file__).resolve().parents[1] / "public/cc/erebor-powder.lua").read_text(encoding="utf-8")
        lua = LuaRuntime()
        g = lua.globals()
        lua.execute("""
          GUNPOWDER="minecraft:gunpowder"; state={}; view={}; orders={}
          function now() return 1000 end; function saveState() end
          bridge={getItems=function() return {{name="minecraft:moss_block",count=5}} end,
            getCraftingCPUs=function() return {{isBusy=false}} end,
            craftItem=function(f) orders[f.name]=f.count; return {} end}
        """ + code + """
          surfaceReserves.mossReserve({low=30,target=30})
          surfaceReserves.podzolReserve({low=1024,target=2048})
        """)
        self.assertEqual(g.orders["minecraft:moss_block"], 25)
        self.assertEqual(g.orders["minecraft:podzol"], 512)
        self.assertEqual((g.state.moss.pending, g.state.podzol.pending), (25, 512))
        self.assertIsNone(g.state.grass)

    def test_grass_uses_its_own_stock_and_only_orders_confirmed_demand(self):
        code = (Path(__file__).resolve().parents[1] / "public/cc/erebor-powder.lua").read_text(encoding="utf-8")
        lua = LuaRuntime()
        run = lua.execute("""
          GUNPOWDER="minecraft:gunpowder"; clock=0; orders=0; otherJob=true
          state={}; view={}; function now() return clock end; function saveState() end
          bridge={getItems=function() return {{name=GUNPOWDER,count=8192},{name="minecraft:grass_block",count=20}} end,
            getCraftingCPUs=function() return {{isBusy=otherJob,craftingJob={resource={name="minecraft:grass_block"}}},{isBusy=false}} end,
            craftItem=function(f)
              orders=orders+1; ordered=f
              return {isCraftingStarted=function() return true end, isDone=function() return false end,
                hasErrorOccurred=function()return false end,isCalculationNotSuccessful=function()return false end,
                isCanceled=function()return false end}
            end}
        """ + code + """
          return function() clock=clock+10; maintainGrass({low=480,target=480}); return view.grassReserve.stage end
        """)
        g = lua.globals()
        self.assertEqual(run(), "crafting")
        self.assertEqual(g.orders, 0)
        g.otherJob = False
        self.assertEqual(run(), "calculating")
        self.assertEqual((g.ordered.name, g.ordered["count"]), ("minecraft:grass_block", 460))
        self.assertEqual(run(), "crafting")
        self.assertEqual(g.view.grassReserve.lastQuantity, 460)
        self.assertEqual(g.orders, 1)

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
