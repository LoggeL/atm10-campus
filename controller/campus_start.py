"""Start/resume only the exact prepared plan, without modifying its cached progress."""
import math
import re
import time
from campus_snbt import Array, dumps


def validate_target(binding, desired, options):
    fields = {'file', 'sha256', 'owner', 'anchor', 'rotation', 'mirror', 'blueprint', 'version'}
    if not isinstance(desired, dict) or set(desired) != fields:
        raise ValueError('Ungültige gewünschte Revision.')
    if not isinstance(desired['file'], str) or not re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt', desired['file']):
        raise ValueError('Web-Start benötigt ein automatisch vorbereitetes Campus-Schematic.')
    if not isinstance(desired['sha256'], str) or not re.fullmatch('[0-9a-f]{64}', desired['sha256']):
        raise ValueError('Ungültiger SHA256.')
    if desired['owner'] != binding['owner'] or desired['rotation'] != 'none' or desired['mirror'] != 'none':
        raise ValueError('Owner, Rotation oder Spiegelung abweichend.')
    if type(desired['version']) is not int or desired['version'] < 1 or not isinstance(desired['blueprint'], str) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,200}', desired['blueprint']):
        raise ValueError('Ungültige Bauplanrevision.')
    anchor = desired['anchor']
    if not isinstance(anchor, list) or len(anchor) != 3 or any(type(v) is not int or abs(v) > 30000000 for v in anchor) or not -64 <= anchor[1] <= 319:
        raise ValueError('Ungültiger Anker.')
    if binding['dimension'] != 'minecraft:overworld' or math.dist([binding[k] for k in ('x', 'y', 'z')], anchor) >= 256:
        raise ValueError('Bauplan liegt außerhalb der Reichweite.')
    if not isinstance(options, dict) or set(options) != {'replace_mode', 'skip_missing', 'replace_block_entities'} or type(options['replace_mode']) is not int or options['replace_mode'] not in (0, 1, 2) or any(type(options[k]) is not bool for k in ('skip_missing', 'replace_block_entities')):
        raise ValueError('Ungültige Kanonen-Einstellungen.')


def expected_components(desired):
    return {'create:schematic_file': desired['file'], 'create:schematic_owner': desired['owner'],
            'create:schematic_anchor': desired['anchor'], 'create:schematic_rotation': 'none',
            'create:schematic_mirror': 'none', 'create:schematic_deployed': 1}


def verify(bridge, binding, desired, options, observed):
    if observed.get('item') != 'create:schematic' or any(observed.get('components', {}).get(k) != v for k, v in expected_components(desired).items()):
        raise ValueError('Eingelegtes Schematic stimmt nicht mit dem vorbereiteten Bauplan überein.')
    if observed.get('fileHash') != desired['sha256'] or bridge.file_hash(desired['owner'], desired['file']) != desired['sha256']:
        raise ValueError('Schematic-Datei wurde geändert. Start abgelehnt.')
    if observed.get('options') != options:
        raise ValueError('Kanonen-Einstellungen wurden geändert. Start abgelehnt.')
    printer = observed.get('printer')
    if not isinstance(printer, dict) or observed.get('state') not in ('STOPPED', 'PAUSED', 'RUNNING'):
        raise ValueError('Unbekannter Kanonen-/Printer-Zustand.')
    if 'Anchor' in printer and printer['Anchor'] != desired['anchor']:
        raise ValueError('Printer gehört zu einem anderen Bauplan-Anker.')
    if any(type(observed.get(k)) is not int or observed[k] < 0 for k in ('amountPlaced', 'amountToPlace', 'flyingBlocks')):
        raise ValueError('Unbekannte Kanonen-Zähler.')


