"""Small read-only queries when a full cannon NBT response is truncated by RCON."""
import re


def clean(raw):
    return re.sub(r'\x1b\[[0-9;]*m|§.', '', raw).strip()


def block_payload(raw, binding):
    """Reject a concurrent RCON client's reply for another block or command."""
    raw = clean(raw)
    marker = f"{binding['x']}, {binding['y']}, {binding['z']} has the following block data: "
    if not raw.startswith(marker):
        raise ValueError('Minecraft hat keine eindeutige Antwort für diese Kanonenposition geliefert. Bitte erneut prüfen.')
    return raw[len(marker):]


def read_fields(run, binding, parse):
    pos = f"{binding['x']} {binding['y']} {binding['z']}"
    prefix = f"execute in {binding['dimension']}"

    def field(path, optional=False):
        raw = clean(run(f'{prefix} run data get block {pos} {path}'))
        if optional and raw == 'Found no elements matching ' + path:
            return None
        return parse(block_payload(raw, binding))

    def count(path):
        raw = clean(run(f'{prefix} if data block {pos} {path}[]'))
        if raw == 'Test failed':
            return 0
        match = re.fullmatch(r'Test passed, count: (\d+)', raw)
        if not match:
            raise ValueError('Unbekannte Kanonen-Liste: ' + path)
        return int(match[1])

    def identity():
        return {key: field(key, key.startswith('Inventory.')) for key in
                ('id', 'State', 'Status', 'Inventory.Items[{Slot:0}]', 'Inventory.Items[{Slot:1}]', 'Options')}

    before = identity()
    if before['id'] != 'create:schematicannon':
        raise ValueError('Erwartet: create:schematicannon. Keine Änderung.')
    printer = {key: field('Printer.' + key, True) for key in
               ('Anchor', 'CurrentPos', 'EntityProgress', 'PrintStage')}
    printer = {key: value for key, value in printer.items() if value is not None}
    deferred = count('Printer.DeferredBlocks')
    printer['DeferredBlocks'] = [] if deferred == 0 else [None]
    printer['DeferredCount'] = deferred
    n = {'id': before['id'], 'State': before['State'], 'Options': before['Options'],
         'Inventory': {'Items': [before[key] for key in ('Inventory.Items[{Slot:0}]', 'Inventory.Items[{Slot:1}]') if before[key] is not None]},
         'Printer': printer, 'AmountPlaced': field('AmountPlaced'), 'AmountToPlace': field('AmountToPlace'),
         'Status': before['Status'], 'FlyingBlockCount': count('FlyingBlocks')}
    if n['Status'] == 'finished' and n['FlyingBlockCount'] == 0:
        # A generic zero-count reply could belong to another RCON client. Before
        # reporting a possible completion, prove no flights remain with our own
        # unique read-only response. Normal full-NBT snapshots need no extra call.
        from campus_discovery import condition
        from types import SimpleNamespace
        if not condition(SimpleNamespace(run=run), f'{prefix} unless data block {pos} FlyingBlocks[]'):
            raise ValueError('Kanone meldet Abschluss, aber ausstehende Blöcke konnten nicht ausgeschlossen werden. Bitte erneut prüfen.')
    # Multiple RCON reads must never mix one schematic/state/options with another.
    if identity() != before:
        raise ValueError('Kanone während der Statusprüfung geändert. Bitte erneut versuchen.')
    return n
