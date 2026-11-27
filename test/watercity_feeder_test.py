"""Simulate the CC event loop, a shared ME and a real AE2 job handle."""
import unittest
from pathlib import Path
from lupa import LuaRuntime

class WatercityFeederTest(unittest.TestCase):
    def test_reserve_order_then_delivery_without_duplicate(self):
        lua=LuaRuntime(unpack_returned_tuples=True)
        src=(Path(__file__).resolve().parents[1]/"tools/watercity/feeder.lua").read_text()
        lua.execute("""
        store={}; stock=500; chest=0; orders={}; now=1000
        local id="minecraft:dark_oak_stairs"
        local q={computer=92,expires=9000,generation="1",targets={[id]=37},craft={[id]=37}}
        store[".wc-request"]=q
        fs={open=function(p,m)
          if m=="r" and not store[p] then return nil end
          return {readAll=function()return store[p] end,write=function(v)store[p]=v end,close=function()end}
        end, exists=function(p)return store[p]~=nil end,delete=function(p)store[p]=nil end,
             move=function(a,b)store[b]=store[a];store[a]=nil end}
        textutils={serializeJSON=function(t)return t end,unserializeJSON=function(t)return t end}
        local b={isOnline=function()return true end,getItems=function()return {{name=id,count=stock}} end,
          getCraftingCPUs=function()return {{isBusy=false}} end,
          craftItem=function(v)table.insert(orders,v.count)
            return {isDone=function()return false end,hasErrorOccurred=function()return false end,
              isCanceled=function()return false end,isCalculationNotSuccessful=function()return false end,
              isCraftingStarted=function()return true end} end}
        rs={getSides=function()return {"front","back"} end}
        peripheral={hasType=function(side,t)return (side=="front" and t=="me_bridge") or (side=="back" and t=="inventory") end,
          wrap=function()return b end,call=function()return {{name=id,count=chest}} end}
        local guard={exportSurplus=function(_,_,_,need,reserve)
          local n=math.min(need,math.max(0,stock-reserve));stock=stock-n;chest=chest+n
          return n,"ME_RESERVE",stock end}
        local i=0
        os={startTimer=function()return 1 end,epoch=function()return now end,getComputerID=function()return 92 end,
          pullEvent=function()
           i=i+1
           if i==1 then return "campus_stock_guard",guard end
           if i==4 then stock=537 end
           if i==5 then error("end test") end
           return "timer",1
          end}
        """)
        with self.assertRaisesRegex(Exception,"end test"): lua.execute(src)
        self.assertEqual(lua.eval("#orders"),1)
        self.assertEqual(lua.eval("orders[1]"),37)
        self.assertEqual(lua.eval("chest"),37)
        self.assertEqual(lua.eval("stock"),500)

if __name__=="__main__": unittest.main()
