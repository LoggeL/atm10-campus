#!/usr/bin/env python3
"""Turn the image-gen sources in assets-src/ into viewer assets.

assets-src/textures/<material>.png (large, roughly seamless) -> public/viewer/textures/<material>.png (64x64,
greyscale, edges blended so they tile, alpha cut-out for leaves/plant).
assets-src/hero.png -> public/viewer/hero.webp

The viewer normalises brightness itself (atlas.js), so only size, tiling and alpha are handled here.
Usage: python3 tools/build-textures.py
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageOps

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'assets-src', ROOT / 'public' / 'viewer'
SIZE = 64
CUTOUT = {'leaves': 34, 'plant': 34}  # luminance threshold on the black background


def tileable(img: Image.Image, band: float = 0.12) -> Image.Image:
    """Blend a band around the edges with the half-shifted copy so opposite edges match."""
    w, h = img.size
    shifted = ImageChops.offset(img, w // 2, h // 2)
    b = max(1, int(min(w, h) * band))
    mask = Image.new('L', (w, h), 255)
    px = mask.load()
    for y in range(h):
        for x in range(w):
            d = min(x, y, w - 1 - x, h - 1 - y)
            if d < b:
                px[x, y] = int(255 * d / b)
    return Image.composite(img, shifted, mask)


def build_texture(src: Path) -> None:
    name = src.stem
    img = Image.open(src).convert('RGB')
    side = min(img.size)
    img = ImageOps.fit(img, (side, side))
    grey = ImageOps.grayscale(img)
    if name in CUTOUT:
        small = grey.resize((SIZE, SIZE), Image.Resampling.BOX)
        alpha = small.point(lambda v: 255 if v > CUTOUT[name] else 0)
        out = Image.merge('RGBA', (small, small, small, alpha))
    else:
        grey = tileable(grey.resize((SIZE * 4, SIZE * 4), Image.Resampling.LANCZOS))
        small = grey.resize((SIZE, SIZE), Image.Resampling.BOX)
        out = Image.merge('RGBA', (small, small, small, Image.new('L', small.size, 255)))
    dst = OUT / 'textures' / f'{name}.png'
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, optimize=True)
    print(f'{dst.relative_to(ROOT)}  {dst.stat().st_size} B')


def main() -> None:
    for src in sorted((SRC / 'textures').glob('*.png')):
        build_texture(src)
    hero = SRC / 'hero.png'
    if hero.exists():
        dst = OUT / 'hero.webp'
        Image.open(hero).convert('RGB').resize((1536, 1024), Image.Resampling.LANCZOS).save(dst, 'WEBP', quality=78, method=6)
        print(f'{dst.relative_to(ROOT)}  {dst.stat().st_size} B')


if __name__ == '__main__':
    main()
