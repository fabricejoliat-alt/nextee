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
          // Some platforms (incl. installed PWAs) support app icon badging from SW.
          if (self.navigator && typeof self.navigator.setAppBadge === 'function') {
            await self.navigator.setAppBadge(1);
            return;
          }
          if (self.registration && typeof self.registration.setAppBadge === 'function') {
            await self.registration.setAppBadge(1);
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
    Promise.all([
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
        for (const client of clientsArr) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return null;
      }),
      (async () => {
        try {
          if (self.navigator && typeof self.navigator.clearAppBadge === 'function') {
            await self.navigator.clearAppBadge();
            return;
          }
          if (self.registration && typeof self.registration.clearAppBadge === 'function') {
            await self.registration.clearAppBadge();
          }
        } catch {
          // Ignore unsupported badge API.
        }
      })(),
    ])
  );
});
