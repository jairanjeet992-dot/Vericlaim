// ============================================================================
// VERICLAIM PWA SERVICE WORKER
// PHASE 5: Offline App Shell & Network Fallback
// ============================================================================

const CACHE_NAME = 'vericlaim-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/investigator',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Cache addAll warning:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Pass through non-GET requests or uploads
  if (event.request.method !== 'GET') {
    return;
  }

  // Never cache upload endpoints or cloudflare storage
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/uploads') || url.pathname.startsWith('/api/documents')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).catch(() => {
        // Return offline page/fallback if navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/investigator');
        }
      });
    })
  );
});
