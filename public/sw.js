const CACHE = 'atwe-v1172';
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

// Web Push: show the notification the server sent.
self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data && e.data.text ? e.data.text() : '' }; }
  const title = data.title || 'Atwe';
  const options = {
    body: data.body || '',
    tag: data.tag || 'atwe',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/' },
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping a notification focuses an existing tab (or opens a new one) at its URL.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) { if ('focus' in c) { c.focus(); if (c.navigate && url !== '/') c.navigate(url).catch(() => {}); return; } }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
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
    // Real FILES (features.html, admin.html, locked.html, …) must be served as
    // themselves — only extension-less SPA routes get the app shell. Serving the
    // shell for every navigation hijacked iframe embeds and the admin page.
    const navPath = new URL(e.request.url).pathname;
    if (/\.[a-z0-9]+$/i.test(navPath)) {
      e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
      return;
    }
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
