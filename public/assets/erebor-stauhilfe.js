// Additional KubeJS server script for the surveyed Erebor fleet (Homebox V5/V6).
// It only renews temporary chunk tickets; Create owns all printer and inventory changes.
;(function () {
  var BlockPos = Java.loadClass('net.minecraft.core.BlockPos')
  var ChunkPos = Java.loadClass('net.minecraft.world.level.ChunkPos')
  var TicketType = Java.loadClass('net.minecraft.server.level.TicketType')
  var Comparator = Java.loadClass('java.util.Comparator')
  var Cannon = Java.loadClass('com.simibubi.create.content.schematics.cannon.SchematicannonBlockEntity')
  var Components = Java.loadClass('com.simibubi.create.AllDataComponents')
  var survey = JsonIO.read('kubejs/config/erebor-parallel.json')
  if (!survey || !survey.sites || survey.sites.length !== 37) return
  var ticket = TicketType.create('campus_erebor_stalled', Comparator.naturalOrder(), 120)
  var stations = []
  survey.sites.forEach(function (row) {
    ;['main', 'B', 'C'].forEach(function (slot) {
      var p = row[slot]
      if (p) stations.push({pos:new BlockPos(p[0], p[1], p[2]), file:null, still:0})
    })
  })
  function surveyPrinter(level, chunks, site) {
    var pos = site.pos
    if (!chunks.getChunkNow(pos.getX() >> 4, pos.getZ() >> 4)) return false
    var c = level.getBlockEntity(pos)
    if (!(c instanceof Cannon)) return false
    var state = String(c.state.name()), status = String(c.statusMsg)
    if (!(state === 'PAUSED' && status === 'targetNotLoaded' || state === 'RUNNING' && status === 'searching')) return false
    var item = c.inventory.getStackInSlot(0)
    if (item.isEmpty() || String(item.id) !== 'create:schematic' ||
        String(item.get(Components.SCHEMATIC_OWNER)) !== 'Erebor' ||
        String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase() !== 'none' ||
        String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase() !== 'none') return false
    var file = String(item.get(Components.SCHEMATIC_FILE))
    var anchor = item.get(Components.SCHEMATIC_ANCHOR), size = item.get(Components.SCHEMATIC_BOUNDS)
    if (!/^campus_[0-9a-f-]{36}\.nbt$/.test(file) || !anchor || !size || pos.distSqr(anchor) >= 256*256 ||
        [size.getX(),size.getY(),size.getZ()].some(function (n) { return n <= 0 || n > 128 })) return false
    if (c.printer.isErrored()) return false
    var loaded = c.printer.isLoaded()
    if (loaded && !anchor.equals(c.printer.getAnchor())) return false
    var target = loaded ? c.printer.getCurrentTarget() : null
    var cursor = target ? [target.getX(),target.getY(),target.getZ()].join(',') : ''
    var fingerprint = file + ':' + String(c.blocksPlaced) + ':' + cursor
    site.still = fingerprint === site.file ? site.still + 1 : 0
    site.file = fingerprint
    if (site.still < 2) return true
    // An already accessible station can be in a border chunk without ticking.
    chunks.addRegionTicket(ticket, new ChunkPos(pos), 2, pos)
    // Create also checks the cursor just outside the structure when scanning a
    // new row. Only lease a cursor inside the plan or its one-block fringe.
    if (target && target.getX() >= anchor.getX()-1 && target.getX() <= anchor.getX()+size.getX() &&
        target.getY() >= anchor.getY()-1 && target.getY() <= anchor.getY()+size.getY() &&
        target.getZ() >= anchor.getZ()-1 && target.getZ() <= anchor.getZ()+size.getZ()) {
      chunks.addRegionTicket(ticket, new ChunkPos(target), 2, pos)
    }
    return true
  }
  var ticks = 0
  ServerEvents.tick(function (event) {
    if (++ticks % 40 !== 0) return
    var level = event.server.overworld(), chunks = level.getChunkSource()
    stations.forEach(function (site) {
      if (!surveyPrinter(level,chunks,site)) { site.file=null; site.still=0 }
    })
  })
})()
