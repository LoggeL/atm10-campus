-- ATM10 Campus: installer for the Schematicannon feeder.
--   wget run {{URL}}/cc/install.lua
-- Downloads campus.lua, asks for the station token and the cannon name, starts the feeder on boot.
local URL = "{{URL}}"

print("ATM10 Campus - Kanonen-Versorger")
local h, err = http.get(URL .. "/cc/campus.lua")
if not h then error("Download fehlgeschlagen: " .. tostring(err), 0) end
local code = h.readAll()
h.close()
if not load(code, "campus.lua") then error("campus.lua ist defekt", 0) end
local f = fs.open("campus.lua", "w")
f.write(code)
f.close()
print("campus.lua geladen.")

settings.set("campus.url", URL)
local token = settings.get("campus.token")
while true do
  if not token or token == "" then
    write("Station-Token (Web-App > Agent-Zugang): ")
    token = read("*")
  end
  local r, rerr, fail = http.get(URL .. "/api/me", { ["Authorization"] = "Bearer " .. token })
  local res = r or fail
  local me = res and textutils.unserializeJSON(res.readAll())
  if res then res.close() end
  if r and me and me.scope ~= "read" then
    print("Token ok: " .. me.user.username .. " (" .. me.scope .. ")")
    if me.scope == "write" then print("Hinweis: Ein Token mit Scope Station reicht und darf keine Baupl\228ne \228ndern.") end
    break
  end
  printError(r and "Token darf nur lesen, bitte einen mit Scope Station anlegen." or ("Token abgelehnt: " .. tostring(rerr)))
  token = nil
end
settings.set("campus.token", token)

local default = os.getComputerLabel() or ("kanone-" .. os.getComputerID())
local name
repeat
  write("Name der Kanone [" .. default .. "]: ")
  name = read()
  if name == "" then name = default end
  if not name:match("^[%w_-]+$") or #name > 40 then printError("Nur Buchstaben, Zahlen, _ und -, max. 40 Zeichen."); name = nil end
until name
settings.set("campus.cannon", name)
os.setComputerLabel(name)
settings.save()

local write_startup = true
if fs.exists("startup.lua") then
  write("startup.lua \252berschreiben? (j/n) ")
  write_startup = read():lower():sub(1, 1) == "j"
end
if write_startup then
  f = fs.open("startup.lua", "w")
  f.write('shell.run("campus.lua")\n')
  f.close()
end
print("Fertig. In der Web-App unter \"Kanonen\" einen Bauplan f\252r " .. name .. " w\228hlen.")
print("In der Schematicannon \"Skip Missing\" ausschalten, dann wartet sie auf fehlende Bl\246cke.")
print("Start: campus  (oder Neustart)")
