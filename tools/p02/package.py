"""Rebuild the reproducible zipapp shipped by the Campus static server."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

assets=Path(__file__).resolve().parent
repo=assets.parents[1]
files={"__main__.py":assets/"install.py","feeder.lua":assets/"feeder.lua","host.py":repo/"src/erebor-fleet/install.py"}
for module in ("campus_cannon","campus_discovery","campus_erebor","campus_probe","campus_schematic","campus_snbt","campus_start"):
    files[module+".py"]=repo/"controller"/(module+".py")
with ZipFile(repo/"public/assets/wasserstadt-p02-v1.pyz","w") as out:
    for name,path in sorted(files.items()):
        info=ZipInfo(name,date_time=(2026,1,1,0,0,0))
        info.create_system=3
        info.external_attr=0o644 << 16
        out.writestr(info,path.read_bytes().replace(b'\r\n',b'\n'),compress_type=ZIP_DEFLATED)
