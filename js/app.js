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
  // الحسابات الصافية (المعادلات والمواعيد والتقدّم) في js/core.js
  const Core = window.Core;
  const { ROLES, GOVS, PTYPES, isCompound, BRAND_SUGGEST, UNIT_WORDS, unitWords, unitCount, RES, RES_AR, STATUS_AR, STAGE_AR,
    F, openNcrsOf, pctText, BEHIND_GAP, MAP_URL, todayStr, dayDiff, schedule, daysAr, dueText, cntAr, norm, digits, strongEnough } = Core;

  const TABLES = { profiles: 'المستخدمون', projects: 'المشاريع', units: 'Villa Tracker', unit_checks: 'Villa Tracker',
    test_records: 'Test Records', ncrs: 'NCR Register', materials: 'المواد', project_stages: 'مراحل العمل', crews: 'الفرق', stage_requests: 'تقارير المراحل', backups: 'النسخ الاحتياطية' };
  const ACTIONS = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف', DOWNLOAD: 'تنزيل' };

  const state = {
    sb: null, user: null, profile: null,
    projects: [], checkpoints: [], crews: [],
    crewUnits: [],    // وحدات المجمّعات المسندة لكل فرقة (عرض crew_unit_stats)
    stages: {},       // لكل مشروع: { checkpoint: صف المرحلة }
    requests: [],     // تقارير الفنيين (المعلّقة + آخر 30 يوماً)
    people: {},       // أسماء المستخدمين: { id: الاسم }
    data: {}          // لكل مشروع: { units, tests: Map(unit_id), ncrs }
  };
  const role = () => state.profile?.role;
  const isAdmin = () => role() === 'admin';
  const isStaff = () => role() === 'admin' || role() === 'supervisor';

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
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [projects, cps, stages, crews, reqs, people] = await Promise.all([
      state.sb.from('projects').select('*').order('created_at'),
      state.sb.from('qc_checkpoints').select('*').order('position'),
      fetchAll((a, b) => state.sb.from('project_stages').select('*').range(a, b)),
      state.sb.from('crews').select('*').order('name'),
      fetchAll((a, b) => state.sb.from('stage_requests').select('*').or(`status.eq.pending,requested_at.gte.${since}`).order('requested_at', { ascending: false }).range(a, b)),
      state.sb.from('profiles').select('id, full_name')]);
    if (projects.error) throw projects.error;
    if (cps.error) throw cps.error;
    state.projects = projects.data;
    state.checkpoints = cps.data;
    if (crews.error) throw crews.error;
    state.crews = crews.data;
    state.requests = reqs;
    state.people = people.error ? {} : Object.fromEntries(people.data.map((x) => [x.id, x.full_name]));
    state.stages = {};
    stages.forEach((x) => { (state.stages[x.project_id] ||= {})[x.checkpoint] = x; });
    await loadCrewUnits();
  }

  // أداء الفرق في المجمّعات: سطر لكل (فرقة، مجمّع) فيه عدد الوحدات والمكتملة والفاشلة والجارية
  async function loadCrewUnits() {
    state._cuAt = Date.now();
    const r = await state.sb.from('crew_unit_stats').select('*');
    if (r.error) { console.warn(r.error); return; }
    state.crewUnits = r.data;
  }

  /* ---------- مراحل العمل على مستوى المشروع ---------- */
  const stageOf = (p, key) => state.stages[p.id]?.[key] || { project_id: p.id, checkpoint: key, status: 'not_started' };
  // التقدّم: المكتملة ÷ (13 − لا تنطبق)، والمرحلة الحالية = أول مرحلة غير مكتملة (المعادلة في js/core.js)
  const stageProgress = (p) => Core.progress(state.checkpoints, (key) => stageOf(p, key));

  const crewOf = (id) => state.crews.find((c) => c.id === id) || null;

  /* ---------- التوقّع بالوتيرة الحالية ----------
     إذا استمر المشروع بنفس سرعته منذ بدء العمل الفعلي (أول مرحلة بدأت، وإلا البدء المخطط)، متى ينتهي؟
     المدة المتوقعة = الأيام المنقضية ÷ نسبة الإنجاز. الفرق عن التسليم: موجب = قبل الموعد، سالب = بعده. */
  const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * DAY).toISOString().slice(0, 10);
  const FC_MIN = 0.15;
  function forecast(p, pct, status) {
    if (status !== 'in_progress' || !(pct >= FC_MIN) || pct >= 1) return null;   // قبل 15% الوتيرة غير معبّرة بعد
    const first = Object.values(state.stages[p.id] || {}).map((x) => x.start_date).filter(Boolean).sort()[0] || null;
    const start = first || p.start_date;
    const t = todayStr();
    if (!start || start > t) return null;
    const elapsed = dayDiff(t, start) + 1;
    if (elapsed < 3) return null;                  // أقل من 3 أيام: الوتيرة غير معبّرة بعد
    const end = addDays(start, Math.ceil(elapsed / pct) - 1);
    return { start, end, elapsed, left: dayDiff(end, t), diff: p.due_date ? dayDiff(p.due_date, end) : null, actual: !!first };
  }
  function forecastText(fc, short) {
    if (!fc) return '';
    const vs = fc.diff === null ? '' : fc.diff > 0 ? `قبل الموعد بـ${daysAr(fc.diff)}` : fc.diff < 0 ? `بعد الموعد بـ${daysAr(-fc.diff)}` : 'في موعد التسليم';
    if (short) return vs ? `التوقّع: ${vs}` : `التوقّع: ${fc.end}`;
    return `بالوتيرة الحالية ينتهي حوالي ${fc.end}` + (vs ? `، ${vs}` : '');
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
    // منع فتح التطبيق داخل إطار في موقع آخر (حماية من خداع النقر). GitHub Pages لا يسمح بترويسة X-Frame-Options
    if (window.top !== window.self) { clear(root).appendChild(h('p', { class: 'muted' }, 'افتح التطبيق من رابطه مباشرة.')); return; }
    const ok = cfg.supabaseUrl && !/YOUR-PROJECT/.test(cfg.supabaseUrl) && cfg.supabaseAnonKey && !/YOUR-ANON-KEY/.test(cfg.supabaseAnonKey);
    if (!ok || !window.supabase) return renderSetupNeeded();
    state.sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
    state.sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        // لا يبقى شيء من بيانات المستخدم السابق لمن يدخل بعده على نفس الجهاز
        for (const k of Object.keys(state)) if (k.startsWith('_')) delete state[k];
        Object.assign(state, { user: null, profile: null, projects: [], data: {}, stages: {}, crews: [], crewUnits: [], requests: [], people: {}, tasks: [], taskReqs: [], staffList: [], tasksReady: false, notes: [], notesReady: false });
        render();
      }
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
      try { await loadBase(); state._loadError = null; } catch (e) { state._loadError = e; }
    }
    render();
  }

  // تعذّر التحميل (انقطاع الإنترنت مثلاً): شاشة "أعد المحاولة" بدل صفحة فارغة توحي بأن لا مشاريع
  function viewLoadError() {
    const retry = h('button', { type: 'button', class: 'btn primary big', onClick: async () => {
      retry.disabled = true; retry.textContent = 'جارٍ التحميل…';
      try { await loadBase(); state._loadError = null; } catch (e) { state._loadError = e; }
      render();
    } }, 'أعد المحاولة');
    return h('div', { class: 'auth' }, h('div', { class: 'auth-card load-err' }, h('div', { class: 'le-ic', 'aria-hidden': 'true' }, '📡'),
      h('h1', null, 'تعذّر تحميل البيانات'), h('p', { class: 'muted' }, errText(state._loadError) + '. تأكد من الاتصال ثم أعد المحاولة.'), retry,
      h('button', { type: 'button', class: 'btn ghost', onClick: signOut }, 'خروج')));
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
    if (state._loadError) return root.appendChild(viewLoadError());

    const r = parseRoute();
    // مشروع واحد فقط؟ افتحه مباشرة مثل فتح ملف Excel
    let v = views[r.name] || views.home;
    if (v.allow && !v.allow()) v = views.home;
    const title = typeof v.title === 'function' ? v.title(r) : v.title;
    document.title = title + ' | مصاعد السرور';

    // حركة الدخول فقط عند تغيّر الصفحة، لا عند إعادة الرسم بعد حفظ أو تصفية
    const entering = location.hash !== state._lastHash;
    state._lastHash = location.hash;
    // صفحة جديدة تبدأ من الأعلى (لا تبقى بمكان التمرير السابق)
    if (entering) window.scrollTo(0, 0);
    const main = h('main', { class: 'main' });
    // كتابة لم تُحفظ بعد: تمنع إعادة الرسم التلقائية (مثل تدوير الهاتف)
    state._dirty = false;
    main.addEventListener('input', () => { state._dirty = true; });
    const [side, mtop, mbar, dtop] = topbar(r);
    root.appendChild(h('div', { class: 'app app-side' }, side, h('div', { class: 'app-col' }, dtop, mtop, main), mbar));
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
      const m = text.replace(/[\u2066-\u2069]/g, '').match(/^([0-9][0-9,]*)(\.([0-9]+))?(%?)$/);
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
    techs: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
    reports: ['M9 4h6v3H9z', 'M7 5H5v16h14V5h-2', 'M8 12l2.5 2.5L16 9', 'M8 18h8'],
    calendar: ['M4 5h16v16H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4', 'M8 14h2', 'M14 14h2', 'M8 18h2'],
    tasks: ['M4 5h4v4H4z', 'M4 15h4v4H4z', 'M11 7h9', 'M11 17h9', 'M5 7l1 1 2-2'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-5-5'],
    more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
    help: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
    down: ['M6 9l6 6 6-6']
  };
  function icon(k) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
    (ICONS[k] || []).forEach((d) => { const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); svg.appendChild(path); });
    return svg;
  }
  function userMenu() {
    const name = state.profile.full_name || state.user.email;
    return h('details', { class: 'dt-user' },
      h('summary', null, h('span', { class: 'dt-av', 'aria-hidden': 'true' }, String(name).trim()[0] || '؟'),
        h('span', { class: 'dt-who' }, h('b', null, name), h('small', null, ROLES[role()])), icon('down')),
      h('div', { class: 'dt-menu' },
        h('button', { type: 'button', onClick: toggleTheme }, 'تبديل المظهر'),
        h('button', { type: 'button', onClick: changePassword }, 'كلمة المرور'),
        h('button', { type: 'button', class: 'out', onClick: signOut }, 'تسجيل الخروج')));
  }
  function helpBox() {
    modal('مساعدة سريعة', h('ul', { class: 'help-list' },
      h('li', null, h('b', null, 'البحث: '), 'Ctrl + K من أي صفحة، أو "/" في صفحة المشاريع.'),
      h('li', null, h('b', null, 'الأرقام في لوحة التحكم: '), 'اضغط أي رقم ليفتح المشاريع مصفّاة.'),
      h('li', null, h('b', null, 'المرحلة الحالية: '), 'من صفحة المشروع اضغط "ابدأ" ثم "اكتملت" فتبدأ التالية وحدها.'),
      h('li', null, h('b', null, 'الفني: '), 'يرسل تقرير المرحلة بصورة، ويوافق عليه المدير أو المشرف.')), []);
  }
  function topbar(r) {
    const p = r.name === 'project' ? state.projects.find((x) => x.id === r.id) : null;
    const navOn = p && isCompound(p) ? 'compounds' : p ? 'projects' : r.name;
    const menu = [
      ['home', 'لوحة التحكم', true],
      ['projects', 'المشاريع', true],
      ['tasks', isStaff() ? 'المهام' : 'مهامي', !!window.Tasks],
      ['crews', 'الفرق والمقاولون', true],
      ['calendar', 'تقويم المواعيد', true],
      ['techs', isStaff() ? 'أداء الفنيين' : 'أدائي', true],
      ['compounds', 'المجمّعات السكنية', true],
      ['reports', 'سجل التقارير', true],
      ['users', 'المستخدمون', isAdmin()],
      ['audit', 'سجل العمليات', isAdmin()],
      ['backup', 'نسخة احتياطية', isStaff()]
    ].filter((x) => x[2]);
    const stay = (k) => (k === 'home' ? () => { state._stayHome = true; } : null);
    const SHORT = { tasks: isStaff() ? 'المهام' : 'مهامي', calendar: 'المواعيد', home: 'اللوحة', crews: 'الفرق', compounds: 'المجمّعات', techs: isStaff() ? 'الأداء' : 'أدائي' };
    const link = ([k, l]) => h('a', { href: '#/' + k, class: navOn === k ? 'on' : '', 'aria-current': navOn === k ? 'page' : null, onClick: stay(k), 'aria-label': l }, icon(k),
      h('span', { class: 'nl-full' }, l), SHORT[k] ? h('span', { class: 'nl-short', 'aria-hidden': 'true' }, SHORT[k]) : null);
    const me = h('div', { class: 'side-me' },
      h('span', { class: 'who' }, h('b', null, state.profile.full_name || state.user.email), h('small', null, ROLES[role()])),
      h('div', { class: 'row' },
        h('button', { class: 'btn ghost sm', type: 'button', onClick: toggleTheme, 'aria-label': 'تبديل المظهر' }, 'المظهر'),
        h('button', { class: 'btn ghost sm', type: 'button', onClick: changePassword }, 'كلمة المرور'),
        h('button', { class: 'btn ghost sm', type: 'button', onClick: signOut }, 'خروج')));
    // الهاتف: اللوحة والمشاريع، زر + بالنص، الفرق، والباقي مع الخروج تحت "المزيد"
    const rest = menu.slice(3);
    const more = h('details', { class: 'mb-more' },
      h('summary', { class: rest.some(([k]) => k === navOn) ? 'on' : '' }, icon('more'), h('span', null, 'المزيد')),
      h('div', { class: 'mb-sheet' }, rest.map(link), me.cloneNode(true)));
    // cloneNode لا ينسخ الأحداث: نعيد ربط أزرار المظهر وكلمة المرور والخروج في نسخة الهاتف
    const btns = more.querySelectorAll('.side-me button');
    btns[0].onclick = toggleTheme; btns[1].onclick = changePassword; btns[2].onclick = signOut;
    return [
      h('aside', { class: 'side', 'aria-label': 'القائمة الرئيسية' },
        h('a', { href: '#/home', class: 'side-logo', onClick: stay('home') }, logo(), h('span', null, 'منصة المشاريع')),
        window.Collab ? window.Collab.bell('side-bell') : null,
        window.Insights ? h('button', { type: 'button', class: 'side-search', onClick: () => window.Insights.search() }, icon('search'), h('span', null, 'بحث'), h('kbd', { dir: 'ltr' }, 'Ctrl K')) : null,
        h('nav', { class: 'side-nav' }, menu.map(link)),
        p ? h('div', { class: 'side-proj' }, h('small', null, 'المشروع المفتوح'), h('a', { href: '#/project/' + p.id }, p.client)) : null,
        me),
      h('header', { class: 'mtop' }, h('a', { href: '#/home', onClick: stay('home') }, logo()), p ? h('span', { class: 'mtop-crumb' }, p.client) : null,
        window.Collab ? window.Collab.bell('mtop-bell') : null,
        window.Insights ? h('button', { type: 'button', class: 'mtop-search', 'aria-label': 'بحث', onClick: () => window.Insights.search() }, icon('search')) : null),
      // في صفحات المجمّع يظهر شريط المجمّع السفلي بدل هذا
      p && isCompound(p) ? null : h('nav', { class: 'mbar', 'aria-label': 'التنقل' }, menu.slice(0, 2).map(link),
        h('button', { type: 'button', class: 'mbar-plus', 'aria-label': 'إضافة', onClick: plusSheet }, h('span', { 'aria-hidden': 'true' }, '+')),
        link(menu[2]), more),
      // الشريط العلوي على الكمبيوتر: البحث، والمساعدة، والإشعارات، وحساب المستخدم
      h('header', { class: 'dtop' },
        window.Insights ? h('button', { type: 'button', class: 'dt-search', onClick: () => window.Insights.search() }, icon('search'),
          h('span', null, 'البحث في المشاريع، المهام، العملاء …'), h('kbd', { dir: 'ltr' }, 'Ctrl K')) : h('span'),
        h('span', { class: 'dt-gap' }),
        h('button', { type: 'button', class: 'dt-btn', 'aria-label': 'مساعدة', title: 'مساعدة', onClick: helpBox }, icon('help')),
        window.Collab ? window.Collab.bell('dt-btn dt-bell') : null,
        userMenu())
    ];
  }

  // زر + بالنص: أكثر ما يُنشأ أو يُبلَّغ عنه
  function plusSheet() {
    const item = (ico, title, sub, fn) => h('button', { type: 'button', class: 'sheet-item', onClick: () => { document.getElementById('dialog').close(); fn(); } },
      h('span', { class: 'si-ic', 'aria-hidden': 'true' }, ico), h('span', null, h('b', null, title), h('small', null, sub)));
    const items = [
      isStaff() ? item('🏗️', 'مشروع جديد', 'بيت، عمارة، مبنى، أو مجمّع سكني', newProject) : null,
      item('📷', 'تقرير مرحلة بصورة', isStaff() ? 'تقارير الفنيين والموافقة عليها' : 'بلّغ عن بدء أو إكمال مرحلة فرقتك', () => go(isStaff() ? 'reports' : 'home')),
      item('🔎', 'بحث عن مشروع', 'بالاسم أو العميل أو الهاتف', () => { go('projects'); setTimeout(() => document.querySelector('.pl-search')?.focus(), 400); }),
      isStaff() ? item('👷', 'فرقة أو مقاول', 'إضافة منفّذ جديد', () => go('crews')) : null
    ];
    modal('إضافة', h('div', { class: 'sheet-list' }, items), []);
  }

  // السحب للأسفل من أعلى الصفحة يعيد تحميل البيانات (مثل تطبيقات التواصل)
  function pullToRefresh() {
    let y0 = null, dy = 0;
    const tip = h('div', { class: 'ptr', 'aria-hidden': 'true' }, h('span', null, '↻'));
    document.body.appendChild(tip);
    window.addEventListener('touchstart', (e) => { y0 = window.scrollY <= 0 && !document.getElementById('dialog').open ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      tip.style.setProperty('--d', Math.min(dy, 110) + 'px');
      tip.classList.toggle('on', dy > 10); tip.classList.toggle('ready', dy > 80);
    }, { passive: true });
    window.addEventListener('touchend', async () => {
      if (y0 === null) return;
      const go2 = dy > 80; y0 = null; dy = 0;
      tip.classList.remove('ready');
      if (!go2 || !state.user) { tip.classList.remove('on'); return; }
      tip.classList.add('spin');
      try { await loadBase(); state.data = {}; await window.Reports?.reload?.(); render(); toast('تم التحديث'); } catch (e) { fail(e); }
      tip.classList.remove('spin', 'on');
    });
  }

  // النوافذ على الهاتف تطلع من الأسفل؛ سحبها لتحت يسكّرها
  function sheetDrag() {
    const dlg = document.getElementById('dialog');
    let y0 = null;
    dlg.addEventListener('touchstart', (e) => {
      const r = dlg.getBoundingClientRect();
      y0 = window.innerWidth <= 760 && e.touches[0].clientY - r.top < 56 ? e.touches[0].clientY : null;
    }, { passive: true });
    dlg.addEventListener('touchmove', (e) => { if (y0 !== null) dlg.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`; }, { passive: true });
    dlg.addEventListener('touchend', (e) => {
      if (y0 === null) return;
      const d = e.changedTouches[0].clientY - y0; y0 = null; dlg.style.transform = '';
      if (d > 90) dlg.close();
    });
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

  // كل مستخدم يغيّر كلمة مروره بنفسه، فلا تبقى الكلمة التي أرسلها المدير معروفة لغيره
  function changePassword() {
    const mk = (id, ac) => h('input', { type: 'password', id, dir: 'ltr', autocomplete: ac, maxlength: 72, required: true });
    const cur = mk('pw-cur', 'current-password'), nw = mk('pw-new', 'new-password'), again = mk('pw-again', 'new-password');
    const err = h('p', { class: 'err', role: 'alert' });
    modal('تغيير كلمة المرور', h('div', { class: 'stack' },
      field('كلمة المرور الحالية', cur),
      field('كلمة المرور الجديدة', nw, { hint: '8 أحرف على الأقل، فيها حروف إنجليزية وأرقام' }),
      field('أعد كتابة الجديدة', again), err),
    [{ label: 'حفظ', cls: 'primary', run: async () => {
      err.textContent = '';
      if (!strongEnough(nw.value)) { err.textContent = 'كلمة المرور الجديدة 8 أحرف على الأقل، وفيها حروف إنجليزية وأرقام'; return false; }
      if (nw.value !== again.value) { err.textContent = 'الكلمتان الجديدتان غير متطابقتين'; return false; }
      if (nw.value === cur.value) { err.textContent = 'اختر كلمة مختلفة عن الحالية'; return false; }
      // التأكد من الكلمة الحالية قبل التغيير، حتى لا يغيّرها من وجد الهاتف مفتوحاً
      const chk = await state.sb.auth.signInWithPassword({ email: state.user.email, password: cur.value });
      if (chk.error) { err.textContent = /Invalid login/i.test(chk.error.message) ? 'كلمة المرور الحالية غير صحيحة' : errText(chk.error); return false; }
      const { error } = await state.sb.auth.updateUser({ password: nw.value });
      if (error) { err.textContent = /weak|characters|short/i.test(error.message) ? 'كلمة المرور ضعيفة، اختر أقوى' : errText(error); return false; }
      toast('تم تغيير كلمة المرور');
      return true;
    } }]);
    setTimeout(() => cur.focus(), 0);
  }

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
  views.home = { title: 'مشاريع سرور', render: () => homeDash() };
  views.compounds = { title: 'المجمّعات السكنية', render: () => portfolio('compounds') };

  /* ---------- الرئيسية: كل مشاريع الشركة، كل مشروع سطر واحد بنسبة إنجازه ---------- */
  const DAY = 86400000;
  const daysSince = (x) => (x ? Math.floor((Date.now() - new Date(x).getTime()) / DAY) : null);
  const STALL_DAYS = 14;

  // ملخّص مشروع واحد: المجمّع من فحوصات وحداته، وغيره من مراحله
  function projInfo(p) {
    if (isCompound(p)) {
      const d = state.data[p.id];
      const D = F.dashboard(d, state.checkpoints);
      const rows = d.units.map((u) => F.row(u, state.checkpoints, openNcrsOf(d, u.id)));
      const today = todayStr();
      const fails = rows.filter((k) => k.R).length;
      const late = d.ncrs.filter((n) => n.status === 'open' && n.due_date && n.due_date < today).length;
      const status = D.B3 && D.B4 === D.B3 ? 'done' : D.B6 === D.B3 ? 'not_started' : 'in_progress';
      const why = [fails ? `${num(fails)} وحدة فيها فشل` : '', D.B8 ? `${num(D.B8)} تنبيه تسلسل` : '', D.B9 ? `${num(D.B9)} NCR مفتوحة` : '', late ? `${num(late)} متأخرة` : ''].filter(Boolean);
      const sc = schedule(p, D.B10, status);
      if (sc.late) why.unshift(`متأخر ${daysAr(-sc.daysLeft)} عن التسليم`); else if (sc.behind) why.unshift('متأخر عن الجدول');
      return { p, pct: D.B10, status, why, flag: why[0] || '', bad: !!(fails || D.B9 || sc.late), compound: true, sc, due: dueText(sc, status), fc: forecast(p, D.B10, status),
        now: `${unitCount(p, D.B3)} · المكتمل ${num(D.B4)} · الجاري ${num(D.B5)}`, curKey: null };
    }
    const sp = stageProgress(p);
    const idle = sp.status === 'in_progress' ? daysSince(sp.last) : null;
    const sc = schedule(p, sp.pct, sp.status);
    const why = [sc.late ? `متأخر ${daysAr(-sc.daysLeft)} عن التسليم` : '', sc.behind ? `متأخر عن الجدول (الإنجاز ${pctText(sp.pct)} والمتوقع ${pctText(sc.expected)})` : '',
      idle !== null && idle >= STALL_DAYS ? `لم يتحرك منذ ${daysAr(idle)}` : ''].filter(Boolean);
    const now = sp.status === 'done' ? 'اكتملت كل المراحل' : sp.cur
      ? `${sp.cur.s.status === 'in_progress' ? 'الآن' : 'التالية'}: ${sp.cur.c.name_ar} (${num(sp.cur.c.position)} من ${num(state.checkpoints.length)})` : '—';
    const flag = sc.late ? `متأخر ${daysAr(-sc.daysLeft)}` : sc.behind ? 'متأخر عن الجدول' : why.length ? 'متوقف' : '';
    return { p, pct: sp.pct, status: sp.status, why, flag, bad: sc.late, compound: false, now, fc: forecast(p, sp.pct, sp.status), curKey: sp.status === 'done' ? null : sp.cur?.c.key, sp, sc, due: dueText(sc, sp.status) };
  }

  /* ==========================================================
     الرئيسية بأسلوب تطبيقات التواصل: دوائر المشاريع فوق (مثل الستوري)،
     ثم بطاقات كبيرة تُمرَّر: ما يحتاج انتباهك، اليوم، المواعيد، المراحل، الفرق.
     كل رقم وكل دائرة يفتح القائمة أو المشروع.
     ========================================================== */
  const initials = (t) => String(t || '').trim().split(/\s+/).filter((w) => !/^(ال)?(مشروع|عمارة|بيت|دائرة|مجمع|مجمّع)$/.test(w)).slice(0, 2).map((w) => w.replace(/^ال/, '')[0] || '').join(' ') || '؟';
  const ringStyle = (pct) => ({ '--p': String(Math.round((pct || 0) * 100)) });

  /* ==========================================================
     لوحة التحكم (هوية سرور): ترحيب، أربع بطاقات أرقام، تقدم المشاريع،
     معدل الإنجاز الشهري، مشروع يحتاج متابعة، المواعيد، آخر النشاطات،
     نظرة سريعة، وجدول أبرز المشاريع. كل رقم يفتح القائمة مصفّاة.
     ========================================================== */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) el.setAttribute(k, String(v)); });
    kids.flat(Infinity).forEach((c) => { if (c === null || c === undefined) return; el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); });
    return el;
  }
  const DICONS = {
    layers: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5', 'M3 17.5l9 5 9-5'],
    play: ['M8 5v14l11-7z'],
    target: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 12l7-7', 'M16 5h3v3'],
    alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
    building: ['M4 21V5l8-3v19', 'M12 21V9l8 3v9', 'M2 21h20', 'M7 8h2', 'M7 12h2', 'M7 16h2', 'M15 14h2', 'M15 17h2'],
    calendar: ['M4 5h16v16H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
    pulse: ['M3 12h4l3-7 4 14 3-7h4'],
    up: ['M12 19V5', 'M6 11l6-6 6 6'],
    edit: ['M4 20h4L19 9l-4-4L4 16z'],
    check: ['M5 12l5 5 9-10'],
    chat: ['M4 5h16v11H8l-4 4z'],
    team: ['M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M2 21c0-4 3-6 7-6s7 2 7 6', 'M17 4a3.5 3.5 0 0 1 0 7', 'M19 15c2 .6 3 2.5 3 6'],
    tasks: ['M4 5h16v14H4z', 'M8 12l3 3 5-6'],
    helmet: ['M3 18h18', 'M5 18a7 7 0 0 1 14 0', 'M10 11V7h4v4'],
    arrow: ['M19 12H5', 'M11 6l-6 6 6 6'],
    chev: ['M15 6l-6 6 6 6']
  };
  const dIcon = (k, cls = 'dico') => sv('svg', { viewBox: '0 0 24 24', class: cls, 'aria-hidden': 'true' }, (DICONS[k] || []).map((d) => sv('path', { d })));
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const isoDay = (d) => d.toLocaleDateString('en-CA');

  // إنجاز كل المشاريع في نهاية يوم معيّن: المراحل من تواريخها، والمجمّع تقديراً خطياً من بدايته حتى نسبته اليوم
  function avgAt(rows, day) {
    const xs = [];
    rows.forEach((r) => {
      const born = (r.p.start_date || r.p.created_at || '').slice(0, 10);
      if (born && born > day) return;
      if (r.compound) {
        const t0 = new Date(born || todayStr()).getTime(), t1 = Date.now(), t = new Date(day + 'T23:59:59').getTime();
        xs.push(t1 > t0 ? r.pct * Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : r.pct);
        return;
      }
      const sp = Core.progress(state.checkpoints, (key) => {
        const s = stageOf(r.p, key);
        if (s.status === 'na') return s;
        if (s.status === 'done' && s.end_date && s.end_date <= day) return s;
        if ((s.status === 'done' || s.status === 'in_progress') && s.start_date && s.start_date <= day) return { ...s, status: 'in_progress' };
        return { ...s, status: 'not_started' };
      });
      xs.push(sp.pct);
    });
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  }

  function lineChart(pts) {
    const W = 360, H = 172, L = 36, R = 30, T = 26, B = 28;
    const top = Math.max(...pts.map((p) => p.v));
    const stepV = top <= 0.4 ? 0.1 : 0.2;
    const max = Math.max(stepV, Math.ceil(top / stepV - 1e-9) * stepV);
    const x = (i) => L + 18 + (i * (W - L - R - 18)) / Math.max(1, pts.length - 1);   // الزمن من اليسار لليمين مثل محور المخططات
    const y = (v) => T + (1 - v / max) * (H - T - B);
    const steps = Math.round(max / stepV), grid = [];
    for (let k = 0; k <= steps; k++) {
      const v = (max * k) / steps;
      grid.push(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'lc-grid' }),
        sv('text', { x: L - 6, y: y(v) + 4, class: 'lc-ax', 'text-anchor': 'end' }, Math.round(v * 100) + '%'));
    }
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = d + ` L${x(pts.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
    const last = pts.length - 1, lx = x(last), ly = y(pts[last].v);
    const label = Math.round(pts[last].v * 1000) / 10 + '%';
    return sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'lc', role: 'img', 'aria-label': 'معدل الإنجاز شهرياً: ' + pts.map((p) => `${p.m} ${Math.round(p.v * 1000) / 10}%`).join('، ') },
      sv('defs', null, sv('linearGradient', { id: 'lcFill', x1: 0, x2: 0, y1: 0, y2: 1 }, sv('stop', { offset: '0', class: 'lc-s0' }), sv('stop', { offset: '1', class: 'lc-s1' }))),
      grid, sv('path', { d: area, fill: 'url(#lcFill)' }), sv('path', { d, class: 'lc-line' }),
      pts.map((p, i) => [sv('circle', { cx: x(i), cy: y(p.v), r: i === last ? 6 : 4, class: i === last ? 'lc-dot now' : 'lc-dot' }),
        sv('text', { x: x(i), y: H - 6, class: 'lc-ax', 'text-anchor': 'middle' }, p.m)]),
      sv('rect', { x: Math.min(W - 62, lx - 30), y: Math.max(0, ly - 32), width: 60, height: 22, rx: 6, class: 'lc-tip' }),
      sv('text', { x: Math.min(W - 32, lx), y: Math.max(0, ly - 32) + 15, class: 'lc-tipt', 'text-anchor': 'middle' }, label));
  }

  function donut(parts, centerTop, centerSub) {
    const total = parts.reduce((a, p) => a + p.n, 0) || 1, C = 2 * Math.PI * 42;
    let off = 0;
    return sv('svg', { viewBox: '0 0 120 120', class: 'dnut', role: 'img', 'aria-label': parts.map((p) => `${p.label} ${p.n}`).join('، ') },
      sv('circle', { cx: 60, cy: 60, r: 42, class: 'dn-track' }),
      parts.filter((p) => p.n).map((p) => {
        const len = (p.n / total) * C;
        const el = sv('circle', { cx: 60, cy: 60, r: 42, class: 'dn-seg ' + p.cls, 'stroke-dasharray': `${len} ${C - len}`, 'stroke-dashoffset': -off, transform: 'rotate(-90 60 60)' });
        off += len; return el;
      }),
      sv('text', { x: 60, y: 60, class: 'dn-big', 'text-anchor': 'middle' }, centerTop),
      sv('text', { x: 60, y: 78, class: 'dn-sub', 'text-anchor': 'middle' }, centerSub));
  }

  async function homeDash() {
    await Promise.all([...state.projects.filter(isCompound).map((p) => loadProject(p.id)), window.Tasks ? window.Tasks.ensure() : null]);
    const openList = (patch) => { state._pf = { ...PF_DEFAULT, ...patch }; go('projects'); };
    const rows = state.projects.map(projInfo);
    const by = (st) => rows.filter((r) => r.status === st).length;
    const attn = rows.filter((r) => r.why.length).sort((a, b) => (b.bad - a.bad) || (b.why.length - a.why.length));
    const avg = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0;
    const cpN = Object.fromEntries(state.checkpoints.map((c) => [c.key, c]));
    const card = (cls, ...kids) => h('section', { class: 'dc ' + cls }, ...kids);
    const head = (ic, title, extra) => h('header', { class: 'dc-h' }, h('h2', null, dIcon(ic, 'dico h'), title), extra || null);

    // ---- الترحيب
    const hr = new Date().getHours();
    const first = (state.profile?.full_name || '').split(' ')[0];
    const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const hero = h('header', { class: 'd-hero' },
      h('div', { class: 'dh-text' }, h('h1', null, (hr < 12 ? 'صباح الخير' : 'مساء الخير') + (first ? '، ' + first : '')),
        h('p', null, rows.length ? 'إدارة مشاريعك ومتابعة الإنجاز والمواعيد بكل كفاءة' : 'لا توجد مشاريع بعد. أضف أول مشروع لتبدأ المتابعة.'),
        isStaff() ? h('div', { class: 'dh-acts' },
          h('button', { type: 'button', class: 'btn primary sm', onClick: newProject }, '+ مشروع جديد'),
          window.Plan && rows.length ? h('button', { type: 'button', class: 'btn sm', onClick: () => window.Plan.brief() }, 'ملخّص الصباح') : null) : null),
      h('a', { href: '#/calendar', class: 'dh-date' }, dIcon('calendar'), h('span', null, today), dIcon('chev', 'dico sm')));

    // ---- بطاقات الأرقام
    const U = (n) => (n === 1 ? 'مشروع' : n === 2 ? 'مشروعان' : n >= 3 && n <= 10 ? 'مشاريع' : 'مشروعاً');
    const kpi = (cls, ic, label, value, unit, patch) => h('button', { type: 'button', class: 'kpi ' + cls, onClick: () => openList(patch) },
      h('span', { class: 'kpi-ic' }, dIcon(ic)), h('span', { class: 'kpi-t' }, h('span', { class: 'kpi-l' }, label), h('b', null, value), unit ? h('small', null, unit) : null));
    const kpis = h('div', { class: 'kpis' },
      kpi('k-all', 'layers', 'إجمالي المشاريع', num(rows.length), U(rows.length), {}),
      kpi('k-run', 'play', 'المشاريع الجارية', num(by('in_progress')), U(by('in_progress')), { st: 'in_progress' }),
      kpi('k-avg', 'target', 'متوسط الإنجاز', pctText(avg), null, {}),
      kpi('k-attn', 'alert', 'تحتاج إلى متابعة', num(attn.length), U(attn.length), { st: 'attn' }));

    // ---- تقدم المشاريع (حلقة)
    const late = rows.filter((r) => r.status !== 'done' && (r.sc?.late || r.sc?.behind)).length;
    const parts = [
      { label: 'مكتملة', n: by('done'), cls: 'done', st: 'done' },
      { label: 'جارية', n: rows.filter((r) => r.status === 'in_progress' && !(r.sc?.late || r.sc?.behind)).length, cls: 'run', st: 'in_progress' },
      { label: 'متأخرة', n: late, cls: 'late', st: 'behind' },
      { label: 'لم تبدأ', n: rows.filter((r) => r.status === 'not_started' && !(r.sc?.late || r.sc?.behind)).length, cls: 'idle', st: 'not_started' }];
    const share = (n) => pctText(rows.length ? n / rows.length : 0);
    const progCard = card('d-prog', head('calendar', 'تقدم المشاريع'),
      h('div', { class: 'dp-body' },
        h('ul', { class: 'dp-legend' }, parts.map((p) => h('li', null, h('button', { type: 'button', onClick: () => openList({ st: p.st }) },
          h('i', { class: p.cls }), h('span', null, p.label), h('b', null, share(p.n)))))),
        donut(parts, Math.round(avg * 1000) / 10 + '%', 'متوسط الإنجاز')));

    // ---- معدل الإنجاز آخر خمسة أشهر
    const now = new Date(), pts = [];
    for (let k = 4; k >= 0; k--) {
      const end = k ? new Date(now.getFullYear(), now.getMonth() - k + 1, 0) : now;
      pts.push({ m: MONTHS[end.getMonth()], v: avgAt(rows, isoDay(end)) });
    }
    const diff = pts[4].v - pts[3].v;
    const rateCard = card('d-rate', head('pulse', 'معدل إنجاز المشاريع',
      h('span', { class: 'chg ' + (diff >= 0 ? 'up' : 'down') }, h('b', null, (diff >= 0 ? '↑ +' : '↓ ') + Math.round(Math.abs(diff) * 1000) / 10 + '%'), h('small', null, 'مقارنة بالشهر الماضي'))),
      rows.length ? lineChart(pts) : h('p', { class: 'muted calm' }, 'يظهر المخطط بعد إضافة المشاريع.'));

    // ---- مشروع يحتاج متابعة
    const a = attn[0];
    const attnCard = a ? card('d-attn', h('span', { class: 'da-tag' }, dIcon('alert', 'dico sm'), attn.length > 1 ? `${num(attn.length)} مشاريع تحتاج إلى متابعة` : 'مشروع يحتاج إلى متابعة'),
      h('div', { class: 'da-head' }, h('span', { class: 'da-ic' }, dIcon('building')),
        h('div', null, h('b', null, a.p.client), h('small', null, 'معدل الإنجاز: ', h('strong', null, pctText(a.pct))))),
      h('div', { class: 'da-bar' }, h('span', { style: { width: Math.max(2, a.pct * 100).toFixed(1) + '%' } })),
      h('p', { class: 'da-why' }, a.why[0]),
      h('p', { class: 'da-now' }, dIcon('layers', 'dico sm'), a.now),
      h('a', { href: '#/project/' + a.p.id, class: 'btn primary block' }, 'فتح المشروع', dIcon('arrow', 'dico sm')))
      : card('d-attn calm', h('span', { class: 'da-ic ok' }, dIcon('check')), h('b', null, 'كل المشاريع على ما يرام'), h('p', { class: 'muted' }, 'لا مشاريع متأخرة أو متوقفة الآن.'));

    // ---- المواعيد القادمة
    const dues = rows.filter((r) => r.sc?.has && r.status !== 'done').sort((x, y) => x.sc.daysLeft - y.sc.daysLeft);
    const duesCard = card('d-dues', head('calendar', 'المواعيد القادمة', h('a', { href: '#/calendar', class: 'dc-more' }, 'التقويم')),
      dues.length ? h('ol', { class: 'dd-list' }, dues.slice(0, 3).map((r) => {
        const d = new Date(r.p.due_date + 'T00:00:00'); const ok = !r.sc.late && !r.sc.behind;
        return h('li', null, h('a', { href: '#/project/' + r.p.id },
          h('span', { class: 'dd-date' + (r.sc.late ? ' bad' : '') }, h('b', null, String(d.getDate())), h('small', null, MONTHS[d.getMonth()])),
          h('span', { class: 'dd-main' }, h('b', null, r.p.client), h('small', null, r.due)),
          h('span', { class: 'dd-st ' + (ok ? 'ok' : r.sc.late ? 'bad' : 'warn'), title: ok ? 'على الموعد' : 'متأخر' }, ok ? dIcon('check', 'dico sm') : null)));
      })) : h('p', { class: 'muted calm' }, 'لا توجد مواعيد تسليم. أضفها من بيانات المشروع.'));

    // ---- آخر النشاطات: تحديثات المراحل وتقارير الفنيين
    const acts = [];
    state.projects.forEach((p) => Object.values(state.stages[p.id] || {}).forEach((x) => {
      if (x.updated_at && x.status !== 'not_started') acts.push({ at: x.updated_at, p, ic: x.status === 'done' ? 'check' : 'edit', cls: x.status === 'done' ? 'ok' : 'run',
        t: `${x.status === 'done' ? 'اكتملت' : x.status === 'na' ? 'لا تنطبق' : 'بدأت'} مرحلة ${cpN[x.checkpoint]?.name_ar || ''}` });
    }));
    (state.requests || []).forEach((q) => { const p = state.projects.find((y) => y.id === q.project_id); if (p && q.requested_at) acts.push({ at: q.requested_at, p, ic: 'chat', cls: 'msg', t: `تقرير فني: ${q.action === 'done' ? 'اكتمال' : 'بدء'} ${cpN[q.checkpoint]?.name_ar || ''}` }); });
    acts.sort((x, y) => (x.at < y.at ? 1 : -1));
    const when = (s) => { const d = new Date(s); return isoDay(d) === todayStr() ? d.toTimeString().slice(0, 5) : `${d.getDate()} ${MONTHS[d.getMonth()]}`; };
    const actCard = card('d-act', head('pulse', 'آخر النشاطات'),
      acts.length ? h('ol', { class: 'da-list' }, acts.slice(0, 4).map((x) => h('li', null, h('a', { href: '#/project/' + x.p.id },
        h('span', { class: 'dl-ic ' + x.cls }, dIcon(x.ic, 'dico sm')), h('span', { class: 'dl-main' }, h('b', null, x.p.client), h('small', null, x.t)),
        h('time', { dir: 'ltr' }, when(x.at))))))
        : h('p', { class: 'muted calm' }, 'لا نشاطات بعد.'));

    // ---- نظرة سريعة
    const crewsActive = state.crews.filter((c) => c.active);
    const tile = (cls, ic, n, label, href) => h('a', { href, class: 'qt ' + cls }, h('span', { class: 'qt-ic' }, dIcon(ic)), h('b', null, num(n)), h('small', null, label));
    const openTasks = (state.tasks || []).filter((t) => t.status !== 'done').length;
    const quick = card('d-quick', head('layers', 'نظرة سريعة'), h('div', { class: 'qt-grid' },
      tile('q1', 'team', crewsActive.filter((c) => c.kind !== 'contractor').length, 'الفرق', '#/crews'),
      tile('q2', 'building', state.projects.filter(isCompound).length, 'المجمعات السكنية', '#/compounds'),
      tile('q3', 'tasks', openTasks, 'المهام المفتوحة', '#/tasks'),
      tile('q4', 'helmet', crewsActive.filter((c) => c.kind === 'contractor').length, 'المقاولون', '#/crews')));

    // ---- أبرز المشاريع
    const top = [...rows].sort((x, y) => (y.why.length > 0) - (x.why.length > 0) || ({ in_progress: 0, not_started: 1, done: 2 }[x.status] - { in_progress: 0, not_started: 1, done: 2 }[y.status]) || y.pct - x.pct).slice(0, 6);
    const crewName = (r) => { const s = r.sp?.cur?.s; const c = s?.crew_id ? crewOf(s.crew_id) : null; return c ? c.name : '—'; };
    const table = card('d-top', head('layers', 'أبرز المشاريع', h('a', { href: '#/projects', class: 'btn primary sm' }, 'عرض جميع المشاريع', dIcon('arrow', 'dico sm'))),
      rows.length ? h('div', { class: 'dt-wrap' }, h('table', { class: 'dt' },
        h('thead', null, h('tr', null, ['المشروع', 'العميل', 'المدينة', 'المرحلة الحالية', 'المنفّذ', 'معدل الإنجاز', ''].map((t) => h('th', null, t)))),
        h('tbody', null, top.map((r) => h('tr', { onClick: () => go('project/' + r.p.id) },
          h('td', { class: 'dt-name' }, h('span', { class: 'dt-ic' }, dIcon('building', 'dico sm')), h('a', { href: '#/project/' + r.p.id }, r.p.client)),
          h('td', { 'data-l': 'العميل' }, r.p.customer_name || '—'),
          h('td', { 'data-l': 'المدينة' }, r.p.city || r.p.governorate || '—'),
          h('td', { 'data-l': 'المرحلة' }, h('span', { class: 'dt-stage ' + (r.why.length ? 'warn' : r.status) }, r.now)),
          h('td', { 'data-l': 'المنفّذ' }, crewName(r)),
          h('td', { class: 'dt-pct' }, h('span', { class: 'dt-bar' }, h('i', { style: { width: Math.max(2, r.pct * 100).toFixed(1) + '%' } })), h('b', null, pctText(r.pct))),
          h('td', { class: 'dt-go' }, dIcon('chev', 'dico sm'))))))) : h('p', { class: 'muted calm' }, 'لا توجد مشاريع بعد.'));

    const reqs = window.Reports ? window.Reports.homeBox() : null;
    const tasksBox = window.Tasks ? window.Tasks.homeBox() : null;
    const insights = window.Insights ? window.Insights.homeBoxes(rows) : null;
    const extra = [reqs, tasksBox].filter(Boolean).map((x) => h('div', { class: 'dc d-extra' }, x));

    return h('div', { class: 'dash' }, hero, kpis,
      h('div', { class: 'd-row r1' }, attnCard, rateCard, progCard),
      h('div', { class: 'd-row r2' }, quick, actCard, duesCard),
      extra.length ? h('div', { class: 'd-row r3' }, extra) : null,
      table,
      insights ? h('div', { class: 'dc d-extra' }, insights) : null);
  }

  /* ---------- صفحة المشاريع: جدول ببحث وترتيب وتصفية ---------- */
  const PF_DEFAULT = { q: '', st: '', gov: '', brand: '', type: '', crew: '', sort: 'status', dir: 1 };
  // توحيد الحروف للبحث: أ إ آ ← ا، ة ← ه، ى ← ي، وحذف التشكيل والتطويل

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
        const crews = [...new Set([...Object.values(state.stages[p.id] || {}).map((x) => x.crew_id),
          ...state.crewUnits.filter((x) => x.project_id === p.id).map((x) => x.crew_id)].filter(Boolean))];
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
        if (F0.st && (F0.st === 'late' ? !r.late : F0.st === 'overdue' ? !r.sc?.late : F0.st === 'behind' ? !(r.sc?.behind && !r.sc?.late) : F0.st === 'attn' ? !r.why.length : r.status !== F0.st)) return false;
        if (F0.gov && (F0.gov === '-' ? r.p.governorate : r.p.governorate !== F0.gov)) return false;
        if (F0.brand && (r.p.brand || 'غير محددة') !== F0.brand) return false;
        if (F0.type && (r.compound ? 'compound' : r.p.project_type) !== F0.type) return false;
        if (F0.crew && !r.crews.includes(F0.crew)) return false;
        if (F0.q) {
          const words = norm(F0.q).split(' ').filter(Boolean);
          const dq = digits(F0.q);
          const phoneHit = dq.length >= 4 && r.phone.includes(dq);
          // الكلمات غير الرقمية تبقى شرطاً حتى مع تطابق الهاتف ("البصرة 0770" لا يُظهر مشروع بغداد)
          const textWords = words.filter((w) => !/^[0-9٠-٩۰-۹+\-()]+$/.test(w));
          if (phoneHit ? !textWords.every((w) => r.hay.includes(w)) : !words.every((w) => r.hay.includes(w))) return false;
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
        return h('tr', { class: 'pl-row' + (r.sc?.late ? ' late' : '') },
          h('td', { class: 'c-name' }, h('a', { href: '#/project/' + p.id, class: 'pl-link' },
            h('span', { class: 'st-ring xs ' + (r.sc?.late || r.bad ? 'bad' : r.why.length ? 'warn' : r.status), style: ringStyle(r.pct), 'aria-hidden': 'true' }, h('span', { class: 'st-face' }, h('b', null, initials(p.client)))),
            h('b', null, mark(p.client))),
            h('small', null, [r.compound ? PTYPES.compound : PTYPES[p.project_type], p.brand].filter(Boolean).join(' · '))),
          h('td', { class: 'c-cust', 'data-l': 'العميل' }, p.customer_name ? [mark(p.customer_name), p.customer_phone ? h('small', { dir: 'ltr' }, p.customer_phone) : null] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'c-gov', 'data-l': 'المحافظة' }, p.governorate ? [p.governorate, p.city ? h('small', null, p.city) : null] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'c-stage', 'data-l': 'المرحلة' }, h('span', { class: r.status === 'done' ? 'ok-text' : '' }, r.now),
            r.flag ? h('span', { class: 'chip ' + (r.bad ? 'st-has-failure' : 'warn-chip'), title: r.why.join('، ') }, r.flag) : null),
          h('td', { class: 'c-crew', 'data-l': 'المنفّذ' }, r.crew ? [h('small', { class: 'kind-tag ' + r.crew.kind }, KIND_AR[r.crew.kind]), r.crew.name] : h('span', { class: 'muted' }, '—')),
          h('td', { class: 'c-pct', 'data-l': 'الإنجاز' }, h('span', { class: 'pj-prog' }, h('span', { class: 'st-bar' }, h('span', { style: { width: (r.pct * 100).toFixed(1) + '%' } })), h('b', null, pctText(r.pct)))),
          h('td', { class: 'c-due' + (r.sc?.late ? ' late' : ''), 'data-l': 'التسليم' }, p.due_date ? [h('span', { dir: 'ltr' }, p.due_date), h('small', null, r.due)] : h('span', { class: 'muted' }, '—')));
      };
      let shown = [];
      const draw = () => {
        const list = rows.filter(hit).sort((a, b) => SORTS[F0.sort](a, b) * F0.dir);
        shown = list;
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
        sel('st', 'كل الحالات', [['in_progress', 'جارية'], ['not_started', 'لم تبدأ'], ['done', 'مكتملة'], ['overdue', 'فات موعدها'], ['behind', 'متأخرة عن الجدول'], ['late', 'كل المتأخرة'], ['attn', 'تحتاج انتباهك']]),
        sel('gov', 'كل المحافظات', [...GOVS.map(([g]) => [g, g]).sort((a, b) => a[0].localeCompare(b[0], 'ar')), ['-', 'بلا محافظة']]),
        sel('brand', 'كل الماركات', [...brands.map((b) => [b, b]), ...(rows.some((r) => !r.p.brand) ? [['غير محددة', 'غير محددة']] : [])]),
        sel('type', 'كل الأنواع', Object.entries(PTYPES)),
        sel('crew', 'كل المنفّذين', state.crews.map((c) => [c.id, `${c.name} (${KIND_AR[c.kind]})`]))
      ];
      const reset = () => { Object.assign(F0, PF_DEFAULT, { sort: F0.sort, dir: F0.dir }); render(); };
      const clearBtn = h('button', { type: 'button', class: 'btn ghost sm', onClick: reset }, 'مسح التصفية');
      draw();
      // "/" يركّز البحث (مثل أغلب التطبيقات)
      const onKey = (e) => { if (e.key === '/' && location.hash.startsWith('#/projects') && search.isConnected && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); search.focus(); } };
      document.removeEventListener('keydown', state._plKey || (() => {})); state._plKey = onKey; document.addEventListener('keydown', onKey);
      return h('div', { class: 'stack plist' },
        h('div', { class: 'row between' }, h('h1', null, 'المشاريع'),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn', title: 'تنزيل المشاريع الظاهرة كملف Excel', onClick: (e) => exportProjects(shown, rows, F0, e.currentTarget) }, 'تصدير Excel'),
            isStaff() ? h('button', { type: 'button', class: 'btn primary', onClick: newProject }, '+ مشروع جديد') : null)),
        h('div', { class: 'pl-tools' }, h('div', { class: 'pl-search-wrap' }, search), h('div', { class: 'pl-filters' }, filters, clearBtn)),
        count,
        h('div', { class: 'pl-table-wrap' }, h('table', { class: 'pl-table' }, h('caption', { class: 'sr-only' }, 'قائمة المشاريع. اضغط عنوان أي عمود للترتيب.'), h('thead', null, head), tbody)));
    }
  };

  /* ---------- تصدير المشاريع إلى Excel ----------
     خمس أوراق: الملخّص، المشاريع، مراحل المشاريع (جدول)، تفاصيل المراحل، الفرق والمقاولون.
     يصدّر المشاريع الظاهرة حسب البحث والتصفية، ويكتب التصفية في الملخّص. */
  function exportProjects(list, all, F0, btn) {
    const X = window.XLSX_LITE;
    if (!list.length) return toast('لا توجد مشاريع ظاهرة للتصدير. امسح التصفية أولاً.', 'error');
    if (btn) btn.disabled = true;
    try {
      const cps = state.checkpoints;
      const ST = { not_started: 'لم تبدأ', in_progress: 'جارية', done: 'مكتملة', na: 'لا تنطبق' };
      const PST = { not_started: 'لم يبدأ', in_progress: 'جارٍ', done: 'مكتمل' };
      // تاريخ نصي ← رقم تاريخ Excel حقيقي (حتى يُرتَّب ويُحسب)
      const d = (x) => { if (!x) return ''; const [y, m, dd] = String(x).slice(0, 10).split('-').map(Number); return { v: (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000, s: 'date' }; };
      const H = (t) => ({ v: t, s: 'header' });
      const today = todayStr();
      const statusCF = (ref) => ({ sqref: ref, rules: [{ dxf: 0, formula: '"مكتملة"' }, { dxf: 2, formula: '"جارية"' }, { dxf: 3, formula: '"لا تنطبق"' }, { dxf: 0, formula: '"مكتمل"' }, { dxf: 2, formula: '"جارٍ"' }] });

      // ---- الملخّص
      const n = (fn) => list.filter(fn).length;
      const late = (r) => !!(r.sc && (r.sc.late || r.sc.behind));
      const desc = [F0.q ? `بحث: ${F0.q}` : '', F0.st ? `الحالة: ${{ in_progress: 'جارية', not_started: 'لم تبدأ', done: 'مكتملة', late: 'متأخرة', attn: 'تحتاج انتباهك' }[F0.st]}` : '',
        F0.gov ? `المحافظة: ${F0.gov === '-' ? 'بلا محافظة' : F0.gov}` : '', F0.brand ? `الماركة: ${F0.brand}` : '', F0.type ? `النوع: ${PTYPES[F0.type]}` : '',
        F0.crew ? `المنفّذ: ${crewOf(F0.crew)?.name || ''}` : ''].filter(Boolean).join('، ');
      const sumRows = [
        [{ v: 'مصاعد السرور - تقرير المشاريع', s: 'title' }],
        ['تاريخ التصدير', d(today)],
        ['المشاريع في الملف', desc ? `${list.length} من ${all.length} (${desc})` : `كل المشاريع (${all.length})`],
        [],
        [H('المؤشر'), H('العدد')],
        ['المشاريع', list.length], ['جارية', n((r) => r.status === 'in_progress')], ['مكتملة', n((r) => r.status === 'done')],
        ['لم تبدأ', n((r) => r.status === 'not_started')], ['متأخرة (فات التسليم أو متأخرة عن الجدول)', n(late)], ['تحتاج انتباهك', n((r) => r.why.length)],
        ['متوسط الإنجاز', { v: list.reduce((a, r) => a + r.pct, 0) / list.length, s: 'pct' }],
        [],
        [{ v: 'التعريفات', s: 'header' }, { v: '', s: 'header' }],
        ['الإنجاز', 'المراحل المكتملة ÷ المراحل التي تنطبق (13 ناقص "لا تنطبق"). للمجمّع: نسبة فحوصات الوحدات الناجحة.'],
        ['متأخر', 'فات تاريخ التسليم والمشروع لم يكتمل.'],
        ['متأخر عن الجدول', `الإنجاز أقل من نسبة الوقت المنقضي (من البدء المخطط إلى التسليم) بـ${BEHIND_GAP * 100} نقطة أو أكثر.`]
      ];

      // ---- المشاريع (الإنجاز بمعادلة حقيقية للمشاريع العادية)
      const pHead = ['المشروع', 'النوع', 'المحافظة', 'المدينة', 'الماركة', 'العميل', 'هاتف العميل', 'عنوان الموقع', 'رابط الخريطة', 'تاريخ العقد',
        'البدء المخطط', 'التسليم', 'حالة المشروع', 'المرحلة الحالية', 'المنفّذ الحالي', 'مراحل مكتملة', 'مراحل تنطبق', 'الإنجاز', 'المتوقع حسب الوقت', 'الموعد', 'أيام (+ متبقية / − تأخير)', 'يحتاج انتباهاً'];
      const projRows = [pHead.map(H)];
      list.forEach((r, i) => {
        const p = r.p, row = i + 2;
        const cur = r.sp?.cur && r.status !== 'done' ? r.sp.cur : null;
        const crew = cur?.s.crew_id ? crewOf(cur.s.crew_id) : null;
        const sc = r.sc || {};
        projRows.push([
          p.client, r.compound ? PTYPES.compound : PTYPES[p.project_type] || '', p.governorate || '', p.city || '', p.brand || '',
          p.customer_name || '', p.customer_phone || '', p.site_address || '', p.map_url || '', d(p.contract_date), d(p.start_date), d(p.due_date),
          PST[r.status], r.compound ? r.now : (r.status === 'done' ? 'اكتملت كل المراحل' : cur ? cur.c.name_ar : ''), crew ? `${crew.name} (${KIND_AR[crew.kind]})` : '',
          r.compound ? '' : r.sp.done, r.compound ? '' : r.sp.total,
          r.compound ? { v: r.pct, s: 'pct' } : { f: `IFERROR(P${row}/Q${row},0)`, v: r.pct, s: 'pct' },
          sc.expected != null ? { v: sc.expected, s: 'pct' } : '',
          !sc.has ? '' : r.status === 'done' ? 'مكتمل' : sc.late ? 'متأخر' : sc.behind ? 'متأخر عن الجدول' : 'حسب الجدول',
          sc.has && r.status !== 'done' ? { f: `IF(L${row}="","",L${row}-TODAY())`, v: sc.daysLeft } : '',
          r.why.join('، ')
        ]);
      });
      const lastP = list.length + 1;

      // ---- مراحل المشاريع: سطر لكل مشروع وعمود لكل مرحلة
      const plain = list.filter((r) => !r.compound);
      const matRows = [[H('المشروع'), ...cps.map((c) => H(`${c.position}. ${c.name_ar}`)), H('الإنجاز')]];
      plain.forEach((r, i) => {
        const row = i + 2;
        matRows.push([r.p.client, ...cps.map((c) => ST[stageOf(r.p, c.key).status]),
          { f: `IFERROR(COUNTIF(B${row}:${X.colName(cps.length)}${row},"مكتملة")/(${cps.length}-COUNTIF(B${row}:${X.colName(cps.length)}${row},"لا تنطبق")),0)`, v: r.pct, s: 'pct' }]);
      });
      if (plain.length) {
        const row = plain.length + 2;
        matRows.push([{ v: 'المكتملة من كل مرحلة', s: 'header' }, ...cps.map((c, j) => ({ f: `COUNTIF(${X.colName(j + 1)}2:${X.colName(j + 1)}${row - 1},"مكتملة")`, v: plain.filter((r) => stageOf(r.p, c.key).status === 'done').length, s: 'calc' })), '']);
      }

      // ---- تفاصيل المراحل: سطر لكل مرحلة بدأت أو أُسندت
      const detRows = [['المشروع', 'رقم', 'المرحلة', 'الحالة', 'تاريخ البدء', 'تاريخ الانتهاء', 'المدة (أيام)', 'المنفّذ', 'نوع المنفّذ', 'الكوادر', 'ملاحظات'].map(H)];
      plain.forEach((r) => cps.forEach((c) => {
        const x = stageOf(r.p, c.key);
        if (x.status === 'not_started' && !x.crew_id && !x.notes) return;
        const row = detRows.length + 1, crew = crewOf(x.crew_id);
        detRows.push([r.p.client, c.position, c.name_ar, ST[x.status], d(x.start_date), d(x.end_date),
          x.start_date && x.end_date ? { f: `IF(AND(E${row}<>"",F${row}<>""),F${row}-E${row}+1,"")`, v: dayDiff(x.end_date, x.start_date) + 1 } : '',
          crew?.name || '', crew ? KIND_AR[crew.kind] : '', x.crew ?? '', x.notes ? { v: x.notes, s: 'wrap' } : '']);
      }));

      // ---- الفرق والمقاولون (على كل المشاريع، لأن الأداء لا يُقاس على جزء)
      const crewRows = [['الاسم', 'النوع', 'الرئيس / المسؤول', 'الهاتف', 'المحافظات', 'فعّال', 'مراحل مكتملة', 'مراحل جارية', 'مشاريع', 'متوسط أيام المرحلة', 'اكتملت بعد موعد التسليم', 'يعمل الآن في', 'وحدات المجمّعات', 'وحدات مكتملة', 'وحدات فيها فشل'].map(H)];
      const cpN = Object.fromEntries(cps.map((c) => [c.key, c.name_ar]));
      state.crews.forEach((c) => {
        const st = crewStats(c);
        crewRows.push([c.name, KIND_AR[c.kind], c.leader || '', c.phone || '', (c.governorates || []).join('، '), c.active ? 'نعم' : 'لا',
          st.done, st.ip, st.projects.size, st.avg === null ? '' : Math.round(st.avg * 10) / 10, st.afterDue,
          st.at.map((w) => `${w.p.client} (${cpN[w.x.checkpoint]})`).join('، '), st.units.n, st.units.done, st.units.fail]);
      });

      const sheets = [
        { name: 'الملخص', rows: sumRows, opts: { rtl: true, widths: [44, 90] } },
        { name: 'المشاريع', rows: projRows, opts: { rtl: true, freezeRow: 1, freezeCol: 1, autoFilter: `A1:${X.colName(pHead.length - 1)}${lastP}`,
          widths: [30, 14, 12, 14, 10, 24, 15, 30, 26, 12, 12, 12, 11, 24, 26, 10, 10, 10, 12, 16, 14, 40],
          cf: [statusCF(`M2:M${lastP}`), { sqref: `T2:T${lastP}`, rules: [{ dxf: 1, formula: '"متأخر"' }, { dxf: 2, formula: '"متأخر عن الجدول"' }, { dxf: 0, formula: '"مكتمل"' }] }] } }
      ];
      if (plain.length) {
        sheets.push({ name: 'مراحل المشاريع', rows: matRows, opts: { rtl: true, freezeRow: 1, freezeCol: 1, widths: [30, ...cps.map(() => 13), 10],
          cf: [statusCF(`B2:${X.colName(cps.length)}${plain.length + 1}`)] } });
        sheets.push({ name: 'تفاصيل المراحل', rows: detRows, opts: { rtl: true, freezeRow: 1, autoFilter: `A1:K${detRows.length}`, widths: [30, 6, 22, 11, 12, 12, 11, 24, 14, 9, 40],
          cf: [statusCF(`D2:D${detRows.length}`)] } });
      }
      sheets.push({ name: 'الفرق والمقاولون', rows: crewRows, opts: { rtl: true, freezeRow: 1, autoFilter: `A1:O${crewRows.length}`, widths: [26, 14, 20, 15, 24, 7, 12, 12, 9, 16, 20, 40, 14, 13, 15] } });

      download(X.writeWorkbook(sheets), `sorror-projects-${today}.xlsx`);
      toast(`تم تنزيل ${list.length === all.length ? 'كل المشاريع' : `${num(list.length)} من ${cntAr(all.length, 'مشروع واحد', 'مشروعين', 'مشاريع', 'مشروعاً')}`}`);
    } catch (e) { fail(e); }
    finally { if (btn) btn.disabled = false; }
  }

  // أرقام قسم المجمّعات: مجمّع واحد ← متابعة وحداته مصفّاة، وأكثر ← قائمة المجمّعات
  function compoundDrill(rows, st) {
    const has = st === 'Has failure' ? (r) => r.D.B7 : st === 'alert' ? (r) => r.D.B8 : st === 'ncr' ? (r) => r.D.B9 : st === 'Complete' ? (r) => r.D.B4 : () => true;
    const target = rows.length === 1 ? rows[0] : rows.filter(has).length === 1 ? rows.filter(has)[0] : null;
    if (st && target) {
      if (st === 'ncr') { state._nf = { status: 'open' }; return go(`project/${target.p.id}/ncr`); }
      (state._tfBy ||= {})[target.p.id] = { q: '', zone: '', crew: '', status: st === 'all' ? '' : st, next: '', sort: 'code' };
      return go(`project/${target.p.id}/tracker`);
    }
    state._pf = { ...PF_DEFAULT, type: 'compound', st: ['Has failure', 'alert', 'ncr'].includes(st) ? 'attn' : '' };
    go('projects');
  }

  // لوحة مجموعة مشاريع: كل الشركة، أو المجمّعات السكنية فقط
  async function portfolio(scope) {
    {
      const scoped = scope === 'compounds' ? state.projects.filter(isCompound) : state.projects;
      await Promise.all(scoped.map((p) => loadProject(p.id)));
      const cps = state.checkpoints;
      const fk = '_hf_' + scope;
      const f = state[fk] || (state[fk] = { gov: '', brand: '' });
      const today = todayStr();
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
        : (rows.length === 1 ? noun[0] + ' واحد' : `${num(rows.length)} ${rows.length <= 10 ? noun[1] : noun[2]}`)
          + (govCount ? ` في ${cntAr(govCount, 'محافظة واحدة', 'محافظتين', 'محافظات', 'محافظة')}` : '') + `، ${rows.length === 1 ? 'فيه' : 'فيها'} ${num(sum('B3'))} وحدة. `
          + (attn.length ? `${attn.length === 1 ? noun[0] + ' واحد يحتاج' : num(attn.length) + ' ' + noun[1] + ' تحتاج'} انتباهك.` : 'لا مشاكل مفتوحة الآن.');

      // خريطة المحافظات
      const band = (v, has) => (!has ? 'none' : v >= 1 ? 'done' : v === 0 ? 'b0' : v < 0.25 ? 'b1' : v < 0.5 ? 'b2' : v < 0.75 ? 'b3' : 'b4');
      const govMap = h('div', { class: 'gov-map', role: 'list', 'aria-label': 'المشاريع حسب المحافظة' }, GOVS.map(([g, c, r]) => {
        const rs = rows.filter((x) => x.p.governorate === g);
        let gp = 0, gd = 0;
        rs.forEach((x) => x.D.per.forEach((y) => { gp += y.Pass; gd += x.D.B3 - y['N/A']; }));
        const prob = rs.some((x) => x.fails || x.open) ? ' flag-fail' : rs.some((x) => x.alerts) ? ' flag-alert' : '';
        const label = `${g}: ${rs.length ? `${cntAr(rs.length, noun[0] + ' واحد', noun[0] + 'ان', noun[1], noun[2])}، إنجاز ${pctText(gd ? gp / gd : 0)}` : 'لا ' + noun[1]}`;
        const el = h('button', { type: 'button', role: 'listitem', class: `gov tile ${band(gd ? gp / gd : 0, rs.length)}${prob}${f.gov === g ? ' sel' : ''}`, title: label, 'aria-label': label, 'aria-pressed': String(f.gov === g),
          onClick: () => { state._pf = { ...PF_DEFAULT, type: 'compound', gov: g }; go('projects'); } }, h('span', { class: 'g-name' }, g), rs.length ? h('b', null, String(rs.length)) : null);
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
        h('span', { class: 'pj-units' }, unitCount(r.p, r.D.B3)),
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
          h('div', { class: 'cc-foot' }, `${unitCount(r.p, r.D.B3)} · المكتمل ${num(r.D.B4)} · الجاري ${num(r.D.B5)}`,
            r.fails ? h('span', { class: 'chip st-has-failure' }, `${r.fails} فيها فشل`) : null,
            r.alerts ? h('span', { class: 'chip alert' }, `${r.alerts} تنبيه`) : null)))))) : null;

      const out = h('div', { class: 'dash2 home' },
        h('header', { class: 'd2-head' },
          h('div', { class: 'd2-lead-box' }, h('p', { class: 'd2-lead' }, lead),
          window.Plan && isStaff() && rows.length ? h('div', { class: 'row d2-lead-act' },
            h('button', { type: 'button', class: 'btn sm', onClick: () => window.Plan.brief() }, 'ملخّص الصباح'),
            h('a', { href: '#/calendar', class: 'btn ghost sm' }, 'تقويم المواعيد')) : null),
          h('div', { class: 'd2-pct' }, h('strong', null, pctText(overall)), h('span', null, scope === 'compounds' ? 'من فحوصات المجمّعات منجزة' : 'من فحوصات كل المشاريع منجزة'))),
        compBanner,
        h('dl', { class: 'd2-stats' }, [
          [scope === 'compounds' ? 'المجمّعات' : 'المشاريع', rows.length, '', ''], ['الوحدات', sum('B3'), '', 'all'], ['وحدات مكتملة', sum('B4'), 'ok', 'Complete'],
          ['فيها بند فاشل', sum('B7'), sum('B7') ? 'bad' : 'muted', 'Has failure'], ['تنبيهات تسلسل', sum('B8'), sum('B8') ? 'warn' : 'muted', 'alert'], ['NCR مفتوحة', sum('B9'), sum('B9') ? 'bad' : 'muted', 'ncr']
        ].map(([l, v, c, st]) => h('div', { class: 'st ' + c }, h('button', { type: 'button', class: 'st-btn', title: 'عرض: ' + l, onClick: () => compoundDrill(rows, st) },
          h('dd', null, num(v)), h('dt', null, l, h('span', { class: 'st-go', 'aria-hidden': 'true' }, ' ←')))))),
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
                : h('p', { class: 'calm' }, '👌 كل شيء على ما يرام: لا فحص فاشل ولا تنبيهات ولا عدم مطابقة مفتوحة.')),
            h('section', { class: 'd2-brands' }, h('h2', null, 'حسب الماركة'),
              byBrand.length ? h('ul', { class: 'brand-list' }, byBrand.map((x) => h('li', null,
                h('button', { type: 'button', onClick: () => { state._pf = { ...PF_DEFAULT, type: 'compound', brand: x.b }; go('projects'); } },
                  h('b', { dir: 'auto' }, x.b), h('small', null, `${cntAr(x.n, noun[0] + ' واحد', noun[0] + 'ان', noun[1], noun[2])}، ${unitCount({}, x.units)}`),
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
      window.UI.append(box, [h('p', { class: 'd2-note' }, `${num(rows.length)} نتيجة سُجّلت اليوم في ${num(units.length)} وحدة: ناجح ${cnt.pass}، فاشل ${cnt.fail}، لا ينطبق ${cnt.na}.`),
        h('ol', { class: 'today-list' }, units.slice(0, 10).map(({ x, items, who }) => {
          const fails = items.filter((i) => i.result === 'fail');
          const passes = items.filter((i) => i.result === 'pass').length;
          return h('li', { class: fails.length ? 'act-fail' : '' },
            h('time', { dir: 'ltr' }, new Date(x.inspected_at).toTimeString().slice(0, 5)),
            h('a', { href: `#/project/${x.units.project_id}/villa/${x.unit_id}` }, h('b', null, x.units.code), ' ', proj[x.units.project_id]?.client || ''),
            h('span', null, fails.length ? `فاشل: ${fails.map((i) => cp[i.checkpoint]).join('، ')}` : `${passes} ناجح` + (items.length > passes ? `، ${items.length - passes} أخرى` : '')),
            h('small', null, [...who].filter(Boolean).join('، ')));
        })),
        units.length > 10 ? h('p', { class: 'd2-note' }, `و${num(units.length - 10)} وحدة أخرى.`) : null]);
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
      if (v.map_url && !MAP_URL.test(v.map_url)) return 'الصق رابط موقع من خرائط Google أو Waze (يبدأ بـ https://)';
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
    // المجمّعات: الوحدات المسندة للفرقة
    const cu = state.crewUnits.filter((x) => x.crew_id === c.id).map((x) => ({ ...x, p: state.projects.find((p) => p.id === x.project_id) })).filter((x) => x.p);
    st.units = { n: cu.reduce((a, x) => a + x.units, 0), done: cu.reduce((a, x) => a + x.done, 0),
      fail: cu.reduce((a, x) => a + x.failing, 0), ip: cu.reduce((a, x) => a + x.in_progress, 0), at: cu };
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
        if (!await window.UI.confirmBox({ title: 'حذف', body: `سيُحذف "${c.name}"، وتبقى المراحل والوحدات المسندة له بدون منفّذ. الأفضل إلغاء تفعيله بدل الحذف حتى يبقى سجل أدائه.`, okText: 'حذف', danger: true })) return;
        const res = await state.sb.from('crews').delete().eq('id', c.id).select();
        if (res.error || !res.data?.length) return fail(res.error || 'permission denied');
        state.crews = state.crews.filter((x) => x.id !== c.id); state.crewUnits = state.crewUnits.filter((x) => x.crew_id !== c.id);
        Object.values(state.data).forEach((d) => d.units.forEach((u) => { if (u.crew_id === c.id) u.crew_id = null; }));
        toast('تم الحذف'); render();
      };
      const list = state.crews.filter((c) => tab === 'all' || c.kind === tab);
      const n = (k) => state.crews.filter((c) => c.kind === k).length;
      if (Date.now() - (state._cuAt || 0) > 30000) loadCrewUnits().then(() => { if (location.hash.startsWith('#/crews')) render(); });
      const card = (c) => {
        const st = crewStats(c);
        const busy = st.ip || st.units.ip;
        return h('li', { class: 'crew-card ' + c.kind + (c.active ? '' : ' off') },
          h('div', { class: 'cc-top' }, h('span', { class: 'cd-face cc-av ' + (st.ip ? 'busy' : '') }, initials(c.name)), h('span', { class: 'cc-name' }, h('small', { class: 'kind-tag ' + c.kind }, KIND_AR[c.kind]), h('b', null, c.name)),
            h('span', { class: 'chip ' + (busy ? 'st-in-progress' : '') }, !c.active ? 'غير فعّال' : busy ? 'يعمل الآن' : 'متاح')),
          c.leader || c.phone ? h('p', null, c.leader ? (c.kind === 'contractor' ? 'المسؤول: ' : 'الرئيس: ') + c.leader : '', c.leader && c.phone ? ' · ' : '',
            c.phone ? h('a', { href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), dir: 'ltr' }, c.phone) : null) : null,
          c.governorates?.length ? h('p', { class: 'cc-govs' }, c.governorates.join('، ')) : null,
          h('dl', { class: 'perf' },
            h('div', null, h('dd', null, num(st.done)), h('dt', null, 'مراحل مكتملة')),
            h('div', null, h('dd', null, num(st.ip)), h('dt', null, 'مراحل جارية')),
            h('div', null, h('dd', null, num(st.projects.size)), h('dt', null, 'مشاريع')),
            h('div', null, h('dd', null, st.avg === null ? '—' : num(Math.round(st.avg * 10) / 10)), h('dt', null, 'متوسط أيام المرحلة')),
            h('div', { class: st.afterDue ? 'bad' : '' }, h('dd', null, num(st.afterDue)), h('dt', null, 'اكتملت بعد التسليم'))),
          st.at.length ? h('ul', { class: 'cc-at' }, st.at.map((w) => h('li', null, h('a', { href: '#/project/' + w.p.id }, w.p.client), ' · ' + cpN[w.x.checkpoint] + (w.x.crew ? ` · ${num(w.x.crew)} كادر` : '')))) : null,
          st.units.n ? h('div', { class: 'cc-units' }, h('h3', null, 'في المجمّعات'),
            h('dl', { class: 'perf' },
              h('div', null, h('dd', null, num(st.units.n)), h('dt', null, 'وحدة مسندة')),
              h('div', null, h('dd', null, num(st.units.done)), h('dt', null, 'مكتملة')),
              h('div', null, h('dd', null, num(st.units.ip)), h('dt', null, 'جارية')),
              h('div', { class: st.units.fail ? 'bad' : '' }, h('dd', null, num(st.units.fail)), h('dt', null, 'فيها فشل')),
              h('div', null, h('dd', null, pctText(st.units.n ? st.units.done / st.units.n : 0)), h('dt', null, 'نسبة المكتمل'))),
            h('ul', { class: 'cc-at' }, st.units.at.map((x) => {
              return h('li', null, h('a', { href: '#/project/' + x.p.id }, x.p.client), ` · ${unitCount(x.p, x.units)}، المكتمل ${num(x.done)}` + (x.failing ? `، ${num(x.failing)} فيها فشل` : '')); }))) : null,
          isStaff() ? h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn sm', onClick: () => edit(c) }, 'تعديل'),
            isAdmin() ? h('button', { type: 'button', class: 'btn sm ghost danger-text', onClick: () => del(c) }, 'حذف') : null) : null);
      };
      return h('div', { class: 'stack crews-page' },
        h('div', { class: 'row between' }, h('h1', null, 'الفرق والمقاولون'), isStaff() ? h('button', { type: 'button', class: 'btn primary', onClick: () => edit() }, '+ إضافة') : null),
        h('p', { class: 'muted' }, 'كل مرحلة في المشروع، وكل وحدة في المجمّعات، تُسند لمنفّذ: فرقة من فنيي الشركة أو مقاول تنفيذ. الأداء يُحسب من المراحل والوحدات المسندة لكل منفّذ.'),
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
      field('كلمة المرور', pass, { hint: '8 أحرف على الأقل، فيها حروف إنجليزية وأرقام' }),
      h('div', { class: 'field' }, h('label', null, '\u00a0'), h('button', { type: 'button', class: 'btn', onClick: gen }, 'كلمة مرور جديدة')),
      field('الدور', roleSel, { wide: true, hint: 'الفني يشاهد، ويسجّل قراءات الفحص، ويبلّغ عن مراحل فرقته مع صورة. اختر فرقته من الجدول بعد الإنشاء' })),
    [{ label: 'إنشاء الحساب', cls: 'primary', run: async () => {
      const v = { full_name: name.value.trim(), email: email.value.trim().toLowerCase(), password: pass.value, role: roleSel.value };
      if (!v.full_name) { toast('اكتب الاسم', 'error'); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) { toast('البريد الإلكتروني غير صحيح', 'error'); return false; }
      if (!strongEnough(v.password)) { toast('كلمة المرور 8 أحرف على الأقل، وفيها حروف إنجليزية وأرقام', 'error'); return false; }
      const { error } = await state.sb.functions.invoke('admin-create-user', { body: v });
      if (error) {
        let msg = '';
        try { msg = (await error.context.json()).error; } catch (e) { /* */ }
        toast(msg || errText(error), 'error'); return false;
      }
      // بطاقة الدخول تظهر مرة واحدة لترسلها للشخص
      const text = `حسابك في تطبيق متابعة مشاريع سرور\nالرابط: ${location.origin}${location.pathname}\nالبريد: ${v.email}\nكلمة المرور: ${v.password}\nبعد أول دخول غيّرها من زر "كلمة المرور" في القائمة.`;
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
        h('p', { class: 'muted' }, 'غيّر الاسم أو الدور أو الفرقة من الجدول ويُحفظ وحده. الفني يبلّغ عن بدء وإكمال المراحل المسندة لفرقته فقط. لإيقاف شخص ترك العمل، أزل علامة "مفعّل" بدل الحذف حتى تبقى سجلاته.'),
        h('section', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'الاسم'), h('th', null, 'الدور'), h('th', null, 'الفرقة'), h('th', null, 'مفعّل'), h('th', null, 'أُضيف'))),
          h('tbody', null, data.map((u) => {
            const me = u.id === state.user.id;
            return h('tr', { class: 'u-row' + (u.active ? '' : ' off') },
              h('td', { class: 'u-name' }, h('span', { class: 'cd-face u-av', 'aria-hidden': 'true' }, initials(u.full_name)), h('input', { value: u.full_name, maxlength: 120, 'aria-label': 'الاسم', onChange: (e) => save(u, { full_name: e.target.value.trim() }) })),
              h('td', { 'data-l': 'الدور' }, h('select', { disabled: me, 'aria-label': 'الدور', onChange: (e) => save(u, { role: e.target.value }) },
                Object.entries(ROLES).map(([v, l]) => h('option', { value: v, selected: u.role === v }, l)))),
              // الفني يبلّغ عن مراحل فرقته فقط
              h('td', { 'data-l': 'الفرقة' }, h('select', { 'aria-label': 'الفرقة', onChange: (e) => save(u, { crew_id: e.target.value || null }) },
                h('option', { value: '' }, 'بدون فرقة'),
                state.crews.filter((c) => c.kind === 'internal' && (c.active || c.id === u.crew_id)).map((c) => h('option', { value: c.id, selected: u.crew_id === c.id }, c.name)))),
              h('td', { 'data-l': 'مفعّل' }, h('input', { type: 'checkbox', checked: u.active, disabled: me, 'aria-label': 'مفعّل', onChange: (e) => save(u, { active: e.target.checked }) })),
              h('td', { 'data-l': 'أُضيف' }, h('span', { dir: 'ltr' }, date(u.created_at))));
          }))))),
        h('section', { class: 'card' }, h('h2', null, 'الصلاحيات'), h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
          h('thead', null, h('tr', null, h('th', null, ''), h('th', null, 'مدير'), h('th', null, 'مشرف'), h('th', null, 'فني'))),
          h('tbody', null, [
            ['عرض كل المشاريع والمراحل والفرق وبيانات العملاء', 1, 1, 1],
            ['تسجيل قراءات الفحص في المجمّعات', 1, 1, 1],
            ['إنشاء المشاريع وتعديل بياناتها ومواعيدها', 1, 1, 0],
            ['التبليغ عن بدء أو إكمال مرحلة مسندة لفرقته (مع صورة)', 0, 0, 1],
            ['الموافقة على تقارير الفنيين أو رفضها', 1, 1, 0],
            ['بدء المراحل وإكمالها وإسنادها لفرقة أو مقاول', 1, 1, 0],
            ['إضافة الفرق والمقاولين وتعديلهم', 1, 1, 0],
            ['أداء كل الفنيين (الفني يرى أداءه فقط)', 1, 1, 0],
            ['نتائج فحص الفلل، وNCR، واستيراد Excel، وتنزيل البيانات', 1, 1, 0],
            ['حذف المشاريع والفرق، وإضافة المستخدمين، وسجل العمليات، والنسخ الاحتياطية الكاملة', 1, 0, 0]
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
  const sizeText = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  const daysAgoText = (x) => { const d = daysSince(x); return d === 0 ? 'اليوم' : d === 1 ? 'أمس' : `قبل ${daysAr(d)}`; };
  views.backup = {
    title: 'نسخة احتياطية', allow: isStaff,
    async render() {
      const stamp = () => new Date().toISOString().slice(0, 10);
      const save = (obj, name) => download(new Blob([JSON.stringify(obj)], { type: 'application/json' }), name);
      // نسخة من المتصفح (المدير والمشرف): ما يقرؤه المستخدم من الجداول الأساسية
      const quick = async (btn) => {
        btn.disabled = true;
        try {
          // ترتيب ثابت بالمفتاح الأساسي حتى لا تُفوَّت أسطر أو تتكرر بين الدفعات، والمشاريع تُجلب الآن لا من الذاكرة
          const all = (t, ...keys) => fetchAll((a, b) => keys.reduce((q, k) => q.order(k), state.sb.from(t).select('*')).range(a, b));
          const [projects, units, checks, tests, ncrs, stages, crews, materials] = await Promise.all([all('projects', 'id'), all('units', 'id'), all('unit_checks', 'unit_id', 'checkpoint'),
            all('test_records', 'unit_id'), all('ncrs', 'id'), all('project_stages', 'project_id', 'checkpoint'), all('crews', 'id'), all('materials', 'id')]);
          save({ app: 'surour-vrf-qc', version: 4, exported_at: new Date().toISOString(),
            projects, project_stages: stages, crews, units, unit_checks: checks, test_records: tests, ncrs, materials }, `surour-backup-${stamp()}.json`);
          toast('تم التنزيل');
        } catch (e) { fail(e); }
        btn.disabled = false;
      };
      const quickCard = h('section', { class: 'card' }, h('h2', null, isAdmin() ? 'تنزيل سريع' : 'تنزيل البيانات'),
        h('p', { class: 'muted' }, 'المشاريع والمراحل والفرق وبيانات الفحص في ملف JSON. لتنزيل مشروع كملف Excel افتح المشروع واضغط "تصدير Excel".'),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn' + (isAdmin() ? '' : ' primary'), onClick: (e) => quick(e.currentTarget) }, 'تنزيل')));
      if (!isAdmin()) return h('div', { class: 'stack' }, h('h1', null, 'نسخة احتياطية'), quickCard);

      const { data, error } = await state.sb.from('backups').select('id, taken_at, kind, counts, size_bytes').order('taken_at', { ascending: false });
      if (error) throw error;
      const lastAuto = data.find((b) => b.kind === 'auto');
      const stale = !lastAuto || daysSince(lastAuto.taken_at) > 2;
      const get = async (b, btn) => {
        btn.disabled = true;
        try {
          const r = await state.sb.rpc('backup_data', { p_id: b.id });
          if (r.error) throw r.error;
          save(r.data, `surour-full-backup-${String(b.taken_at).slice(0, 10)}-${b.id}.json`);
          toast('تم التنزيل. احفظ الملف في Google Drive أو على جهازك');
        } catch (e) { fail(e); }
        btn.disabled = false;
      };
      const take = async (btn) => {
        btn.disabled = true;
        const r = await state.sb.rpc('take_backup');
        if (r.error) { fail(r.error); btn.disabled = false; return; }
        toast('أُخذت نسخة جديدة');
        render();
      };
      const rowsOf = (c) => Object.values(c || {}).reduce((a, n) => a + Number(n || 0), 0);
      return h('div', { class: 'stack' },
        h('div', { class: 'row between' }, h('h1', null, 'نسخة احتياطية'),
          h('button', { type: 'button', class: 'btn primary', onClick: (e) => take(e.currentTarget) }, 'خذ نسخة الآن')),
        h('section', { class: 'card' + (stale ? ' warn' : '') },
          h('h2', null, stale ? 'لا توجد نسخة تلقائية حديثة' : 'النسخ التلقائي يعمل'),
          h('p', null, stale
            ? 'المفروض أن تُحفظ نسخة كل ليلة. إذا استمر هذا التنبيه فأبلغ من يتولى الدعم التقني.'
            : `آخر نسخة تلقائية ${daysAgoText(lastAuto.taken_at)} (${dateTime(lastAuto.taken_at)}). تُحفظ نسخة كاملة كل ليلة، وتبقى آخر 30 نسخة.`),
          h('p', { class: 'muted' }, 'هذه النسخ محفوظة داخل قاعدة البيانات نفسها، فتنفع عند الحذف أو التعديل بالخطأ. لحماية أقوى، نزّل نسخة مرة في الشهر على الأقل واحفظها في Google Drive. الصور المرفقة بالتقارير ليست ضمن النسخة.')),
        h('section', { class: 'card' }, h('h2', null, 'النسخ المحفوظة'),
          data.length ? h('ul', { class: 'bk-list' }, data.map((b) => h('li', null,
            h('div', null,
              h('b', { dir: 'ltr' }, dateTime(b.taken_at)),
              h('small', { class: 'muted' }, `${b.kind === 'auto' ? 'تلقائية' : 'يدوية'} · ${cntAr(Number(b.counts?.projects || 0), 'مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً')} · ${num(rowsOf(b.counts))} سجل · `, h('span', { dir: 'ltr' }, sizeText(b.size_bytes)))),
            h('button', { type: 'button', class: 'btn sm', onClick: (e) => get(b, e.currentTarget), 'aria-label': 'تنزيل نسخة ' + dateTime(b.taken_at) }, 'تنزيل'))))
            : empty('لا توجد نسخ بعد', 'أول نسخة تلقائية تُحفظ الليلة، أو اضغط "خذ نسخة الآن".')),
        quickCard);
    }
  };

  window.App = { state, views, render, go, fail, errText, field, empty, modal, download, fetchAll,
    loadProject, loadBase, unitCount, loadCrewUnits, nameKey: norm, isAdmin, isStaff, MAP_URL, initials, ringStyle, stageOf, stageProgress, STAGE_AR, cntAr, schedule, dueText, daysAr, crewOf, KIND_AR, unitWords, projectFields, GOVS, PTYPES, isCompound, todayActivity, F, RES, RES_AR, STATUS_AR, openNcrsOf, pctText,
    projInfo, forecast, forecastText, addDays, todayStr, dayDiff, STALL_DAYS, DAY };

  applyTheme();
  document.addEventListener('DOMContentLoaded', () => { pullToRefresh(); sheetDrag(); boot().catch(fail); });
})();
