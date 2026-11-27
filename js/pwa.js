/* تسجيل عامل الخدمة حتى يمكن تثبيت التطبيق كأيقونة على الهاتف. */
'use strict';
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  });
}
