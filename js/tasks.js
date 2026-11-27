/* ==========================================================
   مهام المشاريع (فكرة من TaskFlow)
   - مهمة: عنوان، تفاصيل، مسؤول (فني)، أولوية، موعد، ومرحلة اختيارية.
   - المدير والمشرف ينشئون المهام ويحرّكونها بين الأعمدة (سحب وإفلات، أو من نافذة المهمة على الهاتف).
   - الفني لا يعدّل المهمة: يرسل تقريراً (بدأت / أُنجزت) مع ملاحظة وصورة اختيارية، ويطبَّق بعد الموافقة.
   الحماية على الخادم: project_tasks وtask_requests وreview_task_request في schema.sql.
   ========================================================== */
(() => {
  'use strict';

  const { h, toast, num, dateTime } = window.UI;
  const A = window.App;
  const S = A.state;
  const R = () => window.Reports;

  const COLS = [['todo', 'لم تبدأ'], ['in_progress', 'جارية'], ['done', 'أُنجزت']];
  const ST_AR = { todo: 'لم تبدأ', in_progress: 'جارية', done: 'أُنجزت' };
  const PRI = [['urgent', 'عاجلة'], ['high', 'عالية'], ['normal', 'عادية']];
  const PRI_AR = Object.fromEntries(PRI);
  const PRI_RANK = { urgent: 0, high: 1, normal: 2 };
  const ACT_AR = { start: 'بدأت المهمة', done: 'أُنجزت المهمة' };
  const DONE_SHOW = 8;

  S.tasks = []; S.taskReqs = []; S.staffList = [];
  let loaded = null;

  /* ---------- التحميل ---------- */
  // إذا لم تُطبَّق جداول المهام على القاعدة بعد، تختفي الميزة بهدوء
  let loadedFor = null;
  function ensure(force = false) {
    if (loaded && !force && loadedFor === S.user?.id) return loaded;
    loadedFor = S.user?.id;
    loaded = (async () => {
      const since = new Date(Date.now() - 45 * 86400000).toISOString();
      const [t, r, p] = await Promise.all([
        A.fetchAll((a, b) => S.sb.from('project_tasks').select('*').order('position').order('created_at').range(a, b)),
        A.fetchAll((a, b) => S.sb.from('task_requests').select('*').or(`status.eq.pending,requested_at.gte.${since}`).order('requested_at', { ascending: false }).range(a, b)),
        S.sb.from('profiles').select('id, full_name, role, active, crew_id').order('full_name')
      ]).catch((e) => { console.warn('المهام غير مفعّلة بعد:', e?.message || e); return [null, null, null]; });
      S.tasksReady = !!t;
      S.tasks = t || []; S.taskReqs = r || [];
      S.staffList = p && !p.error ? p.data : [];
      return S.tasksReady;
    })();
    return loaded;
  }

  const nameOf = (id) => S.staffList.find((x) => x.id === id)?.full_name || S.people?.[id] || '—';
  const projOf = (id) => S.projects.find((p) => p.id === id);
  const cpName = (k) => S.checkpoints.find((c) => c.key === k)?.name_ar || '';
  const pendingOf = (t) => S.taskReqs.find((r) => r.task_id === t.id && r.status === 'pending') || null;
  const lastOf = (t) => S.taskReqs.filter((r) => r.task_id === t.id).sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))[0] || null;
  const late = (t) => t.status !== 'done' && t.due_date && t.due_date < A.todayStr();
  const mine = (t) => t.assignee === S.user.id;
  const sortOpen = (a, b) => (late(b) - late(a)) || (PRI_RANK[a.priority] - PRI_RANK[b.priority]) || ((a.due_date || '9999').localeCompare(b.due_date || '9999')) || (a.position - b.position);
  const dueText = (t) => {
    if (!t.due_date) return '';
    if (t.status === 'done') return t.due_date;
    const n = A.dayDiff(t.due_date, A.todayStr());
    return n < 0 ? `متأخرة ${A.daysAr(-n)}` : n === 0 ? 'اليوم' : n === 1 ? 'غداً' : `بعد ${A.daysAr(n)}`;
  };
  // الفنيون المفعّلون أولاً، ثم المشرفون والمدير
  const assignable = () => S.staffList.filter((x) => x.active).sort((a, b) => ((a.role === 'technician' ? 0 : 1) - (b.role === 'technician' ? 0 : 1)) || (a.full_name || '').localeCompare(b.full_name || '', 'ar'));

  async function refreshTask(id) {
    const r = await S.sb.from('project_tasks').select('*').eq('id', id).maybeSingle();
    if (r.error) return;
    S.tasks = S.tasks.filter((x) => x.id !== id);
    if (r.data) S.tasks.push(r.data);
  }

  /* ---------- بطاقة المهمة ---------- */
  function card(t, opts) {
    const p = projOf(t.project_id);
    const pend = pendingOf(t);
    const el = h('li', { class: `tk-card pri-${t.priority}` + (late(t) ? ' late' : '') + (mine(t) ? ' mine' : ''), 'data-id': t.id,
      draggable: A.isStaff() ? 'true' : null, tabindex: '0', role: 'button', 'aria-label': `${t.title}، ${ST_AR[t.status]}` },
      h('div', { class: 'tk-top' },
        t.priority !== 'normal' ? h('span', { class: 'chip tk-pri ' + t.priority }, PRI_AR[t.priority]) : null,
        pend ? h('span', { class: 'chip rq-chip sm' }, 'تقرير معلّق') : null),
      h('b', { class: 'tk-title' }, t.title),
      opts.showProject && p ? h('small', { class: 'tk-proj' }, p.client) : null,
      t.checkpoint ? h('small', { class: 'tk-stage' }, 'مرحلة: ' + cpName(t.checkpoint)) : null,
      h('div', { class: 'tk-foot' },
        h('span', { class: 'tk-who' + (t.assignee ? '' : ' none') }, t.assignee ? nameOf(t.assignee) : 'بلا مسؤول'),
        t.due_date ? h('span', { class: 'tk-due' + (late(t) ? ' late' : '') }, dueText(t)) : null));
    const open = () => taskDialog(t);
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    if (A.isStaff()) {
      el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
    }
    return el;
  }

  /* ---------- لوحة كانبان ---------- */
  function board(list, opts = {}) {
    const wrap = h('div', { class: 'tk-board' });
    COLS.forEach(([st, label]) => {
      let xs = list.filter((t) => t.status === st);
      xs = st === 'done' ? xs.sort((a, b) => ((a.done_at || '') < (b.done_at || '') ? 1 : -1)) : xs.sort(sortOpen);
      const more = st === 'done' && xs.length > DONE_SHOW && !opts.allDone;
      const ul = h('ol', { class: 'tk-list' }, (more ? xs.slice(0, DONE_SHOW) : xs).map((t) => card(t, opts)),
        !xs.length ? h('li', { class: 'tk-empty muted small' }, st === 'todo' && A.isStaff() ? 'لا مهام. أضف مهمة أو اسحب إلى هنا.' : 'لا شيء') : null);
      const col = h('section', { class: 'tk-col st-' + st, 'aria-label': label },
        h('header', null, h('h3', null, label), h('span', { class: 'tk-n' }, num(xs.length))), ul,
        more ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => { opts.allDone = true; wrap.replaceWith(board(list, opts)); } }, `عرض كل المنجزة (${num(xs.length)})`) : null);
      if (A.isStaff()) {
        col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
        col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
        col.addEventListener('drop', async (e) => {
          e.preventDefault(); col.classList.remove('over');
          const t = S.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'));
          if (t && t.status !== st) await move(t, st);
        });
      }
      wrap.appendChild(col);
    });
    return wrap;
  }

  async function move(t, st) {
    const r = await S.sb.from('project_tasks').update({ status: st }).eq('id', t.id).select().single();
    if (r.error) return A.fail(r.error);
    Object.assign(t, r.data);
    toast(`"${t.title}": ${ST_AR[st]}`);
    A.render();
  }

  /* ---------- نافذة المهمة ---------- */
  function taskDialog(t) {
    const p = projOf(t.project_id);
    const pend = pendingOf(t);
    const last = lastOf(t);
    const staff = A.isStaff();
    const hist = S.taskReqs.filter((r) => r.task_id === t.id).sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
    const info = h('dl', { class: 'tk-info' },
      [['المشروع', p ? h('a', { href: '#/project/' + p.id, onClick: () => document.getElementById('dialog').close() }, p.client) : '—'],
        ['الحالة', ST_AR[t.status]], ['المسؤول', t.assignee ? nameOf(t.assignee) : 'بلا مسؤول'], ['الأولوية', PRI_AR[t.priority]],
        ['الموعد', t.due_date ? `${t.due_date} (${dueText(t)})` : '—'], t.checkpoint ? ['المرحلة', cpName(t.checkpoint)] : null,
        t.done_at ? ['أُنجزت', dateTime(t.done_at)] : t.started_at ? ['بدأت', dateTime(t.started_at)] : null,
        ['أنشأها', `${nameOf(t.created_by)} · ${dateTime(t.created_at)}`]].filter(Boolean)
        .map(([k, v]) => h('div', null, h('dt', null, k), h('dd', null, v))));
    const body = [info, t.details ? h('p', { class: 'tk-details' }, t.details) : null];
    const actions = [];

    if (staff) {
      body.push(h('div', { class: 'tk-move' }, h('span', { class: 'muted small' }, 'نقل إلى:'),
        COLS.map(([st, l]) => h('button', { type: 'button', class: 'btn sm ' + (t.status === st ? 'primary' : 'ghost'), disabled: t.status === st,
          onClick: async () => { document.getElementById('dialog').close(); await move(t, st); } }, l))));
      if (pend) body.push(h('div', { class: 'rq-box' }, h('span', { class: 'chip rq-chip' }, 'تقرير بانتظار موافقتك'),
        h('button', { type: 'button', class: 'btn primary', onClick: () => reviewDialog(pend) }, 'مراجعة التقرير')));
      actions.push({ label: 'حذف', cls: 'danger', run: () => remove(t) }, { label: 'تعديل', cls: 'primary', run: () => { taskForm(t.project_id, t); return false; } });
    } else if (mine(t)) {
      if (pend) {
        body.push(h('div', { class: 'rq-box' }, h('span', { class: 'chip rq-chip' }, 'بانتظار موافقة المشرف'),
          h('span', { class: 'muted small' }, `${ACT_AR[pend.action]} · أُرسل ${R().since(pend.requested_at)}`),
          h('button', { type: 'button', class: 'btn ghost sm', onClick: () => withdraw(pend) }, 'سحب التقرير')));
      } else if (t.status !== 'done') {
        if (last && last.status === 'rejected') body.push(h('p', { class: 'rq-rejected' }, h('b', null, 'رُفض تقريرك السابق: '), last.review_note || ''));
        if (t.status === 'todo') actions.push({ label: '▶ أبلغ أنني بدأت', cls: '', run: () => { requestDialog(t, 'start'); return false; } });
        actions.push({ label: '✓ أبلغ أنها أُنجزت', cls: 'primary', run: () => { requestDialog(t, 'done'); return false; } });
      }
    }
    if (hist.length) {
      const RS = { pending: 'بانتظار الموافقة', approved: 'موافَق عليه', rejected: 'مرفوض' };
      body.push(h('details', { class: 'rq-hist' }, h('summary', null, `التقارير (${num(hist.length)})`),
        h('ul', null, hist.map((r) => h('li', { class: 'rq-' + r.status },
          h('div', null, h('b', null, ACT_AR[r.action]), ` · ${nameOf(r.requested_by)} · ${dateTime(r.requested_at)} · `, h('span', { class: 'rq-st' }, RS[r.status])),
          r.note ? h('p', { class: 'small' }, r.note) : null,
          r.review_note ? h('p', { class: 'small muted' }, 'ملاحظة المراجعة: ' + r.review_note) : null,
          r.photo_path ? R().photoEl(r.photo_path, 'rq-photo sm') : null)))));
    }
    if (window.Collab) body.push(h('section', { class: 'tk-cm' }, h('h3', null, 'التعليقات'), window.Collab.thread(t.project_id, t.id)));
    A.modal(t.title, h('div', { class: 'stack sm' }, body), actions);
  }

  async function remove(t) {
    const ok = await window.UI.confirmBox({ title: 'حذف المهمة؟', body: `"${t.title}" ستُحذف مع تقاريرها. يبقى الحذف في سجل العمليات.`, okText: 'حذف', danger: true });
    if (!ok) return false;
    const r = await S.sb.from('project_tasks').delete().eq('id', t.id).select();
    if (r.error || !r.data.length) { A.fail(r.error || 'permission denied'); return false; }
    S.tasks = S.tasks.filter((x) => x.id !== t.id);
    toast('حُذفت المهمة');
    A.render();
  }

  /* ---------- إنشاء وتعديل (المدير والمشرف) ---------- */
  function taskForm(projectId, t = null) {
    const el = {
      project: h('select', { required: true }, h('option', { value: '' }, 'اختر المشروع'),
        S.projects.slice().sort((a, b) => a.client.localeCompare(b.client, 'ar')).map((p) => h('option', { value: p.id, selected: p.id === (t?.project_id || projectId) }, p.client))),
      title: h('input', { maxlength: 200, required: true, value: t?.title || '', placeholder: 'مثلاً: جلب مواد الطابق الثاني' }),
      details: h('textarea', { rows: 3, maxlength: 2000, value: t?.details || '' }),
      assignee: h('select', null, h('option', { value: '' }, 'بلا مسؤول'),
        assignable().map((x) => h('option', { value: x.id, selected: x.id === t?.assignee }, (x.full_name || '—') + (x.role === 'technician' ? '' : x.role === 'admin' ? ' (مدير)' : ' (مشرف)')))),
      priority: h('select', null, PRI.map(([k, l]) => h('option', { value: k, selected: k === (t?.priority || 'normal') }, l))),
      due: h('input', { type: 'date', dir: 'ltr', value: t?.due_date || '' }),
      stage: h('select', null, h('option', { value: '' }, 'غير مرتبطة بمرحلة'), S.checkpoints.map((c) => h('option', { value: c.key, selected: c.key === t?.checkpoint }, `${num(c.position)}. ${c.name_ar}`)))
    };
    A.modal(t ? 'تعديل المهمة' : 'مهمة جديدة', h('div', { class: 'form-grid' },
      projectId && !t ? null : A.field('المشروع', el.project, { wide: true }),
      A.field('العنوان', el.title, { wide: true }), A.field('المسؤول', el.assignee), A.field('الأولوية', el.priority),
      A.field('الموعد', el.due), A.field('المرحلة', el.stage), A.field('تفاصيل', el.details, { wide: true })),
    [{ label: t ? 'حفظ' : 'إضافة', cls: 'primary', run: async () => {
      const v = { project_id: projectId && !t ? projectId : el.project.value, title: el.title.value.trim(), details: el.details.value.trim() || null,
        assignee: el.assignee.value || null, priority: el.priority.value, due_date: el.due.value || null, checkpoint: el.stage.value || null };
      if (!v.project_id) { toast('اختر المشروع', 'error'); return false; }
      if (!v.title) { toast('اكتب عنوان المهمة', 'error'); el.title.focus(); return false; }
      const q = t ? S.sb.from('project_tasks').update(v).eq('id', t.id) : S.sb.from('project_tasks').insert({ ...v, position: Date.now() / 1000 });
      const r = await q.select().single();
      if (r.error) { A.fail(r.error); return false; }
      if (t) Object.assign(t, r.data); else S.tasks.push(r.data);
      toast(t ? 'حُفظت المهمة' : 'أُضيفت المهمة');
      A.render();
    } }]);
    setTimeout(() => el.title.focus(), 50);
  }

  /* ---------- الفني: تقرير عن مهمة ---------- */
  function requestDialog(t, action) {
    const p = projOf(t.project_id);
    let blob = null;
    const preview = h('div', { class: 'rq-preview' });
    const pick = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', capture: 'environment', class: 'rq-file', id: 'tk-file' });
    const label = h('label', { for: 'tk-file', class: 'btn big rq-pick' }, '📷 التقط صورة (اختياري)');
    pick.addEventListener('change', async () => {
      const f = pick.files && pick.files[0];
      preview.replaceChildren(); blob = null;
      if (!f) return;
      preview.appendChild(h('p', { class: 'muted small' }, 'جارٍ تجهيز الصورة…'));
      try {
        blob = await R().shrink(f);
        preview.replaceChildren(h('img', { src: URL.createObjectURL(blob), alt: 'الصورة المختارة', class: 'rq-photo' }));
        label.lastChild.textContent = '📷 تغيير الصورة';
      } catch (e) { preview.replaceChildren(h('p', { class: 'err small' }, e.message)); }
    });
    const note = h('textarea', { rows: 3, maxlength: 1000, placeholder: action === 'done' ? 'ماذا أُنجز؟ هل بقي شيء؟' : 'ملاحظة (اختياري)' });
    A.modal(`${ACT_AR[action]}: ${t.title}`, h('div', { class: 'stack sm' },
      h('p', { class: 'muted' }, `${p?.client || ''}. يصل التقرير إلى المشرف، وتتحدّث المهمة بعد موافقته.`),
      pick, label, preview, A.field('ملاحظة', note)),
    [{ label: 'إرسال للمشرف', cls: 'primary', run: async () => {
      let path = null;
      if (blob) {
        path = `${t.project_id}/${S.user.id}/${crypto.randomUUID()}.jpg`;
        const up = await S.sb.storage.from(R().BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) { A.fail(up.error); return false; }
      }
      const r = await S.sb.from('task_requests').insert({ task_id: t.id, action, note: note.value.trim() || null, photo_path: path }).select().single();
      if (r.error) {
        if (path) await S.sb.storage.from(R().BUCKET).remove([path]);
        A.fail(r.error); return false;
      }
      S.taskReqs.unshift(r.data);
      toast('أُرسل التقرير للمشرف');
      A.render();
    } }]);
  }

  async function withdraw(r) {
    const res = await S.sb.from('task_requests').delete().eq('id', r.id).select();
    if (res.error || !res.data.length) return A.fail(res.error || 'permission denied');
    if (r.photo_path) await S.sb.storage.from(R().BUCKET).remove([r.photo_path]);
    S.taskReqs = S.taskReqs.filter((x) => x.id !== r.id);
    document.getElementById('dialog').close();
    toast('سُحب التقرير');
    A.render();
  }

  /* ---------- المشرف: مراجعة تقرير ---------- */
  function reviewDialog(r) {
    const t = S.tasks.find((x) => x.id === r.task_id);
    if (!t) return;
    const p = projOf(t.project_id);
    const reason = h('textarea', { rows: 2, maxlength: 500, placeholder: 'مطلوب عند الرفض، ويراه الفني' });
    const decide = async (approve) => {
      if (!approve && !reason.value.trim()) { toast('اكتب سبب الرفض', 'error'); reason.focus(); return false; }
      const res = await S.sb.rpc('review_task_request', { req: r.id, approve, reason: reason.value.trim() || null });
      if (res.error) { A.fail(res.error); return false; }
      Object.assign(r, res.data);
      await refreshTask(t.id);
      toast(approve ? `تمت الموافقة: ${ACT_AR[r.action]}` : 'رُفض التقرير وسيرى الفني السبب');
      A.render();
    };
    A.modal(`تقرير: ${ACT_AR[r.action]}`, h('div', { class: 'stack sm' },
      h('p', null, h('b', null, t.title), p ? ` · ${p.client}` : ''),
      h('p', { class: 'muted small' }, `من ${nameOf(r.requested_by)} · ${R().since(r.requested_at)} (${dateTime(r.requested_at)}) · المهمة الآن: ${ST_AR[t.status]}`),
      r.photo_path ? R().photoEl(r.photo_path, 'rq-photo big') : h('p', { class: 'muted small' }, 'بدون صورة'),
      r.note ? h('blockquote', { class: 'rq-note' }, r.note) : null,
      A.field('ملاحظة للفني', reason)),
    [{ label: 'رفض', cls: 'danger', run: () => decide(false) }, { label: '✓ موافقة', cls: 'primary', run: () => decide(true) }]);
  }

  /* ---------- قسم المهام في صفحة المشروع ---------- */
  function projectPanel(p) {
    if (!S.tasksReady) {   // أول فتح: نحمّل المهام ثم نرسم
      const box = h('div', { class: 'loading' }, 'جارٍ التحميل…');
      ensure().then((ok) => { if (box.isConnected) box.replaceWith(ok ? projectPanel(p) : h('p', { class: 'muted' }, 'المهام غير مفعّلة بعد على قاعدة البيانات.')); });
      return box;
    }
    return panel(p);
  }
  function panel(p) {
    const list = S.tasks.filter((t) => t.project_id === p.id);
    const open = list.filter((t) => t.status !== 'done');
    return h('div', { class: 'tk-panel' },
      h('div', { class: 'tk-bar' },
        h('p', { class: 'muted small' }, list.length ? `${num(open.length)} مفتوحة` + (open.filter(late).length ? `، منها ${num(open.filter(late).length)} متأخرة` : '') + ` · ${num(list.length - open.length)} أُنجزت`
          : 'لا مهام في هذا المشروع بعد.'),
        A.isStaff() ? h('button', { type: 'button', class: 'btn primary', onClick: () => taskForm(p.id) }, '+ مهمة') : null),
      board(list, {}),
      A.isStaff() ? h('p', { class: 'd2-note muted small' }, 'اسحب البطاقة إلى عمود آخر لتغيير حالتها، أو اضغطها. الفني يبلّغ بتقرير وتتغيّر الحالة بعد موافقتك.') : null);
  }

  /* ---------- صفحة المهام: كل المشاريع ---------- */
  const TF_DEFAULT = { project: '', who: '', pri: '', late: false };
  A.views.tasks = {
    title: () => (A.isStaff() ? 'المهام' : 'مهامي'),
    async render() {
      await ensure();
      if (!S.tasksReady) return A.empty('المهام غير مفعّلة بعد', 'تحتاج تطبيق تحديث قاعدة البيانات.');
      const staff = A.isStaff();
      const F = S._tf || (S._tf = { ...TF_DEFAULT, who: staff ? '' : S.user.id });
      if (!staff) F.who = S.user.id;
      const pend = staff ? S.taskReqs.filter((r) => r.status === 'pending' && S.tasks.some((t) => t.id === r.task_id)) : [];
      const list = S.tasks.filter((t) => (!F.project || t.project_id === F.project) && (!F.who || (F.who === '-' ? !t.assignee : t.assignee === F.who))
        && (!F.pri || t.priority === F.pri) && (!F.late || late(t)));
      const sel = (k, opts) => h('select', { 'aria-label': k, onChange: (e) => { F[k] = e.target.value; A.render(); } },
        opts.map(([v, l]) => h('option', { value: v, selected: F[k] === v }, l)));
      const lateN = S.tasks.filter((t) => late(t) && (staff || mine(t))).length;
      return h('div', { class: 'tk-page' },
        h('div', { class: 'tk-head' }, h('h1', null, staff ? 'المهام' : 'مهامي'),
          staff ? h('button', { type: 'button', class: 'btn primary', onClick: () => taskForm(F.project || null) }, '+ مهمة') : null),
        pend.length ? h('section', { class: 'tk-pend' }, h('h2', null, `تقارير مهام بانتظار موافقتك (${num(pend.length)})`),
          h('ul', null, pend.map((r) => {
            const t = S.tasks.find((x) => x.id === r.task_id);
            return h('li', null, h('button', { type: 'button', onClick: () => reviewDialog(r) },
              h('b', null, t.title), h('span', null, `${nameOf(r.requested_by)}: ${ACT_AR[r.action]}`), h('small', null, R().since(r.requested_at))));
          }))) : null,
        h('div', { class: 'tk-filters' },
          sel('project', [['', 'كل المشاريع'], ...S.projects.slice().sort((a, b) => a.client.localeCompare(b.client, 'ar')).map((p) => [p.id, p.client])]),
          staff ? sel('who', [['', 'كل المسؤولين'], ['-', 'بلا مسؤول'], ...assignable().map((x) => [x.id, x.full_name || '—'])]) : null,
          sel('pri', [['', 'كل الأولويات'], ...PRI]),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: F.late, onChange: (e) => { F.late = e.target.checked; A.render(); } }), ` المتأخرة فقط (${num(lateN)})`),
          Object.keys(TF_DEFAULT).some((k) => k !== 'who' && F[k] !== TF_DEFAULT[k]) || (staff && F.who)
            ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => { S._tf = { ...TF_DEFAULT, who: staff ? '' : S.user.id }; A.render(); } }, 'مسح التصفية') : null),
        board(list, { showProject: true }),
        !staff && !list.length ? h('p', { class: 'muted' }, 'لا مهام مسندة لك الآن.') : null);
    }
  };

  /* ---------- في اللوحة ---------- */
  function homeBox() {
    if (!S.tasksReady) return null;
    const staff = A.isStaff();
    const open = S.tasks.filter((t) => t.status !== 'done' && (staff || mine(t))).sort(sortOpen);
    const pend = staff ? S.taskReqs.filter((r) => r.status === 'pending' && S.tasks.some((t) => t.id === r.task_id)) : [];
    if (!open.length && !pend.length && staff) return null;
    const lateN = open.filter(late).length;
    return h('section', { class: 'tk-home' + (lateN || pend.length ? ' has' : '') },
      h('div', { class: 'd2-plan-head' }, h('h2', null, staff ? 'المهام المفتوحة' : 'مهامي'),
        h('a', { href: '#/tasks', class: 'link small' }, 'كل المهام')),
      h('p', { class: 'd2-note' }, `${num(open.length)} مفتوحة` + (lateN ? `، ${num(lateN)} متأخرة` : '') + (pend.length ? `، و${num(pend.length)} تقرير بانتظار موافقتك` : '')),
      open.length ? h('ol', { class: 'tk-list compact' }, open.slice(0, 5).map((t) => card(t, { showProject: true })))
        : h('p', { class: 'calm muted' }, 'لا مهام مسندة لك الآن.'));
  }

  window.Tasks = { ensure, projectPanel, homeBox, taskForm, board, late };
})();
