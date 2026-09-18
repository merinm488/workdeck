/**
 * Workdeck service worker.
 *
 * Scope is '/' (served from the domain root), but Docs (/docs/) and Sheets
 * (/sheets/) register their own service workers on narrower scopes — so this
 * worker never intercepts or caches their requests. It only handles the
 * Workdeck landing page and its own assets under /js, /css, /icons and
 * /manifest.json.
 *
 * Strategy:
 *   - /api/*                    -> network only, never cached
 *   - navigation requests       -> network first, cache fallback (offline shell)
 *   - static assets (js/css/png)-> network first, cache fallback (offline);
 *                                 assets are unversioned, so serving cache
 *                                 first would pin stale files after a deploy
 */

const VERSION = 'workdeck-v4';
const STATIC_CACHE = `${VERSION}-static`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// The minimal app shell so the login/home page can open offline.
const PRECACHE_URLS = [
  '/',
  '/workdeck.css',
  '/js/themes.js',
  '/js/auth.js',
  '/js/workdeck.js',
  '/js/pwa.js',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
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
        // Delete every cache that isn't the current version's, including
        // leftovers from workers of previous versions.
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

  // Same-origin only — let Docs and Sheets workers handle their own scopes.
  if (url.origin !== self.location.origin) return;

  // Never intercept API traffic (auth and user data must stay live).
  if (url.pathname.startsWith('/api/')) return;

  // Leave Docs and Sheets to their own service workers.
  if (url.pathname.startsWith('/docs/') || url.pathname.startsWith('/sheets/')) return;

  // Navigation requests: network first so logins land on the fresh page,
  // falling back to the cached shell when offline. respondWith must NEVER
  // resolve with undefined (a cache miss resolves to undefined, which the
  // browser reports as "TypeError: Failed to convert value to 'Response'")
  // — hence the final 503 fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseToCache = response.clone();
          event.waitUntil(caches.open(RUNTIME_CACHE).then((cache) => cache.put('/', responseToCache)));
          return response;
        })
        .catch(() =>
          caches.match(request, { ignoreSearch: true })
            .then((cached) => cached || caches.match('/'))
            .then((cached) => cached || new Response('You are offline', { status: 503, statusText: 'Offline' }))
        )
    );
    return;
  }

  // Static assets: network first, falling back to cache when offline.
  // Assets are unversioned, so cache-first would keep serving pre-rename
  // files after a deploy and break the app (mixed old/new JS globals).
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
