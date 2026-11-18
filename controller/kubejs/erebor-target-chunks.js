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
  var supplyChests = ['minecraft:chest','sophisticatedstorage:netherite_chest']
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
    stations.push({site:s.site, pos:new BlockPos(p[0],p[1],p[2]), chest:s.chest, active:false, lastError:-1200})
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

  // Explicit K12 pilot only. This is a local, validated controller mapping,
  // not permission to dispatch, feed, change mode, or load sleeping chunks.
  var additions = []
  function same(a,b) { return JSON.stringify(a) === JSON.stringify(b) }
  function adjacent(a,b) { return a.reduce(function(n,v,i){return n+Math.abs(v-b[i])},0) === 1 }
  function requireMap(ok) { if (!ok) throw Error('Invalid K12 tracker mapping') }
  try {
    var extra = JsonIO.read('kubejs/config/erebor-runtime-tracker.json')
    if (extra && extra.mode === 'leased-targets') {
      requireMap(extra.schema===1 && extra.version===survey.version && extra.sites.length===1)
      var pilot=extra.sites[0]
      var legacy=survey.sites.filter(function(s){return s.site==='K12'})[0]
      var pair= pairs && pairs.sites.filter(function(s){return s.site==='K12'})[0]
      requireMap(pilot.site==='K12' && legacy && pair && pairs.version===survey.version &&
        same(pilot.main,legacy.cannon) && same(pilot.main,pair.main) && same(pilot.bridge,legacy.bridge) && pilot.groups.length===2)
      var occupied={}, computers={}
      survey.sites.forEach(function(s){['cannon','computer','chest','bridge'].forEach(function(k){occupied[s[k].join(',')]=true})})
      pairs.sites.forEach(function(s){['B','C'].forEach(function(k){occupied[s[k].join(',')]=true})})
      function claim(p) {
        requireMap(Array.isArray(p) && p.length===3 && p.every(function(n){return typeof n==='number' && isFinite(n) && Math.floor(n)===n && Math.abs(n)<=30000000}))
        requireMap(!occupied[p.join(',')]);occupied[p.join(',')]=true
      }
      pilot.groups.forEach(function(g,i){
        requireMap(typeof g.computerId==='number' && Math.floor(g.computerId)===g.computerId && g.computerId>=0 && g.computerId<=2147483647 && !computers[g.computerId])
        computers[g.computerId]=true;claim(g.computer);claim(g.chest)
        requireMap(adjacent(g.computer,pilot.bridge) && adjacent(g.computer,g.chest))
        var names=i===0?['D','E','F']:['G','H','I']
        requireMap(same(Object.keys(g.slots).sort(),names))
        names.forEach(function(slot){
          var p=g.slots[slot];claim(p);requireMap(adjacent(p,g.chest))
          additions.push({site:pilot.site+slot,pos:position(p),chest:g.chest,leased:true,active:false,lastError:-1200})
        })
      })
      pilot.groups.forEach(function(g){pilot.groups.forEach(function(other){
        if(g!==other)Object.keys(g.slots).forEach(function(s){requireMap(!adjacent(g.slots[s],other.chest))})
      })})
    }
  } catch (e) { additions=[];console.info('Erebor K12 tracker mapping rejected: '+e) }
  stations=stations.concat(additions)
  var runtimeLeases=null
  function hasRuntimeLease(station,row) {
    var l=runtimeLeases, now=Date.now()
    if (!l || l.schema!==1 || l.version!==survey.version || l.phase!=='stone' ||
        typeof l.at!=='number' || typeof l.expiresAt!=='number' || !isFinite(l.at) || !isFinite(l.expiresAt) ||
        l.at>now || now-l.at>=10000 || l.expiresAt<=now || l.expiresAt-l.at>10000 || l.expiresAt<=l.at) return false
    var job=l.jobs && l.jobs[station.site]
    return !!job && row.ready===true && row.owner==='Erebor' && row.aligned===true &&
      /^campus_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.nbt$/.test(row.upload) &&
      job.file===row.upload && same(job.anchor,row.anchor) && same(job.size,row.size) &&
      same(job.options,[2,false,false]) && same(row.options,job.options)
  }

  function renew(level, chunks, station, row) {
    var pos = station.pos
    // Reading a sleeping station must not create a new chunk ticket.
    if (!chunks.getChunkNow(pos.getX() >> 4, pos.getZ() >> 4)) return false
    var c = level.getBlockEntity(pos)
    if (!(c instanceof Cannon)) return false
    if (station.chest || station.pair) {
      var chest=station.chest || station.pair.chest
      if (station.leased && !chunks.getChunkNow(chest[0] >> 4,chest[2] >> 4)) {
        row.ready=false
        return false
      }
      var chestState = level.getBlockState(position(chest))
      row.chestBlock = String(Registries.BLOCK.getKey(chestState.getBlock()))
      row.ready = supplyChests.indexOf(row.chestBlock) >= 0 &&
        String(chestState.getValue(chestState.getBlock().getStateDefinition().getProperty('type')).name()).toLowerCase() === 'single'
    }
    var item = c.inventory.getStackInSlot(0)
    row.upload=String(item.get(Components.SCHEMATIC_FILE)||'')
    row.state=String(c.state.name()); row.status=String(c.statusMsg)
    row.empty=item.isEmpty()
    // Mode 3 belongs to explicit excavation plans. Set the surveyed empty
    // cannons and the legacy Campus build modes directly on the server tick.
    var campusInput=String(item.id)==='create:schematic' &&
      String(item.get(Components.SCHEMATIC_OWNER))==='Erebor' && /^campus_[0-9a-f-]{36}\.nbt$/.test(row.upload)
    var preserveDigReceipt=Number(c.replaceMode)===3 && row.status==='finished'
    if (!station.leased && ((row.empty && !preserveDigReceipt) || (campusInput && [0,1].indexOf(Number(c.replaceMode))>=0)) && Number(c.replaceMode)!==2) {
      c.replaceMode=2
      c.setChanged()
      c.sendData()
    }
    row.options=[Number(c.replaceMode),!!c.skipMissing,!!c.replaceBlockEntities]
    if (row.upload) {
      var origin=item.get(Components.SCHEMATIC_ANCHOR), size=item.get(Components.SCHEMATIC_BOUNDS)
      row.owner=String(item.get(Components.SCHEMATIC_OWNER)||'')
      row.anchor=origin?[origin.getX(),origin.getY(),origin.getZ()]:null
      row.size=size?[size.getX(),size.getY(),size.getZ()]:null
      row.aligned=String(item.id)==='create:schematic' && String(item.get(Components.SCHEMATIC_DEPLOYED))==='true' &&
        String(item.get(Components.SCHEMATIC_ROTATION)).toLowerCase()==='none' && String(item.get(Components.SCHEMATIC_MIRROR)).toLowerCase()==='none' &&
        !!origin && c.printer.isLoaded() && !c.printer.isErrored() && origin.equals(c.printer.getAnchor())
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
    if (station.leased) {
      row.runtimeLease=hasRuntimeLease(station,row)
      if (!row.runtimeLease) return false
    }
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
    // New slots require a conservative proof for the complete deployed volume,
    // not merely the origin or a hand-picked cursor. Legacy behavior is unchanged.
    if (station.leased) {
      for (var dx=0; dx<2; dx++) for (var dy=0; dy<2; dy++) for (var dz=0; dz<2; dz++) {
        var corner=new BlockPos(anchor.getX()+dx*(bounds.getX()-1),anchor.getY()+dy*(bounds.getY()-1),anchor.getZ()+dz*(bounds.getZ()-1))
        if (pos.distSqr(corner)>=256*256 || Math.abs(corner.getX()-pos.getX())>255) return false
      }
    }

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


// Read-only telemetry: bounded to the installed 37-site survey. Never calls
// getBlock until hasChunk, never adds tickets, never changes energy/world state.
function campusReadNetwork(level,survey) {
 var result={at:Date.now(),source:'AE2 server-thread',stations:{},power:[]};
 function probe(p) {
  var row={position:p,loaded:level.hasChunk(p[0]>>4,p[2]>>4)};
  if(!row.loaded)return row;
  try {
   var b=level.getBlock(p[0],p[1],p[2]);row.block=String(b.id);
   if(row.block!=='advancedperipherals:me_bridge' && row.block!=='ae2:energy_acceptor')return row;
   var node=b.entity.getGridNode();row.nodePresent=node!=null;
   if(node){
    row.powered=node.isPowered();row.online=node.isOnline();row.channelsSatisfied=node.meetsChannelRequirements();
    var g=node.getGrid();row.booting=g.getPathingService().isNetworkBooting();
    row.storedAE=Number(g.getEnergyService().getStoredPower());
   }
  }catch(e){row.error='probe_unavailable';}
  return row;
 }
 survey.sites.forEach(function(s){result.stations[s.site]=probe(s.bridge);});
 // Dependency chain measured individually: an unloaded source has unknown
 // generation state, not zero energy. Coordinates are observation targets only.
 [[-367,316,-9998],[-368,316,-9998],[-46,62,69]].forEach(function(p){result.power.push(probe(p));});
 return result;
}
  var network=null
  var ticks = 0
  ServerEvents.tick(function (event) {
    if (++ticks % 10 !== 0) return
    var level = event.server.overworld(), chunks = level.getChunkSource()
    runtimeLeases=null
    if (additions.length) {
      try { runtimeLeases=JsonIO.read('kubejs/config/erebor-runtime-leases.json') }
      catch (e) { /* A broken/missing renewal immediately fails closed. */ }
    }
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
      if(ticks%240===0 || !network)network=campusReadNetwork(level,survey)
      JsonIO.write('kubejs/config/erebor-target-live.json',{version:survey.version,sharedChest:4,chestTracker:5,at:Date.now(),stations:report,network:network})
    }
  })
  console.info('Erebor-Zielchunks: '+stations.length+' Kanonen überwacht.')
})()
