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
    required = {'site', 'version'}
    if action == 'erebor-supply':
        required.update(('computerId','chestSide'))
    if action == 'erebor-prepare':
        if 'previous' in obj:
            required.add('previous')
        required.update(('desired','nbtBase64','size','kind'))
    if not isinstance(obj, dict) or set(obj) != required or obj['version'] != layout['version']:
        raise ValueError('Erebor-Standortplan oder Auftrag passt nicht.')
    site = next((s for s in layout['sites'] if s['site'] == obj['site']), None)
    if not site:
        raise ValueError('Unbekannter Kanonenplatz.')
    x,y,z = site['cannon']
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
        prefix = 'execute in minecraft:overworld'
        def checked(command):
            if not command.startswith(prefix+' '):
                raise ValueError('Unbekannte Standortabfrage.')
            return bridge.run(proof+command[len(prefix):])
        return {'observed':CannonBridge(bridge.base,checked).inspect(b)}
    kind = obj['kind']
    mode = {'stone':0, 'build':2, 'clear':3}.get(kind)
    desired = obj['desired']
    if mode is None or desired['version'] != layout['version'] or not re.fullmatch(r'EREBOR_[A-Za-z0-9_-]+',desired['blueprint']):
        raise ValueError('Unbekannter Erebor-Bauplan.')
    if site['site'] not in desired['blueprint'].split('_'):
        raise ValueError('Der Bauplan gehört zu einer anderen Kanone.')
    opts = {'replace_mode':mode,'skip_missing':False,'replace_block_entities':False}
    return prepare_schematic(bridge,b,desired,obj['nbtBase64'],opts,obj['size'],erebor_kind=kind,previous=obj.get('previous'))


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
