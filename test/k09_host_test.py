import importlib.util
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "controller"))
import campus_erebor


class K09(unittest.TestCase):
    def test_controller_resolves_only_surveyed_extra_slots(self):
        fleet = ROOT / "src/erebor-fleet"
        config = json.loads((fleet / "k09-groups.json").read_text())
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            for name, deployed in (("stations", "erebor-stations"), ("parallel", "erebor-parallel"), ("k09-groups", "k09-groups")):
                shutil.copyfile(fleet / (name + ".json"), folder / (deployed + ".json"))
            with patch.object(campus_erebor, "__file__", str(folder / "campus_erebor.py")):
                bridge = Mock()
                for group in config["groups"]:
                    for slot, pos in group["slots"].items():
                        campus_erebor.handle(bridge, "erebor-inspect", {"version": 12, "site": "K09" + slot})
                        binding = bridge.inspect.call_args.args[0]
                        self.assertEqual([binding[k] for k in "xyz"], pos)
                    with self.assertRaisesRegex(ValueError, "Materialkiste"):
                        campus_erebor.shared_supply(bridge, config, {"site": "K09"}, {"targets": {"A": {}}}, "", group)
                with self.assertRaisesRegex(ValueError, "Unbekannter"):
                    campus_erebor.handle(bridge, "erebor-inspect", {"version": 12, "site": "K10D"})

    def test_kit_applies_its_actual_delta_twice_and_preserves_local_edits(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            with ZipFile(ROOT / "public/assets/erebor-k09-ausbau.zip") as archive:
                self.assertIsNone(archive.testzip())
                archive.extractall(folder)
            spec = importlib.util.spec_from_file_location("k09_install", folder / "install.py")
            installer = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(installer)
            for name in ("campus_erebor.py", "erebor-target-chunks.js"):
                old = (folder / ("before-" + name)).read_text(encoding="utf-8")
                new = (folder / name).read_text(encoding="utf-8")
                for current in (old, new):
                    self.assertEqual(installer.patched(current + "\n// local change\n", old, new),
                                     new + "\n// local change\n")
                with self.assertRaises(ValueError):
                    installer.patched("foreign content", old, new)
