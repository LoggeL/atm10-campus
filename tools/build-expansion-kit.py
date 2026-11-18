"""Package the installer, the matching Campus feeder and the surveyed expansion."""
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT=Path(__file__).resolve().parents[1]


def build():
    def contents(path):
        return (ROOT/path).read_text(encoding="utf-8")

    tracker=contents("controller/kubejs/erebor-target-chunks.js")
    first="  // BEGIN campus expansion groups"
    last="  // END campus expansion groups"
    start=tracker.index(first)
    end=tracker.index(last,start)+len(last)
    assert tracker.count(first)==tracker.count(last)==1
    files={
        "install.py":contents("tools/expansion-install.py"),
        "fleet.py":contents("src/erebor-fleet/install.py"),
        "expansion-groups.json":contents("src/erebor-fleet/expansion-groups.json"),
        "campus_erebor_expansion.py":contents("controller/campus_erebor.py"),
        "extra-tracker.js":tracker[start:end]+"\n",
        "campus.lua":contents("public/cc/campus.lua").replace("-- EMBED_EREBOR_ME_WORKER",contents("public/assets/erebor-chisel-order.lua")),
    }
    with ZipFile(ROOT/"public/assets/erebor-ausbau-18.zip","w") as bundle:
        for name,content in sorted(files.items()):
            entry=ZipInfo(name,(2026,11,18,0,0,0))
            entry.create_system=3
            entry.external_attr=0o100644<<16
            bundle.writestr(entry,content.encode(),compress_type=ZIP_DEFLATED)


if __name__=="__main__":
    build()
