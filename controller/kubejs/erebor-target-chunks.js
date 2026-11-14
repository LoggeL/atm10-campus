// Homebox / Minecraft 1.21.1: install as kubejs/server_scripts/campus/erebor-target-chunks.js.
// The matching fleet survey belongs at kubejs/config/erebor-stations.json.
;(function () {
  var TicketType = Java.loadClass('net.minecraft.server.level.TicketType')
  var Comparator = Java.loadClass('java.util.Comparator')
  var ChunkPos = Java.loadClass('net.minecraft.world.level.ChunkPos')
  var BlockPos = Java.loadClass('net.minecraft.core.BlockPos')
  var Cannon = Java.loadClass('com.simibubi.create.content.schematics.cannon.SchematicannonBlockEntity')
  var Components = Java.loadClass('com.simibubi.create.AllDataComponents')
  var Registries = Java.loadClass('net.minecraft.core.registries.BuiltInRegistries')
  // Each script generation has its own ticket type. Minecraft expires these
  // after ten seconds of game time even on script reload; vanilla force-loads,
  // player tickets and other mods' tickets are independent.
  var ticket = TicketType.create('campus_erebor_target', Comparator.naturalOrder(), 200)
  var survey = JsonIO.read('kubejs/config/erebor-stations.json')
  if (!survey || survey.project !== 'erebor' || survey.sites.length !== 37)
    throw Error('Erebor: Kanonenstandorte fehlen.')
  var stations = []
  survey.sites.forEach(function (s) {
    var p = s.cannon
    stations.push({site:s.site, pos:new BlockPos(p[0],p[1],p[2]), active:false, lastError:-1200})
  })
  var pairs = JsonIO.read('kubejs/config/erebor-parallel.json')
  function position(v) { return new BlockPos(v[0],v[1],v[2]) }
  if (pairs && pairs.version === survey.version) {
    pairs.sites.forEach(function (pair) {
      if (!pair.B || !pair.C) return
      ;['B','C'].forEach(function (slot) {
        stations.push({site:pair.site+slot,pos:position(pair[slot]),pair:pair,active:false,lastError:-1200})
      })
    })
  }

  function renew(level, chunks, station, row) {
    var pos = station.pos
    // Reading a sleeping station must not create a new chunk ticket.
    if (!chunks.getChunkNow(pos.getX() >> 4, pos.getZ() >> 4)) return false
    var c = level.getBlockEntity(pos)
    if (!(c instanceof Cannon)) return false
    if (station.pair) {
      var chestState = level.getBlockState(position(station.pair.chest))
      row.ready = String(Registries.BLOCK.getKey(chestState.getBlock())) === 'minecraft:chest'
    }
    var item = c.inventory.getStackInSlot(0)
    row.upload=String(item.get(Components.SCHEMATIC_FILE)||'')
    row.state=String(c.state.name()); row.status=String(c.statusMsg)
    row.empty=item.isEmpty()
    if (row.upload) {
      var origin=item.get(Components.SCHEMATIC_ANCHOR), size=item.get(Components.SCHEMATIC_BOUNDS)
      row.owner=String(item.get(Components.SCHEMATIC_OWNER)||'')
      row.anchor=origin?[origin.getX(),origin.getY(),origin.getZ()]:null
      row.size=size?[size.getX(),size.getY(),size.getZ()]:null
      row.aligned=String(item.id)==='create:schematic' && String(item.get(Components.SCHEMATIC_DEPLOYED))==='true' &&
        String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase()==='none' && String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase()==='none' &&
        !!origin && c.printer.isLoaded() && !c.printer.isErrored() && origin.equals(c.printer.getAnchor())
      row.options=[Number(c.replaceMode),!!c.skipMissing,!!c.replaceBlockEntities]
    }
    row.placed=Number(c.blocksPlaced); row.total=Number(c.blocksToPlace); row.fuel=Number(c.remainingFuel)
    row.chunks=[]; row.target=null
    // Keep the actual input -> finished/output transition even if Campus polls
    // after the native cannon has already cleared its progress counters.
    var output=c.inventory.getStackInSlot(1)
    var count=output.isEmpty()?0:String(output.id)==='create:empty_schematic'?Number(output.getCount()):-1
    var at=Date.now()
    if (row.upload) {
      station.previous={file:row.upload,at:at,count:count}
      station.finish=null
    } else if (station.previous) {
      var prev=station.previous
      if (row.state==='STOPPED' && row.status==='finished' && at-prev.at<=10000 && prev.count>=0 && count===prev.count+1)
        station.finish={file:prev.file,at:at,before:prev.at,oldCount:prev.count,newCount:count}
      station.previous=null
    }
    row.finish=station.finish||null
    if (!c.printer.isLoaded() || c.printer.isErrored()) return false
    var running = String(c.state.name()) === 'RUNNING'
    var blocked = String(c.state.name()) === 'PAUSED' && String(c.statusMsg) === 'targetNotLoaded'
    var flights = c.flyingBlocks
    if (!running && !blocked && flights.isEmpty()) return false

    if (String(item.id) !== 'create:schematic' || String(item.get(Components.SCHEMATIC_OWNER)) !== 'Erebor' ||
        !/^campus_[0-9a-f-]{36}\.nbt$/.test(String(item.get(Components.SCHEMATIC_FILE))) ||
        String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase() !== 'none' ||
        String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase() !== 'none') return false
    var anchor = item.get(Components.SCHEMATIC_ANCHOR), bounds = item.get(Components.SCHEMATIC_BOUNDS)
    if (!anchor || !bounds || !anchor.equals(c.printer.getAnchor()) || pos.distSqr(anchor) >= 256*256) return false
    if ([bounds.getX(),bounds.getY(),bounds.getZ()].some(function(n){return n<=0 || n>128})) return false

    // Check world positions against the deployed volume. Create's initial
    // printer cursor (-1,0,0) isn't a target. Only the X/Z chunk matters.
    var visited = {}
    function hold(target) {
      if (!target) return
      var x=target.getX()-anchor.getX(), y=target.getY()-anchor.getY(), z=target.getZ()-anchor.getZ()
      if (x<0 || y<0 || z<0 || x>=bounds.getX() || y>=bounds.getY() || z>=bounds.getZ()) return
      var key = (target.getX()>>4)+','+(target.getZ()>>4)
      if (!visited[key]) {
        chunks.addRegionTicket(ticket, new ChunkPos(target), 2, pos)
        visited[key] = true
      }
    }
    if (running || blocked) {
      var target=c.printer.getCurrentTarget()
      hold(target)
      if (target && Object.keys(visited).length) row.target=[target.getX()>>4,target.getZ()>>4]
    }
    for (var i=0; i<flights.size(); i++) hold(flights.get(i).target)
    row.chunks=Object.keys(visited)
    return row.chunks.length > 0
  }

  var ticks = 0
  ServerEvents.tick(function (event) {
    if (++ticks % 10 !== 0) return
    var level = event.server.overworld(), chunks = level.getChunkSource()
    var report={}
    stations.forEach(function (station) {
      try {
        var row = {}
        var active = renew(level,chunks,station,row)
        report[station.site]=row
        if (active !== station.active) {
          console.info('Erebor-Zielchunks '+station.site+': '+(active?'aktiv':'laufen aus'))
          station.active = active
        }
      } catch (e) {
        if (ticks-station.lastError >= 1200) {
          station.lastError=ticks
          console.error('Erebor-Zielchunks '+station.site+': '+e)
        }
      }
    })
    if (ticks%80===0) {
      JsonIO.write('kubejs/config/erebor-target-live.json',{version:survey.version,sharedChest:4,at:Date.now(),stations:report})
    }
  })
  console.info('Erebor-Zielchunks: '+stations.length+' Kanonen überwacht.')
})()
