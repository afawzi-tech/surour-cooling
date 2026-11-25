/* ==========================================================
   متابعة مشاريع التبريد المركزي - مصاعد السرور (الإصدار 2)
   الواجهة مرتبطة بـ Supabase. كل الصلاحيات الحقيقية تُفرض على الخادم
   عبر قواعد RLS في supabase/schema.sql، وما في الواجهة لإخفاء الأزرار فقط.
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, toast, confirmBox, num, date, dateTime, SAFE_URL } = window.UI;
  const root = document.getElementById('root');
  const cfg = window.SUROUR_CONFIG || {};

  /* ---------- الثوابت ---------- */
  const STAGES = [
    { key: 'contract',         name: 'إنشاء العقد',                      desc: 'توثيق بيانات العميل والعقد' },
    { key: 'survey',           name: 'الكشف على الموقع',                 desc: 'التأكد من جاهزية الموقع وتحديد الكوادر' },
    { key: 'start',            name: 'المباشرة بالعمل الفعلي',           desc: 'بدء التنفيذ في الموقع' },
    { key: 'indoor_materials', name: 'طرح المواد للموقع (أجهزة داخلية)', desc: 'إيصال الأجهزة الداخلية إلى الموقع' },
    { key: 'welding',          name: 'أعمال اللحام وتركيب الداخليات',    desc: 'لحام الخطوط وتركيب الوحدات الداخلية' },
    { key: 'piping',           name: 'تسليك الشبكة الداخلية مع الضغط',   desc: 'تمديد الشبكة وإجراء اختبار الضغط' },
    { key: 'drain',            name: 'أعمال الدرين ماي',                 desc: 'تمديد خطوط التصريف' },
    { key: 'signal',           name: 'تمديد واير الإشارة',               desc: 'توصيل أسلاك الإشارة بين الوحدات' }
  ];
  const STAGE_NAME = Object.fromEntries(STAGES.map((s) => [s.key, s.name]));

  const STATUS = { not_started: 'لم تبدأ', in_progress: 'جارية', done: 'مكتملة' };
  const STATUS_FROM_AR = { 'لم تبدأ': 'not_started', 'جارية': 'in_progress', 'مكتملة': 'done' };

  // بنود الجاهزية: مأخوذة من النسخة السابقة وتحتاج تأكيداً من المستخدم
  const READY = [
    { key: 'power',    label: 'الكهرباء جاهزة' },
    { key: 'openings', label: 'الفتحات والسقوف جاهزة' },
    { key: 'outdoor',  label: 'مكان الوحدات الخارجية جاهز' },
    { key: 'access',   label: 'الطريق لإدخال المواد متاح' },
    { key: 'storage',  label: 'مكان تخزين المواد متوفر' }
  ];

  const BRANDS = { lg: 'LG', midea: 'Midea' };
  const brandChip = (b) => (BRANDS[b] ? h('span', { class: 'brand-chip ' + b, dir: 'ltr' }, BRANDS[b]) : null);

  const ROLES = { admin: 'مدير', supervisor: 'مشرف', technician: 'فني' };
  const TABLES = { profiles: 'المستخدمون', projects: 'العقود', project_finance: 'قيمة العقد', project_stages: 'المراحل', materials: 'المواد' };
  const ACTIONS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };

  /* ---------- الحالة ---------- */
  const state = {
    sb: null,
    user: null,
    profile: null,
    projects: [],
    loaded: false,
    filter: { q: '', status: 'all', brand: 'all' }
  };

  const role = () => state.profile?.role;
  const isAdmin = () => role() === 'admin';
  const isStaff = () => role() === 'admin' || role() === 'supervisor';

  /* ---------- الحسابات ---------- */
  const stagesOf = (p) => [...(p.project_stages || [])].sort((a, b) => a.position - b.position);
  const stage = (p, key) => (p.project_stages || []).find((s) => s.stage_key === key) || { status: 'not_started' };
  const doneCount = (p) => (p.project_stages || []).filter((s) => s.status === 'done').length;
  const pct = (p) => Math.round((doneCount(p) / STAGES.length) * 100);
  const isComplete = (p) => doneCount(p) === STAGES.length;
  const currentStage = (p) => stagesOf(p).find((s) => s.status !== 'done');
  const totalOf = (p) => {
    const f = Array.isArray(p.project_finance) ? p.project_finance[0] : p.project_finance;
    return f ? f.total_iqd : null;
  };

  /* ---------- رسائل الأخطاء ---------- */
  function errText(error) {
    const m = String(error?.message || error || '');
    if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
    if (/Email not confirmed/i.test(m)) return 'لم يتم تأكيد البريد الإلكتروني بعد';
    if (/row-level security|permission denied/i.test(m)) return 'ليست لديك صلاحية لهذا الإجراء';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'تعذّر الاتصال بالخادم، تحقّق من الإنترنت';
    if (/check constraint/i.test(m)) return 'بعض القيم غير مقبولة، راجع الحقول';
    if (/[؀-ۿ]/.test(m)) return m;                // رسالة عربية من الخادم
    return 'حدث خطأ غير متوقع، حاول مرة أخرى';
  }

  function fail(error) {
    console.error(error);
    toast(errText(error), 'error');
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
        Object.assign(state, { user: null, profile: null, projects: [], loaded: false });
        render();
      } else if (event === 'SIGNED_IN' && session && session.user.id !== state.user?.id) {
        // تأجيل الاستدعاء لتجنّب التعارض مع قفل جلسة المكتبة
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
    if (!data || !data.active) {
      render();
      return;
    }
    await loadProjects();
    render();
  }

  async function loadProjects() {
    const finance = isStaff() ? ', project_finance(total_iqd)' : '';
    const { data, error } = await state.sb
      .from('projects')
      .select(`*, project_stages(*), materials(*)${finance}`)
      .order('created_at', { ascending: false });
    if (error) return fail(error);
    state.projects = data || [];
    state.loaded = true;
  }

  async function reloadProject(id) {
    const finance = isStaff() ? ', project_finance(total_iqd)' : '';
    const { data, error } = await state.sb
      .from('projects')
      .select(`*, project_stages(*), materials(*)${finance}`)
      .eq('id', id)
      .maybeSingle();
    if (error) return fail(error);
    const i = state.projects.findIndex((p) => p.id === id);
    if (!data) state.projects = state.projects.filter((p) => p.id !== id);
    else if (i >= 0) state.projects[i] = data;
    else state.projects.unshift(data);
  }

  /* ---------- التوجيه ---------- */
  function parseRoute() {
    const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    return { name: parts[0], id: parts[1] || null };
  }
  const go = (path) => { location.hash = '#/' + path; };
  window.addEventListener('hashchange', () => render());

  /* ---------- الهيكل العام ---------- */
  function render() {
    clear(root);
    if (!state.user) return root.appendChild(viewLogin());
    if (!state.profile || !state.profile.active) return root.appendChild(viewInactive());

    const r = parseRoute();
    const views = {
      dashboard: ['لوحة التحكم', viewDashboard],
      projects:  ['المشاريع', viewProjects],
      project:   ['تفاصيل المشروع', viewProject],
      new:       ['عقد جديد', viewForm, isStaff],
      edit:      ['تعديل العقد', viewForm, isStaff],
      users:     ['المستخدمون', viewUsers, isAdmin],
      audit:     ['سجل العمليات', viewAudit, isAdmin],
      backup:    ['النسخ الاحتياطي', viewBackup, isStaff]
    };
    let v = views[r.name] || views.dashboard;
    if (v[2] && !v[2]()) v = views.dashboard;

    const main = h('main', { class: 'main', id: 'main' });
    root.appendChild(h('div', { class: 'shell' }, sidebar(r.name), h('div', { class: 'content' }, topbar(v[0]), main)));
    const out = v[1](r);
    if (out instanceof Promise) {
      main.appendChild(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
      out.then((node) => { clear(main); main.appendChild(node); });
    } else {
      main.appendChild(out);
    }
    document.title = v[0] + ' | مصاعد السرور';
  }

  function sidebar(active) {
    const links = [
      ['dashboard', 'لوحة التحكم', '◧', true],
      ['projects', 'المشاريع', '☰', true],
      ['new', 'عقد جديد', '+', isStaff()],
      ['backup', 'النسخ الاحتياطي', '⇅', isStaff()],
      ['users', 'المستخدمون', '◉', isAdmin()],
      ['audit', 'سجل العمليات', '≡', isAdmin()]
    ];
    const current = active === 'project' || active === 'edit' ? 'projects' : active;
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

  function topbar(title) {
    return h('header', { class: 'topbar' }, h('h1', null, title));
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

  /* ---------- شاشات الدخول ---------- */
  function renderSetupNeeded() {
    clear(root);
    root.appendChild(h('div', { class: 'auth' },
      h('div', { class: 'auth-card' },
        h('span', { class: 'brand-mark big', 'aria-hidden': 'true' }, '❄'),
        h('h1', null, 'التطبيق غير مربوط بقاعدة البيانات بعد'),
        h('p', { class: 'muted' }, 'ضع رابط مشروع Supabase ومفتاح anon في الملف js/config.js، ثم أعد تحميل الصفحة. التفاصيل في docs/الإعداد.md.'))));
  }

  function viewLogin() {
    const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', dir: 'ltr', required: true });
    const pass = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
    const err = h('p', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'تسجيل الدخول');

    const form = h('form', {
      class: 'auth-card',
      onSubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        btn.textContent = 'جارٍ التحقق…';
        const { error } = await state.sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        btn.disabled = false;
        btn.textContent = 'تسجيل الدخول';
        if (error) err.textContent = errText(error);
      }
    },
      h('span', { class: 'brand-mark big', 'aria-hidden': 'true' }, '❄'),
      h('h1', null, 'مصاعد السرور'),
      h('p', { class: 'muted' }, 'متابعة مشاريع التبريد المركزي'),
      field('البريد الإلكتروني', email),
      field('كلمة المرور', pass),
      err,
      btn,
      h('p', { class: 'muted small' }, 'الحسابات يُنشئها المدير. إذا نسيت كلمة المرور فتواصل معه.'));
    return h('div', { class: 'auth' }, form);
  }

  function viewInactive() {
    return h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      h('h1', null, 'الحساب غير مفعّل'),
      h('p', { class: 'muted' }, 'حسابك موجود لكنه غير مفعّل أو لم يُحدَّد له دور بعد. تواصل مع المدير.'),
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
      input,
      opts.err || null);
  }

  const badge = (status) => h('span', { class: 'badge ' + status }, STATUS[status] || status);

  function progress(p) {
    const v = pct(p);
    return h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': v, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'نسبة الإنجاز' },
      h('span', { style: { width: v + '%' } }));
  }

  const empty = (title, sub, action) =>
    h('div', { class: 'empty' }, h('strong', null, title), sub ? h('p', { class: 'muted' }, sub) : null, action || null);

  /* ---------- لوحة التحكم ---------- */
  function viewDashboard() {
    const all = state.projects;
    const done = all.filter(isComplete).length;
    const area = all.reduce((s, p) => s + (Number(p.size_m2) || 0), 0);
    const kpis = [
      ['إجمالي العقود', num(all.length), ''],
      ['الجارية', num(all.length - done), 'tone-doing'],
      ['المكتملة', num(done), 'tone-done'],
      ['إجمالي المساحة (م²)', num(area), '']
    ];
    if (isStaff()) kpis.push(['إجمالي القيم (د.ع)', num(all.reduce((s, p) => s + (Number(totalOf(p)) || 0), 0)), '']);
    Object.entries(BRANDS).forEach(([k, l]) => kpis.push(['مشاريع ' + l, num(all.filter((p) => p.brand === k).length), 'tone-' + k]));

    // توزيع المشاريع الجارية على المراحل
    const byStage = STAGES.map((s) => ({ ...s, count: all.filter((p) => currentStage(p)?.stage_key === s.key).length }));
    const maxCount = Math.max(1, ...byStage.map((s) => s.count));

    return h('div', { class: 'stack' },
      h('section', { class: 'kpis' }, kpis.map(([l, v, tone]) =>
        h('div', { class: 'kpi ' + tone }, h('span', { class: 'kpi-label' }, l), h('strong', { class: 'kpi-value' }, v)))),
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'أحدث العقود'), h('a', { href: '#/projects', class: 'link' }, 'عرض الكل')),
          all.length ? projectList(all.slice(0, 6)) : empty('لا توجد عقود بعد', isStaff() ? 'ابدأ بإضافة أول عقد.' : '',
            isStaff() ? h('a', { href: '#/new', class: 'btn primary' }, 'عقد جديد') : null)),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, 'المشاريع حسب المرحلة الحالية')),
          h('ul', { class: 'bars' }, byStage.filter((s) => s.key !== 'contract').map((s) =>
            h('li', null,
              h('span', { class: 'bar-label' }, s.name),
              h('span', { class: 'bar' }, h('span', { style: { width: (s.count / maxCount) * 100 + '%' } })),
              h('span', { class: 'bar-val' }, String(s.count))))))));
  }

  function projectList(list) {
    return h('ul', { class: 'plist' }, list.map((p) => {
      const cur = currentStage(p);
      return h('li', null, h('a', { href: '#/project/' + p.id, class: 'pitem' },
        h('div', { class: 'pitem-main' },
          h('strong', null, p.client, ' ', brandChip(p.brand)),
          h('small', { class: 'muted' }, [p.address, date(p.contract_date)].filter(Boolean).join(' · '))),
        h('div', { class: 'pitem-side' },
          h('small', null, cur ? STAGE_NAME[cur.stage_key] : 'مكتمل'),
          progress(p),
          h('small', { class: 'muted' }, pct(p) + '%'))));
    }));
  }

  /* ---------- قائمة المشاريع ---------- */
  function viewProjects() {
    const listBox = h('div');
    const draw = () => {
      const q = state.filter.q.trim().toLowerCase();
      const list = state.projects.filter((p) => {
        if (state.filter.status === 'done' && !isComplete(p)) return false;
        if (state.filter.status === 'doing' && isComplete(p)) return false;
        if (state.filter.brand !== 'all' && p.brand !== state.filter.brand) return false;
        return !q || [p.client, p.address, p.phone].some((x) => String(x || '').toLowerCase().includes(q));
      });
      clear(listBox).appendChild(list.length ? projectList(list) : empty('لا توجد نتائج'));
    };

    const search = h('input', {
      type: 'search', id: 'search', placeholder: 'ابحث بالاسم أو العنوان أو الهاتف', value: state.filter.q,
      'aria-label': 'بحث',
      onInput: (e) => { state.filter.q = e.target.value; draw(); }
    });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'تصفية' },
      [['all', 'الكل'], ['doing', 'جارية'], ['done', 'مكتملة']].map(([v, l]) =>
        h('button', {
          type: 'button', class: state.filter.status === v ? 'on' : '', 'aria-pressed': String(state.filter.status === v),
          onClick: (e) => {
            state.filter.status = v;
            seg.querySelectorAll('button').forEach((b) => { b.className = ''; b.setAttribute('aria-pressed', 'false'); });
            e.currentTarget.className = 'on';
            e.currentTarget.setAttribute('aria-pressed', 'true');
            draw();
          }
        }, l)));

    const brandSel = h('select', { class: 'brand-filter', 'aria-label': 'البراند', onChange: (e) => { state.filter.brand = e.target.value; draw(); } },
      h('option', { value: 'all', selected: state.filter.brand === 'all' }, 'كل البراندات'),
      Object.entries(BRANDS).map(([k, l]) => h('option', { value: k, selected: state.filter.brand === k }, l)));

    draw();
    return h('section', { class: 'card' },
      h('div', { class: 'toolbar' }, search, seg, brandSel,
        isStaff() ? h('a', { href: '#/new', class: 'btn primary' }, '+ عقد جديد') : null),
      listBox);
  }

  /* ---------- تفاصيل المشروع ---------- */
  function viewProject(r) {
    const p = state.projects.find((x) => x.id === r.id);
    if (!p) return empty('المشروع غير موجود', 'ربما حُذف أو ليست لديك صلاحية لرؤيته.', h('a', { href: '#/projects', class: 'btn' }, 'العودة للمشاريع'));

    const info = [
      ['البراند', brandChip(p.brand) || 'غير محدد'],
      ['الهاتف', p.phone ? h('span', { dir: 'ltr' }, p.phone) : '—'],
      ['العنوان', p.address || '—'],
      ['الموقع على الخريطة', p.map_url && SAFE_URL.test(p.map_url)
        ? h('a', { href: p.map_url, target: '_blank', rel: 'noopener noreferrer' }, 'فتح الخريطة') : '—'],
      ['المساحة', p.size_m2 ? num(p.size_m2) + ' م²' : '—'],
      ['عدد الطوابق', p.floors ?? '—'],
      ['تاريخ العقد', date(p.contract_date)]
    ];
    if (isStaff()) info.push(['قيمة العقد', totalOf(p) != null ? num(totalOf(p)) + ' د.ع' : '—']);

    return h('div', { class: 'stack' },
      h('section', { class: 'card hero' },
        h('div', { class: 'hero-head' },
          h('div', null,
            h('a', { href: '#/projects', class: 'link small' }, '→ المشاريع'),
            h('h2', null, p.client, ' ', brandChip(p.brand)),
            h('p', { class: 'muted' }, `${doneCount(p)} من ${STAGES.length} مراحل مكتملة`)),
          h('div', { class: 'row' },
            isStaff() ? h('a', { href: '#/edit/' + p.id, class: 'btn' }, 'تعديل') : null,
            isAdmin() ? h('button', { type: 'button', class: 'btn danger', onClick: () => deleteProject(p) }, 'حذف') : null)),
        h('div', { class: 'hero-progress' }, progress(p), h('strong', null, pct(p) + '%')),
        h('dl', { class: 'info' }, info.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
        p.notes ? h('p', { class: 'notes' }, p.notes) : null),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'المراحل')),
        h('ol', { class: 'timeline' }, STAGES.map((s, i) => stageCard(p, s, i)))),
      materialsCard(p));
  }

  function stageCard(p, s, i) {
    const st = stage(p, s.key);
    const head = h('div', { class: 'step-head' },
      h('div', null, h('h3', null, s.name), h('p', { class: 'muted small' }, s.desc)),
      badge(st.status));

    if (s.key === 'contract') {
      return h('li', { class: 'step done' }, h('span', { class: 'step-num' }, '✓'),
        h('div', { class: 'step-body' }, head, h('p', { class: 'muted small' }, 'تم توثيق العقد بتاريخ ' + date(p.contract_date))));
    }

    const save = (patch) => updateStage(p.id, s.key, patch);
    const status = h('select', { 'aria-label': 'حالة المرحلة', onChange: (e) => save({ status: e.target.value }) },
      Object.entries(STATUS).map(([v, l]) => h('option', { value: v, selected: st.status === v }, l)));
    const workers = h('input', { type: 'number', min: 0, max: 1000, inputmode: 'numeric', dir: 'ltr', value: st.workers ?? '',
      onChange: (e) => save({ workers: e.target.value === '' ? null : Number(e.target.value) }) });
    const start = h('input', { type: 'date', dir: 'ltr', value: st.start_date ?? '', onChange: (e) => save({ start_date: e.target.value || null }) });
    const end = h('input', { type: 'date', dir: 'ltr', value: st.end_date ?? '', onChange: (e) => save({ end_date: e.target.value || null }) });
    const notes = h('textarea', { rows: 2, maxlength: 4000, value: st.notes ?? '', onChange: (e) => save({ notes: e.target.value.trim() || null }) });

    const checklist = s.key === 'survey'
      ? h('fieldset', { class: 'checks' },
          h('legend', null, 'جاهزية الموقع'),
          READY.map((r) => h('label', { class: 'check' },
            h('input', {
              type: 'checkbox', checked: Boolean(st.checklist?.[r.key]),
              onChange: (e) => save({ checklist: { ...(st.checklist || {}), [r.key]: e.target.checked } })
            }),
            h('span', null, r.label))))
      : null;

    const by = st.updated_at ? h('p', { class: 'muted small' }, 'آخر تحديث: ' + dateTime(st.updated_at)) : null;

    return h('li', { class: 'step ' + st.status },
      h('span', { class: 'step-num' }, st.status === 'done' ? '✓' : String(i + 1)),
      h('div', { class: 'step-body' },
        h('div', { class: 'step-head' },
          h('div', null, h('h3', null, s.name), h('p', { class: 'muted small' }, s.desc)),
          status),
        h('p', { class: 'muted small' }, summaryLine(st)),
        h('details', { class: 'step-more', open: st.status === 'in_progress' },
          h('summary', null, 'التفاصيل والتواريخ'),
          h('div', { class: 'form-grid compact' },
            field(s.key === 'survey' ? 'عدد الكوادر المطلوب' : 'عدد الكوادر', workers),
            field('تاريخ البدء', start),
            field('تاريخ الانتهاء', end),
            field('ملاحظات', notes, { wide: true })),
          checklist,
          by)));
  }

  function summaryLine(st) {
    const parts = [];
    if (st.workers != null) parts.push('الكوادر: ' + st.workers);
    if (st.start_date) parts.push('البدء: ' + date(st.start_date));
    if (st.end_date) parts.push('الانتهاء: ' + date(st.end_date));
    return parts.length ? parts.join(' · ') : 'لم تُسجَّل تفاصيل بعد';
  }

  async function updateStage(pid, key, patch) {
    const { data, error } = await state.sb.from('project_stages')
      .update(patch).eq('project_id', pid).eq('stage_key', key).select().maybeSingle();
    if (error || !data) {
      fail(error || 'permission denied');
    } else {
      const p = state.projects.find((x) => x.id === pid);
      p.project_stages = p.project_stages.map((s) => (s.stage_key === key ? data : s));
      if (patch.status) toast(`${STAGE_NAME[key]}: ${STATUS[data.status]}`);
    }
    render();
  }

  function materialsCard(p) {
    const mats = [...(p.materials || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const staff = isStaff();

    const name = h('input', { id: 'm-name', maxlength: 200, placeholder: 'مثال: أنبوب نحاس 1/2' });
    const unit = h('input', { id: 'm-unit', maxlength: 40, placeholder: 'متر، قطعة…' });
    const qty = h('input', { id: 'm-qty', type: 'number', min: 0, step: 'any', dir: 'ltr' });
    const err = h('p', { class: 'err', role: 'alert' });

    const add = async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!name.value.trim()) { err.textContent = 'اسم المادة مطلوب'; name.focus(); return; }
      if (qty.value !== '' && Number(qty.value) < 0) { err.textContent = 'الكمية لا يمكن أن تكون سالبة'; return; }
      const { error } = await state.sb.from('materials').insert({
        project_id: p.id, name: name.value.trim(), unit: unit.value.trim() || null, qty: qty.value === '' ? null : Number(qty.value)
      });
      if (error) return fail(error);
      toast('تمت إضافة المادة');
      await reloadProject(p.id);
      render();
    };

    const remove = async (m) => {
      const ok = await confirmBox({ title: 'حذف مادة', body: `هل تريد حذف "${m.name}" من قائمة المواد؟`, okText: 'حذف', danger: true });
      if (!ok) return;
      const { error } = await state.sb.from('materials').delete().eq('id', m.id);
      if (error) return fail(error);
      toast('تم حذف المادة');
      await reloadProject(p.id);
      render();
    };

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'المواد المطلوبة'), h('span', { class: 'muted' }, mats.length + ' بند')),
      mats.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'المادة'), h('th', null, 'الوحدة'), h('th', null, 'الكمية'), staff ? h('th', null) : null)),
            h('tbody', null, mats.map((m) => h('tr', null,
              h('td', null, m.name), h('td', null, m.unit || '—'), h('td', { dir: 'ltr' }, num(m.qty)),
              staff ? h('td', { class: 't-end' }, h('button', { type: 'button', class: 'btn ghost sm', onClick: () => remove(m) }, 'حذف')) : null)))))
        : empty('لم تُضف مواد بعد'),
      staff
        ? h('form', { class: 'form-grid add-row', onSubmit: add },
            field('اسم المادة', name, { required: true }), field('الوحدة', unit), field('الكمية', qty),
            h('div', { class: 'field end' }, h('button', { type: 'submit', class: 'btn primary' }, 'إضافة')),
            h('div', { class: 'wide' }, err))
        : null);
  }

  async function deleteProject(p) {
    const ok = await confirmBox({
      title: 'حذف المشروع',
      body: `سيتم حذف عقد "${p.client}" وجميع مراحله ومواده نهائياً، ويبقى أثر الحذف في سجل العمليات. لا يمكن التراجع.`,
      okText: 'حذف نهائي', danger: true
    });
    if (!ok) return;
    const { error } = await state.sb.from('projects').delete().eq('id', p.id);
    if (error) return fail(error);
    state.projects = state.projects.filter((x) => x.id !== p.id);
    toast('تم حذف المشروع');
    go('projects');
  }

  /* ---------- نموذج العقد ---------- */
  function viewForm(r) {
    const p = r.name === 'edit' ? state.projects.find((x) => x.id === r.id) : null;
    if (r.name === 'edit' && !p) return empty('المشروع غير موجود');

    const inputs = {
      client: h('input', { maxlength: 200, value: p?.client ?? '', autocomplete: 'off' }),
      brand: h('select', null,
        h('option', { value: '', selected: !p?.brand }, 'اختر البراند'),
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
    const errs = Object.fromEntries(Object.keys(inputs).map((k) => [k, h('small', { class: 'err' })]));
    const btn = h('button', { type: 'submit', class: 'btn primary' }, p ? 'حفظ التعديلات' : 'إنشاء العقد');

    const submit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()]));
      const bad = {};
      if (!v.client) bad.client = 'اسم العميل مطلوب';
      if (!BRANDS[v.brand]) bad.brand = 'اختر البراند';
      if (v.phone && !/^\+?[0-9 ()-]{7,20}$/.test(v.phone)) bad.phone = 'أدخل رقم هاتف صحيح';
      if (v.map_url && !SAFE_URL.test(v.map_url)) bad.map_url = 'يجب أن يبدأ الرابط بـ https://';
      if (v.size_m2 && !(Number(v.size_m2) > 0)) bad.size_m2 = 'أدخل مساحة أكبر من صفر';
      if (v.floors && !(Number.isInteger(Number(v.floors)) && Number(v.floors) >= 0)) bad.floors = 'أدخل عدداً صحيحاً';
      if (v.total && !(Number(v.total) >= 0)) bad.total = 'أدخل قيمة صحيحة';
      if (!v.contract_date) bad.contract_date = 'تاريخ العقد مطلوب';

      Object.entries(errs).forEach(([k, el]) => { el.textContent = bad[k] || ''; inputs[k].classList.toggle('invalid', Boolean(bad[k])); });
      const first = Object.keys(bad)[0];
      if (first) return inputs[first].focus();

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

      await reloadProject(id);
      toast(p ? 'تم حفظ التعديلات' : 'تم إنشاء العقد');
      go('project/' + id);
    };

    const f = (k, label, opts = {}) => field(label, inputs[k], { ...opts, err: errs[k] });
    return h('form', { class: 'card', onSubmit: submit, novalidate: true },
      h('div', { class: 'card-head' }, h('h2', null, p ? 'تعديل بيانات العقد' : 'بيانات العميل والموقع')),
      h('div', { class: 'form-grid' },
        f('client', 'اسم العميل', { required: true }),
        f('brand', 'البراند', { required: true }),
        f('phone', 'رقم الهاتف'),
        f('address', 'العنوان', { wide: true }),
        f('map_url', 'رابط الموقع على الخريطة', { wide: true }),
        f('size_m2', 'حجم البناية (م²)'),
        f('floors', 'عدد الطوابق'),
        f('total', 'قيمة العقد (د.ع)'),
        f('contract_date', 'تاريخ العقد', { required: true }),
        f('notes', 'ملاحظات', { wide: true })),
      h('div', { class: 'row end' },
        h('a', { href: p ? '#/project/' + p.id : '#/projects', class: 'btn ghost' }, 'إلغاء'),
        btn));
  }

  /* ---------- المستخدمون (للمدير) ---------- */
  async function viewUsers() {
    const { data, error } = await state.sb.from('profiles').select('*').order('created_at');
    if (error) { fail(error); return empty('تعذّر تحميل المستخدمين'); }

    const save = async (u, patch) => {
      const r = await state.sb.from('profiles').update(patch).eq('id', u.id).select().maybeSingle();
      if (r.error || !r.data) { fail(r.error || 'permission denied'); render(); return; }
      Object.assign(u, r.data);
      toast('تم حفظ التغيير');
    };

    return h('div', { class: 'stack' },
      h('section', { class: 'card note' },
        h('h2', null, 'إضافة مستخدم جديد'),
        h('p', null, 'لأسباب أمنية يُنشأ الحساب من لوحة Supabase: Authentication ← Users ← Add user (مع تفعيل Auto Confirm). بعدها يظهر هنا بدور "فني"، فغيّر دوره من الجدول.')),
      h('section', { class: 'card' },
        h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الدور'), h('th', null, 'الحالة'), h('th', null, 'تاريخ الإضافة'))),
          h('tbody', null, data.map((u) => {
            const me = u.id === state.user.id;
            return h('tr', null,
              h('td', null, h('input', { value: u.full_name, maxlength: 120, 'aria-label': 'الاسم',
                onChange: (e) => save(u, { full_name: e.target.value.trim() }) }), me ? h('small', { class: 'muted' }, ' (أنت)') : null),
              h('td', null, h('select', { disabled: me, 'aria-label': 'الدور', onChange: (e) => save(u, { role: e.target.value }) },
                Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: u.role === v }, l)))),
              h('td', null, h('label', { class: 'check' },
                h('input', { type: 'checkbox', checked: u.active, disabled: me, onChange: (e) => save(u, { active: e.target.checked }) }),
                h('span', null, 'مفعّل'))),
              h('td', { dir: 'ltr' }, date(u.created_at)));
          }))))),
      h('section', { class: 'card' },
        h('h2', null, 'صلاحيات الأدوار'),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
          h('thead', null, h('tr', null, h('th', null, 'الإجراء'), h('th', null, 'مدير'), h('th', null, 'مشرف'), h('th', null, 'فني'))),
          h('tbody', null, [
            ['عرض المشاريع والمراحل والمواد', 1, 1, 1],
            ['تحديث المراحل', 1, 1, 1],
            ['رؤية قيمة العقد', 1, 1, 0],
            ['إنشاء العقود وتعديلها', 1, 1, 0],
            ['إضافة المواد وحذفها', 1, 1, 0],
            ['النسخ الاحتياطي (تصدير واستيراد)', 1, 1, 0],
            ['حذف المشاريع', 1, 0, 0],
            ['إدارة المستخدمين وسجل العمليات', 1, 0, 0]
          ].map(([a, ...c]) => h('tr', null, h('td', null, a), c.map((x) => h('td', { class: x ? 'yes' : 'no' }, x ? '✓' : '—')))))))));
  }

  /* ---------- سجل العمليات (للمدير) ---------- */
  async function viewAudit() {
    const [log, users] = await Promise.all([
      state.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(200),
      state.sb.from('profiles').select('id, full_name')
    ]);
    if (log.error) { fail(log.error); return empty('تعذّر تحميل السجل'); }
    const names = Object.fromEntries((users.data || []).map((u) => [u.id, u.full_name]));
    const clients = Object.fromEntries(state.projects.map((p) => [p.id, p.client]));

    const describe = (e) => {
      const d = e.new_data || e.old_data || {};
      const parts = [];
      if (e.table_name === 'project_stages') parts.push(STAGE_NAME[d.stage_key] || '');
      if (e.table_name === 'materials') parts.push(d.name || '');
      if (e.table_name === 'profiles') parts.push(d.full_name || '');
      const pid = d.project_id || (e.table_name === 'projects' ? d.id : null);
      if (pid) parts.push(clients[pid] || d.client || '');
      if (e.action === 'UPDATE' && e.old_data && e.new_data) {
        const changed = Object.keys(e.new_data).filter((k) => !['updated_at', 'updated_by'].includes(k)
          && JSON.stringify(e.new_data[k]) !== JSON.stringify(e.old_data[k]));
        if (changed.length) parts.push('الحقول: ' + changed.join('، '));
      }
      return parts.filter(Boolean).join(' · ');
    };

    return h('section', { class: 'card' },
      h('p', { class: 'muted' }, 'آخر 200 عملية. السجل يُكتب على الخادم تلقائياً ولا يمكن تعديله أو حذفه من التطبيق.'),
      log.data.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
            h('thead', null, h('tr', null, h('th', null, 'الوقت'), h('th', null, 'المستخدم'), h('th', null, 'العملية'), h('th', null, 'الجدول'), h('th', null, 'التفاصيل'))),
            h('tbody', null, log.data.map((e) => h('tr', null,
              h('td', { dir: 'ltr' }, dateTime(e.at)),
              h('td', null, e.actor ? (names[e.actor] || 'مستخدم محذوف') : 'النظام'),
              h('td', null, h('span', { class: 'badge ' + e.action.toLowerCase() }, ACTIONS[e.action] || e.action)),
              h('td', null, TABLES[e.table_name] || e.table_name),
              h('td', null, describe(e)))))))
        : empty('لا توجد عمليات بعد'));
  }

  /* ---------- النسخ الاحتياطي ---------- */
  function viewBackup() {
    const exportData = () => ({
      app: 'surour-cooling',
      version: 2,
      exported_at: new Date().toISOString(),
      projects: state.projects.map((p) => ({
        client: p.client, brand: p.brand, phone: p.phone, address: p.address, map_url: p.map_url, size_m2: p.size_m2,
        floors: p.floors, contract_date: p.contract_date, notes: p.notes, total_iqd: totalOf(p),
        stages: stagesOf(p).map((s) => ({
          stage_key: s.stage_key, status: s.status, workers: s.workers, start_date: s.start_date,
          end_date: s.end_date, notes: s.notes, checklist: s.checklist
        })),
        materials: (p.materials || []).map((m) => ({ name: m.name, unit: m.unit, qty: m.qty }))
      }))
    });

    const download = () => {
      const blob = new Blob([JSON.stringify(exportData(), null, 2)], { type: 'application/json' });
      const a = h('a', { download: `surour-backup-${new Date().toISOString().slice(0, 10)}.json` });
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('تم تنزيل النسخة الاحتياطية');
    };

    const fileInput = h('input', { type: 'file', accept: '.json,application/json', id: 'imp-file' });
    const text = h('textarea', { rows: 6, dir: 'ltr', id: 'imp-text', placeholder: 'أو الصق نص النسخة الاحتياطية هنا' });
    const out = h('p', { class: 'muted', role: 'status' });
    const btn = h('button', { type: 'button', class: 'btn primary' }, 'استيراد');

    btn.addEventListener('click', async () => {
      let raw = text.value.trim();
      if (!raw && fileInput.files[0]) {
        if (fileInput.files[0].size > 5 * 1024 * 1024) return toast('الملف أكبر من 5 ميغابايت', 'error');
        raw = await fileInput.files[0].text();
      }
      if (!raw) return toast('اختر ملفاً أو الصق النص أولاً', 'error');

      let list;
      try { list = normalizeBackup(JSON.parse(raw)); } catch (e) { return toast('الملف غير صالح: ' + (e.message || ''), 'error'); }
      if (!list.length) return toast('لا توجد مشاريع في الملف', 'error');

      const ok = await confirmBox({
        title: 'استيراد نسخة احتياطية',
        body: `سيتم إضافة ${list.length} مشروع إلى قاعدة البيانات بجانب المشاريع الحالية (لن يُحذف شيء). إذا استوردت الملف نفسه مرتين ستتكرر المشاريع. هل تتابع؟`,
        okText: 'استيراد'
      });
      if (!ok) return;

      btn.disabled = true;
      let okCount = 0;
      const failed = [];
      for (let i = 0; i < list.length; i++) {
        out.textContent = `جارٍ الاستيراد ${i + 1} من ${list.length}…`;
        try { await importOne(list[i]); okCount++; } catch (e) { failed.push(`${list[i].client}: ${errText(e)}`); }
      }
      btn.disabled = false;
      out.textContent = `تم استيراد ${okCount} مشروع` + (failed.length ? `، وفشل ${failed.length}: ${failed.join(' | ')}` : '');
      await loadProjects();
      toast(`تم استيراد ${okCount} مشروع`, failed.length ? 'error' : 'ok');
    });

    return h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h2', null, 'تصدير'),
        h('p', { class: 'muted' }, `تنزيل كل المشاريع (${state.projects.length}) بمراحلها وموادها في ملف JSON. احفظه في مكان آمن لأنه يحتوي بيانات العملاء.`),
        h('button', { type: 'button', class: 'btn primary', onClick: download }, 'تنزيل النسخة الاحتياطية')),
      h('section', { class: 'card' },
        h('h2', null, 'استيراد'),
        h('p', { class: 'muted' }, 'يقبل ملفات هذا الإصدار وملفات النسخة القديمة (المحفوظة في المتصفح) لنقلها إلى قاعدة البيانات.'),
        field('ملف النسخة الاحتياطية', fileInput),
        text,
        h('div', { class: 'row' }, btn),
        out));
  }

  // توحيد صيغة النسخة القديمة (مصفوفة) والجديدة (version: 2)
  function normalizeBackup(json) {
    const arr = Array.isArray(json) ? json : json?.projects;
    if (!Array.isArray(arr)) throw new Error('الصيغة غير معروفة');
    if (arr.length > 5000) throw new Error('عدد المشاريع كبير جداً');
    const s = (v, max) => (v === null || v === undefined || v === '' ? null : String(v).trim().slice(0, max) || null);
    const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    const d = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

    return arr.map((p, i) => {
      if (!p || typeof p !== 'object' || !s(p.client, 200)) throw new Error(`المشروع رقم ${i + 1} بلا اسم عميل`);
      const legacy = Array.isArray(json);
      const contract = d(legacy ? p.contractDate : p.contract_date) || new Date().toISOString().slice(0, 10);
      const mapUrl = s(legacy ? p.mapUrl : p.map_url, 1000);

      let stages = [];
      if (legacy) {
        stages = STAGES.filter((st) => st.key !== 'contract').map((st) => {
          const o = p.stages?.[st.key] || {};
          const checklist = st.key === 'survey'
            ? Object.fromEntries(READY.map((r, k) => [r.key, Boolean(p.ready?.[k])])) : {};
          return { stage_key: st.key, status: STATUS_FROM_AR[o.status] || 'not_started', workers: n(o.crew),
                   start_date: d(o.start), end_date: d(o.end), notes: s(o.notes, 4000), checklist };
        });
      } else {
        stages = (p.stages || []).filter((st) => STAGE_NAME[st?.stage_key] && st.stage_key !== 'contract').map((st) => ({
          stage_key: st.stage_key, status: STATUS[st.status] ? st.status : 'not_started', workers: n(st.workers),
          start_date: d(st.start_date), end_date: d(st.end_date), notes: s(st.notes, 4000),
          checklist: st.checklist && typeof st.checklist === 'object'
            ? Object.fromEntries(READY.map((r) => [r.key, Boolean(st.checklist[r.key])])) : {}
        }));
      }

      return {
        client: s(p.client, 200),
        brand: BRANDS[String(p.brand || '').toLowerCase()] ? String(p.brand).toLowerCase() : null,
        phone: s(p.phone, 20),
        address: s(p.address, 300),
        map_url: mapUrl && SAFE_URL.test(mapUrl) ? mapUrl : null,
        size_m2: n(legacy ? p.size : p.size_m2),
        floors: n(p.floors),
        contract_date: contract,
        notes: s(p.notes, 4000),
        total_iqd: n(legacy ? p.total : p.total_iqd),
        stages,
        materials: (Array.isArray(p.materials) ? p.materials : [])
          .filter((m) => m && s(m.name, 200))
          .map((m) => ({ name: s(m.name, 200), unit: s(m.unit, 40), qty: n(m.qty) }))
      };
    });
  }

  async function importOne(p) {
    const ins = await state.sb.from('projects').insert({
      client: p.client, brand: p.brand, phone: p.phone && /^\+?[0-9 ()-]{7,20}$/.test(p.phone) ? p.phone : null, address: p.address,
      map_url: p.map_url, size_m2: p.size_m2 > 0 ? p.size_m2 : null,
      floors: Number.isInteger(p.floors) && p.floors >= 0 ? p.floors : null,
      contract_date: p.contract_date,
      notes: p.notes
    }).select('id').single();
    if (ins.error) throw ins.error;
    const id = ins.data.id;

    if (p.total_iqd != null && p.total_iqd >= 0) {
      const f = await state.sb.from('project_finance').update({ total_iqd: Math.round(p.total_iqd) }).eq('project_id', id);
      if (f.error) throw f.error;
    }
    for (const st of p.stages) {
      const { stage_key, ...patch } = st;
      if (patch.end_date && patch.start_date && patch.end_date < patch.start_date) patch.end_date = null;
      const u = await state.sb.from('project_stages').update(patch).eq('project_id', id).eq('stage_key', stage_key);
      if (u.error) throw u.error;
    }
    if (p.materials.length) {
      const m = await state.sb.from('materials').insert(p.materials.map((x) => ({ ...x, project_id: id })));
      if (m.error) throw m.error;
    }
  }

  /* ---------- البدء ---------- */
  applyTheme();
  boot().catch(fail);
})();
