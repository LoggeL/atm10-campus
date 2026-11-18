"""Site-bound Erebor operations. Coordinates come only from the installed station survey."""
import gzip
import io
import json
import re
import struct
from pathlib import Path


def validate_clear(data, size):
    """Accept only the full explicit air/structure_void encoding emitted by tileNBT."""
    if size != [32, 32, 32]:
        raise ValueError('Aushub benötigt eine vollständige 32er-Kachel.')
    def name(s):
        b = s.encode()
        return struct.pack('>H', len(b)) + b
    def integer(n):
        return struct.pack('>i', n)
    def tag(t, n):
        return bytes([t]) + name(n)
    def seq(n, t, count):
        return tag(9, n) + bytes([t]) + integer(count)
    header = (b'\x0a\0\0' + tag(3, 'DataVersion') + integer(3955) + seq('size', 3, 3)
              + integer(32)*3 + seq('palette', 10, 2))
    for material in ('minecraft:structure_void', 'minecraft:air'):
        header += tag(8, 'Name') + name(material) + b'\0'
    count = 32**3
    header += seq('blocks', 10, count)
    pos, state = seq('pos', 3, 3), tag(3, 'state')
    tail = seq('entities', 10, 0) + b'\0'
    length = len(header) + count*(len(pos)+12+len(state)+5) + len(tail)
    with gzip.GzipFile(fileobj=io.BytesIO(data)) as stream:
        raw = stream.read(length+1)
    if len(raw) != length or not raw.startswith(header) or not raw.endswith(tail):
        raise ValueError('Unvollständiger Aushubplan.')
    offset = len(header)
    for i in range(count):
        prefix = pos + struct.pack('>iii', i%32, i//1024, (i//32)%32) + state
        if not raw.startswith(prefix, offset):
            raise ValueError('Fehlende oder doppelte Aushubzelle.')
        offset += len(prefix)
        if raw[offset:offset+5] not in (b'\0\0\0\0\0', b'\0\0\0\x01\0'):
            raise ValueError('Unbekannter Aushub-Blockzustand.')
        offset += 5


def handle(bridge, action, obj):
    from campus_schematic import prepare_schematic
    layout = json.loads(Path(__file__).with_name('erebor-stations.json').read_text())
    if action == 'erebor-target-leases':
        return publish_target_leases(bridge, layout, obj)
    if action == 'erebor-live':
        import time
        if not isinstance(obj,dict) or set(obj)!={'version'} or obj['version']!=layout['version']:
            raise ValueError('Unbekannte Erebor-Version.')
        path=bridge.base/'data/kubejs/config/erebor-target-live.json'
        if path.stat().st_size>300000:
            raise ValueError('Ungültiger Erebor-Livebericht.')
        data=json.loads(path.read_text())
        if data.get('version')!=obj['version'] or not 0<=time.time()*1000-data.get('at',0)<45000:
            raise ValueError('Kein aktueller Erebor-Livebericht.')
        if data.get('chestTracker') == 5:
            data['chestController'] = 5
        return data
    required = {'site', 'version'}
    if action == 'erebor-start':
        required.update(('desired','kind','size'))
    if action == 'erebor-supply':
        required.update(('computerId','chestSide'))
        if 'targets' in obj:
            required.add('targets')
        if 'target' in obj:
            required.add('target')
    if action == 'erebor-prepare':
        if 'previous' in obj:
            required.add('previous')
        required.update(('desired','nbtBase64','size','kind'))
    if not isinstance(obj, dict) or set(obj) != required or obj['version'] != layout['version']:
        raise ValueError('Erebor-Standortplan oder Auftrag passt nicht.')
    key = obj['site']
    if isinstance(key, str) and re.fullmatch(r'K[0-9]{2}[D-I]', key):
        # New physical addresses are observations, NOT scheduler/feed capability.
        # Reject mutation before looking up opt-in config or touching the world.
        if action != 'erebor-inspect':
            raise ValueError('Zusatzkanonen D–I sind nur zur Beobachtung freigegeben.')
        return {'observerOnly': True, 'observed': bridge.inspect(observer_binding(layout, key))}
    helper = isinstance(key, str) and re.fullmatch(r'(K[0-9]{2})([BC])', key)
    parent = helper[1] if helper else key
    site = next((s for s in layout['sites'] if s['site'] == parent), None)
    if not site:
        raise ValueError('Unbekannter Kanonenplatz.')
    x,y,z = site['cannon']
    if helper:
        if action not in ('erebor-inspect', 'erebor-prepare', 'erebor-start') or (
                action != 'erebor-inspect' and (obj.get('kind') != 'stone' or 'previous' in obj or
                not obj['desired']['blueprint'].startswith('EREBOR_STEIN_'+parent+'_'))):
            raise ValueError('Zusatzkanonen bauen nur Cleanstone des eigenen Standortes.')
        extra = json.loads(Path(__file__).with_name('erebor-parallel.json').read_text())
        row = next((s for s in extra['sites'] if s['site'] == parent), None)
        if extra['version'] != layout['version'] or not row or row['main'] != site['cannon']:
            raise ValueError('Zusatzposition passt nicht zur Hauptkanone.')
        x,y,z = row[helper[2]]
    b = {'x':x, 'y':y, 'z':z, 'dimension':'minecraft:overworld', 'owner':'Erebor'}
    if action == 'erebor-inspect':
        return {'observed':bridge.inspect(b)}
    if action == 'erebor-supply':
        from campus_cannon import CannonBridge
        from campus_discovery import FACING, SIDES, side_offset, validate_candidate, proof_command
        side = obj['chestSide']
        delta = tuple(a-b for a,b in zip(site['chest'],site['computer']))
        faces = [f for f in FACING if side in SIDES and side_offset(f,side)==delta]
        if len(faces)!=1:
            raise ValueError('Kistenseite stimmt nicht mit dem Erebor-Standort überein.')
        xyz = lambda pos: dict(zip(('x','y','z'),pos))
        candidate = validate_candidate({'computer':{**xyz(site['computer']),'id':obj['computerId'],'facing':faces[0],'block':site['computerBlock']},
                    'chest':{**xyz(site['chest']),'side':side,'block':site['inventoryBlock']},'binding':b})
        # Erebor's startup.lua sets the station name at boot. Verify the installed
        # label and physical computer ID in the same world read as the schematic.
        proof = proof_command(candidate).replace('{ComputerId:'+str(obj['computerId'])+'}',
                '{ComputerId:'+str(obj['computerId'])+',Label:"erebor-'+site['site']+'"}')
        if site['inventoryBlock'] == 'minecraft:chest':
            # The tracker selects a candidate. The RCON command still proves the
            # exact block and single-chest state together with every other guard.
            try:
                live=handle(bridge,'erebor-live',{'version':layout['version']})
            except (OSError,ValueError):
                live={}
            slots=live.get('stations',{})
            if live.get('chestTracker')==5 and any(slots.get(parent+s,{}).get('chestBlock')==
                    'sophisticatedstorage:netherite_chest' for s in ('','B','C')):
                proof=proof.replace(' minecraft:chest[type=single]', ' sophisticatedstorage:netherite_chest[type=single]')
        if 'targets' in obj:
            return shared_supply(bridge,layout,site,obj,proof)
        # A large native inventory can turn a single inspection into dozens of
        # RCON calls. Stop starting more calls once this feeder read is late.
        import time
        deadline = time.monotonic()+3
        original_run = bridge.run
        def timed_read(command):
            if time.monotonic() >= deadline:
                raise TimeoutError('Erebor supply read budget')
            return original_run(command)
        if 'target' in obj:
            confirmation = confirm_supply(CannonBridge(bridge.base,timed_read), b, proof, obj['target'], site['site'], layout['version'])
            if confirmation is not None:
                return {'confirmation': confirmation}
        prefix = 'execute in minecraft:overworld'
        def checked(command):
            if not command.startswith(prefix+' '):
                raise ValueError('Unbekannte Standortabfrage.')
            return timed_read(proof+command[len(prefix):])
        return {'observed':CannonBridge(bridge.base,checked).inspect(b)}
    kind = obj['kind']
    mode = {'stone':2, 'build':2, 'clear':3}.get(kind)
    desired = obj['desired']
    if mode is None or desired['version'] != layout['version'] or not re.fullmatch(r'EREBOR_[A-Za-z0-9_-]+',desired['blueprint']):
        raise ValueError('Unbekannter Erebor-Bauplan.')
    if site['site'] not in desired['blueprint'].split('_'):
        raise ValueError('Der Bauplan gehört zu einer anderen Kanone.')
    opts = {'replace_mode':mode,'skip_missing':False,'replace_block_entities':False}
    if action == 'erebor-start':
        from campus_start import start, validate_target
        clear=kind=='clear'
        validate_target(b,desired,opts,erebor_clear=clear)
        observed=bridge.inspect(b)
        if observed.get('components',{}).get('create:schematic_bounds')!=obj['size']:
            raise ValueError('Abmessungen des eingelegten Plans haben sich geändert.')
        if observed.get('state')=='PAUSED' and observed.get('status') in ('noGunpowder','targetNotLoaded','missingBlock','missingItem'):
            raise ValueError('Die Kanone wartet noch auf Treibstoff, Material oder den Zielchunk.')
        if clear:
            if not desired['blueprint'].startswith('EREBOR_') or '_AUSHUB_' not in desired['blueprint'] or bridge.file_hash(b['owner'],desired['file'])!=desired['sha256']:
                raise ValueError('Aushubdatei nicht bestätigt.')
            validate_clear((bridge.base/'data/schematics/uploaded'/b['owner']/desired['file']).read_bytes(),obj['size'])
        return start(bridge,b,desired,opts,observed,erebor_clear=clear,bounds=obj['size'])
    return prepare_schematic(bridge,b,desired,obj['nbtBase64'],opts,obj['size'],erebor_kind=kind,previous=obj.get('previous'))


def observer_binding(layout, key, *, runtime=False):
    """Validate the complete opt-in map before resolving an optional address.

    The default observation file grants no runtime capability. Only the trusted
    lease publisher passes runtime=True, selecting a separate K12-only file.
    Neither map enables prepare/start/supply mutations.
    """
    def require(ok):
        if not ok:
            raise ValueError('Ungültige Beobachtungszuordnung.')
    def exact(value, keys):
        return isinstance(value, dict) and set(value) == set(keys)
    def position(p):
        return isinstance(p, list) and len(p) == 3 and all(type(n) is int and -30000000 <= n <= 30000000 for n in p)
    def adjacent(a, b):
        return sum(abs(x-y) for x,y in zip(a,b)) == 1

    path = Path(__file__).with_name('erebor-runtime-tracker.json' if runtime else 'erebor-observers.json')
    if not path.exists():
        raise ValueError('Keine Zusatzkanone zur Beobachtung freigegeben.')
    require(path.stat().st_size <= 32768)
    config = json.loads(path.read_text())
    require(exact(config, ('schema','version','mode','sites')))
    require(type(config['schema']) is int and config['schema'] == 1 and
            type(config['version']) is int and config['version'] == layout['version'] and
            config['mode'] == ('leased-targets' if runtime else 'observe-only'))
    require(isinstance(config['sites'], list) and 1 <= len(config['sites']) <= 37)
    if runtime:
        require(len(config['sites']) == 1 and isinstance(config['sites'][0], dict) and config['sites'][0].get('site') == 'K12')
    pairs = json.loads(Path(__file__).with_name('erebor-parallel.json').read_text())
    require(pairs['version'] == layout['version'])
    # Protect all pre-existing physical objects, not merely the selected site.
    occupied = {tuple(s[k]) for s in layout['sites'] for k in ('cannon','computer','chest','bridge')}
    occupied.update(tuple(s[k]) for s in pairs['sites'] for k in ('B','C'))
    sites, computers, bindings, groups = set(), set(), {}, []
    def claim(p):
        require(position(p) and tuple(p) not in occupied)
        occupied.add(tuple(p))
    for row in config['sites']:
        require(exact(row, ('site','main','bridge','groups')))
        site = row['site']
        require(isinstance(site, str) and re.fullmatch(r'K(?:0[1-9]|[12][0-9]|3[0-7])', site) and site not in sites)
        sites.add(site)
        legacy = next((s for s in layout['sites'] if s['site'] == site), None)
        pair = next((s for s in pairs['sites'] if s['site'] == site), None)
        require(legacy is not None and pair is not None and row['main'] == legacy['cannon'] == pair['main'] and
                row['bridge'] == legacy['bridge'])
        require(isinstance(row['groups'], list) and len(row['groups']) == 2)
        for group, slots in zip(row['groups'], ('DEF', 'GHI')):
            require(exact(group, ('computerId','computer','chest','slots')))
            cid = group['computerId']
            require(type(cid) is int and 0 <= cid <= 2147483647 and cid not in computers)
            computers.add(cid)
            claim(group['computer'])
            claim(group['chest'])
            require(adjacent(group['computer'], row['bridge']) and adjacent(group['computer'], group['chest']))
            require(exact(group['slots'], slots))
            for slot, p in group['slots'].items():
                claim(p)
                require(adjacent(p, group['chest']))
                bindings[site+slot] = dict(zip('xyz', p), dimension='minecraft:overworld', owner='Erebor')
            groups.append(group)
    for group in groups:
        require(all(not adjacent(p, other['chest']) for other in groups if other is not group for p in group['slots'].values()))
    require(key in bindings)
    return bindings[key]


def publish_target_leases(bridge, layout, obj):
    """Called only through signed, nonce-checked, controller-locked dispatch.

    Validated mapping is a separate install capability; observation never grants it.
    The Campus scheduler, not CC or a browser, supplies exact persisted jobs.
    """
    import os
    import tempfile
    import time
    def require(ok):
        if not ok:
            raise ValueError('Ungültige K12-Ziel-Lease.')
    def vector(p):
        return isinstance(p, list) and len(p) == 3 and all(type(n) is int for n in p)
    now = int(time.time()*1000)
    require(isinstance(obj, dict) and set(obj) == {'schema','version','phase','at','expiresAt','jobs'})
    require(type(obj['schema']) is int and obj['schema'] == 1 and type(obj['version']) is int and obj['version'] == layout['version'] and obj['phase'] == 'stone')
    require(type(obj['at']) is int and type(obj['expiresAt']) is int and 0 <= now-obj['at'] < 10000 and now < obj['expiresAt'] <= obj['at']+10000)
    jobs = obj['jobs']
    require(isinstance(jobs, dict) and set(jobs) in ({'K12'+s for s in 'DEF'}, {'K12'+s for s in 'GHI'}, {'K12'+s for s in 'DEFGHI'}))
    files = set()
    for key, j in jobs.items():
        binding = observer_binding(layout, key, runtime=True)
        require(isinstance(j, dict) and set(j) == {'file','anchor','size','options'})
        require(isinstance(j['file'], str) and re.fullmatch(r'campus_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.nbt',j['file']) and j['file'] not in files)
        files.add(j['file'])
        require(vector(j['anchor']) and vector(j['size']) and all(0 < n <= 256 for n in j['size']))
        require(-64 <= j['anchor'][1] and j['anchor'][1]+j['size'][1] <= 320 and all(abs(n) <= 30000000 for n in j['anchor']))
        require(j['options'] == [2,False,False] and type(j['options'][0]) is int and all(type(n) is bool for n in j['options'][1:]))
        p = [binding[k] for k in 'xyz']
        require(all(sum((j['anchor'][i]+d[i]-p[i])**2 for i in range(3)) < 65536
                    for d in ((x,y,z) for x in (0,j['size'][0]-1) for y in (0,j['size'][1]-1) for z in (0,j['size'][2]-1))))
    directory = bridge.base/'data/kubejs/config'
    # The live consumer must use the identical explicit mapping, not merely a
    # similarly named or observation-only controller file.
    mapping = Path(__file__).with_name('erebor-runtime-tracker.json').read_text()
    require(json.loads((directory/'erebor-runtime-tracker.json').read_text()) == json.loads(mapping))
    target = directory/'erebor-runtime-leases.json'
    if target.exists():
        previous = json.loads(target.read_text())
        require(previous.get('expiresAt',0) <= now or set(previous.get('jobs',{})) <= set(jobs))
        require(previous.get('at',0) <= obj['at'])
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=directory, prefix='.erebor-leases-', delete=False) as f:
            temporary = Path(f.name)
            json.dump(obj,f,separators=(',',':')); f.flush(); os.fsync(f.fileno())
        os.replace(temporary,target)
        require(json.loads(target.read_text()) == obj)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return {'published':True,'lease':json.loads(target.read_text())}


