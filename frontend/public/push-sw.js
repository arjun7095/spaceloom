// Loaded into the generated service worker: shows phone notifications and opens the right page on tap.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'PrimeSpace IPFM', body: event.data && event.data.text() };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'PrimeSpace IPFM', {
    body: data.body || '',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: data.tag || undefined,
    data: { link: data.link || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.link || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        c.navigate(url);
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
