"""
Cut a sticker sheet (transparent PNG) into one PNG per pose.

Usage:
    python scripts/extract-poses.py <sheet.png> <output_dir> <name1> <name2> ...

Poses are found automatically (connected shapes in the alpha channel), ordered
in reading order (rows top to bottom, left to right), and saved as
<output_dir>/<name>.png. Pass exactly one name per pose; the script stops with
the detected count if they don't match, so you can fix the list.

Requires: pillow, numpy, scipy
"""
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ALPHA_THRESHOLD = 200   # pixels more opaque than this count as "the sticker"
MIN_AREA = 3000         # ignore stray sparkles smaller than this
PADDING = 10            # transparent margin kept around each pose
GLOW = 12               # keep soft edges this many px around the solid shape


def find_poses(alpha):
    mask = ndimage.binary_closing(alpha > ALPHA_THRESHOLD, iterations=6)
    labels = ndimage.label(mask)[0]
    poses = []
    for index, (ys, xs) in enumerate(ndimage.find_objects(labels), 1):
        region = labels == index
        if region[ys, xs].sum() < MIN_AREA:
            continue
        poses.append({'region': region, 'x': xs.start, 'y': ys.start, 'w': xs.stop - xs.start, 'h': ys.stop - ys.start})
    return split_merged(poses, alpha)


def split_merged(poses, alpha):
    """Two stickers that touch become one shape; split unusually wide ones at their emptiest column."""
    median_w = np.median([p['w'] for p in poses])
    result = []
    for p in poses:
        if p['w'] < 1.9 * median_w:
            result.append(p)
            continue
        cols = (alpha[p['y']:p['y'] + p['h'], p['x']:p['x'] + p['w']] > ALPHA_THRESHOLD).sum(axis=0)
        lo, hi = int(p['w'] * 0.3), int(p['w'] * 0.7)
        cut = p['x'] + lo + int(np.argmin(cols[lo:hi]))
        for x0, x1 in ((p['x'], cut), (cut, p['x'] + p['w'])):
            part = np.zeros_like(p['region'])
            part[:, x0:x1] = p['region'][:, x0:x1]
            ys, xs = np.nonzero(part)
            result.append({'region': part, 'x': xs.min(), 'y': ys.min(), 'w': xs.max() - xs.min() + 1, 'h': ys.max() - ys.min() + 1})
    return result


def reading_order(poses):
    poses = sorted(poses, key=lambda p: p['y'] + p['h'] / 2)
    rows, row = [], []
    for p in poses:
        center = p['y'] + p['h'] / 2
        if row and center - (row[0]['y'] + row[0]['h'] / 2) > 120:
            rows.append(row)
            row = []
        row.append(p)
    rows.append(row)
    return [p for r in rows for p in sorted(r, key=lambda p: p['x'])]


def main():
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    sheet_path, out_dir, names = sys.argv[1], sys.argv[2], sys.argv[3:]

    rgba = np.array(Image.open(sheet_path).convert('RGBA'))
    poses = reading_order(find_poses(rgba[..., 3]))
    if len(poses) != len(names):
        sys.exit(f'Found {len(poses)} poses but got {len(names)} names')

    os.makedirs(out_dir, exist_ok=True)
    height, width = rgba.shape[:2]
    for name, p in zip(names, poses):
        keep = ndimage.binary_dilation(p['region'], iterations=GLOW)
        pose = rgba.copy()
        pose[..., 3] = np.where(keep, pose[..., 3], 0)  # erase neighbouring stickers
        x0, y0 = max(p['x'] - PADDING - GLOW, 0), max(p['y'] - PADDING - GLOW, 0)
        x1, y1 = min(p['x'] + p['w'] + PADDING + GLOW, width), min(p['y'] + p['h'] + PADDING + GLOW, height)
        Image.fromarray(pose[y0:y1, x0:x1]).save(os.path.join(out_dir, f'{name}.png'), optimize=True)
        print(f'{name:16} {x1 - x0}x{y1 - y0}')


if __name__ == '__main__':
    main()
