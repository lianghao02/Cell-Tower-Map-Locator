// CacheStorage 與同來源的其他網站共用，只清理本專案的舊版本。
const CACHE_PREFIX = 'cell-tower-locator-';
const CACHE_NAME = 'cell-tower-locator-v6';

// 全部資源都在本機（不連外部 CDN）。新增或改名檔案時，同步更新這份清單與 index.html（有測試比對）。
const PRECACHE_ASSETS = [
    './',
    './index.html',
    './css/tailwind.css',
    './css/style.css',
    './js/geometry.js',
    './js/parser.js',
    './js/tiles.js',
    './js/app.js',
    './vendor/leaflet/leaflet.css',
    './vendor/leaflet/leaflet.js',
    './vendor/leaflet/images/layers.png',
    './vendor/leaflet/images/layers-2x.png',
    './vendor/leaflet/images/marker-icon.png',
    './vendor/leaflet/images/marker-icon-2x.png',
    './vendor/leaflet/images/marker-shadow.png',
    './vendor/fontawesome/css/all.min.css',
    './vendor/fontawesome/webfonts/fa-solid-900.woff2',
    './vendor/fontawesome/webfonts/fa-regular-400.woff2',
    './vendor/fontawesome/webfonts/fa-brands-400.woff2',
    './vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
    './manifest.webmanifest',
    './icon-192.png',
    './icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(PRECACHE_ASSETS);
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // 只處理本站資源。跨來源請求（地圖圖磚、地址搜尋、衛星圖）一律交還瀏覽器，不寫入快取：
    // 圖磚數量龐大，寫進快取會無上限成長；iPhone 對網頁快取容量有限，超過時會連同必要檔案一起被清掉。
    if (request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    // 導航請求（HTML）：Network-First，斷網時回退到快取
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response && response.status === 200) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(() => caches.match('./index.html'))
        );
        return;
    }

    // 本站靜態資源：Stale-While-Revalidate
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const copy = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
