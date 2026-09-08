// 앱 셸(HTML/JS/CSS)은 네트워크 우선이다. 예전엔 캐시 우선이라 한 번 설치되면
// 모바일에서 아무리 새로고침해도 새 버전이 절대 안 보였다 — 탭을 완전히 닫아야만
// 대기 중이던 새 SW가 활성화되는데, 모바일 OS는 백그라운드 탭을 잘 안 죽이기 때문이다.
// skipWaiting + clients.claim으로 새 SW를 즉시 활성화하고, 그래도 열려 있던 페이지는
// app.js의 controllerchange 리스너가 한 번 새로고침해 최신 코드를 받게 한다.
const CACHE = 'nzassist-v8';
const ASSETS = ['/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/logo.svg', '/privacy.html', '/terms.html'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  // /api, /auth 는 다른 origin(Lambda) 이거나 세션 쿠키가 실려야 하는 요청이다.
  // 이 요청들은 절대 캐시하지 않는다 — 특히 세션/인증 응답을 캐시하면 사고가 난다.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      if (fresh.ok) {
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const fallback = await caches.match('/index.html');
        if (fallback) return fallback;
      }
      throw error;
    }
  })());
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
