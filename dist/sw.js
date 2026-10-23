const OFFLINE_CACHE = 'fluqon-offline-v3';
const OFFLINE_ASSETS = ['/offline/', '/pwa/offline.css', '/assets/brand/fluqon-logo.svg', '/pwa/icon-192-v2.png', '/pwa/icon-512-v2.png', '/pwa/icon-maskable-512-v2.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(OFFLINE_CACHE).then(cache => cache.addAll(OFFLINE_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('fluqon-offline-') && key !== OFFLINE_CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Always request current pages. Never store deal pages or coupon codes offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await caches.match('/offline/')) || Response.error()));
    return;
  }
  if (OFFLINE_ASSETS.includes(url.pathname)) event.respondWith(caches.match(url.pathname).then(cached => cached || fetch(event.request)));
});
