# Office Web

A standalone, in-browser office suite. Open, edit and save Office documents
entirely in the browser — no Document Server, no backend document processing.
All format conversion runs client-side in a self-compiled `x2t.wasm`.

## Features

- **Open / edit / save** `docx`, `xlsx`, `pptx` and `pdf` (view + annotate)
  in the browser
- **Fully client-side** conversion via a self-compiled WebAssembly build of the
  ONLYOFFICE `x2t` converter
- **No server document storage** — files live in your browser (IndexedDB);
  the server only serves static assets
- **Separate entry pages** per document type, sharing one file library:
  - `/` — home / file library
  - `/docx.html` — document
  - `/xlsx.html` — spreadsheet
  - `/pptx.html` — presentation
  - `/pdf.html` — PDF

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

### Test

An end-to-end Playwright test covers the PDF open → annotate → save → merge →
round-trip path (plus a docx save regression):

```bash
python3 server.py --port 8099 --root web &   # in one shell
pip install playwright && playwright install chromium
python3 scripts/e2e-pdf-test.py              # against http://localhost:8099
```

### Pre-built image

A container image is published to GitHub Container Registry by CI:

```
ghcr.io/wasmtools/office-web:latest
```

## How it works

```
file bytes ──▶ x2t.wasm (docx|xlsx|pptx → bin) ──▶ ONLYOFFICE editor iframe
editor bin ──▶ x2t.wasm (bin → docx|xlsx|pptx) ──▶ IndexedDB / download
raw PDF    ──▶ pdfeditor (native format, no bin round-trip)
PDF save   ──▶ x2t.wasm (base PDF + compiled changes → merged PDF)
```

- **PDF editing** is two-stage, mirroring the Document Server's
  collaborative save: `file.getFileBinary()` returns the original base PDF,
  `DocumentRenderer.Save()` returns the compiled changes stream
  (annotations, forms, page edits). The self-compiled `x2t.wasm` merges the
  two (`main1` + `<m_bFromChanges>true</m_bFromChanges>`, the same code path
  Document Server uses in `CPdfFile::AddToPdfFromBinary`). With no edits the
  changes stream is empty and the base PDF is saved as-is.

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
├── scripts/e2e-pdf-test.py  # Playwright end-to-end test
├── testfiles/               # sample documents for the e2e test
├── Dockerfile
└── .github/workflows/build.yaml
```

## Notes

- **Legacy formats** (`doc`, `ppt`, `csv`) can be opened; on save they are
  written back as their modern equivalents (`docx`, `pptx`, `xlsx`) because
  the open-source converter has no legacy writers.
- **x2t.wasm download**: the 36 MB converter is downloaded with a progress
  indicator on first visit, then stored in the browser **Cache API** keyed by
  the build version, so later visits load it instantly. Bump `BUILD_VERSION`
  in `web/app.js` on every release so clients pick up a new wasm exactly once.
- **HTTP caching**: the server sends `Cache-Control: public, max-age=2592000`
  (30 days) for `vendor/` and `assets/` files and `no-cache` (revalidate) for
  app files and pages. When serving behind your own proxy, mirror this policy.
- **PDF**: open / annotate / save works offline. Only saving back to PDF is
  supported (Download As to other formats is not possible offline: pdf→bin
  parsing is not in x2t, and image export needs server rendering). Printing
  is disabled for the same reason.

## License

ONLYOFFICE core / web-apps / sdkjs are AGPL-3.0, copyright Ascensio System
SIA. The integration layer in this repository (app.js, store.js, server.py,
offline shims) is provided under AGPL-3.0 as a derivative of AGPL code. See
[LICENSE](LICENSE).
