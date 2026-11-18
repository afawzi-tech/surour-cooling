/* ==========================================================
   تحسينات الواجهة - مصاعد السرور / التبريد المركزي
   الوضع الداكن، قائمة الجوال، عدّ الأرقام، حركة أشرطة التقدم، اختصارات لوحة المفاتيح
   ========================================================== */
(() => {
  'use strict';

  const THEME_KEY = 'surour_cooling_theme';
  const $ = (s) => document.querySelector(s);
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const sidebar = $('.sidebar');
  const topbar = $('.topbar');
  const nav = $('.nav');
  const view = $('#view');

  /* ---------- الوضع الداكن ---------- */
  function getSavedDark() {
    try { return localStorage.getItem(THEME_KEY) === 'dark'; } catch (e) { return false; }
  }
  function saveDark(dark) {
    try { localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light'); } catch (e) { /* التخزين غير متاح */ }
  }
  function applyTheme(dark) {
    document.body.classList.toggle('dark', dark);
    const btn = $('#themeBtn');
    if (btn) {
      btn.textContent = dark ? '☀ الوضع الفاتح' : '☾ الوضع الداكن';
      btn.setAttribute('aria-pressed', String(dark));
    }
  }

  const themeBtn = document.createElement('button');
  themeBtn.id = 'themeBtn';
  themeBtn.className = 'theme-btn';
  themeBtn.type = 'button';
  themeBtn.addEventListener('click', () => {
    const next = !document.body.classList.contains('dark');
    saveDark(next);
    applyTheme(next);
  });
  sidebar.insertBefore(themeBtn, $('.sidebar-foot'));
  applyTheme(getSavedDark());

  /* ---------- قائمة الجوال ---------- */
  nav.id = 'mainNav';
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'menu-btn';
  menuBtn.textContent = '☰ القائمة';
  menuBtn.setAttribute('aria-controls', 'mainNav');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.addEventListener('click', () => {
    const open = sidebar.classList.toggle('nav-open');
    menuBtn.setAttribute('aria-expanded', String(open));
  });
  topbar.prepend(menuBtn);

  // إغلاق القائمة بعد اختيار صفحة على الجوال
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      sidebar.classList.remove('nav-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });

  /* ---------- حركة الأرقام ---------- */
  function animateCount(el) {
    const raw = el.textContent.trim();
    if (reduceMotion || !/^[\d,]+$/.test(raw)) return;
    const target = Number(raw.replace(/,/g, ''));
    if (!target) return;
    const start = performance.now();
    const duration = 650;
    const step = (now) => {
      const k = Math.max(0, Math.min(1, (now - start) / duration));
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * eased).toLocaleString('en-US');
      if (k < 1) requestAnimationFrame(step);
    };
    el.textContent = '0';
    requestAnimationFrame(step);
  }

  /* ---------- حركة أشرطة التقدم ---------- */
  function animateBars(root) {
    if (reduceMotion) return;
    root.querySelectorAll('.progress > span').forEach((el) => {
      const target = el.style.width;
      if (!target) return;
      el.style.transition = 'none';
      el.style.width = '0%';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transition = 'width .8s cubic-bezier(.2, .7, .2, 1)';
        el.style.width = target;
      }));
    });
  }

  // كل مرة يُعاد فيها رسم الصفحة (عنصر مباشر داخل #view) نطبّق الحركات
  new MutationObserver(() => {
    view.querySelectorAll('.kpi-value').forEach(animateCount);
    animateBars(view);
  }).observe(view, { childList: true });

  /* ---------- اختصارات لوحة المفاتيح ---------- */
  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag);

    if (e.key === '/' && !typing) {
      const search = $('#search');
      if (search) {
        e.preventDefault();
        search.focus();
      }
    }
    if (e.key === 'Escape') {
      $('.overlay')?.querySelector('[data-m="no"]')?.click();
      sidebar.classList.remove('nav-open');
      menuBtn.setAttribute('aria-expanded', 'false');
    }
  });
})();
