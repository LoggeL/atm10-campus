-- Campus Wasserstadt P02, dedicated feeder. The host renews one short local request.
local request = ".p02-request.json"
local report = ".p02-result.json"
local guard
local function read(path)
  local f = fs.open(path, "r")
  if not f then return nil end
  local s = f.readAll()
  f.close()
  return textutils.unserializeJSON(s)
end
local function write(t)
  local f = assert(fs.open(report .. ".tmp", "w"))
  f.write(textutils.serializeJSON(t))
  f.close()
  if fs.exists(report) then fs.delete(report) end
  fs.move(report .. ".tmp", report)
end
local function feed(q)
  local chest, bridge
  for _,side in ipairs(rs.getSides()) do
    if peripheral.hasType(side, "me_bridge") or peripheral.hasType(side, "meBridge") then
      assert(not bridge, "Mehrere ME Bridges")
      bridge = side
    elseif peripheral.hasType(side, "inventory") then
      assert(not chest, "Mehrere lokale Inventare")
      chest = side
    end
  end
  assert(chest and bridge, "Gemeinsame Kiste oder ME Bridge am Computer fehlt")
  local b = peripheral.wrap(bridge)
  if b.isOnline then assert(b.isOnline(), "ME Bridge offline. Kopplung, Kanal und Strom pruefen") end
  assert(guard, "Warte auf den Campus-Materialschutz")
  local have = {}
  for _,it in pairs(peripheral.call(chest, "list")) do
    have[it.name] = (have[it.name] or 0) + it.count
  end
  local missing = {}
  for id,limit in pairs(q.targets) do
    local wanted = limit - (have[id] or 0)
    if wanted > 0 then
      local moved,why = guard.exportSurplus(bridge, chest, id, math.min(4096,wanted), 500, q.expires)
      if (tonumber(moved) or 0) < wanted then
        missing[id] = tostring(wanted-(tonumber(moved) or 0)) .. " " .. tostring(why or "")
      end
    end
  end
  -- Confirm inventory, including the very first export; do not trust the transfer return alone.
  local after = {}
  for _,it in pairs(peripheral.call(chest, "list")) do after[it.name]=(after[it.name] or 0)+it.count end
  for id,limit in pairs(q.targets) do
    if (after[id] or 0) < limit and not missing[id] then missing[id]=tostring(limit-(after[id] or 0)) end
  end
  return {ready=next(missing)==nil, missing=missing}
end
local function cycle()
  local q = read(request)
  local now = os.epoch("utc")
  if not q or q.computer~=os.getComputerID() or now>=q.expires or q.expires>now+11000 then return end
  local ok,r = pcall(feed,q)
  if not ok then r={ready=false,error=tostring(r)} end
  r.run=q.run
  r.computer=os.getComputerID()
  r.at=os.epoch("utc")
  write(r)
end
local timer=os.startTimer(1)
while true do
  local ev,arg=os.pullEvent()
  if ev=="campus_stock_guard" then guard=arg end
  if ev=="timer" and arg==timer then
    cycle()
    timer=os.startTimer(1)
  end
end
