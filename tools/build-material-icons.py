#!/usr/bin/env python3
"""Render material thumbnails from installed Minecraft/mod item models (Pillow).

python tools/build-material-icons.py --minecraft /path/1.21.1.jar --mods /path/mods
No game jars are required by the server; only generated PNGs/catalog are shipped.
Supports the cube, column, stairs and generated-item models in material-items.json.
Unsupported rotated elements or connected-texture layouts fail explicitly.
"""
import argparse
import io
import json
import math
from pathlib import Path
import zipfile
from PIL import Image, ImageChops, ImageDraw, ImageEnhance

ROOT = Path(__file__).resolve().parents[1]
SIZE, SCALE = 96, 3


class Assets:
    def __init__(self, jars):
        self.files, self.zips, self.lang = {}, [], {}
        for path in jars:
            z = zipfile.ZipFile(path)
            self.zips.append(z)
            for name in z.namelist():
                if name.startswith('assets/'):
                    self.files[name] = z
                if name.startswith('assets/') and name.endswith('/lang/en_us.json'):
                    self.lang.update(json.loads(z.read(name)))

    def read(self, path):
        return self.files[path].read(path)

    def model(self, identifier):
        ns, path = identifier.split(':', 1) if ':' in identifier else ('minecraft', identifier)
        if path == 'builtin/generated':
            return {'generated': True}
        data = json.loads(self.read(f'assets/{ns}/models/{path}.json'))
        parent = self.model(data['parent']) if 'parent' in data else {}
        return {**parent, **data, 'textures': {**parent.get('textures', {}), **data.get('textures', {})}}

    def texture(self, name):
        ns, path = name.split(':', 1) if ':' in name else ('minecraft', name)
        path = f'assets/{ns}/textures/{path}.png'
        im = Image.open(io.BytesIO(self.read(path))).convert('RGBA')
        meta = json.loads(self.read(path + '.mcmeta')) if path + '.mcmeta' in self.files else {}
        fusion = meta.get('fusion', {})
        if fusion.get('type') == 'connecting':
            layout = fusion.get('layout', 'full')
            if layout == 'pieced' and im.width == im.height * 5:
                # Fusion pieced tile 0 is the isolated item.
                tile = im.height
            elif layout == 'full' and im.width % 8 == 0 and im.height in (im.width * 6 // 8, im.width):
                # Fusion defaults to FULL: 8 columns, optionally padded to 8 rows.
                # FullLayoutHandler maps no neighbours to tile (0, 0).
                tile = im.width // 8
            else:
                raise ValueError(f'Unsupported connected layout: {path}')
            im = im.crop((0, 0, tile, tile))
        elif 'animation' in meta:
            a = meta['animation']
            w = a.get('width', im.width)
            h = a.get('height', min(im.height, w))
            first = a.get('frames', [0])[0]
            index = first.get('index', 0) if isinstance(first, dict) else first
            x, y = index % (im.width // w) * w, index // (im.width // w) * h
            im = im.crop((x, y, x + w, y + h))
        return im

    def name(self, identifier):
        ns, item = identifier.split(':')
        return next((self.lang[k] for k in (f'block.{ns}.{item}', f'{ns}.block.{item}', f'item.{ns}.{item}', f'{ns}.item.{item}') if k in self.lang), identifier)


def project(p):
    x, y, z = (c - 8 for c in p)
    return ((48 + (x - z) * 2.45) * SCALE, (48 + (x + z) * 1.20 - y * 2.60) * SCALE)


def face_data(face, a, b):
    x0, y0, z0 = a
    x1, y1, z1 = b
    if face == 'up':
        return [(x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)], [x0,z0,x1,z1], 1.0
    if face == 'south':
        return [(x0,y1,z1),(x1,y1,z1),(x1,y0,z1),(x0,y0,z1)], [x0,16-y1,x1,16-y0], .85
    if face == 'east':
        return [(x1,y1,z1),(x1,y1,z0),(x1,y0,z0),(x1,y0,z1)], [16-z1,16-y1,16-z0,16-y0], .68
    return None


def draw_face(canvas, texture, corners):
    # Affine UV mapping onto the projected parallelogram, clipped to its polygon.
    p, q, _, r = corners
    ax, ay = q[0]-p[0], q[1]-p[1]
    bx, by = r[0]-p[0], r[1]-p[1]
    det = ax * by - ay * bx
    if abs(det) < .001:
        return
    w, h = texture.size
    coef = (w*by/det, -w*bx/det, w*(-by*p[0]+bx*p[1])/det,
            -h*ay/det, h*ax/det, h*(ay*p[0]-ax*p[1])/det)
    face = texture.transform(canvas.size, Image.Transform.AFFINE, coef, Image.Resampling.NEAREST)
    mask = Image.new('L', canvas.size)
    ImageDraw.Draw(mask).polygon(corners, fill=255)
    face.putalpha(ImageChops.multiply(face.getchannel('A'), mask))
    canvas.alpha_composite(face)


def render(assets, identifier):
    ns, name = identifier.split(':')
    model = assets.model(f'{ns}:item/{name}')
    textures = model.get('textures', {})
    def resolve(ref):
        seen = set()
        while ref.startswith('#'):
            if ref in seen:
                raise ValueError('Texture reference cycle')
            seen.add(ref)
            ref = textures[ref[1:]]
        return assets.texture(ref)
    canvas = Image.new('RGBA', (SIZE*SCALE, SIZE*SCALE))
    if model.get('generated'):
        tex = resolve(textures['layer0']).resize((72*SCALE,72*SCALE), Image.Resampling.NEAREST)
        canvas.alpha_composite(tex, (12*SCALE,12*SCALE))
    else:
        faces = []
        for element in model.get('elements', []):
            if 'rotation' in element:
                raise ValueError(f'Unsupported rotated element: {identifier}')
            a, b = element['from'], element['to']
            for direction, data in element['faces'].items():
                info = face_data(direction, a, b)
                if info is None:
                    continue
                points, uv, brightness = info
                tex = resolve(data['texture'])
                uv = data.get('uv', uv)
                tex = tex.crop(tuple(round(v / 16 * (tex.width if i%2 == 0 else tex.height)) for i,v in enumerate(uv)))
                if data.get('rotation'):
                    tex = tex.rotate(-data['rotation'], expand=True)
                if 'tintindex' in data:
                    # Standard inventory grass tint, not a world biome sample.
                    tint = Image.new('RGBA', tex.size, (145,189,89,255))
                    tex = ImageChops.multiply(tex, tint)
                alpha = tex.getchannel('A')
                tex = ImageEnhance.Brightness(tex).enhance(brightness)
                tex.putalpha(alpha)
                depth = sum(x + z + y * .923 for x,y,z in points) / 4
                faces.append((depth, tex, [project(p) for p in points]))
        if not faces:
            raise ValueError(f'No supported faces: {identifier}')
        for _, tex, corners in sorted(faces, key=lambda f: f[0]):
            draw_face(canvas, tex, corners)
    return canvas.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--minecraft', required=True, type=Path)
    parser.add_argument('--mods', required=True, type=Path)
    args = parser.parse_args()
    jars = [args.minecraft] + sorted(p for p in args.mods.glob('*.jar') if p.name.startswith(('rechiseled-', 'rechiseledcreate-', 'create-', 'chipped-', 'connectedglass-')))
    assets = Assets(jars)
    items = json.loads((ROOT / 'tools/material-items.json').read_text())
    output = ROOT / 'public/assets/material-icons'
    output.mkdir(parents=True, exist_ok=True)
    catalog = {}
    for item in items:
        filename = item.replace(':', '__') + '.png'
        render(assets, item).save(output / filename, optimize=True)
        catalog[item] = {'name': assets.name(item), 'icon': f'/assets/material-icons/{filename}'}
        if item.endswith('_connecting') or item == 'connectedglass:clear_glass_black':
            catalog[item]['connecting'] = True
        elif item.startswith(('rechiseled:', 'create:polished_cut_')):
            catalog[item]['connecting'] = False
    (output / 'catalog.json').write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'Rendered {len(catalog)} material icons from {len(jars)} game/mod jars.')


if __name__ == '__main__':
    main()
