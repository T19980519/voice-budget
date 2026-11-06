/* 오늘 얼마 썼어? 서비스 워커 — 오프라인 실행 + 알림 클릭 처리 */
const CACHE = 'voice-budget-v1.0.5';
const FILES = ['./', './index.html', './intro.html', './app.js', './holidays.js', './parser.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png', './lib/xlsx.full.min.js'];
// 설치: 브라우저 캐시를 건너뛰고(cache: 'reload') 서버에서 새 파일을 받음
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// 네트워크 우선(업데이트 바로 반영), 오프라인이면 캐시. 같은 사이트 파일은 서버에 바뀌었는지 꼭 물어봄(no-cache)
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const same = url.origin === self.location.origin;
  if (same && url.pathname.endsWith('/version.json')) { e.respondWith(fetch(e.request.url, { cache: 'no-store' })); return; }
  const net = same ? fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(e.request);
  e.respondWith(net.then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => cs.length ? cs[0].focus() : self.clients.openWindow('./')));
});
