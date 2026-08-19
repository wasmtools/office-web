#!/usr/bin/env python3
"""
extract-fonts.py — extract standard ttf/otf from the ONLYOFFICE font pool.

Background: Document Server's allfontsgen copies standard fonts (ttf/otf/ttc)
into <id> files, then XOR-obfuscates the FIRST 32 BYTES with the correct16 key
(ApplicationFontsWorker.cpp SaveWebFonts). So each <id> file = standard font +
XOR on the first 32 bytes.

This script:
1. XOR-decodes each font file
2. detects ttf / otf(CFF) / ttc(TrueType Collection)
3. reads the family name (name table nameID=1) and builds a
   "font name -> output file" index
4. outputs:
   - <out>/decoded/<id>.<ext>   the decoded standard font file
   - <out>/fonts-index.json     "font name (case-insensitive) -> [files]" index

Usage:
    python3 extract-fonts.py [fonts_dir] [out_dir]
    default fonts_dir=web/vendor/fonts, out_dir=build/fonts
    with --deploy <web_dir> the decoded fonts + index are copied to
    <web_dir>/vendor/decoded-fonts/ (the source app.js fetches on demand).

Purpose: before PDF conversion the frontend parses the font names used by the
render bin, looks them up in fonts-index.json, fetches the matching font on
demand and writes it into the wasm FS — so the PDF uses the same fonts as the
page (WYSIWYG) instead of falling back.
"""

import argparse
import json
import os
import shutil
import struct
import sys

# key (correct16 from ApplicationFontsWorker.cpp SaveWebFonts)
CORRECT16 = bytes([0xA0, 0x66, 0xD6, 0x20, 0x14, 0x96, 0x47, 0xfa,
                   0x95, 0x69, 0xB8, 0x50, 0xB0, 0x41, 0x49, 0x48])


def decode_font(data):
    """XOR the first 32 bytes, returning the restored standard font bytes."""
    d = bytearray(data)
    n = min(32, len(d))
    for k in range(n):
        d[k] ^= CORRECT16[k & 0x0F]
    return bytes(d)


def font_magic(data):
    """Return (magic_str, kind) with kind in {ttf, otf, ttc, unknown}."""
    if data[:4] in (b'\x00\x01\x00\x00', b'true'):
        return 'ttf', 'ttf'
    if data[:4] == b'OTTO':
        return 'otf', 'otf'
    if data[:4] == b'ttcf':
        return 'ttc', 'ttc'
    return data[:4].hex(), 'unknown'


def ttc_faces(data):
    """List of font offsets inside a ttc."""
    num = struct.unpack('>I', data[8:12])[0]
    offs = []
    for i in range(num):
        off = struct.unpack('>I', data[12 + i * 4:16 + i * 4])[0]
        offs.append(off)
    return offs


def read_family_name(data, offset=0):
    """Read the family name (nameID=1) from a ttf/otf name table.

    For ttc pass the face offset.
    """
    try:
        from fontTools.ttLib import TTFont
        import io
        tf = TTFont(io.BytesIO(data[offset:]), lazy=True)
        return tf['name'].getDebugName(1)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser(description='Extract the ONLYOFFICE font pool to standard ttf/otf')
    ap.add_argument('fonts_dir', nargs='?',
                    default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web', 'vendor', 'fonts'))
    ap.add_argument('out_dir', nargs='?', default='build/fonts')
    ap.add_argument('--deploy', help='copy decoded fonts + index to <dir>/vendor/decoded-fonts/')
    args = ap.parse_args()

    fonts_dir = os.path.abspath(args.fonts_dir)
    out_dir = os.path.abspath(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    dec_dir = os.path.join(out_dir, 'decoded')
    os.makedirs(dec_dir, exist_ok=True)

    index = {}   # font name (lowercase) -> [{file, family, kind, size}]
    n_ok = n_skip = 0

    for fname in sorted(os.listdir(fonts_dir)):
        if fname.endswith('.br'):
            continue
        src = os.path.join(fonts_dir, fname)
        try:
            raw = open(src, 'rb').read()
        except OSError:
            continue
        data = decode_font(raw)
        _, kind = font_magic(data)

        ext = {'ttf': 'ttf', 'otf': 'otf', 'ttc': 'ttc'}.get(kind)
        if not ext:
            n_skip += 1
            continue

        # read family names (all faces for ttc)
        families = []
        if kind == 'ttc':
            for off in ttc_faces(data)[:8]:
                fam = read_family_name(data, off)
                if fam:
                    families.append(fam)
        else:
            fam = read_family_name(data)
            if fam:
                families.append(fam)

        out_path = os.path.join(dec_dir, fname + '.' + ext)
        open(out_path, 'wb').write(data)

        entry = {'file': fname, 'kind': kind, 'size': len(data), 'families': families}
        for fam in families:
            key = fam.lower()
            index.setdefault(key, []).append(entry)
        n_ok += 1

    with open(os.path.join(out_dir, 'fonts-index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False, indent=1)

    print(f'decoded {n_ok} fonts, skipped {n_skip} non-font files')
    print(f'indexed {len(index)} font names -> {os.path.join(out_dir, "fonts-index.json")}')
    print(f'decoded files -> {dec_dir}/')

    # deploy into the frontend (the source app.js fetches on demand)
    if args.deploy:
        deploy_dir = os.path.join(os.path.abspath(args.deploy),
                                  'vendor', 'decoded-fonts')
        os.makedirs(deploy_dir, exist_ok=True)
        for fname in os.listdir(dec_dir):
            shutil.copy2(os.path.join(dec_dir, fname), deploy_dir)
        shutil.copy2(os.path.join(out_dir, 'fonts-index.json'), deploy_dir)
        print(f'deployed to {deploy_dir}/ ({len(os.listdir(dec_dir))} fonts + index)')
        # pre-compress (brotli) to shrink on-demand downloads
        try:
            import subprocess
            subprocess.run([sys.executable,
                            os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         'precompress.py'),
                            '--root', deploy_dir, '--min-size', '0', '--quiet'],
                           check=False)
        except Exception:
            pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
