// オフラインでも開けるようにファイルをキャッシュする
// ファイルを更新したら VERSION を上げてください
const VERSION = 'hibilog-v3';
const SUPABASE_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
const FILES = [
  './',
  './index.html',
  './style.css',
  './holidays.js',
  './app.js',
  './sync.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  SUPABASE_LIB,
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// アプリのファイルとライブラリだけを扱う（Supabase との通信はキャッシュしない）
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isOwn = url.origin === self.location.origin;
  if (!isOwn && req.url !== SUPABASE_LIB) return;

  // ライブラリはバージョン固定なのでキャッシュ優先
  if (req.url === SUPABASE_LIB) {
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
    return;
  }
  // 自分のファイルはネット優先、つながらなければキャッシュ
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});

// ---------- プッシュ通知 ----------
self.addEventListener('push', e => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { title: 'ひびログ', body: e.data && e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(p.title || 'ひびログ', {
      body: p.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: p.tag || undefined,
      data: { url: p.url || './' },
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if (c.url.startsWith(self.registration.scope)) return c.focus();
      return self.clients.openWindow(target);
    })
  );
});
