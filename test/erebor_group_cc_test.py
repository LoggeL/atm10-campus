import unittest
from pathlib import Path
from lupa import LuaRuntime

class GroupCC(unittest.TestCase):
    def run_case(self, fail_commit=False):
        lua=LuaRuntime(unpack_returned_tuples=True)
        lua.execute('''
        count=0; exports=0; marked=false; posts=0
        fs={exists=function() return marked end,open=function() return {write=function() marked=true end,close=function() end} end}
        os={getComputerID=function() return 50 end,epoch=function() return 1000 end}
        textutils={serializeJSON=function(v) return v end,unserializeJSON=function(v) return v end}
        peripheral={wrap=function(side)
          if side=='front' then return {list=function() if count==0 then return {} else return {{name='minecraft:stone',count=count}} end end} end
          if side=='back' then return {isOnline=function() return true end,exportItem=function(item,side) assert(marked);assert(side=='front');exports=exports+1;count=count+item.count;return item.count end} end
        end}
        http={post=function(url,body,headers)
          assert(headers.Authorization=='Bearer test-only');posts=posts+1
          local response
          if string.find(url,'/plan',1,true) then response={state='feeding',options={paused=false},items={{item='minecraft:stone',needed=64}}}
          elseif string.find(url,'/begin',1,true) then response={id=string.rep('a',48),before=0,cap=64,expiresAt=8000}
          else assert(body.receipt.before==0 and body.receipt.after==64 and body.receipt.exported==64);response={verified=true} end
          return {getResponseCode=function() return 200 end,readAll=function() return response end,close=function() end}
        end}
        ''')
        if fail_commit:
            lua.execute("local old=http.post;http.post=function(url,body,headers) if string.find(url,'/commit',1,true) then return nil end return old(url,body,headers) end")
        path=Path(__file__).resolve().parents[1]/'controller/computercraft/erebor-group-delivery.lua'
        module=lua.execute(path.read_text())
        cfg=lua.table_from(dict(url='https://campus.example',token='test-only',site='K12',group='DEF',computerId=50,chestSide='front',bridgeSide='back',marker='test-marker'))
        result=module(cfg)
        self.assertEqual(lua.globals().exports,1)
        second=module(cfg)
        self.assertFalse(second[0] if isinstance(second,tuple) else second)
        self.assertEqual(lua.globals().exports,1)
        return result
    def test_marked_once_delivery_and_readback(self):
        self.assertTrue(self.run_case())
    def test_failed_receipt_never_reexports(self):
        result=self.run_case(True)
        self.assertFalse(result[0] if isinstance(result,tuple) else result)

if __name__=='__main__': unittest.main()
