"""Read-only transport: an optional watercity failure must not affect Erebor."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

MODULE = Path(__file__).resolve().parents[1] / 'controller/campus_watercity.py'


class WatercityReadTest(unittest.TestCase):
    def test_signed_report_adds_bounded_native_snapshot_without_any_world_write(self):
        self.assertTrue(MODULE.is_file(), 'watercity reader is not implemented')
        spec = importlib.util.spec_from_file_location('watercity_read', MODULE)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            config = base / 'data/kubejs/config'
            config.mkdir(parents=True)
            manifest = {'version': 12, 'id': 'batch', 'issuedAt': 90000, 'expires': 200000,
                        'jobs': [{'key': 'P01A', 'selectionId': 12, 'desired': {'file': 'upload', 'sha256': 'a' * 64}}]}
            native = {'at': 99000, 'batch': 'batch', 'stations': {'P01A': {'placed': 356, 'total': 1040}},
                      'groups': {'P01': {'authorized': True}}, 'private': 'do not transport'}
            (config / 'watercity-active.json').write_text(json.dumps(manifest))
            (config / 'watercity-live.json').write_text(json.dumps(native))
            disk = base / 'data/world/computercraft/computer/92'
            disk.mkdir(parents=True)
            (disk / '.watercity-supply-report.json').write_text(json.dumps(
                {'at': 99500, 'computerId': 92, 'batch': 'batch', 'ok': True,
                 'result': {'state': 'feeding', 'shortages': {'minecraft:bookshelf': {'inME': 500, 'missing': 24}}}}))
            before = {str(p): p.read_bytes() for p in base.rglob('*') if p.is_file()}
            legacy = {'version': 12, 'at': 99000, 'stations': {'K01': {'placed': 1}}}
            calls = []
            def original(*args):
                calls.append(args)
                return legacy.copy()
            handle = module.with_watercity(original, clock=lambda: 100000)
            report = handle(SimpleNamespace(base=base), 'erebor-live', {'version': 12})
            self.assertEqual(report['stations'], legacy['stations'])
            watercity = report['watercity']
            self.assertEqual(watercity['at'], 99000)
            self.assertEqual(watercity['expires'], 200000)
            self.assertEqual(watercity['jobs'], manifest['jobs'])
            self.assertEqual(watercity['stations']['P01A']['placed'], 356)
            self.assertEqual(watercity['supply']['P01']['computerId'], 92)
            self.assertNotIn('private', watercity)
            self.assertEqual(before, {str(p): p.read_bytes() for p in base.rglob('*') if p.is_file()})
            # An optional malformed/oversized report never disables the original fleet.
            (config / 'watercity-live.json').write_text('x' * 131073)
            rejected = handle(SimpleNamespace(base=base), 'erebor-live', {'version': 12})
            self.assertEqual(rejected['stations'], legacy['stations'])
            self.assertEqual(rejected['watercity']['state'], 'unavailable')
            self.assertNotIn('stations', rejected['watercity'])
            untouched = handle(SimpleNamespace(base=base), 'erebor-inspect', {'site': 'K01', 'version': 12})
            self.assertNotIn('watercity', untouched)
            self.assertEqual(len(calls), 3)
            for bad in ({'at': 99000, 'stations': []}, {'at': 99000, 'stations': {}, 'groups': []}):
                (config / 'watercity-live.json').write_text(json.dumps(bad))
                result = handle(SimpleNamespace(base=base), 'erebor-live', {'version': 12})
                self.assertEqual(result['watercity']['state'], 'unavailable')
            # Native time is retained and cannot be replaced by HTTP time.
            for at in (100001, 55000):
                (config / 'watercity-live.json').write_text(json.dumps({**native, 'at': at}))
                self.assertEqual(handle(SimpleNamespace(base=base), 'erebor-live', {'version': 12})['watercity']['state'], 'unavailable')

    def test_guarded_installer_preserves_the_exact_installed_controller(self):
        import hashlib
        import subprocess
        import sys
        installer = MODULE.parents[1] / 'tools/install-watercity-read.py'
        self.assertTrue(installer.is_file(), 'guarded installer is not implemented')
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'campus_erebor.py'
            original = b'# existing installed wrappers\ndef handle(*args): return {}\n'
            target.write_bytes(original)
            digest = hashlib.sha256(original).hexdigest()
            cmd = [sys.executable, str(installer), '--controller-dir', directory, '--expected-erebor-sha256', digest]
            dry = subprocess.run(cmd, check=True, capture_output=True, text=True)
            self.assertTrue(json.loads(dry.stdout)['dryRun'])
            self.assertEqual(target.read_bytes(), original)
            wrong = subprocess.run([*cmd[:-1], '0' * 64, '--apply'], capture_output=True, text=True)
            self.assertNotEqual(wrong.returncode, 0)
            self.assertEqual(target.read_bytes(), original)
            applied = json.loads(subprocess.run([*cmd, '--apply'], check=True, capture_output=True, text=True).stdout)
            self.assertEqual(Path(applied['backup']).read_bytes(), original)
            self.assertTrue(target.read_bytes().startswith(original))
            self.assertEqual(target.with_name('campus_watercity.py').read_bytes(), MODULE.read_bytes())
            self.assertIn('handle = _with_watercity(handle)', target.read_text())

    def test_source_controller_installs_the_optional_read_wrapper(self):
        source = MODULE.with_name('campus_erebor.py').read_text()
        self.assertIn('from campus_watercity import with_watercity', source)


if __name__ == '__main__':
    unittest.main()
