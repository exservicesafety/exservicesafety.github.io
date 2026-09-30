// 오프라인 대비: 화면 파일만 저장해 둔다 (제출 데이터는 저장하지 않음, 항상 서버로 보냄).
// 화면을 고친 뒤에는 VERSION 숫자를 올려야 근무자 휴대폰에 새 화면이 반영된다.
const VERSION = 'tbm-v4';
const FILES = ['./', './index.html', './app.js', './style.css', './config.js', './manifest.json', './icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// 같은 사이트의 화면 파일: 인터넷이 되면 새로 받고, 안 되면 저장본 사용
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
