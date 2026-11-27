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
  const PTYPES = { compound: 'مجمّع سكني', houses: 'فلل وبيوت', apartments: 'شقق وعمارات', commercial: 'مبنى تجاري', government: 'مبنى حكومي', other: 'أخرى' };
  const isCompound = (p) => p?.project_type === 'compound';
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
    test_records: 'Test Records', ncrs: 'NCR Register', materials: 'المواد', project_stages: 'مراحل العمل', crews: 'الفرق' };
  const ACTIONS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };

  const state = {
    sb: null, user: null, profile: null,
    projects: [], checkpoints: [], crews: [],
    stages: {},       // لكل مشروع: { checkpoint: صف المرحلة }
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
    const [projects, cps, stages, crews] = await Promise.all([
      state.sb.from('projects').select('*').order('created_at'),
      state.sb.from('qc_checkpoints').select('*').order('position'),
      fetchAll((a, b) => state.sb.from('project_stages').select('*').range(a, b)),
      state.sb.from('crews').select('*').order('name')]);
    if (projects.error) throw projects.error;
    if (cps.error) throw cps.error;
    state.projects = projects.data;
    state.checkpoints = cps.data;
    if (crews.error) throw crews.error;
    state.crews = crews.data;
    state.stages = {};
    stages.forEach((x) => { (state.stages[x.project_id] ||= {})[x.checkpoint] = x; });
  }

  /* ---------- مراحل العمل على مستوى المشروع ---------- */
  const STAGE_AR = { not_started: 'لم تبدأ', in_progress: 'جارية', done: 'مكتملة', na: 'لا تنطبق' };
  const stageOf = (p, key) => state.stages[p.id]?.[key] || { project_id: p.id, checkpoint: key, status: 'not_started' };
  // التقدّم: المكتملة ÷ (13 − لا تنطبق)، والمرحلة الحالية = أول مرحلة غير مكتملة
  function stageProgress(p) {
    const list = state.checkpoints.map((c) => ({ c, s: stageOf(p, c.key) }));
    const active = list.filter((x) => x.s.status !== 'na');
    const done = active.filter((x) => x.s.status === 'done').length;
    const cur = active.find((x) => x.s.status === 'in_progress') || active.find((x) => x.s.status !== 'done') || null;
    const status = active.length && done === active.length ? 'done' : list.some((x) => x.s.status === 'in_progress' || x.s.status === 'done') ? 'in_progress' : 'not_started';
    const last = list.map((x) => x.s.updated_at).filter(Boolean).sort().pop() || null;
    return { list, done, total: active.length, pct: active.length ? done / active.length : 0, cur, status, last };
  }

  /* ---------- المواعيد ----------
     متأخر: فات تاريخ التسليم والمشروع لم يكتمل.
     متأخر عن الجدول: الإنجاز أقل من نسبة الوقت المنقضي (من البدء إلى التسليم) بـ15 نقطة أو أكثر. */
  const BEHIND_GAP = 0.15;
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
  function schedule(p, pct, status) {
    const t = todayStr();
    if (!p.due_date) return { has: false };
    const daysLeft = dayDiff(p.due_date, t);
    const late = status !== 'done' && daysLeft < 0;
    let expected = null;
    if (p.start_date && p.due_date > p.start_date) expected = Math.min(1, Math.max(0, dayDiff(t, p.start_date) / dayDiff(p.due_date, p.start_date)));
    const behind = !late && status !== 'done' && expected !== null && expected - pct >= BEHIND_GAP;
    return { has: true, due: p.due_date, daysLeft, late, expected, behind };
  }
  const daysAr = (n) => (n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${num(n)} أيام` : `${num(n)} يوماً`);
  function dueText(sc, status) {
    if (!sc.has) return '';
    if (status === 'done') return `التسليم ${sc.due}`;
    if (sc.late) return `متأخر ${daysAr(-sc.daysLeft)}`;
    if (sc.daysLeft === 0) return 'التسليم اليوم';
    return `التسليم بعد ${daysAr(sc.daysLeft)}`;
  }
  const crewOf = (id) => state.crews.find((c) => c.id === id) || null;

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

    // حركة الدخول فقط عند تغيّر الصفحة، لا عند إعادة الرسم بعد حفظ أو تصفية
    const entering = location.hash !== state._lastHash;
    state._lastHash = location.hash;
    const main = h('main', { class: 'main' });
    root.appendChild(h('div', { class: 'app app-side' }, ...topbar(r).filter(Boolean), main));
    const done = (n) => { clear(main).appendChild(n); if (entering) { main.classList.add('enter'); countUp(main); } };
    const out = v.render(r);
    if (out instanceof Promise) {
      main.appendChild(h('div', { class: 'loading' }, 'جارٍ التحميل…'));
      out.then(done, (e) => { fail(e); clear(main).appendChild(empty('تعذّر التحميل')); });
    } else done(out);
  }

  // الأرقام الكبيرة تعدّ من الصفر إلى قيمتها (نصف ثانية) عند فتح الصفحة
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(scope) {
    if (reducedMotion()) return;
    scope.querySelectorAll('.d2-stats dd, .d2-pct strong, .ph-pct strong, .perf dd').forEach((el) => {
      const text = el.textContent;
      const m = text.match(/^([0-9][0-9,]*)(\.([0-9]+))?(%?)$/);
      if (!m) return;
      const target = Number(m[1].replace(/,/g, '') + (m[2] || ''));
      if (!target) return;
      const dec = m[3] ? m[3].length : 0;
      const fmt = (x) => (dec ? x.toFixed(dec) : num(Math.round(x))) + m[4];
      const box = el.closest('dl, div') || el;
      box.setAttribute('aria-busy', 'true');           // لا يُقرأ الرقم أثناء العدّ
      const t0 = performance.now(), D = 500;
      const tick = (t) => {
        if (!el.isConnected) return;
        const k = Math.min(1, (t - t0) / D), e = 1 - Math.pow(1 - k, 3);
        el.textContent = k < 1 ? fmt(target * e) : text;
        if (k < 1) requestAnimationFrame(tick); else box.removeAttribute('aria-busy');
      };
      el.textContent = fmt(0);
      requestAnimationFrame(tick);
    });
  }

  // القائمة الجانبية (يمين الشاشة) على الكمبيوتر، وشريط سفلي على الهاتف
  const ICONS = {
    home: ['M3 3h7v9H3z', 'M14 3h7v5h-7z', 'M14 12h7v9h-7z', 'M3 16h7v5H3z'],
    projects: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
    compounds: ['M4 21V8l6-4v17', 'M10 21V11l10 3v7', 'M3 21h18', 'M14 17h2'],
    crews: ['M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M2 20c0-4 2.5-7 6-7s6 3 6 7', 'M14 13.5c.6-.3 1.3-.5 2-.5 3.5 0 6 3 6 7'],
    users: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21c0-4 3-6 7-6s7 2 7 6', 'M17 4a3.5 3.5 0 0 1 0 7', 'M19 15c2 .6 3 2.5 3 6'],
    audit: ['M4 4h16v16H4z', 'M8 9h8', 'M8 13h8', 'M8 17h5'],
    backup: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 19h16'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01']
  };
  function icon(k) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
    (ICONS[k] || []).forEach((d) => { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.appendChild(path); });
    return svg;
  }
  function topbar(r) {
    const p = r.name === 'project' ? state.projects.find((x) => x.id === r.id) : null;
    const navOn = p && isCompound(p) ? 'compounds' : p ? 'projects' : r.name;
    const menu = [
      ['home', 'لوحة التحكم', true],
      ['projects', 'المشاريع', true],
      ['crews', 'الفرق والمقاولون', true],
      ['compounds', 'المجمّعات السكنية', true],
      ['users', 'المستخدمون', isAdmin()],
      ['audit', 'سجل العمليات', isAdmin()],
      ['backup', 'نسخة احتياطية', isStaff()]
    ].filter((x) => x[2]);
    const stay = (k) => (k === 'home' ? () => { state._stayHome = true; } : null);
    const SHORT = { home: 'اللوحة', crews: 'الفرق', compounds: 'المجمّعات' };
    const link = ([k, l]) => h('a', { href: '#/' + k, class: navOn === k ? 'on' : '', 'aria-current': navOn === k ? 'page' : null, onClick: stay(k), 'aria-label': l }, icon(k),
      h('span', { class: 'nl-full' }, l), SHORT[k] ? h('span', { class: 'nl-short', 'aria-hidden': 'true' }, SHORT[k]) : null);
    const me = h('div', { class: 'side-me' },
      h('span', { class: 'who' }, h('b', null, state.profile.full_name || state.user.email), h('small', null, ROLES[role()])),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', type: 'button', onClick: toggleTheme, 'aria-label': 'تبديل المظهر' }, 'المظهر'),
        h('button', { class: 'btn ghost sm', type: 'button', onClick: signOut }, 'خروج')));
    // الهاتف: المشاريع والمجمّعات والفرق، والباقي مع الخروج تحت "المزيد"
    const rest = menu.slice(3);
    const more = h('details', { class: 'mb-more' },
      h('summary', { class: rest.some(([k]) => k === navOn) ? 'on' : '' }, icon('more'), h('span', null, 'المزيد')),
      h('div', { class: 'mb-sheet' }, rest.map(link), me.cloneNode(true)));
    // cloneNode لا ينسخ الأحداث: نعيد ربط أزرار المظهر والخروج في نسخة الهاتف
    const btns = more.querySelectorAll('.side-me button');
    btns[0].onclick = toggleTheme; btns[1].onclick = signOut;
    return [
      h('aside', { class: 'side', 'aria-label': 'القائمة الرئيسية' },
        h('a', { href: '#/home', class: 'side-logo', onClick: stay('home') }, logo(), h('span', null, 'متابعة المشاريع')),
        h('nav', { class: 'side-nav' }, menu.map(link)),
        p ? h('div', { class: 'side-proj' }, h('small', null, 'المشروع المفتوح'), h('a', { href: '#/project/' + p.id }, p.client)) : null,
        me),
      h('header', { class: 'mtop' }, h('a', { href: '#/home', onClick: stay('home') }, logo()), p ? h('span', { class: 'mtop-crumb' }, p.client) : null),
      // في صفحات المجمّع يظهر شريط المجمّع السفلي بدل هذا
      p && isCompound(p) ? null : h('nav', { class: 'mbar', 'aria-label': 'التنقل' }, menu.slice(0, 3).map(link), more)
    ];
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
          h('p', null, 'إدارة مشاريع تركيب منظومات التبريد في سرور، ومتابعة كل مشروع مرحلة مرحلة.'))),
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
  views.home = { title: 'مشاريع سرور', render: () => home() };
  views.compounds = { title: 'المجمّعات السكنية', render: () => portfolio('compounds') };

  /* ---------- الرئيسية: كل مشاريع الشركة، كل مشروع سطر واحد بنسبة إنجازه ---------- */
  const DAY = 86400000;
  const daysSince = (x) => (x ? Math.floor((Date.now() - new Date(x).getTime()) / DAY) : null);
  const STALL_DAYS = 14;
  const cntAr = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${num(n)} ${few}` : `${num(n)} ${many}`);

  // ملخّص مشروع واحد: المجمّع من فحوصات وحداته، وغيره من مراحله
  function projInfo(p) {
    if (isCompound(p)) {
      const d = state.data[p.id];
      const D = F.dashboard(d, state.checkpoints);
      const rows = d.units.map((u) => F.row(u, state.checkpoints, openNcrsOf(d, u.id)));
      const today = new Date().toISOString().slice(0, 10);
      const fails = rows.filter((k) => k.R).length;
      const late = d.ncrs.filter((n) => n.status === 'open' && n.due_date && n.due_date < today).length;
      const status = D.B3 && D.B4 === D.B3 ? 'done' : D.B6 === D.B3 ? 'not_started' : 'in_progress';
      const why = [fails ? `${num(fails)} وحدة فيها فشل` : '', D.B8 ? `${num(D.B8)} تنبيه تسلسل` : '', D.B9 ? `${num(D.B9)} NCR مفتوحة` : '', late ? `${num(late)} متأخرة` : ''].filter(Boolean);
      const sc = schedule(p, D.B10, status);
      if (sc.late) why.unshift(`متأخر ${daysAr(-sc.daysLeft)} عن التسليم`); else if (sc.behind) why.unshift('متأخر عن الجدول');
      return { p, pct: D.B10, status, why, flag: why[0] || '', bad: !!(fails || D.B9 || sc.late), compound: true, sc, due: dueText(sc, status),
        now: `${num(D.B3)} ${unitWords(p).one}، مكتملة ${num(D.B4)}، جارية ${num(D.B5)}`, curKey: null };
    }
    const sp = stageProgress(p);
    const idle = sp.status === 'in_progress' ? daysSince(sp.last) : null;
    const sc = schedule(p, sp.pct, sp.status);
    const why = [sc.late ? `متأخر ${daysAr(-sc.daysLeft)} عن التسليم` : '', sc.behind ? `متأخر عن الجدول (الإنجاز ${pctText(sp.pct)} والمتوقع ${pctText(sc.expected)})` : '',
      idle !== null && idle >= STALL_DAYS ? `لم يتحرك منذ ${daysAr(idle)}` : ''].filter(Boolean);
    const now = sp.status === 'done' ? 'اكتملت كل المراحل' : sp.cur
      ? `${sp.cur.s.status === 'in_progress' ? 'الآن' : 'التالية'}: ${sp.cur.c.name_ar} (${num(sp.cur.c.position)} من ${num(state.checkpoints.length)})` : '—';
    const flag = sc.late ? `متأخر ${daysAr(-sc.daysLeft)}` : sc.behind ? 'متأخر عن الجدول' : why.length ? 'متوقف' : '';
    return { p, pct: sp.pct, status: sp.status, why, flag, bad: sc.late, compound: false, now, curKey: sp.status === 'done' ? null : sp.cur?.c.key, sp, sc, due: dueText(sc, sp.status) };
  }

  async function home() {
    await Promise.all(state.projects.filter(isCompound).map((p) => loadProject(p.id)));
    const f = { gov: '', brand: '', st: '' };   // اللوحة لا تصفّي نفسها: الضغط يفتح صفحة المشاريع مصفّاة
    const openList = (patch) => { state._pf = { ...PF_DEFAULT, ...patch }; go('projects'); };
    const rows = state.projects.map(projInfo);
    const by = (st) => rows.filter((r) => r.status === st).length;
    const attn = rows.filter((r) => r.why.length).sort((a, b) => (b.bad - a.bad) || (b.why.length - a.why.length));
    const avg = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0;
    const govs = new Set(rows.map((r) => r.p.governorate).filter(Boolean)).size;
    const STL = { not_started: 'لم يبدأ', in_progress: 'جارٍ', done: 'مكتمل', late: 'متأخر' };
    const isLate = (r) => !!(r.sc && (r.sc.late || r.sc.behind));
    const lateN = rows.filter(isLate).length;

    // المواعيد القادمة: المشاريع غير المكتملة بتاريخ تسليم، الأقرب أولاً
    const dues = rows.filter((r) => r.sc?.has && r.status !== 'done').sort((a, b) => a.sc.daysLeft - b.sc.daysLeft);
    const duesBox = h('section', { class: 'd2-dues' }, h('h2', null, 'المواعيد القادمة'),
      dues.length ? h('ol', { class: 'due-list' }, dues.slice(0, 8).map((r) => h('li', { class: r.sc.late ? 'late' : r.sc.behind ? 'behind' : '' },
        h('a', { href: '#/project/' + r.p.id }, h('b', null, r.p.client), h('small', null, `التسليم ${r.sc.due}`)),
        h('span', { class: 'due-when' }, r.due),
        h('span', { class: 'due-bar', title: r.sc.expected !== null ? `الإنجاز ${pctText(r.pct)}، المتوقع حسب الوقت ${pctText(r.sc.expected)}` : `الإنجاز ${pctText(r.pct)}` },
          h('span', { class: 'db-fill', style: { width: (r.pct * 100).toFixed(1) + '%' } }),
          r.sc.expected !== null ? h('i', { class: 'db-exp', style: { 'inset-inline-start': (r.sc.expected * 100).toFixed(1) + '%' } }) : null))))
        : h('p', { class: 'calm muted' }, 'لا توجد مشاريع بتاريخ تسليم. أضف التاريخ من "بيانات المشروع".'),
      dues.some((r) => r.sc.expected !== null) ? h('p', { class: 'd2-note' }, 'الشريط = الإنجاز، والخط العمودي = المتوقع حسب الوقت المنقضي.') : null);

    // الفرق: أين تعمل كل فرقة الآن (المراحل الجارية المسندة لها)
    const working = [];
    state.projects.forEach((p) => Object.values(state.stages[p.id] || {}).forEach((x) => { if (x.status === 'in_progress') working.push({ p, x }); }));
    const cpN = Object.fromEntries(state.checkpoints.map((c) => [c.key, c.name_ar]));
    const crews = state.crews.filter((c) => c.active);
    const people = working.reduce((a, w) => a + (w.x.crew || 0), 0);
    const busy = crews.filter((c) => working.some((w) => w.x.crew_id === c.id));
    const crewsBox = h('section', { class: 'd2-crews' }, h('div', { class: 'd2-plan-head' }, h('h2', null, 'الفرق والمقاولون'),
      h('a', { href: '#/crews', class: 'link small' }, 'الأداء والتفاصيل')),
      crews.length ? [h('p', { class: 'd2-note' }, `${num(busy.length)} يعمل الآن، ${num(crews.length - busy.length)} متاح` + (people ? `. ${num(people)} كادر في المراحل الجارية` : '')),
        h('ul', { class: 'crew-list' }, [...busy, ...crews.filter((c) => !busy.includes(c))].map((c) => {
          const at = working.filter((w) => w.x.crew_id === c.id);
          return h('li', { class: at.length ? 'busy' : 'free' },
            h('span', { class: 'cr-name' }, h('b', null, c.name), h('small', null, KIND_AR[c.kind] + (c.leader ? ' · ' + c.leader : ''))),
            h('span', { class: 'cr-where' }, at.length ? at.map((w) => h('a', { href: '#/project/' + w.p.id }, `${w.p.client} · ${cpN[w.x.checkpoint]}`)) : 'متاحة'),
            c.phone ? h('a', { class: 'cr-tel', href: 'tel:' + c.phone, dir: 'ltr' }, c.phone) : null);
        }))]
        : h('p', { class: 'calm muted' }, isStaff() ? 'لا توجد فرق أو مقاولون بعد. أضفهم من صفحة "الفرق والمقاولون".' : 'لا توجد فرق أو مقاولون بعد.'));

    const lead = !rows.length ? 'لا توجد مشاريع بعد. أنشئ أول مشروع لتبدأ المتابعة.'
      : cntAr(rows.length, 'مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً') + (govs ? ` في ${cntAr(govs, 'محافظة واحدة', 'محافظتين', 'محافظات', 'محافظة')}` : '')
        + `: ${num(by('in_progress'))} جارٍ و${num(by('done'))} مكتمل` + (rows.some(isLate) ? `، منها ${num(rows.filter(isLate).length)} ${rows.filter(isLate).length === 1 ? 'متأخر عن موعده' : 'متأخرة عن موعدها'}. ` : '. ')
        + (attn.length ? (attn.length === 1 ? 'مشروع واحد يحتاج انتباهك.' : `${num(attn.length)} مشاريع تحتاج انتباهك.`) : 'لا شيء يحتاج انتباهك الآن.');

    // خريطة المحافظات: متوسط إنجاز مشاريع كل محافظة
    const band = (v, has) => (!has ? 'none' : v >= 1 ? 'done' : v === 0 ? 'b0' : v < 0.25 ? 'b1' : v < 0.5 ? 'b2' : v < 0.75 ? 'b3' : 'b4');
    const govMap = h('div', { class: 'gov-map', role: 'list', 'aria-label': 'المشاريع حسب المحافظة' }, GOVS.map(([g, c, r]) => {
      const rs = rows.filter((x) => x.p.governorate === g);
      const gp = rs.length ? rs.reduce((a, x) => a + x.pct, 0) / rs.length : 0;
      const prob = rs.some((x) => x.bad) ? ' flag-fail' : rs.some((x) => x.why.length) ? ' flag-alert' : '';
      const label = `${g}: ${rs.length ? `${rs.length} مشروع، إنجاز ${pctText(gp)}` : 'لا مشاريع'}`;
      const el = h('button', { type: 'button', role: 'listitem', class: `gov tile ${band(gp, rs.length)}${prob}${f.gov === g ? ' sel' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(f.gov === g),
        onClick: () => openList({ gov: g }) }, h('span', { class: 'g-name' }, g), rs.length ? h('b', null, String(rs.length)) : null);
      el.style.gridColumn = String(c); el.style.gridRow = String(r);
      return el;
    }));
    const noGov = rows.filter((r) => !r.p.governorate).length;

    // أين تقف المشاريع: عدد المشاريع الواقفة عند كل مرحلة
    const stageRows = rows.filter((r) => !r.compound);
    const pipe = h('ol', { class: 'pipe' }, state.checkpoints.map((c) => {
      const here = stageRows.filter((r) => r.curKey === c.key);
      return h('li', { class: here.length ? 'has' : '' }, h('span', { class: 'pp-n' }, num(c.position)), h('span', { class: 'pp-name' }, c.name_ar),
        h('b', { class: 'pp-c' }, here.length ? num(here.length) : '·'),
        here.length ? h('small', null, here.slice(0, 3).map((x) => x.p.client).join('، ') + (here.length > 3 ? '…' : '')) : null);
    }));

    // حسب الماركة
    const brands = [...new Set(rows.map((r) => r.p.brand || 'غير محددة'))].sort();
    const byBrand = brands.map((b) => {
      const rs = rows.filter((r) => (r.p.brand || 'غير محددة') === b);
      return { b, n: rs.length, pct: rs.reduce((a, x) => a + x.pct, 0) / rs.length };
    });

    // نشاط اليوم: مراحل تحرّكت اليوم
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const moved = [];
    state.projects.forEach((p) => Object.values(state.stages[p.id] || {}).forEach((x) => { if (x.updated_at && new Date(x.updated_at) >= t0 && x.status !== 'not_started') moved.push({ p, x }); }));
    moved.sort((a, b) => (a.x.updated_at < b.x.updated_at ? 1 : -1));
    const cpName = Object.fromEntries(state.checkpoints.map((c) => [c.key, c.name_ar]));
    const verb = { in_progress: 'بدأت', done: 'اكتملت', not_started: 'أُعيدت إلى "لم تبدأ"', na: 'لا تنطبق' };

    const list = rows.filter((r) => (!f.gov || r.p.governorate === f.gov) && (!f.brand || (r.p.brand || 'غير محددة') === f.brand) && (!f.st || (f.st === 'late' ? isLate(r) : r.status === f.st)))
      .sort((a, b) => ({ in_progress: 0, not_started: 1, done: 2 }[a.status] - { in_progress: 0, not_started: 1, done: 2 }[b.status]) || (b.why.length - a.why.length));
    const projRow = (r) => h('li', null, h('a', { href: '#/project/' + r.p.id, class: 'proj' },
      h('span', { class: 'pj-main' }, h('b', null, r.p.client),
        h('small', null, [r.compound ? PTYPES.compound : PTYPES[r.p.project_type], r.p.governorate, r.p.city, r.p.brand].filter(Boolean).join('، '))),
      h('span', { class: 'pj-now' + (r.status === 'done' ? ' ok' : '') }, r.now, r.due ? h('small', { class: 'pj-due' + (r.sc?.late ? ' late' : '') }, r.due) : null),
      h('span', { class: 'pj-prog' }, h('span', { class: 'st-bar' }, h('span', { style: { width: (r.pct * 100).toFixed(1) + '%' } })), h('b', null, pctText(r.pct))),
      h('span', { class: 'pj-flags' }, r.flag ? h('span', { class: 'chip ' + (r.bad ? 'st-has-failure' : 'warn-chip'), title: r.why.join('، ') }, r.flag) : null)));

    const stat = (l, v, c, st) => h('div', { class: 'st ' + c + (st && f.st === st ? ' sel' : '') },
      st ? h('button', { type: 'button', class: 'st-btn', title: 'عرض هذه المشاريع', onClick: () => openList({ st }) }, h('dd', null, num(v)), h('dt', null, l))
        : [h('dd', null, num(v)), h('dt', null, l)]);

    return h('div', { class: 'dash2 home' },
      h('header', { class: 'd2-head' },
        h('p', { class: 'd2-lead' }, lead),
        h('div', { class: 'd2-pct' }, h('strong', null, pctText(avg)), h('span', null, 'متوسط إنجاز المشاريع'))),
      h('dl', { class: 'd2-stats' },
        stat('المشاريع', rows.length, '', ''), stat('جارية', by('in_progress'), '', 'in_progress'), stat('مكتملة', by('done'), 'ok', 'done'),
        stat('لم تبدأ', by('not_started'), 'muted', 'not_started'), stat('متأخرة', lateN, lateN ? 'bad' : 'muted', 'late'), stat('تحتاج انتباهك', attn.length, attn.length ? 'warn' : 'muted')),
      h('section', { class: 'd2-pipe' }, h('div', { class: 'd2-plan-head' }, h('h2', null, 'أين تقف المشاريع'),
        h('span', { class: 'd2-note' }, 'عدد المشاريع عند كل مرحلة' + (rows.some((r) => r.compound) ? '. المجمّعات تُتابَع وحدةً وحدة في قسمها' : ''))), pipe),
      h('div', { class: 'd2-two' }, duesBox, crewsBox),
      h('div', { class: 'd2-grid' },
        h('section', { class: 'd2-plan' },
          h('div', { class: 'd2-plan-head' }, h('h2', null, 'المشاريع حسب المحافظة'),
            h('span', { class: 'd2-note' }, 'اضغط محافظة لعرض مشاريعها' + (noGov ? `. ${num(noGov)} بلا محافظة محددة` : ''))),
          govMap),
        h('aside', { class: 'd2-side' },
          h('section', { class: 'd2-attn' + (attn.length ? ' has' : '') }, h('h2', null, 'مشاريع تحتاج انتباهك'),
            attn.length ? h('ul', null, attn.slice(0, 12).map((r) => h('li', null, h('a', { href: '#/project/' + r.p.id },
              h('b', null, r.p.client), h('span', { class: 'why' + (r.bad ? '' : ' alert') }, r.why.join('، ')), h('span', { class: 'nx' }, r.p.governorate || '')))))
              : h('p', { class: 'calm' }, 'لا مشاكل مفتوحة ولا مشاريع متوقفة.')),
          h('section', { class: 'd2-brands' }, h('h2', null, 'حسب الماركة'),
            byBrand.length ? h('ul', { class: 'brand-list' }, byBrand.map((x) => h('li', null,
              h('button', { type: 'button', onClick: () => openList({ brand: x.b }) },
                h('b', { dir: 'auto' }, x.b), h('small', null, `${num(x.n)} مشروع`),
                h('span', { class: 'st-bar' }, h('span', { style: { width: (x.pct * 100).toFixed(1) + '%' } })), h('span', { class: 'bp' }, pctText(x.pct))))))
              : h('p', { class: 'calm' }, '—')))),
      h('section', { class: 'd2-golist' },
        h('a', { href: '#/projects', class: 'golist', onClick: () => { state._pf = { ...PF_DEFAULT }; } },
          h('span', null, h('b', null, `كل المشاريع (${num(rows.length)})`), h('small', null, 'بحث وترتيب وتصفية حسب الحالة والمحافظة والماركة والمنفّذ')),
          h('span', { class: 'gl-go', 'aria-hidden': 'true' }, '←')),
        isStaff() ? h('button', { type: 'button', class: 'btn primary', onClick: newProject }, '+ مشروع جديد') : null),
      h('section', { class: 'd2-today' }, h('h2', null, 'نشاط اليوم'),
        moved.length ? h('ol', { class: 'today-list' }, moved.slice(0, 15).map(({ p, x }) => h('li', { class: x.status === 'done' ? 'act-done' : '' },
          h('time', { dir: 'ltr' }, new Date(x.updated_at).toTimeString().slice(0, 5)),
          h('a', { href: '#/project/' + p.id }, h('b', null, p.client)),
          h('span', null, `${verb[x.status]} مرحلة ${cpName[x.checkpoint]}`),
          h('small', null, x.crew ? `${num(x.crew)} كادر` : ''))))
          : h('p', { class: 'calm muted' }, 'لم تتحرّك أي مرحلة اليوم بعد.'),
        rows.some((r) => r.compound) ? h('div', null, h('h3', { class: 'd2-sub' }, 'فحوصات المجمّعات اليوم'), todayActivity(state.projects.filter(isCompound).map((p) => p.id))) : null));
  }

  /* ---------- صفحة المشاريع: جدول ببحث وترتيب وتصفية ---------- */
  const PF_DEFAULT = { q: '', st: '', gov: '', brand: '', type: '', crew: '', sort: 'status', dir: 1 };
  // توحيد الحروف للبحث: أ إ آ ← ا، ة ← ه، ى ← ي، وحذف التشكيل والتطويل
  const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();
  const digits = (t) => String(t || '').replace(/[^0-9]/g, '');

  views.projects = {
    title: 'المشاريع',
    async render() {
      await Promise.all(state.projects.filter(isCompound).map((p) => loadProject(p.id)));
      const F0 = state._pf || (state._pf = { ...PF_DEFAULT });
      const cpN = Object.fromEntries(state.checkpoints.map((c) => [c.key, c]));
      const rows = state.projects.map((p) => {
        const r = projInfo(p);
        const cur = r.sp?.cur && r.status !== 'done' ? r.sp.cur : null;
        const crew = cur?.s.crew_id ? crewOf(cur.s.crew_id) : null;
        const crews = [...new Set(Object.values(state.stages[p.id] || {}).map((x) => x.crew_id).filter(Boolean))];
        r.crew = crew; r.crews = crews; r.late = !!(r.sc && (r.sc.late || r.sc.behind));
        r.stagePos = r.status === 'done' ? 99 : cur ? cpN[cur.c.key].position : r.compound ? 50 : 0;
        r.hay = norm([p.client, p.customer_name, p.governorate, p.city, p.site_address, p.brand, PTYPES[p.project_type], crew?.name, crew?.leader,
          ...crews.map((id) => crewOf(id)?.name), cur?.c.name_ar].filter(Boolean).join(' '));
        r.phone = digits(p.customer_phone);
        return r;
      });
      const brands = [...new Set(rows.map((r) => r.p.brand).filter(Boolean))].sort();
      const RANK = { in_progress: 0, not_started: 1, done: 2 };
      const SORTS = {
        status: (a, b) => (b.late - a.late) || (RANK[a.status] - RANK[b.status]) || (b.why.length - a.why.length) || a.p.client.localeCompare(b.p.client, 'ar'),
        name: (a, b) => a.p.client.localeCompare(b.p.client, 'ar'),
        customer: (a, b) => (a.p.customer_name || '￿').localeCompare(b.p.customer_name || '￿', 'ar'),
        gov: (a, b) => (a.p.governorate || '￿').localeCompare(b.p.governorate || '￿', 'ar'),
        stage: (a, b) => a.stagePos - b.stagePos,
        crew: (a, b) => (a.crew?.name || '￿').localeCompare(b.crew?.name || '￿', 'ar'),
        pct: (a, b) => a.pct - b.pct,
        due: (a, b) => (a.p.due_date || '9999').localeCompare(b.p.due_date || '9999')
      };

      const count = h('p', { class: 'pl-count', role: 'status', 'aria-live': 'polite' });
      const tbody = h('tbody');
      const head = h('tr');
      const COLS = [['name', 'المشروع'], ['customer', 'العميل'], ['gov', 'المحافظة'], ['stage', 'المرحلة الحالية'], ['crew', 'المنفّذ'], ['pct', 'الإنجاز'], ['due', 'التسليم']];
      const drawHead = () => {
        clear(head).append(...COLS.map(([k, l]) => {
          const on = F0.sort === k;
          return h('th', { scope: 'col', 'aria-sort': on ? (F0.dir > 0 ? 'ascending' : 'descending') : 'none' },
            h('button', { type: 'button', class: 'th-sort' + (on ? ' on' : ''), onClick: () => { F0.dir = on ? -F0.dir : 1; F0.sort = k; draw(); } },
              l, h('span', { class: 'th-ar', 'aria-hidden': 'true' }, on ? (F0.dir > 0 ? '▲' : '▼') : '↕')));
        }));
      };
      const hit = (r) => {
        if (F0.st && (F0.st === 'late' ? !r.late : r.status !== F0.st)) return false;
        if (F0.gov && (F0.gov === '-' ? r.p.governorate : r.p.governorate !== F0.gov)) return false;
        if (F0.brand && (r.p.brand || 'غير محددة') !== F0.brand) return false;
        if (F0.type && (r.compound ? 'compound' : r.p.project_type) !== F0.type) return false;
        if (F0.crew && !r.crews.includes(F0.crew)) return false;
        if (F0.q) {
          const words = norm(F0.q).split(' ').filter(Boolean);
          const dq = digits(F0.q);
          const phoneHit = dq.length >= 4 && r.phone.includes(dq);
          if (!phoneHit && !words.every((w) => r.hay.includes(w))) return false;
        }
        return true;
      };
      const mark = (text) => {   // إبراز كلمات البحث في اسم المشروع
        const words = norm(F0.q).split(' ').filter((w) => w.length > 1);
        if (!words.length || !text) return text || '';
        const n = norm(text);
        // لا نبرز إلا إذا طابق الطول بعد التوحيد (لا تغيّر في عدد الحروف)
        if (n.length !== text.length) return text;
        const marks = [];
        words.forEach((w) => { let i = n.indexOf(w); while (i >= 0) { marks.push([i, i + w.length]); i = n.indexOf(w, i + w.length); } });
        if (!marks.length) return text;
        marks.sort((a, b) => a[0] - b[0]);
        const out = []; let pos = 0;
        marks.forEach(([a, b]) => { if (a < pos) return; out.push(text.slice(pos, a), h('mark', null, text.slice(a, b))); pos = b; });
        out.push(text.slice(pos));
        return out;
      };
      const row = (r) => {
        const p = r.p;
        const go2 = () => go('project/' + p.id);
        return h('tr', { class: 'pl-row' + (r.sc?.late ? ' late' : '') },
          h('td', { class: 'c-name' }, h('a', { href: '#/project/' + p.id }, h('b', null, mark(p.client))),
            h('small', null, [r.compound ? PTYPES.compound : PTYPES[p.project_type], p.brand].filter(Boolean).join(' · '))),
          h('td', { class: 'c-cust', 'data-l': 'العميل' }, p.customer_name ? [mark(p.customer_name), p.customer_phone ? h('small', { dir: 'ltr' }, p.customer_phone) : null] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'c-gov', 'data-l': 'المحافظة' }, p.governorate ? [p.governorate, p.city ? h('small', null, p.city) : null] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'c-stage', 'data-l': 'المرحلة' }, h('span', { class: r.status === 'done' ? 'ok-text' : '' }, r.now),
            r.flag ? h('span', { class: 'chip ' + (r.bad ? 'st-has-failure' : 'warn-chip'), title: r.why.join('، ') }, r.flag) : null),
          h('td', { class: 'c-crew', 'data-l': 'المنفّذ' }, r.crew ? [h('small', { class: 'kind-tag ' + r.crew.kind }, KIND_AR[r.crew.kind]), r.crew.name] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'c-pct', 'data-l': 'الإنجاز' }, h('span', { class: 'pj-prog' }, h('span', { class: 'st-bar' }, h('span', { style: { width: (r.pct * 100).toFixed(1) + '%' } })), h('b', null, pctText(r.pct)))),
          h('td', { class: 'c-due' + (r.sc?.late ? ' late' : ''), 'data-l': 'التسليم' }, p.due_date ? [h('span', { dir: 'ltr' }, p.due_date), h('small', null, r.due)] : h('span', { class: 'muted' }, '—')));
      };
      const draw = () => {
        const list = rows.filter(hit).sort((a, b) => SORTS[F0.sort](a, b) * F0.dir);
        drawHead();
        clear(tbody).append(...list.map(row));
        if (!list.length) tbody.append(h('tr', null, h('td', { colspan: COLS.length, class: 'pl-empty' },
          rows.length ? h('div', null, h('b', null, 'لا مشاريع تطابق البحث'), h('p', { class: 'muted' }, 'جرّب كلمة أقصر، أو امسح التصفية.'),
            h('button', { type: 'button', class: 'btn sm', onClick: reset }, 'مسح البحث والتصفية'))
            : h('div', null, h('b', null, 'لا توجد مشاريع بعد'), isStaff() ? h('p', { class: 'muted' }, 'أنشئ أول مشروع من زر "+ مشروع جديد".') : null))));
        const active = ['q', 'st', 'gov', 'brand', 'type', 'crew'].filter((k) => F0[k]).length;
        count.textContent = active ? `يظهر ${num(list.length)} من ${num(rows.length)}` : cntAr(rows.length, 'مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً');
        clearBtn.hidden = !active;
      };
      const sel = (key, label, opts) => {
        const el = h('select', { 'aria-label': label, class: F0[key] ? 'on' : '', onChange: (e) => { F0[key] = e.target.value; el.className = F0[key] ? 'on' : ''; draw(); } },
          h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: F0[key] === v }, l)));
        return el;
      };
      const search = h('input', { type: 'search', class: 'pl-search', value: F0.q, placeholder: 'ابحث باسم المشروع أو العميل أو الهاتف أو المحافظة أو المنفّذ…', 'aria-label': 'بحث في المشاريع', enterkeyhint: 'search',
        onInput: (e) => { F0.q = e.target.value; clearTimeout(search._t); search._t = setTimeout(draw, 120); } });
      const filters = [
        sel('st', 'كل الحالات', [['in_progress', 'جارية'], ['not_started', 'لم تبدأ'], ['done', 'مكتملة'], ['late', 'متأخرة']]),
        sel('gov', 'كل المحافظات', [...GOVS.map(([g]) => [g, g]).sort((a, b) => a[0].localeCompare(b[0], 'ar')), ['-', 'بلا محافظة']]),
        sel('brand', 'كل الماركات', [...brands.map((b) => [b, b]), ...(rows.some((r) => !r.p.brand) ? [['غير محددة', 'غير محددة']] : [])]),
        sel('type', 'كل الأنواع', Object.entries(PTYPES)),
        sel('crew', 'كل المنفّذين', state.crews.map((c) => [c.id, `${c.name} (${KIND_AR[c.kind]})`]))
      ];
      const reset = () => { Object.assign(F0, PF_DEFAULT, { sort: F0.sort, dir: F0.dir }); render(); };
      const clearBtn = h('button', { type: 'button', class: 'btn ghost sm', onClick: reset }, 'مسح التصفية');
      draw();
      // "/" يركّز البحث (مثل أغلب التطبيقات)
      const onKey = (e) => { if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); search.focus(); } };
      document.removeEventListener('keydown', state._plKey || (() => {})); state._plKey = onKey; document.addEventListener('keydown', onKey);
      return h('div', { class: 'stack plist' },
        h('div', { class: 'row between' }, h('h1', null, 'المشاريع'), isStaff() ? h('button', { type: 'button', class: 'btn primary', onClick: newProject }, '+ مشروع جديد') : null),
        h('div', { class: 'pl-tools' }, h('div', { class: 'pl-search-wrap' }, search), h('div', { class: 'pl-filters' }, filters, clearBtn)),
        count,
        h('div', { class: 'pl-table-wrap' }, h('table', { class: 'pl-table' }, h('caption', { class: 'sr-only' }, 'قائمة المشاريع. اضغط عنوان أي عمود للترتيب.'), h('thead', null, head), tbody)));
    }
  };

  // لوحة مجموعة مشاريع: كل الشركة، أو المجمّعات السكنية فقط
  async function portfolio(scope) {
    {
      const scoped = scope === 'compounds' ? state.projects.filter(isCompound) : state.projects;
      await Promise.all(scoped.map((p) => loadProject(p.id)));
      const cps = state.checkpoints;
      const fk = '_hf_' + scope;
      const f = state[fk] || (state[fk] = { gov: '', brand: '' });
      const today = new Date().toISOString().slice(0, 10);
      const rows = scoped.map((p) => {
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
      const govCount = new Set(scoped.map((p) => p.governorate).filter(Boolean)).size;
      const noun = scope === 'compounds' ? ['مجمّع', 'مجمّعات', 'مجمّعاً'] : ['مشروع', 'مشاريع', 'مشروعاً'];
      const attn = rows.filter((r) => issues(r)).sort((a, b) => (b.late - a.late) || (issues(b) - issues(a)));

      const lead = !rows.length ? (scope === 'compounds' ? 'لا توجد مجمّعات سكنية بعد. أنشئ مشروعاً واختر نوعه "مجمّع سكني".' : 'لا توجد مشاريع بعد. أنشئ أول مشروع لتبدأ المتابعة.')
        : `${num(rows.length)} ${rows.length === 1 ? noun[0] : rows.length <= 10 ? noun[1] : noun[2]} في ${num(govCount)} ${govCount === 1 ? 'محافظة' : 'محافظات'}، فيها ${num(sum('B3'))} وحدة. `
          + (attn.length ? `${attn.length === 1 ? noun[0] + ' واحد يحتاج' : num(attn.length) + ' ' + noun[1] + ' تحتاج'} انتباهك.` : 'لا مشاكل مفتوحة الآن.');

      // خريطة المحافظات
      const band = (v, has) => (!has ? 'none' : v >= 1 ? 'done' : v === 0 ? 'b0' : v < 0.25 ? 'b1' : v < 0.5 ? 'b2' : v < 0.75 ? 'b3' : 'b4');
      const govMap = h('div', { class: 'gov-map', role: 'list', 'aria-label': 'المشاريع حسب المحافظة' }, GOVS.map(([g, c, r]) => {
        const rs = rows.filter((x) => x.p.governorate === g);
        let gp = 0, gd = 0;
        rs.forEach((x) => x.D.per.forEach((y) => { gp += y.Pass; gd += x.D.B3 - y['N/A']; }));
        const prob = rs.some((x) => x.fails || x.open) ? ' flag-fail' : rs.some((x) => x.alerts) ? ' flag-alert' : '';
        const label = `${g}: ${rs.length ? `${rs.length} ${noun[0]}، إنجاز ${pctText(gd ? gp / gd : 0)}` : 'لا ' + noun[1]}`;
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

      // بطاقة قسم المجمّعات في الرئيسية
      const comp = rows.filter((r) => isCompound(r.p));
      let cP = 0, cD = 0; comp.forEach((x) => x.D.per.forEach((y) => { cP += y.Pass; cD += x.D.B3 - y['N/A']; }));
      const compBanner = scope === 'all' && comp.length ? h('a', { href: '#/compounds', class: 'comp-banner' },
        h('span', { class: 'cb-title' }, 'المجمّعات السكنية'),
        h('span', null, `${num(comp.length)} ${comp.length === 1 ? 'مجمّع' : comp.length <= 10 ? 'مجمّعات' : 'مجمّعاً'}، ${num(comp.reduce((a, x) => a + x.D.B3, 0))} وحدة، إنجاز ${pctText(cD ? cP / cD : 0)}`),
        comp.some((x) => issues(x)) ? h('span', { class: 'chip alert' }, 'فيها ما يحتاج انتباهك') : null,
        h('span', { class: 'cb-go' }, 'فتح القسم')) : null;

      // بطاقات المجمّعات بمخطط مصغّر
      const compCards = scope === 'compounds' && rows.length ? h('section', { class: 'd2-compounds' }, h('h2', null, 'المجمّعات'),
        h('ul', { class: 'comp-cards' }, rows.map((r) => h('li', null, h('a', { href: '#/project/' + r.p.id, class: 'comp-card' },
          h('div', { class: 'cc-head' }, h('b', null, r.p.client), h('span', { class: 'cc-pct' }, pctText(r.D.B10))),
          h('small', null, [r.p.governorate, r.p.city, r.p.brand].filter(Boolean).join('، ') || 'بدون بيانات موقع'),
          miniPlan(r.d),
          h('div', { class: 'cc-foot' }, `${num(r.D.B3)} ${unitWords(r.p).one}، مكتملة ${num(r.D.B4)}، جارية ${num(r.D.B5)}`,
            r.fails ? h('span', { class: 'chip st-has-failure' }, `${r.fails} فيها فشل`) : null,
            r.alerts ? h('span', { class: 'chip alert' }, `${r.alerts} تنبيه`) : null)))))) : null;

      const out = h('div', { class: 'dash2 home' },
        h('header', { class: 'd2-head' },
          h('p', { class: 'd2-lead' }, lead),
          h('div', { class: 'd2-pct' }, h('strong', null, pctText(overall)), h('span', null, scope === 'compounds' ? 'من فحوصات المجمّعات منجزة' : 'من فحوصات كل المشاريع منجزة'))),
        compBanner,
        h('dl', { class: 'd2-stats' }, [
          [scope === 'compounds' ? 'المجمّعات' : 'المشاريع', rows.length, ''], ['الوحدات', sum('B3'), ''], ['وحدات مكتملة', sum('B4'), 'ok'],
          ['فيها بند فاشل', sum('B7'), sum('B7') ? 'bad' : 'muted'], ['تنبيهات تسلسل', sum('B8'), sum('B8') ? 'warn' : 'muted'], ['NCR مفتوحة', sum('B9'), sum('B9') ? 'bad' : 'muted']
        ].map(([l, v, c]) => h('div', { class: 'st ' + c }, h('dd', null, num(v)), h('dt', null, l)))),
        h('div', { class: 'd2-grid' },
          h('section', { class: 'd2-plan' },
            h('div', { class: 'd2-plan-head' }, h('h2', null, scope === 'compounds' ? 'المجمّعات حسب المحافظة' : 'المشاريع حسب المحافظة'),
              h('span', { class: 'd2-note' }, f.gov ? `معروض: ${f.gov}. اضغطها مرة ثانية لإلغاء الاختيار` : (scope === 'compounds' ? 'اضغط محافظة لعرض مجمّعاتها' : 'اضغط محافظة لعرض مشاريعها'))),
            govMap),
          h('aside', { class: 'd2-side' },
            h('section', { class: 'd2-attn' + (attn.length ? ' has' : '') },
              h('h2', null, scope === 'compounds' ? 'مجمّعات تحتاج انتباهك' : 'مشاريع تحتاج انتباهك'),
              attn.length ? h('ul', null, attn.slice(0, 12).map((r) => h('li', null, h('a', { href: '#/project/' + r.p.id },
                h('b', null, r.p.client),
                h('span', { class: 'why' + (r.fails || r.open ? '' : ' alert') }, [r.fails ? `${r.fails} وحدة فيها فشل` : '', r.alerts ? `${r.alerts} تنبيه تسلسل` : '', r.open ? `${r.open} NCR مفتوحة` : '', r.late ? `${r.late} متأخرة` : ''].filter(Boolean).join('، ')),
                h('span', { class: 'nx' }, r.p.governorate || '')))))
                : h('p', { class: 'calm' }, 'لا فشل ولا تنبيهات ولا NCR مفتوحة.')),
            h('section', { class: 'd2-brands' }, h('h2', null, 'حسب الماركة'),
              byBrand.length ? h('ul', { class: 'brand-list' }, byBrand.map((x) => h('li', null,
                h('button', { type: 'button', class: f.brand === x.b ? 'sel' : '', 'aria-pressed': String(f.brand === x.b), onClick: () => { f.brand = f.brand === x.b ? '' : x.b; render(); } },
                  h('b', { dir: 'auto' }, x.b), h('small', null, `${x.n} ${noun[0]}، ${num(x.units)} وحدة`),
                  h('span', { class: 'st-bar' }, h('span', { style: { width: (x.pct * 100).toFixed(1) + '%' } })), h('span', { class: 'bp' }, pctText(x.pct))))))
                : h('p', { class: 'calm' }, '—')))),
        compCards,
        h('section', { class: 'd2-today', 'aria-live': 'polite' }, h('h2', null, 'نشاط اليوم'), todayActivity(scope === 'compounds' ? scoped.map((p) => p.id) : null)),
        h('section', { class: 'd2-projects' },
          h('div', { class: 'd2-plan-head' },
            h('h2', null, f.gov || f.brand ? `${scope === 'compounds' ? 'المجمّعات' : 'المشاريع'}: ${[f.gov, f.brand].filter(Boolean).join('، ')} (${list.length})` : `${scope === 'compounds' ? 'كل المجمّعات' : 'كل المشاريع'} (${list.length})`),
            h('div', { class: 'row' },
              f.gov || f.brand ? h('button', { type: 'button', class: 'btn sm', onClick: () => { f.gov = ''; f.brand = ''; render(); } }, 'إلغاء التصفية') : null,
              isStaff() ? h('button', { type: 'button', class: 'btn sm primary', onClick: newProject }, '+ مشروع جديد') : null)),
          list.length ? h('ul', { class: 'proj-list' }, list.map(projRow)) : h('p', { class: 'calm muted' }, rows.length ? 'لا مشاريع بهذه التصفية.' : (isStaff() ? 'أنشئ أول مشروع من زر "+ مشروع جديد".' : 'لم يُنشئ المدير أي مشروع بعد.'))));
      return out;
    }
  }

  // مخطط مصغّر للمجمّع: مربع صغير لكل وحدة بلون إنجازها
  function miniPlan(d) {
    const cps = state.checkpoints;
    return h('div', { class: 'mini-plan', 'aria-hidden': 'true' }, d.units.slice(0, 400).map((u) => {
      const k = F.row(u, cps, 0);
      const b = k.U === 'Complete' ? 'done' : k.S === 0 ? 'b0' : k.S < 0.25 ? 'b1' : k.S < 0.5 ? 'b2' : k.S < 0.75 ? 'b3' : 'b4';
      return h('i', { class: 'tile ' + b + (k.R ? ' flag-fail' : k.W ? ' flag-alert' : '') });
    }));
  }

  // نشاط اليوم: آخر تغييرات النتائج (كل المشاريع، أو مشاريع محددة)
  function todayActivity(projectIds) {
    const box = h('div', null, h('p', { class: 'd2-note' }, 'جارٍ التحميل…'));
    const start = new Date(); start.setHours(0, 0, 0, 0);
    Promise.all([
      fetchAll((a, b) => state.sb.from('unit_checks').select('unit_id, checkpoint, result, inspected_by, inspected_at, units!inner(project_id, code)')
        .gte('inspected_at', start.toISOString()).order('inspected_at', { ascending: false }).range(a, b)),
      state.sb.from('profiles').select('id, full_name')
    ]).then(([all, prof]) => {
      const rows = projectIds ? all.filter((x) => projectIds.includes(x.units.project_id)) : all;
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
      type: h('select', null, Object.entries(PTYPES).map(([k, l]) => h('option', { value: k, selected: (p.project_type || 'houses') === k }, l))),
      label: h('select', null, Object.keys(UNIT_WORDS).map((k) => h('option', { value: k, selected: (p.unit_label || 'فيلا') === k }, k))),
      cust: h('input', { maxlength: 200, value: p.customer_name || '', placeholder: 'اسم العميل أو الجهة' }),
      phone: h('input', { type: 'tel', maxlength: 30, value: p.customer_phone || '', dir: 'ltr', inputmode: 'tel', placeholder: '07xx xxx xxxx' }),
      addr: h('input', { maxlength: 300, value: p.site_address || '', placeholder: 'الحي، الشارع، أقرب نقطة دالة' }),
      map: h('input', { type: 'url', maxlength: 500, value: p.map_url || '', dir: 'ltr', placeholder: 'https://maps.app.goo.gl/…' }),
      contract: h('input', { type: 'date', value: p.contract_date || '', dir: 'ltr' }),
      start: h('input', { type: 'date', value: p.start_date || '', dir: 'ltr' }),
      due: h('input', { type: 'date', value: p.due_date || '', dir: 'ltr' })
    };
    const dl = h('datalist', { id: 'brand-list' }, BRAND_SUGGEST.map((b) => h('option', { value: b })));
    // اسم الوحدة يخص المجمّعات السكنية فقط
    const labelF = field('اسم الوحدة', el.label, { hint: 'كيف تُسمّى وحدات المجمّع: فيلا، شقة، بيت…' });
    const syncLabel = () => { labelF.classList.toggle('is-hidden', el.type.value !== 'compound'); };
    el.type.addEventListener('change', syncLabel); syncLabel();
    const grid = h('div', { class: 'form-grid' },
      field('اسم المشروع', el.name, { wide: true }), field('المحافظة', el.gov), field('المدينة', el.city),
      field('الماركة', el.brand), field('نوع المشروع', el.type), labelF, dl,
      h('h3', { class: 'fg-title wide' }, 'العميل والموقع'),
      field('اسم العميل', el.cust), field('هاتف العميل', el.phone), field('عنوان الموقع', el.addr, { wide: true }),
      field('رابط الموقع على الخريطة', el.map, { wide: true, hint: 'افتح الموقع في خرائط Google، واضغط مشاركة، وانسخ الرابط' }),
      h('h3', { class: 'fg-title wide' }, 'العقد والمواعيد'),
      field('تاريخ العقد', el.contract), field('تاريخ البدء المخطط', el.start), field('تاريخ التسليم', el.due, { hint: 'يصير المشروع متأخراً إذا فات هذا التاريخ ولم يكتمل' }));
    const values = () => ({ client: el.name.value.trim(), governorate: el.gov.value || null, city: el.city.value.trim() || null,
      brand: el.brand.value.trim() || null, project_type: el.type.value, unit_label: el.type.value === 'compound' ? el.label.value : (p.unit_label || 'وحدة'),
      customer_name: el.cust.value.trim() || null, customer_phone: el.phone.value.trim() || null, site_address: el.addr.value.trim() || null,
      map_url: el.map.value.trim() || null, contract_date: el.contract.value || p.contract_date || todayStr(), start_date: el.start.value || null, due_date: el.due.value || null });
    // التحقق هنا للتوضيح فقط، والقاعدة تفرض نفس الشروط
    const invalid = () => {
      const v = values();
      if (!v.client) return 'اكتب اسم المشروع';
      if (v.customer_phone && !/^[0-9+ ()-]{4,30}$/.test(v.customer_phone)) return 'رقم الهاتف أرقام فقط';
      if (v.map_url && !/^https:\/\/[^\s<>"]+$/.test(v.map_url)) return 'رابط الخريطة يجب أن يبدأ بـ https://';
      if (v.start_date && v.due_date && v.due_date < v.start_date) return 'تاريخ التسليم قبل تاريخ البدء';
      return '';
    };
    return { el, grid, values, invalid };
  }

  function newProject() {
    const pf = projectFields();
    const count = h('input', { type: 'number', min: 0, max: 2000, dir: 'ltr', value: 0 });
    const prefix = h('input', { dir: 'ltr', value: 'V-', maxlength: 10 });
    // الوحدات تخصّ المجمّعات فقط؛ باقي المشاريع تُتابَع بمراحلها
    const unitsBox = h('div', { class: 'form-grid' },
      field('عدد الوحدات', count, { hint: 'ضع 0 إذا ستستورد ملف Excel للمجمّع' }),
      field('بادئة الترقيم', prefix, { hint: 'مثال: V- تعطي V-001، V-002…' }));
    const syncUnits = () => { const off = pf.el.type.value !== 'compound'; unitsBox.classList.toggle('is-hidden', off); if (off) count.value = 0; };
    pf.el.type.addEventListener('change', syncUnits); syncUnits();
    modal('مشروع جديد', h('div', { class: 'stack sm' }, pf.grid, unitsBox),
    [{ label: 'إنشاء المشروع', cls: 'primary', run: async () => {
      const v = pf.values();
      const n = Number(count.value);
      const bad = pf.invalid();
      if (bad) { toast(bad, 'error'); return false; }
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
      go('project/' + res.data.id + (isCompound(res.data) ? '/tracker' : ''));
    } }]);
  }

  /* ---------- المنفّذون: فرق الشركة والمقاولون ----------
     الأداء يُحسب من مراحل المشاريع المسندة لكل منفّذ:
     مكتملة، جارية، عدد المشاريع، متوسط مدة المرحلة (من البدء إلى الانتهاء)،
     ومراحل اكتملت بعد تاريخ تسليم مشروعها. */
  const KIND_AR = { internal: 'فرقة من الشركة', contractor: 'مقاول' };
  function crewStats(c) {
    const st = { done: 0, ip: 0, projects: new Set(), days: [], afterDue: 0, at: [] };
    state.projects.forEach((p) => Object.values(state.stages[p.id] || {}).forEach((x) => {
      if (x.crew_id !== c.id) return;
      if (x.status === 'done') {
        st.done++; st.projects.add(p.id);
        if (x.start_date && x.end_date) st.days.push(dayDiff(x.end_date, x.start_date) + 1);
        if (p.due_date && x.end_date && x.end_date > p.due_date) st.afterDue++;
      } else if (x.status === 'in_progress') { st.ip++; st.projects.add(p.id); st.at.push({ p, x }); }
    }));
    st.avg = st.days.length ? st.days.reduce((a, b) => a + b, 0) / st.days.length : null;
    return st;
  }
  views.crews = {
    title: 'الفرق والمقاولون',
    render(r) {
      const tab = r.id === 'contractor' ? 'contractor' : r.id === 'internal' ? 'internal' : 'all';
      const cpN = Object.fromEntries(state.checkpoints.map((c) => [c.key, c.name_ar]));
      const edit = (c = { kind: tab === 'contractor' ? 'contractor' : 'internal' }) => {
        let kind = c.kind || 'internal';
        const el = { name: h('input', { maxlength: 80, value: c.name || '' }),
          leader: h('input', { maxlength: 80, value: c.leader || '' }),
          phone: h('input', { type: 'tel', maxlength: 30, dir: 'ltr', inputmode: 'tel', value: c.phone || '' }),
          active: h('input', { type: 'checkbox', checked: c.active !== false }) };
        const govs = GOVS.map(([g]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: g, checked: (c.governorates || []).includes(g) }), ' ' + g));
        const labels = () => {
          nameF.querySelector('label').textContent = kind === 'contractor' ? 'اسم المقاول أو شركته' : 'اسم الفرقة';
          leaderF.querySelector('label').textContent = kind === 'contractor' ? 'المسؤول' : 'رئيس الفرقة';
          el.name.placeholder = kind === 'contractor' ? 'مثال: شركة النور للمقاولات' : 'مثال: فرقة أبو علي';
        };
        const nameF = field('', el.name, { wide: true }), leaderF = field('', el.leader);
        const seg = h('div', { class: 'seg4 kind2', role: 'radiogroup', 'aria-label': 'النوع' }, Object.entries(KIND_AR).map(([k, l]) =>
          h('button', { type: 'button', role: 'radio', class: k === kind ? 'on' : '', 'aria-checked': String(k === kind), onClick: (e) => {
            kind = k; seg.querySelectorAll('button').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
            e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true'); labels();
          } }, l)));
        labels();
        modal(c.id ? 'تعديل' : 'إضافة منفّذ', h('div', { class: 'stack sm' }, seg,
          h('div', { class: 'form-grid' }, nameF, leaderF, field('الهاتف', el.phone),
            h('fieldset', { class: 'govs wide' }, h('legend', null, 'المحافظات التي يعمل بها'), h('div', { class: 'gov-checks' }, govs)),
            h('label', { class: 'check wide' }, el.active, ' فعّال (يظهر عند اختيار المنفّذ)'))),
        [{ label: 'حفظ', cls: 'primary', run: async () => {
          const v = { kind, name: el.name.value.trim(), leader: el.leader.value.trim() || null, phone: el.phone.value.trim() || null, active: el.active.checked,
            governorates: govs.map((x) => x.querySelector('input')).filter((i) => i.checked).map((i) => i.value) };
          if (!v.name) { toast('اكتب الاسم', 'error'); return false; }
          if (v.phone && !/^[0-9+ ()-]{4,30}$/.test(v.phone)) { toast('رقم الهاتف أرقام فقط', 'error'); return false; }
          const res = c.id ? await state.sb.from('crews').update(v).eq('id', c.id).select().maybeSingle() : await state.sb.from('crews').insert(v).select().single();
          if (res.error || !res.data) { fail(res.error || 'permission denied'); return false; }
          if (c.id) Object.assign(c, res.data); else state.crews.push(res.data);
          state.crews.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
          toast('تم الحفظ'); render();
        } }]);
      };
      const del = async (c) => {
        if (!await window.UI.confirmBox({ title: 'حذف', body: `سيُحذف "${c.name}"، وتبقى المراحل المسندة له بدون منفّذ. الأفضل إلغاء تفعيله بدل الحذف حتى يبقى سجل أدائه.`, okText: 'حذف', danger: true })) return;
        const res = await state.sb.from('crews').delete().eq('id', c.id).select();
        if (res.error || !res.data?.length) return fail(res.error || 'permission denied');
        state.crews = state.crews.filter((x) => x.id !== c.id); toast('تم الحذف'); render();
      };
      const list = state.crews.filter((c) => tab === 'all' || c.kind === tab);
      const n = (k) => state.crews.filter((c) => c.kind === k).length;
      const card = (c) => {
        const st = crewStats(c);
        return h('li', { class: 'crew-card ' + c.kind + (c.active ? '' : ' off') },
          h('div', { class: 'cc-top' }, h('span', null, h('small', { class: 'kind-tag ' + c.kind }, KIND_AR[c.kind]), h('b', null, c.name)),
            h('span', { class: 'chip ' + (st.ip ? 'st-in-progress' : '') }, !c.active ? 'غير فعّال' : st.ip ? 'يعمل الآن' : 'متاح')),
          c.leader || c.phone ? h('p', null, c.leader ? (c.kind === 'contractor' ? 'المسؤول: ' : 'الرئيس: ') + c.leader : '', c.leader && c.phone ? ' · ' : '',
            c.phone ? h('a', { href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), dir: 'ltr' }, c.phone) : null) : null,
          c.governorates?.length ? h('p', { class: 'cc-govs' }, c.governorates.join('، ')) : null,
          h('dl', { class: 'perf' },
            h('div', null, h('dd', null, num(st.done)), h('dt', null, 'مرحلة مكتملة')),
            h('div', null, h('dd', null, num(st.ip)), h('dt', null, 'جارية')),
            h('div', null, h('dd', null, num(st.projects.size)), h('dt', null, 'مشروع')),
            h('div', null, h('dd', null, st.avg === null ? '—' : num(Math.round(st.avg * 10) / 10)), h('dt', null, 'يوم للمرحلة')),
            h('div', { class: st.afterDue ? 'bad' : '' }, h('dd', null, num(st.afterDue)), h('dt', null, 'بعد موعد التسليم'))),
          st.at.length ? h('ul', { class: 'cc-at' }, st.at.map((w) => h('li', null, h('a', { href: '#/project/' + w.p.id }, w.p.client), ' · ' + cpN[w.x.checkpoint] + (w.x.crew ? ` · ${num(w.x.crew)} كادر` : '')))) : null,
          isStaff() ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', onClick: () => edit(c) }, 'تعديل'),
            isAdmin() ? h('button', { type: 'button', class: 'btn sm ghost danger-text', onClick: () => del(c) }, 'حذف') : null) : null);
      };
      return h('div', { class: 'stack crews-page' },
        h('div', { class: 'row between' }, h('h1', null, 'الفرق والمقاولون'), isStaff() ? h('button', { type: 'button', class: 'btn primary', onClick: () => edit() }, '+ إضافة') : null),
        h('p', { class: 'muted' }, 'كل مرحلة في المشروع تُسند لمنفّذ: فرقة من فنيي الشركة أو مقاول تنفيذ. الأداء يُحسب من المراحل المسندة لكل منفّذ.'),
        h('nav', { class: 'sheet-tabs' }, [['all', `الكل (${state.crews.length})`], ['internal', `فرق الشركة (${n('internal')})`], ['contractor', `المقاولون (${n('contractor')})`]].map(([k, l]) =>
          h('a', { href: '#/crews' + (k === 'all' ? '' : '/' + k), class: 'sheet-tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'page' : null }, l))),
        list.length ? h('ul', { class: 'crew-cards' }, list.map(card))
          : empty(tab === 'contractor' ? 'لا يوجد مقاولون بعد' : 'لا توجد فرق بعد', isStaff() ? 'أضف من زر "+ إضافة".' : 'يضيفها المدير أو المشرف.'),
        h('p', { class: 'd2-note muted small' }, '"يوم للمرحلة" = متوسط الأيام من بدء المرحلة إلى انتهائها. "بعد موعد التسليم" = مراحل اكتملت بعد تاريخ تسليم مشروعها.'));
    }
  };

  /* ---------- المستخدمون ---------- */
  // الإنشاء عبر دالة على خادم Supabase (admin-create-user) تتحقق أن الطالب مدير.
  // مفتاح service_role يبقى على الخادم ولا يصل للواجهة.
  function newUser() {
    const name = h('input', { maxlength: 120, autocomplete: 'off' });
    const email = h('input', { type: 'email', dir: 'ltr', maxlength: 200, autocomplete: 'off', inputmode: 'email' });
    const pass = h('input', { type: 'text', dir: 'ltr', maxlength: 72, autocomplete: 'new-password', spellcheck: 'false' });
    const roleSel = h('select', null, Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: v === 'technician' }, l)));
    const gen = () => {
      const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ', dig = '23456789';
      const r = new Uint32Array(10); crypto.getRandomValues(r);
      pass.value = Array.from(r, (x, i) => (i % 3 === 2 ? dig : abc)[x % (i % 3 === 2 ? dig.length : abc.length)]).join('');
    };
    gen();
    modal('مستخدم جديد', h('div', { class: 'form-grid' },
      field('الاسم', name, { wide: true }), field('البريد الإلكتروني', email, { wide: true }),
      field('كلمة المرور', pass, { hint: '8 أحرف على الأقل، فيها أرقام وحروف' }),
      h('div', { class: 'field' }, h('label', null, '\u00a0'), h('button', { type: 'button', class: 'btn', onClick: gen }, 'كلمة مرور جديدة')),
      field('الدور', roleSel, { wide: true, hint: 'الفني يشاهد ويسجّل قراءات الفحص فقط' })),
    [{ label: 'إنشاء الحساب', cls: 'primary', run: async () => {
      const v = { full_name: name.value.trim(), email: email.value.trim().toLowerCase(), password: pass.value, role: roleSel.value };
      if (!v.full_name) { toast('اكتب الاسم', 'error'); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) { toast('البريد الإلكتروني غير صحيح', 'error'); return false; }
      if (v.password.length < 8 || !/[0-9]/.test(v.password) || !/[^0-9]/.test(v.password)) { toast('كلمة المرور 8 أحرف على الأقل، وفيها أرقام وحروف', 'error'); return false; }
      const { data, error } = await state.sb.functions.invoke('admin-create-user', { body: v });
      if (error) {
        let msg = '';
        try { msg = (await error.context.json()).error; } catch (e) { /* */ }
        toast(msg || errText(error), 'error'); return false;
      }
      // بطاقة الدخول تظهر مرة واحدة لترسلها للشخص
      const text = `حسابك في تطبيق متابعة مشاريع سرور\nالرابط: ${location.origin}${location.pathname}\nالبريد: ${v.email}\nكلمة المرور: ${v.password}`;
      setTimeout(() => modal('تم إنشاء الحساب', h('div', { class: 'stack sm' },
        h('p', null, `أُنشئ حساب ${v.full_name} بدور ${ROLES[v.role]}. أرسل له بيانات الدخول برسالة خاصة:`),
        h('pre', { class: 'cred', dir: 'rtl' }, text),
        h('p', { class: 'muted small' }, 'لن تظهر كلمة المرور مرة أخرى. لا تنشرها في مجموعة عامة.')),
      [{ label: 'نسخ', cls: 'primary', run: async () => { try { await navigator.clipboard.writeText(text); toast('تم النسخ'); } catch (e) { toast('انسخ النص يدوياً', 'error'); } return false; } },
       { label: 'واتساب', run: () => { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener'); return false; } }]), 0);
      render();
    } }]);
  }

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
      return h('div', { class: 'stack' },
        h('div', { class: 'row between' }, h('h1', null, 'المستخدمون'), h('button', { type: 'button', class: 'btn primary', onClick: newUser }, '+ مستخدم جديد')),
        h('p', { class: 'muted' }, 'غيّر الاسم أو الدور من الجدول ويُحفظ وحده. لإيقاف شخص ترك العمل، أزل علامة "مفعّل" بدل الحذف حتى تبقى سجلاته.'),
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
            ['عرض كل المشاريع والمراحل والفرق وبيانات العملاء', 1, 1, 1],
            ['تسجيل قراءات الفحص في المجمّعات', 1, 1, 1],
            ['إنشاء المشاريع وتعديل بياناتها ومواعيدها', 1, 1, 0],
            ['بدء المراحل وإكمالها وإسنادها لفرقة أو مقاول', 1, 1, 0],
            ['إضافة الفرق والمقاولين وتعديلهم', 1, 1, 0],
            ['نتائج فحص الفلل، وNCR، واستيراد Excel، والنسخة الاحتياطية', 1, 1, 0],
            ['حذف المشاريع والفرق، وإضافة المستخدمين، وسجل العمليات', 1, 0, 0]
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
          const [units, checks, tests, ncrs, stages, crews] = await Promise.all([all('units'), all('unit_checks'), all('test_records'), all('ncrs'), all('project_stages'), all('crews')]);
          download(new Blob([JSON.stringify({ app: 'surour-vrf-qc', version: 4, exported_at: new Date().toISOString(),
            projects: state.projects, project_stages: stages, crews, units, unit_checks: checks, test_records: tests, ncrs }, null, 1)], { type: 'application/json' }),
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
    loadProject, loadBase, isAdmin, isStaff, stageOf, stageProgress, STAGE_AR, schedule, dueText, daysAr, crewOf, KIND_AR, unitWords, projectFields, GOVS, PTYPES, isCompound, todayActivity, F, RES, RES_AR, STATUS_AR, openNcrsOf, pctText };

  applyTheme();
  document.addEventListener('DOMContentLoaded', () => boot().catch(fail));
})();
