-- ATM10 Campus: Schematicannon feeder for CC:Tweaked.
-- Keeps the chest next to a Create Schematicannon stocked with what its blueprint still needs, straight from AE2
-- through an Advanced Peripherals ME Bridge. Which blueprint and the options are set in the web app (tab "Kanonen");
-- this computer only knows URL, a station token and its cannon name (install: wget run <url>/cc/install.lua).
-- Strings shown on screen use Latin-1 escapes (\228 = ae-umlaut ...), the CC font is ISO-8859-1.
local VERSION = "1.4.0"

settings.define("campus.url", { description = "Campus-URL", type = "string" })
settings.define("campus.token", { description = "API-Token mit Scope Station", type = "string" })
settings.define("campus.cannon", { description = "Name dieser Kanone", type = "string" })
settings.define("campus.chest", { description = "Peripherie-Name der Kiste an der Kanone (leer = automatisch)", type = "string" })
settings.define("campus.bridge", { description = "Peripherie-Name der ME Bridge (leer = automatisch)", type = "string" })
settings.define("campus.direction", { description = "Statt Peripherie-Name: Richtung von der ME Bridge zur Kiste (z. B. up)", type = "string" })
settings.define("campus.stock", { description = "ME-Bestand an die App melden", default = true, type = "boolean" })
settings.define("campus.autoupdate", { description = "Script automatisch aktualisieren", default = true, type = "boolean" })

local URL = (settings.get("campus.url") or ""):gsub("/+$", "")
local TOKEN = settings.get("campus.token")
local NAME = settings.get("campus.cannon")
if URL == "" or not TOKEN or not NAME then
  printError("Nicht eingerichtet. Bitte install.lua ausf\252hren:")
  print("  wget run <campus-url>/cc/install.lua")
  return
end

local STATE_FILE = ".campus-state"
local GUNPOWDER = "minecraft:gunpowder"

-- ---------- helpers ----------
local function now() return os.epoch("utc") / 1000 end

-- alignment-lease-start
local function alignmentReady(p, receivedAt, clock)
  if not p or not p.alignment or not p.alignment.enabled then return true end
  local a = p.alignment
  return a.state == "aligned" and type(a.leaseSeconds) == "number"
    and a.leaseSeconds > 0 and a.leaseSeconds <= 10
    and clock >= receivedAt and clock - receivedAt < a.leaseSeconds
end
-- alignment-lease-end
local planReceivedAt = -1e9
local plan

