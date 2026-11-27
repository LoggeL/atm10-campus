-- Three shared chests, one elected ME requester per material.
local guard, jobs, retry, batch = nil, {}, {}, {}
local function read(name)
  local f = fs.open(name, "r")
  if not f then return nil end
  local s = f.readAll()
  f.close()
  return textutils.unserializeJSON(s)
end
local function save(name, value)
  local f = assert(fs.open(name..".tmp", "w"))
  f.write(textutils.serializeJSON(value))
  f.close()
  if fs.exists(name) then fs.delete(name) end
  fs.move(name..".tmp", name)
end
local pending = read(".wc-orders") or {}
local function order(b, id, deficit, now, expires)
  local job = jobs[id]
  if job then
    if job.hasErrorOccurred() or job.isCanceled() or job.isCalculationNotSuccessful() then
      local why = tostring(job.getDebugMessage() or "AE2-Auftrag fehlgeschlagen")
      batch[id] = math.max(1, math.floor((pending[id].count or 1)/2))
      jobs[id], pending[id], retry[id] = nil,nil,now+15000
      save(".wc-orders",pending)
      return why
    elseif not job.isDone() then
      return job.isCraftingStarted() and "AE2 craftet" or "AE2 berechnet"
    end
    jobs[id], pending[id] = nil,nil
    save(".wc-orders",pending)
  end
  if deficit<=0 or now<(retry[id] or 0) then return end
  local cpus, why = b.getCraftingCPUs()
  if type(cpus)~="table" then return tostring(why or "Kein CPU-Bericht") end
  local free=false
  for _,cpu in pairs(cpus) do
    local output=cpu.craftingJob and cpu.craftingJob.resource
    if cpu.isBusy and output and output.name==id then return "AE2 craftet" end
    if cpu.isBusy==false then free=true end
  end
  if pending[id] and now-pending[id].at<300000 then return "Auftragsbeleg wird abgeglichen" end
  if not free then return "ME-CPUs belegt" end
  local n=math.min(batch[id] or 256,deficit)
  if os.epoch("utc")>=expires then return end
  pending[id]={at=now,count=n}
  save(".wc-orders",pending)
  local result,err=b.craftItem({name=id,count=n})
  if type(result)=="table" and result.isDone then jobs[id]=result; return "AE2 angefordert: "..n end
  pending[id]=nil
  save(".wc-orders",pending)
  retry[id]=now+30000
  return tostring(err or "Kein AE2-Auftragsbeleg")
end
local function feed(q)
  local bridge,chest
  for _,side in ipairs(rs.getSides()) do
    if peripheral.hasType(side,"me_bridge") or peripheral.hasType(side,"meBridge") then
      assert(not bridge,"Mehrere ME Bridges");bridge=side
    elseif peripheral.hasType(side,"inventory") then
      assert(not chest,"Mehrere lokale Inventare");chest=side
    end
  end
  local b=assert(bridge and peripheral.wrap(bridge),"ME Bridge fehlt")
  assert(chest and guard,"Warte auf Kiste oder Campus-Materialschutz")
  if b.isOnline then assert(b.isOnline(),"ME offline") end
  local have,missing,orders={},{},{}
  for _,v in pairs(peripheral.call(chest,"list")) do have[v.name]=(have[v.name] or 0)+v.count end
  for id,limit in pairs(q.targets) do
    local want=math.max(0,limit-(have[id] or 0))
    if want>0 and os.epoch("utc")<q.expires then
      local moved,why,stock=guard.exportSurplus(bridge,chest,id,want,500,q.expires)
      want=want-(tonumber(moved) or 0)
      if want>0 then missing[id]={need=want,stock=tonumber(stock),reason=tostring(why or "Kiste prüfen")} end
    end
  end
  local items
  for id,total in pairs(q.craft or {}) do
    if os.epoch("utc")>=q.expires then break end
    items=items or b.getItems()
    assert(type(items)=="table","Kein ME-Bestand")
    local stock=0
    for _,v in pairs(items) do if v.name==id then stock=stock+(v.count or v.amount) end end
    local deficit=math.max(0,500+total-stock)
    orders[id]=order(b,id,deficit,os.epoch("utc"),q.expires)
  end
  return {missing=missing,orders=orders}
end
local timer=os.startTimer(1)
while true do
  local event,arg=os.pullEvent()
  if event=="campus_stock_guard" then guard=arg end
  if event=="timer" and arg==timer then
    local q=read(".wc-request")
    local now=os.epoch("utc")
    if q and q.computer==os.getComputerID() and now<q.expires and q.expires<=now+11000 then
      local ok,r=pcall(feed,q)
      if not ok then r={error=tostring(r)} end
      r.at=os.epoch("utc");r.computer=q.computer;r.generation=q.generation
      save(".wc-report",r)
    end
    timer=os.startTimer(1)
  end
end
