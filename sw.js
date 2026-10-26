/* Bump this version whenever an app-shell asset changes. A complete shell is
   installed before activation, and core assets stay together until an update. */
const CACHE_VERSION = 'prokope-daily-v3';
const SCOPE = new URL(self.registration.scope);
const SCOPE_TAG = encodeURIComponent(SCOPE.pathname);
const SHELL_CACHE = CACHE_VERSION + ':shell:' + SCOPE_TAG;
const RUNTIME_CACHE = CACHE_VERSION + ':runtime:' + SCOPE_TAG;
const CORE = [
  './', './index.html', './styles.css', './model.js', './app.js',
  './timeline.js', './manifest.json', './apple-touch-icon.png', './icon-512.png'
].map(path => new URL(path, SCOPE).href);
const CORE_URLS = new Set(CORE);
const INDEX_URL = new URL('./index.html', SCOPE).href;

self.addEventListener('install', event => {
  // A failed download fails installation; the previous working app stays active.
  event.waitUntil(caches.open(SHELL_CACHE).then(cache =>
    cache.addAll(CORE.map(url => new Request(url, { cache: 'reload' })))
  ));
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  }
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name =>
      name.startsWith('prokope-daily-') && name.endsWith(':' + SCOPE_TAG) &&
      name !== SHELL_CACHE && name !== RUNTIME_CACHE
    ).map(name => caches.delete(name)));
    // Other applications on the same GitHub Pages origin keep their caches.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== SCOPE.origin ||
      !url.pathname.startsWith(SCOPE.pathname)) return;

  const canonical = url.origin + url.pathname;
  if (CORE_URLS.has(canonical)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(canonical);
      // Never replace a core asset independently with a newer deployment.
      return cached || fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === 'basic' &&
          !/no-store/i.test(response.headers.get('cache-control') || '')) {
        const copy = response.clone();
        event.waitUntil(caches.open(RUNTIME_CACHE)
          .then(cache => cache.put(request, copy)).catch(() => {}));
      }
      return response;
    } catch (error) {
      const runtime = await caches.open(RUNTIME_CACHE);
      const cached = await runtime.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await caches.open(SHELL_CACHE);
        const index = await shell.match(INDEX_URL);
        if (index) return index;
      }
      return new Response('This resource is not available offline.', {
        status: 503,
        statusText: 'Offline',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});
