-- Embedded in campus.lua. The job handle stays local; the order checkpoint
-- survives both a change of cannon schematic and a computer restart.
local powderJob, powderNext, powderBatch = nil, 0, 1024
local function maintainPowder(policy)
  local stamp = now()
  if stamp < powderNext then return end
  powderNext = stamp + 5
  local record = state.powder or {}
  state.powder = record
  local stock = view.powderReserve and view.powderReserve.stock
  local function report(stage, message)
    view.powderReserve = {stage=stage, message=message, stock=stock, quantity=record.pending,
      lastStart=record.lastStart, lastQuantity=record.lastQuantity}
  end
  if powderJob then
    local started = powderJob.isCraftingStarted()
    if started and not record.started then
      record.started, record.lastStart, record.lastQuantity = true, math.floor(stamp), record.pending
      saveState()
    end
    if powderJob.hasErrorOccurred() or powderJob.isCalculationNotSuccessful() or powderJob.isCanceled() then
      local reason = tostring(powderJob.getDebugMessage() or "AE2 hat den Auftrag abgebrochen")
      local missing = powderJob.getMissingItems and powderJob.getMissingItems()
      if type(missing) == "table" then
        for _, item in pairs(missing) do
          if type(item) == "table" and item.name then reason=reason.." "..tostring(item.count or item.amount or "?").."x "..item.name end
        end
      end
      powderBatch = math.max(1, math.floor(record.pending / 2))
      powderNext = stamp + (record.pending > 1 and 5 or 60)
      powderJob, record.pending, record.started = nil, nil, nil
      saveState()
      report("retrying",reason)
      return
    end
    if not powderJob.isDone() then report(started and "crafting" or "calculating"); return end
    powderBatch = math.min(4096, record.pending * 2)
    powderJob, record.pending, record.started = nil, nil, nil
    saveState()
  end

  -- getItems distinguishes a real zero from a disconnected or failed read.
  local items, why = bridge.getItems()
  if type(items) ~= "table" then report("retrying", tostring(why or "ME-Bestand fehlt")); return end
  stock = 0
  for _, it in pairs(items) do
    if it.name == GUNPOWDER then stock=stock+assert(tonumber(it.count or it.amount),"ME-Menge fehlt") end
  end
  if stock >= policy.target or (not record.refilling and stock >= policy.low) then
    if record.refilling then record.refilling=false; saveState() end
    powderNext = stamp + 15
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
    if cpu.isBusy and type(output) == "table" and output.name == GUNPOWDER then
      report("crafting","Schießpulver auf ME-CPU")
      return
    end
  end
  if not free then report("waiting_cpu","Keine freie ME-Crafting-CPU"); return end
  if record.pending and stamp - record.submitted < 300 then report("reconciling"); return end
  local n = math.min(powderBatch, policy.target - stock)
  record.pending, record.submitted, record.started, record.refilling = n, stamp, false, true
  saveState()
  local job, rejection = bridge.craftItem({name=GUNPOWDER,count=n})
  if not job then
    record.pending=nil
    saveState()
    powderNext=stamp+30
    report("retrying",tostring(rejection or "AE2 hat den Auftrag abgelehnt"))
    return
  end
  powderJob=job
  report("calculating")
end
