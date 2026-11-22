"""One-time operator action for the 29 measured obsolete Erebor tree inputs."""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from uuid import UUID
from zipfile import ZipFile


def upload(name, sha):
    data = bytearray(hashlib.sha256((name + '.nbt\n' + sha).encode()).digest()[:16])
    data[6], data[8] = 128 | (data[6] & 15), 128 | (data[8] & 63)
    return 'campus_' + str(UUID(bytes=bytes(data))) + '.nbt'


def commands(row):
    coords = ' '.join(str(n) for n in row['pos'])
    anchor = '[I;' + ','.join(str(n) for n in row['anchor']) + ']'
    here = 'execute in minecraft:overworld positioned ' + coords + ' if loaded ~ ~ ~'
    if row['reason'] not in ('missingBlock','missingItem') or row['leaf'] not in (
            'minecraft:oak_leaves','minecraft:birch_leaves','minecraft:spruce_leaves'):
        raise ValueError('Abweichender Materialstopp')
    state = 'State:"PAUSED",Status:"' + row['reason'] + '",FlyingBlocks:[],MissingItem:{id:"' + row['leaf'] + '"}'
    components = ('"create:schematic_owner":"Erebor","create:schematic_file":"' + row['old'] +
                  '","create:schematic_anchor":' + anchor + ',"create:schematic_bounds":[I;32,32,32],'
                  '"create:schematic_rotation":"none","create:schematic_mirror":"none"')
    item = '{Slot:0b,id:"create:schematic",components:{' + components + '}}'
    old = here + ' if block ~ ~ ~ create:schematicannon{' + state + ',Inventory:{Items:[' + item + ']}}'
    receipt = 'campus:sapling_exchange ' + row['slot'].lower()
    # Keep a copy of the original item and require that exact copy on the server thread.
    save = old + ' run data modify storage ' + receipt + ' set from block ~ ~ ~ Inventory.Items[{Slot:0b}]'
    remove = old + ' if data storage ' + receipt + item + ' run data remove block ~ ~ ~ Inventory.Items[{Slot:0b}]'
    # A paper in the output can prevent Create from changing missingBlock to idle.
    # This follow-up only accepts an empty input, the previous printer anchor and the saved item.
    reset = (here + ' unless data block ~ ~ ~ Inventory.Items[{Slot:0b}] if data storage ' + receipt + item +
             ' if block ~ ~ ~ create:schematicannon{' + state + ',Printer:{Anchor:' + anchor +
             '}} run data merge block ~ ~ ~ {State:"STOPPED",Status:"idle"}')
    return save, remove, reset


def run(base, rows, setup):
    sys.path.insert(0, str(base / 'discord'))
    from campus_urns_v2 import container_for
    root = base / 'data/schematics/uploaded/Erebor'
    container = container_for(base)
    setup.install(base)
    for row in rows:
        file = root / row['old']
        if not re.fullmatch(r'campus_[0-9a-f-]{36}\.nbt', row['old']) or file.is_symlink() or not file.is_file():
            print(row['slot'], 'übersprungen – ursprünglicher Upload fehlt')
            continue
        if upload(row['name'], hashlib.sha256(file.read_bytes()).hexdigest()) != row['old']:
            raise ValueError('Abweichender ursprünglicher Dateiinhalt bei ' + row['slot'])
        output = []
        for cmd in commands(row):
            if len(cmd.encode()) > 950:
                raise ValueError('Zu langer Minecraft-Befehl')
            answer = subprocess.check_output(['docker', 'exec', container, 'rcon-cli', cmd],
                                             text=True, timeout=25).strip()
            if re.search(r'(?i)unknown or incomplete|incorrect argument|expected .* at position', answer):
                raise ValueError(row['slot'] + ': ' + answer)
            output.append(answer)
        print(row['slot'], output[1] or 'kein bestätigter Eingabewechsel')


if __name__ == '__main__':
    with ZipFile(sys.argv[0]) as bundle, tempfile.TemporaryDirectory() as folder:
        module = Path(folder) / 'campus_grove_setup.py'
        module.write_bytes(bundle.read('campus_grove_setup.py'))
        spec = importlib.util.spec_from_file_location('campus_grove_setup', module)
        setup = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(setup)
        run(Path.home() / 'minecraft/atm10', json.loads(bundle.read('revisions.json')), setup)
