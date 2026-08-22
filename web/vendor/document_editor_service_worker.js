
"use strict";

let g_version = "0.0.0-0";
const pathnameParts = self.location.pathname.split('/');
if (pathnameParts.length > 1 && pathnameParts[pathnameParts.length - 2]) {
	g_version = pathnameParts[pathnameParts.length - 2];
}

const g_buildVersion = "2026-08-22-1";
const g_cacheNamePrefix = 'document_editor_static_';
const g_cacheName = g_cacheNamePrefix + g_version + '_' + g_buildVersion;
const g_cacheablePrefixes = [
	"web-apps/",
	"sdkjs/",
	"fonts/",
	"sdkjs-plugins/",
	"dictionaries/"
];
const isDesktopEditor = navigator.userAgent.indexOf("AscDesktopEditor") !== -1;
let g_storageInfoCache = null;
let g_storageInfoCacheTime = 0;
const STORAGE_INFO_CACHE_DURATION = 30000;

const g_fifoCachePrefix = 'document_editor_dynamic_';
const g_fifoCacheName = g_fifoCachePrefix + g_version;
const g_fifoPrefix = 'cache/files/data/';
const g_fifoDocIdParams = ['shardkey', 'WOPISrc'];
const g_fifoCacheTimeHeader = 'X-Cache-Time';
const g_fifoConfig = {
	maxDocIds: 3,
	maxEntrySize: 500 * 1024 * 1024,
	docIdTTL: 10 * 60 * 1000
};

function fifoExtractDocId(url) {

	if (url.indexOf('/' + g_fifoPrefix) === -1) return null;

	const queryIdx = url.indexOf('?');
	if (queryIdx === -1) return null;

	const queryString = url.substring(queryIdx + 1);
	const params = queryString.split('&');

	for (let i = 0; i < params.length; i++) {
		const pair = params[i].split('=');
		if (pair[1] && g_fifoDocIdParams.indexOf(pair[0]) !== -1) {
			return decodeURIComponent(pair[1]);
		}
	}

	return null;
}

function fifoGetOldestTimestamp(keys, cache) {
	if (!keys || keys.length === 0) {
		return Promise.resolve(0);
	}

	return cache.match(keys[0]).then(function(response) {
		if (!response) return 0;
		const timeStr = response.headers.get(g_fifoCacheTimeHeader);
		return timeStr ? parseInt(timeStr, 10) : 0;
	}).catch(function() {
		return 0;
	});
}

function fifoAddTimestamp(response) {
	const headers = new Headers(response.headers);
	headers.set(g_fifoCacheTimeHeader, Date.now().toString());
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: headers
	});
}

function fifoCacheFile(request, docid, response) {
	return caches.open(g_fifoCacheName).then(function(cache) {
		return cache.keys().then(function(keys) {

			const docidOrder = [];
			const docidKeys = {};

			for (let i = 0; i < keys.length; i++) {
				const keyDocid = fifoExtractDocId(keys[i].url);
				if (keyDocid) {
					if (!docidKeys[keyDocid]) {
						docidKeys[keyDocid] = [];
						docidOrder.push(keyDocid);
					}
					docidKeys[keyDocid].push(keys[i]);
				}
			}

			return fifoGetOldestTimestamp(docidKeys[docid], cache).then(function(oldestTime) {
				const isExpired = oldestTime > 0 && (Date.now() - oldestTime) > g_fifoConfig.docIdTTL;
				const evictions = [];

				if (docidKeys[docid] && isExpired) {
					const expiredKeys = docidKeys[docid];
					for (let j = 0; j < expiredKeys.length; j++) {
						evictions.push(cache.delete(expiredKeys[j]));
					}

					const idx = docidOrder.indexOf(docid);
					if (idx !== -1) {
						docidOrder.splice(idx, 1);
					}
					delete docidKeys[docid];
				}

				if (!docidKeys[docid] && docidOrder.length >= g_fifoConfig.maxDocIds) {
					const oldestDocid = docidOrder[0];
					const oldestKeys = docidKeys[oldestDocid];
					for (let k = 0; k < oldestKeys.length; k++) {
						evictions.push(cache.delete(oldestKeys[k]));
					}
				}

				return Promise.all(evictions).then(function() {

					const timestampedResponse = fifoAddTimestamp(response);
					return cache.put(request, timestampedResponse);
				});
			});
		});
	}).catch(function(err) {
		console.error('fifoCacheFile failed:', err);
	});
}

function fifoGetFromCache(request) {
	return caches.open(g_fifoCacheName).then(function(cache) {
		return cache.match(request);
	}).catch(function() {
		return undefined;
	});
}

function shouldUseFifoCache(url) {
	return url.indexOf('/' + g_fifoPrefix) !== -1;
}

function safeToCache(request, response) {
	return request.method === 'GET'
		&& response
		&& response.ok
		&& (response.type === 'basic' || response.type === 'cors')
		&& !response.redirected;
}

