"""Guarded inventory preparation for the existing signed controller bridge."""
import hashlib
import math
import os
import re

from campus_snbt import loads, dumps, Array


class Waiting(ValueError):
    pass


def position(values):
    if not isinstance(values, list) or len(values) != 3 or not all(type(n) is int and abs(n) <= 30_000_000 for n in values):
        raise ValueError('Invalid coordinates')
    return ' '.join(map(str, values))


def context(job):
    settings = job['settings']
    if settings['dimension'] != 'minecraft:overworld':
        raise ValueError('Only the overworld has a Campus snapshot')
    pos = position(settings['position'])
    position(job['origin'])
    if math.dist(settings['position'], job['origin']) >= 256:
        raise ValueError('Schematic anchor outside cannon range')
    if settings['replaceMode'] not in (0, 1, 2):
        raise ValueError('Unsafe replacement mode for a sparse rest plan')
    return f'execute in {settings["dimension"]}', pos


def components(job):
    return {
        'create:schematic_deployed': True,
        'create:schematic_owner': job['owner'],
        'create:schematic_file': job['fileName'],
        'create:schematic_anchor': Array('I', job['origin']),
        'create:schematic_bounds': Array('I', job['size']),
        'create:schematic_rotation': 'none',
        'create:schematic_mirror': 'none',
    }


def options(job):
    s = job['settings']
    return {'replace_mode': s['replaceMode'], 'skip_missing': s['skipMissing'], 'replace_block_entities': not s['protectBlockEntities']}


def same(actual, expected):
    # Numeric NBT tags and typed arrays decode to their logical JSON values here.
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and same(actual[k], v) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and len(actual) == len(expected) and all(same(a, b) for a, b in zip(actual, expected))
    if isinstance(expected, (int, bool)):
        try:
            return int(actual) == int(expected)
        except (TypeError, ValueError):
            return False
    return actual == expected


def installed(block, job):
    return block.get('id') == 'create:schematicannon' and any(int(i['Slot']) == 0 and i.get('id') == 'create:schematic' and same(i.get('components'), components(job))
               for i in block.get('Inventory', {}).get('Items', [])) and same(block.get('Options'), options(job))


