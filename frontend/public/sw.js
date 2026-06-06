/* CCTV - 치지직 카드 트레이드 뷰 PWA 서비스 워커
 * 웹 푸시 알림 수신/표시 및 클릭 처리, 기본 설치/활성화 라이프사이클을 담당합니다.
 */

// 설치 즉시 활성화 대기 없이 새 워커로 전환
self.addEventListener('install', () => {
  self.skipWaiting();
});

// 활성화 시 즉시 모든 클라이언트 제어권 확보
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// 웹 푸시 수신: 백엔드(web-push)가 보낸 { title, body, url } 페이로드를 알림으로 표시
self.addEventListener('push', (event) => {
  let payload = { title: 'CCTV 알림', body: '' };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch (e) {
    if (event.data) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'CCTV 알림', {
      body: payload.body || '',
      icon: '/icon.png',
      badge: '/badge.png',
      data: { url: payload.url || '/' }
    })
  );
});

// 알림 클릭 시 앱 창을 포커스하거나 새로 엽니다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  let targetUrl = '/';
  const rawUrl = (event.notification.data && event.notification.data.url) || '/';
  
  try {
    const parsedUrl = new URL(rawUrl, self.location.origin);
    // 동일 출처(Same-Origin) 검사 수행
    if (parsedUrl.origin === self.location.origin) {
      targetUrl = parsedUrl.pathname + parsedUrl.search + parsedUrl.hash;
    }
  } catch (e) {
    targetUrl = '/';
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
