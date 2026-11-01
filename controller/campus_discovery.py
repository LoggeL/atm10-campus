"""Bind a station only after its saved-map candidate is independently proved live."""
import json
import re
import secrets

from campus_probe import clean

COMPUTERS = {'computercraft:computer_normal', 'computercraft:computer_advanced'}
COLORS = ('white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black')
CHESTS = {'minecraft:chest', 'minecraft:trapped_chest', 'minecraft:barrel', 'minecraft:shulker_box'} | {f'minecraft:{c}_shulker_box' for c in COLORS}
FACING = {'north': (0, 0, -1), 'south': (0, 0, 1), 'east': (1, 0, 0), 'west': (-1, 0, 0)}
SIDES = {'front', 'back', 'left', 'right', 'top', 'bottom'}
NEIGHBORS = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))


def position(value):
    return tuple(value[k] for k in ('x', 'y', 'z'))


def valid_position(values):
    return all(type(n) is int for n in values) and abs(values[0]) <= 30_000_000 and -64 <= values[1] <= 319 and abs(values[2]) <= 30_000_000


def side_offset(facing, side):
    x, _, z = FACING[facing]
    # Stationary CC computers swap LEFT/RIGHT after DirectionUtil.toLocal.
    return {'front': (x, 0, z), 'back': (-x, 0, -z), 'left': (-z, 0, x),
            'right': (z, 0, -x), 'top': (0, 1, 0), 'bottom': (0, -1, 0)}[side]


def validate_candidate(candidate):
    from campus_cannon import validate_binding
    if not isinstance(candidate, dict) or set(candidate) != {'computer', 'chest', 'binding'}:
        raise ValueError('Ungültiger Kartenkandidat.')
    computer, chest = candidate['computer'], candidate['chest']
    if not isinstance(computer, dict) or set(computer) != {'id', 'x', 'y', 'z', 'block', 'facing'}:
        raise ValueError('Computer-ID, Position, Blocktyp und Ausrichtung erforderlich.')
    if type(computer['id']) is not int or not 0 <= computer['id'] <= 2147483647 or computer['block'] not in COMPUTERS or computer['facing'] not in FACING or not valid_position(position(computer)):
        raise ValueError('Ungültiger Computer im Kartenkandidaten.')
    if not isinstance(chest, dict) or set(chest) != {'x', 'y', 'z', 'block', 'side'} or chest['block'] not in CHESTS or chest['side'] not in SIDES or not valid_position(position(chest)):
        raise ValueError('Nur unterstützte direkt angrenzende Inventare können automatisch zugeordnet werden.')
    expected = tuple(a + b for a, b in zip(position(computer), side_offset(computer['facing'], chest['side'])))
    if position(chest) != expected:
        raise ValueError('Kistenposition stimmt nicht mit der gemeldeten Computerseite überein.')
    binding = validate_binding(candidate['binding'])
    if binding['dimension'] != 'minecraft:overworld' or sum(abs(a - b) for a, b in zip(position(chest), position(binding))) != 1 or position(binding) == position(computer):
        raise ValueError('Kanone muss direkt an der ausgewählten Kiste in der Oberwelt stehen.')
    return {'computer': dict(computer), 'chest': dict(chest), 'binding': binding}


def condition(bridge, command):
    # Minecraft can mix replies from concurrent RCON clients. A generic "Test
    # passed" cannot prove which request ran. Reading a fresh storage ID emits
    # its unique name on success, without writing storage or changing the world.
    # False intermediate execute conditions emit nothing. Retry once because an
    # empty/mixed reply can also result from the shared RCON output buffer.
    for attempt in range(2):
        marker = 'campus:discovery_' + secrets.token_hex(16)
        request = command + ' run data get storage ' + marker
        if len(request.encode('utf8')) > 950:
            raise ValueError('Live-Zuordnungsprüfung überschreitet die RCON-Grenze.')
        raw = clean(bridge.run(request))
        if raw == f'Storage {marker} has the following contents: {{}}':
            return True
        if attempt == 1 and raw == '':
            return False
    raise ValueError('Minecraft hat keine eindeutige RCON-Antwort zur Zuordnung geliefert. Die Zuordnung bleibt gesperrt; bitte erneut prüfen.')