def prepare_update(block, job):
    prefix, pos = context(job)
    if block.get('id') != 'create:schematicannon':
        raise Waiting('An diesen Koordinaten ist keine geladene Schematicannon.')
    printer = block.get('Printer', {})
    if block.get('State') != 'STOPPED' or block.get('FlyingBlocks') != [] or any(k in printer for k in ('Anchor', 'CurrentPos')) or int(block.get('AmountPlaced', -1)) != 0 or int(block.get('AmountToPlace', -1)) != 0 or printer.get('DeferredBlocks') != [] or int(printer.get('EntityProgress', 0)) != -1 or printer.get('PrintStage') != 'BLOCKS':
        raise Waiting('Kanone vollständig stoppen (Stop, nicht Pause). Danach wird der neue Plan eingesetzt.')
    inventory = block.get('Inventory')
    if not isinstance(inventory, dict) or int(inventory.get('Size', 0)) != 5:
        raise ValueError('Unexpected cannon inventory format')
    items = inventory.get('Items', [])
    by_slot = {int(i['Slot']): i for i in items}
    if len(by_slot) != len(items) or any(n not in range(5) for n in by_slot):
        raise ValueError('Unexpected cannon slots')
    existing = by_slot.get(0)
    if existing and not (existing.get('id') == 'create:schematic' and existing.get('components', {}).get('create:schematic_owner') == job['owner'] and re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt', existing.get('components', {}).get('create:schematic_file', ''))):
        raise Waiting('Das manuell eingesetzte Schematic zuerst aus dem Kanonen-Eingang nehmen.')
    new_items = [i for i in items if int(i['Slot']) != 0]
    # Reuse the empty schematic from the completed job when available.
    empty = by_slot.get(1)
    if not existing and empty and empty.get('id') == 'create:empty_schematic':
        new_items = [i for i in new_items if int(i['Slot']) != 1]
        if int(empty.get('count', 1)) > 1:
            new_items.append({**empty, 'count': int(empty['count']) - 1})
    new_items.append({'Slot': 0, 'id': 'create:schematic', 'count': 1, 'components': components(job)})
    payload = {'Inventory': {**inventory, 'Items': new_items}, 'Options': options(job)}
    # Check the observed inventory, all empty slots, the cannon type and its stopped state in the SAME server command.
    # This prevents a GUI interaction or Play between the read and write from replacing a live plan.
    observed_items = [i if int(i['Slot']) != 0 else {'Slot': 0, 'id': i['id'], 'count': i.get('count', 1), 'components': {
        k: i['components'][k] for k in ('create:schematic_file', 'create:schematic_owner')}} for i in items]
    observed = {'State': 'STOPPED', 'AmountPlaced': 0, 'AmountToPlace': 0, 'FlyingBlocks': [], 'Inventory': {**inventory, 'Items': observed_items}}
    guard = f'{prefix} if block {pos} create:schematicannon{dumps(observed)} unless data block {pos} Printer.Anchor unless data block {pos} Printer.CurrentPos'
    for slot in range(5):
        if slot not in by_slot:
            guard += f' unless data block {pos} Inventory.Items[{{Slot:{slot}}}]'
    key = storage_key(job)
    command = f'{guard} run data modify block {pos} {{}} merge from storage campus:schematic_transfer {key}'
    if len(command.encode('utf8')) > 950:
        raise Waiting('Bücher oder umfangreiche Zusatzdaten aus dem Kanonen-Inventar nehmen und erneut vorbereiten.')
    return command, payload


def storage_key(job):
    return 'j' + job['fileName'][7:-4].replace('-', '')


def apply_command(block, job):
    return prepare_update(block, job)[0]


def staging_commands(block, job, payload):
    prefix, pos = context(job)
    target = 'campus:schematic_transfer ' + storage_key(job)
    commands = [f'data modify storage {target} set value {{}}',
                f'{prefix} run data modify storage {target}.Inventory set from block {pos} Inventory',
                f'data modify storage {target}.Options set value {dumps(payload["Options"])}']
    by_slot = {int(i['Slot']): i for i in block['Inventory']['Items']}
    if 0 in by_slot:
        commands.append(f'data remove storage {target}.Inventory.Items[{{Slot:0}}]')
    elif 1 in by_slot and by_slot[1].get('id') == 'create:empty_schematic':
        count = int(by_slot[1].get('count', 1))
        commands.append(f'data modify storage {target}.Inventory.Items[{{Slot:1}}].count set value {count - 1}' if count > 1
                        else f'data remove storage {target}.Inventory.Items[{{Slot:1}}]')
    new_item = next(i for i in payload['Inventory']['Items'] if int(i['Slot']) == 0)
    commands.append(f'data modify storage {target}.Inventory.Items append value {dumps(new_item)}')
    if any(len(c.encode('utf8')) > 950 for c in commands):
        raise ValueError('Schematic-Metadaten zu umfangreich.')
    return commands


def prepare_schematic(bridge, binding, desired, encoded, cannon_options, size):
    import base64
    import secrets
    fields = {'file', 'sha256', 'owner', 'anchor', 'rotation', 'mirror', 'blueprint', 'version'}
    if not isinstance(desired, dict) or set(desired) != fields:
        raise ValueError('Ungültige Schematic-Revision.')
    if not re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt', desired['file']) or not re.fullmatch('[0-9a-f]{64}', desired['sha256']):
        raise ValueError('Ungültiger Schematic-Dateiname oder Hash.')
    if desired['owner'] != binding['owner'] or desired['rotation'] != 'none' or desired['mirror'] != 'none':
        raise ValueError('Schematic weicht von der bestätigten Bindung ab.')
    if type(desired['version']) is not int or desired['version'] < 1 or not isinstance(desired['blueprint'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}', desired['blueprint']):
        raise ValueError('Ungültige Bauplanrevision.')
    if not isinstance(size, list) or len(size) != 3 or not all(type(n) is int and 0 < n <= 8192 for n in size):
        raise ValueError('Ungültige Schematic-Größe.')
    if not isinstance(cannon_options, dict) or set(cannon_options) != {'replace_mode', 'skip_missing', 'replace_block_entities'} or type(cannon_options['replace_mode']) is not int or cannon_options['replace_mode'] not in (0, 1, 2) or any(type(cannon_options[k]) is not bool for k in ('skip_missing', 'replace_block_entities')):
        raise ValueError('Ungültige Kanonen-Einstellungen.')
    job = {'fileName': desired['file'], 'origin': desired['anchor'], 'size': size, 'owner': desired['owner'],
           'settings': {'position': [binding[k] for k in ('x', 'y', 'z')], 'dimension': binding['dimension'],
                        'replaceMode': cannon_options['replace_mode'], 'skipMissing': cannon_options['skip_missing'],
                        'protectBlockEntities': not cannon_options['replace_block_entities']}}
    context(job)
    if not -64 <= job['origin'][1] <= 319:
        raise ValueError('Anker außerhalb der Bauhöhe.')
    if not isinstance(encoded, str) or len(encoded) > 23*1024*1024:
        raise ValueError('Schematic zu groß.')
    data = base64.b64decode(encoded, validate=True)
    if len(data) > 16*1024*1024 or not data.startswith(b'\x1f\x8b') or hashlib.sha256(data).hexdigest() != desired['sha256']:
        raise ValueError('Schematic-Hash oder Dateiformat stimmt nicht.')

    def read():
        raw = re.sub(r'\x1b\[[0-9;]*m|§.', '', bridge.run(bridge.prefix(binding)))
        marker = 'has the following block data: '
        if marker not in raw:
            raise ValueError('Kanone nicht geladen.')
        return loads(raw.split(marker, 1)[1].strip())

    block = read()
    root = (bridge.base / 'data/schematics/uploaded').resolve()
    directory = root / binding['owner']
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise ValueError('Unsicherer Schematic-Ordner.')
    target = directory / desired['file']
    if target.is_symlink():
        raise ValueError('Unsichere Schematic-Datei.')
    if installed(block, job) and bridge.file_hash(binding['owner'], desired['file']) == desired['sha256']:
        return {'binding': binding, 'observed': bridge.inspect(binding), 'applied': True}
    command, payload = prepare_update(block, job)
    stages = staging_commands(block, job, payload)
    directory.mkdir(parents=True, exist_ok=True)
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != desired['sha256']:
        raise ValueError('Unveränderliche Schematic-Datei hat einen anderen Hash.')
    temp = directory / ('.campus-' + secrets.token_hex(16) + '.tmp')
    try:
        with temp.open('xb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
        temp.replace(target)
    finally:
        temp.unlink(missing_ok=True)
    backups = bridge.base / 'discord/campus-schematic-backups'
    backups.mkdir(parents=True, exist_ok=True)
    backup = backups / (desired['file'] + '.snbt')
    if not backup.exists():
        backup.write_text(dumps(block))
    try:
        for stage in stages:
            bridge.run(stage)
        bridge.run(command)
    finally:
        bridge.run('data remove storage campus:schematic_transfer ' + storage_key(job))
    result = read()
    if not installed(result, job) or result.get('State') != 'STOPPED' or int(result.get('AmountPlaced', -1)) != 0 or int(result.get('AmountToPlace', -1)) != 0:
        raise ValueError('Kanone während Vorbereitung geändert. Keine Freigabe; bewusst stoppen und erneut versuchen.')
    observed = bridge.inspect(binding)
    if observed['fileHash'] != desired['sha256']:
        raise ValueError('Schematic-Dateihash nach Vorbereitung abweichend.')
    return {'binding': binding, 'observed': observed, 'applied': True}

