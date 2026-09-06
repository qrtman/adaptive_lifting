const CACHE_NAME = 'adaptive-lifting-v3';

const CORE_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/icons.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Bypass non-http protocols (like chrome-extension or local files)
  if (!event.request.url.startsWith('http')) {
    return;
  }

  // API requests bypass service worker cache entirely
  if (event.request.url.includes('/api/')) {
    return;
  }
  
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          // Cache successful GET requests
          if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        }).catch((err) => {
          // If offline and navigating to another route, fallback to index.html shell
          if (event.request.mode === 'navigate') {
            return cache.match('/index.html');
          }
          throw err;
        });
        
        // Return cached version instantly, updating it in the background
        return cachedResponse || fetchPromise;
      });
    })
  );
});
