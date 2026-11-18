"""Build the K09 Homebox download with its matching controller patch baseline."""
import subprocess
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
BASELINE = "1b8e03afc2d9c6363fed0224cf5a4c94361ecd26"


def build():
    def source(path):
        return (ROOT / path).read_text(encoding="utf-8").encode()

    files = {
        "install.py": source("tools/k09-install.py"),
        "fleet.py": source("src/erebor-fleet/install.py"),
        "k09-groups.json": source("src/erebor-fleet/k09-groups.json"),
        "campus.lua": source("public/cc/campus.lua").replace(
            b"-- EMBED_EREBOR_ME_WORKER", source("public/assets/erebor-chisel-order.lua")
        ),
    }
    for path in ("controller/campus_erebor.py", "controller/kubejs/erebor-target-chunks.js"):
        name = Path(path).name
        files[name] = source(path)
        files["before-" + name] = subprocess.check_output(
            ["git", "-c", "safe.directory=" + ROOT.as_posix(), "-C", str(ROOT), "show", BASELINE + ":" + path]
        )
    with ZipFile(ROOT / "public/assets/erebor-k09-ausbau.zip", "w") as archive:
        for name, data in sorted(files.items()):
            entry = ZipInfo(name, (2026, 11, 18, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED)


if __name__ == "__main__":
    build()
