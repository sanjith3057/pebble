"""
Shrink character poses: PNG -> WebP (keeps transparency), capped in height,
and point each manifest.json at the new files.

Usage:
    python scripts/optimize-assets.py [--quality 88] [--max-height 360]

360px is 1.5x the on-screen size (236px), so poses stay sharp on 150% displays.
A PNG is deleted only after its WebP was written and re-opened successfully.
Requires: pillow
"""
import argparse
import json
import os

from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'apps', 'desktop', 'assets', 'characters')


def optimize_character(char_dir, quality, max_height):
    manifest_path = os.path.join(char_dir, 'manifest.json')
    with open(manifest_path, encoding='utf8') as f:
        manifest = json.load(f)

    before = after = 0
    for pose, rel in list(manifest['poses'].items()):
        if not rel.endswith('.png'):
            continue
        src = os.path.join(char_dir, rel)
        dst_rel = rel[:-4] + '.webp'
        dst = os.path.join(char_dir, dst_rel)

        image = Image.open(src).convert('RGBA')
        if image.height > max_height:
            width = round(image.width * max_height / image.height)
            image = image.resize((width, max_height), Image.Resampling.LANCZOS)
        image.save(dst, 'WEBP', quality=quality, method=6, exact=False)

        with Image.open(dst) as check:  # make sure the new file is valid before removing the old one
            check.load()
        before += os.path.getsize(src)
        after += os.path.getsize(dst)
        os.remove(src)
        manifest['poses'][pose] = dst_rel

    with open(manifest_path, 'w', encoding='utf8') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    return before, after


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--quality', type=int, default=88)
    parser.add_argument('--max-height', type=int, default=360)
    args = parser.parse_args()

    total_before = total_after = 0
    for name in sorted(os.listdir(ROOT)):
        char_dir = os.path.join(ROOT, name)
        if os.path.isfile(os.path.join(char_dir, 'manifest.json')):
            before, after = optimize_character(char_dir, args.quality, args.max_height)
            total_before += before
            total_after += after
            if before:
                print(f'{name:10} {before / 1024:7.0f} KB -> {after / 1024:6.0f} KB')
    if total_before:
        print(f'{"total":10} {total_before / 1024:7.0f} KB -> {total_after / 1024:6.0f} KB ({100 - 100 * total_after / total_before:.0f}% smaller)')
    else:
        print('Nothing to optimize (poses are already WebP).')


if __name__ == '__main__':
    main()