def proof_command(candidate):
    c, chest, binding = candidate['computer'], candidate['chest'], candidate['binding']
    cp, hp, bp = position(c), position(chest), position(binding)
    adjacent = [tuple(a + b for a, b in zip(hp, delta)) for delta in NEIGHBORS]
    adjacent = [p for p in adjacent if valid_position(p)]
    text = lambda p: ' '.join(map(str, p))
    # Loading is a chunk property. Check each involved chunk once before block tests.
    chunks = {}
    for p in [cp, hp, *adjacent]:
        chunks.setdefault((p[0] // 16, p[2] // 16), p)
    command = 'execute in minecraft:overworld' + ''.join(f' if loaded {text(p)}' for p in chunks.values())
    command += f' if block {text(cp)} {c["block"]}[facing={c["facing"]}]{{ComputerId:{c["id"]}}}'
    chest_state = '[type=single]' if chest['block'] in ('minecraft:chest', 'minecraft:trapped_chest') else ''
    command += f' if block {text(hp)} {chest["block"]}{chest_state}'
    command += f' if block {text(bp)} create:schematicannon'
    command += ''.join(f' unless block {text(p)} create:schematicannon' for p in adjacent if p != bp)
    return command


def parse_settings(raw):
    """Read JSON or CC's flat scalar Lua table without evaluating Lua code."""
    if len(raw.encode('utf8')) > 65536:
        raise ValueError('Computer-Einstellungen sind zu groß.')

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('Doppelte Schlüssel in Computer-Einstellungen.')
            result[key] = value
        return result

    try:
        return json.loads(raw, object_pairs_hook=unique)
    except json.JSONDecodeError:
        pass
    # textutils.serialize uses [ "dotted.key" ] = "value". Accept only
    # scalar entries and ordinary JSON-compatible strings; unusual Lua escapes,
    # expressions, nested tables, comments and duplicate keys fail closed.
    quoted = r'"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"'
    entry = re.compile(r'\s*(?:\[\s*(' + quoted + r')\s*\]|([A-Za-z_][A-Za-z_0-9]*))\s*=\s*('
                       + quoted + r'|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s*(,|$)')
    source = raw.strip()
    if not source.startswith('{') or not source.endswith('}'):
        raise ValueError('Ungültige Computer-Einstellungen.')
    source = source[1:-1].strip()
    pairs, offset = [], 0
    while offset < len(source):
        match = entry.match(source, offset)
        if not match:
            raise ValueError('Nicht unterstützte Computer-Einstellungen.')
        key = json.loads(match[1]) if match[1] else match[2]
        pairs.append((key, json.loads(match[3])))
        offset = match.end()
        if not source[offset:].strip():
            break
    return unique(pairs)


def settings_identity(bridge, station, candidate):
    c = candidate['computer']
    root = bridge.base / 'data/world/computercraft/computer'
    folder, path = root / str(c['id']), root / str(c['id']) / '.settings'
    try:
        if root.is_symlink() or folder.is_symlink() or path.is_symlink() or not path.resolve().is_relative_to(root.resolve()) or path.stat().st_size > 65536:
            raise ValueError('Computer-Einstellungen sind nicht sicher lesbar.')
        settings = parse_settings(path.read_text())
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ValueError('Gespeicherte Computer-Einstellungen fehlen oder sind ungültig.') from None
    if not isinstance(settings, dict) or not isinstance(settings.get('campus.cannon'), str) or settings['campus.cannon'].lower() != station:
        raise ValueError('Computer-ID gehört laut gespeicherten Einstellungen zu einer anderen Station.')
    configured = settings.get('campus.chest')
    if configured not in (None, '') and configured != candidate['chest']['side']:
        raise ValueError('Gemeldete Kistenseite weicht von den gespeicherten Computer-Einstellungen ab.')


def fully_idle(observed):
    printer = observed.get('printer')
    return (observed.get('state') == 'STOPPED' and all(type(observed.get(k)) is int and observed[k] == 0 for k in ('amountPlaced', 'amountToPlace', 'flyingBlocks'))
            and isinstance(printer, dict) and not any(k in printer for k in ('Anchor', 'CurrentPos'))
            and printer.get('DeferredBlocks') == [] and printer.get('EntityProgress') == -1 and printer.get('PrintStage') == 'BLOCKS')


def old_idle_or_absent(bridge, old):
    pos = ' '.join(map(str, position(old)))
    prefix = f'execute in {old["dimension"]}'
    if condition(bridge, f'{prefix} if loaded {pos} unless block {pos} create:schematicannon'):
        return
    if not condition(bridge, f'{prefix} if loaded {pos} if block {pos} create:schematicannon'):
        raise ValueError('Alter Kanonenstandort ist nicht geladen. Automatische Neuzuordnung wartet.')
    if not fully_idle(bridge.inspect(old)):
        raise ValueError('Alte Kanone ist noch aktiv oder enthält einen Printer-Auftrag. Keine Neuzuordnung.')


def discover(bridge, station, candidate, registry):
    from campus_cannon import validate_binding
    candidate = validate_candidate(candidate)
    binding = candidate['binding']
    old = validate_binding(registry[station]) if station in registry else None
    if any(name.lower() != station and all(other.get(k) == binding[k] for k in ('dimension', 'x', 'y', 'z')) for name, other in registry.items()):
        raise ValueError('Gefundene Kanone gehört bereits zu einer anderen Station.')
    command = proof_command(candidate)

    def prove():
        settings_identity(bridge, station, candidate)
        if not condition(bridge, command):
            raise ValueError('Die Live-Welt bestätigt die Kartenposition nicht. Der Bereich ist eventuell nicht geladen oder Computer, Kiste oder Kanone wurde verändert. Bitte erneut prüfen.')

    prove()
    if old == binding:
        observed = bridge.inspect(binding)
        prove()
        if bridge.registry() != registry:
            raise ValueError('Kanonen-Registry während Live-Prüfung geändert.')
        return {'binding': binding, 'observed': observed, 'discovered': True}
    if old:
        old_idle_or_absent(bridge, old)
    if not fully_idle(bridge.inspect(binding)):
        raise ValueError('Gefundene Kanone ist noch aktiv. Automatische Bindung wartet auf eine vollständig gestoppte Kanone.')
    # Recheck both locations and the exact physical relationship immediately before
    # the registry change. Discovery itself never changes any Minecraft block.
    if old:
        old_idle_or_absent(bridge, old)
    observed = bridge.inspect(binding)
    if not fully_idle(observed):
        raise ValueError('Gefundene Kanone wurde während der Bindungsprüfung gestartet. Keine Änderung.')
    prove()
    if bridge.registry() != registry:
        raise ValueError('Kanonen-Registry während Live-Prüfung geändert.')
    bridge.save_registry({**registry, station: binding})
    return {'binding': binding, 'observed': observed, 'discovered': True}
