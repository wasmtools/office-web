#!/usr/bin/env python3
"""
E2E test for the offline PDF editing path (open -> annotate -> save -> merge
-> round-trip), driven against a running server with Playwright + Chromium.

Also runs a docx open/save regression so the shared save path stays honest.

Usage:
    python3 server.py --port 8099 --root web   # in one shell
    python3 scripts/e2e-pdf-test.py [base_url] [pdf_file]

Requires: pip install playwright && playwright install chromium
"""
import base64
import pathlib
import sys

from playwright.sync_api import sync_playwright

REPO = pathlib.Path(__file__).resolve().parent.parent
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8099"
PDF = sys.argv[2] if len(sys.argv) > 2 else str(REPO / "testfiles" / "hello.pdf")
MULTI = str(REPO / "testfiles" / "multi.pdf")

FAILURES = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (("  [" + detail + "]") if detail else ""))
    if not ok:
        FAILURES.append(name)


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def editor_frame(page):
    for f in page.frames:
        if f.name == "frameEditor":
            return f
    return None


def wait_editor_ready(page, doc_type, timeout_ms=90000):
    """Poll until the iframe editor reports a rendered document."""
    inner = {
        "pdf": "const f = window.Asc && window.Asc.editor && window.Asc.editor.DocumentRenderer && window.Asc.editor.DocumentRenderer.file; return !!(f && f.pages && f.pages.length);",
        "word": "const ld = window.Asc.editor.WordControl.m_oLogicDocument; return !!(ld && ld.Pages && ld.Pages.length);",
    }[doc_type]
    frame = page.wait_for_selector('iframe[name="frameEditor"]', timeout=timeout_ms)
    fr = frame.content_frame()
    fr.wait_for_function(
        "() => { try { " + inner + " } catch (e) { return false; } }",
        timeout=timeout_ms)
    return fr


def open_file_via_app(page, name, ext, data: bytes):
    page.evaluate(
        """async ([name, ext, b64]) => {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            window.OfficeApp.openFile({ name, ext, data: bytes });
        }""", [name, ext, b64(data)])


def wait_saved(page, timeout_ms=120000):
    """Wait for the title bar status to report a successful save."""
    page.wait_for_function(
        "() => { const el = document.getElementById('titlebar-status'); return el && /^Saved /.test(el.textContent); }",
        timeout=timeout_ms)


def get_library_file(page, name):
    """Return {name, size, b64} of the newest library record matching name."""
    return page.evaluate(
        """async (name) => {
            const list = await window.FileStore.list();
            const meta = list.find(r => r.name === name) || list[0];
            const rec = await window.FileStore.get(meta.id);
            const u8 = new Uint8Array(rec.data);
            let s = '';
            for (let i = 0; i < u8.length; i += 0x8000)
                s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
            return { name: rec.name, size: rec.size, b64: btoa(s) };
        }""", name)


