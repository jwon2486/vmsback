/**
 * sw.js — 경비실 푸시 알림 서비스워커
 *
 * 최상위 경로(/sw.js)에서 받아야 사이트 전체를 범위로 잡는다.
 * (/js/sw.js 로 두면 /js/ 아래만 담당해 푸시를 받지 못한다 → app.py 의 /sw.js 라우트 참고)
 *
 * 하는 일은 두 가지뿐이다.
 *   1. 푸시가 오면 시스템 알림을 띄운다 — 브라우저를 닫아 둬도 뜬다.
 *   2. 열려 있는 VMS 탭이 있으면 그 탭에 알려 큰 경보음을 울리게 한다.
 *      (서비스워커 자체는 소리를 낼 수 없다. 시스템 알림음만 난다)
 */

self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', function (event) {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

    const title = data.title || '출입관리 알림';
    const body  = data.body  || '확인이 필요한 건이 있습니다.';

    event.waitUntil((async function () {
        // 열려 있는 탭에 먼저 알린다 → 그 탭이 경보음을 울린다.
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'sec-push', data: data }));

        await self.registration.showNotification(title, {
            body: body,
            // 같은 tag 면 알림이 쌓이지 않고 최신 것으로 교체된다
            tag: data.tag || 'sec-alert',
            renotify: true,
            // 자리를 비웠다 돌아와도 알림이 남아 있어야 한다 → 직접 닫기 전까지 유지
            requireInteraction: true,
            icon: '/logo/SnSYS_logo.png',
            badge: '/logo/SnSYS_logo.png',
            data: data,
        });
    })());
});

self.addEventListener('notificationclick', function (event) {
    event.notification.close();
    // 이미 열린 VMS 탭이 있으면 그 탭을 앞으로, 없으면 새로 연다.
    event.waitUntil((async function () {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of clients) {
            if (c.url.indexOf(self.location.origin) === 0 && 'focus' in c) {
                c.postMessage({ type: 'sec-push-click' });
                return c.focus();
            }
        }
        if (self.clients.openWindow) return self.clients.openWindow('/emp');
    })());
});
