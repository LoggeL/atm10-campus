import unittest
from pathlib import Path

from lupa import LuaRuntime


PROGRAM = (Path(__file__).resolve().parents[1] / "public/assets/erebor-chisel-order.lua").read_text()


class EreborOrderTest(unittest.TestCase):
    def setUp(self):
        self.lua = LuaRuntime()
        self.lua.execute("""
          item = "rechiseled:blackstone_tiles_connecting"
          stored = {
            [item] = 2563884 - 9000,
            ["rechiseledcreate:veridium_cut_polished_connecting"] = 419037,
            ["rechiseled:gold_block_polished_connecting"] = 353739,
            ["rechiseled:dark_prismarine_large_tiles_connecting"] = 126722
          }
          orders, log, lines, ticks = {}, {}, {}, 0
          print = function(s) table.insert(log, s) end
          os.epoch=function() return ticks*1000 end
          sleep = function(seconds)
            ticks=ticks+seconds; assert(ticks<10000,"worker failed to finish")
            if occupied then stored[item] = stored[item]+1000; occupied=false end
          end
          fs = {exists=function(p) return p=="/.erebor-chisel-v12-r5" and #lines>0 end,
            getSize=function() return 0 end, open=function(_, mode)
            local i = 0
            return {close=function() end, writeLine=function(x) table.insert(lines,x) end,
              readLine=function() i=i+1; return lines[i] end}
          end}
          textutils = {serialize=function(x) return x end, unserialize=function(x) return x end}
          bridge = {
            getItems=function() local rows={}; for k,v in pairs(stored) do
              table.insert(rows,{name=k,count=v}) end; return rows end,
            getCraftableItems=function() local rows={}; for k in pairs(stored) do
              table.insert(rows,{name=k}) end; return rows end,
            getCraftingTasks=function() return {} end,
            isCrafting=function() return nil end,
            getCraftingCPUs=function()
              return {{isBusy=occupied==true,craftingJob=occupied and {resource={name=item}} or nil}}
            end,
            craftItem=function(f)
              table.insert(orders, f.count)
              if crash then error("connection lost") end
              if not reject then stored[f.name] = stored[f.name] + f.count end
              return {hasErrorOccurred=function() return reject end,
                isDone=function() return true end, isCanceled=function() return false end,
                isCalculationNotSuccessful=function() return false end,
                isCraftingStarted=function() return not reject end,
                getDebugMessage=function() return "missing ingredients" end}
            end
          }
          peripheral = {find=function() return bridge end}
        """)

    def test_quantities_and_no_repeat_after_consumption(self):
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(stored[item]==2563884 and #orders>1); calls=#orders; stored[item]=0")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==calls)")

    def test_existing_job_supplies_part(self):
        self.lua.execute("occupied=true")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(stored[item]==2563884 and orders[1]==1024)")

    def test_rejection_then_resume(self):
        self.lua.execute("reject=true")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1); reject=false")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders>2 and stored[item]==2563884)")

    def test_all_four_variants_start_before_waiting(self):
        self.lua.execute("""
          for k in pairs(stored) do stored[k]=0 end
          local advance=sleep; sleep=function(n) assert(#orders>=4, "waited before submitting all four"); advance(n) end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(orders[1]==1024 and orders[4]==1024 and stored[item]==2563884)")

    def test_unidentified_busy_cpu_still_allows_known_output(self):
        self.lua.execute("bridge.getCraftingCPUs=function() return {{isBusy=true}} end")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(stored[item]==2563884)")

    def test_bridge_task_is_counted_if_cpu_output_is_unknown(self):
        self.lua.execute("""
          occupied=true
          bridge.getCraftingCPUs=function() return {{isBusy=true}} end
          bridge.getCraftingTasks=function() return occupied and {{resource={name=item}}} or {} end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(stored[item]==2563884)")

    def test_advanced_ae_task_list_failure_after_first_submission(self):
        self.lua.execute("""
          taskErrors=0
          for k in pairs(stored) do stored[k]=stored[k]-4 end
          bridge.getCraftingCPUs=function() return {{isBusy=true}} end
          bridge.getCraftingTasks=function()
            if #orders>0 then taskErrors=taskErrors+1
              error("Java Exception Thrown: java.lang.ClassCastException: class net.pedroksl.advanced_ae.common.cluster.AdvCraftingCPU cannot be cast to class appeng.me.cluster.implementations.CraftingCPUCluster")
            end
            return {}
          end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(taskErrors==1 and stored[item]==2563884 and stored['rechiseled:gold_block_polished_connecting']==353739)")

    def test_uses_available_materials_then_automatically_resumes(self):
        self.lua.execute("""
          supply=11; credited=0; rejectedOneAt=nil; replenished=false
          stored[item]=2563884-37
          bridge.craftItem=function(f)
            local ok=f.count<=supply
            if ok then supply=supply-f.count; credited=credited+f.count; stored[item]=stored[item]+f.count end
            if not ok and f.count==1 then rejectedOneAt=ticks end
            return {hasErrorOccurred=function() return not ok end, getDebugMessage=function()return "MISSING_ITEMS"end,
              isCalculationNotSuccessful=function() return not ok end, isCanceled=function()return false end,
              isCraftingStarted=function()return ok end, isDone=function()return ok end}
          end
          local advance=sleep; sleep=function(n)
            advance(n)
            if rejectedOneAt and not replenished then
              assert(credited==11,"did not use all available inputs")
              if ticks>=rejectedOneAt+45 then supply=26;replenished=true end
            end
          end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(replenished and credited==37 and supply==0)")

    def test_interruption_does_not_duplicate_an_unconfirmed_request(self):
        self.lua.execute("crash=true")
        with self.assertRaisesRegex(Exception, "connection lost"):
            self.lua.execute(PROGRAM)
        self.lua.execute("""
          crash=false
          local advance=sleep; sleep=function(n)
            if ticks<60 then assert(#orders==1, "duplicated a pending job") end
            advance(n)
            if ticks==55 then stored[item]=stored[item]+orders[1] end
          end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("local n=0;for _,v in ipairs(orders) do n=n+v end;assert(n==9000 and stored[item]==2563884)")


if __name__ == "__main__":
    unittest.main()
