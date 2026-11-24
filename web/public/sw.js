/*
 * Service worker for the installed dashboard.
 *  - The page shell (HTML, JS, CSS, fonts) is cached, so the app opens without a connection.
 *  - API answers are fetched fresh; the last good answer is kept and shown when offline.
 *  - Push messages from the server become notifications; tapping one opens the dashboard.
 */
const SHELL = 'arachne-shell-v2'; // bump to drop old pages and icons from installed apps
const DATA = 'arachne-data-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Live stream, logins and downloads always go to the network.
  if (url.pathname === '/api/stream' || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/download') || url.pathname.startsWith('/api/export/')) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(DATA).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.json({ error: 'offline' }, { status: 503 }))),
    );
    return;
  }

  // Pages and assets: network first so updates arrive, cache when offline.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === 'navigate' ? '/' : req)),
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'Arachne.fyi', body: '', url: '/' };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* plain text or nothing */
  }
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon-192.png', data: { url: data.url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === location.origin);
      return open ? open.focus().then((c) => c.navigate(url)) : self.clients.openWindow(url);
    }),
  );
});
