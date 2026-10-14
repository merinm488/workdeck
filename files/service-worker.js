/**
 * Filebox service worker.
 *
 * Scope is '/files/' — it never intercepts the Workdeck landing page or
 * the other apps (each registers its own worker, and /api/ always bypasses
 * every worker).
 *
 * Strategy:
 *   - /api/*                -> network only, never cached (auth + file bytes
 *                              must stay live)
 *   - navigation requests   -> network first, cached shell fallback (offline)
 *   - static assets         -> network first, cache fallback; assets are
 *                              unversioned, so cache-first would pin stale
 *                              files after a deploy
 */

const VERSION = 'filebox-v4';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// The minimal shell so /files/ can open offline. The library CDNs
// (uppy, pdf.js, photoswipe, ...) are cross-origin and NOT intercepted —
// previews/uploads need the network, like every other app in the suite.
const PRECACHE_URLS = [
  '/files/',
  '/files/styles.css',
  '/files/config/config.js',
  '/files/js/auth.js',
  '/files/js/storage.js',
  '/files/js/themes.js',
  '/files/js/vendor-esm.js',
  '/files/js/uploads.js',
  '/files/js/viewer.js',
  '/files/js/main.js',
  '/files/manifest.json',
  '/files/icons/icon-192x192.png',
  '/files/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Same-origin only.
  if (url.origin !== self.location.origin) return;

  // Never intercept API traffic — auth, metadata and file bytes stay live.
  if (url.pathname.startsWith('/api/')) return;

  // Leave every other app's scope to its own worker.
  if (!url.pathname.startsWith('/files/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseToCache = response.clone();
          event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put('/files/', responseToCache)));
          return response;
        })
        .catch(() =>
          caches.match('/files/')
            .then((cached) => cached || new Response('You are offline', { status: 503, statusText: 'Offline' }))
        )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, responseToCache)));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(request)
          .then((cached) => cached || new Response('You are offline', { status: 503, statusText: 'Offline' }))
      )
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
