# Office Web

A standalone, in-browser office suite. Open, edit and save Office documents
entirely in the browser — no Document Server, no backend document processing.
All format conversion runs client-side in a self-compiled `x2t.wasm`.

## Features

- **Open / edit / save** `docx`, `xlsx`, `pptx` in the browser
- **Fully client-side** conversion via a self-compiled WebAssembly build of the
  ONLYOFFICE `x2t` converter
- **No server document storage** — files live in your browser (IndexedDB);
  the server only serves static assets
- **Separate entry pages** per document type, sharing one file library:
  - `/` — home / file library
  - `/docx.html` — document
  - `/xlsx.html` — spreadsheet
  - `/pptx.html` — presentation

## Quick start

### Run locally

```bash
python3 server.py --port 8080 --root web
# open http://localhost:8080/
```

### Run with Docker

```bash
docker build -t office-web .
docker run -d -p 8080:8080 office-web
# open http://localhost:8080/
```

The Docker build pre-compresses assets to brotli.

### Pre-built image

A container image is published to GitHub Container Registry by CI:

```
ghcr.io/wasmtools/office-web:latest
```

## How it works

```
file bytes ──▶ x2t.wasm (docx|xlsx|pptx → bin) ──▶ ONLYOFFICE editor iframe
editor bin ──▶ x2t.wasm (bin → docx|xlsx|pptx) ──▶ IndexedDB / download
```

- The editor is the official ONLYOFFICE Document Server 9.4 frontend running
  in **offline mode** (`document.url = '_offline_'`), with a small
  `offline-shim.js` providing the pieces normally supplied by a Document
  Server (empty-document template, offline license, save/download bridge).
- `x2t.wasm` is compiled from ONLYOFFICE core v9.4.0.131.
- Files are persisted in **IndexedDB** so they survive page reloads. Saving
  writes to the library only; downloading is a separate action via
  **File > Download As**.
- A **← Files** button in the top-left corner returns to the file library
  without reloading the page.

## Repository layout

```
office-web/
├── web/                     # the frontend served to the browser
│   ├── index.html           # home / file library
│   ├── docx.html            # entry pages (per type)
│   ├── xlsx.html
│   ├── pptx.html
│   ├── app.js               # standalone app logic (open/edit/save)
│   ├── store.js             # IndexedDB file library
│   ├── assets/              # favicon + empty document templates
│   └── vendor/              # ONLYOFFICE frontend + x2t.wasm + fonts
├── server.py                # minimal static server (brotli/gzip)
├── precompress.py           # build-time brotli pre-compression
├── Dockerfile
└── .github/workflows/build.yaml
```

## Notes

- **Legacy formats** (`doc`, `ppt`, `csv`) can be opened; on save they are
  written back as their modern equivalents (`docx`, `pptx`, `xlsx`) because
  the open-source converter has no legacy writers.
- **PDF** support was removed: PDF editing and saving had serious issues.
  PDF files are rejected with a message at open time.

## License

ONLYOFFICE core / web-apps / sdkjs are AGPL-3.0, copyright Ascensio System
SIA. The integration layer in this repository (app.js, store.js, server.py,
offline shims) is provided under AGPL-3.0 as a derivative of AGPL code. See
[LICENSE](LICENSE).
