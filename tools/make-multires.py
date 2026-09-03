#!/usr/bin/env python3
"""
Convert equirectangular panoramas into Marzipano multiresolution cube tiles.

    python tools/make-multires.py                      # convert every source image
    python tools/make-multires.py 006 013              # convert only these
    python tools/make-multires.py --face-size 1024     # smaller/faster output

Input :  assets/source-panoramas/NNN.jpg      (2:1 equirectangular, untouched)
Output:  assets/panoramas/multires/sceneNN/
             preview.jpg          6-face vertical strip, order b d f l r u
             0/<face>/0/0.jpg     512px face,  single tile   (fallback level)
             1/<face>/<y>/<x>.jpg 1024px face, 2x2 tiles
             2/<face>/<y>/<x>.jpg 2048px face, 4x4 tiles

Then point the scene at the tiles in config/tour.json:

    "panorama": {
      "type": "multires",
      "path": "assets/panoramas/multires/scene06",
      "faceSize": 2048,
      "tileSize": 512
    }

Requires: pillow, numpy   ->   pip install pillow numpy
"""

import argparse
import math
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # 8192x4096 panoramas trip the decompression guard

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
SOURCE_DIR = os.path.join(PROJECT, 'assets', 'source-panoramas')
OUTPUT_DIR = os.path.join(PROJECT, 'assets', 'panoramas', 'multires')

# Marzipano cube faces. For each face: the direction its centre points at, and
# the world-space vectors that its local +x (right) and +y (up) map to.
# Axes: +x right, +y up, -z forward. Yaw 0 looks down -z, which is the centre
# column of the equirectangular source.
FACES = {
    'f': ((0, 0, -1), (1, 0, 0),  (0, 1, 0)),
    'b': ((0, 0, 1),  (-1, 0, 0), (0, 1, 0)),
    'l': ((-1, 0, 0), (0, 0, -1), (0, 1, 0)),
    'r': ((1, 0, 0),  (0, 0, 1),  (0, 1, 0)),
    'u': ((0, 1, 0),  (1, 0, 0),  (0, 0, 1)),
    'd': ((0, -1, 0), (1, 0, 0),  (0, 0, -1)),
}

# Order Marzipano expects inside the preview strip (its default face order).
PREVIEW_FACE_ORDER = 'bdflru'


def render_face(equirect, face, size):
    """Render one cube face from the equirectangular image with bilinear sampling."""
    forward, right, up = (np.array(v, dtype=np.float32) for v in FACES[face])

    # Pixel centres mapped to [-1, 1]; +y is up, so the image row order flips.
    axis = (np.arange(size, dtype=np.float32) + 0.5) * (2.0 / size) - 1.0
    fx, fy = np.meshgrid(axis, -axis)

    direction = (forward[None, None, :]
                 + fx[:, :, None] * right[None, None, :]
                 + fy[:, :, None] * up[None, None, :])
    direction /= np.linalg.norm(direction, axis=2, keepdims=True)

    yaw = np.arctan2(direction[:, :, 0], -direction[:, :, 2])
    pitch = np.arcsin(np.clip(direction[:, :, 1], -1.0, 1.0))

    src_h, src_w = equirect.shape[:2]
    # Continuous source coordinates, then shift to pixel-centre space.
    u = (yaw / (2.0 * math.pi) + 0.5) * src_w - 0.5
    v = (0.5 - pitch / math.pi) * src_h - 0.5

    x0 = np.floor(u).astype(np.int32)
    y0 = np.floor(v).astype(np.int32)
    tx = (u - x0).astype(np.float32)[:, :, None]
    ty = (v - y0).astype(np.float32)[:, :, None]

    # Wrap horizontally (the panorama is seamless), clamp vertically (poles).
    x0w = np.mod(x0, src_w)
    x1w = np.mod(x0 + 1, src_w)
    y0c = np.clip(y0, 0, src_h - 1)
    y1c = np.clip(y0 + 1, 0, src_h - 1)

    p00 = equirect[y0c, x0w].astype(np.float32)
    p10 = equirect[y0c, x1w].astype(np.float32)
    p01 = equirect[y1c, x0w].astype(np.float32)
    p11 = equirect[y1c, x1w].astype(np.float32)

    top = p00 + (p10 - p00) * tx
    bottom = p01 + (p11 - p01) * tx
    pixels = top + (bottom - top) * ty

    return Image.fromarray(np.clip(pixels + 0.5, 0, 255).astype(np.uint8), 'RGB')