def start_command(binding, desired, options, observed):
    # Loading updated block NBT makes Create append serialized flights to its
    # existing flight list. A state write must therefore wait until all land.
    if observed['flyingBlocks'] != 0:
        raise ValueError('Noch Blöcke im Flug. Nach der Landung erneut starten oder fortsetzen.')
    pos = ' '.join(str(binding[k]) for k in ('x', 'y', 'z'))
    components = expected_components(desired)
    components['create:schematic_anchor'] = Array('I', desired['anchor'])
    components['create:schematic_deployed'] = True
    guard = {'State': observed['state'], 'AmountPlaced': observed['amountPlaced'], 'AmountToPlace': observed['amountToPlace'], 'FlyingBlocks': [],
             'Options': options, 'Inventory': {'Items': [{'Slot': 0, 'id': 'create:schematic', 'components': components}]}}
    printer = observed['printer']
    suffix = ''
    if observed['state'] == 'STOPPED':
        if observed['amountPlaced'] or observed['amountToPlace'] or observed['flyingBlocks'] or any(k in printer for k in ('Anchor', 'CurrentPos')) or printer.get('DeferredBlocks') != [] or printer.get('EntityProgress') != -1 or printer.get('PrintStage') != 'BLOCKS':
            raise ValueError('Gestoppte Kanone ist noch nicht zurückgesetzt. Kein automatischer Reset.')
        guard['Printer'] = {'DeferredBlocks': [], 'EntityProgress': -1, 'PrintStage': 'BLOCKS'}
        suffix = f' unless data block {pos} Printer.Anchor unless data block {pos} Printer.CurrentPos'
    elif observed['state'] == 'PAUSED':
        if printer.get('Anchor') != desired['anchor']:
            raise ValueError('Pausierte Kanone hat keinen bestätigten Printer-Anker.')
        guard['Printer'] = {'Anchor': Array('I', desired['anchor'])}
        if 'CurrentPos' in printer:
            value = printer['CurrentPos']
            if not isinstance(value, list) or len(value) != 3 or any(type(v) is not int for v in value):
                raise ValueError('Unbekannte Printer-Position.')
            guard['Printer']['CurrentPos'] = Array('I', value)
        else:
            suffix = f' unless data block {pos} Printer.CurrentPos'
    else:
        raise ValueError('Start ist nur aus STOPPED oder PAUSED möglich.')
    command = f'execute in {binding["dimension"]} if block {pos} create:schematicannon{dumps(guard)}{suffix} run data modify block {pos} State set value "RUNNING"'
    if len(command.encode('utf8')) > 950:
        raise ValueError('Startprüfung überschreitet die RCON-Grenze.')
    return command


def start(bridge, binding, desired, options, observed):
    validate_target(binding, desired, options)
    verify(bridge, binding, desired, options, observed)
    if observed['state'] == 'RUNNING':
        if observed['printer'].get('Anchor') != desired['anchor']:
            raise ValueError('Kanone initialisiert noch. Bitte kurz warten.')
        return {'binding': binding, 'observed': observed, 'started': True, 'alreadyRunning': True}
    initial = observed['state'] == 'STOPPED'
    reply = bridge.run(start_command(binding, desired, options, observed))
    if 'Modified block data' not in reply:
        raise ValueError('Kanone während der Startprüfung geändert. Start wurde nicht ausgeführt.')
    deadline = time.monotonic() + 3
    while True:
        current = bridge.inspect(binding)
        verify(bridge, binding, desired, options, current)
        if current['state'] == 'STOPPED':
            raise ValueError('Create hat den Start abgelehnt: ' + str(current.get('status') or 'Kanone gestoppt'))
        if current['printer'].get('Anchor') == desired['anchor']:
            if initial and current['state'] == 'PAUSED' and current.get('status') == 'ready':
                # Create initializes the printer into PAUSED/ready. The same click may
                # continue only this freshly verified plan, with a second atomic guard.
                reply = bridge.run(start_command(binding, desired, options, current))
                if 'Modified block data' not in reply:
                    raise ValueError('Kanone nach Initialisierung geändert. Kein weiterer Start.')
                initial = False
                continue
            return {'binding': binding, 'observed': current, 'started': True, 'alreadyRunning': False,
                    'waiting': current['state'] == 'PAUSED'}
        if time.monotonic() >= deadline:
            raise ValueError('Printer-Initialisierung noch nicht bestätigt. Status prüfen, bevor erneut gestartet wird.')
        time.sleep(.1)
