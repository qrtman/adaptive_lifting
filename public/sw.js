const IS_FRESH_PRODUCTION_CLIENT = self.location.hostname === 'app.goatedmethod.me';
// Keep staging's validated cache identity unchanged. Production uses a new
// shell cache so an older application shell cannot satisfy the fresh launch.
const CACHE_NAME = IS_FRESH_PRODUCTION_CLIENT
  ? 'adaptive-lifting-production-fresh-v1-v5'
  : 'adaptive-lifting-v4';
const CORE_ASSETS = ['/', '/index.html', '/favicon.svg', '/icons.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((name) => name.startsWith('adaptive-lifting-') && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (!url.protocol.startsWith('http') || request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Vite source modules and the HTML shell have stable URLs. Always check
    // the server first so an existing browser session can receive new code.
    // Offline boot still falls back to the last successfully cached assets.
    try {
      const response = await fetch(request);
      if (response.status === 200) {
        try { await cache.put(request, response.clone()); } catch { /* A full cache must not block an online response. */ }
      }
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match('/index.html');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
