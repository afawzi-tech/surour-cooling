/* عامل خدمة بسيط: يجعل التطبيق قابلاً للتثبيت، ويحفظ ملفات الواجهة فقط.
   لا يخزّن أي بيانات من قاعدة البيانات: كل طلب لغير هذا الموقع يمرّ كما هو.
   الملفات تُجلب من الشبكة أولاً، والنسخة المحفوظة تُستخدم عند انقطاع الإنترنت فقط. */
'use strict';
const CACHE = 'sorror-shell-v1';

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
