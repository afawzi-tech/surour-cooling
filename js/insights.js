/* ==========================================================
   أفكار من TaskFlow لا تحتاج تغييراً في قاعدة البيانات:
   - "تحتاج منفّذ": المرحلة الحالية في كل مشروع بلا فرقة أو مقاول.
   - "الإنجاز آخر 14 يوماً": المراحل التي بدأت والتي اكتملت كل يوم (من تواريخ project_stages).
   - البحث الشامل (Ctrl+K): المشاريع والفرق والفنيون والصفحات من أي مكان.
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, num } = window.UI;
  const A = window.App;
  const S = A.state;
  const DAYS = 14;
  const stagesN = (n) => (n === 1 ? 'مرحلة واحدة' : n === 2 ? 'مرحلتان' : n >= 3 && n <= 10 ? `${num(n)} مراحل` : `${num(n)} مرحلة`);
  const WD_SHORT = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

  /* ---------- تحتاج منفّذ ---------- */
  function needsOwner(rows) {
    return rows.filter((r) => !r.compound && r.status !== 'done' && r.sp?.cur && !r.sp.cur.s.crew_id)
      .map((r) => ({ r, c: r.sp.cur.c, running: r.sp.cur.s.status === 'in_progress' }))
      .sort((a, b) => (b.running - a.running) || ((a.r.p.due_date || '9999').localeCompare(b.r.p.due_date || '9999')));
  }
  function ownerBox(rows) {
    const xs = needsOwner(rows);
    return h('section', { class: 'd2-owner' + (xs.length ? ' has' : '') },
      h('div', { class: 'd2-plan-head' }, h('h2', null, 'تحتاج منفّذ'),
        h('span', { class: 'd2-note' }, 'المرحلة الحالية بلا فرقة أو مقاول')),
      xs.length ? h('ul', { class: 'owner-list' }, xs.slice(0, 8).map((x) => h('li', null,
        h('a', { href: '#/project/' + x.r.p.id },
          h('b', null, x.r.p.client),
          h('span', null, `${x.running ? 'جارية' : 'التالية'}: ${x.c.name_ar}`),
          x.r.p.due_date ? h('small', { class: x.r.sc?.late ? 'late' : '' }, x.r.due) : null))),
        xs.length > 8 ? h('li', { class: 'more muted small' }, `و${num(xs.length - 8)} غيرها`) : null)
        : h('p', { class: 'calm' }, 'كل المراحل الحالية مسندة لمنفّذ.'));
  }

  /* ---------- الإنجاز آخر 14 يوماً ---------- */
  function throughput() {
    const t = A.todayStr();
    const days = Array.from({ length: DAYS }, (_, i) => A.addDays(t, i - DAYS + 1));
    const st = Object.fromEntries(days.map((d) => [d, { s: 0, e: 0 }]));
    S.projects.forEach((p) => Object.values(S.stages[p.id] || {}).forEach((x) => {
      if (x.status === 'na') return;
      if (x.start_date && st[x.start_date]) st[x.start_date].s++;
      if (x.status === 'done' && x.end_date && st[x.end_date]) st[x.end_date].e++;
    }));
    return days.map((d) => ({ d, ...st[d] }));
  }
  function throughputBox() {
    const data = throughput();
    const max = Math.max(1, ...data.map((x) => Math.max(x.s, x.e)));
    const sumE = data.reduce((a, x) => a + x.e, 0), sumS = data.reduce((a, x) => a + x.s, 0);
    const half = (k, a, b) => data.slice(a, b).reduce((s, x) => s + x[k], 0);
    const prev = half('e', 0, 7), last = half('e', 7, 14);
    const trend = !prev && !last ? '' : last > prev ? `أكثر من الأسبوع الذي قبله (${num(prev)})` : last < prev ? `أقل من الأسبوع الذي قبله (${num(prev)})` : 'مثل الأسبوع الذي قبله';
    const t = A.todayStr();
    return h('section', { class: 'd2-thru' },
      h('div', { class: 'd2-plan-head' }, h('h2', null, `الإنجاز آخر ${num(DAYS)} يوماً`),
        h('span', { class: 'd2-note' }, `اكتملت ${stagesN(sumE)} وبدأت ${stagesN(sumS)}`)),
      h('div', { class: 'thru', role: 'img', 'aria-label': `المراحل المكتملة آخر ${DAYS} يوماً: ${sumE}، والتي بدأت: ${sumS}` },
        data.map((x) => {
          const wd = WD_SHORT[new Date(x.d + 'T00:00:00Z').getUTCDay()];
          return h('div', { class: 'th-day' + (x.d === t ? ' today' : '') + (wd === 'جمعة' ? ' fri' : ''), title: `${wd} ${x.d}: اكتملت ${x.e}، بدأت ${x.s}` },
            h('div', { class: 'th-bars' },
              h('span', { class: 'th-s', style: { height: (x.s / max * 100) + '%' } }),
              h('span', { class: 'th-e', style: { height: (x.e / max * 100) + '%' } }, x.e ? h('i', null, String(x.e)) : null)),
            h('small', null, x.d === t ? 'اليوم' : wd));
        })),
      h('div', { class: 'th-foot' },
        h('span', { class: 'th-key' }, h('i', { class: 'th-e' }), 'اكتملت', h('i', { class: 'th-s' }), 'بدأت'),
        trend ? h('span', { class: 'd2-note' }, `آخر 7 أيام: اكتملت ${num(last)}، ${trend}`) : null));
  }

  // يُستدعى من اللوحة الرئيسية
  function homeBoxes(rows) {
    if (!rows.length) return null;
    return h('div', { class: 'd2-two' }, throughputBox(), A.isStaff() ? ownerBox(rows) : null);
  }

  /* ---------- البحث الشامل ---------- */
  const PAGES = [
    ['home', 'لوحة التحكم'], ['projects', 'المشاريع'], ['tasks', 'المهام'], ['notifications', 'الإشعارات'], ['crews', 'الفرق والمقاولون'], ['calendar', 'تقويم المواعيد'],
    ['techs', 'أداء الفنيين'], ['compounds', 'المجمّعات السكنية'], ['reports', 'سجل التقارير'],
    ['users', 'المستخدمون', 'admin'], ['audit', 'سجل العمليات', 'admin'], ['backup', 'نسخة احتياطية', 'staff']
  ];
  const digits = (t) => String(t || '').replace(/[^0-9]/g, '');

  function index() {
    const n = A.nameKey;
    const items = [];
    S.projects.forEach((p) => items.push({ kind: 'مشروع', title: p.client, sub: [p.customer_name, p.governorate, p.city, p.brand].filter(Boolean).join('، '),
      href: '#/project/' + p.id, hay: n([p.client, p.customer_name, p.governorate, p.city, p.site_address, p.brand].filter(Boolean).join(' ')), phone: digits(p.customer_phone) }));
    S.crews.forEach((c) => items.push({ kind: c.kind === 'contractor' ? 'مقاول' : 'فرقة', title: c.name, sub: [c.leader, c.phone].filter(Boolean).join(' · '),
      href: '#/crews', hay: n([c.name, c.leader].filter(Boolean).join(' ')), phone: digits(c.phone) }));
    if (A.isStaff()) Object.entries(S.people || {}).forEach(([id, name]) => name && items.push({ kind: 'شخص', title: name, sub: 'الأداء', href: '#/techs/' + id, hay: n(name), phone: '' }));
    PAGES.filter(([, , w]) => !w || (w === 'admin' ? A.isAdmin() : A.isStaff())).forEach(([k, l]) => items.push({ kind: 'صفحة', title: l, sub: '', href: '#/' + k, hay: n(l), phone: '' }));
    return items;
  }

  function find(items, q) {
    const words = A.nameKey(q).split(' ').filter(Boolean);
    const dq = digits(q);
    if (!words.length) return items.filter((x) => x.kind === 'صفحة');
    const score = (x) => {
      if (dq.length >= 4 && x.phone.includes(dq)) return 3;
      if (!words.every((w) => x.hay.includes(w))) return 0;
      return x.hay.startsWith(words[0]) ? 2 : 1;
    };
    return items.map((x) => ({ x, s: score(x) })).filter((y) => y.s).sort((a, b) => b.s - a.s).map((y) => y.x).slice(0, 12);
  }

  function search() {
    const dlg = document.getElementById('dialog');
    if (dlg.open) dlg.close();
    dlg.onclose = null; dlg.oncancel = null;
    clear(dlg);
    const items = index();
    const input = h('input', { type: 'search', class: 'gs-input', placeholder: 'ابحث عن مشروع أو عميل أو هاتف أو فرقة أو صفحة…', 'aria-label': 'بحث', autocomplete: 'off', role: 'combobox', 'aria-controls': 'gs-list', 'aria-expanded': 'true' });
    const list = h('ul', { class: 'gs-list', id: 'gs-list', role: 'listbox' });
    let res = [], sel = 0;
    const goTo = (x) => { dlg.close(); location.hash = x.href; };
    const draw = () => {
      res = find(items, input.value);
      sel = Math.min(sel, Math.max(0, res.length - 1));
      clear(list).append(...(res.length ? res.map((x, i) => h('li', { role: 'option', id: 'gs-' + i, 'aria-selected': String(i === sel), class: i === sel ? 'on' : '',
        onMousedown: (e) => { e.preventDefault(); goTo(x); }, onMousemove: () => { if (sel !== i) { sel = i; mark(); } } },
        h('span', { class: 'gs-kind' }, x.kind), h('b', null, x.title), x.sub ? h('small', null, x.sub) : null))
        : [h('li', { class: 'gs-empty muted' }, 'لا نتائج.')]));
      input.setAttribute('aria-activedescendant', res.length ? 'gs-' + sel : '');
    };
    const mark = () => list.querySelectorAll('[role=option]').forEach((li, i) => { li.classList.toggle('on', i === sel); li.setAttribute('aria-selected', String(i === sel)); if (i === sel) { li.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', li.id); } });
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(res.length - 1, sel + 1); mark(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Enter' && res[sel]) { e.preventDefault(); goTo(res[sel]); }
    });
    dlg.appendChild(h('div', { class: 'dialog-body gs' }, input, list,
      h('p', { class: 'gs-hint muted small' }, '↑ ↓ للتنقل، Enter للفتح، Esc للإغلاق. البحث يتجاهل الهمزات والتاء المربوطة.')));
    dlg.classList.add('gs-dlg');
    dlg.addEventListener('close', () => dlg.classList.remove('gs-dlg'), { once: true });
    draw();
    dlg.showModal();
    input.focus();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.code === 'KeyK') && S.user && S.profile?.active) { e.preventDefault(); search(); }
  });

  window.Insights = { homeBoxes, ownerBox, throughputBox, needsOwner, search };
})();
