/* offline-shim.js — project integration layer, not official ONLYOFFICE code.
 * Makes the official Document Server build of the PDF editor work fully
 * offline (no Document Server). Same origin as the word/cell/slide shims,
 * but PDF does NOT go through the x2t bin round-trip:
 *   - open: raw PDF bytes go straight into the editor (pdfeditor is a
 *     native-format editor; sdkjs onEndLoadFile checks
 *     checkNativeViewerSignature for isPdfEditor(), not DOCY/XLSY/PPTY).
 *   - save: asc_nativeGetFileData only exists on word's asc_docs_api; the
 *     PDF save is two-stage (base PDF + compiled changes stream). See
 *     __ooGetFileData / __ooGetPdfChanges below.
 * Loaded synchronously before require.js (document.write in index.html).
 */
(function () {
    'use strict';

    // ---- 1) getEmpty: blank / real PDF bytes ----
    // Minimal valid single-page PDF (placeholder for the official _offline_
    // mode's first load).
    var EMPTY_PDF_B64 = "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0+PmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCnRyYWlsZXI8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgowCiUlRU9G";
    function decodeEmptyPdf() {
        var bin = atob(EMPTY_PDF_B64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    // Sources for the "one-shot load" of real document bytes (same protocol
    // as the word shim):
    //   1) same-origin parent bridge window.parent.__ooPendingDocBin
    //      (app.js sets it before createEditor)
    //   2) __ooSetPendingBin injection inside the iframe (kept for compat)
    //   3) minimal blank PDF fallback (pure offline empty document)
    var __ooPendingDocBin = null;
    window.__ooSetPendingBin = function (bin) { __ooPendingDocBin = bin; };
    window.__ooGetPendingBin = function () { return __ooPendingDocBin; };
    function getEmptyResolved() {
        if (window.parent && window.parent !== window &&
            window.parent.__ooPendingDocBin && window.parent.__ooPendingDocBin.length) {
            window.parent.postMessage({ type: 'oo-empty-doc-real' }, '*');
            return window.parent.__ooPendingDocBin.slice();
        }
        if (__ooPendingDocBin && __ooPendingDocBin.length) {
            return __ooPendingDocBin.slice();
        }
        return decodeEmptyPdf();
    }

    // ---- 2) offline license handling from the official Local/license.js ----
    function applyOfficialLocalLicense(AscCommon, Asc) {
        if (!AscCommon || !AscCommon.baseEditorsApi || !AscCommon.baseEditorsApi.prototype) return false;
        if (AscCommon.baseEditorsApi.prototype.__offlineShimLicenseApplied) return true;
        AscCommon.baseEditorsApi.prototype._onEndPermissions = function () {
            if (this.isOnLoadLicense) {
                var oResult = new AscCommon.asc_CAscEditorPermissions();
                oResult.setLicenseType(Asc.c_oLicenseResult.Success);
                oResult.setCanBranding(true);
                oResult.setCustomization(true);
                oResult.setRights(Asc.c_oRights.Edit);
                this.sendEvent('asc_onGetEditorPermissions', oResult);
            }
        };
        AscCommon.baseEditorsApi.prototype.__offlineShimLicenseApplied = true;
        window["compareVersions"] = true;
        return true;
    }

    // ---- hook: intercept AscCommon assignment + poll baseEditorsApi ----
    var _asc;
    function tryApply(v) {
        if (v) v.getEmpty = getEmptyResolved;
        if (v && window.Asc) applyOfficialLocalLicense(v, window.Asc);
    }
    Object.defineProperty(window, 'AscCommon', {
        get: function () { return _asc; },
        set: function (v) { _asc = v; tryApply(v); },
        configurable: true
    });
    var tries = 0;
    var licenseTimer = setInterval(function () {
        tries++;
        if (window.AscCommon && window.Asc && applyOfficialLocalLicense(window.AscCommon, window.Asc)) {
            clearInterval(licenseTimer);
        } else if (tries > 600) {
            clearInterval(licenseTimer);
        }
    }, 100);

    // ---- 3) enable save button + hijack click (forward save to parent) ----
    (function () {
        function isSaveElement(el) {
            if (!el || !el.closest) return false;
            return !!el.closest('#slot-btn-dt-save, #fm-btn-save');
        }
        setInterval(function () {
            var slots = document.querySelectorAll('#slot-btn-dt-save, #fm-btn-save');
            for (var i = 0; i < slots.length; i++) {
                var btn = slots[i].querySelector('button, .btn') || slots[i];
                btn.classList.remove('disabled');
                btn.removeAttribute('disabled');
            }
        }, 500);
        document.addEventListener('click', function (e) {
            if (isSaveElement(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'oo-save-request' }, '*');
                }
            }
        }, true);
    })();

    // ---- 4) Ctrl+S / Cmd+S inside iframe -> forward save to parent ----
    (function () {
        window.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.keyCode === 83)) {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'oo-save-request' }, '*');
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        }, true);
    })();

    // ---- 5) hide server/collaboration-only features (offline, same CSS as word shim) ----
    (function () {
        var style = document.createElement('style');
        style.textContent =
            '#id-toolbar-btn-print,' +
            '#fm-btn-print,' +
            '#fm-btn-print-with-preview,' +
            '#slot-btn-dt-print,' +
            '#slot-btn-chat,' +
            '#slot-btn-coauthmode,' +
            '#slot-btn-mailrecepients,' +
            '#slot-btn-protect-doc,' +
            '#slot-btn-macros,' +
            '#fm-btn-suggest,' +
            '#left-btn-chat,' +
            '#header-logo,' +
            'li[data-layout-name="toolbar-protect"],' +
            '[data-layout-name="header-user"],' +
            'button:has(.btn-print),' +
            'button:has(.btn-ic-chat),' +
            'button:has(.btn-ic-coedit),' +
            'button:has(.btn-mailmerge),' +
            'button:has(.btn-restrict-editing),' +
            'button:has(.btn-macros) { display: none !important; }';
        document.head.appendChild(style);
    })();

    // ---- 6) suppress the "leave page?" confirm on refresh/close ----
    (function () {
        var realHandler = null;
        try {
            Object.defineProperty(window, 'onbeforeunload', {
                get: function () { return realHandler; },
                set: function (fn) {
                    realHandler = function (e) {
                        try { if (fn) fn.call(window, e); } catch (_) {}
                        return undefined;
                    };
                },
                configurable: true
            });
        } catch (_) { /* ignore if the environment forbids redefinition */ }
    })();

    // ---- 7) save: base PDF + compiled changes stream (two-stage) ----
    // PDFEditorApi has no asc_nativeGetFileData (only word's asc_docs_api
    // does), so bytes cannot be pulled in one shot like word. The PDF
    // editor's save is two-stage (same as ONLYOFFICE Document Server's
    // collaborative save):
    //   a) base PDF: DocumentRenderer.file.getFileBinary() — the original
    //      PDF bytes as opened;
    //   b) compiled changes stream: DocumentRenderer.Save() — serializes the
    //      edits (annotations/forms/page ops) into a "%PDF"+command-stream
    //      incremental binary. It is NOT a complete PDF; officially the
    //      server-side C++ CPdfFile::AddToPdfFromBinary merges it back into
    //      the base (x2t main1 + m_bFromChanges).
    // The parent page (app.js) merges the two parts with x2t.wasm.
    // __ooGetFileData returns the base PDF bytes (with no edits it IS the
    // final result).
    window.__ooGetFileData = function () {
        var ed = (window.Asc && window.Asc.editor) || window.editor;
        if (!ed) return null;
        var dr = ed.DocumentRenderer;
        if (!dr || !dr.file) return null;
        try {
            var base = dr.file.getFileBinary();
            if (base && base.length) return base;
        } catch (e) { /* defensive */ }
        return null;
    };
    // Compiled changes stream: with no edits Save() emits only a 26-byte
    // header; with edits it carries the commands. Returns Uint8Array or null.
    window.__ooGetPdfChanges = function () {
        var ed = (window.Asc && window.Asc.editor) || window.editor;
        if (!ed || !ed.DocumentRenderer) return null;
        try {
            var changes = ed.DocumentRenderer.Save();
            return (changes && changes.length) ? changes : null;
        } catch (e) { return null; }
    };

    // ---- 8) offline Download As / Save Copy: menu keeps PDF only + offline bridge ----
    // The PDF editor's file menu lists DOCX/PDF/ODT/DOTX/PDFA/…/JPG/PNG by
    // default, but offline only PDF→PDF is possible (base + changes merge);
    // DOCX/ODT need pdf→bin parsing (x2t does not support it) and JPG/PNG
    // need server rendering. Remove the unusable entries and intercept
    // asc_DownloadAs as a fallback.
    (function () {
        var NS = 'PDFE';
        function patchSaveMenus() {
            var FP = window[NS] && window[NS].Views && window[NS].Views.FileMenuPanels;
            if (!FP) return false;
            [FP.ViewSaveAs, FP.ViewSaveCopy].forEach(function (View) {
                if (!View || !View.prototype || View.prototype.__ooMenuPatched) return;
                var origRender = View.prototype.render;
                View.prototype.render = function () {
                    var ret = origRender.apply(this, arguments);
                    try {
                        // keep only the PDF entry (format attr is the numeric
                        // format code, 513=PDF; the type:'' item keeps the
                        // original format)
                        this.$el.find('.btn-doc-format').each(function () {
                            var f = parseInt($(this).attr('format'), 10);
                            if (!isNaN(f) && f !== 513) $(this).closest('.format-item').remove();
                        });
                    } catch (e) {}
                    return ret;
                };
                View.prototype.__ooMenuPatched = true;
            });
            return true;
        }
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            if (patchSaveMenus() || tries > 600) clearInterval(timer);
        }, 100);

        // asc_DownloadAs interception: PDF(513)/default -> offline bridge
        // (base + changes, merged and downloaded by the parent page); other
        // formats -> unsupported notice (do not call the original, which
        // would hit the server and hang).
        function patchDownloadAs() {
            var ed = (window.Asc && window.Asc.editor) || window.editor;
            if (!ed || ed.__ooDownloadAsPatched) return false;
            var target = null, p = ed;
            while (p && !target) {
                if (p.asc_DownloadAs && !p.__ooDownloadAsPatched) { target = p; break; }
                p = Object.getPrototypeOf(p);
            }
            if (!target) return false;
            var original = target.asc_DownloadAs;
            target.asc_DownloadAs = function (options) {
                if (window.parent && window.parent !== window) {
                    var fileType = options && (options.fileType !== undefined
                        ? options.fileType
                        : options.asc_getFileType && options.asc_getFileType());
                    if (fileType === undefined || fileType === null || fileType === 513) {
                        var base = window.__ooGetFileData();
                        var changes = window.__ooGetPdfChanges();
                        if (base && base.length) {
                            // slice() copies into its own ArrayBuffer: the
                            // getFileBinary/Save results may be wasm heap
                            // views whose backing buffer is not transferable.
                            var baseCopy = base.slice();
                            var title = (ed.asc_getDocumentName ? ed.asc_getDocumentName() : 'document') || 'document';
                            var transfer = [baseCopy.buffer];
                            var msg = {
                                type: 'oo-download-request',
                                format: 513,
                                pdf: true,          // PDF editor branch: base+changes merge (unlike word render-bin)
                                title: title,
                                buffer: baseCopy.buffer
                            };
                            if (changes && changes.length) {
                                var chCopy = changes.slice();
                                msg.changes = chCopy.buffer;
                                transfer.push(chCopy.buffer);
                            }
                            window.parent.postMessage(msg, '*', transfer);
                            return;
                        }
                    }
                    window.parent.postMessage({ type: 'oo-download-unsupported', format: fileType }, '*');
                    return;
                }
                return original.apply(this, arguments);
            };
            target.__ooDownloadAsPatched = true;
            return true;
        }
        var dlTries = 0;
        var dlTimer = setInterval(function () {
            dlTries++;
            if (patchDownloadAs() || dlTries > 600) clearInterval(dlTimer);
        }, 100);
    })();

    // ---- 9) watchdog for a stuck "Loading Image"/"Loading data" mask ----
    // For some PDFs the async load indicator (a sync_StartAction that never
    // gets its matching sync_EndAction) never clears, blocking the whole UI
    // even though the document model, images and fonts are already loaded.
    // This happens offline when the load-completion path returns early
    // without delivering the end-action (e.g. the PDF edit-page flow), or
    // when a referenced font/image simply cannot be resolved. Rather than
    // waiting for something that will never arrive, we detect that nothing
    // is actually still loading and deliver the missing sync_EndAction,
    // which hides the mask and re-enables keyboard input through the
    // editor's own code path.
    (function () {
        var stuckSince = 0;
        var GRACE_MS = 2000;   // short grace before concluding the load is orphaned
        // Mask title -> the BlockInteraction action id it belongs to
        // (see pdfeditor Main.js onLongActionBegin switch / locale strings).
        function actionIdFromTitle(t) {
            t = (t || '').toLowerCase();
            if (t.indexOf('loading images') >= 0) return 3;   // LoadDocumentImages
            if (t.indexOf('loading image') >= 0) return 5;    // LoadImage
            if (t.indexOf('loading data') >= 0) return 4;     // LoadFont / LoadDocumentFonts
            return 5;                                          // default: LoadImage
        }
        // True if the image/font loaders still have real work in flight.
        function anythingStillLoading(ed) {
            try {
                var il = ed.ImageLoader;
                if (il && il.map_image_index) {
                    var idx = il.map_image_index;
                    for (var k in idx) {
                        // Status 0 = Loading; anything else is done/failed.
                        if (idx[k] && idx[k].Status === 0) return true;
                    }
                }
            } catch (e) {}
            try {
                var fl = ed.FontLoader || (window.AscCommon && window.AscCommon.g_font_loader);
                if (fl && fl.fonts_loading && fl.fonts_loading.length > 0) return true;
            } catch (e) {}
            return false;
        }
        setInterval(function () {
            try {
                var ed = (window.Asc && window.Asc.editor) || window.editor;
                var file = ed && ed.DocumentRenderer && ed.DocumentRenderer.file;
                var docReady = !!(file && file.pages && file.pages.length > 0);
                if (!docReady) { stuckSince = 0; return; }
                var titleEl = document.querySelector('.asc-loadmask-title');
                var title = titleEl ? (titleEl.textContent || '').toLowerCase() : '';
                // Only the "Loading image(s)/data" family hangs this way; do
                // not interfere with legitimately slow Save/Download masks.
                if (title.indexOf('loading image') < 0 && title.indexOf('loading data') < 0) {
                    stuckSince = 0; return;
                }
                // Something is genuinely still loading — give it time.
                if (anythingStillLoading(ed)) { stuckSince = 0; return; }
                if (!stuckSince) { stuckSince = Date.now(); return; }
                if (Date.now() - stuckSince > GRACE_MS) {
                    // Deliver the missing end-action (counter clamps at 0, so
                    // an extra end for an already-finished action is harmless).
                    // type 1 = c_oAscAsyncActionType.BlockInteraction.
                    try {
                        ed.sync_EndAction(1, actionIdFromTitle(title));
                    } catch (e) {}
                    stuckSince = 0;
                }
            } catch (e) { stuckSince = 0; }
        }, 500);
    })();

    // ---- 10) block printing (no offline server render path; asc_Print hangs) ----
    (function () {
        var applied = false;
        function patchPrint() {
            if (applied) return;
            var ed = (window.Asc && window.Asc.editor) || window.editor;
            if (!ed) return;
            var target = null, p = ed;
            while (p && !target) {
                if (p.asc_Print && !p.__ooPrintPatched) { target = p; break; }
                p = Object.getPrototypeOf(p);
            }
            if (!target) return;
            var original = target.asc_Print;
            target.asc_Print = function () {
                if (window.parent && window.parent !== window) {
                    window.parent.postMessage({ type: 'oo-print-unsupported' }, '*');
                    return;
                }
                return original.apply(this, arguments);
            };
            target.__ooPrintPatched = true;
            applied = true;
        }
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            patchPrint();
            if (applied || tries > 600) clearInterval(timer);
        }, 100);
    })();

})();
