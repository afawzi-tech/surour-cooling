/* ==========================================================
   متابعة مشاريع التبريد المركزي - مصاعد السرور
   منطق التطبيق: العقود، المراحل، المواد، والنسخ الاحتياطي
   ========================================================== */
(() => {
  'use strict';

  /* ---------- الثوابت ---------- */
  const KEY = 'surour_cooling_projects_v1';

  const NOT = 'لم تبدأ';
  const DOING = 'جارية';
  const DONE = 'مكتملة';
  const STATUS_LIST = [NOT, DOING, DONE];

  const STAGES = [
    { key: 'contract',         name: 'إنشاء العقد',                       desc: 'توثيق بيانات العميل والعقد' },
    { key: 'survey',           name: 'الكشف على الموقع',                  desc: 'التأكد من جاهزية الموقع وتحديد الكوادر والمواد' },
    { key: 'start',            name: 'المباشرة بالعمل الفعلي',            desc: 'بدء التنفيذ في الموقع' },
    { key: 'indoor_materials', name: 'طرح المواد للموقع (أجهزة داخلية)',  desc: 'إيصال الأجهزة الداخلية إلى الموقع' },
    { key: 'welding',          name: 'أعمال اللحام وتركيب الداخليات',     desc: 'لحام الخطوط وتركيب الوحدات الداخلية' },
    { key: 'piping',           name: 'تسليك الشبكة الداخلية مع الضغط',    desc: 'تمديد الشبكة وإجراء اختبار الضغط' },
    { key: 'drain',            name: 'أعمال الدرين ماي',                  desc: 'تمديد خطوط التصريف' },
    { key: 'signal',           name: 'تمديد واير الإشارة',                desc: 'توصيل أسلاك الإشارة بين الوحدات' }
  ];

  const READY = [
    'الكهرباء جاهزة',
    'الفتحات والسقوف جاهزة',
    'مكان الوحدات الخارجية جاهز',
    'الطريق لإدخال المواد متاح',
    'مكان تخزين المواد متوفر'
  ];

  const ROUTES = {
    dashboard: 'لوحة التحكم',
    projects: 'المشاريع',
    new: 'عقد جديد',
    backup: 'النسخ الاحتياطي',
    project: 'تفاصيل المشروع'
  };

  /* ---------- أدوات مساعدة ---------- */
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const today = () => new Date().toISOString().slice(0, 10);
  const num = (n) => Number(n || 0).toLocaleString('en-US');

  /* ---------- التخزين ---------- */
  function loadDb() {
    try {
      const data = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }
  let db = loadDb();

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
      return true;
    } catch (e) {
      toast('تعذر حفظ البيانات في هذا المتصفح', 'error');
      return false;
    }
  }

  const P = (id) => db.find((p) => p.id === id);

  /* ---------- منطق المراحل والنسب ---------- */
  const stageOf = (p, key) =>
    key === 'contract'
      ? { status: DONE, end: p.contractDate }
      : (p.stages?.[key] || { status: NOT });

  const doneCount = (p) => STAGES.filter((s) => stageOf(p, s.key).status === DONE).length;
  const pct = (p) => Math.round((doneCount(p) / STAGES.length) * 100);
  const currentStage = (p) => {
    const s = STAGES.find((st) => st.key !== 'contract' && stageOf(p, st.key).status !== DONE);
    return s ? s.name : 'مكتمل';
  };
  const cls = (status) => (status === DONE ? 'done' : status === DOING ? 'doing' : '');
  const statusBadge = (status) =>
    status === DONE ? '<span class="badge badge-done">مكتملة</span>'
    : status === DOING ? '<span class="badge badge-doing">جارية</span>'
    : '<span class="badge badge-muted">لم تبدأ</span>';

  /* ---------- التوجيه ---------- */
  const state = {
    route: 'dashboard',
    id: null,
    tab: 'overview',
    filter: 'all',
    search: '',
    editId: null
  };

  function syncRouteFromHash() {
    const h = location.hash.slice(1) || 'dashboard';
    if (h === 'project') {
      state.route = P(state.id) ? 'project' : 'projects';
    } else {
      state.route = ROUTES[h] ? h : 'dashboard';
    }
  }

  function go(route, opts = {}) {
    Object.assign(state, opts);
    state.route = route;
    if (location.hash.slice(1) !== route) {
      location.hash = route;   // سيُعيد hashchange الرسم تلقائياً
    } else {
      render();
    }
  }

  window.addEventListener('hashchange', () => {
    syncRouteFromHash();
    render();
  });

  /* ---------- الرسم ---------- */
  function render() {
    if (state.route !== 'new') state.editId = null;

    document.querySelectorAll('[data-nav]').forEach((a) => {
      const active = state.route === 'project' ? 'projects' : state.route;
      a.classList.toggle('active', a.dataset.nav === active);
    });

    const title =
      state.route === 'project' ? (P(state.id)?.client || ROUTES.project)
      : state.route === 'new' && state.editId ? 'تعديل العقد'
      : ROUTES[state.route];
    $('#pageTitle').textContent = title;

    $('#topActions').innerHTML =
      state.route === 'dashboard' || state.route === 'projects'
        ? '<button class="btn btn-primary" data-act="new">+ عقد جديد</button>'
        : '';

    const views = {
      dashboard: viewDashboard,
      projects: viewProjects,
      new: viewForm,
      backup: viewBackup,
      project: viewProject
    };
    $('#view').innerHTML = views[state.route]();
  }

  const emptyState = (title, sub = '') =>
    `<div class="empty">
       <div class="empty-icon">▦</div>
       <strong>${esc(title)}</strong>
       ${sub ? `<p>${esc(sub)}</p>` : ''}
     </div>`;

  const kpi = (label, value, hint, tone = '') =>
    `<div class="kpi ${tone}">
       <span class="kpi-label">${label}</span>
       <strong class="kpi-value">${value}</strong>
       <span class="kpi-hint">${hint}</span>
     </div>`;

  /* ---------- لوحة التحكم ---------- */
  function viewDashboard() {
    const total = db.length;
    const completed = db.filter((p) => pct(p) === 100).length;
    const active = total - completed;
    const value = db.reduce((s, p) => s + (Number(p.total) || 0), 0);
    const area = db.reduce((s, p) => s + (Number(p.size) || 0), 0);
    const recent = [...db].sort((a, b) => b.created - a.created).slice(0, 6);

    return `
      <section class="kpis">
        ${kpi('إجمالي العقود', num(total), 'عقد مسجّل')}
        ${kpi('مشاريع جارية', num(active), 'قيد التنفيذ', 'tone-warn')}
        ${kpi('مشاريع مكتملة', num(completed), 'اكتملت جميع المراحل', 'tone-ok')}
        ${kpi('إجمالي المساحة', num(area) + ' م²', `قيمة العقود ${num(value)} د.ع`)}
      </section>
      <section class="card table-card">
        <div class="card-head" style="padding:20px 20px 0">
          <h3>أحدث العقود</h3>
          ${total ? '<button class="btn btn-ghost btn-sm" data-nav="projects">عرض الكل</button>' : ''}
        </div>
        ${tableRows(recent)}
      </section>`;
  }

  /* ---------- قائمة المشاريع ---------- */
  function viewProjects() {
    return `
      <div class="toolbar">
        <div class="search">
          <input id="search" type="search" placeholder="ابحث باسم العميل أو العنوان أو الهاتف" value="${esc(state.search)}">
        </div>
        <div class="segmented" role="group" aria-label="تصفية">
          ${[['all', 'الكل'], ['doing', 'جارية'], ['done', 'مكتملة']].map(([v, l]) =>
            `<button class="seg ${state.filter === v ? 'active' : ''}" data-act="filter" data-v="${v}">${l}</button>`
          ).join('')}
        </div>
      </div>
      <section class="card table-card" id="rows">${tableRows()}</section>`;
  }

  function filtered() {
    const q = state.search.trim().toLowerCase();
    return db
      .filter((p) => {
        const complete = pct(p) === 100;
        if (state.filter === 'doing' && complete) return false;
        if (state.filter === 'done' && !complete) return false;
        if (!q) return true;
        return [p.client, p.address, p.phone].some((x) => String(x || '').toLowerCase().includes(q));
      })
      .sort((a, b) => b.created - a.created);
  }

  function tableRows(list = filtered()) {
    if (!list.length) {
      return db.length
        ? emptyState('لا توجد نتائج مطابقة', 'جرّب تغيير كلمة البحث أو التصفية')
        : emptyState('لا توجد مشاريع بعد', 'ابدأ بإضافة عقد جديد من الزر أعلاه');
    }
    return `
      <table class="table">
        <thead>
          <tr>
            <th>العميل</th>
            <th class="hide-sm">المساحة</th>
            <th>المرحلة الحالية</th>
            <th>التقدم</th>
            <th class="hide-sm">قيمة العقد</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((p) => `
            <tr data-act="open" data-id="${p.id}">
              <td><strong>${esc(p.client)}</strong><br><small>${esc(p.address || '—')}</small></td>
              <td class="hide-sm">${p.size ? num(p.size) + ' م²' : '—'}</td>
              <td>${esc(currentStage(p))}</td>
              <td>
                <div class="progress"><span style="width:${pct(p)}%"></span></div>
                <small>${pct(p)}%</small>
              </td>
              <td class="hide-sm">${p.total ? num(p.total) + ' د.ع' : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* ---------- تفاصيل المشروع ---------- */
  function viewProject() {
    const p = P(state.id);
    const tabs = [['overview', 'نظرة عامة'], ['stages', 'مراحل العمل'], ['materials', 'المواد المطلوبة']];
    const body =
      state.tab === 'overview' ? overviewTab(p)
      : state.tab === 'stages' ? stagesTab(p)
      : materialsTab(p);

    return `
      <section class="card project-head">
        <div>
          <div class="crumbs"><a href="#projects" data-nav="projects">المشاريع</a> / <span>${esc(p.client)}</span></div>
          <h2>${esc(p.client)}</h2>
          <p class="sub">${esc(p.address || 'بدون عنوان')} · تاريخ العقد ${esc(p.contractDate || '—')}</p>
        </div>
        <div class="head-side">
          <div class="ring" style="--p:${pct(p)}"><span>${pct(p)}%</span></div>
          <div class="actions">
            <button class="btn btn-ghost" data-act="edit" data-id="${p.id}">تعديل العقد</button>
            <button class="btn btn-danger" data-act="delete" data-id="${p.id}">حذف</button>
          </div>
        </div>
      </section>
      <nav class="tabs" role="tablist">
        ${tabs.map(([k, l]) =>
          `<button class="tab ${state.tab === k ? 'active' : ''}" role="tab" data-act="tab" data-tab="${k}">${l}</button>`
        ).join('')}
      </nav>
      ${body}`;
  }

  function overviewTab(p) {
    const items = [
      ['رقم الهاتف', p.phone ? `<a dir="ltr" href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : '—'],
      ['العنوان', esc(p.address) || '—'],
      ['الموقع على الخريطة', /^https:\/\//i.test(p.mapUrl || '') ? `<a href="${esc(p.mapUrl)}">فتح في الخريطة</a>` : '—'],
      ['حجم البناية', p.size ? num(p.size) + ' م²' : '—'],
      ['عدد الطوابق', esc(p.floors) || '—'],
      ['قيمة العقد', p.total ? num(p.total) + ' د.ع' : '—'],
      ['تاريخ العقد', esc(p.contractDate) || '—'],
      ['المرحلة الحالية', esc(currentStage(p))]
    ];
    return `
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h3>بيانات العقد</h3></div>
          <dl class="info">
            ${items.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
          </dl>
          ${p.notes ? `<div class="note"><strong>ملاحظات</strong><p>${esc(p.notes)}</p></div>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><h3>ملخص المراحل</h3><span class="sub">${doneCount(p)} من ${STAGES.length}</span></div>
          <ul class="mini-stages">
            ${STAGES.map((s, i) => {
              const st = stageOf(p, s.key);
              return `<li><span class="dot ${cls(st.status)}"></span>${i + 1}. ${s.name}<span class="sp"></span>${statusBadge(st.status)}</li>`;
            }).join('')}
          </ul>
        </section>
      </div>`;
  }

  function stagesTab(p) {
    return `<div class="timeline">${STAGES.map((s, i) => stageCard(p, s, i)).join('')}</div>`;
  }

  function stageCard(p, s, i) {
    const st = stageOf(p, s.key);

    if (s.key === 'contract') {
      return `
        <article class="step done">
          <div class="step-num">${i + 1}</div>
          <div class="step-body">
            <div class="step-head">
              <div><h3>${s.name}</h3><p class="sub">${s.desc}</p></div>
              ${statusBadge(DONE)}
            </div>
            <p class="sub">تم توثيق العقد بتاريخ ${esc(p.contractDate)}</p>
          </div>
        </article>`;
    }

    const ready = s.key === 'survey'
      ? `<div class="checks">
           <div class="checks-title">قائمة الجاهزية للموقع</div>
           ${READY.map((r, k) => `
             <label class="check">
               <input type="checkbox" data-ready="${k}" data-pid="${p.id}" ${p.ready?.[k] ? 'checked' : ''}>
               <span>${r}</span>
             </label>`).join('')}
         </div>`
      : '';

    const pid = p.id;
    const key = s.key;
    return `
      <article class="step ${cls(st.status)}">
        <div class="step-num">${i + 1}</div>
        <div class="step-body">
          <div class="step-head">
            <div><h3>${s.name}</h3><p class="sub">${s.desc}</p></div>
            <select class="status-select" data-pid="${pid}" data-stage="${key}" data-field="status" aria-label="حالة المرحلة">
              ${STATUS_LIST.map((x) => `<option ${x === st.status ? 'selected' : ''}>${x}</option>`).join('')}
            </select>
          </div>
          <div class="form-grid compact">
            <div class="field">
              <label>${s.key === 'survey' ? 'عدد الكوادر المطلوب' : 'عدد الكوادر'}</label>
              <input type="number" min="0" dir="ltr" value="${esc(st.crew ?? '')}" data-pid="${pid}" data-stage="${key}" data-field="crew">
            </div>
            <div class="field">
              <label>تاريخ البدء</label>
              <input type="date" dir="ltr" value="${esc(st.start ?? '')}" data-pid="${pid}" data-stage="${key}" data-field="start">
            </div>
            <div class="field">
              <label>تاريخ الانتهاء</label>
              <input type="date" dir="ltr" value="${esc(st.end ?? '')}" data-pid="${pid}" data-stage="${key}" data-field="end">
            </div>
            <div class="field wide">
              <label>ملاحظات</label>
              <textarea rows="2" data-pid="${pid}" data-stage="${key}" data-field="notes">${esc(st.notes ?? '')}</textarea>
            </div>
          </div>
          ${ready}
        </div>
      </article>`;
  }

  function materialsTab(p) {
    return `
      <section class="card">
        <div class="card-head">
          <h3>المواد المطلوبة للعمل</h3>
          <span class="sub">${p.materials.length} بند</span>
        </div>
        ${p.materials.length
          ? `<table class="table">
               <thead><tr><th>المادة</th><th>الوحدة</th><th>الكمية</th><th class="t-end"></th></tr></thead>
               <tbody>
                 ${p.materials.map((m) => `
                   <tr>
                     <td>${esc(m.name)}</td>
                     <td>${esc(m.unit) || '—'}</td>
                     <td dir="ltr">${num(m.qty)}</td>
                     <td class="t-end"><button class="btn btn-ghost btn-sm" data-act="delmat" data-id="${m.id}" data-pid="${p.id}">حذف</button></td>
                   </tr>`).join('')}
               </tbody>
             </table>`
          : emptyState('لم تُضف أي مواد بعد', 'أضف المواد المطلوبة للعمل من النموذج أدناه')}
        <div class="add-row">
          <div class="field"><label for="m-name">اسم المادة</label><input id="m-name" placeholder="مثال: أنابيب نحاس"></div>
          <div class="field"><label for="m-unit">الوحدة</label><input id="m-unit" placeholder="متر، قطعة..."></div>
          <div class="field"><label for="m-qty">الكمية</label><input id="m-qty" type="number" min="0" dir="ltr"></div>
          <button class="btn btn-primary" data-act="addmat" data-pid="${p.id}">إضافة</button>
        </div>
        <div class="err" id="m-err"></div>
      </section>`;
  }

  /* ---------- نموذج العقد ---------- */
  function viewForm() {
    const p = state.editId ? P(state.editId) : null;
    const field = (name, label, o = {}) => `
      <div class="field ${o.wide ? 'wide' : ''}">
        <label for="f-${name}">${label}${o.req ? '<span class="req">*</span>' : ''}</label>
        <input id="f-${name}" name="${name}" type="${o.type || 'text'}" ${o.ltr ? 'dir="ltr"' : ''}
               value="${esc(p ? p[name] : (o.def ?? ''))}" placeholder="${esc(o.ph || '')}">
        <div class="err" data-err="${name}"></div>
      </div>`;

    return `
      <form class="card form" id="contract-form" novalidate>
        <div class="form-section">
          <h3>بيانات العميل</h3>
          <div class="form-grid">
            ${field('client', 'اسم العميل', { req: true })}
            ${field('phone', 'رقم الهاتف', { type: 'tel', ltr: true, ph: '07xxxxxxxxx' })}
            ${field('address', 'العنوان', { wide: true })}
          </div>
        </div>
        <div class="form-section">
          <h3>بيانات الموقع</h3>
          <div class="form-grid">
            ${field('mapUrl', 'رابط الموقع على الخريطة', { wide: true, ltr: true, ph: 'https://maps.google.com/...' })}
            ${field('size', 'حجم البناية (م²)', { type: 'number', ltr: true })}
            ${field('floors', 'عدد الطوابق', { type: 'number', ltr: true })}
          </div>
        </div>
        <div class="form-section">
          <h3>بيانات العقد</h3>
          <div class="form-grid">
            ${field('total', 'قيمة العقد (د.ع)', { type: 'number', ltr: true })}
            ${field('contractDate', 'تاريخ العقد', { type: 'date', ltr: true, req: true, def: today() })}
            <div class="field wide">
              <label for="f-notes">ملاحظات</label>
              <textarea id="f-notes" name="notes" rows="3">${esc(p?.notes || '')}</textarea>
            </div>
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-ghost" data-act="cancel">إلغاء</button>
          <button type="button" class="btn btn-primary" data-act="save">${p ? 'حفظ التعديلات' : 'إنشاء العقد'}</button>
        </div>
      </form>`;
  }

  function saveContract() {
    const val = (k) => $('#f-' + k).value.trim();
    const d = {
      client: val('client'),
      phone: val('phone'),
      address: val('address'),
      mapUrl: val('mapUrl'),
      size: val('size'),
      floors: val('floors'),
      total: val('total'),
      contractDate: val('contractDate'),
      notes: $('#f-notes').value.trim()
    };

    const errs = {};
    if (!d.client) errs.client = 'اسم العميل مطلوب';
    if (d.phone && !/^\+?[0-9 ()-]{7,20}$/.test(d.phone)) errs.phone = 'أدخل رقم هاتف صحيح';
    if (d.mapUrl && !/^https:\/\/\S+$/i.test(d.mapUrl)) errs.mapUrl = 'يجب أن يبدأ الرابط بـ https://';
    if (d.size && !(Number(d.size) > 0)) errs.size = 'أدخل مساحة صحيحة أكبر من صفر';
    if (d.total && !(Number(d.total) >= 0)) errs.total = 'أدخل قيمة صحيحة';
    if (!d.contractDate) errs.contractDate = 'تاريخ العقد مطلوب';

    document.querySelectorAll('[data-err]').forEach((e) => (e.textContent = ''));
    document.querySelectorAll('#contract-form .invalid').forEach((e) => e.classList.remove('invalid'));

    const keys = Object.keys(errs);
    if (keys.length) {
      keys.forEach((k) => {
        document.querySelector(`[data-err="${k}"]`).textContent = errs[k];
        $('#f-' + k).classList.add('invalid');
      });
      $('#f-' + keys[0]).focus();
      return;
    }

    if (state.editId) {
      const p = P(state.editId);
      Object.assign(p, d);
      if (!persist()) return;
      toast('تم حفظ التعديلات');
      go('project', { id: p.id, editId: null });
      return;
    }

    const p = { id: uid(), ...d, stages: {}, ready: {}, materials: [], created: Date.now() };
    db.push(p);
    if (!persist()) return;
    toast('تم إنشاء العقد بنجاح');
    go('project', { id: p.id, tab: 'overview', editId: null });
  }

  /* ---------- تحديث المراحل والمواد ---------- */
  function updateStage(pid, key, field, value) {
    const p = P(pid);
    if (!p) return;
    p.stages = p.stages || {};
    const st = p.stages[key] || (p.stages[key] = { status: NOT });

    if (field === 'crew' && value !== '' && Number(value) < 0) {
      toast('عدد الكوادر لا يمكن أن يكون سالباً', 'error');
      render();
      return;
    }

    st[field] = value;
    if (field === 'status') {
      if (value === DOING && !st.start) st.start = today();
      if (value === DONE && !st.end) st.end = today();
    }

    if (!persist()) return;
    if (field === 'status') {
      const name = STAGES.find((s) => s.key === key).name;
      toast(`${name}: ${value}`);
    }
    render();
  }

  function addMaterial(pid) {
    const p = P(pid);
    const name = $('#m-name').value.trim();
    const unit = $('#m-unit').value.trim();
    const qty = $('#m-qty').value;
    const err = $('#m-err');
    err.textContent = '';

    if (!name) {
      err.textContent = 'اسم المادة مطلوب';
      $('#m-name').focus();
      return;
    }
    if (qty !== '' && Number(qty) < 0) {
      err.textContent = 'الكمية لا يمكن أن تكون سالبة';
      return;
    }

    p.materials.push({ id: uid(), name, unit, qty: qty === '' ? '' : Number(qty) });
    if (persist()) {
      toast('تمت إضافة المادة');
      render();
    }
  }

  function removeMaterial(pid, mid) {
    const p = P(pid);
    p.materials = p.materials.filter((m) => m.id !== mid);
    if (persist()) render();
  }

  function deleteProject(id) {
    const p = P(id);
    confirmBox(
      'حذف المشروع',
      `سيتم حذف عقد "${p.client}" وجميع مراحله ومواده نهائياً. لا يمكن التراجع عن هذا الإجراء.`,
      'حذف نهائي',
      () => {
        db = db.filter((x) => x.id !== id);
        if (persist()) {
          toast('تم حذف المشروع');
          go('projects', { id: null });
        }
      }
    );
  }

  /* ---------- النسخ الاحتياطي ---------- */
  function viewBackup() {
    return `
      <div class="grid-2">
        <section class="card">
          <div class="card-head"><h3>تصدير البيانات</h3></div>
          <p class="sub">انسخ النص أدناه واحفظه في مكان آمن. يحتوي على جميع المشاريع (${num(db.length)}) وتفاصيلها.</p>
          <textarea id="export-box" class="mono" rows="10" readonly style="margin-top:12px">${esc(JSON.stringify(db, null, 2))}</textarea>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-primary" data-act="copy">نسخ إلى الحافظة</button>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h3>استيراد البيانات</h3></div>
          <p class="sub">الصق نسخة سابقة هنا. سيتم استبدال البيانات الحالية بالكامل.</p>
          <textarea id="import-box" class="mono" rows="10" placeholder="الصق النسخة الاحتياطية هنا" style="margin-top:12px"></textarea>
          <div class="actions" style="margin-top:12px">
            <button class="btn btn-ghost" data-act="import">استيراد</button>
          </div>
        </section>
      </div>`;
  }

  function copyBackup() {
    const box = $('#export-box');
    const fallback = () => {
      box.focus();
      box.select();
      toast('تعذر النسخ التلقائي، انسخ النص يدوياً', 'error');
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(box.value)
        .then(() => toast('تم نسخ النسخة الاحتياطية'))
        .catch(fallback);
    } else {
      fallback();
    }
  }

  function importBackup() {
    let arr = null;
    try { arr = JSON.parse($('#import-box').value); } catch (e) { arr = null; }
    const valid = Array.isArray(arr) && arr.every((x) => x && x.id && x.client);
    if (!valid) {
      toast('النص الملصوق غير صالح', 'error');
      return;
    }
    confirmBox(
      'استيراد البيانات',
      'سيتم استبدال كل البيانات الحالية بالنسخة الملصوقة.',
      'استبدال',
      () => {
        db = arr;
        if (persist()) {
          toast('تم الاستيراد بنجاح');
          go('dashboard');
        }
      }
    );
  }

  /* ---------- عناصر مشتركة ---------- */
  function confirmBox(title, text, okLabel, onOk) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt">
        <h3 id="mt">${esc(title)}</h3>
        <p class="sub">${esc(text)}</p>
        <div class="actions end">
          <button class="btn btn-ghost" data-m="no">إلغاء</button>
          <button class="btn btn-danger" data-m="yes">${esc(okLabel)}</button>
        </div>
      </div>`;
    ov.addEventListener('click', (e) => {
      const m = e.target.getAttribute('data-m');
      if (m === 'yes') { ov.remove(); onOk(); }
      else if (m === 'no' || e.target === ov) ov.remove();
    });
    document.body.appendChild(ov);
  }

  function toast(msg, type = 'ok') {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3000);
  }

  /* ---------- الأحداث (تفويض) ---------- */
  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      e.preventDefault();
      state.editId = null;
      go(nav.dataset.nav);
      return;
    }

    const el = e.target.closest('[data-act]');
    if (!el) return;
    const a = el.dataset.act;

    if (a === 'new') go('new', { editId: null });
    else if (a === 'open') go('project', { id: el.dataset.id, tab: 'overview' });
    else if (a === 'edit') go('new', { editId: el.dataset.id });
    else if (a === 'delete') deleteProject(el.dataset.id);
    else if (a === 'tab') { state.tab = el.dataset.tab; render(); }
    else if (a === 'filter') { state.filter = el.dataset.v; render(); }
    else if (a === 'save') saveContract();
    else if (a === 'cancel') {
      if (state.editId) go('project', { id: state.editId, editId: null });
      else go('projects');
    }
    else if (a === 'addmat') addMaterial(el.dataset.pid);
    else if (a === 'delmat') removeMaterial(el.dataset.pid, el.dataset.id);
    else if (a === 'copy') copyBackup();
    else if (a === 'import') importBackup();
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.ready !== undefined) {
      const p = P(el.dataset.pid);
      if (!p) return;
      p.ready = p.ready || {};
      p.ready[el.dataset.ready] = el.checked;
      persist();
      return;
    }
    if (el.dataset.stage) {
      updateStage(el.dataset.pid, el.dataset.stage, el.dataset.field, el.value);
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target.id === 'search') {
      state.search = e.target.value;
      const rows = $('#rows');
      if (rows) rows.innerHTML = tableRows();
    }
  });

  /* ---------- التشغيل ---------- */
  syncRouteFromHash();
  if (!location.hash) location.hash = 'dashboard';
  render();
})();
