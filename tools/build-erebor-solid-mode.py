"""Package the two small V5 -> V6 changes without bundling a station survey."""
from difflib import SequenceMatcher
from hashlib import sha256
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
assets = root / "public/assets"
changes = {}
with ZipFile(assets / "erebor-shared-v5.zip") as previous:
    for path in ("controller/campus_erebor.py", "controller/kubejs/erebor-target-chunks.js"):
        name = Path(path).name
        old = previous.read(name).decode().splitlines(keepends=True)
        old = [line.replace("\r\n", "\n") for line in old]
        new = (root / path).read_text(encoding="utf-8").splitlines(keepends=True)
        edits = [[i, j, new[a:b]] for op, i, j, a, b in SequenceMatcher(None, old, new, autojunk=False).get_opcodes() if op != "equal"]
        changes[name] = dict(old=sha256("".join(old).encode()).hexdigest(),
                             new=sha256("".join(new).encode()).hexdigest(), edits=edits)
with ZipFile(assets / "erebor-solid-v6.zip", "w", ZIP_DEFLATED) as archive:
    archive.write(root / "tools/install-erebor-solid-mode.py", "install.py")
    archive.writestr("changes.json", json.dumps(changes, ensure_ascii=False))
