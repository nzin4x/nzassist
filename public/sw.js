const CACHE = 'nzassist-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: 'nzassist', body: '할 일 시간이 되었습니다.' };
  event.waitUntil(self.registration.showNotification(data.title || 'nzassist', {
    body: data.body,
    icon: '/icon-192.png',
    data: { url: data.url || '/' }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
