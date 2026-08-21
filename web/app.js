/*
 * app.js — standalone in-browser office editor.
 *
 * Opens, edits and saves Office documents entirely client-side using the
 * self-compiled x2t.wasm converter. No Document Server is required.
 *
 *   open : file bytes -> x2t (docx|xlsx|pptx -> bin) -> editor.openDocument({buffer})
 *   save : editor bin -> x2t (bin -> docx|xlsx|pptx) -> download / IndexedDB
 *   pdf  : raw PDF bytes -> pdfeditor (native format); save is two-stage —
 *          base PDF + compiled changes stream merged by x2t (m_bFromChanges)
 *
 * Files are persisted in IndexedDB (see store.js) so they survive reloads.
 */
(function () {
    'use strict';

    // Bump on every deploy: keys the Cache API entry for x2t.wasm, so users
    // re-download the converter exactly once per release.
    var BUILD_VERSION = '1.2.0';
    window.__OO_BUILD_VERSION = BUILD_VERSION;

    // ---------- config from URL ----------
    var PARAMS = {};
    new URLSearchParams(window.location.search).forEach(function (v, k) { PARAMS[k] = v; });

    // Determine the entry type. Priority: explicit global (?set by an embedder),
    // ?type= param, then the page filename (docx.html -> 'docx', etc.).
    function typeFromPath() {
        var m = /\/(docx|xlsx|pptx|pdf)\.html$/.exec(window.location.pathname);
        return m ? m[1] : '';
    }
    var PAGE_TYPE = window.__OO_PAGE_TYPE || PARAMS.type || typeFromPath();

    var statusEl = document.getElementById('status');
    var titlebarStatusEl = document.getElementById('titlebar-status');
    function setStatus(msg, isError) {
        // The floating chip is for the home screen; while a document is open
        // the same message is mirrored into the title bar.
        if (statusEl) {
            if (!msg) { statusEl.textContent = ''; statusEl.classList.remove('show'); }
            else {
                statusEl.textContent = msg;
                statusEl.classList.add('show');
                statusEl.classList.toggle('error', !!isError);
            }
        }
        if (titlebarStatusEl) {
            titlebarStatusEl.textContent = msg || '';
            titlebarStatusEl.classList.toggle('error', !!isError && !!msg);
        }
    }

    // ---------- x2t.wasm conversion ----------
    function fsWriteFile(mod, path, bytes) {
        var stream = mod.FS.open(path, 'w');
        mod.FS.write(stream, bytes, 0, bytes.length, 0);
        mod.FS.close(stream);
    }

    function resetWorking(mod) {
        try {
            var rmrf = function (p) {
                var st;
                try { st = mod.FS.stat(p); } catch (_) { return; }
                if (mod.FS.isDir(st.mode)) {
                    mod.FS.readdir(p).forEach(function (e) {
                        if (e === '.' || e === '..') return;
                        rmrf(p + '/' + e);
                    });
                    mod.FS.rmdir(p);
                } else {
                    mod.FS.unlink(p);
                }
            };
            rmrf('/working');
        } catch (_) {}
        mod.FS.mkdir('/working');
        mod.FS.mkdir('/working/fonts');
        mod.FS.mkdir('/working/themes');
    }

    function x2tConvert(mod, inputBytes, fromExt, toExt, workName) {
        resetWorking(mod);
        var inName = workName + '.' + fromExt;
        var outName = workName + '.' + toExt;
        fsWriteFile(mod, '/working/' + inName, inputBytes);
        var xml = '<?xml version="1.0" encoding="utf-8"?>' +
            '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
            '<m_sFontDir>/working/fonts/</m_sFontDir>' +
            '<m_sThemeDir>/working/themes</m_sThemeDir>' +
            '<m_sFileFrom>/working/' + inName + '</m_sFileFrom>' +
            '<m_sFileTo>/working/' + outName + '</m_sFileTo>' +
            '<m_bIsNoBase64>true</m_bIsNoBase64>' +
            '<m_nCsvTxtEncoding>46</m_nCsvTxtEncoding>' +
            '<m_nCsvDelimiter>4</m_nCsvDelimiter>' +
            '</TaskQueueDataConvert>';
        mod.FS.writeFile('/working/params.xml', xml);
        var ret = mod.ccall('main1', 'number', ['string'], ['/working/params.xml']);
        if (ret !== 0) throw new Error('x2t conversion failed ret=' + ret);
        return mod.FS.readFile('/working/' + outName);
    }

    // ---------- PDF save: base PDF + compiled changes -> merged PDF ----------
    // The PDF editor's save is two-stage (isomorphic to the Document Server's
    // collaborative save):
    //   base    = the original PDF bytes as opened
    //             (shim __ooGetFileData -> DocumentRenderer.file.getFileBinary())
    //   changes = incremental serialization of the edits
    //             (shim __ooGetPdfChanges -> DocumentRenderer.Save(),
    //             "%PDF"+command stream; only a 26-byte header when empty)
    // Officially the server-side C++ CPdfFile::AddToPdfFromBinary merges
    // changes into base; here we reuse the same code from the self-compiled
    // x2t.wasm: main1 + <m_bFromChanges>true</m_bFromChanges>, with the
    // changes in a changes/ directory next to the source file (core
    // X2tConverter/src/lib/pdf_image.h fromCrossPlatform -> applyChangesPdf
    // -> applyCompiledChangesPdf convention).
    // With no edits (changes null or <= 26-byte header) the base is returned
    // directly, skipping wasm.
    function mergePdfChanges(base, changes) {
        var EMPTY_CHANGES_LEN = 26;   // Save() with no edits: "%PDF"+length header only
        if (!changes || changes.length <= EMPTY_CHANGES_LEN) return Promise.resolve(base);
        return window.__x2tReadyPromise.then(function (mod) {
            var FS = mod.FS;
            try { FS.mkdir('/working'); } catch (e) {}
            try { FS.mkdir('/working/changes'); } catch (e) {}
            try { FS.mkdir('/working/fonts'); } catch (e) {}
            try { FS.mkdir('/working/themes'); } catch (e) {}
            // clean leftovers from a previous round (save may fire back-to-back)
            ['/working/changes'].forEach(function (dir) {
                try {
                    FS.readdir(dir).filter(function (n) { return n !== '.' && n !== '..'; })
                        .forEach(function (e) { try { FS.unlink(dir + '/' + e); } catch (_) {} });
                } catch (_) {}
            });
            ['src.pdf', 'out.pdf', 'params.xml'].forEach(function (f) {
                try { FS.unlink('/working/' + f); } catch (_) {}
            });
            fsWriteFile(mod, '/working/src.pdf', base);
            fsWriteFile(mod, '/working/changes/changes0.bin', changes);
            var xml = '<?xml version="1.0" encoding="utf-8"?>' +
                '<TaskQueueDataConvert xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
                '<m_sFontDir>/working/fonts/</m_sFontDir>' +
                '<m_sThemeDir>/working/themes</m_sThemeDir>' +
                '<m_sFileFrom>/working/src.pdf</m_sFileFrom>' +
                '<m_sFileTo>/working/out.pdf</m_sFileTo>' +
                '<m_bIsNoBase64>true</m_bIsNoBase64>' +
                '<m_bFromChanges>true</m_bFromChanges>' +
                '</TaskQueueDataConvert>';
            FS.writeFile('/working/params.xml', xml);
            var ret = mod.ccall('main1', 'number', ['string'], ['/working/params.xml']);
            if (ret !== 0) throw new Error('PDF changes merge failed ret=' + ret);
            return FS.readFile('/working/out.pdf');
        });
    }

    // ---------- document type helpers ----------
    var CELL_EXTS = ['xls', 'xlsx', 'xlsm', 'ods', 'csv'];
    var SLIDE_EXTS = ['ppt', 'pptx', 'odp', 'ppsx'];
    var PDF_EXTS = ['pdf'];

    function detectDocumentType(ext) {
        ext = (ext || '').toLowerCase();
        if (CELL_EXTS.indexOf(ext) >= 0) return 'cell';
        if (SLIDE_EXTS.indexOf(ext) >= 0) return 'slide';
        if (PDF_EXTS.indexOf(ext) >= 0) return 'pdf';
        return 'word';
    }

    // bin header -> writable formats (measured against the compiled x2t)
    function detectBinType(bin) {
        if (!bin || bin.length < 4) return null;
        var head = String.fromCharCode(bin[0], bin[1], bin[2], bin[3]);
        if (head === 'DOCY') return ['docx', 'odt', 'rtf', 'txt'];
        if (head === 'XLSY') return ['xlsx', 'xls', 'ods'];
        if (head === 'PPTY') return ['pptx', 'odp'];
        return null;
    }
    var LEGACY_TO_NEW = { doc: 'docx', ppt: 'pptx', csv: 'xlsx' };

    // ---------- editor state ----------
    var docEditor = null;
    var pendingBin = null;
    var documentReady = false;
    var emptyDocGotReal = false;
    var currentFile = null;   // { id, name, ext }

    function waitDocumentRendered(docType) {
        var waited = 0;
        var timer = setInterval(function () {
            waited += 300;
            var ready = false;
            try {
                var frame = document.querySelector('iframe[name="frameEditor"]');
                var w = frame && frame.contentWindow;
                var ed = w && w.Asc && w.Asc.editor;
                if (!ed) return;
                if (docType === 'cell') {
                    var wb = ed.wbModel;
                    ready = !!(wb && wb.getWorksheetCount && wb.getWorksheetCount() > 0);
                } else if (docType === 'slide') {
                    var ldS = ed.WordControl && ed.WordControl.m_oLogicDocument;
                    ready = !!(ldS && ldS.Slides && ldS.Slides.length > 0);
                } else if (docType === 'pdf') {
                    // PDFEditorApi: the document model lives in
                    // DocumentRenderer.file; pages present => rendered.
                    var file = ed.DocumentRenderer && ed.DocumentRenderer.file;
                    ready = !!(file && file.pages && file.pages.length > 0);
                } else {
                    var ld = ed.WordControl && ed.WordControl.m_oLogicDocument;
                    ready = !!(ld && ld.Pages && ld.Pages.length > 0);
                }
            } catch (e) { /* iframe not ready */ }
            if (ready) {
                clearInterval(timer);
                documentReady = true;
                setStatus('');
            } else if (waited > 60000) {
                clearInterval(timer);
                setStatus('Document render timeout. Please reload.', true);
            }
        }, 300);
    }

    function createEditor(fileExt, title) {
        var docType = detectDocumentType(fileExt);
        var document = {
            fileType: fileExt,
            key: 'doc-' + Date.now(),
            title: title,
            url: '_offline_',
            permissions: { edit: true, download: true, print: true, copy: true }
        };
        if (docType === 'pdf') {
            // Explicit isForm: otherwise api.js first sends a checkParams
            // message making pdfeditor probe the "extended PDF" via the
            // downloadfile endpoint, which does not exist offline (wasted
            // round-trip). isForm=false puts &isForm=false on the iframe
            // URL and pdfeditor goes straight to startApp.
            document.isForm = false;
        }
        docEditor = new DocsAPI.DocEditor('editor', {
            type: 'desktop',
            width: '100%',
            height: '100%',
            documentType: docType,
            document: document,
            editorConfig: {
                mode: 'edit',
                lang: 'en',
                canCoAuthoring: false,
                user: { id: 'local-user', name: 'Local User' },
                customization: { about: false, feedback: false, autosave: false }
            },
            events: {
                onAppReady: function () {},
                onDocumentReady: function () {
                    if (pendingBin && !emptyDocGotReal) {
                        var bin = pendingBin;
                        pendingBin = null;
                        setStatus('Loading document …');
                        var buf = bin.slice();
                        docEditor.openDocument({ buffer: buf.buffer });
                    }
                },
                onError: function (e) { setStatus('Editor error: ' + JSON.stringify(e && e.data), true); },
                onDownloadAs: function () {},
                onRequestClose: function () { window.close(); },
                onRequestSave: function () { saveDocument(); }
            }
        });
    }

    // ---------- open a file ----------
    function openFile(file) {
        // file: { id?, name, ext, data: Uint8Array }
        var ext = (file.ext || '').toLowerCase();
        currentFile = { id: file.id || null, name: file.name, ext: ext };
        document.title = currentFile.name;
        window.__ooDocExt = ext;
        hideHome();

        var docType = detectDocumentType(ext);
        if (docType === 'pdf') {
            // PDF skips the x2t bin round-trip: pdfeditor is a native-format
            // editor (sdkjs onEndLoadFile validates raw PDF bytes for
            // isPdfEditor(), not DOCY/XLSY/PPTY bin). The raw bytes go on
            // the bridge; the pdfeditor offline-shim's getEmpty() picks them
            // up during the one-shot load.
            // Note: opening does not wait for x2t.wasm either (it loads in
            // the background at boot; by the time a save merge needs it,
            // __x2tReadyPromise is ready or nearly so), saving the 36MB
            // wasm wait on the open path.
            window.__ooPendingDocBin = file.data;
            setStatus('Starting editor …');
            createEditor(ext, currentFile.name);
            waitDocumentRendered(docType);
            if (window.OOEditorState && window.OOEditorState._start) {
                window.OOEditorState._start(ext, docType, currentFile.name);
            }
            return;
        }

        window.__x2tReadyPromise.then(function (mod) {
            setStatus('Converting document …');
            var bin = x2tConvert(mod, file.data, ext, 'bin', 'open');
            pendingBin = bin;
            window.__ooPendingDocBin = bin;
            setStatus('Starting editor …');
            createEditor(ext, currentFile.name);
            waitDocumentRendered(docType);
            if (window.OOEditorState && window.OOEditorState._start) {
                window.OOEditorState._start(ext, docType, currentFile.name);
            }
        }).catch(function (e) {
            setStatus('Open failed: ' + (e && e.message || e), true);
        });
    }

    function waitForEditorApi(cb) {
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            var frame = document.querySelector('iframe[name="frameEditor"]');
            var w = frame && frame.contentWindow;
            var ed = w && w.Asc && w.Asc.editor;
            if (ed) { clearInterval(timer); cb(ed); }
            else if (tries > 300) clearInterval(timer);
        }, 200);
    }

    // ---------- save ----------
    var saveInFlight = false;
    function saveDocument() {
        if (saveInFlight) return false;
        saveInFlight = true;
        doSave().then(function (ok) { saveInFlight = false; return ok; })
            .catch(function () { saveInFlight = false; });
        return true;
    }

    function doSave() {
        var frame = document.querySelector('iframe[name="frameEditor"]');
        if (!frame || !frame.contentWindow || typeof frame.contentWindow.__ooGetFileData !== 'function') {
            setStatus('Editor not ready', true);
            return Promise.resolve(false);
        }
        setStatus('Saving …');
        var openExt = (window.__ooDocExt || '').toLowerCase();
        if (openExt === 'pdf') {
            // Two-stage PDF save: bin = base PDF (__ooGetFileData), the
            // changes stream comes from __ooGetPdfChanges
            // (DocumentRenderer.Save()); x2t merges them into the final PDF.
            // With no edits the changes stream is a 26-byte header and
            // mergePdfChanges returns the base as-is.
            var base = frame.contentWindow.__ooGetFileData();
            if (!base || !base.length) {
                setStatus('Save failed: No document data', true);
                return Promise.resolve(false);
            }
            var changes = frame.contentWindow.__ooGetPdfChanges
                ? frame.contentWindow.__ooGetPdfChanges() : null;
            return mergePdfChanges(base, changes).then(function (merged) {
                return persistToLibrary(merged.slice(), 'pdf');
            }).then(function () {
                setStatus('Saved ' + new Date().toLocaleTimeString());
                setTimeout(function () { setStatus(''); }, 3000);
                return true;
            }).catch(function (e) {
                setStatus('Save failed: ' + (e && e.message || e), true);
                return false;
            });
        }
        return window.__x2tReadyPromise.then(function (mod) {
            var bin = frame.contentWindow.__ooGetFileData();
            if (!bin || !bin.length) throw new Error('No document data');

            var saveExt;
            var supported = detectBinType(bin);
            if (supported) {
                if (openExt && supported.indexOf(openExt) >= 0) {
                    saveExt = openExt;
                } else if (openExt && LEGACY_TO_NEW[openExt] && supported.indexOf(LEGACY_TO_NEW[openExt]) >= 0) {
                    saveExt = LEGACY_TO_NEW[openExt];
                    setStatus('Note: ' + openExt + ' is a legacy format; saved as ' + saveExt);
                } else {
                    saveExt = supported[0];
                }
            } else {
                saveExt = openExt || 'docx';
            }
            var bytes = x2tConvert(mod, bin, 'bin', saveExt, 'save').slice();
            return persistToLibrary(bytes, saveExt);
        }).then(function () {
            setStatus('Saved ' + new Date().toLocaleTimeString());
            setTimeout(function () { setStatus(''); }, 3000);
            return true;
        }).catch(function (e) {
            setStatus('Save failed: ' + (e && e.message || e), true);
            return false;
        });
    }

    // Persist to the IndexedDB file library only (no browser download).
    // Saving keeps the document in the library; downloading is a separate
    // action available via File > Download As.
    function persistToLibrary(bytes, ext) {
        var base = currentFile && currentFile.name ? currentFile.name.replace(/\.[^.]+$/, '') : 'document';
        var name = base + '.' + ext;
        if (window.FileStore) {
            return window.FileStore.save({
                id: currentFile && currentFile.id,
                name: name,
                ext: ext,
                data: bytes
            }).then(function (rec) {
                currentFile.id = rec.id; currentFile.name = name; currentFile.ext = ext;
                document.title = name;
                var nameEl = document.getElementById('titlebar-name');
                if (nameEl) nameEl.textContent = name;
                refreshLibrary();
                return rec;
            });
        }
        return Promise.resolve();
    }

    // Trigger a browser download of the given bytes under the given filename.
    function triggerDownload(bytes, filename) {
        var blob = new Blob([bytes], { type: 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
    }

    // ---------- offline download-as bridge ----------
    var OFFLINE_FORMAT_EXT = {
        65: 'docx', 67: 'odt', 68: 'rtf', 69: 'txt',
        257: 'xlsx', 259: 'ods', 260: 'csv',
        129: 'pptx', 131: 'odp',
        513: 'pdf'
    };
    var OFFLINE_FORMAT_NAMES = {
        65: 'DOCX', 66: 'DOC', 67: 'ODT', 68: 'RTF', 69: 'TXT', 70: 'HTML', 73: 'EPUB',
        257: 'XLSX', 258: 'XLS', 259: 'ODS', 260: 'CSV',
        129: 'PPTX', 130: 'PPT', 131: 'ODP',
        513: 'PDF', 515: 'DJVU', 516: 'XPS',
        1025: 'JPG', 1029: 'PNG'
    };

    function handleOfflineDownload(msg) {
        var ext = OFFLINE_FORMAT_EXT[msg.format];
        if (!ext) {
            var nm = OFFLINE_FORMAT_NAMES[msg.format] || ('format #' + msg.format);
            setStatus('Download as ' + nm + ' is not supported', true);
            setTimeout(function () { setStatus(''); }, 4000);
            return;
        }
        setStatus('Generating ' + ext + ' …');
        var bytesPromise;
        if (msg.format === 513 && msg.pdf) {
            // PDF editor "Download As PDF": base + compiled changes stream
            // merged by x2t (same path as saving).
            bytesPromise = mergePdfChanges(new Uint8Array(msg.buffer),
                msg.changes ? new Uint8Array(msg.changes) : null)
                .then(function (merged) { return merged.slice(); });
        } else {
            bytesPromise = window.__x2tReadyPromise.then(function (mod) {
                var bin = new Uint8Array(msg.buffer);
                return x2tConvert(mod, bin, 'bin', ext, 'download').slice();
            });
        }
        bytesPromise.then(function (bytes) {
            // msg.title from asc_getDocumentName() already carries an extension
            // (e.g. "untitled.docx"); strip it before appending the target format,
            // otherwise Download As produces "untitled.docx.docx".
            var base = (msg.title || 'document').replace(/\.[^.]+$/, '');
            triggerDownload(bytes, base + '.' + ext);
            setStatus('Exported ' + ext);
            setTimeout(function () { setStatus(''); }, 2500);
        }).catch(function (e) {
            setStatus('Export failed: ' + (e && e.message || e), true);
        });
    }

    // ---------- file library UI ----------
    function refreshLibrary() {
        var listEl = document.getElementById('file-list');
        var toolbarEl = document.getElementById('library-toolbar');
        if (!listEl || !window.FileStore) return;
        window.FileStore.list().then(function (files) {
            if (toolbarEl) {
                toolbarEl.style.display = files.length ? 'flex' : 'none';
                var countEl = toolbarEl.querySelector('.library-count');
                if (countEl) countEl.textContent = files.length + (files.length === 1 ? ' file' : ' files');
            }
            listEl.innerHTML = '';
            if (!files.length) {
                listEl.innerHTML = '<div class="empty-hint">No files yet. Open or create one.</div>';
                return;
            }
            files.forEach(function (f) {
                var item = document.createElement('div');
                item.className = 'file-item';
                item.setAttribute('data-id', f.id);
                var icon = { docx: '📄', xlsx: '📊', pptx: '📽', pdf: '📕' }[f.ext] || '📄';
                item.innerHTML =
                    '<span class="file-icon">' + icon + '</span>' +
                    '<span class="file-name"></span>' +
                    '<span class="file-meta">' + formatSize(f.size) + ' · ' + formatDate(f.updatedAt) + '</span>' +
                    '<button class="file-act file-rename" title="Rename">✏️</button>' +
                    '<button class="file-act file-download" title="Download">⬇</button>' +
                    '<button class="file-act file-del" title="Delete">×</button>';
                item.querySelector('.file-name').textContent = f.name;
                item.addEventListener('click', function (ev) {
                    if (ev.target.closest('.file-act')) return;
                    loadFromFileStore(f.id);
                });
                item.querySelector('.file-rename').addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    renameFile(f);
                });
                item.querySelector('.file-download').addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    downloadFile(f.id);
                });
                item.querySelector('.file-del').addEventListener('click', function (ev) {
                    ev.stopPropagation();
                    if (confirm('Delete "' + f.name + '"?')) {
                        window.FileStore.remove(f.id).then(refreshLibrary);
                    }
                });
                listEl.appendChild(item);
            });
        });
    }

    function renameFile(f) {
        var input = prompt('Rename file:', f.name);
        if (input === null) return;
        input = input.trim();
        if (!input) { setStatus('Name cannot be empty', true); setTimeout(function () { setStatus(''); }, 3000); return; }
        if (input === f.name) return;
        // Keep the original extension: if the user typed a new one, accept it
        // only when it matches this editor's writable formats; otherwise the
        // old extension is re-appended.
        var dot = input.lastIndexOf('.');
        var base = dot > 0 ? input.slice(0, dot) : input;
        var ext = dot > 0 ? input.slice(dot + 1).toLowerCase() : f.ext;
        var writable = { docx: 1, xlsx: 1, pptx: 1, pdf: 1, doc: 1, xls: 1, ppt: 1, odt: 1, ods: 1, odp: 1, csv: 1, rtf: 1, txt: 1 };
        if (!writable[ext]) ext = f.ext;
        window.FileStore.rename(f.id, base + '.' + ext, ext).then(function () {
            setStatus('Renamed to ' + base + '.' + ext);
            setTimeout(function () { setStatus(''); }, 3000);
            refreshLibrary();
        }).catch(function (e) {
            setStatus('Rename failed: ' + (e && e.message || e), true);
        });
    }

    function downloadFile(id) {
        setStatus('Preparing download …');
        window.FileStore.get(id).then(function (rec) {
            if (!rec) throw new Error('File not found');
            triggerDownload(new Uint8Array(rec.data), rec.name);
            setStatus('');
        }).catch(function (e) {
            setStatus('Download failed: ' + (e && e.message || e), true);
        });
    }

    function clearLibrary() {
        if (!confirm('Delete ALL files from the library? This cannot be undone.')) return;
        window.FileStore.clear().then(function () {
            setStatus('All files deleted');
            setTimeout(function () { setStatus(''); }, 3000);
            refreshLibrary();
        }).catch(function (e) {
            setStatus('Failed: ' + (e && e.message || e), true);
        });
    }
    function formatSize(n) {
        if (n == null) return '';
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }
    function formatDate(ts) {
        if (!ts) return '';
        var d = new Date(ts);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function loadFromFileStore(id) {
        window.FileStore.get(id).then(function (rec) {
            if (!rec) return;
            openFile({ id: rec.id, name: rec.name, ext: rec.ext, data: new Uint8Array(rec.data) });
        });
    }

    // ---------- home screen / upload ----------
    function showTitlebar(visible) {
        var bar = document.getElementById('titlebar');
        if (bar) bar.classList.toggle('show', visible);
    }
    function showHome() {
        var home = document.getElementById('home');
        if (home) home.style.display = '';
        var ed = document.getElementById('editor');
        if (ed) ed.style.display = 'none';
        showTitlebar(false);
        document.title = 'Office Web';
        refreshLibrary();
    }
    function hideHome() {
        var home = document.getElementById('home');
        if (home) home.style.display = 'none';
        var ed = document.getElementById('editor');
        if (ed) ed.style.display = '';
        showTitlebar(true);
        var nameEl = document.getElementById('titlebar-name');
        if (nameEl) nameEl.textContent = currentFile ? currentFile.name : '';
    }

    // Back-to-home: return to the file library without reloading the page.
    // The editor iframe is torn down; unsaved changes are lost (the status
    // bar tells the user to save first if the document is dirty).
    function backToHome() {
        if (docEditor && typeof docEditor.destroyEditor === 'function') {
            try { docEditor.destroyEditor(); } catch (e) {}
        }
        docEditor = null;
        var ed = document.getElementById('editor');
        if (ed) ed.innerHTML = '';
        pendingBin = null;
        window.__ooPendingDocBin = null;
        documentReady = false;
        emptyDocGotReal = false;
        currentFile = null;
        window.__ooDocExt = '';
        showHome();
    }

    function handleFiles(fileList) {
        if (!fileList || !fileList.length) return;
        var f = fileList[0];
        var name = f.name || 'untitled';
        var dot = name.lastIndexOf('.');
        var ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : (PAGE_TYPE || 'docx');
        f.arrayBuffer().then(function (buf) {
            openFile({ name: name, ext: ext, data: new Uint8Array(buf) });
        });
    }

    function createNew(ext) {
        ext = ext || PAGE_TYPE || 'docx';
        var emptyUrl = { docx: 'assets/empty.docx', xlsx: 'assets/empty.xlsx', pptx: 'assets/empty.pptx', pdf: 'assets/empty.pdf' }[ext];
        if (!emptyUrl) return;
        fetch(emptyUrl).then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
            var name = 'untitled.' + ext;
            openFile({ name: name, ext: ext, data: new Uint8Array(buf) });
        });
    }

    // ---------- x2t.wasm loading with progress ----------
    var X2T_DIR = '/vendor/sdkjs/common/wasm/x2t/';

    // Download the 36MB x2t.wasm with progress reporting.
    function downloadWasm(url) {
        return fetch(url).then(function (resp) {
            if (!resp.ok) throw new Error('wasm download failed: HTTP ' + resp.status);
            var total = parseInt(resp.headers.get('Content-Length'), 10) || 0;
            if (!resp.body) {
                setStatus('Downloading converter …');
                return resp.arrayBuffer();
            }
            var reader = resp.body.getReader();
            var chunks = [], received = 0, lastUi = 0;
            function pump() {
                return reader.read().then(function (r) {
                    if (r.done) return;
                    chunks.push(r.value);
                    received += r.value.length;
                    var now = Date.now();
                    if (now - lastUi > 150) {
                        lastUi = now;
                        var pct = total ? ' (' + Math.floor(received * 100 / total) + '%)' : '';
                        setStatus('Downloading converter… ' + formatSize(received) +
                            (total ? ' / ' + formatSize(total) : '') + pct);
                    }
                    return pump();
                });
            }
            return pump().then(function () {
                var buf = new Uint8Array(received);
                var pos = 0;
                chunks.forEach(function (c) { buf.set(c, pos); pos += c.length; });
                return buf.buffer;
            });
        });
    }

    // Fetch x2t.wasm, serving it from the Cache API when possible. The entry
    // is keyed by BUILD_VERSION, so a new deployment (which bumps the version)
    // downloads the new wasm exactly once and old entries are dropped.
    function fetchWasmWithProgress() {
        var url = X2T_DIR + 'x2t.wasm';
        var cacheKey = X2T_DIR + 'x2t.wasm#v' + BUILD_VERSION;
        var cachePromise = (window.caches && caches.open)
            ? caches.open('oo-x2t-v1').catch(function () { return null; })
            : Promise.resolve(null);
        return cachePromise.then(function (cache) {
            if (!cache) return downloadWasm(url);
            return cache.match(cacheKey).then(function (cached) {
                if (cached) {
                    setStatus('Loading converter (cached) …');
                    return cached.arrayBuffer();
                }
                return downloadWasm(url).then(function (buf) {
                    return cache.put(cacheKey, new Response(buf)).catch(function () {}).then(function () {
                        // drop entries left over from older versions
                        return cache.keys().catch(function () { return []; }).then(function (keys) {
                            var keep = new Request(cacheKey).url;
                            return Promise.all(keys.map(function (k) {
                                return k.url !== keep ? cache.delete(k) : null;
                            }));
                        }).catch(function () {}).then(function () { return buf; });
                    });
                });
            });
        });
    }

    function loadX2t() {
        if (window.__x2tReadyPromise) return window.__x2tReadyPromise;
        window.__x2tReadyPromise = new Promise(function (resolve, reject) {
            fetchWasmWithProgress().then(function (bytes) {
                setStatus('Initializing converter …');
                // Set up the emscripten Module, then load x2t.js dynamically.
                // wasmBinary skips the glue's own fetch; locateFile keeps any
                // secondary lookup (e.g. the .mem file) on the right path.
                // onRuntimeInitialized fires once the wasm HEAP views exist.
                window.Module = {
                    wasmBinary: bytes,
                    locateFile: function (path) { return X2T_DIR + path; },
                    onRuntimeInitialized: function () { resolve(window.Module); }
                };
                var s = document.createElement('script');
                s.src = X2T_DIR + 'x2t.js';
                s.onerror = function () { reject(new Error('Failed to load x2t.js')); };
                document.head.appendChild(s);
            }).catch(function (e) {
                window.__x2tReadyPromise = null; // allow retry on next action
                setStatus('Converter load failed: ' + (e && e.message || e), true);
                reject(e);
            });
        });
        return window.__x2tReadyPromise;
    }

    // ---------- boot ----------
    function boot() {
        loadX2t().catch(function () {});

        // message bridge from the editor iframe
        window.addEventListener('message', function (e) {
            var d = e.data;
            if (!d) return;
            if (d.type === 'oo-empty-doc-real') emptyDocGotReal = true;
            else if (d.type === 'oo-save-request') saveDocument();
            else if (d.type === 'oo-download-request') handleOfflineDownload(d);
            else if (d.type === 'oo-download-unsupported') {
                var nm = OFFLINE_FORMAT_NAMES[d.format] || ('format #' + d.format);
                setStatus('Offline export of ' + nm + ' is not supported', true);
                setTimeout(function () { setStatus(''); }, 4000);
            }
            else if (d.type === 'oo-print-unsupported') {
                setStatus('Printing is not supported offline', true);
                setTimeout(function () { setStatus(''); }, 4000);
            }
        });

        // Ctrl+S / Cmd+S
        window.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                saveDocument();
            }
        });

        // home screen wiring
        var uploadInput = document.getElementById('upload-input');
        var uploadBtn = document.getElementById('upload-btn');
        var dropZone = document.getElementById('home');
        if (uploadBtn && uploadInput) {
            uploadBtn.addEventListener('click', function () { uploadInput.click(); });
            uploadInput.addEventListener('change', function () { handleFiles(uploadInput.files); });
        }
        // title bar buttons
        var backHomeBtn = document.getElementById('back-home');
        if (backHomeBtn) backHomeBtn.addEventListener('click', backToHome);
        var saveBtn = document.getElementById('save-btn');
        if (saveBtn) saveBtn.addEventListener('click', function () { saveDocument(); });

        // library toolbar
        var clearAllBtn = document.getElementById('clear-all-btn');
        if (clearAllBtn) clearAllBtn.addEventListener('click', clearLibrary);

        // per-type "New" buttons (data-new="docx|xlsx|pptx")
        var newActions = document.getElementById('new-actions');
        if (newActions) {
            newActions.addEventListener('click', function (e) {
                var btn = e.target.closest('[data-new]');
                if (btn) createNew(btn.getAttribute('data-new'));
            });
            // On a type-specific entry page, highlight that type's button
            if (PAGE_TYPE) {
                var focus = newActions.querySelector('[data-new="' + PAGE_TYPE + '"]');
                if (focus) focus.classList.add('primary');
            }
        }
        if (dropZone) {
            dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
            dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('dragover'); });
            dropZone.addEventListener('drop', function (e) {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                handleFiles(e.dataTransfer.files);
            });
        }

        // ?open=<id> deep link into a stored file
        if (PARAMS.open && window.FileStore) {
            loadFromFileStore(PARAMS.open);
        } else if (PARAMS.autonew) {
            createNew(PAGE_TYPE || 'docx');
        } else {
            showHome();
        }
    }

    // expose a small API for embedding / testing
    window.OfficeApp = {
        openFile: openFile,
        saveDocument: saveDocument,
        createNew: createNew,
        version: BUILD_VERSION
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
