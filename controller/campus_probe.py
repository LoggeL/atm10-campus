"""Small read-only queries when a full cannon NBT response is truncated by RCON."""
import re


def clean(raw):
    return re.sub(r'\x1b\[[0-9;]*m|§.', '', raw).strip()


def read_fields(run, binding, parse):
    pos = f"{binding['x']} {binding['y']} {binding['z']}"
    prefix = f"execute in {binding['dimension']}"

    def field(path, optional=False):
        raw = clean(run(f'{prefix} run data get block {pos} {path}'))
        marker = 'has the following block data: '
        if optional and raw == 'Found no elements matching ' + path:
            return None
        if marker not in raw:
            raise ValueError('Kanonen-Daten konnten nicht vollständig gelesen werden: ' + path)
        return parse(raw.split(marker, 1)[1])

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
                ('id', 'State', 'Inventory.Items[{Slot:0}]', 'Options')}

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
         'Inventory': {'Items': [before['Inventory.Items[{Slot:0}]']] if before['Inventory.Items[{Slot:0}]'] else []},
         'Printer': printer, 'AmountPlaced': field('AmountPlaced'), 'AmountToPlace': field('AmountToPlace'),
         'Status': field('Status', True), 'FlyingBlockCount': count('FlyingBlocks')}
    # Multiple RCON reads must never mix one schematic/state/options with another.
    if identity() != before:
        raise ValueError('Kanone während der Statusprüfung geändert. Bitte erneut versuchen.')
    return n