function getStorageInfo() {
	const now = Date.now();
	if (g_storageInfoCache !== null && (now - g_storageInfoCacheTime) < STORAGE_INFO_CACHE_DURATION) {
		return Promise.resolve(g_storageInfoCache);
	}

	if (!navigator.storage || !navigator.storage.estimate) {

		g_storageInfoCache = {
			maxEntrySize: 50 * 1024 * 1024,
			isHealthy: true
		};
		g_storageInfoCacheTime = now;
		return Promise.resolve(g_storageInfoCache);
	}

	return navigator.storage.estimate()
		.then(function(estimate) {

			if (!estimate || typeof estimate.quota !== 'number' || !isFinite(estimate.quota) || estimate.quota <= 0 ||
				typeof estimate.usage !== 'number' || !isFinite(estimate.usage)) {
				g_storageInfoCache = {
					maxEntrySize: 50 * 1024 * 1024,
					isHealthy: true
				};
				g_storageInfoCacheTime = Date.now();
				return g_storageInfoCache;
			}

			const cacheSize = Math.min(estimate.quota * 0.10, 1024 * 1024 * 1024);
			const maxEntrySize = cacheSize / 8;

			const usageRatio = estimate.usage / estimate.quota;
			const isHealthy = usageRatio < 0.8;

			g_storageInfoCache = { maxEntrySize: maxEntrySize, isHealthy: isHealthy };
			g_storageInfoCacheTime = Date.now();
			return g_storageInfoCache;
		})
		.catch(function(error) {

			g_storageInfoCache = {
				maxEntrySize: 50 * 1024 * 1024,
				isHealthy: true
			};
			g_storageInfoCacheTime = Date.now();
			return g_storageInfoCache;
		});
}

function putInCache(request, response, attempt) {
	if (typeof attempt === 'undefined') attempt = 0;
	return caches.open(g_cacheName)
		.then(function(cache) {

			return cache.put(request, response.clone());
		})
		.catch(function(err) {

			if (attempt < 2) {
				return new Promise(function(resolve) {
					setTimeout(resolve, 250 * Math.pow(2, attempt));
				})
				.then(function() {

					return putInCache(request, response, attempt + 1);
				});
			} else {
				const size = response.headers ? response.headers.get('content-length') : 'unknown';
				console.error('putInCache failed after max retries:', {
					url: request.url,
					method: request.method,
					responseSize: size,
					responseType: response.type,
					cacheName: g_cacheName,
					error: err && (err.message || err)
				});
			}
		});
}

function cacheFirst(event) {
	const request = event.request;
	const url = request.url;
	const fifoDocId = fifoExtractDocId(url);

	const cachePromise = fifoDocId
		? fifoGetFromCache(request)
		: caches.match(request, { cacheName: g_cacheName });

	return cachePromise
		.then(function(cached) {
			return cached || fetch(request).then(function(networkResp) {

				const responseForCache = networkResp.clone();

				if (safeToCache(request, networkResp)) {
					event.waitUntil(
						getStorageInfo()
						.then(function(info) {
							if (!info.isHealthy) return;

							const size = Number(networkResp.headers.get('content-length')) || 0;

							if (fifoDocId) {

								if (size === 0 || size <= g_fifoConfig.maxEntrySize) {
									return fifoCacheFile(request, fifoDocId, responseForCache);
								}
							} else {

								if (size === 0 || size < info.maxEntrySize) {
									return putInCache(request, responseForCache);
								}
							}
						})
					);
				}
				return networkResp;
			});
		});
}
function activateWorker(event) {
	return self.clients.claim()
		.then(function(){

			return caches.keys();
		})
		.then(function (keys) {
			const deletePromises = keys
				.filter(function(cache) {

					const isOldStatic = cache.startsWith(g_cacheNamePrefix) && cache !== g_cacheName;

					const isOldDynamic = cache.startsWith(g_fifoCachePrefix) && cache !== g_fifoCacheName;
					return isOldStatic || isOldDynamic;
				})
				.map(function(cache) {
					return caches.delete(cache);
				});
			return Promise.all(deletePromises);
		}).catch(function (err) {
			console.error('activateWorker failed with ' + err);
		});
}

function matchesCacheablePath(url) {
	const g_versionNeedle = "/" + g_version + "/";
	const versionIndex = url.indexOf(g_versionNeedle);
	if (versionIndex === -1) return false;

	const i = versionIndex + g_versionNeedle.length;

	for (let k = 0; k < g_cacheablePrefixes.length; k++) {

		if (url.startsWith(g_cacheablePrefixes[k], i)) {
			return true;
		}
	}
	return false;
}

self.addEventListener('install', (event) => {
	event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
	event.waitUntil(activateWorker());
});

self.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = request.url;

	if (request.method !== "GET") {
		return;
	}

	const isCacheablePath = matchesCacheablePath(url);
	const isFifoPath = shouldUseFifoCache(url);

	if (!isCacheablePath && !isFifoPath) {
		return;
	}

	if (isDesktopEditor && url.indexOf("/sdkjs/common/AllFonts.js") !== -1) {
		return;
	}

	event.respondWith(cacheFirst(event));
});
