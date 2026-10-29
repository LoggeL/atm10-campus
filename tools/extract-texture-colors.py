#!/usr/bin/env python3
"""Average colour of every block texture in the given jars/dirs -> JSON {"ns:texture": [r, g, b, alpha]}.
Used to tint the viewer's generated material textures with each block's real colour."""
import io, json, sys, zipfile, re, pathlib
from PIL import Image

PAT = re.compile(r'^assets/([a-z0-9_.-]+)/textures/block/([a-z0-9_./-]+)\.png$')

def average(data):
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    w, h = im.size
    if h > w: im = im.crop((0, 0, w, w))  # animated strip: first frame
    im = im.resize((8, 8), Image.Resampling.BOX)
    px = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else list(im.getdata())
    vis = [p for p in px if p[3] > 24] or px
    n = len(vis)
    return [round(sum(p[i] for p in vis) / n) for i in range(3)] + [round(sum(p[3] for p in px) / len(px))]

out = {}
paths = []
for arg in sys.argv[2:]:
    p = pathlib.Path(arg)
    paths += sorted(p.glob('*.jar')) if p.is_dir() else [p]
for jar in paths:
    try:
        with zipfile.ZipFile(jar) as z:
            for name in z.namelist():
                m = PAT.match(name)
                if not m: continue
                key = f'{m.group(1)}:{m.group(2)}'
                if key in out: continue
                try: out[key] = average(z.read(name))
                except Exception: pass
    except zipfile.BadZipFile:
        pass
json.dump(out, open(sys.argv[1], 'w'), separators=(',', ':'), sort_keys=True)
print(len(out), 'textures from', len(paths), 'jars')
