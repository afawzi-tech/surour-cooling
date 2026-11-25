/* ==========================================================
   شاشات فحص الجودة - على شكل ملف VRF QC Tracker
   لوحة المشروع، متابعة الوحدات، سجل القراءات، سجل عدم المطابقة،
   المواد، الإعدادات، صفحة الوحدة، حدود الفحص، واستيراد/تصدير Excel.
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, toast, confirmBox, num, date, dateTime } = window.UI;
  const A = window.App;
  const S = A.state;
  const X = window.XLSX_LITE;

  const RES_SHORT = { pass: '✓', fail: '✗', pending: '…', na: '—' };
  const RES_FROM = { pass: 'pass', fail: 'fail', 'n/a': 'na', na: 'na', pending: 'pending',
    'ناجح': 'pass', 'فاشل': 'fail', 'لا ينطبق': 'na', 'معلّق': 'pending', 'معلق': 'pending' };
  const today = () => new Date().toISOString().slice(0, 10);
  const cpBy = (key) => S.checkpoints.find((c) => c.key === key);
  const projectOf = (id) => S.projects.find((p) => p.id === id);
  const n2 = (v, d = 2) => (v === null || v === undefined ? '' : Number(v).toFixed(d));
  const okChip = (v) => (v === null || v === undefined ? '' : h('span', { class: 'okc ' + (v ? 'ok' : 'check') }, v ? 'OK' : 'CHECK'));

  async function profileNames() {
    if (S._names) return S._names;
    const { data } = await S.sb.from('profiles').select('id, full_name');
    S._names = Object.fromEntries((data || []).map((u) => [u.id, u.full_name]));
    return S._names;
  }

  /* ==========================================================
     صفحة المشروع
     ========================================================== */
  const TABS = [
    ['dashboard', 'لوحة المشروع'],
    ['tracker', 'متابعة الوحدات'],
    ['tests', 'سجل القراءات'],
    ['ncr', 'عدم المطابقة (NCR)'],
    ['materials', 'المواد'],
    ['settings', 'الإعدادات', A.isStaff]
  ];

  A.views.project = {
    title: (r) => projectOf(r.id)?.client || 'المشروع',
    render(r) {
      const p = projectOf(r.id);
      if (!p) return A.empty('المشروع غير موجود', 'ربما حُذف أو ليست لديك صلاحية لرؤيته.', h('a', { href: '#/projects', class: 'btn' }, 'العودة للمشاريع'));
      const tab = TABS.find((t) => t[0] === r.tab && (!t[2] || t[2]())) ? r.tab : 'dashboard';
      const c = A.projectCalc(p);
      const body = { dashboard: tabDashboard, tracker: tabTracker, tests: tabTests, ncr: tabNcr, materials: tabMaterials, settings: tabSettings }[tab](p, c);

      const head = h('section', { class: 'card hero' },
        h('div', { class: 'hero-head' },
          h('div', null,
            h('a', { href: '#/projects', class: 'link small' }, '→ المشاريع'),
            h('h2', null, p.client, ' ', A.brandChip(p.brand)),
            h('p', { class: 'muted' }, [p.address, 'تاريخ العقد ' + date(p.contract_date), num(c.total) + ' وحدة'].filter(Boolean).join(' · '))),
          h('div', { class: 'row' },
            A.isStaff() ? h('button', { type: 'button', class: 'btn', onClick: () => exportExcel(p) }, '⬇ Excel') : null,
            A.isStaff() ? h('a', { href: '#/edit/' + p.id, class: 'btn' }, 'تعديل') : null)),
        h('div', { class: 'hero-progress' }, A.progress(c.pct), h('strong', null, A.pctText(c.pct))),
        h('nav', { class: 'tabs', 'aria-label': 'أقسام المشروع' },
          TABS.filter((t) => !t[2] || t[2]()).map(([k, l]) =>
            h('a', { href: `#/project/${p.id}/${k}`, class: 'tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'page' : null }, l))));

      const wrap = h('div', { class: 'stack' }, head, h('div', { class: 'tab-body' }, A.empty('…')));
      const place = (node) => { const tb = wrap.querySelector('.tab-body'); clear(tb).appendChild(node); };
      if (body instanceof Promise) body.then(place, (e) => { A.fail(e); place(A.empty('تعذّر التحميل')); });
      else place(body);
      return wrap;
    }
  };

  /* ---------- لوحة المشروع (ورقة Dashboard) ---------- */
  function tabDashboard(p, c) {
    const cps = S.checkpoints;
    const rows = cps.map((cp) => {
      const cnt = { pass: 0, fail: 0, pending: 0, na: 0 };
      c.units.forEach((u) => { cnt[u.results?.[cp.key] || 'pending']++; });
      const base = c.total - cnt.na;
      return { cp, cnt, pct: base > 0 ? cnt.pass / base : 0 };
    });
    const groupBy = (key) => {
      const m = new Map();
      c.units.forEach((u, i) => {
        const g = u[key] || '—';
        if (!m.has(g)) m.set(g, []);
        m.get(g).push(c.calcs[i]);
      });
      return [...m.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'ar'));
    };
    const groupTable = (title, key) => {
      const g = groupBy(key);
      if (g.length <= 1 && g[0]?.[0] === '—') return null;
      return h('section', { class: 'card' }, h('h2', null, title),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
          h('thead', null, h('tr', null, h('th', null, key === 'zone' ? 'المنطقة' : 'الفرقة'), h('th', null, 'الوحدات'), h('th', null, 'مكتملة'), h('th', null, 'بها فشل'), h('th', { class: 'w-prog' }, 'متوسط الإنجاز'))),
          h('tbody', null, g.map(([name, list]) => {
            const avg = list.reduce((s, x) => s + x.pct, 0) / list.length;
            return h('tr', null, h('td', null, name), h('td', null, num(list.length)),
              h('td', null, num(list.filter((x) => x.status === 'complete').length)),
              h('td', { class: list.some((x) => x.status === 'has_failure') ? 'bad' : '' }, num(list.filter((x) => x.status === 'has_failure').length)),
              h('td', null, h('div', { class: 'prog-cell' }, A.progress(avg), h('small', null, A.pctText(avg)))));
          })))));
    };

    const info = [
      ['العميل', p.client], ['البراند', A.brandChip(p.brand) || '—'], ['الهاتف', p.phone ? h('span', { dir: 'ltr' }, p.phone) : '—'],
      ['الموقع', p.map_url ? h('a', { href: p.map_url, target: '_blank', rel: 'noopener noreferrer' }, 'فتح الخريطة') : '—'],
      ['المساحة', p.size_m2 ? num(p.size_m2) + ' م²' : '—'], ['الطوابق', p.floors ?? '—']
    ];
    if (A.isStaff()) info.push(['قيمة العقد', A.totalOf(p) != null ? num(A.totalOf(p)) + ' د.ع' : '—']);

    return h('div', { class: 'stack' },
      h('section', { class: 'kpis' },
        A.kpi('الوحدات', num(c.total)),
        A.kpi('مكتملة بالكامل', num(c.complete), 'tone-done'),
        A.kpi('جارية', num(c.inProgress), 'tone-doing'),
        A.kpi('لم تبدأ', num(c.notStarted)),
        A.kpi('بها مرحلة فاشلة', num(c.withFailure), 'tone-fail'),
        A.kpi('تنبيهات التسلسل', num(c.alerts), 'tone-fail'),
        A.kpi('NCR مفتوحة', num(c.openNcrs), 'tone-fail'),
        A.kpi('نسبة الإنجاز الكلية', A.pctText(c.pct))),
      c.alerts ? h('section', { class: 'card alert-card' },
        h('h2', null, '⚠ تنبيهات التسلسل'),
        h('p', { class: 'muted' }, 'مراحل مسجّلة "ناجحة" قبل نجاح المراحل التي يجب أن تسبقها. راجعها في الموقع.'),
        h('ul', null, c.units.map((u, i) => c.calcs[i].alerts.length
          ? h('li', null, h('a', { href: '#/unit/' + u.id, class: 'strong-link' }, u.code), ': ',
              c.calcs[i].alerts.map((a) => `${a.name_ar} (قبل: ${(a.prereqs || []).filter((k) => !['pass', 'na'].includes(u.results?.[k] || 'pending')).map((k) => cpBy(k)?.name_ar).join('، ')})`).join(' · '))
          : null))) : null,
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'التقدّم حسب المرحلة'),
          h('span', { class: 'muted small' }, 'المرحلة الفاشلة أو المعلّقة تمنع ما بعدها')),
        h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
          h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'المرحلة'), h('th', null, 'ناجح'), h('th', null, 'فاشل'),
            h('th', null, 'معلّق'), h('th', null, 'لا ينطبق'), h('th', { class: 'w-prog' }, '% النجاح (بدون لا ينطبق)'))),
          h('tbody', null, rows.map(({ cp, cnt, pct }) => h('tr', null,
            h('td', { class: 'muted' }, String(cp.position)),
            h('td', null, cp.name_ar, h('div', { class: 'muted small', dir: 'ltr' }, cp.itp_ref || '')),
            h('td', { class: 'c-pass' }, num(cnt.pass)), h('td', { class: cnt.fail ? 'c-fail' : '' }, num(cnt.fail)),
            h('td', null, num(cnt.pending)), h('td', { class: 'muted' }, num(cnt.na)),
            h('td', null, h('div', { class: 'prog-cell' }, A.progress(pct), h('small', null, A.pctText(pct)))))))))),
      h('div', { class: 'grid-2' }, groupTable('حسب المنطقة', 'zone'), groupTable('حسب الفرقة', 'crew')),
      h('section', { class: 'card' }, h('h2', null, 'بيانات العقد'),
        h('dl', { class: 'info' }, info.map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v)))),
        p.notes ? h('p', { class: 'notes' }, p.notes) : null));
  }

  /* ---------- متابعة الوحدات (ورقة Villa Tracker) ---------- */
  function tabTracker(p, c) {
    const f = S.unitFilter[p.id] || (S.unitFilter[p.id] = { q: '', zone: '', crew: '', status: '', next: '', alerts: false });
    const cps = S.checkpoints;
    const zones = [...new Set(c.units.map((u) => u.zone).filter(Boolean))].sort();
    const crews = [...new Set(c.units.map((u) => u.crew).filter(Boolean))].sort();
    const box = h('div', { class: 'table-wrap tracker-wrap' });
    const countEl = h('span', { class: 'muted small' });

    const draw = () => {
      const q = f.q.trim().toLowerCase();
      const idx = c.units.map((u, i) => i).filter((i) => {
        const u = c.units[i], k = c.calcs[i];
        return (!q || u.code.toLowerCase().includes(q) || String(u.remarks || '').toLowerCase().includes(q))
          && (!f.zone || u.zone === f.zone) && (!f.crew || u.crew === f.crew)
          && (!f.status || k.status === f.status)
          && (!f.next || (f.next === '-' ? !k.next : k.next?.key === f.next))
          && (!f.alerts || k.alerts.length);
      });
      countEl.textContent = `${num(idx.length)} من ${num(c.total)} وحدة`;
      clear(box).appendChild(idx.length ? trackerTable(p, c, idx) : A.empty(c.total ? 'لا توجد وحدات مطابقة للتصفية' : 'لا توجد وحدات بعد',
        c.total ? '' : 'أضف الوحدات من تبويب الإعدادات.'));
    };
    const sel = (key, label, opts) => h('select', { class: 'auto', 'aria-label': label, onChange: (e) => { f[key] = e.target.value; draw(); } },
      h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));

    draw();
    return h('section', { class: 'card' },
      h('div', { class: 'toolbar' },
        h('input', { type: 'search', placeholder: 'ابحث برقم الوحدة أو الملاحظات', value: f.q, 'aria-label': 'بحث', onInput: (e) => { f.q = e.target.value; draw(); } }),
        zones.length ? sel('zone', 'كل المناطق', zones.map((z) => [z, z])) : null,
        crews.length ? sel('crew', 'كل الفرق', crews.map((z) => [z, z])) : null,
        sel('status', 'كل الحالات', Object.entries(A.UNIT_STATUS)),
        sel('next', 'الخطوة التالية', cps.map((cp) => [cp.key, cp.name_ar]).concat([['-', 'لا شيء (مكتملة)']])),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.alerts, onChange: (e) => { f.alerts = e.target.checked; draw(); } }), h('span', null, 'التنبيهات فقط'))),
      h('div', { class: 'row between' }, countEl,
        h('div', { class: 'legend' }, ['pass', 'fail', 'pending', 'na'].map((r) => h('span', { class: 'lg-item' }, h('span', { class: 'cell res-' + r }, RES_SHORT[r]), A.RESULTS[r])))),
      box,
      A.isStaff() ? h('p', { class: 'muted small' }, 'اضغط على أي خانة لتغيير نتيجتها. الخادم يرفض اعتماد مرحلة قبل نجاح ما يسبقها.') : null);
  }

  function trackerTable(p, c, idx) {
    const cps = S.checkpoints;
    const staff = A.isStaff();
    return h('table', { class: 'tracker' },
      h('thead', null,
        h('tr', { class: 'itp' }, h('th', { class: 'sticky' }), h('th'), h('th'), cps.map((cp) => h('th', { dir: 'ltr' }, cp.itp_ref || '')), h('th', { colspan: 8 })),
        h('tr', null,
          h('th', { class: 'sticky' }, 'الوحدة'), h('th', null, 'المنطقة'), h('th', null, 'الفرقة'),
          cps.map((cp) => h('th', { class: 'cp-h', title: cp.name_en }, h('span', null, cp.name_ar))),
          h('th', null, 'ناجح'), h('th', null, 'فاشل'), h('th', null, '% الإنجاز'), h('th', null, 'NCR'),
          h('th', null, 'الحالة'), h('th', null, 'الخطوة التالية'), h('th', null, 'تنبيه'), h('th', null, 'ملاحظات'))),
      h('tbody', null, idx.map((i) => {
        const u = c.units[i], k = c.calcs[i];
        const alertKeys = new Set(k.alerts.map((a) => a.key));
        return h('tr', null,
          h('td', { class: 'sticky' }, h('a', { href: '#/unit/' + u.id, class: 'strong-link' }, u.code), u.brand && u.brand !== p.brand ? A.brandChip(u.brand) : null),
          h('td', null, u.zone || ''), h('td', null, u.crew || ''),
          cps.map((cp) => {
            const r = u.results?.[cp.key] || 'pending';
            const props = { class: 'cell res-' + r + (alertKeys.has(cp.key) ? ' warn' : ''), title: `${u.code} · ${cp.name_ar}: ${A.RESULTS[r]}` };
            return h('td', null, staff
              ? h('button', { type: 'button', ...props, 'aria-label': props.title, onClick: () => editResult(p, u, cp) }, RES_SHORT[r])
              : h('span', props, RES_SHORT[r]));
          }),
          h('td', { class: 'num' }, String(k.passed)),
          h('td', { class: 'num' + (k.failed ? ' bad' : '') }, String(k.failed)),
          h('td', { class: 'num' }, A.pctText(k.pct)),
          h('td', { class: 'num' + (u.open_ncrs ? ' bad' : '') }, String(u.open_ncrs || 0)),
          h('td', null, A.statusChip(k.status)),
          h('td', null, k.next ? k.next.name_ar : '-'),
          h('td', null, k.alerts.length ? h('span', { class: 'seq-alert', title: k.alerts.map((a) => a.name_ar).join('، ') }, 'تنبيه تسلسل') : ''),
          h('td', { class: 'remarks' }, u.remarks || ''));
      })));
  }

  // نافذة تغيير نتيجة مرحلة
  async function editResult(p, u, cp) {
    const { data: row, error } = await S.sb.from('unit_checks').select('*').eq('unit_id', u.id).eq('checkpoint', cp.key).maybeSingle();
    if (error || !row) return A.fail(error || 'غير موجود');
    const names = await profileNames();
    let chosen = row.result;
    const btns = h('div', { class: 'res-pick', role: 'radiogroup', 'aria-label': 'النتيجة' },
      ['pass', 'fail', 'pending', 'na'].map((r) => h('button', {
        type: 'button', class: 'pick res-' + r + (r === chosen ? ' on' : ''), role: 'radio', 'aria-checked': String(r === chosen),
        onClick: (e) => {
          chosen = r;
          btns.querySelectorAll('.pick').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
          e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-checked', 'true');
        }
      }, RES_SHORT[r] + ' ' + A.RESULTS[r])));
    const notes = h('textarea', { rows: 3, maxlength: 2000, value: row.notes || '', placeholder: 'ملاحظات الفحص (عند الفشل تصبح وصف NCR تلقائياً)' });
    const pre = (cp.prereqs || []).map((k) => {
      const r = u.results?.[k] || 'pending';
      return h('span', { class: 'pre ' + (['pass', 'na'].includes(r) ? 'ok' : 'no') }, cpBy(k)?.name_ar + ': ' + A.RESULTS[r]);
    });
    const needReading = p.require_readings && ['pressure_test', 'vacuum', 'charging'].includes(cp.key);
    A.modal(`${u.code} · ${cp.name_ar}`,
      h('div', { class: 'stack sm' },
        h('p', { class: 'muted small', dir: 'ltr' }, cp.itp_ref || ''),
        pre.length ? h('div', { class: 'pres' }, h('small', { class: 'muted' }, 'يشترط قبلها: '), pre) : null,
        needReading ? h('p', { class: 'muted small' }, 'الاعتماد يحتاج قراءة مقبولة في سجل القراءات.') : null,
        btns, A.field('ملاحظات', notes),
        row.inspected_at ? h('p', { class: 'muted small' }, `آخر تعديل: ${names[row.inspected_by] || '—'} · ${dateTime(row.inspected_at)}`) : null),
      [{ label: 'حفظ', cls: 'primary', run: async () => {
        const res = await S.sb.from('unit_checks').update({ result: chosen, notes: notes.value.trim() || null })
          .eq('unit_id', u.id).eq('checkpoint', cp.key).select().maybeSingle();
        if (res.error || !res.data) { A.fail(res.error || 'permission denied'); return false; }
        await A.reloadUnit(u.id);
        toast(`${u.code} · ${cp.name_ar}: ${A.RESULTS[chosen]}` + (chosen === 'fail' ? ' (فُتحت NCR تلقائياً)' : ''));
        A.render();
      } }]);
  }

  /* ---------- سجل القراءات (ورقة Test Records) ---------- */
  async function loadTests(projectId, unitId) {
    let q = S.sb.from('test_records').select('*, units!inner(code, project_id)').order('created_at', { ascending: false });
    q = unitId ? q.eq('unit_id', unitId) : q.eq('units.project_id', projectId);
    return A.fetchAll((a, b) => q.range(a, b));
  }

  function limitsBanner(brands) {
    return h('div', { class: 'limits' }, brands.filter(Boolean).map((b) => {
      const l = S.limits[b];
      if (!l) return null;
      return h('div', { class: 'limit-box' + (l.confirmed ? '' : ' unconfirmed') },
        h('strong', null, 'حدود ', A.brandChip(b)),
        h('span', null, `هبوط الضغط ≤ ${l.pressure_drop_max} MPa`),
        h('span', null, `فاكيوم ≤ ${l.vacuum_max_microns} مايكرون، ثبات ≥ ${l.vacuum_hold_min} د، ارتفاع ≤ ${l.vacuum_rise_max}`),
        h('span', null, `فرق الشحن ≤ ${Math.round(l.charge_tolerance * 1000) / 10}%`),
        l.confirmed ? null : h('small', null, '⚠ قيم تقريبية لم تُراجع مع كتالوج الشركة — ', h('a', { href: '#/limits' }, 'حدود الفحص')));
    }));
  }

  function testsTable(list, names, showUnit = true) {
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table compact tests' },
      h('thead', null,
        h('tr', null, showUnit ? h('th', { rowspan: 2 }, 'الوحدة') : null, h('th', { rowspan: 2 }, 'النظام'),
          h('th', { colspan: 6, class: 'grp' }, 'فحص الضغط'), h('th', { colspan: 5, class: 'grp' }, 'الفاكيوم'),
          h('th', { colspan: 4, class: 'grp' }, 'الشحن'), h('th', { rowspan: 2 }, 'الأسطوانة'), h('th', { rowspan: 2 }, 'الفاحص')),
        h('tr', null,
          h('th', null, 'التاريخ'), h('th', null, 'بداية MPa'), h('th', null, 'نهاية MPa'), h('th', null, 'الحرارة °م'), h('th', null, 'الهبوط'), h('th', null, 'النتيجة'),
          h('th', null, 'التاريخ'), h('th', null, 'مايكرون'), h('th', null, 'ثبات د'), h('th', null, 'ارتفاع'), h('th', null, 'النتيجة'),
          h('th', null, 'محسوب كغ'), h('th', null, 'فعلي كغ'), h('th', null, 'الفرق'), h('th', null, 'النتيجة'))),
      h('tbody', null, list.map((t) => h('tr', null,
        showUnit ? h('td', null, h('a', { href: '#/unit/' + t.unit_id, class: 'strong-link' }, t.units?.code)) : null,
        h('td', { dir: 'ltr' }, t.system_id),
        h('td', { dir: 'ltr' }, t.pressure_date || ''), h('td', { class: 'num' }, n2(t.start_mpa, 3)), h('td', { class: 'num' }, n2(t.end_mpa, 3)),
        h('td', { class: 'num' }, t.start_temp_c != null ? `${t.start_temp_c}→${t.end_temp_c}` : ''),
        h('td', { class: 'num' }, n2(t.pressure_drop, 3)), h('td', null, okChip(t.pressure_ok)),
        h('td', { dir: 'ltr' }, t.vacuum_date || ''), h('td', { class: 'num' }, t.vacuum_microns ?? ''), h('td', { class: 'num' }, t.vacuum_hold_min ?? ''),
        h('td', { class: 'num' }, t.vacuum_rise ?? ''), h('td', null, okChip(t.vacuum_ok)),
        h('td', { class: 'num' }, n2(t.charge_calc_kg)), h('td', { class: 'num' }, n2(t.charge_actual_kg)),
        h('td', { class: 'num' }, t.charge_variance != null ? (Math.round(t.charge_variance * 1000) / 10) + '%' : ''), h('td', null, okChip(t.charge_ok)),
        h('td', { dir: 'ltr' }, t.cylinder_no || ''), h('td', null, names[t.inspector] || '—'))))));
  }

  async function tabTests(p, c) {
    const [list, names] = await Promise.all([loadTests(p.id), profileNames()]);
    const brands = [...new Set([p.brand, ...c.units.map((u) => u.brand)])];
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'سجل القراءات'),
        c.total ? h('button', { type: 'button', class: 'btn primary', onClick: () => addTest(p, c.units) }, '+ قراءة جديدة') : null),
      limitsBanner(brands),
      list.length ? testsTable(list, names) : A.empty('لا توجد قراءات بعد', 'سجّل قراءات فحص الضغط والفاكيوم والشحن لكل وحدة.'),
      h('p', { class: 'muted small' }, 'القراءة غير المقبولة تجعل المرحلة "فاشلة" وتفتح NCR تلقائياً. إذا أدخلت حرارة البداية والنهاية يُصحَّح هبوط الضغط حسب الحرارة.'));
  }

  function addTest(p, units, fixedUnit) {
    const num_ = (attrs = {}) => h('input', { type: 'number', step: 'any', min: 0, dir: 'ltr', ...attrs });
    const f = {
      unit: h('select', null, units.map((u) => h('option', { value: u.id, selected: fixedUnit === u.id }, u.code))),
      system_id: h('input', { dir: 'ltr', value: 'ODU-01', maxlength: 40 }),
      pressure_date: h('input', { type: 'date', dir: 'ltr', value: today() }),
      test_pressure: num_(), hold_hours: num_(), start_mpa: num_(), end_mpa: num_(),
      start_temp_c: num_({ min: -30 }), end_temp_c: num_({ min: -30 }),
      vacuum_date: h('input', { type: 'date', dir: 'ltr' }),
      vacuum_microns: num_({ step: 1 }), vacuum_hold_min: num_({ step: 1 }), vacuum_rise: num_({ step: 1 }),
      charge_calc_kg: num_(), charge_actual_kg: num_(),
      cylinder_no: h('input', { dir: 'ltr', maxlength: 60 }),
      notes: h('textarea', { rows: 2, maxlength: 2000 })
    };
    const grp = (title, ...fields) => h('fieldset', { class: 'checks' }, h('legend', null, title), h('div', { class: 'form-grid compact' }, fields));
    A.modal('قراءة فحص جديدة', h('div', { class: 'stack sm' },
      h('div', { class: 'form-grid' }, A.field('الوحدة', f.unit), A.field('الوحدة الخارجية / النظام', f.system_id)),
      grp('فحص الضغط', A.field('التاريخ', f.pressure_date), A.field('ضغط الفحص MPa', f.test_pressure), A.field('مدة الثبات (ساعة)', f.hold_hours),
        A.field('البداية MPa', f.start_mpa), A.field('النهاية MPa', f.end_mpa), h('span'),
        A.field('حرارة البداية °م', f.start_temp_c), A.field('حرارة النهاية °م', f.end_temp_c)),
      grp('الفاكيوم', A.field('التاريخ', f.vacuum_date), A.field('الفاكيوم (مايكرون)', f.vacuum_microns),
        A.field('مدة الثبات (دقيقة)', f.vacuum_hold_min), A.field('الارتفاع (مايكرون)', f.vacuum_rise)),
      grp('شحن الفريون', A.field('الكمية المحسوبة كغ', f.charge_calc_kg), A.field('الكمية الفعلية كغ', f.charge_actual_kg), A.field('رقم الأسطوانة', f.cylinder_no)),
      A.field('ملاحظات', f.notes)),
      [{ label: 'حفظ القراءة', cls: 'primary', run: async () => {
        const v = (k) => (f[k].value.trim() === '' ? null : f[k].value.trim());
        const nv = (k) => (v(k) === null ? null : Number(v(k)));
        const row = {
          unit_id: f.unit.value, system_id: v('system_id') || 'ODU-01',
          pressure_date: v('pressure_date'), test_pressure: nv('test_pressure'), hold_hours: nv('hold_hours'),
          start_mpa: nv('start_mpa'), end_mpa: nv('end_mpa'), start_temp_c: nv('start_temp_c'), end_temp_c: nv('end_temp_c'),
          vacuum_date: v('vacuum_date'), vacuum_microns: nv('vacuum_microns'), vacuum_hold_min: nv('vacuum_hold_min'), vacuum_rise: nv('vacuum_rise'),
          charge_calc_kg: nv('charge_calc_kg'), charge_actual_kg: nv('charge_actual_kg'), cylinder_no: v('cylinder_no'), notes: v('notes')
        };
        if ([row.start_mpa, row.end_mpa, row.vacuum_microns, row.charge_calc_kg, row.charge_actual_kg].every((x) => x === null)) {
          toast('أدخل قراءة واحدة على الأقل (الضغط أو الفاكيوم أو الشحن)', 'error'); return false;
        }
        if ((row.start_mpa === null) !== (row.end_mpa === null)) { toast('أدخل ضغط البداية والنهاية معاً', 'error'); return false; }
        if ((row.start_temp_c === null) !== (row.end_temp_c === null)) { toast('أدخل حرارة البداية والنهاية معاً أو اتركهما فارغتين', 'error'); return false; }
        if (row.vacuum_date === null && row.vacuum_microns !== null) row.vacuum_date = today();
        if (row.start_mpa === null) { row.pressure_date = null; row.test_pressure = null; row.hold_hours = null; }
        const res = await S.sb.from('test_records').insert(row).select().single();
        if (res.error) { A.fail(res.error); return false; }
        const t = res.data;
        const bad = [t.pressure_ok === false && 'الضغط', t.vacuum_ok === false && 'الفاكيوم', t.charge_ok === false && 'الشحن'].filter(Boolean);
        await A.reloadUnit(row.unit_id);
        toast(bad.length ? `قراءة غير مقبولة (${bad.join('، ')}): المرحلة صارت فاشلة وفُتحت NCR` : 'تم حفظ القراءة، والنتائج مقبولة', bad.length ? 'error' : 'ok');
        A.render();
      } }]);
  }

  /* ---------- سجل عدم المطابقة (ورقة NCR Register) ---------- */
  async function loadNcrs(projectId, unitId) {
    let q = S.sb.from('ncrs').select('*').order('ncr_no', { ascending: false });
    q = unitId ? q.eq('unit_id', unitId) : q.eq('project_id', projectId);
    return A.fetchAll((a, b) => q.range(a, b));
  }

  const ncrNo = (n) => 'NCR-' + String(n).padStart(3, '0');

  function ncrTable(list, unitCode, names) {
    const staff = A.isStaff();
    return h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
      h('thead', null, h('tr', null, h('th', null, 'الرقم'), h('th', null, 'التاريخ'), h('th', null, 'الوحدة'), h('th', null, 'المرحلة'),
        h('th', null, 'الوصف'), h('th', null, 'المسؤول'), h('th', null, 'الموعد'), h('th', null, 'الحالة'), h('th', null, 'الإغلاق'), staff ? h('th') : null)),
      h('tbody', null, list.map((n) => {
        const overdue = n.status === 'open' && n.due_date && n.due_date < today();
        return h('tr', { class: overdue ? 'overdue' : '' },
          h('td', { dir: 'ltr', class: 'strong' }, ncrNo(n.ncr_no)),
          h('td', { dir: 'ltr' }, date(n.raised_at)),
          h('td', null, h('a', { href: '#/unit/' + n.unit_id, class: 'strong-link' }, unitCode[n.unit_id] || '—')),
          h('td', null, cpBy(n.checkpoint)?.name_ar),
          h('td', { class: 'desc' }, n.description, n.closure_note ? h('div', { class: 'muted small' }, 'الإجراء: ' + n.closure_note) : null),
          h('td', null, n.responsible || ''),
          h('td', { dir: 'ltr', class: overdue ? 'bad' : '' }, n.due_date || '', overdue ? ' ⚠' : ''),
          h('td', null, h('span', { class: 'badge ' + (n.status === 'open' ? 'delete' : 'insert') }, n.status === 'open' ? 'مفتوحة' : 'مغلقة')),
          h('td', null, n.closed_at ? h('span', { class: 'small' }, date(n.closed_at), h('div', { class: 'muted small' }, names[n.closed_by] || '')) : ''),
          staff ? h('td', null, n.status === 'open'
            ? h('button', { type: 'button', class: 'btn sm', onClick: () => closeNcr(n) }, 'إغلاق')
            : h('button', { type: 'button', class: 'btn ghost sm', onClick: () => reopenNcr(n) }, 'إعادة فتح')) : null);
      }))));
  }

  async function tabNcr(p, c) {
    const [list, names] = await Promise.all([loadNcrs(p.id), profileNames()]);
    const unitCode = Object.fromEntries(c.units.map((u) => [u.id, u.code]));
    const f = S.unitFilter['ncr' + p.id] || (S.unitFilter['ncr' + p.id] = { status: 'open' });
    const box = h('div');
    const draw = () => {
      const l = list.filter((n) => f.status === 'all' || n.status === f.status);
      clear(box).appendChild(l.length ? ncrTable(l, unitCode, names) : A.empty(f.status === 'open' ? 'لا توجد حالات مفتوحة 👍' : 'لا توجد حالات'));
    };
    const seg = h('div', { class: 'seg' }, [['open', 'المفتوحة'], ['closed', 'المغلقة'], ['all', 'الكل']].map(([v, l]) =>
      h('button', { type: 'button', class: f.status === v ? 'on' : '', onClick: (e) => {
        f.status = v; seg.querySelectorAll('button').forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); draw();
      } }, l)));
    draw();
    const overdue = list.filter((n) => n.status === 'open' && n.due_date && n.due_date < today()).length;
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'سجل عدم المطابقة'),
        A.isStaff() && c.total ? h('button', { type: 'button', class: 'btn primary', onClick: () => addNcr(p, c.units) }, '+ NCR جديدة') : null),
      h('div', { class: 'toolbar' }, seg,
        h('span', { class: 'muted small' }, `${list.filter((n) => n.status === 'open').length} مفتوحة · ${list.filter((n) => n.status === 'closed').length} مغلقة`),
        overdue ? h('span', { class: 'badge delete' }, `${overdue} متأخرة عن موعدها`) : null),
      box,
      h('p', { class: 'muted small' }, 'تُفتح NCR تلقائياً عند تسجيل أي مرحلة "فاشلة". أغلقها فقط بعد إعادة الفحص والتأكد من الإصلاح. لا يمكن تسليم وحدة لها NCR مفتوحة.'));
  }

  function addNcr(p, units, fixedUnit, fixedCp) {
    const f = {
      unit: h('select', null, units.map((u) => h('option', { value: u.id, selected: fixedUnit === u.id }, u.code))),
      cp: h('select', null, S.checkpoints.map((c) => h('option', { value: c.key, selected: fixedCp === c.key }, c.name_ar))),
      description: h('textarea', { rows: 3, maxlength: 2000, placeholder: 'مثال: هبوط الضغط 0.15 MPa خلال 24 ساعة، تسريب في الفلير' }),
      responsible: h('input', { maxlength: 120, placeholder: 'مثال: مسؤول الفرقة A' }),
      due: h('input', { type: 'date', dir: 'ltr' })
    };
    A.modal('حالة عدم مطابقة جديدة', h('div', { class: 'form-grid' },
      A.field('الوحدة', f.unit), A.field('المرحلة', f.cp), A.field('الوصف', f.description, { wide: true, required: true }),
      A.field('المسؤول عن الإصلاح', f.responsible), A.field('موعد الإصلاح', f.due)),
      [{ label: 'فتح NCR', cls: 'primary', run: async () => {
        if (!f.description.value.trim()) { toast('الوصف مطلوب', 'error'); return false; }
        const res = await S.sb.from('ncrs').insert({ unit_id: f.unit.value, checkpoint: f.cp.value, description: f.description.value.trim(),
          responsible: f.responsible.value.trim() || null, due_date: f.due.value || null }).select().single();
        if (res.error) { A.fail(res.error); return false; }
        await A.reloadUnit(f.unit.value);
        toast(`تم فتح ${ncrNo(res.data.ncr_no)}`);
        A.render();
      } }]);
  }

  function closeNcr(n) {
    const note = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'ما الذي أُصلح؟ ومتى أُعيد الفحص؟' });
    A.modal(`إغلاق ${ncrNo(n.ncr_no)}`, h('div', { class: 'stack sm' },
      h('p', null, n.description),
      h('p', { class: 'muted small' }, 'أغلقها فقط بعد إعادة الفحص. بعد الإغلاق غيّر نتيجة المرحلة إلى "ناجح" من جدول الوحدات.'),
      A.field('الإجراء المتخذ', note, { required: true })),
      [{ label: 'إغلاق', cls: 'primary', run: async () => {
        if (!note.value.trim()) { toast('اكتب الإجراء المتخذ', 'error'); return false; }
        const res = await S.sb.from('ncrs').update({ status: 'closed', closure_note: note.value.trim() }).eq('id', n.id).select().maybeSingle();
        if (res.error || !res.data) { A.fail(res.error || 'permission denied'); return false; }
        await A.reloadUnit(n.unit_id);
        toast(`تم إغلاق ${ncrNo(n.ncr_no)}`);
        A.render();
      } }]);
  }

  async function reopenNcr(n) {
    if (!await confirmBox({ title: `إعادة فتح ${ncrNo(n.ncr_no)}`, body: 'هل تريد إعادة فتح هذه الحالة؟', okText: 'إعادة فتح' })) return;
    const res = await S.sb.from('ncrs').update({ status: 'open' }).eq('id', n.id);
    if (res.error) return A.fail(res.error);
    await A.reloadUnit(n.unit_id);
    A.render();
  }

  /* ---------- المواد ---------- */
  async function tabMaterials(p) {
    const { data, error } = await S.sb.from('materials').select('*').eq('project_id', p.id).order('created_at');
    if (error) throw error;
    const staff = A.isStaff();
    const name = h('input', { maxlength: 200, placeholder: 'مثال: أنبوب نحاس 1/2' });
    const unit = h('input', { maxlength: 40, placeholder: 'متر، قطعة…' });
    const qty = h('input', { type: 'number', min: 0, step: 'any', dir: 'ltr' });
    const add = async (e) => {
      e.preventDefault();
      if (!name.value.trim()) return toast('اسم المادة مطلوب', 'error');
      const r = await S.sb.from('materials').insert({ project_id: p.id, name: name.value.trim(), unit: unit.value.trim() || null, qty: qty.value === '' ? null : Number(qty.value) });
      if (r.error) return A.fail(r.error);
      toast('تمت إضافة المادة'); A.render();
    };
    const remove = async (m) => {
      if (!await confirmBox({ title: 'حذف مادة', body: `هل تريد حذف "${m.name}"؟`, okText: 'حذف', danger: true })) return;
      const r = await S.sb.from('materials').delete().eq('id', m.id);
      if (r.error) return A.fail(r.error);
      toast('تم الحذف'); A.render();
    };
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'المواد المطلوبة'), h('span', { class: 'muted' }, data.length + ' بند')),
      data.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'المادة'), h('th', null, 'الوحدة'), h('th', null, 'الكمية'), staff ? h('th') : null)),
        h('tbody', null, data.map((m) => h('tr', null, h('td', null, m.name), h('td', null, m.unit || '—'), h('td', { dir: 'ltr' }, num(m.qty)),
          staff ? h('td', { class: 't-end' }, h('button', { type: 'button', class: 'btn ghost sm', onClick: () => remove(m) }, 'حذف')) : null)))))
        : A.empty('لم تُضف مواد بعد'),
      staff ? h('form', { class: 'form-grid add-row', onSubmit: add },
        A.field('اسم المادة', name, { required: true }), A.field('الوحدة', unit), A.field('الكمية', qty),
        h('div', { class: 'field end' }, h('button', { type: 'submit', class: 'btn primary' }, 'إضافة'))) : null);
  }

  /* ---------- الإعدادات ---------- */
  function tabSettings(p, c) {
    // إضافة وحدات
    const u = { prefix: h('input', { dir: 'ltr', value: 'V-', maxlength: 10 }), from: h('input', { type: 'number', min: 1, dir: 'ltr', value: c.total + 1 }),
      to: h('input', { type: 'number', min: 1, dir: 'ltr', value: c.total + 1 }), digits: h('input', { type: 'number', min: 1, max: 6, dir: 'ltr', value: 3 }),
      zone: h('input', { maxlength: 60 }), crew: h('input', { maxlength: 60 }) };
    const addUnits = async (btn) => {
      const from = Number(u.from.value), to = Number(u.to.value), dg = Number(u.digits.value) || 3;
      if (!(from >= 1 && to >= from && to - from < 2000)) return toast('تحقق من الأرقام (حتى 2000 وحدة في المرة)', 'error');
      const rows = [];
      for (let i = from; i <= to; i++) rows.push({ project_id: p.id, code: u.prefix.value.trim() + String(i).padStart(dg, '0'), zone: u.zone.value.trim() || null, crew: u.crew.value.trim() || null });
      btn.disabled = true;
      for (let i = 0; i < rows.length; i += 500) {
        const r = await S.sb.from('units').upsert(rows.slice(i, i + 500), { onConflict: 'project_id,code', ignoreDuplicates: true });
        if (r.error) { btn.disabled = false; return A.fail(r.error); }
      }
      await A.reloadUnits(p.id);
      toast(`تمت إضافة الوحدات (الموجودة مسبقاً لم تتكرر)`);
      A.render();
    };

    // الأوزان
    const w = Object.fromEntries(S.checkpoints.map((cp) => [cp.key, h('input', { type: 'number', min: 0, max: 100, step: 'any', dir: 'ltr', value: A.weightOf(p, cp.key) })]));
    const saveWeights = async () => {
      const weights = {};
      for (const [k, el] of Object.entries(w)) {
        const v = Number(el.value);
        if (!(v >= 0 && v <= 100)) return toast('الأوزان من 0 إلى 100', 'error');
        if (v !== 1) weights[k] = v;
      }
      const r = await S.sb.from('projects').update({ weights }).eq('id', p.id);
      if (r.error) return A.fail(r.error);
      await A.reloadProject(p.id); toast('تم حفظ الأوزان'); A.render();
    };
    const totalW = () => Object.values(w).reduce((s, el) => s + (Number(el.value) || 0), 0);

    const req = h('input', { type: 'checkbox', checked: p.require_readings, onChange: async (e) => {
      const r = await S.sb.from('projects').update({ require_readings: e.target.checked }).eq('id', p.id);
      if (r.error) { e.target.checked = !e.target.checked; return A.fail(r.error); }
      await A.reloadProject(p.id); toast('تم الحفظ');
    } });

    // Excel
    const file = h('input', { type: 'file', accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const acceptOld = h('input', { type: 'checkbox', checked: true });
    const importOut = h('div', { class: 'import-out', role: 'status' });

    const del = async () => {
      if (!await confirmBox({ title: 'حذف المشروع', body: `سيُحذف "${p.client}" مع ${c.total} وحدة وكل النتائج والقراءات وNCR والمواد نهائياً. يبقى الأثر في سجل العمليات. لا يمكن التراجع.`, okText: 'حذف نهائي', danger: true })) return;
      const r = await S.sb.from('projects').delete().eq('id', p.id);
      if (r.error) return A.fail(r.error);
      S.projects = S.projects.filter((x) => x.id !== p.id);
      S.units = S.units.filter((x) => x.project_id !== p.id);
      toast('تم حذف المشروع'); A.go('projects');
    };

    return h('div', { class: 'stack' },
      h('div', { class: 'grid-2' },
        h('section', { class: 'card' }, h('h2', null, 'ملف Excel'),
          h('p', { class: 'muted' }, 'التصدير ينتج ملفاً بنفس أوراق VRF QC Tracker: Dashboard وVilla Tracker وTest Records وNCR Register.'),
          h('button', { type: 'button', class: 'btn primary', onClick: () => exportExcel(p) }, '⬇ تصدير Excel'),
          h('hr'),
          h('h3', null, 'استيراد من ملف VRF QC Tracker'),
          h('p', { class: 'muted small' }, 'يقرأ الوحدات (المنطقة، الفرقة، الملاحظات) والنتائج والقراءات وNCR. الوحدات غير الموجودة تُضاف، والنتائج في الملف تحلّ محل الحالية. قواعد التسلسل تُطبّق، وأي نتيجة مخالفة تُرفض وتظهر لك.'),
          A.field('الملف', file),
          h('label', { class: 'check' }, acceptOld, h('span', null, 'النتائج السابقة في الملف معتمدة بدون قراءات (يُعاد تفعيل الشرط بعد الاستيراد)')),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', onClick: (e) => importExcel(p, file, acceptOld.checked, importOut, e.currentTarget) }, 'استيراد')),
          importOut),
        h('section', { class: 'card' }, h('h2', null, 'إضافة وحدات'),
          h('div', { class: 'form-grid compact' },
            A.field('البادئة', u.prefix), A.field('من رقم', u.from), A.field('إلى رقم', u.to),
            A.field('عدد الخانات', u.digits), A.field('المنطقة', u.zone), A.field('الفرقة', u.crew)),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn primary', onClick: (e) => addUnits(e.currentTarget) }, 'إضافة')),
          h('hr'),
          h('h2', null, 'قواعد الاعتماد'),
          h('label', { class: 'check' }, req, h('span', null, 'اشتراط قراءة مقبولة قبل اعتماد الضغط والفاكيوم والشحن (موصى به)')))),
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, 'أوزان المراحل في نسبة الإنجاز'),
          h('span', { class: 'muted small' }, 'الوزن 1 للكل = نفس طريقة ملف Excel')),
        h('p', { class: 'muted small' }, 'مثال: إذا كان التمديد واللحام يأخذ ثلث العمل فاجعل وزنه أكبر. الوزن 0 يعني أن المرحلة لا تدخل في النسبة.'),
        h('div', { class: 'weights' }, S.checkpoints.map((cp) => A.field(cp.name_ar, w[cp.key]))),
        h('div', { class: 'row between' }, h('span', { class: 'muted small' }, 'مجموع الأوزان: ', h('b', null, String(totalW()))),
          h('button', { type: 'button', class: 'btn primary', onClick: saveWeights }, 'حفظ الأوزان'))),
      A.isAdmin() ? h('section', { class: 'card danger-zone' }, h('h2', null, 'منطقة الحذف'),
        h('button', { type: 'button', class: 'btn danger', onClick: del }, 'حذف المشروع نهائياً')) : null);
  }

  /* ==========================================================
     صفحة الوحدة (مناسبة للجوال في الموقع)
     ========================================================== */
  A.views.unit = {
    title: (r) => S.units.find((u) => u.id === r.id)?.code || 'الوحدة',
    async render(r) {
      const u = S.units.find((x) => x.id === r.id);
      if (!u) return A.empty('الوحدة غير موجودة');
      const p = projectOf(u.project_id);
      const k = A.unitCalc(u, p);
      const [checks, tests, ncrs, names] = await Promise.all([
        S.sb.from('unit_checks').select('*').eq('unit_id', u.id).then((x) => { if (x.error) throw x.error; return x.data; }),
        loadTests(p.id, u.id), loadNcrs(p.id, u.id), profileNames()]);
      const byKey = Object.fromEntries(checks.map((c) => [c.checkpoint, c]));
      const staff = A.isStaff();
      const alertKeys = new Set(k.alerts.map((a) => a.key));

      const info = staff ? (() => {
        const zone = h('input', { maxlength: 60, value: u.zone || '' });
        const crew = h('input', { maxlength: 60, value: u.crew || '' });
        const brand = h('select', null, h('option', { value: '' }, 'نفس براند المشروع'), Object.entries(A.BRANDS).map(([b, l]) => h('option', { value: b, selected: u.brand === b }, l)));
        const remarks = h('textarea', { rows: 2, maxlength: 2000, value: u.remarks || '' });
        const save = async () => {
          const r2 = await S.sb.from('units').update({ zone: zone.value.trim() || null, crew: crew.value.trim() || null, brand: brand.value || null, remarks: remarks.value.trim() || null }).eq('id', u.id);
          if (r2.error) return A.fail(r2.error);
          await A.reloadUnit(u.id); toast('تم الحفظ'); A.render();
        };
        return h('div', { class: 'stack sm' }, h('div', { class: 'form-grid compact' }, A.field('المنطقة', zone), A.field('الفرقة', crew), A.field('البراند', brand)),
          A.field('ملاحظات', remarks), h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn', onClick: save }, 'حفظ البيانات')));
      })() : h('dl', { class: 'info' }, [['المنطقة', u.zone || '—'], ['الفرقة', u.crew || '—'], ['البراند', A.brandChip(u.effective_brand) || '—'], ['ملاحظات', u.remarks || '—']]
        .map(([a, b]) => h('div', null, h('dt', null, a), h('dd', null, b))));

      const delUnit = async () => {
        if (!await confirmBox({ title: 'حذف الوحدة', body: `سيُحذف ${u.code} مع نتائجه وقراءاته وNCR. لا يمكن التراجع.`, okText: 'حذف', danger: true })) return;
        const r2 = await S.sb.from('units').delete().eq('id', u.id);
        if (r2.error) return A.fail(r2.error);
        S.units = S.units.filter((x) => x.id !== u.id); toast('تم الحذف'); A.go(`project/${p.id}/tracker`);
      };

      return h('div', { class: 'stack' },
        h('section', { class: 'card hero' },
          h('div', { class: 'hero-head' },
            h('div', null, h('a', { href: `#/project/${p.id}/tracker`, class: 'link small' }, '→ ' + p.client),
              h('h2', null, u.code, ' ', A.brandChip(u.effective_brand)),
              h('p', null, A.statusChip(k.status), ' ', k.next ? h('span', { class: 'muted' }, 'الخطوة التالية: ' + k.next.name_ar) : null,
                k.alerts.length ? h('span', { class: 'seq-alert' }, ' تنبيه تسلسل') : null)),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn', onClick: () => addTest(p, [u], u.id) }, '+ قراءة'),
              staff ? h('button', { type: 'button', class: 'btn', onClick: () => addNcr(p, [u], u.id) }, '+ NCR') : null,
              A.isAdmin() ? h('button', { type: 'button', class: 'btn ghost', onClick: delUnit }, 'حذف') : null)),
          h('div', { class: 'hero-progress' }, A.progress(k.pct), h('strong', null, A.pctText(k.pct))),
          info),
        h('section', { class: 'card' }, h('h2', null, 'المراحل'),
          h('ol', { class: 'cp-list' }, S.checkpoints.map((cp) => {
            const row = byKey[cp.key] || { result: 'pending' };
            return h('li', { class: 'cp-item res-b-' + row.result + (alertKeys.has(cp.key) ? ' warn' : '') },
              h('div', { class: 'cp-main' },
                h('span', { class: 'cp-num' }, String(cp.position)),
                h('div', null, h('strong', null, cp.name_ar), h('div', { class: 'muted small', dir: 'ltr' }, cp.itp_ref || ''),
                  row.notes ? h('div', { class: 'small' }, row.notes) : null,
                  row.inspected_at ? h('div', { class: 'muted small' }, `${names[row.inspected_by] || '—'} · ${dateTime(row.inspected_at)}`) : null)),
              staff ? h('button', { type: 'button', class: 'res res-' + row.result + ' as-btn', onClick: () => editResult(p, u, cp) }, A.RESULTS[row.result])
                : A.resultChip(row.result));
          }))),
        h('section', { class: 'card' }, h('h2', null, 'القراءات'),
          tests.length ? testsTable(tests, names, false) : A.empty('لا توجد قراءات')),
        h('section', { class: 'card' }, h('h2', null, 'حالات عدم المطابقة'),
          ncrs.length ? ncrTable(ncrs, { [u.id]: u.code }, names) : A.empty('لا توجد')));
    }
  };

  /* ==========================================================
     حدود الفحص
     ========================================================== */
  A.views.limits = {
    title: 'حدود الفحص',
    render() {
      const admin = A.isAdmin();
      const fields = [
        ['pressure_drop_max', 'أقصى هبوط ضغط (MPa)', 0.001],
        ['vacuum_max_microns', 'أقصى فاكيوم (مايكرون)', 1],
        ['vacuum_hold_min', 'أقل مدة ثبات (دقيقة)', 1],
        ['vacuum_rise_max', 'أقصى ارتفاع أثناء الثبات (مايكرون)', 1],
        ['charge_tolerance', 'فرق الشحن المسموح (0.05 = 5%)', 0.005]
      ];
      return h('div', { class: 'stack' },
        h('section', { class: 'card note' }, h('p', null, 'هذه الحدود تُستخدم لتقييم القراءات تلقائياً على الخادم. القيم الأولية مأخوذة من ملف Excel وهي قيم نموذجية، ',
          h('strong', null, 'ويجب مراجعتها مع كتالوج كل شركة (LG وMidea) ونوع الفريون'), ' ثم تأشير "تمت المراجعة".')),
        h('div', { class: 'grid-2' }, Object.keys(A.BRANDS).map((b) => {
          const l = S.limits[b] || {};
          const inputs = Object.fromEntries(fields.map(([k, , step]) => [k, h('input', { type: 'number', step, min: 0, dir: 'ltr', value: l[k] ?? '', disabled: !admin })]));
          const conf = h('input', { type: 'checkbox', checked: l.confirmed, disabled: !admin });
          const save = async () => {
            const patch = { confirmed: conf.checked, updated_at: new Date().toISOString() };
            for (const [k] of fields) {
              const v = Number(inputs[k].value);
              if (inputs[k].value === '' || !(v >= 0)) return toast('قيم غير صحيحة', 'error');
              patch[k] = v;
            }
            const r = await S.sb.from('brand_limits').update(patch).eq('brand', b).select().maybeSingle();
            if (r.error || !r.data) return A.fail(r.error || 'permission denied');
            S.limits[b] = r.data; toast('تم حفظ حدود ' + A.BRANDS[b]); A.render();
          };
          return h('section', { class: 'card' }, h('h2', null, A.brandChip(b), ' ', l.confirmed ? h('span', { class: 'badge insert' }, 'تمت المراجعة') : h('span', { class: 'badge delete' }, 'لم تُراجع')),
            h('div', { class: 'form-grid' }, fields.map(([k, label]) => A.field(label, inputs[k]))),
            h('label', { class: 'check' }, conf, h('span', null, 'تمت مراجعتها مع كتالوج الشركة')),
            admin ? h('div', { class: 'row end' }, h('button', { type: 'button', class: 'btn primary', onClick: save }, 'حفظ')) : h('p', { class: 'muted small' }, 'التعديل للمدير فقط.'));
        })),
        h('section', { class: 'card' }, h('h2', null, 'قواعد التسلسل (تُفرض على الخادم)'),
          h('div', { class: 'table-wrap' }, h('table', { class: 'table compact' },
            h('thead', null, h('tr', null, h('th', null, 'المرحلة'), h('th', null, 'لا تُعتمد قبل نجاح'))),
            h('tbody', null, S.checkpoints.filter((c) => (c.prereqs || []).length).map((c) => h('tr', null, h('td', null, c.name_ar),
              h('td', null, c.key === 'handover' ? 'كل المراحل السابقة، وبلا NCR مفتوحة' : c.prereqs.map((k) => cpBy(k)?.name_ar).join('، ')))))))));
    }
  };

  /* ==========================================================
     تصدير Excel بنفس شكل VRF QC Tracker
     ========================================================== */
  async function exportExcel(p) {
    try {
      toast('جارٍ تجهيز الملف…');
      const c = A.projectCalc(p);
      const cps = S.checkpoints;
      const [tests, ncrs, names] = await Promise.all([loadTests(p.id), loadNcrs(p.id), profileNames()]);
      const code = Object.fromEntries(c.units.map((u) => [u.id, u.code]));
      const hdr = (arr) => arr.map((v) => ({ v, s: 'header' }));

      // Dashboard
      const dash = [[{ v: `Dashboard - VRF QC - ${p.client}`, s: 'title' }], [`Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · Brand: ${A.BRANDS[p.brand] || '-'}`]];
      dash[2] = ['Villas in tracker', c.total];
      dash[3] = ['Fully complete', c.complete];
      dash[4] = ['In progress', c.inProgress];
      dash[5] = ['Not started', c.notStarted];
      dash[6] = ['Villas with a failed item', c.withFailure];
      dash[7] = ['Sequence alerts', c.alerts];
      dash[8] = ['Open NCRs', c.openNcrs];
      dash[9] = ['Overall inspection progress', { v: Math.round(c.pct * 10000) / 10000, s: 'pct' }];
      dash[11] = [{ v: 'Progress by checkpoint', s: 'title' }];
      dash[13] = hdr(['Checkpoint', 'Pass', 'Fail', 'Pending', 'N/A', '% pass (excl. N/A)', 'المرحلة']);
      cps.forEach((cp, i) => {
        const cnt = { pass: 0, fail: 0, pending: 0, na: 0 };
        c.units.forEach((u) => { cnt[u.results?.[cp.key] || 'pending']++; });
        const base = c.total - cnt.na;
        dash[14 + i] = [cp.name_en, cnt.pass, cnt.fail, cnt.pending, cnt.na, { v: base ? Math.round(cnt.pass / base * 10000) / 10000 : 0, s: 'pct' }, cp.name_ar];
      });

      // Villa Tracker
      const vt = [[{ v: 'Villa Tracker - one row per villa', s: 'title' }], ['Pass / Fail / N/A / Pending in each checkpoint column. Row 3 shows the ITP item number.']];
      vt[2] = [null, null, null, ...cps.map((cp) => ({ v: cp.itp_ref, s: 'header' }))];
      vt[3] = hdr(['Villa', 'Zone', 'Crew', ...cps.map((cp) => cp.name_en), 'Passed', 'Failed', '% complete', 'Open NCRs', 'Status', 'Next step', 'Sequence alert', 'Remarks']);
      c.units.forEach((u, i) => {
        const k = c.calcs[i];
        vt.push([u.code, u.zone || '', u.crew || '',
          ...cps.map((cp) => { const r = u.results?.[cp.key] || 'pending'; return { v: A.RESULTS_EN[r], s: r }; }),
          k.passed, k.failed, { v: Math.round(k.pct * 10000) / 10000, s: 'pct' }, Number(u.open_ncrs || 0),
          A.UNIT_STATUS_EN[k.status], k.next ? k.next.name_en : '-', k.alerts.length ? { v: 'SEQUENCE ALERT', s: 'alert' } : '', u.remarks || '']);
      });

      // Test Records
      const lim = S.limits[p.brand] || {};
      const tr = [[{ v: 'Test Records - pressure, vacuum and refrigerant charge per villa', s: 'title' }],
        ['Allowed pressure drop (MPa)', lim.pressure_drop_max, null, null, 'Vacuum target (microns, max)', lim.vacuum_max_microns, null, null, 'Vacuum hold (min, min)', lim.vacuum_hold_min, null, null, 'Charge tolerance (%)', lim.charge_tolerance],
        [lim.confirmed ? 'Limits confirmed against the manufacturer manual.' : 'Limits are typical figures, not yet confirmed against the manufacturer manual.']];
      tr[3] = hdr(['Villa', 'Outdoor unit / system ID', 'Pressure test date', 'Test pressure (MPa)', 'Hold (hours)', 'Start (MPa)', 'End (MPa)', 'Drop (MPa)', 'Pressure check',
        'Vacuum date', 'Vacuum reached (microns)', 'Vacuum hold (min)', 'Vacuum rise (microns)', 'Vacuum check', 'Calculated charge (kg)', 'Actual charge (kg)',
        'Variance (kg)', 'Variance (%)', 'Charge check', 'Cylinder no.', 'Inspector', 'Start temp (C)', 'End temp (C)']);
      const ck = (v) => (v === null || v === undefined ? '' : { v: v ? 'OK' : 'CHECK', s: v ? 'pass' : 'fail' });
      [...tests].reverse().forEach((t) => tr.push([code[t.unit_id] || t.units?.code, t.system_id, t.pressure_date || '', t.test_pressure, t.hold_hours, t.start_mpa, t.end_mpa,
        t.pressure_drop, ck(t.pressure_ok), t.vacuum_date || '', t.vacuum_microns, t.vacuum_hold_min, t.vacuum_rise, ck(t.vacuum_ok), t.charge_calc_kg, t.charge_actual_kg,
        t.charge_calc_kg != null && t.charge_actual_kg != null ? Math.round((t.charge_actual_kg - t.charge_calc_kg) * 100) / 100 : '',
        t.charge_variance != null ? { v: Number(t.charge_variance), s: 'pct' } : '', ck(t.charge_ok), t.cylinder_no || '', names[t.inspector] || '', t.start_temp_c, t.end_temp_c]
        .map((v) => (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) && /^[\d.]+$/.test(v) ? Number(v) : v))));

      // NCR Register
      const nr = [[{ v: 'NCR Register - every failed inspection item', s: 'title' }], ['Status Open counts against the villa. Closed only after re-inspection.']];
      nr[2] = hdr(['NCR no.', 'Date raised', 'Villa', 'Checkpoint', 'Description', 'Responsible', 'Due date', 'Status', 'Date closed', 'Closure note', 'Raised by', 'Closed by']);
      [...ncrs].reverse().forEach((n) => nr.push([ncrNo(n.ncr_no), date(n.raised_at), code[n.unit_id] || '', cpBy(n.checkpoint)?.name_en, n.description, n.responsible || '',
        n.due_date || '', { v: n.status === 'open' ? 'Open' : 'Closed', s: n.status === 'open' ? 'fail' : 'pass' }, n.closed_at ? date(n.closed_at) : '',
        n.closure_note || '', names[n.raised_by] || '', names[n.closed_by] || '']));

      const blob = X.writeWorkbook([
        { name: 'Dashboard', rows: dash, opts: { widths: [32, 10, 10, 10, 10, 18, 26] } },
        { name: 'Villa Tracker', rows: vt, opts: { widths: [12, 10, 10, ...cps.map(() => 13), 8, 8, 11, 10, 13, 22, 16, 30], freezeRow: 4, freezeCol: 1, autoFilter: `A4:${X.colName(3 + cps.length + 7)}${Math.max(4, vt.length)}` } },
        { name: 'Test Records', rows: tr, opts: { widths: [12, 14, 12, 10, 9, 9, 9, 9, 10, 12, 12, 10, 10, 10, 12, 12, 10, 10, 10, 14, 16, 10, 10], freezeRow: 4, freezeCol: 1 } },
        { name: 'NCR Register', rows: nr, opts: { widths: [11, 12, 10, 22, 50, 18, 12, 9, 12, 40, 16, 16], freezeRow: 3 } }
      ]);
      const safeName = p.client.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60);
      A.download(blob, `${safeName} - VRF QC - ${today()}.xlsx`);
      toast('تم تنزيل ملف Excel');
    } catch (e) { A.fail(e); }
  }

  /* ==========================================================
     استيراد من ملف VRF QC Tracker
     ========================================================== */
  function findHeader(rows, test) {
    for (let r = 0; r < Math.min(rows.length, 30); r++) if (rows[r] && test(rows[r])) return r;
    return -1;
  }
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const isExample = (v) => /example|مثال/i.test(String(v ?? ''));
  const numOrNull = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

  async function importExcel(p, fileInput, acceptOld, out, btn) {
    const file = fileInput.files[0];
    if (!file) return toast('اختر ملف Excel أولاً', 'error');
    if (file.size > 15 * 1024 * 1024) return toast('الملف أكبر من 15 ميغابايت', 'error');
    clear(out);
    let wb;
    try { wb = await X.readWorkbook(await file.arrayBuffer()); } catch (e) { return toast('تعذّرت قراءة الملف: ' + (e.message || ''), 'error'); }

    const cps = S.checkpoints;
    const sheetBy = (re) => Object.entries(wb).find(([n]) => re.test(n))?.[1];

    // Villa Tracker
    const vt = sheetBy(/villa tracker|tracker|متابعة/i);
    if (!vt) return toast('لم أجد ورقة "Villa Tracker" في الملف', 'error');
    const hv = findHeader(vt, (row) => norm(row[0]) === 'villa' || norm(row[0]) === 'الوحدة');
    if (hv < 0) return toast('لم أجد صف العناوين (Villa) في ورقة Villa Tracker', 'error');
    const head = vt[hv].map(norm);
    const col = (names) => head.findIndex((x) => names.map(norm).includes(x));
    const cpCol = Object.fromEntries(cps.map((cp) => [cp.key, col([cp.name_en, cp.name_ar])]));
    const cZone = col(['zone', 'المنطقة']), cCrew = col(['crew', 'الفرقة']), cRem = col(['remarks', 'ملاحظات']);
    const units = [];
    for (let r = hv + 1; r < vt.length; r++) {
      const row = vt[r];
      if (!row || row[0] === null || row[0] === undefined || String(row[0]).trim() === '' || isExample(row[0])) continue;
      const results = {};
      for (const cp of cps) {
        const v = cpCol[cp.key] >= 0 ? RES_FROM[norm(row[cpCol[cp.key]])] : null;
        if (v) results[cp.key] = v;
      }
      units.push({ code: String(row[0]).trim().slice(0, 40), zone: cZone >= 0 && row[cZone] != null ? String(row[cZone]).trim().slice(0, 60) || null : null,
        crew: cCrew >= 0 && row[cCrew] != null ? String(row[cCrew]).trim().slice(0, 60) || null : null,
        remarks: cRem >= 0 && row[cRem] != null ? String(row[cRem]).trim().slice(0, 2000) || null : null, results });
    }

    // Test Records
    const tests = [];
    const ts = sheetBy(/test records|القراءات/i);
    if (ts) {
      const ht = findHeader(ts, (row) => norm(row[0]) === 'villa' && row.some((x) => /pressure test date/i.test(String(x))));
      if (ht >= 0) {
        const th = ts[ht].map(norm);
        const tc = (n) => th.indexOf(norm(n));
        const map = { system_id: 'Outdoor unit / system ID', pressure_date: 'Pressure test date', test_pressure: 'Test pressure (MPa)', hold_hours: 'Hold (hours)',
          start_mpa: 'Start (MPa)', end_mpa: 'End (MPa)', vacuum_date: 'Vacuum date', vacuum_microns: 'Vacuum reached (microns)', vacuum_hold_min: 'Vacuum hold (min)',
          vacuum_rise: 'Vacuum rise (microns)', charge_calc_kg: 'Calculated charge (kg)', charge_actual_kg: 'Actual charge (kg)', cylinder_no: 'Cylinder no.',
          start_temp_c: 'Start temp (C)', end_temp_c: 'End temp (C)', notes: 'Notes' };
        for (let r = ht + 1; r < ts.length; r++) {
          const row = ts[r];
          if (!row || !row[0] || isExample(row[0])) continue;
          const g = (k) => (tc(map[k]) >= 0 ? row[tc(map[k])] : null);
          const t = { code: String(row[0]).trim(), system_id: g('system_id') ? String(g('system_id')).slice(0, 40) : 'ODU-01',
            pressure_date: X.excelDate(g('pressure_date')), test_pressure: numOrNull(g('test_pressure')), hold_hours: numOrNull(g('hold_hours')),
            start_mpa: numOrNull(g('start_mpa')), end_mpa: numOrNull(g('end_mpa')), start_temp_c: numOrNull(g('start_temp_c')), end_temp_c: numOrNull(g('end_temp_c')),
            vacuum_date: X.excelDate(g('vacuum_date')), vacuum_microns: numOrNull(g('vacuum_microns')), vacuum_hold_min: numOrNull(g('vacuum_hold_min')),
            vacuum_rise: numOrNull(g('vacuum_rise')), charge_calc_kg: numOrNull(g('charge_calc_kg')), charge_actual_kg: numOrNull(g('charge_actual_kg')),
            cylinder_no: g('cylinder_no') ? String(g('cylinder_no')).slice(0, 60) : null };
          if ((t.start_mpa === null) !== (t.end_mpa === null)) { t.start_mpa = null; t.end_mpa = null; }
          if ((t.start_temp_c === null) !== (t.end_temp_c === null)) { t.start_temp_c = null; t.end_temp_c = null; }
          if ([t.start_mpa, t.vacuum_microns, t.charge_calc_kg].some((x) => x !== null)) tests.push(t);
        }
      }
    }

    // NCR Register
    const ncrs = [];
    const ns = sheetBy(/ncr/i);
    if (ns) {
      const hn = findHeader(ns, (row) => /ncr no/i.test(String(row[0] ?? '')));
      if (hn >= 0) {
        const nh = ns[hn].map(norm);
        const nc = (n) => nh.indexOf(norm(n));
        for (let r = hn + 1; r < ns.length; r++) {
          const row = ns[r];
          if (!row || isExample(row[0])) continue;
          const villa = row[nc('Villa')], cpName = norm(row[nc('Checkpoint')]), desc = row[nc('Description')];
          if (!villa || !desc) continue;
          const cp = cps.find((c) => norm(c.name_en) === cpName || norm(c.name_ar) === cpName);
          if (!cp) continue;
          ncrs.push({ code: String(villa).trim(), checkpoint: cp.key, description: String(desc).slice(0, 2000),
            responsible: row[nc('Responsible')] ? String(row[nc('Responsible')]).slice(0, 120) : null,
            due_date: X.excelDate(row[nc('Due date')]), closed: /closed|مغلق/i.test(String(row[nc('Status')] ?? '')) });
        }
      }
    }

    const existing = new Map(S.units.filter((u) => u.project_id === p.id).map((u) => [u.code, u]));
    const newUnits = units.filter((u) => !existing.has(u.code));
    const changes = units.reduce((s, u) => s + cps.filter((cp) => u.results[cp.key] && u.results[cp.key] !== (existing.get(u.code)?.results?.[cp.key] || 'pending')).length, 0);
    const ok = await confirmBox({ title: 'استيراد ملف Excel', okText: 'استيراد',
      body: `في الملف ${units.length} وحدة (${newUnits.length} جديدة)، و${changes} نتيجة ستتغير، و${tests.length} قراءة، و${ncrs.length} NCR. القراءات وNCR تُضاف ولا تُحذف الموجودة. هل تتابع؟` });
    if (!ok) return;

    btn.disabled = true;
    const status = (t) => { clear(out).appendChild(h('p', { class: 'muted' }, t)); };
    const rejected = [];
    const prevReq = p.require_readings;
    try {
      if (acceptOld && prevReq) {
        const r = await S.sb.from('projects').update({ require_readings: false }).eq('id', p.id);
        if (r.error) throw r.error;
      }
      // 1) الوحدات
      status('جارٍ إضافة الوحدات…');
      const rows = newUnits.map((u) => ({ project_id: p.id, code: u.code, zone: u.zone, crew: u.crew, remarks: u.remarks }));
      for (let i = 0; i < rows.length; i += 500) {
        const r = await S.sb.from('units').upsert(rows.slice(i, i + 500), { onConflict: 'project_id,code', ignoreDuplicates: true });
        if (r.error) throw r.error;
      }
      for (const u of units) {
        const e = existing.get(u.code);
        if (e && (u.zone !== e.zone || u.crew !== e.crew || u.remarks !== e.remarks) && (u.zone || u.crew || u.remarks)) {
          await S.sb.from('units').update({ zone: u.zone ?? e.zone, crew: u.crew ?? e.crew, remarks: u.remarks ?? e.remarks }).eq('id', e.id);
        }
      }
      await A.reloadUnits(p.id);
      const ids = new Map(S.units.filter((u) => u.project_id === p.id).map((u) => [u.code, u]));

      // 2) القراءات (قبل النتائج حتى تتوفر عند الاعتماد)
      let tDone = 0;
      for (const t of tests) {
        const u = ids.get(t.code);
        if (!u) { rejected.push([t.code, 'قراءة', 'الوحدة غير موجودة']); continue; }
        const { code, ...row } = t;
        const r = await S.sb.from('test_records').insert({ ...row, unit_id: u.id });
        if (r.error) rejected.push([t.code, 'قراءة', A.errText(r.error)]); else tDone++;
        status(`القراءات: ${tDone} من ${tests.length}…`);
      }
      if (tests.length) await A.reloadUnits(p.id);

      // 3) النتائج بترتيب المراحل
      let rDone = 0, rTotal = 0;
      const fresh = new Map(S.units.filter((u) => u.project_id === p.id).map((u) => [u.code, u]));
      for (const fu of units) {
        const u = fresh.get(fu.code);
        if (!u) continue;
        for (const cp of cps) {
          const want = fu.results[cp.key];
          if (!want || want === (u.results?.[cp.key] || 'pending')) continue;
          rTotal++;
          const r = await S.sb.from('unit_checks').update({ result: want, notes: want === 'fail' ? 'مستورد من Excel' : null })
            .eq('unit_id', u.id).eq('checkpoint', cp.key).select('result').maybeSingle();
          if (r.error || !r.data) rejected.push([fu.code, cp.name_ar, A.errText(r.error || 'permission denied')]);
          else rDone++;
          if (rTotal % 5 === 0) status(`النتائج: ${rDone} من ${changes}…`);
        }
      }

      // 4) NCR
      let nDone = 0;
      for (const n of ncrs) {
        const u = ids.get(n.code);
        if (!u) { rejected.push([n.code, 'NCR', 'الوحدة غير موجودة']); continue; }
        const r = await S.sb.from('ncrs').insert({ unit_id: u.id, checkpoint: n.checkpoint, description: n.description, responsible: n.responsible, due_date: n.due_date }).select('id').single();
        if (r.error) { rejected.push([n.code, 'NCR', A.errText(r.error)]); continue; }
        if (n.closed) await S.sb.from('ncrs').update({ status: 'closed', closure_note: 'مغلقة في ملف Excel' }).eq('id', r.data.id);
        nDone++;
      }

      await A.reloadUnits(p.id);
      clear(out).appendChild(h('div', { class: 'stack sm' },
        h('p', { class: 'ok-text' }, `✓ تم: ${newUnits.length} وحدة جديدة، ${rDone} نتيجة، ${tDone} قراءة، ${nDone} NCR.`),
        rejected.length ? h('div', { class: 'card alert-card' },
          h('strong', null, `${rejected.length} عنصر رُفض (قواعد التسلسل أو بيانات ناقصة):`),
          h('ul', null, rejected.slice(0, 60).map(([a, b, c2]) => h('li', null, h('b', null, a), ` · ${b}: ${c2}`))),
          rejected.length > 60 ? h('p', { class: 'muted small' }, `و${rejected.length - 60} أخرى…`) : null) : null));
      toast('اكتمل الاستيراد');
    } catch (e) {
      A.fail(e);
    } finally {
      if (acceptOld && prevReq) await S.sb.from('projects').update({ require_readings: true }).eq('id', p.id);
      await A.reloadProject(p.id);
      btn.disabled = false;
    }
  }
})();
