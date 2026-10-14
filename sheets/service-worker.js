const STATIC_CACHE = 'sheets-static-v8-univer';
const DYNAMIC_CACHE = 'sheets-dynamic-v8-univer';
const API_CACHE = 'sheets-api-v8-univer';

// Install event - cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        return cache.addAll([
          '/',
          '/sheets/',
          '/sheets/editor.html',
          '/styles.css',
          '/home.css',
          '/manifest.json'
        ]);
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches and force update
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Delete ALL old caches to force fresh load
          return caches.delete(cacheName);
        })
      );
    }).then(() => {
      // Force all clients to adopt this new service worker immediately
      return self.clients.claim();
    })
  );
});

// Fetch event - handle API requests differently
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle API requests - NEVER cache, always go to network
  // This prevents authentication issues in production
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request, {
        // Important: Include credentials for authenticated requests
        credentials: 'include',
        // Don't cache API responses
        cache: 'no-store',
        // Ensure we don't use cached responses
        redirect: 'follow'
      })
    );
    return;
  }

  // Handle static assets - network first for critical files (JS/CSS/HTML)
  const isCriticalFile = event.request.url.endsWith('.js') ||
                        event.request.url.endsWith('.css') ||
                        event.request.url.endsWith('.html');

  if (isCriticalFile) {
    // Network first for critical files to ensure fresh code
    event.respondWith(
      fetch(event.request).then((response) => {
        // Cache the fresh response
        const responseToCache = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // If network fails, try cache as fallback
        return caches.match(event.request);
      })
    );
  } else {
    // Cache first for images and other static assets
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const responseToCache = response.clone();
            caches.open(DYNAMIC_CACHE).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        }).catch((error) => {
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('/sheets/');
          }
        });
      })
    );
  }
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
      icon: '/icons/icon-192x192.png',
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
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      })
    );
  }
});
