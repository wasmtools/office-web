#!/usr/bin/env python3
"""
server.py — minimal static file server for the standalone office editor.

Serves the web/ directory. There is no document protocol here: files are
opened, edited and saved entirely in the browser (IndexedDB + downloads),
so this server only needs to deliver static assets efficiently.

  - Serves pre-compressed *.br when the client sends "Accept-Encoding: br".
  - Falls back to on-the-fly gzip otherwise.
  - Correct MIME types for wasm/js/fonts.

Usage:
    python3 server.py [--port 8080] [--root web]
"""
import argparse
import gzip
import io
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

MIME_OVERRIDES = {
    '.wasm': 'application/wasm',
    '.js':   'application/javascript',
    '.mjs':  'application/javascript',
    '.json': 'application/json',
    '.bin':  'application/octet-stream',
    '.ttf':  'font/ttf',
    '.otf':  'font/otf',
    '.ttc':  'font/collection',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.pdf':  'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

# cache gzip results for large files so repeated requests are cheap
_GZIP_CACHE = {}
_GZIP_CACHE_MAX = 64


class StaticHandler(SimpleHTTPRequestHandler):
    root = '.'

    def translate_path(self, path):
        # SimpleHTTPRequestHandler.translate_path uses os.getcwd(); anchor to root
        import posixpath
        import urllib.parse
        path = path.split('?', 1)[0].split('#', 1)[0]
        try:
            path = urllib.parse.unquote(path, errors='surrogatepass')
        except UnicodeDecodeError:
            path = urllib.parse.unquote(path)
        path = posixpath.normpath(path)
        parts = [p for p in path.split('/') if p not in ('', '.', '..')]
        result = self.root
        for p in parts:
            result = os.path.join(result, p)
        return result

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME_OVERRIDES.get(ext, super().guess_type(path))

    def do_GET(self):
        fs_path = self.translate_path(self.path)
        if os.path.isdir(fs_path):
            # serve index.html for directory requests
            idx = os.path.join(fs_path, 'index.html')
            if os.path.isfile(idx):
                fs_path = idx
            else:
                self.send_error(404, 'Not Found')
                return
        if not os.path.isfile(fs_path):
            self.send_error(404, 'Not Found')
            return

        accept_enc = self.headers.get('Accept-Encoding', '')
        # 1) pre-compressed brotli
        if 'br' in accept_enc and os.path.isfile(fs_path + '.br'):
            self._serve_file(fs_path + '.br', self.guess_type(fs_path), 'br')
            return
        # 2) on-the-fly gzip for compressible text/binary
        if 'gzip' in accept_enc and self._compressible(fs_path):
            self._serve_gzip(fs_path)
            return
        # 3) plain
        self._serve_file(fs_path, self.guess_type(fs_path), None)

    def _compressible(self, path):
        ext = os.path.splitext(path)[1].lower()
        return ext in ('.js', '.mjs', '.css', '.html', '.json', '.svg', '.wasm',
                       '.ttf', '.otf', '.ttc', '.bin', '.txt', '.xml')

    def _serve_file(self, path, ctype, encoding):
        try:
            with open(path, 'rb') as f:
                body = f.read()
        except OSError:
            self.send_error(404, 'Not Found')
            return
        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        if encoding:
            self.send_header('Content-Encoding', encoding)
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def _serve_gzip(self, path):
        mtime = os.path.getmtime(path)
        key = (path, mtime)
        body = _GZIP_CACHE.get(key)
        if body is None:
            try:
                with open(path, 'rb') as f:
                    raw = f.read()
            except OSError:
                self.send_error(404, 'Not Found')
                return
            buf = io.BytesIO()
            with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=6) as gz:
                gz.write(raw)
            body = buf.getvalue()
            if len(_GZIP_CACHE) >= _GZIP_CACHE_MAX:
                _GZIP_CACHE.pop(next(iter(_GZIP_CACHE)))
            _GZIP_CACHE[key] = body
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        # quiet by default; uncomment for access logs
        # sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))
        pass


def main():
    ap = argparse.ArgumentParser(description='Static server for the office editor')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--root', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'web'))
    args = ap.parse_args()

    root = os.path.abspath(args.root)
    if not os.path.isdir(root):
        print(f'root not found: {root}', file=sys.stderr)
        sys.exit(1)

    StaticHandler.root = root
    httpd = ThreadingHTTPServer(('0.0.0.0', args.port), StaticHandler)
    print(f'Serving {root} on http://0.0.0.0:{args.port}')
    print(f'Open http://localhost:{args.port}/')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
