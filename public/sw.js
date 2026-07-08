// PhotoParty service worker: アプリシェルだけキャッシュ。写真は一切キャッシュしない
const CACHE = 'ptpt-v16';
const SHELL = ['/', '/index.html', '/qrcode.min.js', '/jsqr.min.js', '/exif.min.js', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネット優先・落ちたらキャッシュ（開発中に古いシェルを掴まないように）
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