def shared_supply(bridge,layout,site,obj,proof):
    """Use the tracker's printer state plus one live physical inventory check for the group."""
    import time
    from campus_discovery import condition
    targets=obj['targets']
    extra=json.loads(Path(__file__).with_name('erebor-parallel.json').read_text())
    row=next((r for r in extra['sites'] if r['site']==site['site']),None)
    if (not isinstance(targets,dict) or not 1<=len(targets)<=3 or set(targets)-{'A','B','C'} or
            extra['version']!=layout['version'] or not row or row.get('chest')!=site['chest'] or row['main']!=site['cannon']):
        raise ValueError('Unbekannte gemeinsame Materialkiste.')
    report=handle(bridge,'erebor-live',{'version':layout['version']})
    if report.get('sharedChest')!=4 or time.time()*1000-report['at']>10000:
        raise ValueError('Wartet auf aktuellen V4-Standortbericht.')
    confirmed={}
    pos=lambda v:' '.join(map(str,v))
    # Only loaded neighbouring chunks can extract items. Avoid making the
    # K09 feeder depend on an unrelated, sleeping chunk across its boundary.
    # The three authorised consumers and station computer are in the survey.
    chunk=tuple(row['chest'][i]//16 for i in (0,2))
    unloaded=set()
    for x,y,z in re.findall(r' if loaded (-?\d+) (-?\d+) (-?\d+)',proof):
        other=(int(x)//16,int(z)//16)
        if other!=chunk and not condition(bridge,'execute in overworld if loaded '+' '.join((x,y,z))):
            unloaded.add(other)
    def inside(match):
        if (int(match[1])//16,int(match[3])//16) not in unloaded:
            return match[0]
        return match[0].replace(' if loaded',' unless loaded') if ' if loaded' in match[0] else ''
    proof=re.sub(r' if loaded (-?\d+) (-?\d+) (-?\d+)',inside,proof)
    proof=re.sub(r' unless block (-?\d+) (-?\d+) (-?\d+) create:schematicannon',inside,proof)
    for slot,coords in [('A',row['main']),('B',row['B']),('C',row['C'])]:
        if sum(abs(a-b) for a,b in zip(coords,row['chest']))!=1:
            raise ValueError('Kanone grenzt nicht an die Materialkiste.')
        p=pos(coords)
        if slot!='A':
            proof=proof.replace(' unless block '+p+' create:schematicannon','')
        signal=report['stations'].get(site['site']+('' if slot=='A' else slot),{})
        target=targets.get(slot)
        if signal.get('empty') is True or not signal:
            proof+=' unless data block '+p+' Inventory.Items[{Slot:0}]'
            continue
        if not target or not signal.get('upload'):
            raise ValueError('Unbestätigter Bauplan an '+site['site']+slot+'.')
        file=target['file']
        if (not re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt',file) or signal['upload']!=file or
                signal.get('owner')!='Erebor' or signal.get('anchor')!=target['anchor'] or
                signal.get('size')!=target['size'] or signal.get('options')!=target['options'] or
                not signal.get('aligned') or signal.get('state') not in ('RUNNING','PAUSED') or
                type(signal.get('placed')) is not int or signal['placed']<0 or
                bridge.file_hash('Erebor',file)!=target['sha256']):
            raise ValueError('Bauplan, Ausrichtung oder Optionen an '+site['site']+slot+' prüfen.')
        proof+=' if data block '+p+' Inventory.Items[{Slot:0,components:{"create:schematic_file":"'+file+'"}}]'
        confirmed[slot]={'file':file,'placed':signal['placed']}
    # Relative positions leave room for three independent input witnesses in a single RCON packet.
    origin=row['chest']
    def relative(match):
        return ' '.join('~'+(str(int(v)-o) if int(v)!=o else '') for v,o in zip(match.groups(),origin))
    proof=re.sub(r'(?<!\S)(-?\d+) (-?\d+) (-?\d+)(?!\S)',relative,proof)
    proof=proof.replace('execute in minecraft:overworld','execute in overworld positioned '+pos(origin),1)
    # The computer is already proved at this exact position and cannot also be a cannon.
    computer=' '.join('~'+(str(a-b) if a!=b else '') for a,b in zip(site['computer'],origin))
    proof=proof.replace(' unless block '+computer+' create:schematicannon','')
    if not confirmed or not condition(bridge,proof) or time.time()*1000-report['at']>10000:
        raise ValueError('Materialkiste, Computer oder Kanonenbelegung geändert.')
    return {'confirmed':confirmed,'at':time.time()}


def confirm_supply(bridge, binding, proof, target, site, version):
    """Confirm an active printer in one small reply, regardless of how many blocks are in flight."""
    import time
    import secrets
    from campus_probe import clean
    from campus_snbt import Array, dumps
    from campus_start import expected_components, validate_target

    if not isinstance(target, dict) or set(target) != {'desired', 'options', 'size'}:
        raise ValueError('Ungültiger Materialauftrag.')
    desired, options, size = target['desired'], target['options'], target['size']
    validate_target(binding, desired, options, erebor_clear=options.get('replace_mode') == 3)
    if (desired['version'] != version or site not in desired['blueprint'].split('_')
            or not isinstance(size, list) or len(size) != 3
            or any(type(n) is not int or not 1 <= n <= 128 for n in size)):
        raise ValueError('Erebor-Standort oder Bauplanmaße stimmen nicht.')
    components = expected_components(desired)
    components['create:schematic_deployed'] = True
    components['create:schematic_anchor'] = Array('I', desired['anchor'])
    components['create:schematic_bounds'] = Array('I', size)
    guard = {'Inventory': {'Items': [{'Slot': 0, 'id': 'create:schematic', 'components': components}]},
             'Options': options, 'Printer': {'Anchor': Array('I', desired['anchor'])}}
    origin = tuple(binding[k] for k in ('x','y','z'))
    # Position once; expressing the survey relative to the cannon leaves room
    # for the item and printer predicates in Minecraft's RCON command packet.
    def relative(match):
        deltas = [int(p)-o for p,o in zip(match.groups(), origin)]
        return ' '.join('~'+(str(d) if d else '') for d in deltas)
    # Positive computer/chest/cannon tests themselves require loaded chunks,
    # and a verified computer cannot also be an adjacent cannon.
    cp = re.search(r' if block (-?\d+ -?\d+ -?\d+) computercraft:', proof).group(1)
    proof = proof.replace(' unless block '+cp+' create:schematicannon','')
    positive_chunks = set()
    for x, _, z in re.findall(r' if block (-?\d+) (-?\d+) (-?\d+) ', proof):
        positive_chunks.add((int(x)//16,int(z)//16))
    def needed_chunk(match):
        return '' if (int(match[1])//16,int(match[3])//16) in positive_chunks else match[0]
    proof = re.sub(r' if loaded (-?\d+) (-?\d+) (-?\d+)', needed_chunk, proof)
    compact = re.sub(r'(?<!\S)(-?\d+) (-?\d+) (-?\d+)(?!\S)', relative, proof)
    prefix = 'execute in '+binding['dimension']
    compact = compact.replace(prefix, 'execute in overworld positioned '+' '.join(map(str,origin)), 1)
    compact = compact.replace(' minecraft:chest[',' chest[')
    needle = ' if block ~ ~ ~ create:schematicannon'
    if compact.count(needle) != 1:
        raise ValueError('Kanonenposition im Standortnachweis fehlt.')
    for state in ('RUNNING', 'PAUSED'):
        guard['State'] = state
        # Simple scalar SNBT strings may be unquoted. Keep namespaced strings
        # quoted. A fresh, short storage name correlates the read-only reply.
        predicate = re.sub(r'"([A-Za-z0-9_.+-]+)"', r'\1', dumps(guard))
        marker = 'campus:'+secrets.token_hex(10)
        command = compact.replace(needle, needle+predicate, 1)+' run data get storage '+marker
        if len(command.encode())>950:
            return None
        result = clean(bridge.run(command))
        if result == 'Storage '+marker+' has the following contents: {}':
            if bridge.file_hash(binding['owner'], desired['file']) != desired['sha256']:
                raise ValueError('Datei-/Revisionshash stimmt nicht mit der gewählten Campus-Version überein.')
            return {'file': desired['file'], 'sha256': desired['sha256'], 'at': time.time()}
    # An unstarted cannon may have no printer anchor. Use the full guarded
    # inspection so the existing rules for that state still apply.
    return None


def release_unstarted(bridge,b,previous,block,read):
    """Remove only the exact unstarted input. Let Create clear its native printer before inserting another file."""
    import time
    from campus_schematic import freshly_prepared
    from campus_snbt import dumps
    if set(previous) != {'file','sha256','anchor'} or not re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt',previous['file']):
        raise ValueError('Ungültiger vorheriger Bauplan.')
    if bridge.file_hash(b['owner'],previous['file']) != previous['sha256']:
        raise ValueError('Vorheriger Upload wurde geändert.')
    inventory=block.get('Inventory',{})
    items=inventory.get('Items',[])
    old=next((i for i in items if int(i['Slot'])==0),{})
    comp=old.get('components',{})
    printer=block.get('Printer',{})
    if (block.get('id')!='create:schematicannon' or old.get('id')!='create:schematic'
        or comp.get('create:schematic_owner')!=b['owner'] or comp.get('create:schematic_file')!=previous['file']
        or [int(v) for v in comp.get('create:schematic_anchor',[])]!=previous['anchor']
        or not freshly_prepared(block.get('State'),block.get('Status'),block.get('AmountPlaced'),block.get('AmountToPlace'),
                                len(block.get('FlyingBlocks',[None])),printer,previous['anchor'],allow_unfuelled=True)):
        raise ValueError('Der vorherige Bauplan ist belegt oder bereits gestartet.')
    # One server-thread command checks the native job and all inventory slots before the swap.
    key='r'+previous['file'][7:-4].replace('-','')
    target='campus:schematic_transfer '+key
    pos=' '.join(str(b[k]) for k in ('x','y','z'))
    prefix='execute in minecraft:overworld positioned '+pos
    match={k:block[k] for k in ('State','Status','AmountPlaced','AmountToPlace','FlyingBlocks','Printer','Inventory','Options')}
    guard=prefix+' if block ~ ~ ~ create:schematicannon'+dumps(match)
    for slot in set(range(5))-{int(i['Slot']) for i in items}:
        guard+=' unless data block ~ ~ ~ Inventory.Items[{Slot:'+str(slot)+'}]'
    if block['State']=='STOPPED':
        guard+=' unless data block ~ ~ ~ Printer.Anchor unless data block ~ ~ ~ Printer.CurrentPos'
    command=guard+' run data modify block ~ ~ ~ {} merge from storage '+target
    if len(command.encode())>950:
        # Split the full inventory predicate from the job predicate by comparing the slot-zero
        # components used for identity; every other occupied slot still matches its captured NBT.
        trimmed={**match,'Inventory':{**inventory,'Items':[i if int(i['Slot']) else {
            'Slot':0,'id':old['id'],'components':{k:comp[k] for k in ('create:schematic_file','create:schematic_owner','create:schematic_anchor')}} for i in items]}}
        command=command.replace(dumps(match),dumps(trimmed),1)
    if len(command.encode())>950:
        raise ValueError('Kanoneninventar zu umfangreich für den geprüften Wechsel.')
    try:
        bridge.run('data modify storage '+target+' set value {State:"STOPPED",Status:"idle"}')
        bridge.run(prefix+' run data modify storage '+target+'.Inventory set from block ~ ~ ~ Inventory')
        bridge.run('data remove storage '+target+'.Inventory.Items[{Slot:0}]')
        # A failed stage must never clear the input or reset the state.
        # The storage is private to this serialized bridge operation. Validate its content before commit.
        from campus_snbt import loads
        raw=bridge.run('data get storage '+target).strip()
        from campus_probe import clean
        raw=clean(raw)
        marker='Storage campus:schematic_transfer has the following contents: '
        staged={'State':'STOPPED','Status':'idle','Inventory':{**inventory,'Items':[i for i in items if int(i['Slot'])!=0]}}
        def canonical(v):
            if isinstance(v,dict):
                return {k:canonical(e) for k,e in v.items()}
            if isinstance(v,list):
                return (getattr(v,'kind',None),[canonical(e) for e in v])
            return dumps(v)
        if not raw.startswith(marker) or canonical(loads(raw[len(marker):]))!=canonical(staged):
            raise ValueError('Vorbereiteter Inventarwechsel konnte nicht bestätigt werden.')
        bridge.run(command)
    finally:
        bridge.run('data remove storage '+target)
    for _ in range(16):
        current=read()
        if (current.get('State')=='STOPPED' and not any(int(i['Slot'])==0 for i in current['Inventory']['Items'])
                and 'Anchor' not in current.get('Printer',{}) and 'CurrentPos' not in current.get('Printer',{})):
            return current
        time.sleep(.07)
    raise ValueError('Kanone hat den ungestarteten Plan noch nicht freigegeben.')
