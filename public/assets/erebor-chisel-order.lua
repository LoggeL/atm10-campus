-- One production run for Erebor architecture v12, revision 5.
-- Run on ONE loaded CC computer attached to an Advanced Peripherals ME Bridge.
local remote = ...
if type(remote) ~= "table" then remote = nil end
local progress = remote and remote.progress or function() end
local print = remote and remote.log or print
local targets = {
  {"rechiseled:blackstone_tiles_connecting", 2563884},
  {"rechiseledcreate:veridium_cut_polished_connecting", 419037},
  {"rechiseled:gold_block_polished_connecting", 353739},
  {"rechiseled:dark_prismarine_large_tiles_connecting", 126722},
}
local baseItems = {
  ["rechiseled:blackstone_tiles_connecting"]="minecraft:blackstone",
  ["rechiseledcreate:veridium_cut_polished_connecting"]="create:veridium",
  ["rechiseled:gold_block_polished_connecting"]="minecraft:gold_block",
  ["rechiseled:dark_prismarine_large_tiles_connecting"]="minecraft:dark_prismarine",
}
local bridge = assert(remote and remote.bridge or peripheral.find("me_bridge"), "Keine ME Bridge am Computer gefunden.")
local journal = "/.erebor-chisel-v12-r5"
local title = "Erebor-ME"
if multishell then
  for i = 1, multishell.getCount() do
    if i ~= multishell.getCurrent() and multishell.getTitle(i) == title then
      error("Der Erebor-Auftrag laeuft bereits in einem anderen Tab.")
    end
  end
  multishell.setTitle(multishell.getCurrent(), title)
end
local records = {}
local backup = journal .. ".bak"
if fs.exists(backup) then
  if fs.exists(journal) then fs.delete(backup) else fs.move(backup, journal) end
end
if fs.exists(journal) then
  local file = assert(fs.open(journal, "r"))
  while true do
    local line = file.readLine()
    if not line then break end
    local r = assert(textutils.unserialize(line), "Auftragsjournal unlesbar. Bitte im ME pruefen.")
    records[r.item] = r
  end
  file.close()
end

local function save(r)
  local file = assert(fs.open(journal, "a"))
  file.writeLine(textutils.serialize(r, {compact = true}))
  file.close()
  records[r.item] = r
  -- Keep a long-running supply order within the computer's disk quota.
  if fs.getSize(journal) >= 32768 then
    local tmp = journal .. ".tmp"
    local compact = assert(fs.open(tmp, "w"))
    for _, entry in pairs(records) do compact.writeLine(textutils.serialize(entry, {compact=true})) end
    compact.close()
    fs.move(journal, backup)
    fs.move(tmp, journal)
    fs.delete(backup)
  end
end

local function inventory()
  local items, why = bridge.getItems()
  assert(type(items) == "table", why or "ME-Bestand nicht lesbar.")
  local totals = {}
  for _, entry in pairs(items) do
    totals[entry.name] = (totals[entry.name] or 0) + assert(tonumber(entry.count or entry.amount), "ME-Menge fehlt.")
  end
  return totals
end

local bridgeTasksReadable = true
local function active(item)
  -- AP 0.8.2a wraps isCrafting's MethodResult inside another MethodResult.
  -- Inspect all CPUs, including crafts submitted through other bridges or terminals.
  local cpus, why = bridge.getCraftingCPUs()
  assert(type(cpus) == "table", why or "ME-Crafting-CPUs nicht lesbar.")
  local unknown = false
  for _, cpu in pairs(cpus) do
    assert(type(cpu.isBusy) == "boolean", "Unbekannte ME-CPU-Meldung.")
    if cpu.isBusy then
      local resource = cpu.craftingJob and cpu.craftingJob.resource
      if type(resource) == "table" and resource.name == item then return true end
      if type(resource) ~= "table" or type(resource.name) ~= "string" then unknown = true end
    end
  end
  -- AE2 can report a busy CPU without an item output (e.g. a modded resource).
  -- Cross-check the bridge's own task list. Unidentified CPUs are not evidence
  -- that this specific output is being made. Our persisted pending receipt still
  -- guards against resubmitting a previous Campus order after any interruption.
  if unknown and bridgeTasksReadable then
    local ok, tasks, reason = pcall(bridge.getCraftingTasks)
    if not ok then
      local err = tostring(tasks)
      -- AP 0.8.2a downcasts AdvancedAE CPUs when expanding bridge-created jobs.
      -- The network-wide CPU list above remains valid, as do our job receipts.
      if err:find("ClassCastException",1,true) and err:find("AdvCraftingCPU",1,true) then
        bridgeTasksReadable = false
        return false
      end
      error(err)
    end
    assert(type(tasks) == "table", reason or "ME-Bridge-Auftragsliste nicht lesbar.")
    for _, task in pairs(tasks) do
      if type(task.resource) == "table" and task.resource.name == item then return true end
    end
  end
  return false
end

local submitted, sizes, retryAt = {}, {}, {}
local function clock() return os.epoch("utc") / 1000 end
local function retry(item, credited, delay, message)
  retryAt[item] = clock() + delay
  progress(item, "retrying", credited, message, credited)
  return "wait"
end

