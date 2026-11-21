import hashlib
import json
from pathlib import Path
import runpy
import sys
from tempfile import TemporaryDirectory
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
from uuid import UUID


ASSETS = Path(__file__).resolve().parents[1] / 'public/assets'
extension = SimpleNamespace(**runpy.run_path(str(ASSETS / 'erebor-k10-hangmodus.py')))


class K10Groves(unittest.TestCase):
    def test_install_is_repeatable_and_restores_both_modules_on_failed_restart(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            host = root / 'discord'
            host.mkdir()
            live = root / 'data/kubejs/server_scripts/campus/erebor-target-chunks.js'
            live.parent.mkdir(parents=True)
            live.write_text('surfaceModeTracker:1')
            paths = {host / 'campus_baufolge.py': ASSETS / 'erebor-baufolge.py',
                     host / 'campus_surface_mode.py': ASSETS / 'erebor-aussenhaut-modus.py'}
            for p, src in paths.items():
                p.write_bytes(src.read_bytes())
            dummy = {'fcntl': SimpleNamespace(flock=Mock(), LOCK_EX=2, LOCK_NB=4),
                     'campus_interior': SimpleNamespace(atomic=lambda p,b,m:p.write_bytes(b))}
            with (patch.dict(sys.modules, dummy), patch.object(sys, 'path', sys.path.copy()),
                  patch('os.open', return_value=42), patch('os.close'), patch('subprocess.run') as run):
                run.side_effect = [None, RuntimeError('restart'), None]
                with self.assertRaisesRegex(RuntimeError, 'restart'):
                    extension.install(root)
                for p, src in paths.items():
                    self.assertEqual(p.read_bytes(), src.read_bytes())
                self.assertFalse((host / 'campus_k10_groves.py').exists())
                run.side_effect = None
                extension.install(root)
                run.reset_mock()
                extension.install(root)
                self.assertFalse(any('restart' in args[0][0] for args in run.call_args_list))

    def test_tracker_then_guarded_start(self):
        rules, tracker = extension.update_modules(
            (ASSETS / 'erebor-baufolge.py').read_text('utf-8'),
            (ASSETS / 'erebor-aussenhaut-modus.py').read_text('utf-8'))
        self.assertEqual(extension.update_modules(rules, tracker), (rules, tracker))
        station = Mock(return_value={'cannon': [-922, 79, -10400]})
        start = Mock(return_value={'started': True})
        modules = {
            'fcntl': SimpleNamespace(),  # The Linux installation lock is outside this runtime test.
            'campus_k10_groves': extension,
            'campus_interior': SimpleNamespace(atomic=lambda p, data, mode: p.write_bytes(data)),
            'campus_erebor': SimpleNamespace(validate_clear=Mock()),
            'campus_urns_v2': SimpleNamespace(urn_station=station),
            'campus_schematic': SimpleNamespace(prepare_schematic=Mock()),
            'campus_start': SimpleNamespace(validate_target=Mock(), start=start),
        }
        with TemporaryDirectory() as tmp, patch.dict(sys.modules, modules):
            base = Path(tmp)
            cfg = base / 'data/kubejs/config'
            cfg.mkdir(parents=True)
            (base / 'erebor-stations.json').write_text('{"version":12}')
            bridge = Mock(base=base)
            bridge.inspect.return_value = {'components': {'create:schematic_bounds': [32]*3}}
            r = {'__file__': str(base / 'campus_baufolge.py')}
            t = {'__file__': str(base / 'campus_surface_mode.py')}
            exec(rules, r)
            exec(tracker, t)
            rows = {}
            hashes = {}
            for key, (pos, file, sha) in extension.GROVES.items():
                x, y, z = pos
                name = f'EREBOR_E01_AUSBAU_BAU_K10_X{x}_Y{y}_Z{z}_R5'
                digest = bytearray(hashlib.sha256(f'{name}.nbt\n{sha}'.encode()).digest()[:16])
                digest[6] = 128 | (digest[6] & 15)
                digest[8] = 128 | (digest[8] & 63)
                self.assertEqual(file, f'campus_{UUID(bytes=bytes(digest))}.nbt')
                rows[key] = dict(upload=file, anchor=list(pos), size=[32]*3, aligned=True, owner='Erebor')
                hashes[file] = sha
                bridge.file_hash.side_effect = lambda owner, f: hashes.get(f)
                desired = dict(file=file, sha256=sha, blueprint=name, anchor=list(pos), version=12)
                op = dict(site=key, version=12, kind='build', size=[32]*3, desired=desired)
                handle = r['wrap'](Mock())
                handle(bridge, 'erebor-start', op)
                self.assertEqual(start.call_args.args[3], dict(replace_mode=0, skip_missing=False, replace_block_entities=False))
                handle(bridge, 'erebor-start', dict(op, site='K10H'))
                self.assertEqual(start.call_args.args[3]['replace_mode'], 2)
                self.assertFalse(extension.grove_input(key, list(pos), file, '0'*64))
                self.assertFalse(extension.grove_input(key, [0, 0, 0], file, sha))
                self.assertFalse(extension.grove_input(key, list(pos), file, sha, 'other'))
            rows['K10H'] = rows['K10G']
            report = dict(at=time.time()*1000, stations=rows)
            handle = t['wrap'](lambda *args: report)
            handle(bridge, 'erebor-live', {})
            records = json.loads((cfg / t['REGISTRY']).read_text())
            self.assertEqual(set(records), {'K10G', 'K10I'})
            self.assertEqual(records['K10I']['file'], rows['K10I']['upload'])


if __name__ == '__main__':
    unittest.main()
