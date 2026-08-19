/*
 * store.js — Browser-side file library backed by IndexedDB.
 *
 * Files opened or created in the editor are persisted here so they survive
 * page reloads. Content is stored as an ArrayBuffer; metadata (name, type,
 * timestamps) lives alongside it in the same record.
 */
(function (global) {
    'use strict';

    var DB_NAME = 'office-web-files';
    var DB_VERSION = 1;
    var STORE = 'files';

    function openDb() {
        return new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    var os = db.createObjectStore(STORE, { keyPath: 'id' });
                    os.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function tx(db, mode) {
        return db.transaction(STORE, mode).objectStore(STORE);
    }

    function reqToPromise(req) {
        return new Promise(function (resolve, reject) {
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function generateId() {
        if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    var FileStore = {
        /**
         * Save (create or update) a file record.
         * @param {Object} file { id?, name, ext, data: ArrayBuffer|Uint8Array }
         * @returns {Promise<Object>} the stored record (with id, timestamps)
         */
        save: function (file) {
            return openDb().then(function (db) {
                var now = Date.now();
                var record = {
                    id: file.id || generateId(),
                    name: file.name || 'untitled',
                    ext: (file.ext || '').toLowerCase(),
                    data: file.data instanceof ArrayBuffer ? file.data : file.data.buffer.slice(0),
                    size: file.data ? file.data.byteLength : 0,
                    createdAt: file.createdAt || now,
                    updatedAt: now
                };
                return reqToPromise(tx(db, 'readwrite').put(record)).then(function () {
                    return record;
                });
            });
        },

        /** Load a full record (including content) by id. */
        get: function (id) {
            return openDb().then(function (db) {
                return reqToPromise(tx(db, 'readonly').get(id));
            });
        },

        /** List metadata for all files (no content), newest first. */
        list: function () {
            return openDb().then(function (db) {
                return reqToPromise(tx(db, 'readonly').getAll()).then(function (records) {
                    return records
                        .map(function (r) {
                            return {
                                id: r.id, name: r.name, ext: r.ext,
                                size: r.size, createdAt: r.createdAt, updatedAt: r.updatedAt
                            };
                        })
                        .sort(function (a, b) { return b.updatedAt - a.updatedAt; });
                });
            });
        },

        /** Delete a file by id. */
        remove: function (id) {
            return openDb().then(function (db) {
                return reqToPromise(tx(db, 'readwrite').delete(id));
            });
        }
    };

    global.FileStore = FileStore;
})(window);
