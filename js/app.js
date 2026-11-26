/* ==========================================================
   مصاعد السرور - متابعة فحص جودة VRF (الإصدار 4)
   التطبيق انعكاس لملف VRF QC Tracker: نفس الأوراق ونفس الأعمدة ونفس المعادلات.
   الأوراق في js/sheets.js. الصلاحيات الحقيقية على الخادم (supabase/schema.sql).
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, toast, num, date, dateTime } = window.UI;
  const root = document.getElementById('root');
  const cfg = window.SUROUR_CONFIG || {};

  const ROLES = { admin: 'مدير', supervisor: 'مشرف', technician: 'فني' };

  // المحافظات على شبكة مربعات تقريبية (الشمال فوق والغرب يسار): [الاسم، العمود، الصف]
  const GOVS = [
    ['دهوك', 3, 1], ['نينوى', 2, 2], ['أربيل', 3, 2], ['السليمانية', 4, 2],
    ['صلاح الدين', 2, 3], ['كركوك', 3, 3], ['ديالى', 4, 3],
    ['الأنبار', 1, 4], ['بغداد', 2, 4], ['واسط', 3, 4],
    ['كربلاء', 1, 5], ['بابل', 2, 5], ['ميسان', 4, 5],
    ['النجف', 1, 6], ['القادسية', 2, 6], ['ذي قار', 3, 6], ['البصرة', 4, 6],
    ['المثنى', 2, 7]
  ];
  const PTYPES = { residential: 'مجمّع سكني / فلل', apartments: 'شقق وعمارات', commercial: 'مبنى تجاري', government: 'مبنى حكومي', other: 'أخرى' };
  const BRAND_SUGGEST = ['LG', 'Midea', 'Gree', 'Samsung', 'Daikin', 'Carrier', 'Toshiba', 'Hitachi', 'Mitsubishi', 'Haier', 'TCL'];
  // صيغ اسم الوحدة: المفرد، المعرّف، الجمع، الجمع المعرّف، المؤنث؟
  const UNIT_WORDS = {
    'فيلا': ['فيلا', 'الفيلا', 'فلل', 'الفلل', true], 'بيت': ['بيت', 'البيت', 'بيوت', 'البيوت', false],
    'شقة': ['شقة', 'الشقة', 'شقق', 'الشقق', true], 'طابق': ['طابق', 'الطابق', 'طوابق', 'الطوابق', false],
    'مبنى': ['مبنى', 'المبنى', 'مبانٍ', 'المباني', false], 'منظومة': ['منظومة', 'المنظومة', 'منظومات', 'المنظومات', true],
    'وحدة': ['وحدة', 'الوحدة', 'وحدات', 'الوحدات', true]
  };
  const unitWords = (p) => { const w = UNIT_WORDS[p?.unit_label] || UNIT_WORDS['وحدة']; return { one: w[0], the: w[1], many: w[2], theMany: w[3], fem: w[4] }; };
  // قيم الخانات كما في الملف، مع الاسم العربي للعرض
  const RES = { pass: 'Pass', fail: 'Fail', pending: 'Pending', na: 'N/A' };
  const RES_AR = { pass: 'ناجح', fail: 'فاشل', pending: 'معلّق', na: 'لا ينطبق' };
  const STATUS_AR = { 'Complete': 'مكتملة', 'In progress': 'جارية', 'Not started': 'لم تبدأ', 'Has failure': 'بها فشل' };
  const TABLES = { profiles: 'المستخدمون', projects: 'المشاريع', units: 'Villa Tracker', unit_checks: 'Villa Tracker',
    test_records: 'Test Records', ncrs: 'NCR Register', materials: 'المواد' };
  const ACTIONS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };

  const state = {
    sb: null, user: null, profile: null,
    projects: [], checkpoints: [],
    data: {}          // لكل مشروع: { units, tests: Map(unit_id), ncrs }
  };
  const role = () => state.profile?.role;
  const isAdmin = () => role() === 'admin';
  const isStaff = () => role() === 'admin' || role() === 'supervisor';

  /* ==========================================================
     المعادلات - منقولة حرفياً من ملف VRF QC Tracker
     ========================================================== */
  const F = {
    // Villa Tracker, الصف n:  D..P = النتائج
    row(u, cps, openNcrs) {
      const r = (k) => RES[u.results?.[k] || 'pending'];
      const vals = cps.map((c) => r(c.key));
      const Q = vals.filter((v) => v === 'Pass').length;                       // =COUNTIF(D:P,"Pass")
      const R = vals.filter((v) => v === 'Fail').length;                       // =COUNTIF(D:P,"Fail")
      const NA = vals.filter((v) => v === 'N/A').length;
      const S = 13 - NA ? Q / (13 - NA) : 0;                                   // =IFERROR(Q/(13-COUNTIF(D:P,"N/A")),0)
      const T = openNcrs;                                                      // =COUNTIFS(NCR!C,A,NCR!H,"Open")
      const U = R > 0 ? 'Has failure' : Q + NA === 13 ? 'Complete' : Q === 0 ? 'Not started' : 'In progress';
      const ni = vals.findIndex((v) => v === 'Pending' || v === 'Fail');      // =INDEX($D$4:$P$4,MATCH(1,...))
      const V = U === 'Complete' ? '-' : ni >= 0 ? cps[ni] : '-';
      // =IF(OR(AND(I="Pass",OR(G<>"Pass",H<>"Pass")),AND(M="Pass",OR(G<>"Pass",H<>"Pass",K<>"Pass")),AND(N="Pass",M<>"Pass")),"SEQUENCE ALERT","")
      const G = r('pressure_test'), H = r('vacuum'), I = r('insulation'), K = r('megger'), M = r('charging'), N = r('commissioning');
      const W = (I === 'Pass' && (G !== 'Pass' || H !== 'Pass'))
        || (M === 'Pass' && (G !== 'Pass' || H !== 'Pass' || K !== 'Pass'))
        || (N === 'Pass' && M !== 'Pass');
      return { Q, R, S, T, U, V, W, NA };
    },
    // Test Records
    test(t, p) {
      const blank = (x) => x === null || x === undefined || x === '';
      const n = (x) => (blank(x) ? 0 : Number(x));          // الخلية الفارغة = صفر في مقارنات Excel
      const H = blank(t.start_mpa) || blank(t.end_mpa) ? '' : Math.round((n(t.start_mpa) - n(t.end_mpa)) * 10000) / 10000;   // =IF(OR(F="",G=""),"",F-G)
      const I = H === '' ? '' : H <= Number(p.lim_pressure_drop) ? 'OK' : 'CHECK';                                          // =IF(H="","",IF(H<=$B$2,"OK","CHECK"))
      const N = blank(t.vacuum_microns) ? '' : (n(t.vacuum_microns) <= Number(p.lim_vacuum_max) && n(t.vacuum_hold_min) >= Number(p.lim_vacuum_hold) && n(t.vacuum_rise) <= 50) ? 'OK' : 'CHECK';
      const Q = blank(t.charge_calc_kg) || blank(t.charge_actual_kg) ? '' : Math.round((n(t.charge_actual_kg) - n(t.charge_calc_kg)) * 100) / 100;  // =IF(OR(O="",P=""),"",P-O)
      const R = Q === '' || !n(t.charge_calc_kg) ? '' : Q / n(t.charge_calc_kg);                                              // =IF(Q="","",IFERROR(Q/O,""))
      const S = R === '' ? '' : Math.abs(R) <= Number(p.lim_charge_tol) ? 'OK' : 'CHECK';                                    // =IF(R="","",IF(ABS(R)<=$N$2,"OK","CHECK"))
      return { H, I, N, Q, R, S };
    },
    // Dashboard
    dashboard(d, cps) {
      const rows = d.units.map((u) => F.row(u, cps, openNcrsOf(d, u.id)));
      const B3 = d.units.length;
      const per = cps.map((c) => {
        const cnt = { Pass: 0, Fail: 0, Pending: 0, 'N/A': 0 };
        d.units.forEach((u) => { cnt[RES[u.results?.[c.key] || 'pending']]++; });
        return { c, ...cnt, pct: B3 - cnt['N/A'] ? cnt.Pass / (B3 - cnt['N/A']) : 0 };   // =IFERROR(B/($B$3-E),0)
      });
      const sumPass = per.reduce((s, x) => s + x.Pass, 0), sumNA = per.reduce((s, x) => s + x['N/A'], 0);
      return {
        B3,
        B4: rows.filter((x) => x.U === 'Complete').length,
        B5: rows.filter((x) => x.U === 'In progress').length,
        B6: rows.filter((x) => x.U === 'Not started').length,
        B7: rows.filter((x) => x.U === 'Has failure').length,
        B8: rows.filter((x) => x.W).length,
        B9: d.ncrs.filter((x) => x.status === 'open').length,
        B10: B3 * 13 - sumNA ? sumPass / (B3 * 13 - sumNA) : 0,          // =IFERROR(SUM(B15:B27)/(B3*13-SUM(E15:E27)),0)
        per
      };
    }
  };
  const openNcrsOf = (d, unitId) => d.ncrs.filter((n) => n.unit_id === unitId && n.status === 'open').length;
  const pctText = (x) => (Math.round((x || 0) * 1000) / 10) + '%';

  /* ---------- الأخطاء ---------- */
  function errText(error) {
    const m = String(error?.message || error || '');
    if (/Invalid login credentials/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
    if (/Email not confirmed/i.test(m)) return 'لم يتم تأكيد البريد الإلكتروني بعد';
    if (/[؀-ۿ]/.test(m)) return m;
    if (/duplicate key|unique/i.test(m)) return 'هذا الرقم موجود مسبقاً';
    if (/row-level security|permission denied/i.test(m)) return 'ليست لديك صلاحية لهذا الإجراء';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'تعذّر الاتصال بالخادم، تحقّق من الإنترنت';
    if (/check constraint|invalid input|out of range/i.test(m)) return 'قيمة غير مقبولة';
    return 'حدث خطأ غير متوقع، حاول مرة أخرى';
  }
  function fail(e) { console.error(e); toast(errText(e), 'error'); }

  /* ---------- البيانات ---------- */
  async function fetchAll(make) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await make(from, from + 999);
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) return out;
    }
  }

  async function loadBase() {
    const [projects, cps] = await Promise.all([
      state.sb.from('projects').select('*').order('created_at'),
      state.sb.from('qc_checkpoints').select('*').order('position')]);
    if (projects.error) throw projects.error;
    if (cps.error) throw cps.error;
    state.projects = projects.data;
    state.checkpoints = cps.data;
  }

  async function loadProject(id, force = false) {
    if (state.data[id] && !force) return state.data[id];
    const sb = state.sb;
    const [units, tests, ncrs] = await Promise.all([
      fetchAll((a, b) => sb.from('unit_overview').select('*').eq('project_id', id).order('position').order('code').range(a, b)),
      fetchAll((a, b) => sb.from('test_records').select('*, units!inner(project_id)').eq('units.project_id', id).range(a, b)),
      fetchAll((a, b) => sb.from('ncrs').select('*').eq('project_id', id).order('date_raised').order('created_at').range(a, b))]);
    tests.forEach((t) => delete t.units);
    state.data[id] = { units, tests: new Map(tests.map((t) => [t.unit_id, t])), ncrs };
    return state.data[id];
  }

  /* ---------- التشغيل ---------- */
  async function boot() {
    const ok = cfg.supabaseUrl && !/YOUR-PROJECT/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/YOUR-ANON-KEY/.test(cfg.supabaseAnonKey);
    if (!ok || !window.supabase) return renderSetupNeeded();
    state.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    state.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') { Object.assign(state, { user: null, profile: null, projects: [], data: {} }); render(); }
      else if (event === 'SIGNED_IN' && session && session.user.id !== state.user?.id) setTimeout(() => startSession(session.user), 0);
    });
    const { data } = await state.sb.auth.getSession();
    if (data.session) await startSession(data.session.user); else render();
  }

  async function startSession(user) {
    state.user = user;
    const { data, error } = await state.sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) return fail(error);
    state.profile = data;
    if (data && data.active) {
      clear(root).appendChild(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
      try { await loadBase(); } catch (e) { fail(e); }
    }
    render();
  }

  /* ---------- التوجيه ---------- */
  function parseRoute() {
    const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').map(decodeURIComponent);
    return { name: parts[0] || 'home', id: parts[1] || null, tab: parts[2] || null, sub: parts[3] || null };
  }
  const go = (path) => { location.hash = '#/' + path; };
  window.addEventListener('hashchange', () => render());
  const views = {};

  function render() {
    clear(root);
    if (!state.sb) return renderSetupNeeded();
    if (!state.user) return root.appendChild(viewLogin());
    if (!state.profile || !state.profile.active) return root.appendChild(viewInactive());

    const r = parseRoute();
    // مشروع واحد فقط؟ افتحه مباشرة مثل فتح ملف Excel
    let v = views[r.name] || views.home;
    if (v.allow && !v.allow()) v = views.home;
    const title = typeof v.title === 'function' ? v.title(r) : v.title;
    document.title = title + ' | مصاعد السرور';

    const main = h('main', { class: 'main' });
    root.appendChild(h('div', { class: 'app' }, topbar(r), main));
    const out = v.render(r);
    if (out instanceof Promise) {
      main.appendChild(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
      out.then((n) => clear(main).appendChild(n), (e) => { fail(e); clear(main).appendChild(empty('تعذّر التحميل')); });
    } else main.appendChild(out);
  }

  function topbar(r) {
    const p = r.name === 'project' ? state.projects.find((x) => x.id === r.id) : null;
    const menu = [
      ['home', 'المشاريع', true],
      ['users', 'المستخدمون', isAdmin()],
      ['audit', 'سجل العمليات', isAdmin()],
      ['backup', 'نسخة احتياطية', isStaff()]
    ].filter((x) => x[2]);
    const header = h('header', { class: 'bar' },
      h('a', { href: '#/home', class: 'logo', onClick: () => { state._stayHome = true; } },
        logo(), h('span', { class: 'logo-text' }, 'متابعة الجودة')),
      p ? h('span', { class: 'crumb' }, p.client) : null,
      h('button', { type: 'button', class: 'btn ghost menu-btn', 'aria-label': 'القائمة', 'aria-expanded': 'false', onClick: (e) => {
        const open = header.classList.toggle('open');
        e.currentTarget.setAttribute('aria-expanded', String(open));
      } }, '☰'),
      h('div', { class: 'bar-menu' },
        h('nav', { class: 'bar-nav' }, menu.map(([k, l]) => h('a', { href: '#/' + k, class: r.name === k ? 'on' : '', onClick: k === 'home' ? () => { state._stayHome = true; } : null }, l))),
        h('div', { class: 'bar-me' },
          h('span', { class: 'muted small' }, (state.profile.full_name || state.user.email) + ' · ' + ROLES[role()]),
          h('button', { class: 'btn ghost sm', type: 'button', onClick: toggleTheme, title: 'المظهر الفاتح/الداكن', 'aria-label': 'تبديل المظهر' }, 'المظهر'),
          h('button', { class: 'btn ghost sm', type: 'button', onClick: signOut }, 'خروج'))));
    return header;
  }

  function applyTheme() {
    let t = null;
    try { t = localStorage.getItem('surour_theme'); } catch (e) { /* */ }
    if (t) document.documentElement.dataset.theme = t;
  }
  function toggleTheme() {
    const cur = document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('surour_theme', next); } catch (e) { /* */ }
  }

  const logo = (cls = '') => h('span', { class: 'logo-img ' + cls },
    h('img', { src: 'img/sorror-logo.png', alt: 'سرور', class: 'on-light', width: 565, height: 167 }),
    h('img', { src: 'img/sorror-logo-light.png', alt: '', 'aria-hidden': 'true', class: 'on-dark', width: 565, height: 167 }));

  /* ---------- الدخول ---------- */
  function renderSetupNeeded() {
    clear(root).appendChild(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      h('h1', null, 'التطبيق غير مربوط بقاعدة البيانات'), h('p', { class: 'muted' }, 'أضف الرابط ومفتاح anon في js/config.js.'))));
  }
  function viewLogin() {
    const email = h('input', { type: 'email', id: 'email', autocomplete: 'username', dir: 'ltr', required: true, inputmode: 'email' });
    const pass = h('input', { type: 'password', id: 'password', autocomplete: 'current-password', dir: 'ltr', required: true });
    const err = h('p', { class: 'err', role: 'alert' });
    const btn = h('button', { class: 'btn primary block', type: 'submit' }, 'تسجيل الدخول');
    // قطعة من مخطط المجمّع كخلفية: فلل بدرجات الإنجاز
    const pattern = h('div', { class: 'auth-plan', 'aria-hidden': 'true' },
      Array.from({ length: 60 }, (_, i) => h('i', { class: 'p' + ([0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 1, 0, 4, 0, 0, 2, 0, 5, 0, 0][(i * 7) % 20]) })));
    return h('div', { class: 'auth2' },
      h('section', { class: 'auth-brand' }, pattern,
        h('div', { class: 'auth-brand-in' }, logo('big'),
          h('p', null, 'متابعة فحص جودة تركيب منظومات التبريد في كل مشاريع سرور، وحدة وحدة ومرحلة مرحلة.'))),
      h('form', { class: 'auth-form', onSubmit: async (e) => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
        const { error } = await state.sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
        btn.disabled = false; btn.textContent = 'تسجيل الدخول';
        if (error) err.textContent = errText(error);
      } },
        h('h1', null, 'تسجيل الدخول'),
        field('البريد الإلكتروني', email), field('كلمة المرور', pass), err, btn,
        h('p', { class: 'muted small' }, 'الحسابات يُنشئها المدير. إذا نسيت كلمة المرور فتواصل معه.')));
  }
  function viewInactive() {
    return h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('h1', null, 'الحساب غير مفعّل'),
      h('p', { class: 'muted' }, 'تواصل مع المدير.'), h('button', { class: 'btn ghost', type: 'button', onClick: signOut }, 'خروج')));
  }
  async function signOut() { await state.sb.auth.signOut(); location.hash = ''; }

  /* ---------- عناصر مشتركة ---------- */
  function field(label, input, opts = {}) {
    if (!input.id) input.id = 'f-' + Math.random().toString(36).slice(2, 8);
    return h('div', { class: 'field' + (opts.wide ? ' wide' : '') }, h('label', { for: input.id }, label), input,
      opts.hint ? h('small', { class: 'muted' }, opts.hint) : null);
  }
  const empty = (title, sub, action) => h('div', { class: 'empty' }, h('strong', null, title), sub ? h('p', { class: 'muted' }, sub) : null, action || null);
  function modal(title, body, actions) {
    const dlg = document.getElementById('dialog');
    if (dlg.open) dlg.close();
    dlg.onclose = null;
    clear(dlg);
    const close = () => dlg.close();
    dlg.appendChild(h('form', { method: 'dialog', class: 'dialog-body', onSubmit: (e) => e.preventDefault() }, h('h2', null, title), body,
      h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn ghost', onClick: close }, 'إلغاء'),
        actions.map((a) => h('button', { type: 'button', class: 'btn ' + (a.cls || ''), onClick: async (e) => {
          const btn = e.currentTarget;
          btn.disabled = true;
          try { if (await a.run() !== false && dlg.contains(btn)) close(); } finally { btn.disabled = false; }
        } }, a.label)))));
    dlg.oncancel = null;
    dlg.showModal();
  }
  function download(blob, name) {
    const a = h('a', { download: name });
    a.href = URL.createObjectURL(blob);
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- المشاريع ---------- */
  views.home = {
    title: 'مشاريع سرور',
    async render() {
      await Promise.all(state.projects.map((p) => loadProject(p.id)));
      const cps = state.checkpoints;
      const f = state._hf || (state._hf = { gov: '', brand: '' });
      const today = new Date().toISOString().slice(0, 10);
      const rows = state.projects.map((p) => {
        const d = state.data[p.id];
        const D = F.dashboard(d, cps);
        const units = d.units.map((u) => F.row(u, cps, openNcrsOf(d, u.id)));
        const late = d.ncrs.filter((n) => n.status === 'open' && n.due_date && n.due_date < today).length;
        return { p, d, D, fails: units.filter((k) => k.R).length, alerts: D.B8, open: D.B9, late };
      });
      const issues = (r) => r.fails + r.alerts + r.open;
      const sum = (k) => rows.reduce((a, r) => a + r.D[k], 0);
      let pass = 0, den = 0;
      rows.forEach((r) => r.D.per.forEach((x) => { pass += x.Pass; den += r.D.B3 - x['N/A']; }));
      const overall = den ? pass / den : 0;
      const govCount = new Set(state.projects.map((p) => p.governorate).filter(Boolean)).size;
      const attn = rows.filter((r) => issues(r)).sort((a, b) => (b.late - a.late) || (issues(b) - issues(a)));

      const lead = !rows.length ? 'لا توجد مشاريع بعد. أنشئ أول مشروع لتبدأ المتابعة.'
        : `${num(rows.length)} ${rows.length === 1 ? 'مشروع' : rows.length <= 10 ? 'مشاريع' : 'مشروعاً'} في ${num(govCount)} ${govCount === 1 ? 'محافظة' : 'محافظات'}، فيها ${num(sum('B3'))} وحدة. `
          + (attn.length ? `${attn.length === 1 ? 'مشروع واحد يحتاج' : num(attn.length) + ' مشاريع تحتاج'} انتباهك.` : 'لا مشاكل مفتوحة الآن.');

      // خريطة المحافظات
      const band = (v, has) => (!has ? 'none' : v >= 1 ? 'done' : v === 0 ? 'b0' : v < 0.25 ? 'b1' : v < 0.5 ? 'b2' : v < 0.75 ? 'b3' : 'b4');
      const govMap = h('div', { class: 'gov-map', role: 'list', 'aria-label': 'المشاريع حسب المحافظة' }, GOVS.map(([g, c, r]) => {
        const rs = rows.filter((x) => x.p.governorate === g);
        let gp = 0, gd = 0;
        rs.forEach((x) => x.D.per.forEach((y) => { gp += y.Pass; gd += x.D.B3 - y['N/A']; }));
        const prob = rs.some((x) => x.fails || x.open) ? ' flag-fail' : rs.some((x) => x.alerts) ? ' flag-alert' : '';
        const label = `${g}: ${rs.length ? `${rs.length} مشروع، إنجاز ${pctText(gd ? gp / gd : 0)}` : 'لا مشاريع'}`;
        const el = h('button', { type: 'button', role: 'listitem', class: `gov tile ${band(gd ? gp / gd : 0, rs.length)}${prob}${f.gov === g ? ' sel' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(f.gov === g),
          onClick: () => { f.gov = f.gov === g ? '' : g; render(); } }, h('span', { class: 'g-name' }, g), rs.length ? h('b', null, String(rs.length)) : null);
        el.style.gridColumn = String(c); el.style.gridRow = String(r);
        return el;
      }));

      // حسب الماركة
      const brands = [...new Set(rows.map((r) => r.p.brand || 'غير محددة'))].sort();
      const byBrand = brands.map((b) => {
        const rs = rows.filter((r) => (r.p.brand || 'غير محددة') === b);
        let bp = 0, bd = 0; rs.forEach((x) => x.D.per.forEach((y) => { bp += y.Pass; bd += x.D.B3 - y['N/A']; }));
        return { b, n: rs.length, units: rs.reduce((a, x) => a + x.D.B3, 0), pct: bd ? bp / bd : 0 };
      });

      // قائمة المشاريع (تتأثر باختيار المحافظة والماركة)
      const list = rows.filter((r) => (!f.gov || r.p.governorate === f.gov) && (!f.brand || (r.p.brand || 'غير محددة') === f.brand));
      const projRow = (r) => h('li', null, h('a', { href: '#/project/' + r.p.id, class: 'proj' },
        h('span', { class: 'pj-main' }, h('b', null, r.p.client),
          h('small', null, [r.p.governorate, r.p.city, r.p.brand, PTYPES[r.p.project_type]].filter(Boolean).join('، ') || 'بدون بيانات موقع')),
        h('span', { class: 'pj-units' }, `${num(r.D.B3)} ${unitWords(r.p).one}`),
        h('span', { class: 'pj-prog' }, h('span', { class: 'st-bar' }, h('span', { style: { width: (r.D.B10 * 100).toFixed(1) + '%' } })), h('b', null, pctText(r.D.B10))),
        h('span', { class: 'pj-flags' },
          r.fails ? h('span', { class: 'chip st-has-failure' }, `${r.fails} فيها فشل`) : null,
          r.alerts ? h('span', { class: 'chip alert' }, `${r.alerts} تنبيه`) : null,
          r.open ? h('span', { class: 'chip' }, `${r.open} NCR` + (r.late ? `، ${r.late} متأخرة` : '')) : null)));

      const out = h('div', { class: 'dash2 home' },
        h('header', { class: 'd2-head' },
          h('p', { class: 'd2-lead' }, lead),
          h('div', { class: 'd2-pct' }, h('strong', null, pctText(overall)), h('span', null, 'من فحوصات كل المشاريع منجزة'))),
        h('dl', { class: 'd2-stats' }, [
          ['المشاريع', rows.length, ''], ['الوحدات', sum('B3'), ''], ['وحدات مكتملة', sum('B4'), 'ok'],
          ['فيها بند فاشل', sum('B7'), sum('B7') ? 'bad' : 'muted'], ['تنبيهات تسلسل', sum('B8'), sum('B8') ? 'warn' : 'muted'], ['NCR مفتوحة', sum('B9'), sum('B9') ? 'bad' : 'muted']
        ].map(([l, v, c]) => h('div', { class: 'st ' + c }, h('dd', null, num(v)), h('dt', null, l)))),
        h('div', { class: 'd2-grid' },
          h('section', { class: 'd2-plan' },
            h('div', { class: 'd2-plan-head' }, h('h2', null, 'المشاريع حسب المحافظة'),
              h('span', { class: 'd2-note' }, f.gov ? `معروض: ${f.gov}. اضغطها مرة ثانية لإلغاء الاختيار` : 'اضغط محافظة لعرض مشاريعها')),
            govMap),
          h('aside', { class: 'd2-side' },
            h('section', { class: 'd2-attn' + (attn.length ? ' has' : '') },
              h('h2', null, 'مشاريع تحتاج انتباهك'),
              attn.length ? h('ul', null, attn.slice(0, 12).map((r) => h('li', null, h('a', { href: '#/project/' + r.p.id },
                h('b', null, r.p.client),
                h('span', { class: 'why' + (r.fails || r.open ? '' : ' alert') }, [r.fails ? `${r.fails} وحدة فيها فشل` : '', r.alerts ? `${r.alerts} تنبيه تسلسل` : '', r.open ? `${r.open} NCR مفتوحة` : '', r.late ? `${r.late} متأخرة` : ''].filter(Boolean).join('، ')),
                h('span', { class: 'nx' }, r.p.governorate || '')))))
                : h('p', { class: 'calm' }, 'لا فشل ولا تنبيهات ولا NCR مفتوحة.')),
            h('section', { class: 'd2-brands' }, h('h2', null, 'حسب الماركة'),
              byBrand.length ? h('ul', { class: 'brand-list' }, byBrand.map((x) => h('li', null,
                h('button', { type: 'button', class: f.brand === x.b ? 'sel' : '', 'aria-pressed': String(f.brand === x.b), onClick: () => { f.brand = f.brand === x.b ? '' : x.b; render(); } },
                  h('b', { dir: 'auto' }, x.b), h('small', null, `${x.n} مشروع، ${num(x.units)} وحدة`),
                  h('span', { class: 'st-bar' }, h('span', { style: { width: (x.pct * 100).toFixed(1) + '%' } })), h('span', { class: 'bp' }, pctText(x.pct))))))
                : h('p', { class: 'calm' }, '—')))),
        h('section', { class: 'd2-today', 'aria-live': 'polite' }, h('h2', null, 'نشاط اليوم'), todayActivity()),
        h('section', { class: 'd2-projects' },
          h('div', { class: 'd2-plan-head' },
            h('h2', null, f.gov || f.brand ? `المشاريع: ${[f.gov, f.brand].filter(Boolean).join('، ')} (${list.length})` : `كل المشاريع (${list.length})`),
            h('div', { class: 'row' },
              f.gov || f.brand ? h('button', { type: 'button', class: 'btn sm', onClick: () => { f.gov = ''; f.brand = ''; render(); } }, 'إلغاء التصفية') : null,
              isStaff() ? h('button', { type: 'button', class: 'btn sm primary', onClick: newProject }, '+ مشروع جديد') : null)),
          list.length ? h('ul', { class: 'proj-list' }, list.map(projRow)) : h('p', { class: 'calm muted' }, rows.length ? 'لا مشاريع بهذه التصفية.' : (isStaff() ? 'أنشئ أول مشروع من زر "+ مشروع جديد".' : 'لم يُنشئ المدير أي مشروع بعد.'))));
      return out;
    }
  };

  // نشاط اليوم: آخر تغييرات النتائج في كل المشاريع
  function todayActivity() {
    const box = h('div', null, h('p', { class: 'd2-note' }, 'جارٍ التحميل…'));
    const start = new Date(); start.setHours(0, 0, 0, 0);
    Promise.all([
      fetchAll((a, b) => state.sb.from('unit_checks').select('unit_id, checkpoint, result, inspected_by, inspected_at, units!inner(project_id, code)')
        .gte('inspected_at', start.toISOString()).order('inspected_at', { ascending: false }).range(a, b)),
      state.sb.from('profiles').select('id, full_name')
    ]).then(([rows, prof]) => {
      const names = Object.fromEntries((prof.data || []).map((x) => [x.id, x.full_name]));
      const cp = Object.fromEntries(state.checkpoints.map((c) => [c.key, c.name_ar]));
      const proj = Object.fromEntries(state.projects.map((p) => [p.id, p]));
      clear(box);
      if (!rows.length) return box.appendChild(h('p', { class: 'calm muted' }, 'لم تُسجَّل فحوصات اليوم بعد.'));
      const cnt = { pass: 0, fail: 0, na: 0, pending: 0 };
      rows.forEach((x) => { cnt[x.result]++; });
      // سطر لكل وحدة: ماذا تغيّر فيها اليوم
      const byUnit = new Map();
      rows.forEach((x) => {
        if (!byUnit.has(x.unit_id)) byUnit.set(x.unit_id, { x, items: [], who: new Set() });
        const g = byUnit.get(x.unit_id); g.items.push(x); if (x.inspected_by) g.who.add(names[x.inspected_by] || '');
      });
      const units = [...byUnit.values()];
      box.append(h('p', { class: 'd2-note' }, `${num(rows.length)} نتيجة سُجّلت اليوم في ${num(units.length)} وحدة: ناجح ${cnt.pass}، فاشل ${cnt.fail}، لا ينطبق ${cnt.na}.`),
        h('ol', { class: 'today-list' }, units.slice(0, 10).map(({ x, items, who }) => {
          const fails = items.filter((i) => i.result === 'fail');
          const passes = items.filter((i) => i.result === 'pass').length;
          return h('li', { class: fails.length ? 'act-fail' : '' },
            h('time', { dir: 'ltr' }, new Date(x.inspected_at).toTimeString().slice(0, 5)),
            h('a', { href: `#/project/${x.units.project_id}/villa/${x.unit_id}` }, h('b', null, x.units.code), ' ', proj[x.units.project_id]?.client || ''),
            h('span', null, fails.length ? `فاشل: ${fails.map((i) => cp[i.checkpoint]).join('، ')}` : `${passes} ناجح` + (items.length > passes ? `، ${items.length - passes} أخرى` : '')),
            h('small', null, [...who].filter(Boolean).join('، ')));
        })),
        units.length > 10 ? h('p', { class: 'd2-note' }, `و${num(units.length - 10)} وحدة أخرى.`) : null);
    }).catch(() => { clear(box).appendChild(h('p', { class: 'calm muted' }, 'تعذّر تحميل نشاط اليوم.')); });
    return box;
  }

  // حقول بيانات المشروع (للإنشاء والتعديل)
  function projectFields(p = {}) {
    const el = {
      name: h('input', { maxlength: 200, value: p.client || '', placeholder: 'مثال: مجمّع الزهراء السكني' }),
      gov: h('select', null, h('option', { value: '' }, 'اختر المحافظة'), GOVS.map(([g]) => h('option', { value: g, selected: p.governorate === g }, g))),
      city: h('input', { maxlength: 80, value: p.city || '', placeholder: 'المدينة أو المنطقة' }),
      brand: h('input', { maxlength: 40, value: p.brand || '', list: 'brand-list', dir: 'auto', placeholder: 'LG، Midea…' }),
      type: h('select', null, Object.entries(PTYPES).map(([k, l]) => h('option', { value: k, selected: (p.project_type || 'residential') === k }, l))),
      label: h('select', null, Object.keys(UNIT_WORDS).map((k) => h('option', { value: k, selected: (p.unit_label || 'فيلا') === k }, k)))
    };
    const dl = h('datalist', { id: 'brand-list' }, BRAND_SUGGEST.map((b) => h('option', { value: b })));
    const grid = h('div', { class: 'form-grid' },
      field('اسم المشروع', el.name, { wide: true }), field('المحافظة', el.gov), field('المدينة', el.city),
      field('الماركة', el.brand), field('نوع المشروع', el.type), field('اسم الوحدة', el.label, { hint: 'كيف تُسمّى وحدات هذا المشروع: فيلا، شقة، طابق…' }), dl);
    const values = () => ({ client: el.name.value.trim(), governorate: el.gov.value || null, city: el.city.value.trim() || null,
      brand: el.brand.value.trim() || null, project_type: el.type.value, unit_label: el.label.value });
    return { el, grid, values };
  }

  function newProject() {
    const pf = projectFields();
    const count = h('input', { type: 'number', min: 0, max: 2000, dir: 'ltr', value: 0 });
    const prefix = h('input', { dir: 'ltr', value: 'V-', maxlength: 10 });
    modal('مشروع جديد', h('div', { class: 'stack sm' }, pf.grid,
      h('div', { class: 'form-grid' },
        field('عدد الوحدات', count, { hint: 'ضع 0 إذا ستستورد ملف Excel للمشروع' }),
        field('بادئة الترقيم', prefix, { hint: 'مثال: V- تعطي V-001، V-002…' }))),
    [{ label: 'إنشاء المشروع', cls: 'primary', run: async () => {
      const v = pf.values();
      const n = Number(count.value);
      if (!v.client) { toast('اكتب اسم المشروع', 'error'); pf.el.name.focus(); return false; }
      if (!(Number.isInteger(n) && n >= 0 && n <= 2000)) { toast('عدد الوحدات من 0 إلى 2000', 'error'); return false; }
      const res = await state.sb.from('projects').insert(v).select().single();
      if (res.error) { fail(res.error); return false; }
      const digits = Math.max(3, String(n).length);
      const rows = Array.from({ length: n }, (_, i) => ({ project_id: res.data.id, code: prefix.value.trim() + String(i + 1).padStart(digits, '0'), position: i + 1 }));
      for (let i = 0; i < rows.length; i += 500) {
        const u = await state.sb.from('units').insert(rows.slice(i, i + 500));
        if (u.error) { fail(u.error); break; }
      }
      state.projects.push(res.data);
      toast('تم إنشاء المشروع');
      go('project/' + res.data.id + '/tracker');
    } }]);
  }

  /* ---------- المستخدمون ---------- */
  views.users = {
    title: 'المستخدمون', allow: isAdmin,
    async render() {
      const { data, error } = await state.sb.from('profiles').select('*').order('created_at');
      if (error) throw error;
      const save = async (u, patch) => {
        const r = await state.sb.from('profiles').update(patch).eq('id', u.id).select().maybeSingle();
        if (r.error || !r.data) { fail(r.error || 'permission denied'); return render(); }
        Object.assign(u, r.data);
        if (u.id === state.user.id) Object.assign(state.profile, r.data);
        toast('تم الحفظ');
      };
      return h('div', { class: 'stack' }, h('h1', null, 'المستخدمون'),
        h('section', { class: 'card note' }, h('p', null, 'إضافة مستخدم: من لوحة Supabase ← Authentication ← Users ← Add user (فعّل Auto Confirm User). يظهر هنا بدور "فني"، فغيّر دوره من الجدول.')),
        h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الدور'), h('th', null, 'مفعّل'), h('th', null, 'أُضيف'))),
          h('tbody', null, data.map((u) => {
            const me = u.id === state.user.id;
            return h('tr', null,
              h('td', null, h('input', { value: u.full_name, maxlength: 120, 'aria-label': 'الاسم', onChange: (e) => save(u, { full_name: e.target.value.trim() }) })),
              h('td', null, h('select', { disabled: me, 'aria-label': 'الدور', onChange: (e) => save(u, { role: e.target.value }) },
                Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: u.role === v }, l)))),
              h('td', null, h('input', { type: 'checkbox', checked: u.active, disabled: me, 'aria-label': 'مفعّل', onChange: (e) => save(u, { active: e.target.checked }) })),
              h('td', { dir: 'ltr' }, date(u.created_at)));
          }))))),
        h('section', { class: 'card' }, h('h2', null, 'الصلاحيات'), h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'مدير'), h('th', null, 'مشرف'), h('th', null, 'فني'))),
          h('tbody', null, [
            ['عرض كل الأوراق', 1, 1, 1],
            ['تسجيل القراءات في Test Records', 1, 1, 1],
            ['تغيير النتائج في Villa Tracker', 1, 1, 0],
            ['NCR Register، والفلل، والحدود الصفراء، واستيراد/تصدير Excel', 1, 1, 0],
            ['حذف المشاريع والفلل، والمستخدمون، وسجل العمليات', 1, 0, 0]
          ].map(([a, ...c]) => h('tr', null, h('td', null, a), c.map((x) => h('td', { class: x ? 'yes' : 'no' }, x ? '✓' : '—')))))))));
    }
  };

  /* ---------- سجل العمليات ---------- */
  views.audit = {
    title: 'سجل العمليات', allow: isAdmin,
    async render() {
      const [log, users] = await Promise.all([
        state.sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300),
        state.sb.from('profiles').select('id, full_name')]);
      if (log.error) throw log.error;
      const names = Object.fromEntries((users.data || []).map((u) => [u.id, u.full_name]));
      const codes = {};
      Object.values(state.data).forEach((d) => d.units.forEach((u) => { codes[u.id] = u.code; }));
      const cp = Object.fromEntries(state.checkpoints.map((c) => [c.key, c.name_en]));
      const describe = (e) => {
        const d = e.new_data || e.old_data || {};
        const out = [];
        if (d.code) out.push(d.code); else if (d.unit_id) out.push(codes[d.unit_id] || '');
        if (d.checkpoint) out.push(cp[d.checkpoint]);
        if (e.table_name === 'unit_checks' && e.old_data && e.new_data) out.push(`${RES[e.old_data.result]} ← ${RES[e.new_data.result]}`);
        if (e.table_name === 'ncrs') out.push(d.ncr_no, d.status === 'open' ? 'Open' : 'Closed');
        if (e.table_name === 'projects') out.push(d.client);
        if (e.table_name === 'profiles') out.push(d.full_name, ROLES[d.role]);
        return out.filter(Boolean).join(' · ');
      };
      return h('div', { class: 'stack' }, h('h1', null, 'سجل العمليات'),
        h('section', { class: 'card' }, h('p', { class: 'muted' }, 'آخر 300 عملية: من غيّر ماذا ومتى. يُكتب على الخادم ولا يمكن تعديله.'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
            h('thead', null, h('tr', null, h('th', null, 'الوقت'), h('th', null, 'المستخدم'), h('th', null, 'العملية'), h('th', null, 'الورقة'), h('th', null, 'التفاصيل'))),
            h('tbody', null, log.data.map((e) => h('tr', null, h('td', { dir: 'ltr' }, dateTime(e.at)), h('td', null, e.actor ? names[e.actor] || '—' : 'النظام'),
              h('td', null, ACTIONS[e.action]), h('td', null, TABLES[e.table_name] || e.table_name), h('td', null, describe(e)))))))));
    }
  };

  /* ---------- نسخة احتياطية ---------- */
  views.backup = {
    title: 'نسخة احتياطية', allow: isStaff,
    render() {
      const run = async (btn) => {
        btn.disabled = true;
        try {
          const all = (t) => fetchAll((a, b) => state.sb.from(t).select('*').range(a, b));
          const [units, checks, tests, ncrs] = await Promise.all([all('units'), all('unit_checks'), all('test_records'), all('ncrs')]);
          download(new Blob([JSON.stringify({ app: 'surour-vrf-qc', version: 4, exported_at: new Date().toISOString(),
            projects: state.projects, units, unit_checks: checks, test_records: tests, ncrs }, null, 1)], { type: 'application/json' }),
          `surour-backup-${new Date().toISOString().slice(0, 10)}.json`);
          toast('تم التنزيل');
        } catch (e) { fail(e); }
        btn.disabled = false;
      };
      return h('div', { class: 'stack' }, h('h1', null, 'نسخة احتياطية'),
        h('section', { class: 'card' }, h('p', null, 'تنزيل كل البيانات في ملف JSON. لتنزيل مشروع كملف Excel افتح المشروع واضغط "تصدير Excel".'),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onClick: (e) => run(e.currentTarget) }, 'تنزيل'))));
    }
  };

  window.App = { state, views, render, go, fail, errText, field, empty, modal, download, fetchAll,
    loadProject, loadBase, isAdmin, isStaff, unitWords, projectFields, GOVS, PTYPES, F, RES, RES_AR, STATUS_AR, openNcrsOf, pctText };

  applyTheme();
  document.addEventListener('DOMContentLoaded', () => boot().catch(fail));
})();