-- Server texts are UTF-8; the terminal font is Latin-1.
local SUBST = { [0x2013] = "-", [0x2014] = "-", [0x2018] = "'", [0x2019] = "'", [0x201A] = "'", [0x201C] = '"', [0x201D] = '"', [0x201E] = '"', [0x2026] = "...", [0x2192] = ">", [0x00D7] = "x" }
local function latin1(s)
  if type(s) ~= "string" then return s and tostring(s) or "" end
  local ok, out = pcall(function()
    local t = {}
    for _, c in utf8.codes(s) do t[#t + 1] = c < 256 and string.char(c) or SUBST[c] or "?" end
    return table.concat(t)
  end)
  return ok and out or s
end

local function call(fn, ...)
  if type(fn) ~= "function" then return nil, "Funktion fehlt" end
  local ok, a, b = pcall(fn, ...)
  if not ok then return nil, tostring(a) end
  return a, b
end

-- Number of moved items from an ME Bridge call (number, or table with count/amount depending on the AP version).
local function moved(r)
  if type(r) == "number" then return r end
  if type(r) == "table" then return tonumber(r.count or r.amount or r.moved) or 0 end
  return 0
end

local function request(method, path, body)
  local headers = { ["Authorization"] = "Bearer " .. TOKEN, ["Accept"] = "application/json" }
  local h, err, fail
  if method == "GET" then
    h, err, fail = http.get(URL .. path, headers)
  else
    headers["Content-Type"] = "application/json"
    h, err, fail = http.post(URL .. path, textutils.serializeJSON(body or {}), headers)
  end
  local res = h or fail
  if not res then return nil, "keine Verbindung: " .. tostring(err) end
  local code, text = res.getResponseCode(), res.readAll()
  res.close()
  local data = text and text ~= "" and textutils.unserializeJSON(text) or nil
  if code >= 200 and code < 300 then return data end
  return nil, "HTTP " .. code .. ": " .. latin1(type(data) == "table" and data.error or err or "")
end

-- ---------- state (survives reboots, per assignment) ----------
local state
local function loadState()
  if fs.exists(STATE_FILE) then
    local f = fs.open(STATE_FILE, "r")
    state = textutils.unserialize(f.readAll())
    f.close()
  end
  if type(state) ~= "table" then state = {} end
  state.delivered = state.delivered or {}
  state.cap = state.cap or {}
  state.craftAt = state.craftAt or {}
end
local function saveState()
  local f = fs.open(STATE_FILE, "w")
  f.write(textutils.serialize(state))
  f.close()
end

-- ---------- peripherals ----------
-- Advanced Peripherals changed the ME Bridge API twice; ATM10 8.1+ ships 0.8.x:
--   0.8.x        exportItem(target, filter), target "@up" (relative to the bridge) or a peripheral name
--   0.7.50-0.7.62 exportItem(filter, target), target "up" or a peripheral name
--   0.7.49 and older: exportItemToPeripheral(filter, name) / exportItem(filter, direction), listItems, isItemCraftable
-- A peripheral name only works in the bridge's own namespace: both next to the computer, or both on one wired modem network.
local SIDES = { top = true, bottom = true, left = true, right = true, front = true, back = true }
local ERRORS = {
  INVENTORY_NOT_FOUND = "Kiste von der ME Bridge aus nicht erreichbar",
  NOT_CONNECTED = "ME-Netz nicht verbunden",
  NOT_CRAFTABLE = "kein Muster im ME",
}
local bridge, bridgeName, chest, chestName, api

local function isBridge(n) return peripheral.hasType(n, "me_bridge") or peripheral.hasType(n, "meBridge") end
local function errText(e) return e and (ERRORS[e] or tostring(e)) or nil end

local function detectApi(b)
  if b.exportItemToPeripheral or b.listItems then return "legacy" end
  if b.getMountPaths or b.getMaxItemStorage then return "0.8" end
  if b.getTotalItemStorage then return "0.7" end
  return nil -- unknown: decided on the first transfer
end

local function findPeripherals()
  local b = settings.get("campus.bridge")
  bridge, bridgeName = nil, nil
  chest, chestName = nil, nil
  if b and b ~= "" then
    if peripheral.isPresent(b) then bridge, bridgeName = peripheral.wrap(b), b end
  else
    for _, n in ipairs(peripheral.getNames()) do if isBridge(n) then bridge, bridgeName = peripheral.wrap(n), n break end end
  end
  if not bridge then return false, "Keine ME Bridge gefunden" end
  if api == nil then api = detectApi(bridge) end
  if bridge.isOnline and bridge.isOnline() == false then return false, "ME Bridge offline (Kanal/Strom?)" end

  local direction = settings.get("campus.direction")
  local sameSpace = function(n) return (direction and direction ~= "") or (SIDES[n] or false) == (SIDES[bridgeName] or false) end
  local foundName = settings.get("campus.chest")
  if not foundName or foundName == "" then
    local found = {}
    for _, n in ipairs(peripheral.getNames()) do
      if peripheral.hasType(n, "inventory") and not isBridge(n) and sameSpace(n) then found[#found + 1] = n end
    end
    if #found ~= 1 then
      chest = nil
      return false, (#found == 0 and "Keine Kiste gefunden (Bridge und Kiste beide direkt am Computer oder beide am Modem-Netz)"
        or ("Mehrere Inventare: " .. table.concat(found, ", ") .. " - festlegen mit: set campus.chest <name>"))
    end
    foundName = found[1]
  elseif not sameSpace(foundName) then
    return false, "Kiste " .. foundName .. " ist f\252r die ME Bridge nicht erreichbar (anderes Netz). campus.direction setzen?"
  end
  local foundChest = peripheral.wrap(foundName)
  if not foundChest or not foundChest.list then return false, "Kiste " .. tostring(foundName) .. " ist kein Inventar" end
  -- AP 0.7.5x resolves "left"/"back"/... relative to the bridge block, not the computer
  if api == "0.7" and SIDES[foundName] and not (direction and direction ~= "") then
    return false, "AP 0.7: Richtung von der Bridge zur Kiste setzen: set campus.direction <north|south|east|west|up|down>"
  end
  chest, chestName = foundChest, foundName
  return true
end

local function chestContents()
  local counts, used = {}, 0
  for _, it in pairs(chest.list()) do
    counts[it.name] = (counts[it.name] or 0) + it.count
    used = used + 1
  end
  return counts, used, chest.size()
end

-- Move items between ME and chest. which: "export" | "import". Returns moved count and an error code.
local function transfer(which, item, count)
  local filter = { name = item, count = count }
  local dir = settings.get("campus.direction")
  local useDir = dir and dir ~= ""
  if api == "legacy" then
    local fn = useDir and bridge[which .. "Item"] or bridge[which == "export" and "exportItemToPeripheral" or "importItemFromPeripheral"]
    local r, e = call(fn, filter, useDir and dir or chestName)
    return moved(r), e
  end
  local fn = bridge[which .. "Item"]
  if api ~= "0.7" then
    local ok, r, e = pcall(fn, useDir and ("@" .. dir) or chestName, filter)
    if ok then api = "0.8"; return moved(r), e end
    if api == "0.8" then return 0, tostring(r) end
  end
  local ok, r, e = pcall(fn, filter, useDir and dir or chestName)
  if ok then api = "0.7"; return moved(r), e end
  api = nil
  return 0, tostring(r)
end
local function export(item, count)
  if not alignmentReady(plan, planReceivedAt, now()) then return 0, "Ausrichtung nicht live bestaetigt" end
  return transfer("export", item, count)
end
local function import(item, count) return transfer("import", item, count) end

local function meAmount(item)
  local it = call(bridge.getItem, { name = item })
  if type(it) ~= "table" then return 0 end
  return tonumber(it.count or it.amount) or 0
end
local function isCraftable(item) return call(bridge.isCraftable or bridge.isItemCraftable, { name = item }) == true end
local function isCrafting(item) return call(bridge.isCrafting or bridge.isItemCrafting, { name = item }) == true end

-- ---------- feeding ----------
local view = { shortages = {}, state = "start", message = nil }

local function returnLeftovers()
  local back = 0
  for _, it in pairs(chest.list()) do
    if it.name ~= GUNPOWDER and (state.delivered[it.name] or 0) > 0 then
      back = back + import(it.name, it.count)
    end
  end
  return back
end

local function notice(text) view.notice, view.noticeUntil = text, now() + 120 end

local function startAssignment(p)
  if state.assignment and p.options and p.options.returnLeftovers and chest then
    local n = returnLeftovers()
    if n > 0 then notice(n .. " Reste ins ME zur\252ck") end
  end
  view.craftError = nil
  state = { assignment = p.assignment, delivered = {}, cap = {}, craftAt = {} }
  saveState()
end

local function shortage(it, missing, have, err)
  local inME = meAmount(it.item)
  local s = { item = it.item, missing = missing, inME = inME, craftable = false, crafting = false }
  if inME >= missing and err then s.error = errText(err) end
  if inME < missing then
    s.craftable = isCraftable(it.item)
    if s.craftable then
      s.crafting = isCrafting(it.item)
      local last = state.craftAt[it.item] or 0
      if not s.crafting and plan.options.autoCraft and now() - last > 60 and alignmentReady(plan, planReceivedAt, now()) then
        local amount = math.max(1, math.min(plan.options.craftBatch, it.needed - have - inME))
        local ok, cerr = call(bridge.craftItem, { name = it.item, count = amount })
        state.craftAt[it.item] = now()
        if ok then s.crafting = true else s.error = errText(cerr) or "Crafting abgelehnt" end
      end
    end
  end
  view.shortages[#view.shortages + 1] = s
end

local function feed()
  local still = {}
  for _, it in ipairs(plan.items) do if it.needed > 0 then still[it.item] = true end end
  local back = 0
  for _, it in pairs(chest.list()) do
    if it.name ~= GUNPOWDER and not still[it.name] and (state.delivered[it.name] or 0) > 0 then back = back + import(it.name, it.count) end
  end
  if back > 0 then notice(back .. " nicht mehr ben\246tigte Items ins ME zur\252ck") end
  local counts, used, size = chestContents()
  local free = size - used
  view.shortages, view.chest, view.full = {}, { slots = size, used = used, name = chestName }, false
  local dirty = false

  local gp = plan.options.gunpowder or 0
  local haveGp = counts[GUNPOWDER] or 0
  if gp > haveGp and (haveGp > 0 or free > 0) then
    local n = export(GUNPOWDER, gp - haveGp)
    if haveGp == 0 and n > 0 then free = free - 1 end
    if n < gp - haveGp and haveGp + n == 0 then
      view.shortages[#view.shortages + 1] = { item = GUNPOWDER, missing = gp, inME = meAmount(GUNPOWDER), craftable = false, crafting = false }
    end
  end

  local buffer = plan.options.bufferStacks or 2
  for _, it in ipairs(plan.items) do
    local have = counts[it.item] or 0
    -- Delivery limit per assignment: protects the ME from a hopper or player draining the chest.
    state.cap[it.item] = math.max(state.cap[it.item] or 0, math.ceil(it.needed * 1.1) + it.stack)
    local allowed = state.cap[it.item] - (state.delivered[it.item] or 0)
    local want = math.min(math.min(it.needed, buffer * it.stack) - have, allowed)
    if want > 0 then
      local roomInSlots = math.ceil(have / it.stack) * it.stack - have
      local room = roomInSlots + free * it.stack
      if want > room then want = room; view.full = true end
      if want > 0 then
        local n, err = export(it.item, want)
        if n > 0 then
          state.delivered[it.item] = (state.delivered[it.item] or 0) + n
          free = free - (math.ceil((have + n) / it.stack) - math.ceil(have / it.stack))
          dirty = true
        end
        if n < want then shortage(it, want - n, have + n, err) end
      end
    elseif allowed <= 0 and have == 0 and it.needed > 0 then
      view.shortages[#view.shortages + 1] = { item = it.item, missing = it.needed, inME = meAmount(it.item), error = "Liefergrenze erreicht (zieht jemand Items aus der Kiste?)" }
    end
  end
  if dirty then saveState() end
  view.state = #view.shortages > 0 and "waiting" or (view.full and "full" or "feeding")
end

-- ---------- reporting ----------
local wanted, wantedAt = nil, -1e9

local function reportStock()
  if not wanted or now() - wantedAt > 600 then
    local w, err = request("GET", "/api/me/wanted")
    if not w then return false, err end
    wanted, wantedAt = {}, now()
    for _, name in ipairs(w.items or {}) do wanted[name] = true end
  end
  local list, err = call(bridge.getItems or bridge.listItems)
  if type(list) ~= "table" then return false, "ME-Liste: " .. tostring(err) end
  local items, index = {}, {}
  for _, it in ipairs(list) do
    if wanted[it.name] then
      local amount = tonumber(it.count or it.amount) or 0
      if index[it.name] then items[index[it.name]].amount = items[index[it.name]].amount + amount
      else
        items[#items + 1] = { name = it.name, amount = amount, craftable = it.isCraftable == true }
        index[it.name] = #items
      end
    end
  end
  local craft = call(bridge.getCraftableItems or bridge.listCraftableItems)
  if type(craft) == "table" then
    for _, it in ipairs(craft) do
      if wanted[it.name] then
        if index[it.name] then items[index[it.name]].craftable = true
        else
          items[#items + 1] = { name = it.name, amount = 0, craftable = true }
          index[it.name] = #items
        end
      end
    end
  end
  return request("POST", "/api/me/stock", { source = NAME, items = items })
end

-- status-reporting-start
-- A deterministic signature avoids reports caused only by Lua table iteration order.
local function statusSignature(value)
  local kind = type(value)
  if kind == "table" then
    local entries = {}
    for key, item in pairs(value) do
      entries[#entries + 1] = statusSignature(key) .. "=" .. statusSignature(item)
    end
    table.sort(entries)
    return "{" .. table.concat(entries, ";") .. "}"
  end
  if kind == "string" then return "s" .. #value .. ":" .. value end
  return kind .. ":" .. tostring(value)
end

local function statusReporter(clock, send)
  local acknowledged, acknowledgedAt, retryAt, failures = nil, -1e9, -1e9, 0
  return function(payload, heartbeat)
    local stamp, signature = clock(), statusSignature(payload)
    if stamp < retryAt then return nil, nil, false end
    if signature == acknowledged and stamp - acknowledgedAt < heartbeat then return true, nil, false end
    -- Only this main-loop reporter makes HTTP calls. A failed send never acknowledges a change.
    local ok, response, err = pcall(send, payload)
    if not ok then err, response = tostring(response), nil end
    if response then
      acknowledged, acknowledgedAt, retryAt, failures = signature, clock(), -1e9, 0
      return response, nil, true
    end
    failures = math.min(failures + 1, 4)
    retryAt = clock() + math.min(30, 5 * 2 ^ (failures - 1))
    return nil, err or "Status konnte nicht gesendet werden", true
  end
end
-- status-reporting-end

local sendStatus = statusReporter(now, function(payload)
  return request("POST", "/api/cannons/" .. NAME .. "/status", payload)
end)
local function reportStatus()
  return sendStatus({
    assignment = plan and plan.assignment or 0, state = view.state, script = VERSION, api = api, computerId = os.getComputerID(),
    message = (view.state == "error" and view.error) or view.message or view.craftError,
    chest = view.chest, chestSide = chestName, delivered = state.delivered, shortages = view.shortages,
  }, plan and plan.intervals and plan.intervals.status or 30)
end

local function selfUpdate(target)
  local h = http.get(URL .. "/cc/campus.lua")
  if not h then return end
  local code = h.readAll()
  h.close()
  if not code:find('local VERSION = "' .. target .. '"', 1, true) or not load(code, "campus.lua") then return end
  local path = shell and shell.getRunningProgram() or "campus.lua"
  local f = fs.open(path, "w")
  f.write(code)
  f.close()
  print("Aktualisiert auf " .. target .. ", starte neu ...")
  sleep(1)
  os.reboot()
end

-- ---------- screen ----------
local LABELS = {
  start = "Startet", feeding = "Liefert", waiting = "Wartet auf Material", full = "Kiste voll", done = "Fertig",
  alignment = "Ausrichtung gesperrt", paused = "Pausiert", unassigned = "Kein Bauplan", missing = "Bauplan fehlt", nosnapshot = "Kein Live-Bestand", error = "Fehler",
}
local function draw(t)
  local w, h = t.getSize()
  local color = t.isColor()
  local function line(y, text, fg)
    if y > h then return end
    t.setCursorPos(1, y)
    if color then t.setTextColor(fg or colors.white) end
    t.write(text:sub(1, w))
  end
  t.setBackgroundColor(colors.black)
  t.clear()
  line(1, "ATM10 Campus  Kanone " .. NAME, colors.cyan)
  local y = 2
  if plan and plan.blueprint then
    line(y, latin1(plan.blueprint.name) .. " (v" .. plan.blueprint.version .. ")", colors.lightGray); y = y + 1
    local start, left = plan.totals.start or 0, plan.totals.needed or 0
    local pct = start > 0 and math.max(0, math.min(100, math.floor((start - left) / start * 100))) or 100
    local bw = math.max(5, w - 18)
    local fill = math.floor(bw * pct / 100)
    line(y, "[" .. string.rep("#", fill) .. string.rep(".", bw - fill) .. "] " .. pct .. "% fehlt " .. left); y = y + 1
  end
  local st = view.state
  line(y, "Status: " .. (LABELS[st] or st), (st == "waiting" or st == "error") and colors.orange or (st == "done" and colors.lime or colors.white)); y = y + 1
  if view.chest then line(y, "Kiste " .. tostring(view.chest.name) .. ": " .. view.chest.used .. "/" .. view.chest.slots .. " Slots", colors.lightGray); y = y + 1 end
  if view.message then line(y, latin1(view.message), colors.yellow); y = y + 1 end
  if view.craftError then line(y, view.craftError, colors.orange); y = y + 1 end
  if #view.shortages > 0 then
    line(y, "Fehlt:", colors.orange); y = y + 1
    for _, s in ipairs(view.shortages) do
      local tag = s.crafting and " (craftet)" or (s.craftable and " (craftbar)" or "")
      line(y, " " .. s.missing .. "x " .. s.item:gsub("^minecraft:", "") .. " ME:" .. s.inME .. tag, colors.lightGray); y = y + 1
      if s.error then line(y, "   " .. s.error, colors.red); y = y + 1 end
    end
  end
  if view.error then line(h, latin1(view.error), colors.red) end
  line(h - (view.error and 1 or 0), "q Ende  r Neu laden  v" .. VERSION .. (api and ("  AP " .. api) or ""), colors.gray)
end
local function redraw()
  local ok = pcall(draw, term)
  local mon = peripheral.find("monitor")
  if mon then pcall(function() mon.setTextScale(0.5) draw(mon) end) end
  return ok
end

-- ---------- main ----------
local planAt, stockAt = -1e9, -1e9
local wakeRequested = false
local function wake()
  if wakeRequested then return end
  wakeRequested = true
  os.queueEvent("campus_wake")
end

local function tick()
  view.error = nil
  local ok, perr = findPeripherals()
  local iv = plan and plan.intervals or { plan = 60, status = 30, stock = 300 }

  if now() - planAt >= iv.plan then
    local p, err = request("GET", "/api/cannons/" .. NAME .. "/plan")
    if p then
      plan, planAt, planReceivedAt = p, now(), now()
      if settings.get("campus.autoupdate") and p.script and p.script ~= VERSION then selfUpdate(p.script) end
    else
      view.error, planAt = err, now() - iv.plan + 5
      if plan and plan.alignment and plan.alignment.enabled then planReceivedAt = -1e9 end
    end
  end
  view.message = view.notice and now() < view.noticeUntil and view.notice or nil
  if view.craftErrAt and now() - view.craftErrAt > 600 then view.craftError, view.craftErrAt = nil, nil end
  if not ok then
    view.state, view.error, view.shortages, view.chest = "error", perr, {}, nil
  elseif not plan then
    view.state, view.error, view.shortages = "error", view.error or "Kein Bauplan abrufbar", {}
  elseif plan then
    local preparing = plan.schematic and plan.schematic.settings.enabled and plan.schematic.job and plan.schematic.job.state ~= "ready"
    if not preparing and plan.assignment ~= state.assignment then startAssignment(plan) end
    if preparing then view.state, view.message, view.shortages = "alignment", latin1(plan.schematic.job.message or "Schematic wird vorbereitet"), {}
    elseif not alignmentReady(plan, planReceivedAt, now()) then view.state, view.message, view.shortages = "alignment", latin1(plan.message or "Live-Freigabe fehlt oder abgelaufen"), {}
    elseif not plan.blueprint then view.state, view.message, view.shortages = plan.state, plan.message and latin1(plan.message), {}
    elseif plan.options.paused then view.state, view.shortages = "paused", {}
    elseif plan.done then
      if plan.options.returnLeftovers and not state.returned then
        local n = returnLeftovers()
        state.returned = true
        saveState()
        if n > 0 then notice(n .. " Reste ins ME zur\252ck") end
      end
      view.state, view.shortages = "done", {}
    else feed() end
  end

  local _, reportError = reportStatus()
  if reportError then view.error = reportError end
  if ok and settings.get("campus.stock") and now() - stockAt >= iv.stock then
    local _, err = reportStock()
    stockAt = err and now() - iv.stock + 60 or now()
    if err then view.error = err end
  end
end

local function mainLoop()
  while true do
    wakeRequested = false
    local ok, err = pcall(tick)
    if not ok then
      view.state, view.error = "error", tostring(err)
      reportStatus()
    end
    redraw()
    -- Events received during an HTTP/peripheral call leave a pending wake, so they
    -- cannot be lost by its filtered event wait. The next iteration stays sequential.
    if not wakeRequested then
      local timer = os.startTimer(5)
      while not wakeRequested do
        local ev, id = os.pullEvent()
        if ev == "timer" and id == timer then break end
      end
      os.cancelTimer(timer)
    end
  end
end

-- Keys, plus AE2 crafting results (AP sends "ae_crafting": isError, jobId, status).
local function eventLoop()
  while true do
    local ev, a, b, c = os.pullEvent()
    if ev == "char" and a == "q" then return end
    if ev == "char" and a == "r" then planAt, stockAt = -1e9, -1e9; wake() end
    if ev == "ae_crafting" then
      if a == true then view.craftError, view.craftJob, view.craftErrAt = "Crafting-Auftrag " .. tostring(b) .. ": " .. errText(c), b, now()
      elseif b == view.craftJob then view.craftError, view.craftErrAt = nil, nil end
      wake()
    end
    if ev == "peripheral" or ev == "peripheral_detach" then wake() end
  end
end

loadState()
term.clear()
term.setCursorPos(1, 1)
print("ATM10 Campus Kanonen-Versorger " .. VERSION)
parallel.waitForAny(mainLoop, eventLoop)
term.setCursorPos(1, select(2, term.getSize()))
print("Beendet.")
