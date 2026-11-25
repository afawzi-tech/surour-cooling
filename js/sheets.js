/* ==========================================================
   أوراق المشروع - مطابقة لملف VRF QC Tracker
   How to use | Dashboard | Villa Tracker | Test Records | NCR Register
   + استيراد وتصدير Excel (التصدير بمعادلات حقيقية وقوائم منسدلة وتلوين)
   ========================================================== */
(() => {
  'use strict';

  const { h, clear, toast, confirmBox, num, date } = window.UI;
  const A = window.App;
  const S = A.state;
  const X = window.XLSX_LITE;
  const F = A.F;

  const SHEETS = [
    ['dashboard', 'Dashboard', 'لوحة التحكم'],
    ['tracker', 'Villa Tracker', 'متابعة الفلل'],
    ['tests', 'Test Records', 'سجل الفحوصات'],
    ['ncr', 'NCR Register', 'سجل عدم المطابقة'],
    ['guide', 'How to use', 'طريقة الاستخدام']
  ];
  const RES_KEYS = ['pending', 'pass', 'fail', 'na'];
  const today = () => new Date().toISOString().slice(0, 10);
  const projectOf = (id) => S.projects.find((p) => p.id === id);
  const blank = (v) => v === null || v === undefined || v === '';

  /* ---------- صفحة المشروع ---------- */
  A.views.project = {
    title: (r) => projectOf(r.id)?.client || 'المشروع',
    async render(r) {
      const p = projectOf(r.id);
      if (!p) return A.empty('المشروع غير موجود', '', h('a', { href: '#/home', class: 'btn' }, 'المشاريع'));
      const d = await A.loadProject(p.id);
      const tab = SHEETS.some((s) => s[0] === r.tab) ? r.tab : 'dashboard';
      const body = { dashboard: sheetDashboard, tracker: sheetTracker, tests: sheetTests, ncr: sheetNcr, guide: sheetGuide }[tab](p, d);

      return h('div', { class: 'book' },
        h('div', { class: 'book-head' },
          h('h1', null, p.client),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn sm', title: 'تحديث البيانات', onClick: async () => { await A.loadProject(p.id, true); A.render(); } }, '↻ تحديث'),
            A.isStaff() ? h('button', { type: 'button', class: 'btn sm', onClick: () => importDialog(p) }, '⬆ استيراد Excel') : null,
            h('button', { type: 'button', class: 'btn sm primary', onClick: () => exportExcel(p, d) }, '⬇ تصدير Excel'))),
        h('nav', { class: 'sheet-tabs', 'aria-label': 'أوراق الملف' }, SHEETS.map(([k, en, ar]) =>
          h('a', { href: `#/project/${p.id}/${k}`, class: 'sheet-tab' + (k === tab ? ' on' : ''), 'aria-current': k === tab ? 'page' : null },
            h('span', null, ar), h('small', { dir: 'ltr' }, en)))),
        h('div', { class: 'sheet' }, body));
    }
  };

  /* ==========================================================
     Dashboard
     ========================================================== */
  function sheetDashboard(p, d) {
    const D = F.dashboard(d, S.checkpoints);
    const line = (label, en, val, cls = '') => h('tr', { class: cls }, h('th', null, label, h('small', { dir: 'ltr' }, en)), h('td', { class: 'calc' }, val));
    return h('div', { class: 'stack' },
      h('h2', { class: 'sheet-title' }, 'لوحة التحكم - فحص جودة تركيب VRF في الفلل'),
      h('div', { class: 'dash' },
        h('table', { class: 'xl dash-main' }, h('tbody', null,
          line('عدد الفلل', 'Villas in tracker', num(D.B3)),
          line('مكتملة بالكامل', 'Fully complete', num(D.B4)),
          line('جارية', 'In progress', num(D.B5)),
          line('لم تبدأ', 'Not started', num(D.B6)),
          line('فلل فيها بند فاشل', 'Villas with a failed item', num(D.B7), D.B7 ? 'hot' : ''),
          line('تنبيهات التسلسل', 'Sequence alerts', num(D.B8), D.B8 ? 'hot' : ''),
          line('حالات NCR مفتوحة', 'Open NCRs', num(D.B9), D.B9 ? 'hot' : ''),
          line('نسبة إنجاز الفحص الكلية', 'Overall inspection progress', A.pctText(D.B10), 'big'))),
        h('div', { class: 'dash-ring', 'aria-hidden': 'true' }, ring(D.B10))),
      h('h3', null, 'التقدم حسب نقطة الفحص'),
      h('p', { class: 'muted small' }, 'الأرقام تُحسب من Villa Tracker. البند الفاشل أو المعلّق يوقف المرحلة التي بعده.'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'xl' },
        h('thead', null, h('tr', null, h('th', null, 'نقطة الفحص'), h('th', null, 'Pass'), h('th', null, 'Fail'), h('th', null, 'Pending'), h('th', null, 'N/A'), h('th', null, '% النجاح (بدون N/A)'))),
        h('tbody', null, D.per.map((x) => h('tr', null,
          h('th', null, x.c.name_ar, h('small', { dir: 'ltr' }, x.c.name_en)),
          h('td', { class: 'calc c-pass' }, num(x.Pass)), h('td', { class: 'calc' + (x.Fail ? ' c-fail' : '') }, num(x.Fail)),
          h('td', { class: 'calc' }, num(x.Pending)), h('td', { class: 'calc' }, num(x['N/A'])),
          h('td', { class: 'calc' }, h('div', { class: 'bar-cell' }, h('span', { class: 'bar' }, h('span', { style: { width: Math.round(x.pct * 100) + '%' } })), A.pctText(x.pct)))))))));
  }

  function ring(v) {
    const p = Math.round((v || 0) * 1000) / 10;
    const el = h('div', { class: 'ring' }, h('strong', null, p + '%'), h('small', null, 'الإنجاز الكلي'));
    el.style.setProperty('--p', String(p));
    return el;
  }

  /* ==========================================================
     Villa Tracker
     ========================================================== */
  function sheetTracker(p, d) {
    const cps = S.checkpoints;
    const staff = A.isStaff();
    const f = S._tf || (S._tf = { q: '', zone: '', crew: '', status: '', next: '' });
    const zones = [...new Set(d.units.map((u) => u.zone).filter(Boolean))].sort();
    const crews = [...new Set(d.units.map((u) => u.crew).filter(Boolean))].sort();
    const tbody = h('tbody');
    const count = h('span', { class: 'muted small' });

    const visible = (u, k) => (!f.q || u.code.toLowerCase().includes(f.q.toLowerCase()))
      && (!f.zone || u.zone === f.zone) && (!f.crew || u.crew === f.crew)
      && (!f.status || (f.status === 'alert' ? k.W : k.U === f.status))
      && (!f.next || (f.next === '-' ? k.V === '-' : k.V !== '-' && k.V.key === f.next));

    const draw = () => {
      clear(tbody);
      let n = 0;
      d.units.forEach((u, i) => {
        const k = F.row(u, cps, A.openNcrsOf(d, u.id));
        if (!visible(u, k)) return;
        n++;
        tbody.appendChild(trackerRow(p, d, u, i));
      });
      count.textContent = `${num(n)} من ${num(d.units.length)} فيلا`;
    };
    const sel = (key, label, opts) => h('select', { 'aria-label': label, onChange: (e) => { f[key] = e.target.value; draw(); } },
      h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: f[key] === v }, l)));

    draw();
    return h('div', { class: 'stack' },
      h('div', { class: 'sheet-note' },
        h('h2', { class: 'sheet-title' }, 'متابعة الفلل - سطر لكل فيلا'),
        h('p', { class: 'muted small' }, staff ? 'اختر Pass / Fail / N/A / Pending في خانة كل نقطة فحص. الصف الأول يوضّح رقم بند ITP. الخانات الرمادية معادلات تُحسب تلقائياً.'
          : 'عرض فقط. تغيير النتائج للمدير والمشرف.')),
      h('div', { class: 'filters' },
        h('input', { type: 'search', placeholder: 'بحث برقم الفيلا', value: f.q, 'aria-label': 'بحث', onInput: (e) => { f.q = e.target.value; draw(); } }),
        zones.length ? sel('zone', 'Zone: الكل', zones.map((z) => [z, z])) : null,
        crews.length ? sel('crew', 'Crew: الكل', crews.map((z) => [z, z])) : null,
        sel('status', 'Status: الكل', [['Complete', 'Complete - مكتملة'], ['In progress', 'In progress - جارية'], ['Not started', 'Not started - لم تبدأ'], ['Has failure', 'Has failure - بها فشل'], ['alert', 'SEQUENCE ALERT']]),
        sel('next', 'Next step: الكل', cps.map((c) => [c.key, c.name_en]).concat([['-', '- (مكتملة)']])),
        count,
        staff ? h('button', { type: 'button', class: 'btn sm', onClick: () => addVillas(p, d) }, '+ فلل') : null),
      h('div', { class: 'xl-wrap' }, h('table', { class: 'xl tracker' },
        h('thead', null,
          h('tr', { class: 'itp' }, h('th', { class: 'stk' }), h('th'), h('th'), cps.map((c) => h('th', { dir: 'ltr' }, c.itp_ref)), h('th', { colspan: 9 })),
          h('tr', null,
            h('th', { class: 'stk' }, 'Villa'), h('th', null, 'Zone'), h('th', null, 'Crew'),
            cps.map((c) => h('th', { class: 'cp', title: c.name_ar }, c.name_en)),
            h('th', { class: 'f' }, 'Passed'), h('th', { class: 'f' }, 'Failed'), h('th', { class: 'f' }, '% complete'), h('th', { class: 'f' }, 'Open NCRs'),
            h('th', { class: 'f' }, 'Status'), h('th', { class: 'f' }, 'Next step'), h('th', { class: 'f' }, 'Sequence alert'), h('th', null, 'Remarks'))),
        tbody)),
      h('div', { class: 'legend' }, RES_KEYS.map((k) => h('span', null, h('i', { class: 'sw r-' + k }), A.RES[k] + ' = ' + A.RES_AR[k]))));
  }

  function trackerRow(p, d, u, i) {
    const cps = S.checkpoints;
    const staff = A.isStaff();
    const k = F.row(u, cps, A.openNcrsOf(d, u.id));
    const tr = h('tr', { class: k.W ? 'alert-row' : '' });
    const refresh = () => {
      const fresh = trackerRow(p, d, u, i);
      tr.replaceWith(fresh);
    };
    const text = (key, max, cls) => staff
      ? h('input', { class: 'cell-in ' + (cls || ''), value: u[key] || '', maxlength: max, 'aria-label': key, onChange: async (e) => {
        const v = e.target.value.trim();
        if (key === 'code' && !v) { e.target.value = u.code; return toast('رقم الفيلا مطلوب', 'error'); }
        const r = await S.sb.from('units').update({ [key]: v || null }).eq('id', u.id).select().maybeSingle();
        if (r.error || !r.data) { e.target.value = u[key] || ''; return A.fail(r.error || 'permission denied'); }
        u[key] = r.data[key];
      } })
      : h('span', null, u[key] || '');

    tr.append(
      h('td', { class: 'stk' }, text('code', 40, 'code')),
      h('td', null, text('zone', 60)), h('td', null, text('crew', 60)),
      ...cps.map((c) => {
        const r = u.results?.[c.key] || 'pending';
        if (!staff) return h('td', { class: 'res r-' + r }, A.RES[r]);
        return h('td', { class: 'res r-' + r }, h('select', { 'aria-label': `${u.code} ${c.name_en}`, title: c.name_ar, onChange: async (e) => {
          const v = e.target.value;
          e.target.disabled = true;
          const res = await S.sb.from('unit_checks').update({ result: v }).eq('unit_id', u.id).eq('checkpoint', c.key).select('result').maybeSingle();
          if (res.error || !res.data) { A.fail(res.error || 'permission denied'); return refresh(); }
          u.results = { ...u.results, [c.key]: v };
          refresh();
        } }, RES_KEYS.map((x) => h('option', { value: x, selected: x === r }, A.RES[x]))));
      }),
      h('td', { class: 'calc num' }, String(k.Q)),
      h('td', { class: 'calc num' + (k.R ? ' c-fail' : '') }, String(k.R)),
      h('td', { class: 'calc num' }, A.pctText(k.S)),
      h('td', { class: 'calc num' + (k.T ? ' c-fail' : '') }, String(k.T)),
      h('td', { class: 'calc st st-' + k.U.replace(/\s/g, '-').toLowerCase() }, k.U),
      h('td', { class: 'calc', dir: 'ltr' }, k.V === '-' ? '-' : k.V.name_en),
      h('td', { class: 'calc' }, k.W ? h('span', { class: 'seq' }, 'SEQUENCE ALERT') : ''),
      h('td', { class: 'rem' }, text('remarks', 2000)));
    return tr;
  }

  function addVillas(p, d) {
    const last = d.units.length;
    const prefix = h('input', { dir: 'ltr', value: 'V-' });
    const from = h('input', { type: 'number', min: 1, dir: 'ltr', value: last + 1 });
    const to = h('input', { type: 'number', min: 1, dir: 'ltr', value: last + 1 });
    const zone = h('input', { maxlength: 60 }), crew = h('input', { maxlength: 60 });
    A.modal('إضافة فلل', h('div', { class: 'form-grid' }, A.field('البادئة', prefix), A.field('من', from), A.field('إلى', to), A.field('Zone', zone), A.field('Crew', crew)),
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
     Test Records
     ========================================================== */
  const T_INPUTS = [
    ['system_id', 'Outdoor unit / system ID', 'text'], ['pressure_date', 'Pressure test date', 'date'], ['test_pressure', 'Test pressure (MPa)', 'num'],
    ['hold_hours', 'Hold (hours)', 'num'], ['start_mpa', 'Start (MPa)', 'num'], ['end_mpa', 'End (MPa)', 'num'],
    ['=H', 'Drop (MPa)'], ['=I', 'Pressure check'],
    ['vacuum_date', 'Vacuum date', 'date'], ['vacuum_microns', 'Vacuum reached (microns)', 'num'], ['vacuum_hold_min', 'Vacuum hold (min)', 'num'],
    ['vacuum_rise', 'Vacuum rise (microns)', 'num'], ['=N', 'Vacuum check'],
    ['charge_calc_kg', 'Calculated charge (kg)', 'num'], ['charge_actual_kg', 'Actual charge (kg)', 'num'],
    ['=Q', 'Variance (kg)'], ['=R', 'Variance (%)'], ['=S', 'Charge check'],
    ['cylinder_no', 'Cylinder no.', 'text'], ['inspector', 'Inspector', 'text']
  ];

  function sheetTests(p, d) {
    const staff = A.isStaff();
    const tbody = h('tbody');
    const f = S._tt || (S._tt = { q: '', only: false });
    const draw = () => {
      clear(tbody);
      d.units.forEach((u) => {
        const t = d.tests.get(u.id);
        if (f.q && !u.code.toLowerCase().includes(f.q.toLowerCase())) return;
        if (f.only && !t) return;
        tbody.appendChild(testRow(p, d, u));
      });
    };
    const lim = (key, label, step) => h('label', { class: 'yellow' }, h('span', null, label),
      h('input', { type: 'number', step, min: 0, dir: 'ltr', value: p[key], disabled: !staff, 'aria-label': label, onChange: async (e) => {
        const v = Number(e.target.value);
        if (!(v >= 0) || e.target.value === '') { e.target.value = p[key]; return toast('قيمة غير صحيحة', 'error'); }
        const r = await S.sb.from('projects').update({ [key]: v }).eq('id', p.id).select().maybeSingle();
        if (r.error || !r.data) { e.target.value = p[key]; return A.fail(r.error || 'permission denied'); }
        Object.assign(p, r.data); draw(); toast('تم تحديث الحد');
      } }));
    draw();
    return h('div', { class: 'stack' },
      h('h2', { class: 'sheet-title' }, 'سجل الفحوصات - الضغط والفاكيوم وشحن الفريون لكل فيلا'),
      h('div', { class: 'limits-row' },
        lim('lim_pressure_drop', 'الهبوط المسموح بالضغط (MPa)', 0.001),
        lim('lim_vacuum_max', 'هدف الفاكيوم (مايكرون، حد أعلى)', 1),
        lim('lim_vacuum_hold', 'مدة ثبات الفاكيوم (دقيقة، حد أدنى)', 1),
        lim('lim_charge_tol', 'سماحية الشحن (0.05 = 5%)', 0.005)),
      h('p', { class: 'muted small' }, 'الخانات الصفراء حدود نموذجية أو مفترضة، وليست قواعد البراند الخاصة بكم: راجع كل واحدة مع كتالوج الشركة ونوع الفريون. حد هبوط الضغط يجب تعديله حسب تغيّر الحرارة أثناء الفحص. ارتفاع الفاكيوم المسموح 50 مايكرون (ثابت في معادلة الملف).'),
      h('div', { class: 'filters' },
        h('input', { type: 'search', placeholder: 'بحث برقم الفيلا', value: f.q, 'aria-label': 'بحث', onInput: (e) => { f.q = e.target.value; draw(); } }),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: f.only, onChange: (e) => { f.only = e.target.checked; draw(); } }), h('span', null, 'الفلل التي لها قراءات فقط'))),
      h('div', { class: 'xl-wrap' }, h('table', { class: 'xl tests' },
        h('thead', null,
          h('tr', { class: 'grp' }, h('th', { class: 'stk' }), h('th'), h('th', { colspan: 7 }, 'فحص الضغط'), h('th', { colspan: 5 }, 'الفاكيوم'), h('th', { colspan: 5 }, 'شحن الفريون'), h('th', { colspan: 2 })),
          h('tr', null, h('th', { class: 'stk' }, 'Villa'), T_INPUTS.map(([k, en]) => h('th', { class: k.startsWith('=') ? 'f' : '' }, en)))),
        tbody)));
  }

  function testRow(p, d, u) {
    const t = d.tests.get(u.id) || {};
    const c = F.test(t, p);
    const tr = h('tr');
    const save = async (key, el, kind) => {
      let v = el.value.trim();
      if (kind === 'num') v = v === '' ? null : Number(v);
      else v = v || null;
      if (kind === 'num' && v !== null && !Number.isFinite(v)) { el.value = t[key] ?? ''; return toast('رقم غير صحيح', 'error'); }
      const r = await S.sb.from('test_records').upsert({ unit_id: u.id, [key]: v }, { onConflict: 'unit_id' }).select().single();
      if (r.error) { el.value = t[key] ?? ''; return A.fail(r.error); }
      d.tests.set(u.id, r.data);
      tr.replaceWith(testRow(p, d, u));
    };
    tr.append(h('td', { class: 'stk strong' }, u.code), ...T_INPUTS.map(([k, , kind]) => {
      if (k.startsWith('=')) {
        const v = c[k.slice(1)];
        const shown = v === '' ? '' : k === '=R' ? (Math.round(v * 1000) / 10) + '%' : String(v);
        return h('td', { class: 'calc num' + (v === 'CHECK' ? ' check' : v === 'OK' ? ' ok' : '') }, shown);
      }
      const el = h('input', { class: 'cell-in', type: kind === 'num' ? 'number' : kind === 'date' ? 'date' : 'text', step: 'any', dir: 'ltr',
        value: t[k] ?? '', 'aria-label': `${u.code} ${k}`, maxlength: kind === 'text' ? 120 : null });
      el.addEventListener('change', () => save(k, el, kind));
      return h('td', null, el);
    }));
    return tr;
  }

  /* ==========================================================
     NCR Register
     ========================================================== */
  function sheetNcr(p, d) {
    const staff = A.isStaff();
    const cps = S.checkpoints;
    const code = Object.fromEntries(d.units.map((u) => [u.id, u.code]));
    const f = S._nf || (S._nf = { status: '' });
    const tbody = h('tbody');
    const nextNo = () => 'NCR-' + String(d.ncrs.length + 1).padStart(3, '0');

    const villaSel = (val, attrs = {}) => h('select', attrs, d.units.map((u) => h('option', { value: u.id, selected: u.id === val }, u.code)));
    const cpSel = (val, attrs = {}) => h('select', attrs, cps.map((c) => h('option', { value: c.key, selected: c.key === val }, c.name_en)));

    const rowOf = (n) => {
      const upd = async (patch, el) => {
        const r = await S.sb.from('ncrs').update(patch).eq('id', n.id).select().maybeSingle();
        if (r.error || !r.data) { A.fail(r.error || 'permission denied'); return draw(); }
        Object.assign(n, r.data); draw();
      };
      const overdue = n.status === 'open' && n.due_date && n.due_date < today();
      if (!staff) {
        return h('tr', { class: overdue ? 'overdue' : '' }, h('td', null, n.ncr_no), h('td', { dir: 'ltr' }, n.date_raised), h('td', null, code[n.unit_id]),
          h('td', null, cps.find((c) => c.key === n.checkpoint)?.name_en), h('td', { class: 'desc' }, n.description), h('td', null, n.responsible || ''),
          h('td', { dir: 'ltr' }, n.due_date || ''), h('td', { class: 'res ' + (n.status === 'open' ? 'r-fail' : 'r-pass') }, n.status === 'open' ? 'Open' : 'Closed'), h('td', { dir: 'ltr' }, n.date_closed || ''));
      }
      const inp = (key, type = 'text', cls = '') => h('input', { class: 'cell-in ' + cls, type, dir: type === 'date' ? 'ltr' : null, value: n[key] || '',
        onChange: (e) => upd({ [key]: e.target.value.trim() || null }) });
      return h('tr', { class: overdue ? 'overdue' : '' },
        h('td', null, inp('ncr_no')), h('td', null, inp('date_raised', 'date')),
        h('td', null, villaSel(n.unit_id, { onChange: (e) => upd({ unit_id: e.target.value }) })),
        h('td', null, cpSel(n.checkpoint, { onChange: (e) => upd({ checkpoint: e.target.value }) })),
        h('td', { class: 'desc' }, h('textarea', { class: 'cell-in', rows: 1, value: n.description, onChange: (e) => { if (!e.target.value.trim()) { e.target.value = n.description; return toast('الوصف مطلوب', 'error'); } upd({ description: e.target.value.trim() }); } })),
        h('td', null, inp('responsible')), h('td', null, inp('due_date', 'date', overdue ? 'late' : '')),
        h('td', { class: 'res ' + (n.status === 'open' ? 'r-fail' : 'r-pass') }, h('select', { onChange: (e) => upd({ status: e.target.value }) },
          h('option', { value: 'open', selected: n.status === 'open' }, 'Open'), h('option', { value: 'closed', selected: n.status === 'closed' }, 'Closed'))),
        h('td', null, inp('date_closed', 'date')),
        A.isAdmin() ? h('td', null, h('button', { type: 'button', class: 'btn ghost sm', title: 'حذف', 'aria-label': 'حذف', onClick: async () => {
          if (!await confirmBox({ title: 'حذف NCR', body: `حذف ${n.ncr_no}؟`, okText: 'حذف', danger: true })) return;
          const r = await S.sb.from('ncrs').delete().eq('id', n.id);
          if (r.error) return A.fail(r.error);
          d.ncrs.splice(d.ncrs.indexOf(n), 1); draw();
        } }, '✕')) : null);
    };
    function draw() {
      clear(tbody);
      d.ncrs.filter((n) => !f.status || n.status === f.status).forEach((n) => tbody.appendChild(rowOf(n)));
      if (!tbody.children.length) tbody.appendChild(h('tr', null, h('td', { colspan: 10, class: 'muted center' }, 'لا توجد حالات')));
    }

    // صف الإضافة
    const nw = { no: h('input', { class: 'cell-in', value: nextNo() }), date: h('input', { class: 'cell-in', type: 'date', dir: 'ltr', value: today() }),
      villa: villaSel(null), cp: cpSel(null), desc: h('textarea', { class: 'cell-in', rows: 1, placeholder: 'وصف الخلل' }),
      resp: h('input', { class: 'cell-in', placeholder: 'المسؤول' }), due: h('input', { class: 'cell-in', type: 'date', dir: 'ltr' }) };
    const add = async () => {
      if (!nw.desc.value.trim()) return toast('اكتب الوصف', 'error');
      const r = await S.sb.from('ncrs').insert({ project_id: p.id, ncr_no: nw.no.value.trim() || nextNo(), date_raised: nw.date.value || today(), unit_id: nw.villa.value,
        checkpoint: nw.cp.value, description: nw.desc.value.trim(), responsible: nw.resp.value.trim() || null, due_date: nw.due.value || null }).select().single();
      if (r.error) return A.fail(r.error);
      d.ncrs.push(r.data);
      toast(`تمت إضافة ${r.data.ncr_no}. غيّر البند في Villa Tracker إلى Fail إذا لم يكن كذلك.`);
      A.render();
    };

    draw();
    const open = d.ncrs.filter((n) => n.status === 'open').length;
    return h('div', { class: 'stack' },
      h('h2', { class: 'sheet-title' }, 'سجل عدم المطابقة - كل بند فحص فاشل'),
      h('p', { class: 'muted small' }, 'أضف سطراً لكل فشل. الحالة Open تُحسب على الفيلا في Villa Tracker. اجعلها Closed فقط بعد إعادة الفحص والتأكد من الإصلاح.'),
      h('div', { class: 'filters' },
        h('select', { 'aria-label': 'Status', onChange: (e) => { f.status = e.target.value; draw(); } },
          h('option', { value: '' }, 'Status: الكل'), h('option', { value: 'open', selected: f.status === 'open' }, 'Open'), h('option', { value: 'closed', selected: f.status === 'closed' }, 'Closed')),
        h('span', { class: 'muted small' }, `${open} مفتوحة · ${d.ncrs.length - open} مغلقة`)),
      h('div', { class: 'xl-wrap' }, h('table', { class: 'xl ncr' },
        h('thead', null, h('tr', null, ['NCR no.', 'Date raised', 'Villa', 'Checkpoint', 'Description', 'Responsible', 'Due date', 'Status', 'Date closed'].map((x) => h('th', null, x)), A.isAdmin() ? h('th') : null)),
        staff && d.units.length ? h('tbody', { class: 'new-row' }, h('tr', null,
          h('td', null, nw.no), h('td', null, nw.date), h('td', null, nw.villa), h('td', null, nw.cp), h('td', { class: 'desc' }, nw.desc),
          h('td', null, nw.resp), h('td', null, nw.due), h('td', { colspan: A.isAdmin() ? 3 : 2 }, h('button', { type: 'button', class: 'btn primary sm', onClick: add }, '+ إضافة')))) : null,
        tbody)));
  }

  /* ==========================================================
     How to use
     ========================================================== */
  function sheetGuide(p, d) {
    const del = async () => {
      if (!await confirmBox({ title: 'حذف المشروع', body: `سيُحذف "${p.client}" مع كل الفلل والنتائج والقراءات وNCR نهائياً.`, okText: 'حذف نهائي', danger: true })) return;
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
      h('h2', { class: 'sheet-title' }, 'طريقة الاستخدام'),
      h('p', null, 'سطر واحد لكل فيلا. تحدّثه بعد كل فحص، ولوحة التحكم والتنبيهات تتحدث وحدها.'),
      h('h3', null, 'كيف يعمل'),
      h('ol', null,
        h('li', null, 'المقاول يطلب فحصاً (RFI) لفيلا ونقطة فحص، مثلاً: V-014 فحص الضغط.'),
        h('li', null, 'تفحص حسب قائمة ITP لذلك البند (رقم البند فوق كل عمود في Villa Tracker).'),
        h('li', null, 'افتح ', h('b', null, 'Villa Tracker'), '، جد الفيلا، واختر Pass أو Fail أو N/A أو Pending في عمود نقطة الفحص.'),
        h('li', null, 'قراءات الضغط والفاكيوم والشحن تُسجَّل في ', h('b', null, 'Test Records'), '. الأعمدة الرمادية تُظهر CHECK إذا كانت القراءة خارج الحدود الصفراء.'),
        h('li', null, 'إذا فشل أي بند، اجعله Fail وأضف سطراً في ', h('b', null, 'NCR Register'), '. أغلقه هناك فقط بعد إعادة الفحص والتأكد من الإصلاح.'),
        h('li', null, h('b', null, 'Dashboard'), ' يعرض التقدم لكل نقطة فحص، والفلل التي فيها فشل، وتنبيهات التسلسل (مثل عزل Pass قبل فحص الضغط والفاكيوم).')),
      h('h3', null, 'الألوان والخانات'),
      h('p', null, h('i', { class: 'sw r-pass' }), ' أخضر = Pass، ', h('i', { class: 'sw r-fail' }), ' أحمر = Fail، ', h('i', { class: 'sw r-pending' }), ' أصفر فاتح = Pending، ',
        h('i', { class: 'sw r-na' }), ' رمادي = N/A. الخانات الرمادية الفاتحة معادلات تُحسب تلقائياً، والخانات الصفراء حدود يمكن تغييرها.'),
      h('h3', null, 'إعداد لمرة واحدة'),
      h('ol', { type: 'A' },
        h('li', null, 'غيّر أرقام الفلل في Villa Tracker إلى أرقامكم الحقيقية (V-001 إلى V-250 أرقام مؤقتة)، واملأ Zone وCrew حتى تستطيع التصفية.'),
        h('li', null, 'راجع الحدود الصفراء في Test Records مع كتالوج البراند ونوع الفريون. القيم الموجودة نموذجية وليست قواعد البراند.'),
        h('li', null, 'إذا عندكم أكثر من 250 فيلا، اضغط "+ فلل" في Villa Tracker.'),
        h('li', null, 'استخدم التصفية أعلى الجدول: حسب Crew لرؤية فرقة واحدة، أو Status لرؤية الفلل التي فيها فشل، أو Next step لتخطيط فحوصات الغد.')),
      h('h3', null, 'مثال'),
      h('p', null, 'شهدت فحص الضغط في V-014: اختر Pass في Pressure test (Villa Tracker) وسجّل 4.00 بداية / 3.99 نهاية في Test Records. الفاكيوم ما زال Pending، فيظهر Next step = Vacuum. لا تسمح بالعزل حتى يصبح الفاكيوم Pass.'),
      A.isStaff() ? h('section', { class: 'card' }, h('h3', null, 'إعدادات المشروع'),
        A.field('اسم المشروع', h('input', { value: p.client, maxlength: 200, onChange: rename })),
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
      h('p', { class: 'muted small' }, 'يقرأ الفلل (Villa, Zone, Crew, Remarks) ونتائج المراحل من Villa Tracker، والقراءات والحدود الصفراء من Test Records، والحالات من NCR Register. الفلل الجديدة تُضاف، والقيم في الملف تحلّ محل الحالية.'),
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
      body: `في الملف ${units.length} فيلا (${units.filter((u) => !existing.has(u.code)).length} جديدة)، و${changes} نتيجة ستتغير، و${tests.length} سطر قراءات، و${ncrs.length} NCR. هل تتابع؟` })) return say('أُلغي الاستيراد');
    A.modal('جارٍ الاستيراد…', out, []);

    const errors = [];
    try {
      say('الفلل…');
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
        if (!u) { errors.push(t.code + ': الفيلا غير موجودة (Test Records)'); continue; }
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
        if (!u) { errors.push(x.code + ': الفيلا غير موجودة (NCR)'); continue; }
        const { code, ...row } = x;
        const r = await S.sb.from('ncrs').insert({ ...row, ncr_no: row.ncr_no || 'NCR-' + String(nDone + 1).padStart(3, '0'), project_id: p.id, unit_id: u.id });
        if (r.error) errors.push((x.ncr_no || x.code) + ': ' + A.errText(r.error)); else nDone++;
      }
      await A.loadProject(p.id, true);
      clear(out).append(h('p', { class: 'ok-text' }, `✓ تم: ${units.length} فيلا، ${done} نتيجة، ${tDone} سطر قراءات، ${nDone} NCR.`),
        errors.length ? h('div', { class: 'err' }, h('b', null, `${errors.length} خطأ:`), h('ul', null, errors.slice(0, 30).map((e) => h('li', null, e)))) : null);
      A.modal('اكتمل الاستيراد', out, [{ label: 'عرض Villa Tracker', cls: 'primary', run: () => { A.go(`project/${p.id}/tracker`); A.render(); } }]);
    } catch (e) {
      A.fail(e);
      A.modal('توقف الاستيراد', h('p', { class: 'err' }, A.errText(e)), []);
    }
  }
})();
