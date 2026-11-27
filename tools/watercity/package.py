from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

directory=Path(__file__).resolve().parent
repo=directory.parents[1]
files={"__main__.py":directory/"run.py","legacy.py":repo/"tools/p02/install.py",
       "host.py":repo/"src/erebor-fleet/install.py","feeder.lua":directory/"feeder.lua"}
for module in ("campus_cannon","campus_discovery","campus_erebor","campus_probe","campus_schematic","campus_snbt","campus_start"):
    files[module+".py"]=repo/"controller"/(module+".py")
with ZipFile(repo/"public/assets/wasserstadt-dauerbetrieb.pyz","w") as archive:
    for name,path in sorted(files.items()):
        info=ZipInfo(name,(2026,1,1,0,0,0))
        info.create_system=3
        info.external_attr=0o644<<16
        archive.writestr(info,path.read_bytes().replace(b'\r\n',b'\n'),compress_type=ZIP_DEFLATED)
