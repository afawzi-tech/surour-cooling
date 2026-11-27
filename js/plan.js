/* ==========================================================
   تقويم المواعيد وملخّص الصباح
   - التقويم: كل المواعيد القادمة (تسليم، بدء مخطط، إغلاق NCR) مقسّمة بالأسابيع (الأسبوع يبدأ السبت)،
     وكل موعد بدرجة خطورة: عالية / متوسطة / عادية. وتحتها أرشيف المشاريع المسلّمة مؤخراً: بوقتها أو متأخرة.
   - ملخّص الصباح: نص جاهز للنسخ أو واتساب: ما تحرّك منذ أمس، التقارير المعلّقة، المتأخرة، مواعيد الأسبوع.
   كل شيء يُحسب في الواجهة من البيانات المحمّلة، ولا يغيّر قاعدة البيانات.
   ========================================================== */
(() => {
  'use strict';

  const { h, num, toast } = window.UI;
  const A = window.App;
  const S = A.state;

  const WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const wd = (d) => WD[new Date(d + 'T00:00:00Z').getUTCDay()];
  const IMP = { h: 'عالية', m: 'متوسطة', l: 'عادية' };
  const IMP_RANK = { h: 0, m: 1, l: 2 };
  const HORIZON = 60;        // أبعد موعد يظهر في "لاحقاً"
  const ARCHIVE_DAYS = 90;   // أرشيف المسلّمة في آخر 90 يوماً

  // "هذا الأسبوع" = اليوم والأيام الستة التالية، و"الأسبوع القادم" = السبعة التي بعدها
  const weekEnds = (t) => ({ end1: A.addDays(t, 6), end2: A.addDays(t, 13) });
  // العدد مع المعدود: مرحلة واحدة، مرحلتان، 3 مراحل، 11 مرحلة
  const cnt = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${num(n)} ${few}` : `${num(n)} ${many}`);
  const stagesN = (n) => cnt(n, 'مرحلة واحدة', 'مرحلتان', 'مراحل', 'مرحلة');
  const whenText = (d, t) => {
    const n = A.dayDiff(d, t);
    return n === 0 ? 'اليوم' : n === 1 ? 'غداً' : n === -1 ? 'أمس' : n < 0 ? `قبل ${A.daysAr(-n)}` : `بعد ${A.daysAr(n)}`;
  };

  async function loadRows() {
    await Promise.all(S.projects.filter(A.isCompound).map((p) => A.loadProject(p.id)));
    return S.projects.map(A.projInfo);
  }

  /* ---------- المواعيد ---------- */
  function events(rows) {
    const t = A.todayStr(), ev = [];
    rows.forEach((r) => {
      const p = r.p;
      if (r.status !== 'done' && p.due_date) {
        const fcLate = r.fc && r.fc.diff !== null && r.fc.diff < 0;
        const imp = r.sc.late || r.sc.behind || fcLate ? 'h' : r.sc.daysLeft <= 7 ? 'm' : 'l';
        ev.push({ date: p.due_date, kind: 'due', title: 'تسليم المشروع', r, imp,
          why: [`الإنجاز ${A.pctText(r.pct)}`, r.sc.behind ? 'متأخر عن الجدول' : '', r.fc ? A.forecastText(r.fc) : ''].filter(Boolean) });
      }
      if (r.status === 'not_started' && p.start_date) {
        const missed = p.start_date < t;
        ev.push({ date: p.start_date, kind: 'start', title: missed ? 'فات موعد البدء ولم يبدأ' : 'بدء العمل المخطط', r, imp: missed ? 'h' : 'l',
          why: [p.due_date ? `التسليم ${p.due_date}` : ''].filter(Boolean) });
      }
      if (r.compound) {
        const d = S.data[p.id];
        const code = Object.fromEntries(d.units.map((u) => [u.id, u.code]));
        d.ncrs.filter((n) => n.status === 'open' && n.due_date).forEach((n) => ev.push({
          date: n.due_date, kind: 'ncr', title: `إغلاق ${n.ncr_no}`, r, imp: n.due_date < t ? 'h' : 'm',
          why: [code[n.unit_id] || '', n.description || ''].filter(Boolean) }));
      }
    });
    return ev.sort((a, b) => a.date.localeCompare(b.date) || IMP_RANK[a.imp] - IMP_RANK[b.imp]);
  }

  // المشاريع المسلّمة مؤخراً: آخر تاريخ انتهاء مرحلة مقارنة بتاريخ التسليم
  function archive(rows) {
    const from = A.addDays(A.todayStr(), -ARCHIVE_DAYS);
    return rows.filter((r) => r.status === 'done' && !r.compound).map((r) => {
      const end = Object.values(S.stages[r.p.id] || {}).map((x) => x.end_date).filter(Boolean).sort().pop() || null;
      return { r, end, diff: end && r.p.due_date ? A.dayDiff(r.p.due_date, end) : null };
    }).filter((x) => x.end && x.end >= from).sort((a, b) => b.end.localeCompare(a.end));
  }

  function groups(ev) {
    const t = A.todayStr(), { end1, end2 } = weekEnds(t), last = A.addDays(t, HORIZON);
    return [
      ['overdue', 'فات موعدها', ev.filter((e) => e.date < t)],
      ['week', 'هذا الأسبوع (7 أيام)', ev.filter((e) => e.date >= t && e.date <= end1)],
      ['next', 'الأسبوع الذي يليه', ev.filter((e) => e.date > end1 && e.date <= end2)],
      ['later', `لاحقاً (حتى ${A.daysAr(HORIZON)})`, ev.filter((e) => e.date > end2 && e.date <= last)]
    ];
  }

  A.views.calendar = {
    title: 'تقويم المواعيد',
    async render() {
      const rows = await loadRows();
      const t = A.todayStr();
      const ev = events(rows);
      const G = groups(ev);
      const wk = G[1][2], hi = (xs) => xs.filter((e) => e.imp === 'h').length;
      const noDue = rows.filter((r) => r.status !== 'done' && !r.p.due_date);
      const ar = archive(rows);
      const onTime = ar.filter((x) => x.diff !== null && x.diff >= 0).length, withDue = ar.filter((x) => x.diff !== null).length;
      const lateDays = ar.filter((x) => x.diff !== null && x.diff < 0).map((x) => -x.diff);

      const od = G[0][2].length, hw = hi(wk);
      const lead = (od ? (od === 1 ? 'موعد واحد فات ولم يُنجز. ' : od === 2 ? 'موعدان فاتا ولم يُنجزا. ' : `${num(od)} ${od <= 10 ? 'مواعيد فاتت' : 'موعداً فات'} ولم تُنجز. `) : '')
        + (wk.length ? `خلال 7 أيام ${cnt(wk.length, 'موعد واحد', 'موعدان', 'مواعيد', 'موعداً')}` + (hw ? (wk.length === 1 ? '، وهو عالي الخطورة.' : hw === 1 ? '، أحدها عالي الخطورة.' : `، منها ${num(hw)} عالية الخطورة.`) : '.') : 'لا مواعيد خلال 7 أيام.');

      const row = (e) => h('li', { class: 'ev imp-' + e.imp + ' ev-' + e.kind },
        h('span', { class: 'ev-date' }, h('b', null, wd(e.date)), h('span', { dir: 'ltr' }, e.date), h('small', null, whenText(e.date, t))),
        h('span', { class: 'ev-dot', title: 'الخطورة: ' + IMP[e.imp], 'aria-label': 'الخطورة: ' + IMP[e.imp] }),
        h('span', { class: 'ev-main' },
          h('span', { class: 'ev-title' }, h('span', { class: 'ev-kind' }, e.title), ' · ', h('a', { href: '#/project/' + e.r.p.id }, h('b', null, e.r.p.client)),
            e.r.p.governorate ? h('small', null, ' ' + e.r.p.governorate) : null),
          e.why.length ? h('small', { class: 'ev-why' }, e.why.join(' · ')) : null));

      return h('div', { class: 'dash2 cal' },
        h('header', { class: 'd2-head' },
          h('div', { class: 'd2-lead-box' }, h('p', { class: 'd2-lead' }, lead),
            A.isStaff() && rows.length ? h('div', { class: 'row d2-lead-act' }, h('button', { type: 'button', class: 'btn sm', onClick: () => brief() }, 'ملخّص الصباح')) : null),
          h('ul', { class: 'ev-key', 'aria-label': 'دليل الألوان' },
            h('li', { class: 'imp-h' }, h('i'), 'عالية: متأخر، أو متأخر عن الجدول، أو التوقّع بعد الموعد'),
            h('li', { class: 'imp-m' }, h('i'), 'متوسطة: خلال 7 أيام، أو NCR مفتوحة'),
            h('li', { class: 'imp-l' }, h('i'), 'عادية'))),
        G.map(([k, label, xs]) => (k === 'overdue' && !xs.length ? null : h('section', { class: 'cal-sec cal-' + k },
          h('div', { class: 'd2-plan-head' }, h('h2', null, label), h('span', { class: 'd2-note' }, xs.length ? cnt(xs.length, 'موعد واحد', 'موعدان', 'مواعيد', 'موعداً') : '')),
          xs.length ? h('ol', { class: 'ev-list' }, xs.map(row)) : h('p', { class: 'calm muted' }, 'لا مواعيد.')))),
        noDue.length ? h('p', { class: 'd2-note cal-nodue' }, `${cnt(noDue.length, 'مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً')} غير ${noDue.length === 1 ? 'مكتمل' : 'مكتملة'} بلا تاريخ تسليم، فلا يظهر في التقويم: `,
          noDue.slice(0, 6).map((r, i) => [i ? '، ' : '', h('a', { href: `#/project/${r.p.id}/settings` }, r.p.client)]), noDue.length > 6 ? '…' : '') : null,
        h('section', { class: 'cal-sec cal-arch' },
          h('div', { class: 'd2-plan-head' }, h('h2', null, 'سُلّمت مؤخراً'),
            h('span', { class: 'd2-note' }, withDue ? `${num(onTime)} من ${num(withDue)} بوقتها` + (lateDays.length ? `، ومتوسط التأخير ${A.daysAr(Math.round(lateDays.reduce((a, x) => a + x, 0) / lateDays.length))}` : '') : `آخر ${A.daysAr(ARCHIVE_DAYS)}`)),
          ar.length ? h('ol', { class: 'ev-list arch' }, ar.map((x) => h('li', { class: 'ev ' + (x.diff === null ? 'imp-l' : x.diff >= 0 ? 'ok' : 'imp-h') },
            h('span', { class: 'ev-date' }, h('b', null, wd(x.end)), h('span', { dir: 'ltr' }, x.end)),
            h('span', { class: 'ev-dot' }),
            h('span', { class: 'ev-main' }, h('span', { class: 'ev-title' }, h('a', { href: '#/project/' + x.r.p.id }, h('b', null, x.r.p.client))),
              h('small', { class: 'ev-why' }, x.diff === null ? 'بلا تاريخ تسليم' : x.diff > 0 ? `قبل الموعد بـ${A.daysAr(x.diff)} (التسليم ${x.r.p.due_date})`
                : x.diff === 0 ? 'في يوم التسليم' : `بعد الموعد بـ${A.daysAr(-x.diff)} (التسليم ${x.r.p.due_date})`)))))
            : h('p', { class: 'calm muted' }, 'لم يكتمل أي مشروع في هذه الفترة.')),
        h('p', { class: 'd2-note' }, '"التوقّع" يحسب متى ينتهي المشروع لو استمر بنفس سرعته منذ بدء العمل: الأيام المنقضية ÷ نسبة الإنجاز. تقريبي، ويتحسّن كلما تقدّم المشروع.'));
    }
  };

  /* ---------- ملخّص الصباح ---------- */
  async function brief() {
    let rows;
    try { rows = await loadRows(); } catch (e) { return A.fail(e); }
    const t = A.todayStr();
    const y = new Date(); y.setHours(0, 0, 0, 0); y.setDate(y.getDate() - 1);
    const cp = Object.fromEntries(S.checkpoints.map((c) => [c.key, c.name_ar]));
    const moved = [];
    S.projects.forEach((p) => Object.values(S.stages[p.id] || {}).forEach((x) => {
      if (x.updated_at && new Date(x.updated_at) >= y && (x.status === 'done' || x.status === 'in_progress')) moved.push({ p, x });
    }));
    const done = moved.filter((m) => m.x.status === 'done'), started = moved.filter((m) => m.x.status === 'in_progress');
    const pend = (S.requests || []).filter((r) => r.status === 'pending' && S.projects.some((p) => p.id === r.project_id));
    const late = rows.filter((r) => r.status !== 'done' && r.sc?.has && (r.sc.late || r.sc.behind || (r.fc && r.fc.diff !== null && r.fc.diff < 0)))
      .sort((a, b) => (b.sc.late - a.sc.late) || a.sc.daysLeft - b.sc.daysLeft);
    const { end1 } = weekEnds(t);
    const week = events(rows).filter((e) => e.date >= t && e.date <= end1);
    const stalled = rows.filter((r) => !r.compound && r.status === 'in_progress' && r.sp?.last && Math.floor((Date.now() - new Date(r.sp.last)) / A.DAY) >= A.STALL_DAYS);
    const by = (st) => rows.filter((r) => r.status === st).length;
    const avg = rows.length ? rows.reduce((a, r) => a + r.pct, 0) / rows.length : 0;
    const bul = (xs) => xs.map((x) => '• ' + x);

    // ما تحرّك منذ أمس، مجمّعاً لكل مشروع
    const perProj = new Map();
    moved.sort((a, b) => (a.x.updated_at < b.x.updated_at ? -1 : 1)).forEach((m) => {
      if (!perProj.has(m.p.id)) perProj.set(m.p.id, { p: m.p, done: [], started: [] });
      perProj.get(m.p.id)[m.x.status === 'done' ? 'done' : 'started'].push(cp[m.x.checkpoint]);
    });
    const names = (xs) => (xs.length <= 3 ? xs.join('، ') : `${stagesN(xs.length)}، آخرها ${xs[xs.length - 1]}`);
    const lines = [
      'ملخّص الصباح - مشاريع سرور',
      `${wd(t)} ${t}`,
      '',
      moved.length ? `منذ أمس: اكتملت ${stagesN(done.length)}، وبدأت ${stagesN(started.length)}` : 'منذ أمس: لم تتحرك أي مرحلة.',
      ...bul([...perProj.values()].map((x) => `${x.p.client}: ` + [x.done.length ? `اكتملت ${names(x.done)}` : '', x.started.length ? `بدأت ${names(x.started)}` : ''].filter(Boolean).join('، و'))),
      ''
    ];
    if (pend.length) lines.push(`تقارير الفنيين بانتظار موافقتك: ${num(pend.length)}`, ...bul(pend.slice(0, 8).map((r) => `${S.projects.find((p) => p.id === r.project_id).client}: ${r.action === 'done' ? 'اكتملت' : 'بدأت'} ${cp[r.checkpoint]}`)), '');
    lines.push(late.length ? `تحتاج متابعة (${num(late.length)}):` : 'لا مشاريع متأخرة.',
      ...bul(late.slice(0, 10).map((r) => `${r.p.client}: ` + [r.sc.late ? `متأخر ${A.daysAr(-r.sc.daysLeft)} عن التسليم` : r.sc.behind ? `متأخر عن الجدول (${A.pctText(r.pct)} والمتوقع ${A.pctText(r.sc.expected)})` : '',
        r.fc && r.fc.diff !== null && r.fc.diff < 0 ? A.forecastText(r.fc, true) : ''].filter(Boolean).join('، '))), '');
    lines.push(week.length ? `مواعيد الأيام السبعة القادمة (${num(week.length)}):` : 'لا مواعيد خلال الأيام السبعة القادمة.',
      ...bul(week.map((e) => `${wd(e.date)} ${e.date}: ${e.title} - ${e.r.p.client}` + (e.kind === 'due' ? ` (الإنجاز ${A.pctText(e.r.pct)})` : ''))));
    if (stalled.length) lines.push('', `لم تتحرك منذ ${A.daysAr(A.STALL_DAYS)} أو أكثر: ${stalled.map((r) => r.p.client).join('، ')}`);
    lines.push('', `الإجمالي: ${cnt(rows.length, 'مشروع واحد', 'مشروعان', 'مشاريع', 'مشروعاً')}، جارٍ ${num(by('in_progress'))}، مكتمل ${num(by('done'))}، لم يبدأ ${num(by('not_started'))}. متوسط الإنجاز ${A.pctText(avg)}`);

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');
    const area = h('textarea', { rows: 16, readonly: true, value: text, class: 'report-text' });
    const actions = [{ label: 'نسخ', run: async () => {
      try { await navigator.clipboard.writeText(text); } catch (e) { area.select(); document.execCommand('copy'); }
      toast('تم النسخ'); return false;
    } }];
    if (navigator.share) actions.push({ label: 'مشاركة', run: async () => { try { await navigator.share({ text }); } catch (e) { /* أُلغيت */ } return false; } });
    A.modal('ملخّص الصباح', h('div', { class: 'stack sm' }, area,
      h('a', { class: 'btn wa', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener noreferrer' }, 'إرسال عبر واتساب'),
      h('p', { class: 'muted small' }, '"منذ أمس" = من بداية يوم أمس. المجمّعات لها تقرير يومي خاص من صفحة المجمّع.')), actions);
  }

  window.Plan = { brief, events };
})();
