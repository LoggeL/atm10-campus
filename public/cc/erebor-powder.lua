-- Embedded in campus.lua. The job handle stays local; the order checkpoint
-- survives both a change of cannon schematic and a computer restart.
local function reserveKeeper(key, field, item, initialBatch, maxBatch)
local job, nextCheck, batch = nil, 0, initialBatch
return function(policy)
  local stamp = now()
  if stamp < nextCheck then return end
  nextCheck = stamp + 5
  local record = state[key] or {}
  state[key] = record
  local stock = view[field] and view[field].stock
  local function report(stage, message)
    view[field] = {stage=stage, message=message, stock=stock, quantity=record.pending,
      lastStart=record.lastStart, lastQuantity=record.lastQuantity}
  end
  if job then
    local started = job.isCraftingStarted()
    if started and not record.started then
      record.started, record.lastStart, record.lastQuantity = true, math.floor(stamp), record.pending
      saveState()
    end
    if job.hasErrorOccurred() or job.isCalculationNotSuccessful() or job.isCanceled() then
      local reason = tostring(job.getDebugMessage() or "AE2 hat den Auftrag abgebrochen")
      local missing = job.getMissingItems and job.getMissingItems()
      if type(missing) == "table" then
        for _, item in pairs(missing) do
          if type(item) == "table" and item.name then reason=reason.." "..tostring(item.count or item.amount or "?").."x "..item.name end
        end
      end
      batch = math.max(1, math.floor(record.pending / 2))
      nextCheck = stamp + (record.pending > 1 and 5 or 60)
      job, record.pending, record.started = nil, nil, nil
      saveState()
      report("retrying",reason)
      return
    end
    if not job.isDone() then report(started and "crafting" or "calculating"); return end
    batch = math.min(maxBatch, record.pending * 2)
    job, record.pending, record.started = nil, nil, nil
    saveState()
  end

  -- getItems distinguishes a real zero from a disconnected or failed read.
  local items, why = bridge.getItems()
  if type(items) ~= "table" then report("retrying", tostring(why or "ME-Bestand fehlt")); return end
  stock = 0
  for _, it in pairs(items) do
    if it.name == item then stock=stock+assert(tonumber(it.count or it.amount),"ME-Menge fehlt") end
  end
  if stock >= policy.target or (not record.refilling and stock >= policy.low) then
    if record.refilling then record.refilling=false; saveState() end
    nextCheck = stamp + 15
    report("stocked")
    return
  end
  -- AP 0.8 returns an unreliable isCrafting value on this pack. Inspect actual
  -- AE2 CPUs before submitting, including tasks requested at other terminals.
  local cpus, err = bridge.getCraftingCPUs()
  if type(cpus) ~= "table" then report("retrying",tostring(err or "ME-CPUs fehlen")); return end
  local free = false
  for _, cpu in pairs(cpus) do
    if cpu.isBusy == false then free = true end
    local output = cpu.craftingJob and cpu.craftingJob.resource
    if cpu.isBusy and type(output) == "table" and output.name == item then
      report("crafting",item .. " auf ME-CPU")
      return
    end
  end
  if not free then report("waiting_cpu","Keine freie ME-Crafting-CPU"); return end
  if record.pending and stamp - record.submitted < 300 then report("reconciling"); return end
  local n = math.min(batch, policy.target - stock)
  record.pending, record.submitted, record.started, record.refilling = n, stamp, false, true
  saveState()
  local receipt, rejection = bridge.craftItem({name=item,count=n})
  if not receipt then
    record.pending=nil
    saveState()
    nextCheck=stamp+30
    report("retrying",tostring(rejection or "AE2 hat den Auftrag abgelehnt"))
    return
  end
  job=receipt
  report("calculating")
end
end
local maintainPowder = reserveKeeper("powder", "powderReserve", GUNPOWDER, 1024, 4096)
local maintainBricks = reserveKeeper("bricks", "brickReserve", "minecraft:stone_bricks", 8192, 32768)
local maintainGrass = reserveKeeper("grass", "grassReserve", "minecraft:grass_block", 2048, 8192)
