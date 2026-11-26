// Cache only non-executable, same-origin artwork/fonts. HTML, JS and CSS
// must stay together on the current release, including /editor?id=... links.
const STATIC_CACHE = 'sheets-static-holm-v4';

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith('sheets-') && name !== STATIC_CACHE)
      .map(name => caches.delete(name))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Let the browser handle navigations, private/auth requests and remote
  // resources. Re-fetching a font stylesheet inside a worker changes a
  // style-src request into connect-src and can violate the worker's CSP.
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      request.mode === 'navigate' ||
      !/^\/(?:sheets\/icons\/|icons\/sheets|fonts\/)/.test(url.pathname) ||
      !/\.(?:png|svg|webp|ico|woff2?)$/.test(url.pathname)) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    } catch {
      // A cache miss is a deliberate network error, never undefined (which
      // makes FetchEvent reject with "Failed to convert value to Response").
      const cached = await caches.open(STATIC_CACHE).then(cache => cache.match(request)).catch(() => null);
      return cached || Response.error();
    }
  })());
});

// Handle background sync for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-spreadsheets') {
    event.waitUntil(syncSpreadsheets());
  }
});

// Sync spreadsheets when back online
async function syncSpreadsheets() {
  try {
    // Get all clients and notify them to sync
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({ type: 'SYNC_DATA' });
    });
  } catch (error) {
    console.error('[SW] Sync failed:', error);
  }
}

// Handle push notifications (for future features)
self.addEventListener('push', (event) => {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body || 'New notification',
      icon: '/sheets/icons/icon-192x192.png',
      badge: '/icons/badge-72x72.png',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/sheets/'
      }
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'Sheets', options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/sheets/')
  );
});

// Message handler for communication from main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.filter(name => name.startsWith('sheets-')).map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});
