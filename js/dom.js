/* ==========================================================
   أدوات بناء الواجهة بأمان
   كل النصوص تُضاف عبر textContent، ولا يُستخدم innerHTML مع أي بيانات.
   ========================================================== */
(() => {
  'use strict';

  const SAFE_URL = /^https:\/\/\S+$/i;

  /**
   * h('div', { class: 'card', onClick: fn }, 'نص', childNode, [array])
   * - الخصائص التي تبدأ بـ on تصبح مستمعات أحداث
   * - href يُقبل فقط إذا كان https أو رابطاً داخلياً يبدأ بـ #
   */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === null || v === undefined || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'class') {
          el.className = v;
        } else if (k === 'href') {
          const s = String(v);
          if (s.startsWith('#') || SAFE_URL.test(s)) el.setAttribute('href', s);
        } else if (k === 'value') {
          el.value = v;
        } else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required') {
          el[k] = Boolean(v);
        } else if (k === 'style') {
          for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
        } else {
          el.setAttribute(k, v === true ? '' : String(v));
        }
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
    return el;
  }

  /* ---------- رسائل قصيرة ---------- */
  function toast(msg, type = 'ok') {
    const box = document.getElementById('toasts');
    const t = h('div', { class: 'toast ' + type }, msg);
    box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), 3200);
    setTimeout(() => t.remove(), 3700);
  }

  /* ---------- نافذة تأكيد ---------- */
  function confirmBox({ title, body, okText = 'تأكيد', danger = false }) {
    const dlg = document.getElementById('dialog');
    return new Promise((resolve) => {
      const done = (v) => { dlg.close(); resolve(v); };
      clear(dlg);
      dlg.appendChild(h('form', { method: 'dialog', class: 'dialog-body', onSubmit: (e) => e.preventDefault() },
        h('h2', null, title),
        h('p', null, body),
        h('div', { class: 'row end' },
          h('button', { type: 'button', class: 'btn ghost', onClick: () => done(false) }, 'إلغاء'),
          h('button', { type: 'button', class: 'btn ' + (danger ? 'danger' : 'primary'), onClick: () => done(true) }, okText))));
      dlg.onclose = () => resolve(false);
      dlg.showModal();
    });
  }

  /* ---------- تنسيق ---------- */
  const num = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));
  const date = (d) => (d ? String(d).slice(0, 10) : '—');
  const dateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { hour12: false }).replace(',', '') : '—');

  window.UI = { h, append, clear, toast, confirmBox, num, date, dateTime, SAFE_URL };
})();