local function observe(item, target, record, job)
  if job.hasErrorOccurred() or job.isCalculationNotSuccessful() or job.isCanceled() then
    local code = job.getDebugMessage() or "Auftrag abgebrochen"
    local detail = code
    local missing = job.getMissingItems and job.getMissingItems()
    local lackingBase = 0
    if type(missing) == "table" then
      local lines = {}
      for _, stack in pairs(missing) do
        if type(stack) == "table" and stack.name then
          lines[#lines+1] = tostring(stack.count or stack.amount or "?") .. "x " .. stack.name
          if stack.name == baseItems[item] then lackingBase = tonumber(stack.count or stack.amount) or 0 end
        end
      end
      table.sort(lines)
      if #lines > 0 then detail = detail .. ": " .. table.concat(lines, ", ") end
    end
    local credited = record.credited
    if job.isCraftingStarted() then
      credited = math.min(target, credited + math.max(0, (inventory()[item] or 0) - record.before))
    end
    save({item=item, credited=credited})
    submitted[item] = nil
    if code == "MISSING_ITEMS" or code == "MISSING_INGREDIENT" or code == "CPU_TOO_SMALL" or code == "NO_SUITABLE_CPU_FOUND" then
      if record.pending > 1 then
        local smaller = math.floor(record.pending / 2)
        if lackingBase > 0 and lackingBase < record.pending then smaller = record.pending - lackingBase end
        sizes[item] = math.max(1, smaller)
        return retry(item, credited, 0, detail)
      end
      sizes[item] = 1
      return retry(item, credited, 60, detail)
    end
    if code == "NO_CPU_FOUND" or code == "CPU_BUSY" or code == "CPU_OFFLINE" then
      return retry(item, credited, 30, code)
    end
    return "offen: " .. detail
  end
  local started = job.isCraftingStarted()
  if started then progress(item, "crafting", record.pending, nil, record.credited) end
  if not job.isDone() or (not started and (inventory()[item] or 0) < record.before + record.pending) then return "wait" end
  local credited = record.credited + record.pending
  save({item=item, credited=credited})
  submitted[item] = nil
  sizes[item] = record.pending * 2
  progress(item, "credited", credited)
  return credited >= target and "done" or "more"
end

local function produce(item, target)
  local r = records[item] or {item = item, credited = 0}
  if submitted[item] then return observe(item, target, r, submitted[item]) end
  if r.credited >= target then progress(item, "credited", target); return "done" end
  if (retryAt[item] or 0) > clock() then return "wait" end
  if bridge.isOnline and not bridge.isOnline() then return retry(item, r.credited, 30, "ME Bridge offline") end
  if active(item) then progress(item, "waiting", r.credited); return "wait" end
  local amounts = inventory()
  local have = amounts[item] or 0
  if r.pending then
    -- A reboot may fall between submitting the job and receiving its receipt.
    -- Only accept this batch again if its output is demonstrably in storage.
    if have < r.before + r.pending then
      return retry(item, r.credited, 30, "Eingereichten Auftrag mit ME-Bestand abgleichen: " ..
        math.max(0,have-r.before) .. " von " .. r.pending .. " eingelagert")
    end
    r = {item = item, credited = r.credited + r.pending}
    save(r)
  end
  local credited = math.max(have, r.credited)
  if credited >= target then
    save({item = item, credited = target})
    progress(item, "credited", target)
    return "done"
  end
  local craftables, why = bridge.getCraftableItems()
  assert(type(craftables) == "table", why or "ME-Patterns nicht lesbar.")
  local found = false
  for _, entry in pairs(craftables) do if entry.name == item then found = true; break end end
  if not found then return retry(item, credited, 60, "Kein Pattern erreichbar") end
  local availableBase = amounts[baseItems[item]] or 0
  local amount = math.min(target - credited, sizes[item] or (availableBase > 0 and availableBase or 1024))
  save({item = item, credited = credited, before = have, pending = amount})
  local job, why = bridge.craftItem({name = item, count = amount})
  if not job then
    -- The documented nil return is a rejection before job creation.
    save({item = item, credited = credited})
    return retry(item, credited, 60, tostring(why or "ME hat den Auftrag abgelehnt"))
  end
  submitted[item] = job
  print(item .. " +" .. amount .. " (AE2 berechnet)")
  progress(item, "calculating", amount, nil, credited)
  -- Poll this receipt after the other three variants have had a chance to submit.
  return "wait"
end

print("Erebor: einmaliger ME-Auftrag. Zum Fortsetzen denselben Computer nutzen.")
local blocked = {}
while true do
  local outstanding = false
  for _, target in ipairs(targets) do
    local item = target[1]
    if not blocked[item] then
      local ok, result = pcall(produce, item, target[2])
      if not ok then
        local err = tostring(result)
        if err:find("Java Exception",1,true) or err:find("NOT_CONNECTED",1,true) or err:find("peripheral is not attached",1,true) then
          result = retry(item, (records[item] or {}).credited or 0, 30, err)
        else
          error(result, 0)
        end
      end
      if result ~= "done" then
        if result == "wait" or result == "more" then
          outstanding = true
        else
          blocked[item] = result
          progress(item, "blocked", (records[item] or {}).credited or 0, result)
          print(item .. " " .. result)
        end
      end
    end
  end
  if not outstanding then break end
  sleep(5)
end
if next(blocked) then
  print("Offene Varianten nach Beheben der Ursache auf diesem Computer erneut starten:")
  for item, reason in pairs(blocked) do print(item .. " " .. reason) end
else
  print("Alle vier Mengen gedeckt. Einmalauftrag abgeschlossen.")
end
if next(blocked) then return false, "Siehe Meldung bei der jeweiligen Variante." end
return true
