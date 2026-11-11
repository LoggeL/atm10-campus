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
    if action == 'erebor-prepare':
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
    kind = obj['kind']
    mode = {'stone':0, 'build':2, 'clear':3}.get(kind)
    desired = obj['desired']
    if mode is None or desired['version'] != layout['version'] or not re.fullmatch(r'EREBOR_[A-Za-z0-9_-]+',desired['blueprint']):
        raise ValueError('Unbekannter Erebor-Bauplan.')
    if site['site'] not in desired['blueprint'].split('_'):
        raise ValueError('Der Bauplan gehört zu einer anderen Kanone.')
    opts = {'replace_mode':mode,'skip_missing':False,'replace_block_entities':False}
    return prepare_schematic(bridge,b,desired,obj['nbtBase64'],opts,obj['size'],erebor_kind=kind)
