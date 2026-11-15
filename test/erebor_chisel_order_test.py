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
          orders, log, lines = {}, {}, {}
          print = function(s) table.insert(log, s) end
          sleep = function() if occupied then stored[item] = stored[item]+1000; occupied=false end end
          fs = {exists=function() return #lines>0 end, open=function(_, mode)
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
        self.lua.execute("assert(#orders==1 and orders[1]==9000); stored[item]=0")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1)")

    def test_existing_job_supplies_part(self):
        self.lua.execute("occupied=true")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1 and orders[1]==8000)")

    def test_rejection_then_resume(self):
        self.lua.execute("reject=true")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1); reject=false")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==2 and stored[item]==2563884)")

    def test_all_four_full_orders_are_submitted_before_waiting(self):
        self.lua.execute("""
          for k in pairs(stored) do stored[k]=0 end
          sleep=function() assert(#orders==4, "waited before submitting all four") end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(table.concat(orders,',')=='2563884,419037,353739,126722')")

    def test_unidentified_busy_cpu_still_allows_known_output(self):
        self.lua.execute("bridge.getCraftingCPUs=function() return {{isBusy=true}} end")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1 and orders[1]==9000)")

    def test_bridge_task_is_counted_if_cpu_output_is_unknown(self):
        self.lua.execute("""
          occupied=true
          bridge.getCraftingCPUs=function() return {{isBusy=true}} end
          bridge.getCraftingTasks=function() return occupied and {{resource={name=item}}} or {} end
        """)
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1 and orders[1]==8000)")

    def test_interruption_does_not_duplicate_an_unconfirmed_request(self):
        self.lua.execute("crash=true")
        with self.assertRaisesRegex(Exception, "connection lost"):
            self.lua.execute(PROGRAM)
        self.lua.execute("crash=false")
        self.lua.execute(PROGRAM)
        self.lua.execute("assert(#orders==1 and string.find(log[#log], 'unterbrochenen'))")


if __name__ == "__main__":
    unittest.main()