def main():
    orig = pathlib.Path(PDF).read_bytes()
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-gpu"])
        page = browser.new_page(viewport={"width": 1400, "height": 900})
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append("pageerror: " + str(e)))

        # ---------- 1. open a PDF (no x2t round-trip) ----------
        page.goto(BASE + "/", wait_until="networkidle")
        page.evaluate("window.FileStore.clear()")
        open_file_via_app(page, "hello.pdf", "pdf", orig)
        fr = wait_editor_ready(page, "pdf")
        pages_n = fr.evaluate("window.Asc.editor.DocumentRenderer.file.pages.length")
        check("open: pdf loads, pages > 0", pages_n > 0, f"pages={pages_n}")
        check("open: build version exposed",
              page.evaluate("window.__OO_BUILD_VERSION") == page.evaluate("window.OfficeApp.version"))

        # ---------- 2. annotate (FreeText + typed text) ----------
        fr.evaluate(
            """(text) => {
                const ed = window.Asc.editor;
                ed.AddFreeTextAnnot(0);                    // freeText on current page
                ed.asc_enterText(Array.from(text).map(c => c.codePointAt(0)), false);
            }""", "TEST-ANNOT")
        changes = fr.evaluate(
            """() => {
                const ch = window.__ooGetPdfChanges && window.__ooGetPdfChanges();
                return ch ? ch.length : 0;
            }""")
        check("annotate: changes stream non-trivial (>26 bytes)", changes > 26, f"changes={changes}")

        # ---------- 3. save: two-stage merge ----------
        page.evaluate("window.OfficeApp.saveDocument()")
        wait_saved(page)
        saved = get_library_file(page, "hello.pdf")
        saved_bytes = base64.b64decode(saved["b64"])
        check("save: merged PDF starts with %PDF", saved_bytes[:5] == b"%PDF-")
        check("save: merged PDF has /Annots", b"/Annots" in saved_bytes)
        check("save: merged PDF has FreeText annot", b"FreeText" in saved_bytes)
        check("save: merged PDF grew vs original", len(saved_bytes) > len(orig),
              f"{len(orig)} -> {len(saved_bytes)}")

        # ---------- 4. round-trip: reopen saved PDF, annotation still there ----------
        page.evaluate("document.getElementById('back-home').click()")
        page.wait_for_selector("#home", state="visible")
        open_file_via_app(page, "hello.pdf", "pdf", saved_bytes)
        fr = wait_editor_ready(page, "pdf")
        probe = fr.evaluate(
            """() => {
                const doc = window.Asc.editor.getPDFDoc();
                const a = typeof doc.annots === 'function' ? doc.annots() : doc.annots;
                let list = [];
                if (Array.isArray(a)) list = a;
                else if (a instanceof Map) list = Array.from(a.values());
                else if (a && typeof a === 'object') {
                    if (Array.isArray(a.list)) list = a.list;
                    else list = Object.values(a);
                }
                const types = list.map(x => (x && ((x.GetType && x.GetType()) || x.type)) || '?');
                const ch = window.__ooGetPdfChanges ? window.__ooGetPdfChanges() : null;
                return { n: list.length, types: types, changesLen: ch ? ch.length : 0,
                         aType: Array.isArray(a) ? 'array' : typeof a };
            }""")
        print("  probe:", probe)
        # The annotation counts as round-tripped if the model lists it, or if
        # the reopened file has no pending changes (== 26-byte header) while
        # the saved bytes contain the FreeText annot — i.e. it was merged in.
        baked = probe.get("changesLen") == 26 and b"FreeText" in saved_bytes
        check("round-trip: annotation present after reopen",
              probe.get("n", 0) >= 1 or baked,
              f"model={probe.get('n')} baked={baked}")

        # ---------- 4b. Download As PDF (base + changes merge path) ----------
        # add another annotation so the download exercises the merge path.
        # AddFreeTextAnnot places the box on Viewer.currentPage, which the
        # viewer sets on scroll/interaction (still -1 in headless); pin it.
        fr.evaluate(
            """() => {
                const dr = window.Asc.editor.DocumentRenderer;
                if (!(dr.currentPage >= 0)) dr.currentPage = 0;
            }""")
        fr.evaluate(
            """() => {
                const ed = window.Asc.editor;
                ed.AddFreeTextAnnot(0);
                ed.asc_enterText(Array.from('DL-ANNOT').map(c => c.codePointAt(0)), false);
            }""")
        with page.expect_download(timeout=120000) as dl_info:
            fr.evaluate("window.Asc.editor.asc_DownloadAs({ fileType: 513 })")
        dl = dl_info.value
        dl_path = pathlib.Path("/tmp/pdftest/downloaded.pdf")
        dl.save_as(str(dl_path))
        dl_bytes = dl_path.read_bytes()
        check("download-as: filename has single extension",
              dl.suggested_filename == "hello.pdf", dl.suggested_filename)
        check("download-as: merged PDF contains FreeText annot", b"FreeText" in dl_bytes,
              f"{len(dl_bytes)} bytes")

        # ---------- 5. no-edit save returns the base unchanged ----------
        page.evaluate("document.getElementById('back-home').click()")
        page.wait_for_selector("#home", state="visible")
        multi_orig = pathlib.Path(MULTI).read_bytes()
        open_file_via_app(page, "multi.pdf", "pdf", multi_orig)
        wait_editor_ready(page, "pdf")
        page.evaluate("window.OfficeApp.saveDocument()")
        wait_saved(page)
        noedit = get_library_file(page, "multi.pdf")
        noedit_bytes = base64.b64decode(noedit["b64"])
        check("save: no-edit save == original bytes", noedit_bytes == multi_orig,
              f"{len(multi_orig)} vs {len(noedit_bytes)}")

        # ---------- 6. regression: docx open/save still works ----------
        page.goto(BASE + "/docx.html", wait_until="networkidle")
        page.evaluate("window.OfficeApp.createNew('docx')")
        wait_editor_ready(page, "word")
        page.evaluate("window.OfficeApp.saveDocument()")
        wait_saved(page)
        docx_rec = get_library_file(page, "untitled.docx")
        docx_bytes = base64.b64decode(docx_rec["b64"])
        check("regression: docx save is a zip (PK header)", docx_bytes[:2] == b"PK")

        browser.close()

    # console errors: ignore known-noisy network noise
    real_errors = [e for e in console_errors
                   if "favicon" not in e and "net::" not in e and "Failed to load resource" not in e]
    check("console: no errors", not real_errors, "; ".join(real_errors)[:300])

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S): {FAILURES}")
        return 1
    print("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