def write_tiles(face_image, out_dir, face, tile_size, quality):
    """Split one rendered face into tile_size squares as {y}/{x}.jpg."""
    size = face_image.width
    tiles = max(1, size // tile_size)
    for y in range(tiles):
        row_dir = os.path.join(out_dir, face, str(y))
        os.makedirs(row_dir, exist_ok=True)
        for x in range(tiles):
            box = (x * tile_size, y * tile_size,
                   (x + 1) * tile_size, (y + 1) * tile_size)
            face_image.crop(box).save(
                os.path.join(row_dir, f'{x}.jpg'), quality=quality, optimize=True)


def convert(source_path, scene_id, face_size, tile_size, quality):
    print(f'  {os.path.basename(source_path)} -> {scene_id}', flush=True)

    with Image.open(source_path) as img:
        equirect = np.asarray(img.convert('RGB'))

    scene_dir = os.path.join(OUTPUT_DIR, scene_id)
    os.makedirs(scene_dir, exist_ok=True)

    # Level sizes double from tile_size up to face_size: 512, 1024, 2048, ...
    sizes = []
    size = tile_size
    while size <= face_size:
        sizes.append(size)
        size *= 2
    if not sizes:
        sizes = [face_size]

    preview_faces = {}

    for face in FACES:
        full = render_face(equirect, face, face_size)
        for level_index, level_size in enumerate(sizes):
            level_image = (full if level_size == face_size
                           else full.resize((level_size, level_size), Image.LANCZOS))
            write_tiles(level_image, os.path.join(scene_dir, str(level_index)),
                        face, tile_size, quality)
            if level_index == 0:
                preview_faces[face] = level_image

    # Preview: the six smallest faces stacked vertically in Marzipano's order.
    preview_size = sizes[0]
    preview = Image.new('RGB', (preview_size, preview_size * 6))
    for i, face in enumerate(PREVIEW_FACE_ORDER):
        preview.paste(preview_faces[face], (0, i * preview_size))
    preview.save(os.path.join(scene_dir, 'preview.jpg'), quality=quality, optimize=True)

    levels = ', '.join(f'{s}px' for s in sizes)
    print(f'    levels: {levels}   tiles/face/level: '
          f'{[max(1, s // tile_size) ** 2 for s in sizes]}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('names', nargs='*',
                        help='source file numbers to convert, e.g. 006 013 (default: all)')
    parser.add_argument('--face-size', type=int, default=2048,
                        help='pixels per cube face at full resolution (default 2048)')
    parser.add_argument('--tile-size', type=int, default=512,
                        help='tile edge in pixels (default 512)')
    parser.add_argument('--quality', type=int, default=85, help='JPEG quality (default 85)')
    args = parser.parse_args()

    if not os.path.isdir(SOURCE_DIR):
        sys.exit(f'Source folder not found: {SOURCE_DIR}')

    sources = sorted(f for f in os.listdir(SOURCE_DIR) if f.lower().endswith('.jpg'))
    if args.names:
        wanted = {n.split('.')[0] for n in args.names}
        sources = [f for f in sources if os.path.splitext(f)[0] in wanted]
        if not sources:
            sys.exit(f'No source images matched {sorted(wanted)}')

    print(f'Converting {len(sources)} panorama(s) at {args.face_size}px/face '
          f'into {OUTPUT_DIR}')
    for filename in sources:
        # 006.jpg -> scene06 : scene ids follow the source file numbers.
        number = os.path.splitext(filename)[0]
        scene_id = f'scene{int(number):02d}'
        convert(os.path.join(SOURCE_DIR, filename), scene_id,
                args.face_size, args.tile_size, args.quality)

    print('\nDone. Update the scene(s) in config/tour.json, for example:')
    print('  "panorama": {')
    print('    "type": "multires",')
    print(f'    "path": "assets/panoramas/multires/<sceneId>",')
    print(f'    "faceSize": {args.face_size},')
    print(f'    "tileSize": {args.tile_size}')
    print('  }')


if __name__ == '__main__':
    main()
