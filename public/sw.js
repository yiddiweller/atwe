const CACHE = 'atwe-v603';
// The app shell ('/', '/index.html') is cached at runtime by the network-first
// navigation handler, not precached — precaching '/' on install would request a
// gated navigation and could consume a one-time site-lock pass.
const SHELL = ['/manifest.json', '/logo-mark.png', '/icon-192.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).pathname.startsWith('/api/')) return;

  // Page navigations: fetch the shell from a UNIQUE per-load path
  // (/__shell/<timestamp>) so an edge/CDN that caches "/" and "/index.html" by
  // path can never serve a stale page — every navigation is a cache miss that
  // hits the origin fresh. Fall back to the cached shell only offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch('/__shell/' + Date.now(), { cache: 'reload', credentials: 'same-origin' })
        .then(res => {
          if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put('/index.html', c)); }
          return res;
        })
        .catch(() => caches.match('/index.html').then(r => r || caches.match('/')))
    );
    return;
  }

  // Other static assets: cache-first, refreshed in the background.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
