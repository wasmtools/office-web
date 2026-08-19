
(function () {

    var EMPTY_BIN_B64 = "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";
    function decodeEmptyBin() {
        var bin = atob(EMPTY_BIN_B64);
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

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
        return decodeEmptyBin();
    }

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
    var timer = setInterval(function () {
        tries++;
        if (window.AscCommon && window.Asc && applyOfficialLocalLicense(window.AscCommon, window.Asc)) {
            clearInterval(timer);
        } else if (tries > 600) {
            clearInterval(timer);
        }
    }, 100);

    (function () {
        var lastLoadComplete = false;
        var loadTime = 0;
        var lastRecalc = 0;
        var fixed = false;
        setInterval(function () {
            var ed = (window.Asc && window.Asc.editor) || window.editor;
            if (!ed || !ed.WordControl || !ed.WordControl.m_oLogicDocument) return;
            var ld = ed.WordControl.m_oLogicDocument;

            if (!ed.isDocumentLoadComplete) { lastLoadComplete = false; fixed = false; return; }
            if (!lastLoadComplete) { lastLoadComplete = true; fixed = false; loadTime = Date.now(); lastRecalc = 0; }
            if (fixed) return;
            var hasContent = ld.Content && ld.Content.length > 0;
            var noPages = !ld.Pages || ld.Pages.length === 0;
            if (!hasContent || !noPages) return;
            var now = Date.now();
            var fontsReady = window.AscFonts && window.AscFonts.isEngineReady;
            var elapsed = now - loadTime;

            if ((fontsReady || elapsed > 5000) && (now - lastRecalc > 1000)) {
                lastRecalc = now;
                try { ld.RecalculateFromStart(true); } catch (e) {}
                if (ld.Pages && ld.Pages.length > 0) fixed = true;
                if (elapsed > 30000) fixed = true;
            }
        }, 100);
    })();

    (function () {

        var SUPPORTED = {
            DE:  { 65:1, 67:1, 68:1, 69:1 },
            SSE: { 257:1, 259:1, 260:1 },
            PE:  { 129:1, 131:1 }
        };
        var NS_LIST = ['DE', 'SSE', 'PE'];
        function getEditorNs() {
            for (var i = 0; i < NS_LIST.length; i++) {
                var ns = NS_LIST[i];
                if (window[ns] && window[ns].Views && window[ns].Views.FileMenuPanels) return ns;
            }
            return null;
        }
        function patchSaveMenus(ns) {
            var FP = window[ns].Views.FileMenuPanels;
            if (!FP) return;
            var sup = SUPPORTED[ns];
            [FP.ViewSaveAs, FP.ViewSaveCopy].forEach(function (View) {
                if (!View || !View.prototype) return;
                var origRender = View.prototype.render;
                View.prototype.render = function () {
                    var ret = origRender.apply(this, arguments);
                    try {

                        this.$el.find('.btn-doc-format').each(function () {
                            var f = parseInt($(this).attr('format'), 10);
                            if (isNaN(f) || !sup[f]) $(this).closest('.format-item').remove();
                        });
                    } catch (e) {}
                    return ret;
                };
            });
        }

        var tried = {};
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            var ns = getEditorNs();
            if (ns && !tried[ns]) {
                var FP = window[ns].Views.FileMenuPanels;
                if (FP && FP.ViewSaveAs && FP.ViewSaveAs.prototype && FP.ViewSaveAs.prototype.render) {
                    patchSaveMenus(ns);
                    tried[ns] = true;
                }
            }

            if ((tried.DE && tried.SSE && tried.PE) || tries > 600) clearInterval(timer);
        }, 100);
    })();

    (function () {
        var applied = false;
        function patchDownloadAs() {
            if (applied) return;
            var Asc = window.Asc;
            if (!Asc || !Asc.editor) return;
            var proto = Asc.editor.constructor && Asc.editor.constructor.prototype;

            var ed = Asc.editor;
            var target = null;
            var p = ed;
            while (p && !target) {
                if (p.asc_DownloadAs && !p.__ooDownloadAsPatched) { target = p; break; }
                p = Object.getPrototypeOf(p);
            }
            if (!target) return;
            var original = target.asc_DownloadAs;

            var SUPPORTED = {
                DE:  { 65:1, 67:1, 68:1, 69:1 },
                SSE: { 257:1, 259:1, 260:1 },
                PE:  { 129:1, 131:1 }
            };

            var ns = null;
            if (window.DE) ns = 'DE';
            else if (window.SSE) ns = 'SSE';
            else if (window.PE) ns = 'PE';
            var sup = ns ? SUPPORTED[ns] : null;
            target.asc_DownloadAs = function (options) {
                var fileType = options && (options.fileType !== undefined ? options.fileType : options.asc_getFileType && options.asc_getFileType());

                if (window.parent && window.parent !== window && typeof fileType === 'number' && sup) {
                    if (sup[fileType]) {
                        var title = (ed.asc_getDocumentName ? ed.asc_getDocumentName() : 'document') || 'document';
                        var copy = null;
                        var bin = window.__ooGetFileData && window.__ooGetFileData();
                        if (bin && bin.length) copy = bin.slice();
                        if (copy && copy.length) {
                            window.parent.postMessage({
                                type: 'oo-download-request',
                                format: fileType,
                                title: title,
                                buffer: copy.buffer
                            }, '*', [copy.buffer]);
                            return;
                        }
                    }

                    window.parent.postMessage({ type: 'oo-download-unsupported', format: fileType }, '*');
                    return;
                }
                return original.call(this, options);
            };
            target.__ooDownloadAsPatched = true;
            applied = true;
        }

        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            patchDownloadAs();
            if (applied || tries > 600) clearInterval(timer);
        }, 100);
    })();

    (function () {
        var appliedPrint = false;
        function patchPrint() {
            if (appliedPrint) return;
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
            appliedPrint = true;
        }
        var tries = 0;
        var timer = setInterval(function () {
            tries++;
            patchPrint();
            if (appliedPrint || tries > 600) clearInterval(timer);
        }, 100);
    })();

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

    window.__ooGetFileData = function () {
        var ed = (window.Asc && window.Asc.editor) || window.editor;
        if (!ed || typeof ed.asc_nativeGetFileData !== 'function') return null;
        var prevNative = window.native;
        var capturedLen = -1;

        window.native = {
            Save_End: function (header, len) { capturedLen = len; },
            Save_Begin: function () {}
        };
        var data;
        try {
            data = ed.asc_nativeGetFileData();
        } finally {
            if (prevNative === undefined) { delete window.native; }
            else { window.native = prevNative; }
        }
        if (!data) return null;

        if (capturedLen >= 0 && capturedLen < data.length) {
            data = data.subarray(0, capturedLen);
        }
        return data;
    };

    (function () {
        var timer = setInterval(function () {
            var ed = (window.Asc && window.Asc.editor) || window.editor;
            if (!ed) return;
            var proto = ed.constructor && ed.constructor.prototype;
            if (!proto || !proto.sendColorThemes || proto.__ooThemePatched) return;
            clearInterval(timer);
            proto.__ooThemePatched = true;
            var origSendColorThemes = proto.sendColorThemes;
            proto.sendColorThemes = function (theme) {
                try {

                    if (theme && theme.themeElements && theme.themeElements.clrScheme) {
                        var cs = theme.themeElements.clrScheme;
                        if (cs.colors && cs.colors[8] && cs.colors[12] &&
                            cs.colors[9] && cs.colors[13]) {
                            return origSendColorThemes.call(this, theme);
                        }
                    }

                } catch (e) {
 }
            };
        }, 100);
    })();

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
        } catch (_) {
 }
    })();

})();