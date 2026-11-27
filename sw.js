/* عامل خدمة بسيط: يجعل التطبيق قابلاً للتثبيت، ويحفظ ملفات الواجهة فقط.
   لا يخزّن أي بيانات من قاعدة البيانات: كل طلب لغير هذا الموقع يمرّ كما هو.
   الملفات تُجلب من الشبكة أولاً، والنسخة المحفوظة تُستخدم عند انقطاع الإنترنت فقط. */
'use strict';
const CACHE = 'sorror-shell-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
          .then((hit) => hit || Response.error())
      )
  );
});

// الإشعارات على الموبايل: تصل من دالة push-send حتى لو كان التطبيق مسدوداً
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { title: 'سرور', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'سرور', {
    body: d.body || '', dir: 'rtl', lang: 'ar', tag: d.id || undefined,
    icon: 'img/icons/icon-192.png', badge: 'img/icons/favicon-64.png',
    data: { link: typeof d.link === 'string' && d.link.startsWith('#/') ? d.link : '#/notifications' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL('./' + e.notification.data.link, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const w = list.find((c) => c.url.startsWith(self.registration.scope));
    if (w) { w.navigate(url).catch(() => {}); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
