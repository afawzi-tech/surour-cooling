/* ==========================================================
   متابعة مشاريع التبريد المركزي - مصاعد السرور (الإصدار 3)
   النواة: الدخول، التوجيه، الهيكل، المشاريع، المستخدمون، السجل، النسخ الاحتياطي.
   شاشات الفحص (الوحدات والمراحل والقراءات وNCR وExcel) في js/qc.js.
   كل الصلاحيات الحقيقية تُفرض على الخادم (supabase/schema.sql).
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, toast, confirmBox, num, date, dateTime, SAFE_URL } = window.UI;
  const root = document.getElementById('root');
  const cfg = window.SUROUR_CONFIG || {};

  /* ---------- الثوابت ---------- */
  const BRANDS = { lg: 'LG', midea: 'Midea' };
  const ROLES = { admin: 'مدير', supervisor: 'مشرف', technician: 'فني' };
  const RESULTS = { pending: 'معلّق', pass: 'ناجح', fail: 'فاشل', na: 'لا ينطبق' };
  const RESULTS_EN = { pending: 'Pending', pass: 'Pass', fail: 'Fail', na: 'N/A' };
  const UNIT_STATUS = { complete: 'مكتملة', in_progress: 'جارية', not_started: 'لم تبدأ', has_failure: 'بها فشل' };
  const UNIT_STATUS_EN = { complete: 'Complete', in_progress: 'In progress', not_started: 'Not started', has_failure: 'Has failure' };
  const TABLES = {
    profiles: 'المستخدمون', projects: 'المشاريع', project_finance: 'قيمة العقد', materials: 'المواد',
    units: 'الوحدات', unit_checks: 'نتائج الفحص', test_records: 'القراءات', ncrs: 'عدم المطابقة', brand_limits: 'حدود الفحص'
  };
  const ACTIONS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };

  /* ---------- الحالة ---------- */
  const state = {
    sb: null, user: null, profile: null,
    projects: [],          // مع project_finance للمدير والمشرف
    units: [],             // من unit_overview لكل المشاريع
    checkpoints: [],       // المراحل الثلاث عشرة بالترتيب
    limits: {},            // حدود الفحص حسب البراند
    filter: { q: '', brand: 'all' },
    unitFilter: {}         // تصفية جدول الوحدات لكل مشروع
  };

  const role = () => state.profile?.role;
  const isAdmin = () => role() === 'admin';
  const isStaff = () => role() === 'admin' || role() === 'supervisor';

  /* ---------- حسابات الوحدات (مثل معادلات ورقة Villa Tracker) ---------- */
  const weightOf = (p, key) => {
    const w = Number(p?.weights?.[key]);
    return Number.isFinite(w) && w >= 0 ? w : 1;
  };

  function unitCalc(u, p) {
    const r = u.results || {};
    const cps = state.checkpoints;
    let passed = 0, failed = 0, na = 0, wPass = 0, wAll = 0, wNa = 0;
    for (const c of cps) {
      const v = r[c.key] || 'pending';
      const w = weightOf(p, c.key);
      wAll += w;
      if (v === 'pass') { passed++; wPass += w; }
      else if (v === 'fail') failed++;
      else if (v === 'na') { na++; wNa += w; }
    }
    const pct = wAll - wNa > 0 ? wPass / (wAll - wNa) : 0;
    const status = failed > 0 ? 'has_failure'
      : passed + na === cps.length ? 'complete'
      : passed === 0 ? 'not_started' : 'in_progress';
    const next = status === 'complete' ? null : cps.find((c) => ['pending', 'fail'].includes(r[c.key] || 'pending'));
    // تنبيه التسلسل: مرحلة ناجحة قبل نجاح ما يسبقها
    const alerts = cps.filter((c) => r[c.key] === 'pass'
      && (c.prereqs || []).some((k) => !['pass', 'na'].includes(r[k] || 'pending')));
    return { passed, failed, na, pct, status, next, alerts };
  }

  function projectCalc(p) {
    const units = state.units.filter((u) => u.project_id === p.id);
    const calcs = units.map((u) => unitCalc(u, p));
    const count = (s) => calcs.filter((c) => c.status === s).length;
    let wPass = 0, wDen = 0;
    for (const u of units) {
      for (const c of state.checkpoints) {
        const v = u.results?.[c.key] || 'pending';
        const w = weightOf(p, c.key);
        if (v !== 'na') wDen += w;
        if (v === 'pass') wPass += w;
      }
    }
    return {
      units, calcs,
      total: units.length,
      complete: count('complete'), inProgress: count('in_progress'),
      notStarted: count('not_started'), withFailure: count('has_failure'),
      alerts: calcs.filter((c) => c.alerts.length).length,
      openNcrs: units.reduce((s, u) => s + Number(u.open_ncrs || 0), 0),
      pct: wDen ? wPass / wDen : 0
    };
  }

  const totalOf = (p) => {
    const f = Array.isArray(p.project_finance) ? p.project_finance[0] : p.project_finance;
    return f ? f.total_iqd : null;
  };
  const pctText = (x) => Math.round((x || 0) * 1000) / 10 + '%';

  /* ---------- رسائل الأخطاء ---------- */
  function errText(error) {
    const m = String(error?.message || error || '');
    if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
    if (/Email not confirmed/i.test(m)) return 'لم يتم تأكيد البريد الإلكتروني بعد';
    if (/[؀-ۿ]/.test(m)) return m.replace(/^.*?ERROR:\s*/, '');   // رسالة عربية من الخادم
    if (/duplicate key|unique/i.test(m)) return 'هذا الرمز موجود مسبقاً';
    if (/row-level security|permission denied/i.test(m)) return 'ليست لديك صلاحية لهذا الإجراء';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'تعذّر الاتصال بالخادم، تحقّق من الإنترنت';
    if (/check constraint|invalid input/i.test(m)) return 'بعض القيم غير مقبولة، راجع الحقول';
    return 'حدث خطأ غير متوقع، حاول مرة أخرى';
  }
  function fail(error) {
    console.error(error);
    toast(errText(error), 'error');
  }

  /* ---------- تحميل البيانات ---------- */
  // جلب كل الصفوف على دفعات (الحد الافتراضي للخادم 1000 صف)
  async function fetchAll(make) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await make(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  async function loadAll() {
    const sb = state.sb;
    const finance = isStaff() ? ', project_finance(total_iqd)' : '';
    const [projects, cps, limits, units] = await Promise.all([
      sb.from('projects').select('*' + finance).order('created_at', { ascending: false }),
      sb.from('qc_checkpoints').select('*').order('position'),
      sb.from('brand_limits').select('*'),
      fetchAll((a, b) => sb.from('unit_overview').select('*').order('code').range(a, b)).then((d) => ({ data: d }), (e) => ({ error: e }))
    ]);
    for (const r of [projects, cps, limits, units]) if (r.error) throw r.error;
    state.projects = projects.data;
    state.checkpoints = cps.data;
    state.limits = Object.fromEntries(limits.data.map((l) => [l.brand, l]));
    state.units = units.data;
  }

  async function reloadProject(id) {
    const finance = isStaff() ? ', project_finance(total_iqd)' : '';
    const { data, error } = await state.sb.from('projects').select('*' + finance).eq('id', id).maybeSingle();
    if (error) return fail(error);
    const i = state.projects.findIndex((p) => p.id === id);
    if (!data) state.projects = state.projects.filter((p) => p.id !== id);
    else if (i >= 0) state.projects[i] = data;
    else state.projects.unshift(data);
  }

  async function reloadUnits(projectId) {
    const rows = await fetchAll((a, b) => state.sb.from('unit_overview').select('*').eq('project_id', projectId).order('code').range(a, b));
    state.units = state.units.filter((u) => u.project_id !== projectId).concat(rows);
  }

  async function reloadUnit(unitId) {
    const { data, error } = await state.sb.from('unit_overview').select('*').eq('id', unitId).maybeSingle();
    if (error) return fail(error);
    const i = state.units.findIndex((u) => u.id === unitId);
    if (!data) state.units = state.units.filter((u) => u.id !== unitId);
    else if (i >= 0) state.units[i] = data;
    else state.units.push(data);
  }

  /* ---------- التشغيل ---------- */
  async function boot() {
    const configured = cfg.supabaseUrl && !/YOUR-PROJECT/.test(cfg.supabaseUrl)
      && cfg.supabaseAnonKey && !/YOUR-ANON-KEY/.test(cfg.supabaseAnonKey);
    if (!configured || !window.supabase) return renderSetupNeeded();

    state.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    state.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        Object.assign(state, { user: null, profile: null, projects: [], units: [] });
        render();
      } else if (event === 'SIGNED_IN' && session && session.user.id !== state.user?.id) {
        setTimeout(() => startSession(session.user), 0);
      }
    });
    const { data } = await state.sb.auth.getSession();
    if (data.session) await startSession(data.session.user);
    else render();
  }

  async function startSession(user) {
    state.user = user;
    const { data, error } = await state.sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) return fail(error);
    state.profile = data;
    if (data && data.active) {
      clear(root).appendChild(h('div', { class: 'loading' }, 'جارٍ تحميل البيانات…'));
      try { await loadAll(); } catch (e) { fail(e); }
    }
    render();
  }

  /* ---------- التوجيه ---------- */
  function parseRoute() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map(decodeURIComponent);
    return { name: parts[0], id: parts[1] || null, tab: parts[2] || null };
  }
  const go = (path) => { location.hash = '#/' + path; };
  window.addEventListener('hashchange', () => render());

  // الشاشات المسجّلة (qc.js يضيف شاشاته هنا)
  const views = {};

  /* ---------- الهيكل العام ---------- */
  function render() {
    const keepScroll = window.scrollY;
    const prev = state._lastHash;
    state._lastHash = location.hash;
    clear(root);
    if (!state.sb) return renderSetupNeeded();
    if (!state.user) return root.appendChild(viewLogin());
    if (!state.profile || !state.profile.active) return root.appendChild(viewInactive());

    const r = parseRoute();
    let v = views[r.name] || views.dashboard;
    if (v.allow && !v.allow()) v = views.dashboard;
    const title = typeof v.title === 'function' ? v.title(r) : v.title;

    const main = h('main', { class: 'main', id: 'main' });
    root.appendChild(h('div', { class: 'shell' }, sidebar(r.name), h('div', { class: 'content' }, h('header', { class: 'topbar' }, h('h1', null, title)), main)));
    const out = v.render(r);
    const place = (node) => { clear(main); main.appendChild(node); if (prev === location.hash) window.scrollTo(0, keepScroll); };
    if (out instanceof Promise) {
      main.appendChild(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
      out.then(place, (e) => { fail(e); place(empty('تعذّر التحميل')); });
    } else {
      place(out);
    }
    document.title = title + ' | مصاعد السرور';
  }

  function sidebar(active) {
    const links = [
      ['dashboard', 'لوحة التحكم', '◧', true],
      ['projects', 'المشاريع', '☰', true],
      ['new', 'مشروع جديد', '+', isStaff()],
      ['limits', 'حدود الفحص', '⚙', true],
      ['backup', 'النسخ الاحتياطي', '⇅', isStaff()],
      ['users', 'المستخدمون', '◉', isAdmin()],
      ['audit', 'سجل العمليات', '≡', isAdmin()]
    ];
    const current = ['project', 'edit', 'unit'].includes(active) ? 'projects' : active;
    return h('aside', { class: 'side' },
      h('div', { class: 'brand' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, '❄'),
        h('div', null, h('strong', null, 'مصاعد السرور'), h('small', null, 'التبريد المركزي'))),
      h('nav', { class: 'nav', 'aria-label': 'القائمة الرئيسية' },
        links.filter((l) => l[3]).map(([k, label, icon]) =>
          h('a', { href: '#/' + k, class: 'nav-link' + (current === k ? ' active' : ''), 'aria-current': current === k ? 'page' : null },
            h('span', { class: 'nav-icon', 'aria-hidden': 'true' }, icon), h('span', null, label)))),
      h('div', { class: 'side-foot' },
        h('div', { class: 'me' },
          h('strong', null, state.profile.full_name || state.user.email),
          h('small', null, ROLES[role()] || '')),
        h('button', { class: 'btn ghost sm', type: 'button', onClick: toggleTheme }, 'تبديل المظهر'),
        h('button', { class: 'btn ghost sm', type: 'button', onClick: signOut }, 'تسجيل الخروج')));
  }

  /* ---------- المظهر ---------- */
  function applyTheme() {
    let t = null;
    try { t = localStorage.getItem('surour_theme'); } catch (e) { /* غير متاح */ }
    if (t) document.documentElement.dataset.theme = t;
  }
  function toggleTheme() {
    const dark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('surour_theme', next); } catch (e) { /* غير متاح */ }
  }

  /* ---------- الدخول ---------- */
  function renderSetupNeeded() {
    clear(root).appendChild(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      h('span', { class: 'brand-mark big', 'aria-hidden': 'true' }, '❄'),
      h('h1', null, 'التطبيق غير مربوط بقاعدة البيانات بعد'),
      h('p', { class: 'muted' }, 'ضع رابط مشروع Supabase ومفتاح anon في الملف js/config.js، ثم أعد تحميل الصفحة.'))));
  }

  function viewLogin() {
    const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', dir: 'ltr', required: true });
    const pass = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
    const err = h('p', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'تسجيل الدخول');
    return h('div', { class: 'auth' }, h('form', {
      class: 'auth-card',
      onSubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true; btn.textContent = 'جارٍ التحقق…';
        const { error } = await state.sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        btn.disabled = false; btn.textContent = 'تسجيل الدخول';
        if (error) err.textContent = errText(error);
      }
    },
      h('span', { class: 'brand-mark big', 'aria-hidden': 'true' }, '❄'),
      h('h1', null, 'مصاعد السرور'),
      h('p', { class: 'muted' }, 'متابعة مشاريع التبريد المركزي وفحص الجودة'),
      field('البريد الإلكتروني', email),
      field('كلمة المرور', pass),
      err, btn,
      h('p', { class: 'muted small' }, 'الحسابات يُنشئها المدير. إذا نسيت كلمة المرور فتواصل معه.')));
  }

  function viewInactive() {
    return h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      h('h1', null, 'الحساب غير مفعّل'),
      h('p', { class: 'muted' }, 'حسابك موجود لكنه غير مفعّل. تواصل مع المدير.'),
      h('button', { class: 'btn ghost', type: 'button', onClick: signOut }, 'تسجيل الخروج')));
  }

  async function signOut() {
    await state.sb.auth.signOut();
    location.hash = '';
  }

  /* ---------- عناصر مشتركة ---------- */
  function field(label, input, opts = {}) {
    if (!input.id) input.id = 'f-' + Math.random().toString(36).slice(2, 8);
    return h('div', { class: 'field' + (opts.wide ? ' wide' : '') },
      h('label', { for: input.id }, label, opts.required ? h('span', { class: 'req' }, ' *') : null),
      input, opts.err || null, opts.hint ? h('small', { class: 'muted' }, opts.hint) : null);
  }
  const brandChip = (b) => (BRANDS[b] ? h('span', { class: 'brand-chip ' + b, dir: 'ltr' }, BRANDS[b]) : null);
  const resultChip = (r) => h('span', { class: 'res res-' + (r || 'pending') }, RESULTS[r || 'pending']);
  const statusChip = (s) => h('span', { class: 'ust ust-' + s }, UNIT_STATUS[s]);
  function progress(v) {
    const p = Math.round((v || 0) * 100);
    return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': p, 'aria-valuemin': 0, 'aria-valuemax': 100 },
      h('span', { style: { width: p + '%' } }));
  }
  const empty = (title, sub, action) =>
    h('div', { class: 'empty' }, h('strong', null, title), sub ? h('p', { class: 'muted' }, sub) : null, action || null);
  const kpi = (label, value, tone = '') =>
    h('div', { class: 'kpi ' + tone }, h('span', { class: 'kpi-label' }, label), h('strong', { class: 'kpi-value' }, value));

  // نافذة عامة: body عنصر، وactions مصفوفة أزرار تُرجع true لإغلاق النافذة
  function modal(title, body, actions) {
    const dlg = document.getElementById('dialog');
    clear(dlg);
    const close = () => dlg.close();
    const btns = actions.map((a) => h('button', {
      type: 'button', class: 'btn ' + (a.cls || ''),
      onClick: async (e) => {
        if (!a.run) return close();
        e.currentTarget.disabled = true;
        try { if (await a.run() !== false) close(); } finally { e.currentTarget.disabled = false; }
      }
    }, a.label));
    dlg.appendChild(h('form', { method: 'dialog', class: 'dialog-body', onSubmit: (e) => e.preventDefault() },
      h('h2', null, title), body, h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn ghost', onClick: close }, 'إلغاء'), btns)));
    dlg.showModal();
  }

  function download(blob, name) {
    const a = h('a', { download: name });
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- لوحة التحكم العامة ---------- */
  views.dashboard = {
    title: 'لوحة التحكم',
    render() {
      const all = state.projects;
      const stats = all.map((p) => ({ p, c: projectCalc(p) }));
      const sum = (k) => stats.reduce((s, x) => s + x.c[k], 0);
      const units = sum('total');
      let wP = 0, wD = 0;
      stats.forEach(({ c }) => { wP += c.pct * c.total; wD += c.total; });

      const kpis = [
        kpi('المشاريع', num(all.length)),
        kpi('الوحدات', num(units)),
        kpi('وحدات مكتملة', num(sum('complete')), 'tone-done'),
        kpi('وحدات جارية', num(sum('inProgress')), 'tone-doing'),
        kpi('وحدات بها فشل', num(sum('withFailure')), 'tone-fail'),
        kpi('تنبيهات التسلسل', num(sum('alerts')), 'tone-fail'),
        kpi('حالات عدم مطابقة مفتوحة', num(sum('openNcrs')), 'tone-fail'),
        kpi('نسبة الإنجاز الكلية', pctText(wD ? wP / wD : 0))
      ];
      if (isStaff()) kpis.push(kpi('إجمالي قيم العقود (د.ع)', num(all.reduce((s, p) => s + (Number(totalOf(p)) || 0), 0))));

      return h('div', { class: 'stack' },
        h('section', { class: 'kpis' }, kpis),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'المشاريع'), h('a', { href: '#/projects', class: 'link' }, 'عرض الكل')),
          all.length ? projectTable(stats.slice(0, 8)) : empty('لا توجد مشاريع بعد', isStaff() ? 'ابدأ بإضافة أول مشروع.' : '',
            isStaff() ? h('a', { href: '#/new', class: 'btn primary' }, 'مشروع جديد') : null)));
    }
  };

  function projectTable(stats) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null,
        h('th', null, 'المشروع'), h('th', null, 'الوحدات'), h('th', null, 'مكتملة'), h('th', null, 'بها فشل'),
        h('th', null, 'NCR مفتوحة'), h('th', { class: 'w-prog' }, 'الإنجاز'))),
      h('tbody', null, stats.map(({ p, c }) => h('tr', { class: 'clickable', onClick: () => go('project/' + p.id) },
        h('td', null, h('a', { href: '#/project/' + p.id, class: 'strong-link' }, p.client), ' ', brandChip(p.brand),
          p.address ? h('div', { class: 'muted small' }, p.address) : null),
        h('td', null, num(c.total)),
        h('td', null, num(c.complete)),
        h('td', { class: c.withFailure ? 'bad' : '' }, num(c.withFailure)),
        h('td', { class: c.openNcrs ? 'bad' : '' }, num(c.openNcrs)),
        h('td', null, h('div', { class: 'prog-cell' }, progress(c.pct), h('small', null, pctText(c.pct)))))))));
  }

  /* ---------- قائمة المشاريع ---------- */
  views.projects = {
    title: 'المشاريع',
    render() {
      const box = h('div');
      const draw = () => {
        const q = state.filter.q.trim().toLowerCase();
        const list = state.projects.filter((p) =>
          (state.filter.brand === 'all' || p.brand === state.filter.brand)
          && (!q || [p.client, p.address, p.phone].some((x) => String(x || '').toLowerCase().includes(q))));
        clear(box).appendChild(list.length ? projectTable(list.map((p) => ({ p, c: projectCalc(p) }))) : empty('لا توجد نتائج'));
      };
      const search = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو العنوان أو الهاتف', value: state.filter.q, 'aria-label': 'بحث',
        onInput: (e) => { state.filter.q = e.target.value; draw(); } });
      const brandSel = h('select', { class: 'auto', 'aria-label': 'البراند', onChange: (e) => { state.filter.brand = e.target.value; draw(); } },
        h('option', { value: 'all', selected: state.filter.brand === 'all' }, 'كل البراندات'),
        Object.entries(BRANDS).map(([k, l]) => h('option', { value: k, selected: state.filter.brand === k }, l)));
      draw();
      return h('section', { class: 'card' },
        h('div', { class: 'toolbar' }, search, brandSel, isStaff() ? h('a', { href: '#/new', class: 'btn primary' }, '+ مشروع جديد') : null),
        box);
    }
  };

  /* ---------- نموذج المشروع ---------- */
  function projectForm(r) {
    const p = r.name === 'edit' ? state.projects.find((x) => x.id === r.id) : null;
    if (r.name === 'edit' && !p) return empty('المشروع غير موجود');

    const inputs = {
      client: h('input', { maxlength: 200, value: p?.client ?? '', autocomplete: 'off', placeholder: 'اسم العميل أو المشروع' }),
      brand: h('select', null, h('option', { value: '', selected: !p?.brand }, 'اختر البراند'),
        Object.entries(BRANDS).map(([k, l]) => h('option', { value: k, selected: p?.brand === k }, l))),
      phone: h('input', { type: 'tel', dir: 'ltr', maxlength: 20, value: p?.phone ?? '', placeholder: '07XX XXX XXXX' }),
      address: h('input', { maxlength: 300, value: p?.address ?? '' }),
      map_url: h('input', { type: 'url', dir: 'ltr', maxlength: 1000, value: p?.map_url ?? '', placeholder: 'https://maps.google.com/…' }),
      size_m2: h('input', { type: 'number', min: 0, step: 'any', dir: 'ltr', value: p?.size_m2 ?? '' }),
      floors: h('input', { type: 'number', min: 0, max: 300, dir: 'ltr', value: p?.floors ?? '' }),
      total: h('input', { type: 'number', min: 0, step: 1, dir: 'ltr', value: p ? (totalOf(p) ?? '') : '' }),
      contract_date: h('input', { type: 'date', dir: 'ltr', value: p?.contract_date ?? new Date().toISOString().slice(0, 10) }),
      notes: h('textarea', { rows: 3, maxlength: 4000, value: p?.notes ?? '' })
    };
    const unitInputs = p ? null : {
      count: h('input', { type: 'number', min: 1, max: 2000, dir: 'ltr', value: 1 }),
      prefix: h('input', { dir: 'ltr', maxlength: 10, value: 'V-' })
    };
    const errs = Object.fromEntries(Object.keys(inputs).concat(['count']).map((k) => [k, h('small', { class: 'err' })]));
    const btn = h('button', { type: 'submit', class: 'btn primary' }, p ? 'حفظ التعديلات' : 'إنشاء المشروع');

    const submit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
      const bad = {};
      if (!v.client) bad.client = 'الاسم مطلوب';
      if (!BRANDS[v.brand]) bad.brand = 'اختر البراند';
      if (v.phone && !/^\+?[0-9 ()-]{7,20}$/.test(v.phone)) bad.phone = 'أدخل رقم هاتف صحيح';
      if (v.map_url && !SAFE_URL.test(v.map_url)) bad.map_url = 'يجب أن يبدأ الرابط بـ https://';
      if (v.size_m2 && !(Number(v.size_m2) > 0)) bad.size_m2 = 'أدخل مساحة أكبر من صفر';
      if (v.floors && !(Number.isInteger(Number(v.floors)) && Number(v.floors) >= 0)) bad.floors = 'أدخل عدداً صحيحاً';
      if (v.total && !(Number(v.total) >= 0)) bad.total = 'أدخل قيمة صحيحة';
      if (!v.contract_date) bad.contract_date = 'تاريخ العقد مطلوب';
      const count = unitInputs ? Number(unitInputs.count.value) : 0;
      if (unitInputs && !(Number.isInteger(count) && count >= 1 && count <= 2000)) bad.count = 'من 1 إلى 2000';

      Object.entries(errs).forEach(([k, el]) => { el.textContent = bad[k] || ''; (inputs[k] || unitInputs?.[k])?.classList.toggle('invalid', Boolean(bad[k])); });
      const first = Object.keys(bad)[0];
      if (first) return (inputs[first] || unitInputs[first]).focus();

      const row = {
        client: v.client, brand: v.brand, phone: v.phone || null, address: v.address || null, map_url: v.map_url || null,
        size_m2: v.size_m2 ? Number(v.size_m2) : null, floors: v.floors ? Number(v.floors) : null,
        contract_date: v.contract_date, notes: v.notes || null
      };
      btn.disabled = true;
      const res = p
        ? await state.sb.from('projects').update(row).eq('id', p.id).select('id').single()
        : await state.sb.from('projects').insert(row).select('id').single();
      if (res.error) { btn.disabled = false; return fail(res.error); }
      const id = res.data.id;

      const f = await state.sb.from('project_finance').update({ total_iqd: v.total ? Number(v.total) : null }).eq('project_id', id);
      if (f.error) fail(f.error);

      if (unitInputs) {
        const prefix = unitInputs.prefix.value.trim();
        const digits = Math.max(3, String(count).length);
        const rows = Array.from({ length: count }, (_, i) => ({ project_id: id, code: prefix + String(i + 1).padStart(digits, '0') }));
        for (let i = 0; i < rows.length; i += 500) {
          const u = await state.sb.from('units').insert(rows.slice(i, i + 500));
          if (u.error) { fail(u.error); break; }
        }
      }
      await reloadProject(id);
      await reloadUnits(id);
      toast(p ? 'تم حفظ التعديلات' : 'تم إنشاء المشروع');
      go('project/' + id);
    };

    const f = (k, label, opts = {}) => field(label, inputs[k], { ...opts, err: errs[k] });
    return h('form', { class: 'card', onSubmit: submit, novalidate: true },
      h('div', { class: 'card-head' }, h('h2', null, p ? 'تعديل بيانات المشروع' : 'بيانات العقد والموقع')),
      h('div', { class: 'form-grid' },
        f('client', 'اسم العميل / المشروع', { required: true }),
        f('brand', 'البراند', { required: true }),
        f('phone', 'رقم الهاتف'),
        f('contract_date', 'تاريخ العقد', { required: true }),
        f('address', 'العنوان', { wide: true }),
        f('map_url', 'رابط الموقع على الخريطة', { wide: true }),
        f('size_m2', 'المساحة (م²)'),
        f('floors', 'عدد الطوابق'),
        f('total', 'قيمة العقد (د.ع)'),
        f('notes', 'ملاحظات', { wide: true })),
      unitInputs ? h('fieldset', { class: 'checks' },
        h('legend', null, 'الوحدات (الفلل / البيوت)'),
        h('div', { class: 'form-grid' },
          field('عدد الوحدات', unitInputs.count, { err: errs.count, hint: 'بيت واحد = 1، والمجمّع السكني = عدد الفلل' }),
          field('بادئة الترقيم', unitInputs.prefix, { hint: 'مثال: V- تعطي V-001، V-002…' }))) : null,
      h('div', { class: 'row end' },
        h('a', { href: p ? '#/project/' + p.id : '#/projects', class: 'btn ghost' }, 'إلغاء'), btn));
  }
  views.new = { title: 'مشروع جديد', allow: isStaff, render: projectForm };
  views.edit = { title: 'تعديل المشروع', allow: isStaff, render: projectForm };

  /* ---------- المستخدمون ---------- */
  views.users = {
    title: 'المستخدمون', allow: isAdmin,
    async render() {
      const { data, error } = await state.sb.from('profiles').select('*').order('created_at');
      if (error) throw error;
      const save = async (u, patch) => {
        const r = await state.sb.from('profiles').update(patch).eq('id', u.id).select().maybeSingle();
        if (r.error || !r.data) { fail(r.error || 'permission denied'); render(); return; }
        Object.assign(u, r.data);
        if (u.id === state.user.id) Object.assign(state.profile, r.data);
        toast('تم حفظ التغيير');
      };
      return h('div', { class: 'stack' },
        h('section', { class: 'card note' },
          h('h2', null, 'إضافة مستخدم جديد'),
          h('p', null, 'من لوحة Supabase: Authentication ← Users ← Add user (مع تفعيل Auto Confirm User). بعدها يظهر هنا بدور "فني"، فغيّر دوره من الجدول.')),
        h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الدور'), h('th', null, 'الحالة'), h('th', null, 'تاريخ الإضافة'))),
          h('tbody', null, data.map((u) => {
            const me = u.id === state.user.id;
            return h('tr', null,
              h('td', null, h('input', { value: u.full_name, maxlength: 120, 'aria-label': 'الاسم', onChange: (e) => save(u, { full_name: e.target.value.trim() }) }),
                me ? h('small', { class: 'muted' }, ' (أنت)') : null),
              h('td', null, h('select', { disabled: me, 'aria-label': 'الدور', onChange: (e) => save(u, { role: e.target.value }) },
                Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: u.role === v }, l)))),
              h('td', null, h('label', { class: 'check' },
                h('input', { type: 'checkbox', checked: u.active, disabled: me, onChange: (e) => save(u, { active: e.target.checked }) }),
                h('span', null, 'مفعّل'))),
              h('td', { dir: 'ltr' }, date(u.created_at)));
          }))))),
        h('section', { class: 'card' }, h('h2', null, 'صلاحيات الأدوار'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
            h('thead', null, h('tr', null, h('th', null, 'الإجراء'), h('th', null, 'مدير'), h('th', null, 'مشرف'), h('th', null, 'فني'))),
            h('tbody', null, [
              ['عرض المشاريع والوحدات والنتائج والقراءات وNCR', 1, 1, 1],
              ['تسجيل قراءات الضغط والفاكيوم والشحن', 1, 1, 1],
              ['اعتماد نتائج المراحل (ناجح / فاشل / لا ينطبق)', 1, 1, 0],
              ['فتح وإغلاق حالات عدم المطابقة', 1, 1, 0],
              ['إنشاء المشاريع والوحدات وتعديلها، والمواد', 1, 1, 0],
              ['رؤية قيمة العقد', 1, 1, 0],
              ['استيراد وتصدير Excel والنسخ الاحتياطي', 1, 1, 0],
              ['حذف المشاريع والوحدات والقراءات', 1, 0, 0],
              ['تعديل حدود الفحص، والمستخدمون، وسجل العمليات', 1, 0, 0]
            ].map(([a, ...c]) => h('tr', null, h('td', null, a), c.map((x) => h('td', { class: x ? 'yes' : 'no' }, x ? '✓' : '—')))))))));
    }
  };

  /* ---------- سجل العمليات ---------- */
  views.audit = {
    title: 'سجل العمليات', allow: isAdmin,
    async render() {
      const [log, users] = await Promise.all([
        state.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300),
        state.sb.from('profiles').select('id, full_name')
      ]);
      if (log.error) throw log.error;
      const names = Object.fromEntries((users.data || []).map((u) => [u.id, u.full_name]));
      const clients = Object.fromEntries(state.projects.map((p) => [p.id, p.client]));
      const unitCodes = Object.fromEntries(state.units.map((u) => [u.id, u.code]));
      const cpName = Object.fromEntries(state.checkpoints.map((c) => [c.key, c.name_ar]));
      const describe = (e) => {
        const d = e.new_data || e.old_data || {};
        const parts = [];
        if (d.project_id || e.table_name === 'projects') parts.push(clients[d.project_id || d.id] || d.client || '');
        if (d.unit_id) parts.push(unitCodes[d.unit_id] || '');
        if (e.table_name === 'units') parts.push(d.code);
        if (d.checkpoint) parts.push(cpName[d.checkpoint]);
        if (e.table_name === 'unit_checks' && e.old_data && e.new_data && e.old_data.result !== e.new_data.result) {
          parts.push(`${RESULTS[e.old_data.result]} ← ${RESULTS[e.new_data.result]}`);
        }
        if (e.table_name === 'ncrs') parts.push('NCR-' + String(d.ncr_no).padStart(3, '0'), d.status === 'closed' ? 'مغلقة' : 'مفتوحة');
        if (e.table_name === 'materials') parts.push(d.name);
        if (e.table_name === 'profiles') parts.push(d.full_name, ROLES[d.role]);
        if (e.table_name === 'brand_limits') parts.push(BRANDS[d.brand]);
        return parts.filter(Boolean).join(' · ');
      };
      return h('section', { class: 'card' },
        h('p', { class: 'muted' }, 'آخر 300 عملية. السجل يُكتب على الخادم تلقائياً ولا يمكن تعديله أو حذفه من التطبيق.'),
        log.data.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'الوقت'), h('th', null, 'المستخدم'), h('th', null, 'العملية'), h('th', null, 'الجدول'), h('th', null, 'التفاصيل'))),
          h('tbody', null, log.data.map((e) => h('tr', null,
            h('td', { dir: 'ltr' }, dateTime(e.at)),
            h('td', null, e.actor ? (names[e.actor] || 'مستخدم محذوف') : 'النظام'),
            h('td', null, h('span', { class: 'badge ' + e.action.toLowerCase() }, ACTIONS[e.action] || e.action)),
            h('td', null, TABLES[e.table_name] || e.table_name),
            h('td', null, describe(e)))))))
          : empty('لا توجد عمليات بعد'));
    }
  };

  /* ---------- النسخ الاحتياطي ---------- */
  views.backup = {
    title: 'النسخ الاحتياطي', allow: isStaff,
    render() {
      const exportJson = async (btn) => {
        btn.disabled = true;
        try {
          const sb = state.sb;
          const all = (t, sel = '*') => fetchAll((a, b) => sb.from(t).select(sel).range(a, b));
          const [units, checks, tests, ncrs, materials] = await Promise.all([
            all('units'), all('unit_checks'), all('test_records'), all('ncrs'), all('materials')]);
          const data = { app: 'surour-cooling', version: 3, exported_at: new Date().toISOString(),
            projects: state.projects, units, unit_checks: checks, test_records: tests, ncrs, materials };
          download(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }),
            `surour-backup-${new Date().toISOString().slice(0, 10)}.json`);
          toast('تم تنزيل النسخة الاحتياطية');
        } catch (e) { fail(e); }
        btn.disabled = false;
      };

      const text = h('textarea', { rows: 5, dir: 'ltr', placeholder: 'الصق هنا نص النسخة الاحتياطية من التطبيق القديم' });
      const out = h('p', { class: 'muted', role: 'status' });
      const importLegacy = async (btn) => {
        let arr;
        try { arr = JSON.parse(text.value.trim()); } catch (e) { return toast('النص غير صالح', 'error'); }
        if (!Array.isArray(arr) || !arr.every((x) => x && typeof x.client === 'string')) return toast('هذه ليست نسخة من التطبيق القديم', 'error');
        const ok = await confirmBox({ title: 'استيراد من التطبيق القديم',
          body: `سيُضاف ${arr.length} مشروع، لكل منها وحدة واحدة V-001 والمواد. حالات المراحل القديمة تُحفظ كنص في ملاحظات المشروع لأن المراحل تغيّرت. لن يُحذف شيء.`, okText: 'استيراد' });
        if (!ok) return;
        btn.disabled = true;
        let n = 0; const failed = [];
        const AR = { 'لم تبدأ': 'لم تبدأ', 'جارية': 'جارية', 'مكتملة': 'مكتملة' };
        for (const p of arr) {
          try {
            const old = Object.entries(p.stages || {}).filter(([, s]) => s && s.status).map(([k, s]) => `${k}: ${AR[s.status] || s.status}`).join('، ');
            const notes = [p.notes, old ? 'مراحل التطبيق القديم: ' + old : ''].filter(Boolean).join('\n').slice(0, 4000) || null;
            const ins = await state.sb.from('projects').insert({
              client: String(p.client).slice(0, 200), phone: /^\+?[0-9 ()-]{7,20}$/.test(p.phone || '') ? p.phone : null,
              address: p.address ? String(p.address).slice(0, 300) : null,
              map_url: SAFE_URL.test(p.mapUrl || '') ? p.mapUrl : null,
              size_m2: Number(p.size) > 0 ? Number(p.size) : null, floors: Number.isInteger(Number(p.floors)) && p.floors !== '' ? Number(p.floors) : null,
              contract_date: /^\d{4}-\d{2}-\d{2}$/.test(p.contractDate || '') ? p.contractDate : new Date().toISOString().slice(0, 10), notes
            }).select('id').single();
            if (ins.error) throw ins.error;
            const id = ins.data.id;
            if (Number(p.total) >= 0 && p.total !== '') await state.sb.from('project_finance').update({ total_iqd: Math.round(Number(p.total)) }).eq('project_id', id);
            await state.sb.from('units').insert({ project_id: id, code: 'V-001' });
            const mats = (p.materials || []).filter((m) => m && m.name).map((m) => ({ project_id: id, name: String(m.name).slice(0, 200), unit: m.unit ? String(m.unit).slice(0, 40) : null, qty: Number(m.qty) >= 0 && m.qty !== '' ? Number(m.qty) : null }));
            if (mats.length) await state.sb.from('materials').insert(mats);
            n++;
          } catch (e) { failed.push(`${p.client}: ${errText(e)}`); }
        }
        await loadAll();
        btn.disabled = false;
        out.textContent = `تم استيراد ${n} مشروع` + (failed.length ? `، وفشل: ${failed.join(' | ')}` : '');
        toast(`تم استيراد ${n} مشروع`);
      };

      return h('div', { class: 'grid-2' },
        h('section', { class: 'card' },
          h('h2', null, 'نسخة احتياطية كاملة'),
          h('p', { class: 'muted' }, 'تنزيل كل البيانات (المشاريع، الوحدات، النتائج، القراءات، NCR، المواد) في ملف JSON. لتصدير مشروع بشكل ملف Excel افتح المشروع ← الإعدادات.'),
          h('button', { type: 'button', class: 'btn primary', onClick: (e) => exportJson(e.currentTarget) }, 'تنزيل النسخة الاحتياطية')),
        h('section', { class: 'card' },
          h('h2', null, 'الاستيراد من التطبيق القديم'),
          h('p', { class: 'muted' }, 'للبيانات المحفوظة في المتصفح من النسخة الأولى. لاستيراد ملف Excel (VRF QC Tracker) افتح المشروع ← الإعدادات.'),
          text,
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onClick: (e) => importLegacy(e.currentTarget) }, 'استيراد')),
          out));
    }
  };

  /* ---------- واجهة مشتركة لـ qc.js ---------- */
  window.App = {
    state, views, render, go, fail, errText, field, empty, kpi, modal, download,
    brandChip, resultChip, statusChip, progress, pctText, totalOf,
    unitCalc, projectCalc, weightOf, reloadProject, reloadUnits, reloadUnit, loadAll, fetchAll,
    isAdmin, isStaff, BRANDS, RESULTS, RESULTS_EN, UNIT_STATUS, UNIT_STATUS_EN
  };

  applyTheme();
  // ننتظر تحميل كل السكربتات (ومنها qc.js) قبل أول عرض
  document.addEventListener('DOMContentLoaded', () => boot().catch(fail));
})();
