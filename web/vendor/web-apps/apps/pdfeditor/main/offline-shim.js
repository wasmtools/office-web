/*
 * offline-shim.js — offline bootstrap for the standalone PDF editor.
 * Loaded before require.js. Provides the pieces the official build expects a
 * Document Server for: empty-document template, offline license, and the
 * save/download bridge. The PDF editor opens raw PDF bytes directly (no x2t
 * bin round-trip), so getEmpty returns a minimal valid PDF.
 */
(function () {
    'use strict';

    // ---- 1) empty document: minimal valid single-page PDF ----
    var EMPTY_PDF_B64 = "JVBERi0xLjQKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZy9QYWdlcyAyIDAgUj4+ZW5kb2JqCjIgMCBvYmo8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFJdL0NvdW50IDE+PmVuZG9iagozIDAgb2JqPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0+PmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCnRyYWlsZXI8PC9TaXplIDQvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgowCiUlRU9G";
    function decodeEmptyPdf() {
        var bin = atob(EMPTY_PDF_B64);
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
        return decodeEmptyPdf();
    }

    // ---- 2) offline license (verbatim from official common/Local/license.js) ----
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
    var licenseTimer = setInterval(function () {
        tries++;
        if (window.AscCommon && window.Asc && applyOfficialLocalLicense(window.AscCommon, window.Asc)) {
            clearInterval(licenseTimer);
        } else if (tries > 600) {
            clearInterval(licenseTimer);
        }
    }, 100);

    // ---- 3) enable save button + hijack click ----
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

    // ---- 5) hide server/collaboration-only UI ----
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

    // ---- 6) safe save: asc_nativeGetFileData needs window.native.Save_End ----
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

    // ---- 7) suppress the leave-page confirmation on reload ----
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
        } catch (_) { /* ignore */ }
    })();

})();
