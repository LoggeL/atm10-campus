-- Explicit one-shot K12 DEF delivery module. NOT startup, NOT autonomous feeder.
-- Credentials are supplied from private settings by a reviewed installer.
-- A durable marker is written BEFORE export; no retry even on lost HTTP receipt.
return function(cfg)
  local function run()
    assert(type(cfg)=='table' and cfg.site=='K12' and cfg.group=='DEF')
    assert(cfg.computerId==50 and os.getComputerID()==cfg.computerId)
    assert(cfg.chestSide=='front' and cfg.bridgeSide=='back')
    assert(type(cfg.url)=='string' and cfg.url:match('^https://[%w%.%-]+$'))
    assert(type(cfg.token)=='string' and #cfg.token>0)
    assert(type(cfg.marker)=='string' and #cfg.marker>0 and not fs.exists(cfg.marker))
    local chest=assert(peripheral.wrap(cfg.chestSide))
    local bridge=assert(peripheral.wrap(cfg.bridgeSide))
    assert(bridge.isOnline()==true)
    local function count()
      local n=0
      for _,item in pairs(chest.list()) do
        if item.name=='minecraft:stone' then
          assert(not item.nbt and type(item.count)=='number' and item.count%1==0 and item.count>0)
          n=n+item.count
        end
      end
      return n
    end
    local function post(path,body)
      body.computerId=cfg.computerId;body.chestSide=cfg.chestSide
      local h=assert(http.post(cfg.url..'/api/erebor/groups/K12/DEF/'..path,
        textutils.serializeJSON(body),{Authorization='Bearer '..cfg.token,['Content-Type']='application/json'}))
      local status=h.getResponseCode();local raw=h.readAll();h.close()
      assert(status==200)
      local obj=textutils.unserializeJSON(raw);assert(type(obj)=='table');return obj
    end
    local plan=post('plan',{})
    assert(plan.state=='feeding' and plan.options.paused==false)
    local needed=0
    for _,i in ipairs(plan.items or {}) do if i.item=='minecraft:stone' then needed=i.needed end end
    assert(type(needed)=='number' and needed%1==0 and needed>0)
    local cap=math.min(needed,192)
    local c=post('delivery/begin',{cap=cap})
    assert(type(c.id)=='string' and #c.id==48 and c.cap==cap)
    assert(type(c.expiresAt)=='number' and os.epoch('utc')<c.expiresAt)
    local before=count();assert(before==c.before)
    local marker=assert(fs.open(cfg.marker,'w'))
    marker.write(textutils.serializeJSON({challenge=c.id,expiresAt=c.expiresAt}));marker.close()
    -- Use the COMPUTER-LOCAL inventory name, not a bridge-relative @direction.
    local exported=bridge.exportItem({name='minecraft:stone',count=cap},cfg.chestSide)
    assert(type(exported)=='number' and exported%1==0 and exported>0 and exported<=cap)
    local after=count();assert(after-before==exported)
    assert(os.epoch('utc')<c.expiresAt)
    local receipt=post('delivery/commit',{challenge=c.id,receipt={before=before,after=after,exported=exported}})
    assert(receipt.verified==true)
    return true
  end
  local ok,result=pcall(run)
  if not ok then return false,'delivery halted; inspect private diagnostics; do not replay' end
  return result
end
