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
end

local function stock(item)
  local items, why = bridge.getItems()
  assert(type(items) == "table", why or "ME-Bestand nicht lesbar.")
  local total = 0
  for _, entry in pairs(items) do
    if entry.name == item then
      total = total + assert(tonumber(entry.count or entry.amount), "ME-Menge fehlt.")
    end
  end
  return total
end

local function active(item)
  local value, why = bridge.isCrafting({name = item})
  assert(type(value) == "boolean", why or "Laufende Auftraege nicht lesbar.")
  return value
end

local function produce(item, target)
  local r = records[item] or {item = item, credited = 0}
  if r.credited >= target then progress(item, "credited", target); return "done" end
  if active(item) then progress(item, "waiting", r.credited); return "wait" end
  local have = stock(item)
  if r.pending then
    -- A reboot may fall between submitting the job and receiving its receipt.
    -- Only accept this batch again if its output is demonstrably in storage.
    if have < r.before + r.pending then
      return "offen: unterbrochenen Auftrag im ME pruefen"
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
  if bridge.isCraftable({name = item}) ~= true then return "offen: kein Pattern erreichbar" end
  -- Submit only one bounded batch at a time on this computer.
  local amount = math.min(8192, target - credited)
  save({item = item, credited = credited, before = have, pending = amount})
  local job, why = bridge.craftItem({name = item, count = amount})
  if not job then
    -- The documented nil return is a rejection before job creation.
    save({item = item, credited = credited})
    return "offen: " .. tostring(why or "ME hat den Auftrag abgelehnt")
  end
  print(item .. " +" .. amount .. " (AE2 berechnet)")
  progress(item, "calculating", amount)
  local started = false
  while true do
    if job.hasErrorOccurred() or job.isCalculationNotSuccessful() or job.isCanceled() then
      local detail = job.getDebugMessage() or "Auftrag abgebrochen"
      -- Credit only visible results, including partial output on cancellation.
      save({item = item, credited = math.min(target, credited + math.max(0, stock(item) - have))})
      return "offen: " .. tostring(detail)
    end
    if not started and job.isCraftingStarted() then
      started = true
      progress(item, "crafting", amount)
    end
    if job.isDone() and (started or stock(item) >= have + amount) then break end
    sleep(5)
  end
  save({item = item, credited = credited + amount})
  progress(item, "credited", credited + amount)
  print(item .. " " .. (credited + amount) .. "/" .. target)
  return credited + amount >= target and "done" or "more"
end

print("Erebor: einmaliger ME-Auftrag. Zum Fortsetzen denselben Computer nutzen.")
local blocked = {}
while true do
  local outstanding = false
  for _, target in ipairs(targets) do
    local item = target[1]
    if not blocked[item] then
      local result = produce(item, target[2])
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
