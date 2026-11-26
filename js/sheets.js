/* ==========================================================
   أوراق المشروع - مطابقة لملف VRF QC Tracker في المعادلات
   لوحة التحكم | متابعة الفلل | سجل الفحوصات | عدم المطابقة | طريقة الاستخدام
   + صفحة الفيلا (مناسبة للجوال في الموقع)
   + استيراد وتصدير Excel (التصدير بالإنجليزية ومعادلات حقيقية كالملف الأصلي)
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, toast, confirmBox, num, date } = window.UI;
  const A = window.App;
  const S = A.state;
  const X = window.XLSX_LITE;
  const F = A.F;
  let W = A.unitWords({});   // كلمات الوحدة (فيلا، شقة، طابق…) للمشروع المفتوح

  const SHEETS = [
    ['dashboard', 'لوحة التحكم', 'Dashboard'],
    ['tracker', 'متابعة الفلل', 'Villa Tracker'],
    ['tests', 'سجل الفحوصات', 'Test Records'],
    ['ncr', 'عدم المطابقة', 'NCR Register'],
    ['guide', 'طريقة الاستخدام', 'How to use']
  ];
  const RES_KEYS = ['pass', 'fail', 'pending', 'na'];
  const SYM = { pass: '✓', fail: '✗', pending: '·', na: '—' };
  const CHECK_AR = { OK: 'مقبول', CHECK: 'راجع' };
  const today = () => new Date().toISOString().slice(0, 10);
  const projectOf = (id) => S.projects.find((p) => p.id === id);
  const blank = (v) => v === null || v === undefined || v === '';
  const mobile = () => window.matchMedia('(max-width: 760px)').matches;
  const villaHref = (p, u) => `#/project/${p.id}/villa/${u.id}`;
  const pbar = (v) => h('span', { class: 'pbar' }, h('span', { style: { width: Math.round((v || 0) * 100) + '%' } }));
  const statusChip = (U) => h('span', { class: 'chip st-' + U.replace(/\s/g, '-').toLowerCase() }, A.STATUS_AR[U]);

  // إعادة الرسم عند التبديل بين الجوال والكمبيوتر
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => { if (location.hash.includes('/project/')) A.render(); });

  /* ---------- صفحة المشروع ---------- */
  A.views.project = {
    title: (r) => projectOf(r.id)?.client || 'المشروع',
    async render(r) {
      const p = projectOf(r.id);
      W = A.unitWords(p || {});
      if (!p) return A.empty('المشروع غير موجود', '', h('a', { href: '#/home', class: 'btn' }, 'المشاريع'));
      const d = await A.loadProject(p.id);
      if (r.tab === 'villa') {
        const u = d.units.find((x) => x.id === r.sub);
        return u ? h('div', null, villaPage(p, d, u), bottomNav(p, 'tracker')) : A.empty(`${W.the} غير موجودة`, '', h('a', { href: `#/project/${p.id}/tracker`, class: 'btn' }, `متابعة ${W.theMany}`));
      }
      const tab = SHEETS.some((s) => s[0] === r.tab) ? r.tab : 'dashboard';
      const body = { dashboard: sheetDashboard, tracker: sheetTracker, tests: sheetTests, ncr: sheetNcr, guide: sheetGuide }[tab](p, d);
      return h('div', { class: 'book' },
        h('div', { class: 'book-head' }, h('h1', null, p.client), projectActions(p, d)),
        h('nav', { class: 'sheet-tabs', 'aria-label': 'أوراق المشروع' }, SHEETS.map(([k, ar, en]) =>
          h('a', { href: `#/project/${p.id}/${k}`, class: 'sheet-tab' + (k === tab ? ' on' : ''), title: en, 'aria-current': k === tab ? 'page' : null }, k === 'tracker' ? 'متابعة ' + W.theMany : ar))),
        h('div', { class: 'sheet' }, body),
        bottomNav(p, tab));
    }
  };

  // أزرار المشروع: صف على الكمبيوتر، وقائمة "المزيد" على الجوال
  function projectActions(p, d) {
    const items = [
      ['تقرير اليوم', () => dailyReport(p, d), A.isStaff()],
      [`+ ${W.many}`, () => addVillas(p, d), A.isStaff()],
      ['↻ تحديث', async () => { await A.loadProject(p.id, true); A.render(); }, true],
      ['استيراد Excel', () => importDialog(p), A.isStaff()],
      ['تصدير Excel', () => exportExcel(p, d), true]
    ].filter((x) => x[2]);
    if (!mobile()) return h('div', { class: 'row' }, items.map(([l, fn]) => h('button', { type: 'button', class: 'btn sm', onClick: fn }, l)));
    const menu = h('details', { class: 'more' }, h('summary', { 'aria-label': 'المزيد' }, '⋯'),
      h('div', { class: 'more-list' }, items.map(([l, fn]) => h('button', { type: 'button', onClick: () => { menu.open = false; fn(); } }, l))));
    return menu;
  }

  // شريط سفلي ثابت على الجوال
  function bottomNav(p, active) {
    // أيقونات مرسومة بخطوط بسيطة بنفس السماكة
    const P = {
      dashboard: ['M3 3h7v7H3z', 'M14 3h7v4h-7z', 'M14 11h7v10h-7z', 'M3 14h7v7H3z'],
      tracker: ['M3 11l9-7 9 7', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
      tests: ['M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M12 13l4-4', 'M12 2v3'],
      ncr: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18v.5'],
      guide: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7', 'M12 17v.5']
    };
    const icon = (k) => {
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'bn-svg');
      P[k].forEach((d) => { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.appendChild(path); });
      return svg;
    };
    const short = { dashboard: 'اللوحة', tracker: `${W.theMany}`, tests: 'الفحوصات', ncr: 'NCR', guide: 'المساعدة' };
    const d = S.data[p.id];
    const open = d ? d.ncrs.filter((n) => n.status === 'open').length : 0;
    return h('nav', { class: 'bottom-nav', 'aria-label': 'التنقل' }, SHEETS.map(([k, ar]) =>
      h('a', { href: `#/project/${p.id}/${k}`, class: k === active ? 'on' : '', 'aria-label': ar, 'aria-current': k === active ? 'page' : null },
        h('span', { class: 'bn-ico' }, icon(k), k === 'ncr' && open ? h('i', { class: 'bn-badge' }, String(open)) : null),
        h('span', null, short[k]))));
  }

  /* ==========================================================
     لوحة التحكم
     ========================================================== */
  function sheetDashboard(p, d) {
    const cps = S.checkpoints;
    const D = F.dashboard(d, cps);
    const rows = d.units.map((u) => ({ u, k: F.row(u, cps, A.openNcrsOf(d, u.id)) }));
    const problem = (k) => k.R > 0 || k.T > 0;
    const attn = rows.filter(({ k }) => problem(k) || k.W);

    // درجة لون الفيلا في المخطط حسب نسبة الإنجاز (نفس معادلة % complete)
    const band = (k) => (k.U === 'Complete' ? 'done' : k.S === 0 ? 'b0' : k.S < 0.25 ? 'b1' : k.S < 0.5 ? 'b2' : k.S < 0.75 ? 'b3' : 'b4');
    const BANDS = [['b0', 'لم تبدأ'], ['b1', 'أقل من ربع'], ['b2', 'حتى النصف'], ['b3', 'حتى ثلاثة أرباع'], ['b4', 'قاربت'], ['done', 'مكتملة']];
    const short = (code) => { const m = String(code).match(/(\d+)\s*$/); return m ? m[1] : String(code).slice(-3); };
    const why = (k) => [k.R ? `${k.R} بند فاشل` : '', k.W ? 'تنبيه تسلسل' : '', k.T ? `${k.T} NCR مفتوحة` : ''].filter(Boolean).join('، ');

    // جملة الحال بدل صف أرقام
    const started = D.B3 - D.B6;
    // العدد مع اسم الوحدة بقواعد العربية: 1 وحدة واحدة، 2 وحدتان، 3–10 جمع، 11+ مفرد
    const cnt = (n) => (n === 1 ? `${W.one} ${W.fem ? 'واحدة' : 'واحد'}` : n === 2 ? `${num(n)} ${W.one}` : n <= 10 ? `${num(n)} ${W.many}` : `${num(n)} ${W.one}`);
    const v = (fem, plural) => (plural ? 'تحتاج' : fem ? 'تحتاج' : 'يحتاج');
    const lead = D.B3 === 0 ? `لا توجد ${W.many} في هذا المشروع بعد.`
      : `بدأ الفحص في ${num(started)} من ${cnt(D.B3)}، ` + (D.B4 ? `واكتمل ${num(D.B4)}.` : `ولم ${W.fem ? 'تكتمل' : 'يكتمل'} أي ${W.one} بعد.`)
        + (attn.length ? ` ${cnt(attn.length)} ${v(W.fem, attn.length > 1)} انتباهك.` : ' لا شيء يحتاج انتباهك الآن.');

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animateOnce = !reduce && !S._mapAnimated;   // لحظة الحركة الوحيدة: أول فتح للصفحة فقط
    S._mapAnimated = true;
    const map = h('div', { class: 'site-map' + (animateOnce ? ' animate' : ''), role: 'list', 'aria-label': 'مخطط المجمّع' },
      rows.map(({ u, k }, i) => {
        const b = band(k);
        const flag = problem(k) ? ' flag-fail' : k.W ? ' flag-alert' : '';
        const label = `${u.code}: ${A.STATUS_AR[k.U]}، ${A.pctText(k.S)}` + (why(k) ? `، ${why(k)}` : '') + (k.V !== '-' ? `. التالي: ${k.V.name_ar}` : '');
        const tile = h('a', { href: villaHref(p, u), class: `tile ${b}${flag}`, role: 'listitem', title: label, 'aria-label': label },
          short(u.code));
        tile.style.setProperty('--i', String(i));
        return tile;
      }));

    const mix = [['done', D.B4, 'مكتملة'], ['run', D.B5, 'جارية'], ['idle', D.B6, 'لم تبدأ']];
    return h('div', { class: 'dash2' },
      h('header', { class: 'd2-head' },
        h('p', { class: 'd2-lead' }, lead),
        h('div', { class: 'd2-pct', 'aria-label': `نسبة إنجاز الفحص الكلية ${A.pctText(D.B10)}` },
          h('strong', null, A.pctText(D.B10)), h('span', null, 'من فحوصات المجمّع منجزة'))),
      h('dl', { class: 'd2-stats' }, [
        ['مكتملة', D.B4, 'ok'], ['جارية', D.B5, ''], ['لم تبدأ', D.B6, 'muted'],
        ['فيها بند فاشل', D.B7, D.B7 ? 'bad' : 'muted'], ['تنبيهات تسلسل', D.B8, D.B8 ? 'warn' : 'muted'], ['NCR مفتوحة', D.B9, D.B9 ? 'bad' : 'muted']
      ].map(([l, v, c]) => h('div', { class: 'st ' + c }, h('dd', null, num(v)), h('dt', null, l)))),
      h('div', { class: 'd2-grid' },
        h('section', { class: 'd2-plan', 'aria-labelledby': 'plan-h' },
          h('div', { class: 'd2-plan-head' },
            h('h2', { id: 'plan-h' }, 'مخطط المجمّع'),
            h('span', { class: 'd2-note' }, `اضغط أي ${W.one} لفتحها`)),
          map,
          h('div', { class: 'd2-legend' },
            h('div', { class: 'ramp', 'aria-hidden': 'true' }, BANDS.map(([c]) => h('i', { class: 'tile ' + c }))),
            h('div', { class: 'ramp-labels' }, h('span', null, 'لم تبدأ'), h('span', null, 'مكتملة')),
            h('div', { class: 'flags' },
              h('span', null, h('i', { class: 'tile b1 flag-fail' }), 'بند فاشل أو NCR مفتوحة'),
              h('span', null, h('i', { class: 'tile b1 flag-alert' }), 'تنبيه تسلسل')))),
        h('aside', { class: 'd2-side' },
          h('section', { class: 'd2-attn' + (attn.length ? ' has' : '') },
            h('h2', null, 'تحتاج انتباهك'),
            attn.length
              ? h('ul', null, attn.slice(0, 30).map(({ u, k }) => h('li', null, h('a', { href: villaHref(p, u) },
                  h('b', null, u.code), h('span', { class: 'why' + (problem(k) ? '' : ' alert') }, why(k)), h('span', { class: 'nx' }, k.V === '-' ? '' : 'التالي: ' + k.V.name_ar)))))
              : h('p', { class: 'calm' }, 'لا فشل ولا تنبيهات ولا NCR مفتوحة.')),
          h('section', { class: 'd2-mix' },
            h('h2', null, `حالة ${W.theMany}`),
            h('div', { class: 'mixbar', role: 'img', 'aria-label': mix.map(([, v, l]) => `${l} ${v}`).join('، ') },
              mix.filter(([, v]) => v > 0).map(([c, v]) => { const s2 = h('span', { class: c }); s2.style.flexGrow = String(v); return s2; })),
            h('ul', { class: 'mix-key' }, mix.map(([c, v, l]) => h('li', null, h('i', { class: c }), `${l}: ${num(v)}`)))))),
      h('section', { class: 'd2-route', 'aria-labelledby': 'route-h' },
        h('h2', { id: 'route-h' }, 'مسار الفحص'),
        h('p', { class: 'd2-note' }, `عدد ${W.theMany} التي نجحت في كل مرحلة، بالترتيب. المرحلة الفاشلة أو المعلّقة توقف ما بعدها.`),
        h('ol', null, D.per.map((x) => h('li', { class: x.Fail ? 'has-fail' : '' },
          h('span', { class: 'st-n' }, String(x.c.position)),
          h('span', { class: 'st-name' }, x.c.name_ar, h('small', { dir: 'ltr' }, x.c.itp_ref)),
          h('span', { class: 'st-bar', 'aria-hidden': 'true' }, h('span', { style: { width: (x.pct * 100).toFixed(1) + '%' } })),
          h('span', { class: 'st-count' }, h('b', null, num(x.Pass)), x.Fail ? h('em', null, `${x.Fail} فاشل`) : null))))));
  }

  /* ==========================================================
     متابعة الفلل
     ========================================================== */
  function sheetTracker(p, d) {
    const cps = S.checkpoints;
    const f = S._tf || (S._tf = { q: '', zone: '', crew: '', status: '', next: '', sort: mobile() ? 'priority' : 'code' });
    // الأولوية: مشكلة ← جارية ← لم تبدأ ← مكتملة
    const rank = (k) => (k.R || k.W || k.T ? 0 : k.U === 'In progress' ? 1 : k.U === 'Not started' ? 2 : 3);
    const zones = [...new Set(d.units.map((u) => u.zone).filter(Boolean))].sort();
    const crews = [...new Set(d.units.map((u) => u.crew).filter(Boolean))].sort();
    const box = h('div');
    const count = h('span', { class: 'muted small' });
    const isMobile = mobile();

    const visible = (u, k) => (!f.q || u.code.toLowerCase().includes(f.q.toLowerCase()))
      && (!f.zone || u.zone === f.zone) && (!f.crew || u.crew === f.crew)
      && (!f.status || (f.status === 'alert' ? k.W : k.U === f.status))
      && (!f.next || (f.next === '-' ? k.V === '-' : k.V !== '-' && k.V.key === f.next));

    const draw = () => {
      let list = d.units.map((u) => ({ u, k: F.row(u, cps, A.openNcrsOf(d, u.id)) })).filter(({ u, k }) => visible(u, k));
      if (f.sort === 'priority') list = list.map((x, i) => ({ ...x, i })).sort((a, b) => rank(a.k) - rank(b.k) || b.k.S - a.k.S || a.i - b.i);
      count.textContent = `${num(list.length)} من ${num(d.units.length)} ${W.one}`;
      clear(box).appendChild(!list.length ? A.empty(`لا توجد ${W.many} مطابقة`)
        : isMobile ? villaCards(p, list) : trackerTable(p, d, list));
    };
    const sel = (key, label, opts) => h('select', { 'aria-label': label, onChange: (e) => { f[key] = e.target.value; draw(); } },
      h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));
    const filters = [
      h('input', { type: 'search', placeholder: `بحث برقم ${W.the}`, value: f.q, 'aria-label': 'بحث', onInput: (e) => { f.q = e.target.value; draw(); } }),
      zones.length ? sel('zone', 'كل المناطق', zones.map((z) => [z, z])) : null,
      crews.length ? sel('crew', 'كل الفرق', crews.map((z) => [z, z])) : null,
      sel('status', 'كل الحالات', [['Has failure', 'فيها فشل'], ['alert', 'تنبيه تسلسل'], ['In progress', 'جارية'], ['Not started', 'لم تبدأ'], ['Complete', 'مكتملة']]),
      sel('next', 'كل الخطوات التالية', cps.map((c) => [c.key, c.name_ar]).concat([['-', 'لا شيء (مكتملة)']]))
    ];
    filters.push(h('select', { 'aria-label': 'الترتيب', onChange: (e) => { f.sort = e.target.value; draw(); } },
      h('option', { value: 'priority', selected: f.sort === 'priority' }, 'الترتيب: الأولوية'),
      h('option', { value: 'code', selected: f.sort === 'code' }, `الترتيب: رقم ${W.the}`)));
    const active = ['q', 'zone', 'crew', 'status', 'next'].filter((k) => f[k]).length;

    draw();
    return h('div', { class: 'stack' },
      isMobile
        ? h('details', { class: 'filters-m', open: active > 0 }, h('summary', null, 'بحث وتصفية', active ? ` (${active})` : ''), h('div', { class: 'filters' }, filters))
        : h('div', { class: 'filters' }, filters),
      h('div', { class: 'row between' }, count,
        isMobile ? null : h('div', { class: 'legend' }, RES_KEYS.map((k) => h('span', null, h('i', { class: 'sym r-' + k }, SYM[k]), A.RES_AR[k])))),
      box,
      !isMobile && A.isStaff() ? h('p', { class: 'muted small' }, `اضغط أي خانة لتغيير نتيجتها، أو اضغط رقم ${W.the} لفتح صفحتها.`) : null);
  }

  function trackerTable(p, d, list) {
    const cps = S.checkpoints;
    const staff = A.isStaff();
    return h('div', { class: 'xl-wrap' }, h('table', { class: 'xl tracker' },
      h('thead', null,
        h('tr', { class: 'itp' }, h('th', { class: 'stk' }), h('th'), h('th'), cps.map((c) => h('th', { dir: 'ltr' }, c.itp_ref)), h('th', { colspan: 8 })),
        h('tr', null,
          h('th', { class: 'stk' }, `${W.the}`), h('th', null, 'المنطقة'), h('th', null, 'الفرقة'),
          cps.map((c) => h('th', { class: 'cp', title: c.name_en }, c.name_ar)),
          h('th', { class: 'f' }, 'ناجح'), h('th', { class: 'f' }, 'فاشل'), h('th', { class: 'f' }, 'الإنجاز'), h('th', { class: 'f' }, 'NCR'),
          h('th', { class: 'f' }, 'الحالة'), h('th', { class: 'f' }, 'الخطوة التالية'), h('th', { class: 'f' }, 'تنبيه'), h('th', null, 'ملاحظات'))),
      h('tbody', null, list.map(({ u, k }) => {
        const tr = h('tr', { class: k.W ? 'alert-row' : '' },
          h('td', { class: 'stk' }, h('a', { href: villaHref(p, u), class: 'vlink' }, u.code)),
          h('td', null, u.zone || ''), h('td', null, u.crew || ''),
          cps.map((c) => {
            const r = u.results?.[c.key] || 'pending';
            const label = `${u.code} · ${c.name_ar}: ${A.RES_AR[r]}`;
            return h('td', { class: 'res' }, staff
              ? h('button', { type: 'button', class: 'cell r-' + r, title: label, 'aria-label': label, onClick: () => pickResult(p, d, u, c) }, SYM[r])
              : h('span', { class: 'cell r-' + r, title: label }, SYM[r]));
          }),
          h('td', { class: 'calc num' }, String(k.Q)),
          h('td', { class: 'calc num' + (k.R ? ' c-fail' : '') }, String(k.R)),
          h('td', { class: 'calc num' }, A.pctText(k.S)),
          h('td', { class: 'calc num' + (k.T ? ' c-fail' : '') }, k.T ? String(k.T) : ''),
          h('td', { class: 'calc' }, statusChip(k.U)),
          h('td', { class: 'calc' }, k.V === '-' ? '—' : k.V.name_ar),
          h('td', { class: 'calc' }, k.W ? h('span', { class: 'chip alert' }, 'تنبيه') : ''),
          h('td', { class: 'rem', title: u.remarks || '' }, u.remarks || ''));
        return tr;
      }))));
  }

  function villaCards(p, list) {
    let lastGroup = null;
    const groupName = (k) => (k.R || k.W || k.T ? 'تحتاج انتباهاً' : k.U === 'In progress' ? 'جارية' : k.U === 'Not started' ? 'لم تبدأ' : 'مكتملة');
    const sorted = (S._tf || {}).sort === 'priority';
    const out = [];
    list.forEach(({ u, k }) => {
      const g = groupName(k);
      if (sorted && g !== lastGroup) { out.push(h('li', { class: 'vgroup' }, g)); lastGroup = g; }
      out.push(h('li', null, h('a', { href: villaHref(p, u), class: 'vcard' + (k.W || k.R ? ' warn' : '') },
        h('b', { class: 'vc-code' }, u.code),
        h('span', { class: 'vc-mid' },
          h('span', { class: 'vc-next' }, k.V === '-' ? 'مكتملة' : k.V.name_ar),
          h('span', { class: 'vc-tags' }, k.W ? h('span', { class: 'chip alert' }, 'تنبيه') : null, k.R ? h('span', { class: 'chip st-has-failure' }, `${k.R} فاشل`) : null,
            k.T ? h('span', { class: 'chip' }, `${k.T} NCR`) : null)),
        h('span', { class: 'vc-pct' }, A.pctText(k.S), pbar(k.S)))));
    });
    return h('ul', { class: 'vcards' }, out);
  }

  // اختيار نتيجة بأزرار كبيرة
  function pickResult(p, d, u, c) {
    const cur = u.results?.[c.key] || 'pending';
    const set = async (v) => {
      const ok = await saveResult(u, c, v);
      if (ok) { document.getElementById('dialog').close(); A.render(); }
    };
    A.modal(`${u.code} · ${c.name_ar}`, h('div', { class: 'stack sm' },
      h('p', { class: 'muted small', dir: 'ltr' }, c.itp_ref + ' · ' + c.name_en),
      h('div', { class: 'pick4' }, RES_KEYS.map((v) => h('button', { type: 'button', class: 'pick r-' + v + (v === cur ? ' on' : ''), 'aria-pressed': String(v === cur), onClick: () => set(v) },
        h('span', { class: 'sym' }, SYM[v]), A.RES_AR[v])))), []);
  }

  async function saveResult(u, c, v) {
    const res = await S.sb.from('unit_checks').update({ result: v }).eq('unit_id', u.id).eq('checkpoint', c.key).select('result').maybeSingle();
    if (res.error || !res.data) { A.fail(res.error || 'permission denied'); return false; }
    u.results = { ...u.results, [c.key]: v };
    return true;
  }

  /* ==========================================================
     صفحة الفيلا
     ========================================================== */
  function villaPage(p, d, u) {
    const cps = S.checkpoints;
    const staff = A.isStaff();
    const k = F.row(u, cps, A.openNcrsOf(d, u.id));
    const i = d.units.indexOf(u);
    const prev = d.units[i - 1], next = d.units[i + 1];
    const t = d.tests.get(u.id) || {};
    const c = F.test(t, p);
    const ncrs = d.ncrs.filter((n) => n.unit_id === u.id);

    // شرح تنبيه التسلسل بنفس شروط معادلة الملف
    const r = (key) => u.results?.[key] || 'pending';
    const alerts = [];
    if (r('insulation') === 'pass' && (r('pressure_test') !== 'pass' || r('vacuum') !== 'pass')) alerts.push('العزل ناجح قبل نجاح فحص الضغط والفاكيوم');
    if (r('charging') === 'pass' && (r('pressure_test') !== 'pass' || r('vacuum') !== 'pass' || r('megger') !== 'pass')) alerts.push('شحن الفريون ناجح قبل نجاح الضغط والفاكيوم والميغر');
    if (r('commissioning') === 'pass' && r('charging') !== 'pass') alerts.push('التشغيل التجريبي ناجح قبل نجاح شحن الفريون');

    const info = staff ? (() => {
      const f = { code: h('input', { value: u.code, maxlength: 40, dir: 'ltr' }), zone: h('input', { value: u.zone || '', maxlength: 60 }),
        crew: h('input', { value: u.crew || '', maxlength: 60 }), remarks: h('textarea', { rows: 2, maxlength: 2000, value: u.remarks || '' }) };
      const save = async () => {
        if (!f.code.value.trim()) return toast(`رقم ${W.the} مطلوب`, 'error');
        const patch = { code: f.code.value.trim(), zone: f.zone.value.trim() || null, crew: f.crew.value.trim() || null, remarks: f.remarks.value.trim() || null };
        const res = await S.sb.from('units').update(patch).eq('id', u.id).select().maybeSingle();
        if (res.error || !res.data) return A.fail(res.error || 'permission denied');
        Object.assign(u, patch); toast('تم الحفظ'); A.render();
      };
      return h('details', { class: 'panel' }, h('summary', null, `بيانات ${W.the}: `, [u.zone, u.crew].filter(Boolean).join(' · ') || 'بدون منطقة وفرقة'),
        h('div', { class: 'form-grid' }, A.field(`رقم ${W.the}`, f.code), A.field('المنطقة', f.zone), A.field('الفرقة', f.crew), A.field('ملاحظات', f.remarks, { wide: true })),
        h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn primary', onClick: save }, 'حفظ')));
    })() : (u.zone || u.crew || u.remarks ? h('p', { class: 'muted' }, [u.zone, u.crew, u.remarks].filter(Boolean).join(' · ')) : null);

    const reading = (label, val, chk) => h('div', { class: 'rd' }, h('span', { class: 'muted small' }, label), h('b', null, blank(val) ? '—' : String(val)),
      chk ? h('span', { class: 'chip ' + (chk === 'OK' ? 'st-complete' : 'st-has-failure') }, CHECK_AR[chk]) : null);

    return h('div', { class: 'stack villa' },
      h('div', { class: 'row between' },
        h('a', { href: `#/project/${p.id}/tracker`, class: 'link' }, `→ متابعة ${W.theMany}`),
        h('div', { class: 'row' },
          prev ? h('a', { href: villaHref(p, prev), class: 'btn sm', 'aria-label': `${W.the} السابقة` }, '→ ' + prev.code) : null,
          next ? h('a', { href: villaHref(p, next), class: 'btn sm', 'aria-label': `${W.the} التالية` }, next.code + ' ←') : null)),
      h('section', { class: 'panel vhead' },
        h('div', { class: 'row between' }, h('h1', null, u.code), statusChip(k.U)),
        h('div', { class: 'vc-bar' }, pbar(k.S), h('b', null, A.pctText(k.S)), h('span', { class: 'muted small' }, `${k.Q} ناجح · ${k.R} فاشل`)),
        h('p', null, 'الخطوة التالية: ', h('b', null, k.V === '-' ? '—' : k.V.name_ar)),
        alerts.length ? h('div', { class: 'alert-box' }, h('b', null, 'تنبيه تسلسل: '), alerts.join('. ')) : null),
      info,
      staff && k.V !== '-' ? h('section', { class: 'panel quick' },
        h('span', { class: 'muted small' }, 'الخطوة التالية'),
        h('b', { class: 'quick-name' }, k.V.name_ar, ' ', h('small', { class: 'muted', dir: 'ltr' }, k.V.itp_ref)),
        h('div', { class: 'quick-btns' },
          h('button', { type: 'button', class: 'btn big pass', onClick: async () => { if (await saveResult(u, k.V, 'pass')) { toast(`${u.code} · ${k.V.name_ar}: ناجح`); A.render(); } } }, '✓ ناجح'),
          h('button', { type: 'button', class: 'btn big fail', onClick: async () => { if (await saveResult(u, k.V, 'fail')) { toast(`${u.code} · ${k.V.name_ar}: فاشل. أضف NCR`, 'error'); A.render(); } } }, '✗ فاشل'))) : null,
      h('section', { class: 'panel' }, h('h2', null, 'نقاط الفحص'),
        (() => {
          const row = (cp) => {
            const v = r(cp.key);
            return h('li', { class: 'cp-row v-' + v },
              h('div', { class: 'cp-name' }, h('span', { class: 'cp-n' }, String(cp.position)), h('div', null, h('b', null, cp.name_ar), h('small', { class: 'muted', dir: 'ltr' }, cp.itp_ref))),
              staff
                ? h('div', { class: 'seg4', role: 'group', 'aria-label': cp.name_ar }, RES_KEYS.map((x) => h('button', {
                    type: 'button', class: 'r-' + x + (x === v ? ' on' : ''), 'aria-pressed': String(x === v),
                    onClick: async () => { if (x !== v && await saveResult(u, cp, x)) A.render(); }
                  }, A.RES_AR[x])))
                : h('span', { class: 'chip r-' + v }, A.RES_AR[v]));
          };
          const done = cps.filter((cp) => ['pass', 'na'].includes(r(cp.key)) && !(alerts.length && ['insulation', 'charging', 'commissioning'].includes(cp.key)));
          const rest = cps.filter((cp) => !done.includes(cp));
          return [
            done.length ? h('details', { class: 'done-group' },
              h('summary', null, `✓ ${done.length} مرحلة ناجحة أو لا تنطبق`, h('span', { class: 'muted small' }, ' (عرض وتعديل)')),
              h('ol', { class: 'cp-list' }, done.map(row))) : null,
            h('ol', { class: 'cp-list' }, rest.map(row))
          ];
        })()),
      h('section', { class: 'panel' },
        h('div', { class: 'row between' }, h('h2', null, 'القراءات'), h('button', { type: 'button', class: 'btn sm primary', onClick: () => testForm(p, d, u) }, blank(t.unit_id) ? 'تسجيل قراءات' : 'تعديل القراءات')),
        blank(t.unit_id) ? h('p', { class: 'muted' }, 'لا توجد قراءات بعد.') : h('div', { class: 'rds' },
          reading('هبوط الضغط MPa', c.H, c.I), reading('الفاكيوم (مايكرون)', t.vacuum_microns, c.N),
          reading('فرق الشحن', c.R === '' ? '' : A.pctText(c.R), c.S), reading('الفاحص', t.inspector))),
      h('section', { class: 'panel' },
        h('div', { class: 'row between' }, h('h2', null, `عدم المطابقة (${ncrs.length})`),
          staff ? h('button', { type: 'button', class: 'btn sm', onClick: () => ncrForm(p, d, null, u, k.V === '-' ? null : k.V.key) }, '+ NCR') : null),
        ncrs.length ? h('ul', { class: 'ncr-mini' }, ncrs.map((n) => h('li', null,
          h('span', { class: 'chip ' + (n.status === 'open' ? 'st-has-failure' : 'st-complete') }, n.status === 'open' ? 'مفتوحة' : 'مغلقة'),
          h('b', null, n.ncr_no), ' ', S.checkpoints.find((x) => x.key === n.checkpoint)?.name_ar, ': ', n.description,
          staff ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => ncrForm(p, d, n) }, 'تعديل') : null)))
          : h('p', { class: 'muted' }, 'لا توجد.')));
  }

  /* ---------- تقرير اليوم ---------- */
  async function dailyReport(p, d) {
    const day = today();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const res = await A.fetchAll((a, b) => S.sb.from('unit_checks').select('unit_id, checkpoint, result, inspected_at, units!inner(project_id)')
      .eq('units.project_id', p.id).gte('inspected_at', start.toISOString()).order('inspected_at').range(a, b)).catch((e) => { A.fail(e); return null; });
    if (!res) return;
    const code = Object.fromEntries(d.units.map((u) => [u.id, u.code]));
    const cpName = Object.fromEntries(S.checkpoints.map((c) => [c.key, c.name_ar]));
    const D = F.dashboard(d, S.checkpoints);
    const cnt = { pass: 0, fail: 0, na: 0, pending: 0 };
    res.forEach((x) => { cnt[x.result]++; });
    const byVilla = new Map();
    res.forEach((x) => { const k = code[x.unit_id]; if (!byVilla.has(k)) byVilla.set(k, []); byVilla.get(k).push(`${cpName[x.checkpoint]} ${({ pass: '✓', fail: '✗', na: '—', pending: '↺' })[x.result]}`); });
    const fails = res.filter((x) => x.result === 'fail').map((x) => `${code[x.unit_id]}: ${cpName[x.checkpoint]}`);
    const openN = d.ncrs.filter((n) => n.status === 'open');
    const late = openN.filter((n) => n.due_date && n.due_date < day);
    const newN = d.ncrs.filter((n) => n.date_raised === day);
    const alerts = d.units.filter((u) => F.row(u, S.checkpoints, 0).W).map((u) => u.code);
    const lines = [
      `تقرير فحص الجودة - ${p.client}`,
      `التاريخ: ${day}`,
      '',
      `فحوصات اليوم: ${res.length} (ناجح ${cnt.pass}، فاشل ${cnt.fail}، لا ينطبق ${cnt.na}${cnt.pending ? `، أُعيد لمعلّق ${cnt.pending}` : ''})`,
      ...[...byVilla.entries()].map(([v, items]) => `• ${v}: ${items.join('، ')}`),
      '',
      fails.length ? `الفشل اليوم:\n${fails.map((x) => '• ' + x).join('\n')}` : 'لا فشل اليوم.',
      `NCR جديدة اليوم: ${newN.length} · مفتوحة: ${openN.length}${late.length ? ` (متأخرة ${late.length}: ${late.map((n) => n.ncr_no).join('، ')})` : ''}`,
      alerts.length ? `تنبيهات التسلسل: ${alerts.join('، ')}` : 'لا تنبيهات تسلسل.',
      '',
      `الإنجاز الكلي: ${A.pctText(D.B10)} · مكتملة ${D.B4} من ${D.B3} · جارية ${D.B5}`
    ];
    const text = lines.join('\n');
    const area = h('textarea', { rows: 14, readonly: true, value: text, class: 'report-text' });
    const actions = [
      { label: 'نسخ', run: async () => { try { await navigator.clipboard.writeText(text); toast('تم النسخ'); } catch (e) { area.select(); document.execCommand('copy'); toast('تم النسخ'); } return false; } }
    ];
    if (navigator.share) actions.push({ label: 'مشاركة', run: async () => { try { await navigator.share({ text }); } catch (e) { /* أُلغيت */ } return false; } });
    A.modal('تقرير اليوم', h('div', { class: 'stack sm' }, area,
      h('a', { class: 'btn wa', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, 'إرسال عبر واتساب'),
      h('p', { class: 'muted small' }, 'التقرير يشمل آخر تغيير على كل خانة اليوم.')), actions);
  }

  function addVillas(p, d) {
    const last = d.units.length;
    const prefix = h('input', { dir: 'ltr', value: 'V-' });
    const from = h('input', { type: 'number', min: 1, dir: 'ltr', value: last + 1 });
    const to = h('input', { type: 'number', min: 1, dir: 'ltr', value: last + 1 });
    const zone = h('input', { maxlength: 60 }), crew = h('input', { maxlength: 60 });
    A.modal(`إضافة ${W.many}`, h('div', { class: 'form-grid' }, A.field('البادئة', prefix), A.field('من رقم', from), A.field('إلى رقم', to), A.field('المنطقة', zone), A.field('الفرقة', crew)),
      [{ label: 'إضافة', cls: 'primary', run: async () => {
        const a = Number(from.value), b = Number(to.value);
        if (!(a >= 1 && b >= a && b - a < 2000)) { toast('تحقق من الأرقام', 'error'); return false; }
        const digits = Math.max(3, String(b).length);
        const pos = Math.max(0, ...d.units.map((u) => u.position || 0));
        const rows = [];
        for (let i = a; i <= b; i++) rows.push({ project_id: p.id, code: prefix.value.trim() + String(i).padStart(digits, '0'), position: pos + i - a + 1, zone: zone.value.trim() || null, crew: crew.value.trim() || null });
        for (let i = 0; i < rows.length; i += 500) {
          const r = await S.sb.from('units').upsert(rows.slice(i, i + 500), { onConflict: 'project_id,code', ignoreDuplicates: true });
          if (r.error) { A.fail(r.error); return false; }
        }
        await A.loadProject(p.id, true);
        toast('تمت الإضافة'); A.render();
      } }]);
  }

  /* ==========================================================
     سجل الفحوصات
     ========================================================== */
  const T_FIELDS = {
    system_id: ['الوحدة الخارجية / النظام', 'text'], pressure_date: ['تاريخ فحص الضغط', 'date'], test_pressure: ['ضغط الفحص (MPa)', 'num'],
    hold_hours: ['مدة الثبات (ساعة)', 'num'], start_mpa: ['ضغط البداية (MPa)', 'num'], end_mpa: ['ضغط النهاية (MPa)', 'num'],
    vacuum_date: ['تاريخ الفاكيوم', 'date'], vacuum_microns: ['الفاكيوم الواصل (مايكرون)', 'num'], vacuum_hold_min: ['ثبات الفاكيوم (دقيقة)', 'num'],
    vacuum_rise: ['ارتفاع الفاكيوم (مايكرون)', 'num'], charge_calc_kg: ['الشحن المحسوب (كغ)', 'num'], charge_actual_kg: ['الشحن الفعلي (كغ)', 'num'],
    cylinder_no: ['رقم الأسطوانة', 'text'], inspector: ['الفاحص', 'text']
  };

  function testForm(p, d, u) {
    const t = d.tests.get(u.id) || {};
    const el = {};
    for (const [k, [, kind]] of Object.entries(T_FIELDS)) {
      el[k] = h('input', { type: kind === 'num' ? 'number' : kind === 'date' ? 'date' : 'text', step: 'any', dir: 'ltr', inputmode: kind === 'num' ? 'decimal' : null, value: t[k] ?? '', maxlength: kind === 'text' ? 120 : null });
    }
    if (!t.unit_id && !el.inspector.value) el.inspector.value = S.profile.full_name || '';
    const grp = (title, keys) => h('fieldset', { class: 'grp' }, h('legend', null, title), h('div', { class: 'form-grid' }, keys.map((k) => A.field(T_FIELDS[k][0], el[k]))));
    A.modal(`قراءات ${u.code}`, h('div', { class: 'stack sm' },
      grp('فحص الضغط', ['system_id', 'pressure_date', 'test_pressure', 'hold_hours', 'start_mpa', 'end_mpa']),
      grp('الفاكيوم', ['vacuum_date', 'vacuum_microns', 'vacuum_hold_min', 'vacuum_rise']),
      grp('شحن الفريون', ['charge_calc_kg', 'charge_actual_kg', 'cylinder_no']),
      A.field('الفاحص', el.inspector)),
    [{ label: 'حفظ', cls: 'primary', run: async () => {
      const row = { unit_id: u.id };
      for (const [k, [, kind]] of Object.entries(T_FIELDS)) {
        const v = el[k].value.trim();
        if (kind === 'num') {
          if (v !== '' && !Number.isFinite(Number(v))) { toast(`قيمة غير صحيحة: ${T_FIELDS[k][0]}`, 'error'); return false; }
          row[k] = v === '' ? null : Number(v);
        } else row[k] = v || null;
      }
      const r = await S.sb.from('test_records').upsert(row, { onConflict: 'unit_id' }).select().single();
      if (r.error) { A.fail(r.error); return false; }
      d.tests.set(u.id, r.data);
      const c = F.test(r.data, p);
      const bad = [c.I === 'CHECK' && 'الضغط', c.N === 'CHECK' && 'الفاكيوم', c.S === 'CHECK' && 'الشحن'].filter(Boolean);
      toast(bad.length ? `تم الحفظ. راجع: ${bad.join('، ')} (خارج الحدود)` : 'تم حفظ القراءات', bad.length ? 'error' : 'ok');
      A.render();
    } }]);
  }

  function sheetTests(p, d) {
    const staff = A.isStaff();
    const f = S._tt || (S._tt = { q: '' });
    const tbody = h('tbody');
    const withData = () => d.units.filter((u) => d.tests.has(u.id));
    const cards = mobile() ? h('ul', { class: 'tcards' }) : null;
    const draw = () => {
      clear(tbody);
      const list = (f.q ? d.units.filter((u) => u.code.toLowerCase().includes(f.q.toLowerCase())) : withData());
      if (cards) { clear(cards); list.forEach((u) => cards.appendChild(testCard(p, d, u))); }
      list.forEach((u) => tbody.appendChild(testRow(p, d, u)));
      if (!list.length) {
        const msg = f.q ? `لا توجد ${W.one} بهذا الرقم` : `لا توجد قراءات بعد. ابحث عن ${W.one} لتسجيل قراءاتها.`;
        tbody.appendChild(h('tr', null, h('td', { colspan: 15, class: 'muted center' }, msg)));
        if (cards) cards.appendChild(h('li', { class: 'muted center' }, msg));
      }
    };
    const lim = (key, label, step) => A.field(label, h('input', { type: 'number', step, min: 0, dir: 'ltr', value: p[key], disabled: !staff, onChange: async (e) => {
      const v = Number(e.target.value);
      if (!(v >= 0) || e.target.value === '') { e.target.value = p[key]; return toast('قيمة غير صحيحة', 'error'); }
      const r = await S.sb.from('projects').update({ [key]: v }).eq('id', p.id).select().maybeSingle();
      if (r.error || !r.data) { e.target.value = p[key]; return A.fail(r.error || 'permission denied'); }
      Object.assign(p, r.data); draw(); summary.textContent = limText(); toast('تم تحديث الحد');
    } }));
    const limText = () => `حدود القبول: هبوط الضغط ≤ ${p.lim_pressure_drop} MPa · الفاكيوم ≤ ${p.lim_vacuum_max} مايكرون · الثبات ≥ ${p.lim_vacuum_hold} دقيقة · الارتفاع ≤ 50 · الشحن ±${Math.round(p.lim_charge_tol * 1000) / 10}%`;
    const summary = h('span', null, limText());
    draw();
    return h('div', { class: 'stack' },
      h('details', { class: 'limits' }, h('summary', null, summary, staff ? h('span', { class: 'link small' }, ' تعديل') : null),
        h('div', { class: 'form-grid compact' },
          lim('lim_pressure_drop', 'الهبوط المسموح (MPa)', 0.001), lim('lim_vacuum_max', 'الفاكيوم الأعلى (مايكرون)', 1),
          lim('lim_vacuum_hold', 'أقل ثبات (دقيقة)', 1), lim('lim_charge_tol', 'سماحية الشحن (0.05 = 5%)', 0.005)),
        h('p', { class: 'muted small' }, 'قيم نموذجية من الملف وليست قواعد البراند: راجعها مع كتالوج الشركة ونوع الفريون. حد هبوط الضغط يتأثر بتغيّر الحرارة أثناء الفحص.')),
      h('div', { class: 'filters' },
        h('input', { type: 'search', placeholder: `ابحث عن ${W.one} لتسجيل قراءاتها`, value: f.q, 'aria-label': 'بحث', onInput: (e) => { f.q = e.target.value; draw(); } }),
        h('span', { class: 'muted small' }, `${withData().length} ${W.one} لها قراءات`)),
      cards || h('div', { class: 'xl-wrap' }, h('table', { class: 'xl tests' },
        h('thead', null,
          h('tr', { class: 'grp' }, h('th', { class: 'stk' }), h('th', { colspan: 5 }, 'فحص الضغط'), h('th', { colspan: 4 }, 'الفاكيوم'), h('th', { colspan: 4 }, 'شحن الفريون'), h('th')),
          h('tr', null, h('th', { class: 'stk' }, `${W.the}`),
            h('th', null, 'التاريخ'), h('th', null, 'البداية'), h('th', null, 'النهاية'), h('th', { class: 'f' }, 'الهبوط'), h('th', { class: 'f' }, 'النتيجة'),
            h('th', null, 'التاريخ'), h('th', null, 'مايكرون'), h('th', null, 'ثبات (د)'), h('th', { class: 'f' }, 'النتيجة'),
            h('th', null, 'محسوب'), h('th', null, 'فعلي'), h('th', { class: 'f' }, 'الفرق'), h('th', { class: 'f' }, 'النتيجة'),
            h('th', null, 'الفاحص'))),
        tbody)));
  }

  function testCard(p, d, u) {
    const t = d.tests.get(u.id) || {};
    const c = F.test(t, p);
    const item = (label, val, chk) => h('div', { class: 'tc-item ' + (chk === 'CHECK' ? 'bad' : chk === 'OK' ? 'good' : '') },
      h('span', { class: 'muted small' }, label), h('b', null, blank(val) ? '—' : String(val)), chk ? h('span', { class: 'small' }, CHECK_AR[chk]) : null);
    return h('li', null, h('button', { type: 'button', class: 'tcard', onClick: () => testForm(p, d, u) },
      h('div', { class: 'row between' }, h('b', null, u.code), h('span', { class: 'muted small' }, t.inspector || '')),
      h('div', { class: 'tc-grid' },
        item('هبوط الضغط', c.H, c.I), item('الفاكيوم', t.vacuum_microns, c.N), item('فرق الشحن', c.R === '' ? '' : A.pctText(c.R), c.S))));
  }

  function testRow(p, d, u) {
    const t = d.tests.get(u.id) || {};
    const c = F.test(t, p);
    const chk = (v) => h('td', { class: 'calc ' + (v === 'CHECK' ? 'check' : v === 'OK' ? 'ok' : '') }, v ? CHECK_AR[v] : '');
    const v = (x) => h('td', { class: 'num' }, blank(x) ? '' : String(x));
    return h('tr', { class: 'clickable', title: 'اضغط لتسجيل أو تعديل القراءات', onClick: () => testForm(p, d, u) },
      h('td', { class: 'stk' }, h('a', { href: villaHref(p, u), class: 'vlink', onClick: (e) => e.stopPropagation() }, u.code)),
      v(t.pressure_date), v(t.start_mpa), v(t.end_mpa), h('td', { class: 'calc num' }, c.H === '' ? '' : String(c.H)), chk(c.I),
      v(t.vacuum_date), v(t.vacuum_microns), v(t.vacuum_hold_min), chk(c.N),
      v(t.charge_calc_kg), v(t.charge_actual_kg), h('td', { class: 'calc num' }, c.R === '' ? '' : A.pctText(c.R)), chk(c.S),
      h('td', null, t.inspector || ''));
  }

  /* ==========================================================
     عدم المطابقة (NCR)
     ========================================================== */
  function ncrForm(p, d, n, presetUnit, presetCp) {
    const cps = S.checkpoints;
    const el = {
      no: h('input', { value: n?.ncr_no || 'NCR-' + String(d.ncrs.length + 1).padStart(3, '0'), maxlength: 40, dir: 'ltr' }),
      date: h('input', { type: 'date', dir: 'ltr', value: n?.date_raised || today() }),
      villa: h('select', null, d.units.map((u) => h('option', { value: u.id, selected: u.id === (n?.unit_id || presetUnit?.id) }, u.code))),
      cp: h('select', null, cps.map((c) => h('option', { value: c.key, selected: c.key === (n?.checkpoint || presetCp) }, c.name_ar))),
      desc: h('textarea', { rows: 3, maxlength: 2000, value: n?.description || '', placeholder: 'مثال: هبوط الضغط 0.15 MPa خلال 24 ساعة، تسريب في الفلير' }),
      resp: h('input', { maxlength: 120, value: n?.responsible || '' }),
      due: h('input', { type: 'date', dir: 'ltr', value: n?.due_date || '' }),
      status: h('select', null, h('option', { value: 'open', selected: (n?.status || 'open') === 'open' }, 'مفتوحة'), h('option', { value: 'closed', selected: n?.status === 'closed' }, 'مغلقة')),
      closed: h('input', { type: 'date', dir: 'ltr', value: n?.date_closed || '' })
    };
    const actions = [{ label: n ? 'حفظ' : 'إضافة', cls: 'primary', run: async () => {
      if (!el.desc.value.trim()) { toast('الوصف مطلوب', 'error'); return false; }
      const row = { ncr_no: el.no.value.trim() || 'NCR', date_raised: el.date.value || today(), unit_id: el.villa.value, checkpoint: el.cp.value,
        description: el.desc.value.trim(), responsible: el.resp.value.trim() || null, due_date: el.due.value || null,
        status: el.status.value, date_closed: el.status.value === 'closed' ? (el.closed.value || today()) : null };
      const r = n ? await S.sb.from('ncrs').update(row).eq('id', n.id).select().maybeSingle()
        : await S.sb.from('ncrs').insert({ ...row, project_id: p.id }).select().single();
      if (r.error || !r.data) { A.fail(r.error || 'permission denied'); return false; }
      if (n) Object.assign(n, r.data); else d.ncrs.push(r.data);
      toast(n ? 'تم الحفظ' : `تمت إضافة ${r.data.ncr_no}. اجعل البند "فاشل" في متابعة ${W.theMany} إن لم يكن كذلك.`);
      A.render();
    } }];
    if (n && A.isAdmin()) actions.unshift({ label: 'حذف', cls: 'danger', run: async () => {
      if (!await confirmBox({ title: 'حذف NCR', body: `حذف ${n.ncr_no} نهائياً؟`, okText: 'حذف', danger: true })) return false;
      const r = await S.sb.from('ncrs').delete().eq('id', n.id);
      if (r.error) { A.fail(r.error); return false; }
      d.ncrs.splice(d.ncrs.indexOf(n), 1); A.render();
    } });
    A.modal(n ? `تعديل ${n.ncr_no}` : 'حالة عدم مطابقة جديدة', h('div', { class: 'form-grid' },
      A.field('رقم NCR', el.no), A.field('تاريخ الفتح', el.date), A.field(`${W.the}`, el.villa), A.field('نقطة الفحص', el.cp),
      A.field('الوصف', el.desc, { wide: true }), A.field('المسؤول عن الإصلاح', el.resp), A.field('موعد الإصلاح', el.due),
      A.field('الحالة', el.status, { hint: 'أغلقها فقط بعد إعادة الفحص والتأكد من الإصلاح' }), A.field('تاريخ الإغلاق', el.closed)), actions);
  }

  function sheetNcr(p, d) {
    const staff = A.isStaff();
    const code = Object.fromEntries(d.units.map((u) => [u.id, u]));
    const f = S._nf || (S._nf = { status: 'open' });
    const tbody = h('tbody');
    const draw = () => {
      clear(tbody);
      const list = d.ncrs.filter((n) => !f.status || n.status === f.status);
      list.forEach((n) => {
        const overdue = n.status === 'open' && n.due_date && n.due_date < today();
        const u = code[n.unit_id];
        tbody.appendChild(h('tr', { class: (overdue ? 'overdue ' : '') + (staff ? 'clickable' : ''), onClick: staff ? () => ncrForm(p, d, n) : null },
          h('td', { class: 'strong', dir: 'ltr' }, n.ncr_no), h('td', { dir: 'ltr' }, n.date_raised),
          h('td', null, u ? h('a', { href: villaHref(p, u), class: 'vlink', onClick: (e) => e.stopPropagation() }, u.code) : '—'),
          h('td', null, S.checkpoints.find((c) => c.key === n.checkpoint)?.name_ar), h('td', { class: 'desc' }, n.description),
          h('td', null, n.responsible || ''), h('td', { dir: 'ltr', class: overdue ? 'c-fail' : '' }, (n.due_date || '') + (overdue ? ' ⚠' : '')),
          h('td', null, h('span', { class: 'chip ' + (n.status === 'open' ? 'st-has-failure' : 'st-complete') }, n.status === 'open' ? 'مفتوحة' : 'مغلقة')),
          h('td', { dir: 'ltr' }, n.date_closed || '')));
      });
      if (!list.length) tbody.appendChild(h('tr', null, h('td', { colspan: 9, class: 'muted center' }, f.status === 'open' ? 'لا توجد حالات مفتوحة' : 'لا توجد حالات')));
    };
    const open = d.ncrs.filter((n) => n.status === 'open').length;
    const overdue = d.ncrs.filter((n) => n.status === 'open' && n.due_date && n.due_date < today()).length;
    draw();
    return h('div', { class: 'stack' },
      h('div', { class: 'filters' },
        h('select', { 'aria-label': 'الحالة', onChange: (e) => { f.status = e.target.value; draw(); } },
          h('option', { value: 'open', selected: f.status === 'open' }, `المفتوحة (${open})`),
          h('option', { value: 'closed', selected: f.status === 'closed' }, `المغلقة (${d.ncrs.length - open})`),
          h('option', { value: '', selected: !f.status }, `الكل (${d.ncrs.length})`)),
        overdue ? h('span', { class: 'chip st-has-failure' }, `${overdue} متأخرة عن موعدها`) : null,
        staff && d.units.length ? h('button', { type: 'button', class: 'btn primary sm', onClick: () => ncrForm(p, d, null) }, '+ NCR جديدة') : null),
      h('p', { class: 'muted small' }, `سطر لكل فشل. "مفتوحة" تُحسب على ${W.the} في متابعة ${W.theMany}. أغلقها فقط بعد إعادة الفحص والتأكد من الإصلاح.` + (staff ? ' اضغط أي سطر لتعديله.' : '')),
      h('div', { class: 'xl-wrap' }, h('table', { class: 'xl ncr' },
        h('thead', null, h('tr', null, ['الرقم', 'تاريخ الفتح', `${W.the}`, 'نقطة الفحص', 'الوصف', 'المسؤول', 'الموعد', 'الحالة', 'تاريخ الإغلاق'].map((x) => h('th', null, x)))),
        tbody)));
  }

  /* ==========================================================
     طريقة الاستخدام
     ========================================================== */
  function sheetGuide(p) {
    const del = async () => {
      if (!await confirmBox({ title: 'حذف المشروع', body: `سيُحذف "${p.client}" مع كل ${W.theMany} والنتائج والقراءات وNCR نهائياً.`, okText: 'حذف نهائي', danger: true })) return;
      const r = await S.sb.from('projects').delete().eq('id', p.id);
      if (r.error) return A.fail(r.error);
      S.projects = S.projects.filter((x) => x.id !== p.id); delete S.data[p.id];
      S._stayHome = true; A.go('home');
    };
    const rename = async (e) => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = p.client; return; }
      const r = await S.sb.from('projects').update({ client: v }).eq('id', p.id).select().maybeSingle();
      if (r.error || !r.data) return A.fail(r.error || 'permission denied');
      Object.assign(p, r.data); toast('تم تغيير الاسم');
    };
    return h('div', { class: 'stack guide' },
      h('p', null, `سطر واحد لكل ${W.one}. تحدّثه بعد كل فحص، ولوحة التحكم والتنبيهات تتحدث وحدها.`),
      h('h3', null, 'كيف يعمل'),
      h('ol', null,
        h('li', null, `المقاول يطلب فحصاً (RFI) ل${W.one} ونقطة فحص، مثلاً: V-014 فحص الضغط.`),
        h('li', null, `تفحص حسب قائمة ITP لذلك البند (رقم البند فوق كل عمود في متابعة ${W.theMany}).`),
        h('li', null, 'افتح ', h('b', null, `متابعة ${W.theMany}`), ` واضغط الخانة، أو افتح صفحة ${W.the} من الجوال، واختر: ناجح، فاشل، لا ينطبق، أو معلّق.`),
        h('li', null, 'سجّل قراءات الضغط والفاكيوم والشحن في ', h('b', null, 'سجل الفحوصات'), '. يظهر "راجع" إذا كانت القراءة خارج الحدود.'),
        h('li', null, 'إذا فشل أي بند، اجعله فاشلاً وأضف سطراً في ', h('b', null, 'عدم المطابقة'), '. أغلقه فقط بعد إعادة الفحص والتأكد من الإصلاح.'),
        h('li', null, h('b', null, 'لوحة التحكم'), ` تعرض التقدم لكل نقطة فحص، و${W.theMany} التي تحتاج انتباهك، وتنبيهات التسلسل (مثل عزل ناجح قبل فحص الضغط والفاكيوم).`)),
      h('h3', null, 'الرموز'),
      h('p', null, RES_KEYS.map((k) => h('span', { class: 'legend-item' }, h('i', { class: 'sym r-' + k }, SYM[k]), ' ' + A.RES_AR[k] + '  '))),
      h('h3', null, 'إعداد لمرة واحدة'),
      h('ol', { type: 'A' },
        h('li', null, `غيّر أرقام ${W.theMany} إلى أرقامكم الحقيقية من صفحة كل ${W.one}، واملأ المنطقة والفرقة حتى تستطيع التصفية.`),
        h('li', null, 'راجع حدود القبول في سجل الفحوصات مع كتالوج البراند ونوع الفريون.'),
        h('li', null, `إذا عندكم ${W.many} أكثر، اضغط "+ ${W.many}".`),
        h('li', null, `استخدم التصفية: حسب الفرقة لرؤية فرقة واحدة، أو الحالة لرؤية ${W.theMany} التي فيها فشل، أو الخطوة التالية لتخطيط فحوصات الغد.`)),
      h('h3', null, 'مثال'),
      h('p', null, 'شهدت فحص الضغط في V-014: اجعله "ناجح" وسجّل 4.00 بداية / 3.99 نهاية في سجل الفحوصات. الفاكيوم ما زال معلّقاً، فتظهر الخطوة التالية = الفاكيوم. لا تسمح بالعزل حتى ينجح الفاكيوم.'),
      h('p', { class: 'muted small' }, 'ملف Excel المُصدَّر بالإنجليزية وبنفس معادلات وأوراق الملف الأصلي.'),
      A.isStaff() ? h('section', { class: 'panel' }, h('h3', null, 'إعدادات المشروع'),
        (() => {
          const pf = A.projectFields(p);
          return h('div', { class: 'stack sm' }, pf.grid, h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary sm', onClick: async () => {
            const v = pf.values();
            if (!v.client) return toast('اسم المشروع مطلوب', 'error');
            const r = await S.sb.from('projects').update(v).eq('id', p.id).select().maybeSingle();
            if (r.error || !r.data) return A.fail(r.error || 'permission denied');
            Object.assign(p, r.data); toast('تم حفظ بيانات المشروع'); A.render();
          } }, 'حفظ بيانات المشروع')));
        })(),
        A.isAdmin() ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn danger sm', onClick: del }, 'حذف المشروع')) : null) : null);
  }

  /* ==========================================================
     تصدير Excel بنفس الملف (معادلات حقيقية + قوائم + تلوين)
     ========================================================== */
  function exportExcel(p, d) {
    try {
      const cps = S.checkpoints;
      const n = d.units.length;
      const L = 4 + Math.max(n, 1);                  // آخر صف في Villa Tracker
      const NL = Math.max(505, 5 + d.ncrs.length);    // آخر صف في NCR Register
      const col = (i) => X.colName(i);
      const H = (arr) => arr.map((v) => ({ v, s: 'header' }));
      const D = F.dashboard(d, cps);
      const VT = "'Villa Tracker'", NR = "'NCR Register'";

      // Dashboard
      const dash = [];
      dash[0] = [{ v: 'Dashboard - VRF villa installation QC', s: 'title' }];
      const dl = [['Villas in tracker', `COUNTA(${VT}!A5:A${L})`, D.B3], ['Fully complete', `COUNTIF(${VT}!U5:U${L},"Complete")`, D.B4],
        ['In progress', `COUNTIF(${VT}!U5:U${L},"In progress")`, D.B5], ['Not started', `COUNTIF(${VT}!U5:U${L},"Not started")`, D.B6],
        ['Villas with a failed item', `COUNTIF(${VT}!U5:U${L},"Has failure")`, D.B7], ['Sequence alerts', `COUNTIF(${VT}!W5:W${L},"SEQUENCE ALERT")`, D.B8],
        ['Open NCRs', `COUNTIF(${NR}!H6:H${NL},"Open")`, D.B9]];
      dl.forEach(([l, f, v], i) => { dash[2 + i] = [l, { f, v, s: 'calc' }]; });
      dash[9] = ['Overall inspection progress', { f: 'IFERROR(SUM(B15:B27)/(B3*13-SUM(E15:E27)),0)', v: D.B10, s: 'calcPct' }];
      dash[11] = [{ v: 'Progress by checkpoint', s: 'title' }];
      dash[12] = ['Counts update from the Villa Tracker. A failed or pending checkpoint blocks the next stage.'];
      dash[13] = H(['Checkpoint', 'Pass', 'Fail', 'Pending', 'N/A', '% pass (excl. N/A)']);
      D.per.forEach((x, i) => {
        const c = col(3 + i), r = 15 + i;
        const cnt = (w) => `COUNTIF(${VT}!${c}$5:${c}$${L},"${w}")`;
        dash[14 + i] = [x.c.name_en, { f: cnt('Pass'), v: x.Pass, s: 'calc' }, { f: cnt('Fail'), v: x.Fail, s: 'calc' }, { f: cnt('Pending'), v: x.Pending, s: 'calc' },
          { f: cnt('N/A'), v: x['N/A'], s: 'calc' }, { f: `IFERROR(B${r}/($B$3-E${r}),0)`, v: x.pct, s: 'calcPct' }];
      });

      // Villa Tracker
      const vt = [[{ v: 'Villa Tracker - one row per villa', s: 'title' }], ['Pick Pass / Fail / N/A / Pending in each checkpoint column. Row 3 shows the ITP item number.']];
      vt[2] = [null, null, null, ...cps.map((c) => ({ v: c.itp_ref, s: 'header' }))];
      vt[3] = H(['Villa', 'Zone', 'Crew', ...cps.map((c) => c.name_en), 'Passed', 'Failed', '% complete', 'Open NCRs', 'Status', 'Next step', 'Sequence alert', 'Remarks']);
      d.units.forEach((u, i) => {
        const r = 5 + i, k = F.row(u, cps, A.openNcrsOf(d, u.id));
        vt.push([u.code, u.zone || '', u.crew || '', ...cps.map((c) => A.RES[u.results?.[c.key] || 'pending']),
          { f: `COUNTIF(D${r}:P${r},"Pass")`, v: k.Q, s: 'calc' },
          { f: `COUNTIF(D${r}:P${r},"Fail")`, v: k.R, s: 'calc' },
          { f: `IFERROR(Q${r}/(13-COUNTIF(D${r}:P${r},"N/A")),0)`, v: k.S, s: 'calcPct' },
          { f: `COUNTIFS(${NR}!$C$6:$C$${NL},A${r},${NR}!$H$6:$H$${NL},"Open")`, v: k.T, s: 'calc' },
          { f: `IF(R${r}>0,"Has failure",IF(Q${r}+COUNTIF(D${r}:P${r},"N/A")=13,"Complete",IF(Q${r}=0,"Not started","In progress")))`, v: k.U, s: 'calc' },
          { f: `IF(U${r}="Complete","-",INDEX($D$4:$P$4,MATCH(1,INDEX(--((D${r}:P${r}="Pending")+(D${r}:P${r}="Fail")>0),0),0)))`, v: k.V === '-' ? '-' : k.V.name_en, s: 'calc' },
          { f: `IF(OR(AND(I${r}="Pass",OR(G${r}<>"Pass",H${r}<>"Pass")),AND(M${r}="Pass",OR(G${r}<>"Pass",H${r}<>"Pass",K${r}<>"Pass")),AND(N${r}="Pass",M${r}<>"Pass")),"SEQUENCE ALERT","")`, v: k.W ? 'SEQUENCE ALERT' : '', s: 'calc' },
          u.remarks || '']);
      });

      // Test Records
      const tr = [[{ v: 'Test Records - pressure, vacuum and refrigerant charge per villa', s: 'title' }],
        ['Allowed pressure drop (MPa)', { v: Number(p.lim_pressure_drop), s: 'input' }, null, null, 'Vacuum target (microns, max)', { v: Number(p.lim_vacuum_max), s: 'input' }, null, null,
          'Vacuum hold (min, min)', { v: Number(p.lim_vacuum_hold), s: 'input' }, null, null, 'Charge tolerance (%)', { v: Number(p.lim_charge_tol), s: 'input' }],
        ["Yellow limits are typical or assumed figures, not your brand's rules: confirm each against the manufacturer manual. Pressure drop limit must be adjusted for temperature change during the test."]];
      tr[3] = H(['Villa', 'Outdoor unit / system ID', 'Pressure test date', 'Test pressure (MPa)', 'Hold (hours)', 'Start (MPa)', 'End (MPa)', 'Drop (MPa)', 'Pressure check',
        'Vacuum date', 'Vacuum reached (microns)', 'Vacuum hold (min)', 'Vacuum rise (microns)', 'Vacuum check', 'Calculated charge (kg)', 'Actual charge (kg)',
        'Variance (kg)', 'Variance (%)', 'Charge check', 'Cylinder no.', 'Inspector']);
      tr[4] = [];
      d.units.forEach((u, i) => {
        const r = 6 + i, t = d.tests.get(u.id) || {}, c = F.test(t, p);
        const nv = (x) => (blank(x) ? '' : Number(x));
        tr.push([{ f: `${VT}!A${5 + i}`, v: u.code, s: 'calc' }, t.system_id || '', t.pressure_date || '', nv(t.test_pressure), nv(t.hold_hours), nv(t.start_mpa), nv(t.end_mpa),
          { f: `IF(OR(F${r}="",G${r}=""),"",F${r}-G${r})`, v: c.H, s: 'calc' },
          { f: `IF(H${r}="","",IF(H${r}<=$B$2,"OK","CHECK"))`, v: c.I, s: 'calc' },
          t.vacuum_date || '', nv(t.vacuum_microns), nv(t.vacuum_hold_min), nv(t.vacuum_rise),
          { f: `IF(K${r}="","",IF(AND(K${r}<=$F$2,L${r}>=$J$2,M${r}<=50),"OK","CHECK"))`, v: c.N, s: 'calc' },
          nv(t.charge_calc_kg), nv(t.charge_actual_kg),
          { f: `IF(OR(O${r}="",P${r}=""),"",P${r}-O${r})`, v: c.Q, s: 'calc' },
          { f: `IF(Q${r}="","",IFERROR(Q${r}/O${r},""))`, v: c.R, s: 'calcPct' },
          { f: `IF(R${r}="","",IF(ABS(R${r})<=$N$2,"OK","CHECK"))`, v: c.S, s: 'calc' },
          t.cylinder_no || '', t.inspector || '']);
      });
      const TL = 5 + Math.max(n, 1);

      // NCR Register
      const codeOf = Object.fromEntries(d.units.map((u) => [u.id, u.code]));
      const nr = [[{ v: 'NCR Register - every failed inspection item', s: 'title' }],
        ['Add one row per failure. Status Open counts against the villa in Villa Tracker. Set Closed only after you re-inspect.']];
      nr[4] = H(['NCR no.', 'Date raised', 'Villa', 'Checkpoint', 'Description', 'Responsible', 'Due date', 'Status', 'Date closed']);
      d.ncrs.forEach((x) => nr.push([x.ncr_no, x.date_raised || '', codeOf[x.unit_id] || '', S.checkpoints.find((c) => c.key === x.checkpoint)?.name_en || '',
        x.description, x.responsible || '', x.due_date || '', x.status === 'open' ? 'Open' : 'Closed', x.date_closed || '']));

      const resCf = (sqref) => ({ sqref, rules: [{ formula: '"Pass"', dxf: 0 }, { formula: '"Fail"', dxf: 1 }, { formula: '"Pending"', dxf: 2 }, { formula: '"N/A"', dxf: 3 }] });
      const okCf = (sqref) => ({ sqref, rules: [{ formula: '"OK"', dxf: 0 }, { formula: '"CHECK"', dxf: 5 }] });
      const blob = X.writeWorkbook([
        { name: 'How to use', rows: guideRows(), opts: { widths: [3, 120] } },
        { name: 'Dashboard', rows: dash, opts: { widths: [34, 10, 10, 10, 10, 18] } },
        { name: 'Villa Tracker', rows: vt, opts: {
          widths: [12, 10, 10, ...cps.map(() => 13), 8, 8, 11, 10, 13, 26, 16, 30], freezeRow: 4, freezeCol: 1, autoFilter: `A4:X${L}`,
          validations: [{ sqref: `D5:P${L}`, list: '"Pending,Pass,Fail,N/A"' }],
          cf: [resCf(`D5:P${L}`), { sqref: `U5:U${L}`, rules: [{ formula: '"Has failure"', dxf: 5 }, { formula: '"Complete"', dxf: 0 }] }, { sqref: `W5:W${L}`, rules: [{ formula: '"SEQUENCE ALERT"', dxf: 4 }] }] } },
        { name: 'Test Records', rows: tr, opts: { widths: [14, 14, 12, 10, 9, 9, 9, 10, 11, 12, 12, 11, 12, 11, 12, 12, 10, 10, 11, 14, 16], freezeRow: 4, freezeCol: 1,
          cf: [okCf(`I6:I${TL}`), okCf(`N6:N${TL}`), okCf(`S6:S${TL}`)] } },
        { name: 'NCR Register', rows: nr, opts: { widths: [12, 12, 10, 24, 55, 18, 12, 9, 12], freezeRow: 5,
          validations: [{ sqref: `H6:H${NL}`, list: '"Open,Closed"' }, { sqref: `C6:C${NL}`, list: `${VT}!$A$5:$A$${L}` }, { sqref: `D6:D${NL}`, list: `${VT}!$D$4:$P$4` }],
          cf: [{ sqref: `H6:H${NL}`, rules: [{ formula: '"Open"', dxf: 1 }, { formula: '"Closed"', dxf: 0 }] }] } }
      ]);
      A.download(blob, `${p.client.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60)} - VRF_QC_Tracker - ${today()}.xlsx`);
      toast('تم تنزيل ملف Excel');
    } catch (e) { A.fail(e); }
  }

  function guideRows() {
    const t = [
      'VRF villa QC tracker', 'One row per villa. You update it after each inspection; the dashboard and alerts update by themselves.', '', 'How it works',
      '1. Contractor requests an inspection (RFI) for a villa and a checkpoint, e.g. V-014 pressure test.',
      '2. You inspect using the ITP checklist for that item (item numbers are in the tracker headers, row 3).',
      "3. Open 'Villa Tracker', find the villa, and pick Pass, Fail, N/A or Pending from the dropdown in that checkpoint column.",
      "4. Pressure, vacuum and refrigerant charge values go in 'Test Records' (same villa row order). The sheet flags readings outside the limits in the yellow cells.",
      "5. If anything fails, set the checkpoint to Fail and add a line in 'NCR Register'. Close it there only after you re-inspect and the fix is verified.",
      "6. 'Dashboard' shows progress by checkpoint, the villas with failures, and sequence alerts (e.g. insulation marked Pass before pressure test and vacuum).",
      '', 'Exported from the Surour app. The app is the master copy: enter results in the app.'];
    return [[], ...t.map((x, i) => [null, i === 0 || x === 'How it works' ? { v: x, s: 'title' } : x])];
  }

  /* ==========================================================
     استيراد ملف VRF QC Tracker
     ========================================================== */
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const isEx = (v) => /example/i.test(String(v ?? ''));
  const numOr = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
  const RES_FROM = { pass: 'pass', fail: 'fail', 'n/a': 'na', pending: 'pending' };

  function importDialog(p) {
    const file = h('input', { type: 'file', accept: '.xlsx' });
    const out = h('div', { class: 'stack sm' });
    A.modal('استيراد ملف VRF QC Tracker', h('div', { class: 'stack sm' },
      h('p', { class: 'muted small' }, `يقرأ ${W.theMany} (Villa, Zone, Crew, Remarks) ونتائج المراحل من Villa Tracker، والقراءات والحدود الصفراء من Test Records، والحالات من NCR Register. ${W.theMany} الجديدة تُضاف، والقيم في الملف تحلّ محل الحالية.`),
      A.field('ملف Excel', file), out),
    [{ label: 'استيراد', cls: 'primary', run: async () => {
      if (!file.files[0]) { toast('اختر الملف', 'error'); return false; }
      await runImport(p, file.files[0], out);
      return false;   // تبقى النافذة مفتوحة لعرض النتيجة
    } }]);
  }

  async function runImport(p, fileObj, out) {
    const say = (t, cls = 'muted') => { clear(out).appendChild(h('p', { class: cls }, t)); };
    let wb;
    try { wb = await X.readWorkbook(await fileObj.arrayBuffer()); } catch (e) { return say('تعذّرت قراءة الملف: ' + (e.message || ''), 'err'); }
    const cps = S.checkpoints;
    const sheet = (re) => Object.entries(wb).find(([k]) => re.test(k))?.[1];
    const vt = sheet(/villa tracker/i);
    if (!vt) return say('لم أجد ورقة Villa Tracker', 'err');
    const hr = vt.findIndex((r) => r && norm(r[0]) === 'villa');
    if (hr < 0) return say('لم أجد صف العناوين في Villa Tracker', 'err');
    const head = vt[hr].map(norm);
    const ci = (name) => head.indexOf(norm(name));
    const units = [];
    for (let r = hr + 1; r < vt.length; r++) {
      const row = vt[r];
      if (!row || blank(row[0]) || isEx(row[0])) continue;
      const results = {};
      cps.forEach((c) => { const v = RES_FROM[norm(row[ci(c.name_en)])]; if (v) results[c.key] = v; });
      const s = (i, m) => (i >= 0 && !blank(row[i]) ? String(row[i]).trim().slice(0, m) : null);
      units.push({ code: String(row[0]).trim().slice(0, 40), zone: s(ci('zone'), 60), crew: s(ci('crew'), 60), remarks: s(ci('remarks'), 2000), results, position: units.length + 1 });
    }

    // Test Records
    const tests = [];
    let limits = null;
    const ts = sheet(/test records/i);
    if (ts) {
      const l = ts[1] || [];
      if ([l[1], l[5], l[9], l[13]].every((x) => typeof x === 'number')) limits = { lim_pressure_drop: l[1], lim_vacuum_max: l[5], lim_vacuum_hold: l[9], lim_charge_tol: l[13] };
      const th = ts.findIndex((r) => r && norm(r[0]) === 'villa');
      if (th >= 0) {
        const hh = ts[th].map(norm);
        const tc = (n) => hh.indexOf(norm(n));
        const map = { system_id: 'Outdoor unit / system ID', pressure_date: 'Pressure test date', test_pressure: 'Test pressure (MPa)', hold_hours: 'Hold (hours)',
          start_mpa: 'Start (MPa)', end_mpa: 'End (MPa)', vacuum_date: 'Vacuum date', vacuum_microns: 'Vacuum reached (microns)', vacuum_hold_min: 'Vacuum hold (min)',
          vacuum_rise: 'Vacuum rise (microns)', charge_calc_kg: 'Calculated charge (kg)', charge_actual_kg: 'Actual charge (kg)', cylinder_no: 'Cylinder no.', inspector: 'Inspector' };
        for (let r = th + 1; r < ts.length; r++) {
          const row = ts[r];
          if (!row || blank(row[0]) || isEx(row[0])) continue;
          const t = { code: String(row[0]).trim() };
          let any = false;
          for (const [k, name] of Object.entries(map)) {
            const v = tc(name) >= 0 ? row[tc(name)] : null;
            if (blank(v)) continue;
            any = true;
            t[k] = /date/.test(k) ? X.excelDate(v) : ['system_id', 'cylinder_no', 'inspector'].includes(k) ? String(v).slice(0, 120) : numOr(v);
          }
          if (any) tests.push(t);
        }
      }
    }

    // NCR Register
    const ncrs = [];
    const ns = sheet(/ncr/i);
    if (ns) {
      const nh = ns.findIndex((r) => r && norm(r[0]) === 'ncr no.');
      if (nh >= 0) {
        const hh = ns[nh].map(norm);
        const g = (row, n) => row[hh.indexOf(norm(n))];
        for (let r = nh + 1; r < ns.length; r++) {
          const row = ns[r];
          if (!row || isEx(row[0]) || blank(g(row, 'Villa')) || blank(g(row, 'Description'))) continue;
          const cp = cps.find((c) => norm(c.name_en) === norm(g(row, 'Checkpoint')));
          if (!cp) continue;
          ncrs.push({ ncr_no: String(g(row, 'NCR no.') || '').slice(0, 40), date_raised: X.excelDate(g(row, 'Date raised')) || today(), code: String(g(row, 'Villa')).trim(),
            checkpoint: cp.key, description: String(g(row, 'Description')).slice(0, 2000), responsible: blank(g(row, 'Responsible')) ? null : String(g(row, 'Responsible')).slice(0, 120),
            due_date: X.excelDate(g(row, 'Due date')), status: /closed/i.test(String(g(row, 'Status') || '')) ? 'closed' : 'open', date_closed: X.excelDate(g(row, 'Date closed')) });
        }
      }
    }

    const d = await A.loadProject(p.id, true);
    const existing = new Map(d.units.map((u) => [u.code, u]));
    const changes = units.reduce((s, u) => s + Object.entries(u.results).filter(([k, v]) => v !== (existing.get(u.code)?.results?.[k] || 'pending')).length, 0);
    if (!await confirmBox({ title: 'تأكيد الاستيراد', okText: 'استيراد',
      body: `في الملف ${units.length} ${W.one} (${units.filter((u) => !existing.has(u.code)).length} جديدة)، و${changes} نتيجة ستتغير، و${tests.length} سطر قراءات، و${ncrs.length} NCR. هل تتابع؟` })) return say('أُلغي الاستيراد');
    A.modal('جارٍ الاستيراد…', out, []);

    const errors = [];
    try {
      say(`${W.theMany}…`);
      const rows = units.map((u) => ({ project_id: p.id, code: u.code, zone: u.zone, crew: u.crew, remarks: u.remarks, position: u.position }));
      const fresh = rows.filter((r) => !existing.has(r.code));
      for (let i = 0; i < fresh.length; i += 500) {
        const r = await S.sb.from('units').insert(fresh.slice(i, i + 500));
        if (r.error) throw r.error;
      }
      for (const r of rows) {
        const e = existing.get(r.code);
        if (e && (e.zone !== r.zone || e.crew !== r.crew || e.remarks !== r.remarks || e.position !== r.position)) {
          const x = await S.sb.from('units').update({ zone: r.zone, crew: r.crew, remarks: r.remarks, position: r.position }).eq('id', e.id);
          if (x.error) errors.push(r.code + ': ' + A.errText(x.error));
        }
      }
      const d2 = await A.loadProject(p.id, true);
      const byCode = new Map(d2.units.map((u) => [u.code, u]));

      let done = 0;
      for (const u of units) {
        const cur = byCode.get(u.code);
        for (const [k, v] of Object.entries(u.results)) {
          if (v === (cur.results?.[k] || 'pending')) continue;
          const r = await S.sb.from('unit_checks').update({ result: v }).eq('unit_id', cur.id).eq('checkpoint', k);
          if (r.error) errors.push(`${u.code} ${k}: ${A.errText(r.error)}`); else done++;
          if (done % 10 === 0) say(`النتائج: ${done} من ${changes}…`);
        }
      }
      say('القراءات…');
      let tDone = 0;
      for (const t of tests) {
        const u = byCode.get(t.code);
        if (!u) { errors.push(t.code + `: ${W.the} غير موجودة (Test Records)`); continue; }
        const { code, ...row } = t;
        const r = await S.sb.from('test_records').upsert({ ...row, unit_id: u.id }, { onConflict: 'unit_id' });
        if (r.error) errors.push(t.code + ': ' + A.errText(r.error)); else tDone++;
      }
      if (limits) {
        const r = await S.sb.from('projects').update(limits).eq('id', p.id).select().maybeSingle();
        if (!r.error && r.data) Object.assign(p, r.data);
      }
      let nDone = 0;
      for (const x of ncrs) {
        const u = byCode.get(x.code);
        if (!u) { errors.push(x.code + `: ${W.the} غير موجودة (NCR)`); continue; }
        const { code, ...row } = x;
        const r = await S.sb.from('ncrs').insert({ ...row, ncr_no: row.ncr_no || 'NCR-' + String(nDone + 1).padStart(3, '0'), project_id: p.id, unit_id: u.id });
        if (r.error) errors.push((x.ncr_no || x.code) + ': ' + A.errText(r.error)); else nDone++;
      }
      await A.loadProject(p.id, true);
      clear(out).append(h('p', { class: 'ok-text' }, `✓ تم: ${units.length} ${W.one}، ${done} نتيجة، ${tDone} سطر قراءات، ${nDone} NCR.`),
        errors.length ? h('div', { class: 'err' }, h('b', null, `${errors.length} خطأ:`), h('ul', null, errors.slice(0, 30).map((e) => h('li', null, e)))) : null);
      A.modal('اكتمل الاستيراد', out, [{ label: 'عرض Villa Tracker', cls: 'primary', run: () => { A.go(`project/${p.id}/tracker`); A.render(); } }]);
    } catch (e) {
      A.fail(e);
      A.modal('توقف الاستيراد', h('p', { class: 'err' }, A.errText(e)), []);
    }
  }
})();
