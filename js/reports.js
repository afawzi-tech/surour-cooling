/* ==========================================================
   تقارير الفني عن المراحل
   الفني عضو في فرقة، ويبلّغ عن بدء أو إكمال مرحلة مسندة لفرقته مع صورة وملاحظة.
   التقرير طلب بانتظار موافقة المشرف، ولا يغيّر المرحلة حتى يوافق.
   الحماية على الخادم (stage_requests وreview_stage_request وسياسات مخزن stage-photos في schema.sql).
   ========================================================== */
(() => {
  'use strict';

  const { h, toast, num, dateTime } = window.UI;
  const A = window.App;
  const S = A.state;
  const BUCKET = 'stage-photos';
  const ACTION_AR = { start: 'بدأت المرحلة', done: 'اكتملت المرحلة' };
  const MAX_SIDE = 1600, MAX_BYTES = 5 * 1024 * 1024;

  const cpOf = (key) => S.checkpoints.find((c) => c.key === key);
  const nameOf = (id) => S.people[id] || 'مستخدم';
  const myCrew = () => S.profile?.crew_id || null;
  const pendingFor = (p, key) => S.requests.find((r) => r.project_id === p.id && r.checkpoint === key && r.status === 'pending') || null;
  // آخر تقرير للمرحلة (لعرض سبب الرفض للفني)
  const lastFor = (p, key) => S.requests.filter((r) => r.project_id === p.id && r.checkpoint === key)
    .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1))[0] || null;
  // الفني يبلّغ فقط عن مرحلة مسندة لفرقته
  const canReport = (p, key) => !A.isStaff() && !!myCrew() && A.stageOf(p, key).crew_id === myCrew();
  const since = (t) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000));
    if (m < 1) return 'الآن';
    if (m < 60) return m === 1 ? 'منذ دقيقة' : m === 2 ? 'منذ دقيقتين' : `منذ ${num(m)} دقيقة`;
    const hr = Math.round(m / 60);
    if (hr < 24) return hr === 1 ? 'منذ ساعة' : hr === 2 ? 'منذ ساعتين' : `منذ ${num(hr)} ساعات`;
    const d = Math.round(hr / 24);
    return d === 1 ? 'منذ يوم' : d === 2 ? 'منذ يومين' : `منذ ${num(d)} أيام`;
  };

  /* ---------- الصور ---------- */
  // تصغير الصورة في الهاتف قبل الرفع: أطول ضلع 1600 بكسل، JPEG
  async function shrink(file) {
    if (!/^image\//.test(file.type)) throw new Error('الملف ليس صورة');
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { throw new Error('تعذّرت قراءة الصورة. جرّب صورة JPEG أو PNG'); }
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
    if (!blob) throw new Error('تعذّر تجهيز الصورة');
    if (blob.size > MAX_BYTES) throw new Error('الصورة كبيرة جداً');
    return blob;
  }

  // الصور في مخزن خاص: تُنزَّل بصلاحية المستخدم وتُعرض كرابط blob محلي
  const urlCache = new Map();
  async function photoUrl(path) {
    if (urlCache.has(path)) return urlCache.get(path);
    const { data, error } = await S.sb.storage.from(BUCKET).download(path);
    if (error || !data || !/^image\//.test(data.type || 'image/jpeg')) return null;
    const url = URL.createObjectURL(data);
    urlCache.set(path, url);
    return url;
  }
  function photoEl(path, cls = 'rq-photo') {
    const img = h('img', { alt: 'صورة من الموقع', class: cls, loading: 'lazy' });
    const box = h('button', { type: 'button', class: 'rq-photo-btn', 'aria-label': 'عرض الصورة بالحجم الكامل', disabled: true }, img,
      h('span', { class: 'rq-photo-wait' }, 'جارٍ تحميل الصورة…'));
    const load = () => photoUrl(path).then((u) => {
      if (!u) { box.lastChild.textContent = 'تعذّر تحميل الصورة'; return; }
      img.setAttribute('src', u); box.lastChild.remove(); box.disabled = false;
      box.addEventListener('click', () => viewPhoto(u));
    });
    // تُنزَّل الصورة عندما تظهر على الشاشة فقط (توفير بيانات الهاتف في السجل الطويل)
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); load(); } }, { rootMargin: '300px' });
      requestAnimationFrame(() => io.observe(box));
    } else load();
    return box;
  }
  function viewPhoto(u) {
    const dlg = h('dialog', { class: 'photo-view' },
      h('img', { src: u, alt: 'صورة من الموقع' }),
      h('button', { type: 'button', class: 'btn', onClick: () => dlg.close() }, 'إغلاق'));
    dlg.addEventListener('close', () => dlg.remove());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  /* ---------- الفني: إرسال تقرير ---------- */
  function requestDialog(p, key, action) {
    const c = cpOf(key);
    const needPhoto = action === 'done';
    let blob = null;
    const preview = h('div', { class: 'rq-preview' });
    const pick = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/*', capture: 'environment', class: 'rq-file', id: 'rq-file' });
    const label = h('label', { for: 'rq-file', class: 'btn big rq-pick' }, '📷 ' + (needPhoto ? 'التقط صورة للعمل المنجز' : 'التقط صورة (اختياري)'));
    pick.addEventListener('change', async () => {
      const f = pick.files && pick.files[0];
      preview.replaceChildren();
      blob = null;
      if (!f) return;
      preview.appendChild(h('p', { class: 'muted small' }, 'جارٍ تجهيز الصورة…'));
      try {
        blob = await shrink(f);
        const u = URL.createObjectURL(blob);
        preview.replaceChildren(h('img', { src: u, alt: 'الصورة المختارة', class: 'rq-photo' }),
          h('small', { class: 'muted' }, `${num(Math.round(blob.size / 1024))} كيلوبايت`));
        label.lastChild.textContent = '📷 تغيير الصورة';
      } catch (e) { preview.replaceChildren(h('p', { class: 'err small' }, e.message)); }
    });
    const note = h('textarea', { rows: 3, maxlength: 1000, placeholder: needPhoto ? 'ماذا أُنجز؟ هل بقيت ملاحظات؟' : 'عدد العمال، ما الذي بدأ… (اختياري)' });
    A.modal(`${ACTION_AR[action]}: ${c.name_ar}`, h('div', { class: 'stack sm' },
      h('p', { class: 'muted' }, `${p.client}. يصل التقرير إلى المشرف، وتتحدّث المرحلة بعد موافقته.`),
      pick, label, preview,
      A.field('ملاحظة', note)),
    [{ label: 'إرسال للمشرف', cls: 'primary', run: async () => {
      if (needPhoto && !blob) { toast('أرفق صورة للعمل المنجز', 'error'); return false; }
      let path = null;
      if (blob) {
        path = `${p.id}/${S.user.id}/${crypto.randomUUID()}.jpg`;
        const up = await S.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (up.error) { A.fail(up.error); return false; }
      }
      const r = await S.sb.from('stage_requests').insert({ project_id: p.id, checkpoint: key, action, note: note.value.trim() || null, photo_path: path }).select().single();
      if (r.error) {
        if (path) await S.sb.storage.from(BUCKET).remove([path]);
        A.fail(r.error); return false;
      }
      S.requests.unshift(r.data);
      toast('أُرسل التقرير للمشرف');
      A.render();
    } }]);
  }

  async function withdraw(r) {
    const res = await S.sb.from('stage_requests').delete().eq('id', r.id).select();
    if (res.error || !res.data.length) return A.fail(res.error || 'permission denied');
    if (r.photo_path) await S.sb.storage.from(BUCKET).remove([r.photo_path]);
    S.requests = S.requests.filter((x) => x.id !== r.id);
    toast('سُحب التقرير');
    A.render();
  }

  /* ---------- المشرف: الموافقة أو الرفض ---------- */
  function reviewDialog(r) {
    const p = S.projects.find((x) => x.id === r.project_id);
    const c = cpOf(r.checkpoint);
    if (!p || !c) return;
    const reason = h('textarea', { rows: 2, maxlength: 500, placeholder: 'مطلوب عند الرفض، ويراه الفني' });
    const decide = async (approve) => {
      if (!approve && !reason.value.trim()) { toast('اكتب سبب الرفض', 'error'); reason.focus(); return false; }
      const res = await S.sb.rpc('review_stage_request', { req: r.id, approve, reason: reason.value.trim() || null });
      if (res.error) { A.fail(res.error); return false; }
      Object.assign(r, res.data);
      // المرحلة (والتالية عند الإكمال) تغيّرت على الخادم
      const st = await S.sb.from('project_stages').select('*').eq('project_id', p.id);
      if (!st.error) { S.stages[p.id] = {}; st.data.forEach((x) => { S.stages[p.id][x.checkpoint] = x; }); }
      toast(approve ? `تمت الموافقة: ${ACTION_AR[r.action]} "${c.name_ar}"` : 'رُفض التقرير وسيرى الفني السبب');
      A.render();
    };
    const s = A.stageOf(p, r.checkpoint);
    A.modal(`تقرير: ${ACTION_AR[r.action]}`, h('div', { class: 'stack sm' },
      h('p', null, h('b', null, p.client), ` · ${num(c.position)}. ${c.name_ar}`),
      h('p', { class: 'muted small' }, `من ${nameOf(r.requested_by)} · ${since(r.requested_at)} (${dateTime(r.requested_at)})` +
        (A.crewOf(s.crew_id) ? ` · ${A.crewOf(s.crew_id).name}` : '') + ` · المرحلة الآن: ${A.STAGE_AR[s.status]}`),
      r.photo_path ? photoEl(r.photo_path, 'rq-photo big') : h('p', { class: 'muted small' }, 'بدون صورة'),
      r.note ? h('blockquote', { class: 'rq-note' }, r.note) : null,
      A.field('ملاحظة للفني', reason),
      r.action === 'done' ? h('p', { class: 'muted small' }, 'عند الموافقة تكتمل المرحلة وتبدأ المرحلة التالية وحدها.') : null),
    [{ label: 'رفض', cls: 'danger', run: () => decide(false) }, { label: '✓ موافقة', cls: 'primary', run: () => decide(true) }]);
  }

  /* ---------- أجزاء تُعرض في صفحة المشروع ---------- */
  // داخل بطاقة المرحلة الحالية: للفني أزرار التبليغ، وللمشرف التقرير المعلّق
  function nowCardPart(p, key, status) {
    const pend = pendingFor(p, key);
    if (A.isStaff()) {
      if (!pend) return null;
      return h('div', { class: 'rq-box' },
        h('div', { class: 'rq-head' }, h('span', { class: 'chip rq-chip' }, 'تقرير بانتظار موافقتك'),
          h('span', { class: 'muted small' }, `${nameOf(pend.requested_by)}: ${ACTION_AR[pend.action]} · ${since(pend.requested_at)}`)),
        h('button', { type: 'button', class: 'btn primary', onClick: () => reviewDialog(pend) }, 'مراجعة التقرير' + (pend.photo_path ? ' والصورة' : '')));
    }
    if (!canReport(p, key)) return null;
    if (pend) {
      return h('div', { class: 'rq-box' },
        h('div', { class: 'rq-head' }, h('span', { class: 'chip rq-chip' }, 'بانتظار موافقة المشرف'),
          h('span', { class: 'muted small' }, `${ACTION_AR[pend.action]} · أُرسل ${since(pend.requested_at)}`)),
        pend.requested_by === S.user.id ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => withdraw(pend) }, 'سحب التقرير') : null);
    }
    const last = lastFor(p, key);
    const action = status === 'in_progress' ? 'done' : status === 'not_started' ? 'start' : null;
    if (!action) return null;
    return h('div', { class: 'rq-box tech' },
      last && last.status === 'rejected' && last.requested_by === S.user.id
        ? h('p', { class: 'rq-rejected' }, h('b', null, 'رُفض تقريرك السابق: '), last.review_note || '') : null,
      h('button', { type: 'button', class: 'btn primary big', onClick: () => requestDialog(p, key, action) },
        action === 'done' ? '📷 أبلغ أن المرحلة اكتملت' : '▶ أبلغ أن العمل بدأ'),
      h('p', { class: 'muted small' }, action === 'done' ? 'مع صورة للعمل المنجز. تكتمل المرحلة بعد موافقة المشرف.' : 'تبدأ المرحلة بعد موافقة المشرف.'));
  }

  // علامة صغيرة في قائمة المراحل
  const stepBadge = (p, key) => (pendingFor(p, key) ? h('span', { class: 'chip rq-chip sm' }, 'تقرير معلّق') : null);

  // سجل تقارير المرحلة (في نافذة تعديل المرحلة للمشرف)
  function stageHistory(p, key) {
    const list = S.requests.filter((r) => r.project_id === p.id && r.checkpoint === key)
      .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1));
    if (!list.length) return null;
    const ST = { pending: 'بانتظار الموافقة', approved: 'موافَق عليه', rejected: 'مرفوض' };
    return h('details', { class: 'rq-hist wide' }, h('summary', null, `تقارير الفنيين (${num(list.length)})`),
      h('ul', null, list.map((r) => h('li', { class: 'rq-' + r.status },
        h('div', null, h('b', null, ACTION_AR[r.action]), ` · ${nameOf(r.requested_by)} · ${dateTime(r.requested_at)} · `, h('span', { class: 'rq-st' }, ST[r.status])),
        r.note ? h('p', { class: 'small' }, r.note) : null,
        r.review_note ? h('p', { class: 'small muted' }, 'ملاحظة المراجعة: ' + r.review_note) : null,
        r.photo_path ? photoEl(r.photo_path, 'rq-photo sm') : null))));
  }

  /* ---------- اللوحة ---------- */
  // للمشرف: كل التقارير المعلّقة. للفني: مراحل فرقته الحالية
  function homeBox() {
    const cpN = (k) => cpOf(k)?.name_ar || k;
    if (A.isStaff()) {
      const pend = S.requests.filter((r) => r.status === 'pending' && S.projects.some((p) => p.id === r.project_id))
        .sort((a, b) => (a.requested_at < b.requested_at ? -1 : 1));
      if (!pend.length) return null;
      return h('section', { class: 'd2-reqs has' }, h('div', { class: 'd2-plan-head' }, h('h2', null, `تقارير بانتظار موافقتك (${num(pend.length)})`),
        h('a', { href: '#/reports', class: 'link small' }, 'سجل التقارير')),
        h('ul', { class: 'rq-list' }, pend.map((r) => {
          const p = S.projects.find((x) => x.id === r.project_id);
          return h('li', null, h('button', { type: 'button', class: 'rq-row', onClick: () => reviewDialog(r) },
            h('span', { class: 'rq-ic', 'aria-hidden': 'true' }, r.photo_path ? '📷' : '📝'),
            h('span', { class: 'rq-main' }, h('b', null, p.client), h('small', null, `${ACTION_AR[r.action]}: ${cpN(r.checkpoint)}`)),
            h('span', { class: 'rq-who' }, nameOf(r.requested_by), h('small', null, since(r.requested_at))),
            h('span', { class: 'rq-go', 'aria-hidden': 'true' }, '←')));
        })));
    }
    const crew = myCrew();
    if (!crew) {
      return h('section', { class: 'd2-reqs' }, h('h2', null, 'مراحلك'),
        h('p', { class: 'calm muted' }, 'لم تُضَف إلى فرقة بعد. اطلب من المدير إضافتك إلى فرقتك حتى تبلّغ عن تقدّم مراحلها.'));
    }
    const mine = [];
    S.projects.forEach((p) => {
      if (A.isCompound(p)) return;
      const sp = A.stageProgress(p);
      if (sp.status === 'done' || !sp.cur) return;
      if (sp.cur.s.crew_id === crew) mine.push({ p, c: sp.cur.c, s: sp.cur.s });
    });
    return h('section', { class: 'd2-reqs' }, h('div', { class: 'd2-plan-head' }, h('h2', null, `مراحل ${A.crewOf(crew)?.name || 'فرقتك'}`),
      h('a', { href: '#/reports', class: 'link small' }, 'تقاريري')),
      mine.length ? h('ul', { class: 'rq-list' }, mine.map(({ p, c, s }) => {
        const pend = pendingFor(p, c.key);
        return h('li', null, h('a', { href: '#/project/' + p.id, class: 'rq-row' },
          h('span', { class: 'rq-ic', 'aria-hidden': 'true' }, s.status === 'in_progress' ? '▶' : '○'),
          h('span', { class: 'rq-main' }, h('b', null, p.client), h('small', null, `${num(c.position)}. ${c.name_ar} · ${A.STAGE_AR[s.status]}`)),
          h('span', { class: 'rq-who' }, pend ? 'بانتظار الموافقة' : s.status === 'in_progress' ? 'أبلغ عند الإكمال' : 'أبلغ عند البدء'),
          h('span', { class: 'rq-go', 'aria-hidden': 'true' }, '←')));
      })) : h('p', { class: 'calm muted' }, 'لا توجد مرحلة حالية مسندة لفرقتك الآن.'));
  }


  /* ---------- صفحة سجل التقارير: كل تقارير الفنيين مع الصور والتصفية ---------- */
  const STATUS_AR = { pending: 'بانتظار الموافقة', approved: 'موافَق عليه', rejected: 'مرفوض' };
  const PERIODS = [['7', 'آخر 7 أيام'], ['30', 'آخر 30 يوماً'], ['90', 'آخر 3 أشهر'], ['all', 'كل الفترات']];
  const RF = { st: '', project: '', crew: '', who: '', period: '30', limit: 40 };

  A.views.reports = {
    title: 'سجل التقارير',
    async render() {
      const staff = A.isStaff();
      const fromIso = RF.period === 'all' ? null : new Date(Date.now() - Number(RF.period) * 86400000).toISOString();
      const [rows, people] = await Promise.all([
        A.fetchAll((a, b) => {
          let q = S.sb.from('stage_requests').select('*').order('requested_at', { ascending: false }).range(a, b);
          if (fromIso) q = q.gte('requested_at', fromIso);
          if (!staff) q = q.eq('requested_by', S.user.id);   // الفني يرى تقاريره فقط
          return q;
        }),
        S.sb.from('profiles').select('id, full_name, crew_id')]);
      const prof = Object.fromEntries((people.data || []).map((x) => [x.id, x]));
      // فرقة التقرير = فرقة المرسل (وإن لم تكن، منفّذ المرحلة الحالي)
      const crewOfReq = (r) => prof[r.requested_by]?.crew_id || A.stageOf({ id: r.project_id }, r.checkpoint).crew_id || null;
      const projectOf = (id) => S.projects.find((p) => p.id === id);

      const match = (r, skip) => (skip === 'st' || !RF.st || r.status === RF.st)
        && (!RF.project || r.project_id === RF.project)
        && (!RF.crew || crewOfReq(r) === RF.crew)
        && (!RF.who || r.requested_by === RF.who);
      const list = rows.filter((r) => match(r));
      const cnt = (st) => rows.filter((r) => match(r, 'st') && (!st || r.status === st)).length;

      const redraw = () => A.render();
      const sel = (key, label, opts) => h('select', { class: RF[key] ? 'on' : '', 'aria-label': label, onChange: (e) => { RF[key] = e.target.value; RF.limit = 40; redraw(); } },
        h('option', { value: '' }, label), opts.map(([v, l]) => h('option', { value: v, selected: RF[key] === v }, l)));
      const usedProjects = [...new Set(rows.map((r) => r.project_id))].map(projectOf).filter(Boolean);
      const usedPeople = [...new Set(rows.map((r) => r.requested_by).filter(Boolean))];
      const usedCrews = [...new Set(rows.map(crewOfReq).filter(Boolean))];
      const filters = h('div', { class: 'pl-filters' },
        h('select', { class: RF.period !== '30' ? 'on' : '', 'aria-label': 'الفترة', onChange: (e) => { RF.period = e.target.value; RF.limit = 40; redraw(); } },
          PERIODS.map(([v, l]) => h('option', { value: v, selected: RF.period === v }, l))),
        sel('project', 'كل المشاريع', usedProjects.map((p) => [p.id, p.client])),
        staff ? sel('crew', 'كل الفرق', usedCrews.map((id) => [id, A.crewOf(id)?.name || '—'])) : null,
        staff ? sel('who', 'كل الفنيين', usedPeople.map((id) => [id, prof[id]?.full_name || 'مستخدم'])) : null,
        RF.project || RF.crew || RF.who || RF.st || RF.period !== '30'
          ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => { Object.assign(RF, { st: '', project: '', crew: '', who: '', period: '30', limit: 40 }); redraw(); } }, 'مسح التصفية') : null);

      const tabs = h('div', { class: 'rq-tabs', role: 'group', 'aria-label': 'حالة التقرير' },
        [['', 'الكل'], ['pending', 'بانتظار الموافقة'], ['approved', 'موافَق عليها'], ['rejected', 'مرفوضة']].map(([k, l]) =>
          h('button', { type: 'button', class: 'rq-tab' + (RF.st === k ? ' on' : '') + (k === 'pending' && cnt('pending') ? ' warn' : ''), 'aria-pressed': String(RF.st === k),
            onClick: () => { RF.st = k; RF.limit = 40; redraw(); } }, `${l} (${num(cnt(k || null))})`)));

      const card = (r) => {
        const p = projectOf(r.project_id);
        const c = cpOf(r.checkpoint);
        const crew = A.crewOf(crewOfReq(r));
        return h('li', { class: 'rq-card rqc-' + r.status },
          r.photo_path ? photoEl(r.photo_path, 'rq-photo') : h('div', { class: 'rq-nophoto', 'aria-hidden': 'true' }, '📝'),
          h('div', { class: 'rq-body' },
            h('div', { class: 'rq-top' }, h('span', { class: 'chip rq-st-chip ' + r.status }, STATUS_AR[r.status]),
              h('time', { class: 'muted small', dir: 'ltr', datetime: r.requested_at }, dateTime(r.requested_at))),
            h('b', { class: 'rq-title' }, `${ACTION_AR[r.action]}: ${c ? `${num(c.position)}. ${c.name_ar}` : r.checkpoint}`),
            p ? h('a', { href: '#/project/' + p.id, class: 'rq-proj' }, p.client) : h('span', { class: 'muted' }, 'مشروع محذوف'),
            h('small', { class: 'muted' }, [prof[r.requested_by]?.full_name || 'مستخدم', crew?.name].filter(Boolean).join(' · ')),
            r.note ? h('p', { class: 'rq-note-s' }, r.note) : null,
            r.status !== 'pending' ? h('p', { class: 'small muted' }, `${r.status === 'approved' ? 'وافق' : 'رفض'} ${prof[r.reviewed_by]?.full_name || ''} ${r.reviewed_at ? since(r.reviewed_at) : ''}` +
              (r.review_note ? `: ${r.review_note}` : '')) : null,
            r.status === 'pending' && staff ? h('button', { type: 'button', class: 'btn primary sm', onClick: () => reviewDialog(r) }, 'مراجعة') : null,
            r.status === 'pending' && r.requested_by === S.user.id ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => withdraw(r) }, 'سحب التقرير') : null));
      };

      const shown = list.slice(0, RF.limit);
      return h('div', { class: 'stack rq-page' },
        h('div', null, h('h1', null, 'سجل التقارير'),
          h('p', { class: 'muted' }, staff ? 'كل تقارير الفنيين عن بدء المراحل وإكمالها، مع الصور وقرار المراجعة.' : 'تقاريرك عن بدء المراحل وإكمالها، وقرار المشرف على كل تقرير.')),
        h('div', { class: 'pl-tools' }, tabs, filters, h('p', { class: 'pl-count', role: 'status' }, `${num(list.length)} تقرير`)),
        list.length ? h('ul', { class: 'rq-grid' }, shown.map(card))
          : A.empty('لا توجد تقارير', rows.length ? 'لا تقارير بهذه التصفية.' : staff ? 'تظهر هنا تقارير الفنيين عندما يبلّغون عن بدء مرحلة أو إكمالها.' : 'تظهر هنا تقاريرك بعد أن ترسلها من صفحة المشروع.'),
        list.length > shown.length ? h('button', { type: 'button', class: 'btn', onClick: () => { RF.limit += 40; redraw(); } }, `عرض المزيد (${num(list.length - shown.length)} باقٍ)`) : null);
    }
  };

  window.Reports = { nowCardPart, stepBadge, stageHistory, homeBox, reviewDialog, pendingFor, canReport, shrink, photoEl, since, BUCKET };
})();
