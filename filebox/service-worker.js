/**
 * Filebox service worker.
 *
 * Scope is '/filebox/' — it never intercepts the Workdeck landing page or
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

const VERSION = 'filebox-v2';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// The minimal shell so /filebox/ can open offline. The library CDNs
// (uppy, pdf.js, photoswipe, ...) are cross-origin and NOT intercepted —
// previews/uploads need the network, like every other app in the suite.
const PRECACHE_URLS = [
  '/filebox/',
  '/filebox/styles.css',
  '/filebox/config/config.js',
  '/filebox/js/auth.js',
  '/filebox/js/storage.js',
  '/filebox/js/themes.js',
  '/filebox/js/vendor-esm.js',
  '/filebox/js/uploads.js',
  '/filebox/js/viewer.js',
  '/filebox/js/main.js',
  '/filebox/manifest.json',
  '/filebox/icons/icon-192x192.png',
  '/filebox/icons/icon-512x512.png'
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
  if (!url.pathname.startsWith('/filebox/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseToCache = response.clone();
          event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put('/filebox/', responseToCache)));
          return response;
        })
        .catch(() =>
          caches.match('/filebox/')
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
