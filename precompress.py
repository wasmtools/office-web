#!/usr/bin/env python3
"""
precompress.py — pre-compress static assets to brotli (build/deploy time).

The server prefers a pre-compressed <file>.br when the client sends
"Accept-Encoding: br", giving brotli compression ratios with zero runtime
CPU cost. brotli beats gzip by ~4-6% for fonts/JS/CSS.

Usage:
    python3 precompress.py --root <web_dir> [--min-size 4096] [--quiet]

Skips already-compressed formats (png/jpg/webp/gif/woff/woff2) and *.br
itself. Requires the python brotli module (pip install brotli); falls back
to the system brotli command if the module is missing.
"""
import argparse
import os
import subprocess
import sys

COMPRESSIBLE = {
    '.js', '.mjs', '.css', '.html', '.json', '.svg', '.wasm',
    '.ttf', '.otf', '.ttc', '.bin', '.txt', '.xml', '.map',
}
SKIP = {'.png', '.jpg', '.jpeg', '.webp', '.gif', '.woff', '.woff2', '.br', '.ico', '.pdf'}

try:
    import brotli
    HAVE_BROTLI = True
except ImportError:
    HAVE_BROTLI = False


def compress_file(path):
    """Compress path to path.br. Returns (orig_size, comp_size) or None."""
    with open(path, 'rb') as f:
        data = f.read()
    if HAVE_BROTLI:
        comp = brotli.compress(data, quality=6)
    else:
        proc = subprocess.run(['brotli', '-q', '6', '-c', path],
                              capture_output=True)
        if proc.returncode != 0:
            return None
        comp = proc.stdout
    if len(comp) >= len(data):
        return None
    with open(path + '.br', 'wb') as f:
        f.write(comp)
    return len(data), len(comp)


def main():
    ap = argparse.ArgumentParser(description='Pre-compress static assets to brotli')
    ap.add_argument('--root', default='.')
    ap.add_argument('--min-size', type=int, default=4096,
                    help='skip files smaller than this many bytes')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f'root not found: {root}', file=sys.stderr)
        sys.exit(1)

    total_orig = total_comp = 0
    count = skipped = 0
    for dirpath, dirnames, filenames in os.walk(root):
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if fn.endswith('.br') or ext in SKIP or ext not in COMPRESSIBLE:
                continue
            path = os.path.join(dirpath, fn)
            if os.path.getsize(path) < args.min_size:
                skipped += 1
                continue
            res = compress_file(path)
            if res:
                orig, comp = res
                total_orig += orig
                total_comp += comp
                count += 1
                if not args.quiet:
                    rel = os.path.relpath(path, root)
                    print(f'{orig:>10} -> {comp:>9} ({100*comp//orig}%)  {rel}')
            else:
                skipped += 1

    if total_orig:
        saved = 100 * (total_orig - total_comp) // total_orig
        print(f'precompressed {count} files, '
              f'{total_orig} -> {total_comp} bytes ({saved}% saved), '
              f'skipped {skipped} (small or no gain)')
    else:
        print('nothing to compress')


if __name__ == '__main__':
    main()
