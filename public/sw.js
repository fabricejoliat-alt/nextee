self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch {
    data = { title: 'ActiviTee', body: event.data.text() };
  }

  const title = data.title || 'ActiviTee';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    data: {
      url: data.url || '/',
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      (async () => {
        try {
          const badgeCount = Math.max(0, Number(data.badgeCount || 0)) || 1;
          // Some platforms (incl. installed PWAs) support app icon badging from SW.
          if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
            await self.navigator.setAppBadge(badgeCount);
            return;
          }
          if (self.registration && typeof self.registration.setAppBadge === 'function') {
            await self.registration.setAppBadge(badgeCount);
          }
        } catch {
          // Ignore unsupported badge API.
        }
      })(),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      return null;
    })
  );
});
