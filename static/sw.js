const CACHE_NAME = 'quizradar-pwa-v3.3.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './app.js',
  './tailwind.css',
  './fonts.css',
  './fonts/inter-var-latin.woff2',
  './fonts/inter-var-latin-ext.woff2',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './lucide.min.js',
  './manifest.webmanifest'
];

// Cross-origin CDN asset the app still depends on as an offline icon fallback.
// Tailwind & Inter are now self-hosted and precached via STATIC_ASSETS.
const CDN_ASSETS = [
  'https://unpkg.com/lucide@latest/dist/umd/lucide.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.allSettled([
      caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
      caches.open(CACHE_NAME).then((cache) =>
        Promise.allSettled(
          CDN_ASSETS.map((a) =>
            // no-cors opaque responses are safe to cache for offline use
            fetch(a, { mode: 'no-cors', cache: 'no-cache' })
              .then((resp) => (resp && !resp.bodyUsed ? cache.put(a, resp) : resp))
              .catch(() => undefined)
          )
        )
      )
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // If requesting an API or dynamic backend route, try network first
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({ error: 'Offline / Network unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // Cross-origin CDN assets (Tailwind, fonts): cache-first so styling works offline
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(event.request).then((networkResponse) => {
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          return cachedResponse || new Response(JSON.stringify({ error: 'Offline / Network unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  // Local font & stylesheet assets: cache-first so styling works offline on first paint
  if (url.pathname.includes('/fonts/') || url.pathname.endsWith('/fonts.css') || url.pathname.endsWith('/tailwind.css')) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        }).catch(() => {
          return cachedResponse || new Response(JSON.stringify({ error: 'Offline / Network unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        });
      })
    );
    return;
  }

  // Stale-While-Revalidate for app assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || new Response(JSON.stringify({ error: 'Offline / Network unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }));

      return cachedResponse || fetchPromise;
    })
  );
});
