// KubeJS server script. Offer attached CC computers a single game-thread operation
// for checking live AE2 stock and exporting through their own ME Bridge.
;(function () {
  var ServerContext = Java.loadClass('dan200.computercraft.shared.computer.core.ServerContext')
  var Side = Java.loadClass('dan200.computercraft.core.computer.ComputerSide')
  var Dynamic = Java.loadClass('dan200.computercraft.api.lua.IDynamicLuaObject')
  var Modem = Java.loadClass('dan200.computercraft.shared.peripheral.modem.wired.WiredModemPeripheral')
  var Bridge = Java.loadClass('de.srendi.advancedperipherals.common.addons.computercraft.peripheral.MEBridgePeripheral')
  var Registries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
  var ResourceLocation = Java.loadClass('net.minecraft.resources.ResourceLocation')
  var ItemKey = Java.loadClass('appeng.api.stacks.AEItemKey')
  var Actionable = Java.loadClass('appeng.api.config.Actionable')
  var FuzzyMode = Java.loadClass('appeng.api.config.FuzzyMode')
  var HashMap = Java.loadClass('java.util.HashMap')
  var Optional = Java.loadClass('java.util.Optional')
  var sides = Side.values()

  function bridgeAt(computer, name) {
    var side = Side.valueOfInsensitive(name)
    if (side != null) return computer.getPeripheral(side)
    for (var i = 0; i < sides.length; i++) {
      var modem = computer.getPeripheral(sides[i])
      if (modem instanceof Modem) {
        var remote = modem.getNode().getElement().getRemotePeripherals().get(name)
        if (remote instanceof Bridge) return remote
      }
    }
    return null
  }

  // Simulate an actual extraction. The terminal's cached amounts may still
  // include a previous transfer. Only use its index to discover component variants.
  function available(entity, item, limit) {
    var service = entity.getGridNode().getGrid().getStorageService()
    var storage = service.getInventory()
    var plain = ItemKey.of(item)
    var count = Number(storage.extract(plain, limit, Actionable.SIMULATE, entity))
    if (count < limit) {
      var variants = service.getCachedInventory().findFuzzy(plain, FuzzyMode.IGNORE_ALL).iterator()
      while (count < limit && variants.hasNext()) {
        var key = variants.next().getKey()
        if (key instanceof ItemKey && key.getItem().equals(item) && !key.equals(plain))
          count += Number(storage.extract(key, limit - count, Actionable.SIMULATE, entity))
      }
    }
    return count
  }

  function exportSurplus(computer, name, to, id, wanted, reserve, deadline) {
    if (!computer.isOn() || Date.now() >= deadline) return [0, 'Lieferfreigabe abgelaufen']
    var bridge = bridgeAt(computer, name)
    if (!(bridge instanceof Bridge) || !bridge.isAvailable()) return [0, 'ME Bridge offline']
    var access = null, matches = 0
    bridge.forEachConnectedComputers(function (attached) {
      if (attached.getID() === computer.getID() && String(attached.getAttachmentName()) === name) {
        access = attached
        matches++
      }
    })
    if (matches !== 1) return [0, 'ME Bridge nicht eindeutig angeschlossen']
    var location = ResourceLocation.tryParse(id)
    if (location == null || !Registries.ITEM.containsKey(location)) return [0, 'Unbekanntes Material']
    var stock = available(bridge.getBridge(), Registries.ITEM.get(location), reserve + wanted)
    var quantity = Math.min(wanted, stock - reserve)
    if (quantity <= 0) return [0, 'ME_RESERVE', stock]
    var filter = new HashMap()
    filter.put('name', id)
    filter.put('count', quantity)
    var result = bridge.exportItem(access, to, Optional.of(filter)).getResult()
    var moved = Number(result[0] || 0)
    // The observed amount is capped at reserve + wanted. It is exact whenever
    // the reserve limits a transfer, including a successful partial delivery.
    return [moved, result.length > 1 && result[1] != null ? String(result[1]) :
      (quantity < wanted && moved === quantity ? 'ME_RESERVE' : null), stock - moved]
  }

  function guardFor(computer) {
    return new Dynamic({
      getMethodNames: function () { return ['exportSurplus'] },
      callMethod: function (context, method, args) {
        var name = String(args.getString(0)), to = String(args.getString(1)), id = String(args.getString(2))
        var wanted = args.getInt(3), reserve = args.getInt(4), deadline = args.getFiniteDouble(5)
        return context.executeMainThreadTask(function () {
          if (wanted < 1 || wanted > 4096 || reserve < 1 || reserve > 1000000 || deadline > Date.now() + 11000)
            return [0, 'Ungueltige Materialanforderung']
          try { return exportSurplus(computer, name, to, id, wanted, reserve, deadline) }
          catch (e) { return [0, 'ME-Entnahme: ' + String(e)] }
        })
      }
    })
  }

  var ticks = 0
  ServerEvents.tick(function (event) {
    if (++ticks % 80 !== 1) return
    ServerContext.get(event.server).registry().getComputers().forEach(function (computer) {
      if (!computer.isOn()) return
      for (var i = 0; i < sides.length; i++) {
        var device = computer.getPeripheral(sides[i])
        if (device instanceof Bridge || device instanceof Modem) {
          if (computer.createRootMount().exists('campus.lua'))
            computer.queueEvent('campus_stock_guard', [guardFor(computer)])
          break
        }
      }
    })
  })
})()
