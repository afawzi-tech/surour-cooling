/* ==========================================================
   أداء الفنيين
   الأرقام من دالة tech_performance على الخادم: المدير والمشرف يرون الكل، والفني يرى أداءه فقط.
   "من سجّل القراءة" يُملأ على الخادم لكل قسم (ضغط، فاكيوم، شحن) في test_records.
   الفشل وNCR تُحسب على من سجّل قراءة ذاك الفحص، وأرقام الفرقة تظهر بجانبها.
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, num, date, dateTime } = window.UI;
  const A = window.App;
  const S = A.state;
  const ROLE_AR = { admin: 'مدير', supervisor: 'مشرف', technician: 'فني' };
  const PART = { pressure_test: 'ضغط', vacuum: 'فاكيوم', charging: 'شحن' };
  const COLS = { pressure_test: ['pressure_by', 'pressure_at'], vacuum: ['vacuum_by', 'vacuum_at'], charging: ['charge_by', 'charge_at'] };
  const PERIODS = [['month', 'هذا الشهر'], ['3m', 'آخر 3 أشهر'], ['year', 'هذه السنة'], ['all', 'الكل']];

  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function range(k) {
    const t = new Date();
    if (k === 'month') return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: null };
    if (k === '3m') return { from: iso(new Date(t.getFullYear(), t.getMonth() - 2, 1)), to: null };
    if (k === 'year') return { from: iso(new Date(t.getFullYear(), 0, 1)), to: null };
    return { from: null, to: null };
  }
  const period = () => S._tperiod || 'month';
  const inRange = (t, r) => !!t && (!r.from || String(t).slice(0, 10) >= r.from) && (!r.to || String(t).slice(0, 10) <= r.to);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  // العدد مع المعدود: قراءة، قراءتان، 3 قراءات، 11 قراءة
  const cnt = (n, one, two, few) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${num(n)} ${few}` : `${num(n)} ${one}`);
  const crewName = (id) => S.crews.find((c) => c.id === id)?.name || null;

  // أداء الفرقة في الفترة: مراحل المشاريع المسندة لها (اكتملت في الفترة) ووحدات المجمّعات
  function teamStats(crewId, r) {
    const st = { done: 0, ip: 0, days: [], afterDue: 0, failing: 0, units: 0 };
    if (!crewId) return st;
    S.projects.forEach((p) => Object.values(S.stages[p.id] || {}).forEach((x) => {
      if (x.crew_id !== crewId) return;
      if (x.status === 'in_progress') st.ip++;
      if (x.status === 'done' && inRange(x.end_date, r)) {
        st.done++;
        if (x.start_date && x.end_date) st.days.push(Math.round((new Date(x.end_date) - new Date(x.start_date)) / 86400000) + 1);
        if (p.due_date && x.end_date > p.due_date) st.afterDue++;
      }
    }));
    S.crewUnits.filter((x) => x.crew_id === crewId).forEach((x) => { st.units += x.units; st.failing += x.failing; });
    st.avg = st.days.length ? Math.round((st.days.reduce((a, b) => a + b, 0) / st.days.length) * 10) / 10 : null;
    return st;
  }

  async function load(r) {
    const { data, error } = await S.sb.rpc('tech_performance', { p_from: r.from, p_to: r.to });
    if (error) throw error;
    return data;
  }

  const periodBar = () => h('div', { class: 'seg4 tp-period', role: 'radiogroup', 'aria-label': 'الفترة' }, PERIODS.map(([k, l]) =>
    h('button', { type: 'button', role: 'radio', class: k === period() ? 'on r-pending' : '', 'aria-checked': String(k === period()),
      onClick: () => { S._tperiod = k; A.render(); } }, l)));

  const stat = (v, label, bad) => h('div', { class: bad ? 'bad' : '' }, h('dd', null, v), h('dt', null, label));

  function personalStats(x) {
    return h('dl', { class: 'perf' },
      stat(num(x.readings), 'قراءة سجّلها'),
      stat(num(x.failed), 'فشلت', x.failed > 0),
      stat(pct(x.failed, x.readings), 'نسبة الفشل', x.failed > 0),
      stat(num(x.ncrs), x.ncrs_open ? `NCR، مفتوحة ${num(x.ncrs_open)}` : 'NCR', x.ncrs_open > 0),
      stat(num(x.reports), 'تقرير مرحلة'));
  }

  function card(x, r) {
    const t = teamStats(x.crew_id, r), cn = crewName(x.crew_id);
    return h('li', { class: 'crew-card tp-card' + (x.active ? '' : ' off') },
      h('div', { class: 'cc-top' },
        h('a', { href: '#/techs/' + x.user_id, class: 'tp-name' }, h('b', null, x.full_name || 'بدون اسم')),
        h('small', { class: 'chip' }, x.active ? ROLE_AR[x.role] : 'غير مفعّل')),
      h('p', null, cn ? 'الفرقة: ' + cn : 'بلا فرقة', ' · ', x.last_at ? 'آخر نشاط ' + date(x.last_at) : 'لا نشاط بعد'),
      personalStats(x),
      h('p', { class: 'small' }, `القراءات: ضغط ${num(x.pressure)}، فاكيوم ${num(x.vacuum)}، شحن ${num(x.charge)}`
        + (x.results ? ` · اعتمد ${num(x.results)} نتيجة` : '')),
      cn ? h('p', { class: 'small' }, `فرقته: ${t.done ? cnt(t.done, 'مرحلة مكتملة', 'مرحلتان مكتملتان', 'مراحل مكتملة') + '، متوسط المرحلة ' + A.daysAr(t.avg) : 'لا مراحل مكتملة في الفترة'}`
        + (x.team_ncrs ? `، وعليها ${x.team_ncrs === 1 ? 'تقرير NCR واحد' : num(x.team_ncrs) + ' NCR'}` : '')) : null,
      h('a', { href: '#/techs/' + x.user_id, class: 'link small' }, 'التفاصيل'));
  }

  /* ---------- قائمة الفنيين (المدير والمشرف) ---------- */
  async function listView(r) {
    const rng = range(period());
    const all = await load(rng);
    const showAll = S._tall === true;
    const rows = all.filter((x) => showAll || x.role === 'technician')
      .sort((a, b) => b.active - a.active || b.readings - a.readings || (a.full_name || '').localeCompare(b.full_name || '', 'ar'));
    const sum = rows.reduce((a, x) => ({ readings: a.readings + x.readings, failed: a.failed + x.failed, ncrs: a.ncrs + x.ncrs }), { readings: 0, failed: 0, ncrs: 0 });
    const noCrew = all.filter((x) => x.role === 'technician' && x.active && !x.crew_id);
    return h('div', { class: 'stack techs-page' },
      h('h1', null, 'أداء الفنيين'),
      h('div', { class: 'row between' }, periodBar(),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: showAll, onChange: (e) => { S._tall = e.target.checked; A.render(); } }), ' عرض المشرفين والمدير أيضاً')),
      h('p', { class: 'd2-note' }, sum.readings ? `${cnt(sum.readings, 'قراءة', 'قراءتان', 'قراءات')} في ${PERIODS.find((p) => p[0] === period())[1]}، فشل منها ${num(sum.failed)} (${pct(sum.failed, sum.readings)})، وعليها ${num(sum.ncrs)} NCR.` : `لا قراءات في ${PERIODS.find((p) => p[0] === period())[1]}.`),
      noCrew.length && A.isAdmin() ? h('p', { class: 'calm' }, `${num(noCrew.length)} فني بلا فرقة: ${noCrew.map((x) => x.full_name).join('، ')}. اختر فرقته من `, h('a', { href: '#/users', class: 'link' }, 'صفحة المستخدمين'), '.') : null,
      rows.length ? h('ul', { class: 'crew-cards' }, rows.map((x) => card(x, rng)))
        : A.empty('لا يوجد فنيون بعد', 'أضفهم من صفحة المستخدمين.'),
      h('p', { class: 'd2-note muted small' }, '"قراءة" = قسم واحد (ضغط أو فاكيوم أو شحن) في وحدة واحدة، ويُحسب لآخر من غيّره. "فشلت" = نتيجة ذاك الفحص فاشلة. NCR = تقارير عدم المطابقة على فحص سجّل قراءته. "يوم للمرحلة" لفرقته من مراحل المشاريع المكتملة في الفترة.'));
  }

  /* ---------- صفحة فني واحد ---------- */
  async function detailView(id) {
    const rng = range(period());
    const rows = await load(rng);
    const x = rows.find((y) => y.user_id === id);
    if (!x) return A.empty('لا يمكن عرض هذه الصفحة', A.isStaff() ? 'المستخدم غير موجود.' : 'تظهر لك صفحة أدائك فقط.');
    const me = id === S.user.id;
    const t = teamStats(x.crew_id, rng), cn = crewName(x.crew_id);

    // القراءات التي سجّلها، مع نتيجة الفحص وNCR
    const box = h('section', { class: 'card' }, h('h2', null, 'القراءات التي سجّلها'), h('p', { class: 'muted' }, 'جارٍ التحميل…'));
    (async () => {
      const tr = await A.fetchAll((a, b) => S.sb.from('test_records')
        .select('unit_id, pressure_by, pressure_at, vacuum_by, vacuum_at, charge_by, charge_at, units!inner(code, project_id)')
        .or(`pressure_by.eq.${id},vacuum_by.eq.${id},charge_by.eq.${id}`).range(a, b));
      const items = [];
      tr.forEach((r) => Object.entries(COLS).forEach(([cp, [by, at]]) => {
        if (r[by] === id && inRange(r[at], rng)) items.push({ unit_id: r.unit_id, cp, at: r[at], code: r.units.code, project_id: r.units.project_id });
      }));
      const ids = [...new Set(items.map((i) => i.unit_id))];
      const res = {}, ncr = {};
      for (let k = 0; k < ids.length; k += 150) {
        const part = ids.slice(k, k + 150);
        const [c, n] = await Promise.all([
          S.sb.from('unit_checks').select('unit_id, checkpoint, result').in('unit_id', part).in('checkpoint', Object.keys(COLS)),
          S.sb.from('ncrs').select('unit_id, checkpoint, ncr_no, status').in('unit_id', part)]);
        (c.data || []).forEach((y) => { res[y.unit_id + y.checkpoint] = y.result; });
        (n.data || []).forEach((y) => { (ncr[y.unit_id + y.checkpoint] ||= []).push(y); });
      }
      items.forEach((i) => { i.result = res[i.unit_id + i.cp] || 'pending'; i.ncrs = ncr[i.unit_id + i.cp] || []; });
      // الفشل وNCR المفتوحة أولاً ثم الأحدث
      const rank = (i) => (i.result === 'fail' || i.ncrs.some((n) => n.status === 'open') ? 0 : 1);
      items.sort((a, b) => rank(a) - rank(b) || (a.at < b.at ? 1 : -1));
      const proj = Object.fromEntries(S.projects.map((p) => [p.id, p]));
      clear(box).append(h('h2', null, 'القراءات التي سجّلها'),
        items.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table compact tp-table' },
          h('thead', null, h('tr', null, h('th', null, 'الوحدة'), h('th', null, 'المشروع'), h('th', null, 'الفحص'), h('th', null, 'النتيجة'), h('th', null, 'NCR'), h('th', null, 'الوقت'))),
          h('tbody', null, items.slice(0, 300).map((i) => h('tr', { class: i.result === 'fail' ? 'tp-fail' : '' },
            h('td', null, h('a', { href: `#/project/${i.project_id}/villa/${i.unit_id}`, class: 'link tp-code', dir: 'ltr' }, i.code)),
            h('td', null, proj[i.project_id]?.client || ''),
            h('td', null, PART[i.cp]),
            h('td', null, h('span', { class: 'chip r-' + i.result }, A.RES_AR[i.result])),
            h('td', null, i.ncrs.map((n) => n.ncr_no + (n.status === 'open' ? ' (مفتوحة)' : '')).join('، ') || '—'),
            h('td', { dir: 'ltr' }, dateTime(i.at)))))))
          : h('p', { class: 'calm muted' }, 'لا قراءات في هذه الفترة.'),
        ...(items.length > 300 ? [h('p', { class: 'd2-note' }, `يظهر أول 300 من ${num(items.length)}.`)] : []));
    })().catch((e) => { clear(box).append(h('h2', null, 'القراءات التي سجّلها'), h('p', { class: 'calm muted' }, 'تعذّر التحميل: ' + A.errText(e))); });

    return h('div', { class: 'stack techs-page' },
      A.isStaff() ? h('a', { href: '#/techs', class: 'link small' }, '→ كل الفنيين') : null,
      h('div', { class: 'row between' },
        h('h1', null, me ? 'أدائي' : x.full_name),
        h('span', { class: 'chip' }, (x.active ? ROLE_AR[x.role] : 'غير مفعّل') + (cn ? ' · ' + cn : ' · بلا فرقة'))),
      periodBar(),
      h('section', { class: 'card' }, h('h2', null, me ? 'شغلي' : 'شغله'),
        personalStats(x),
        h('p', { class: 'small' }, `ضغط ${num(x.pressure)}، فاكيوم ${num(x.vacuum)}، شحن ${num(x.charge)}`
          + ` · تقارير المراحل: ${num(x.reports_approved)} مقبولة، ${num(x.reports_rejected)} مرفوضة`
          + (x.results ? ` · اعتمد ${num(x.results)} نتيجة فحص` : '')),
        x.last_at ? h('p', { class: 'muted small' }, 'آخر نشاط: ' + dateTime(x.last_at)) : null),
      h('section', { class: 'card' }, h('h2', null, cn ? 'الفرقة: ' + cn : 'الفرقة'),
        cn ? [h('dl', { class: 'perf' },
          stat(num(t.done), 'مرحلة مكتملة'),
          stat(num(t.ip), 'جارية الآن'),
          stat(t.avg === null ? '—' : num(t.avg), 'يوم متوسط المرحلة'),
          stat(num(t.afterDue), 'بعد موعد التسليم', t.afterDue > 0),
          stat(num(x.team_ncrs), x.team_ncrs_open ? `NCR، مفتوحة ${num(x.team_ncrs_open)}` : 'NCR', x.team_ncrs_open > 0)),
        t.units ? h('p', { class: 'small' }, `في المجمّعات: ${num(t.units)} وحدة، فيها فشل الآن ${num(t.failing)}.`) : null,
        h('a', { href: '#/crews', class: 'link small' }, 'صفحة الفرق')]
          : h('p', { class: 'calm muted' }, A.isAdmin() ? 'لم تُحدَّد فرقته. اخترها من صفحة المستخدمين.' : 'لم تُحدَّد الفرقة بعد. يحدّدها المدير.')),
      box);
  }

  A.views.techs = {
    title: 'أداء الفنيين',
    render(r) {
      if (!A.isStaff()) return detailView(S.user.id);   // الفني يرى أداءه فقط (والخادم يمنع غيره)
      return r.id ? detailView(r.id) : listView(r);
    }
  };
})();
