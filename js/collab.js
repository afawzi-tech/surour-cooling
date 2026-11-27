/* ==========================================================
   التعليقات والإشعارات ومرفقات المشروع (أفكار من TaskFlow)
   - التعليقات: على المشروع (تبويب "النقاش") وعلى كل مهمة، مع إشارة @ لشخص.
   - الإشعارات: تُنشأ على الخادم (تقارير، مراجعات، إسناد مهام، إشارات)، وتظهر في الجرس،
     وتصل للموبايل عبر Web Push بعد أن يفعّلها المستخدم على جهازه.
   - المرفقات: العقد والمخططات والصور، في مخزن خاص. "للإدارة فقط" تُخفى عن الفني على الخادم.
   ========================================================== */
(() => {
  'use strict';

  const { h, toast, num, dateTime } = window.UI;
  const A = window.App;
  const S = A.state;
  const cfg = window.SUROUR_CONFIG || {};
  const R = () => window.Reports;
  const since = (t) => (R() ? R().since(t) : dateTime(t));
  const nameOf = (id) => S.staffList?.find((x) => x.id === id)?.full_name || S.people?.[id] || 'مستخدم';
  const people = () => (S.staffList?.length ? S.staffList : Object.entries(S.people || {}).map(([id, full_name]) => ({ id, full_name, active: true })))
    .filter((x) => x.active && x.full_name).sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar'));

  /* ================= الإشعارات ================= */
  S.notes = []; S.notesReady = false;
  let timer = null;
  async function loadNotes() {
    if (!S.user) return;
    const r = await S.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    if (r.error) { S.notesReady = false; return; }
    const before = unread();
    S.notes = r.data; S.notesReady = true;
    paintBadges();
    if (unread() > before && before >= 0 && document.visibilityState === 'visible' && S._notesPrimed) toast('🔔 ' + (S.notes[0]?.title || 'إشعار جديد'));
    S._notesPrimed = true;
  }
  const unread = () => S.notes.filter((n) => !n.read_at).length;
  function paintBadges() {
    document.querySelectorAll('.nt-badge').forEach((b) => { const n = unread(); b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n; });
  }
  function startPolling() {
    if (timer) return;
    loadNotes();
    timer = setInterval(() => { if (document.visibilityState === 'visible') loadNotes(); }, 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadNotes(); });
  }
  // زر الجرس (في القائمة الجانبية وأعلى الهاتف)
  function bell(cls) {
    if (S.user && !timer) setTimeout(startPolling, 0);
    const n = unread();
    return h('a', { href: '#/notifications', class: cls, 'aria-label': 'الإشعارات' + (n ? ` (${n} غير مقروءة)` : '') },
      bellIcon(), cls === 'side-bell' ? h('span', null, 'الإشعارات') : null,
      h('b', { class: 'nt-badge', hidden: !n }, String(n)));
  }
  function bellIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
    ['M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9', 'M10 21a2 2 0 0 0 4 0'].forEach((d) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.appendChild(p); });
    return svg;
  }

  async function markRead(ids) {
    if (!ids.length) return;
    const at = new Date().toISOString();
    const r = await S.sb.from('notifications').update({ read_at: at }).in('id', ids);
    if (r.error) return A.fail(r.error);
    S.notes.forEach((n) => { if (ids.includes(n.id)) n.read_at = at; });
    paintBadges();
  }

  /* ---------- الإشعارات على الموبايل (Web Push) ---------- */
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && window.isSecureContext;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  async function pushState() {
    if (!pushSupported()) return isIOS() && !standalone() ? 'ios-install' : 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  }
  async function enablePush() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('لم يُسمح بالإشعارات. فعّلها من إعدادات المتصفح', 'error'); return; }
      const res = await fetch(cfg.supabaseUrl + '/functions/v1/push-send', { headers: { apikey: cfg.supabaseAnonKey } });
      const { publicKey } = await res.json();
      if (!publicKey) throw new Error('خدمة الإشعارات غير جاهزة بعد');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      const j = sub.toJSON();
      const r = await S.sb.from('push_subscriptions').upsert({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh || toB64(sub.getKey('p256dh')), auth: j.keys?.auth || toB64(sub.getKey('auth')),
        device: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
      if (r.error) throw r.error;
      toast('تفعّلت الإشعارات على هذا الجهاز');
    } catch (e) { A.fail(e); }
    A.render();
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      await S.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await sub.unsubscribe().catch(() => {});
    }
    toast('أُوقفت الإشعارات على هذا الجهاز');
    A.render();
  }
  function pushCard() {
    const box = h('section', { class: 'nt-push' }, h('p', { class: 'muted small' }, 'جارٍ التحقق من الإشعارات على هذا الجهاز…'));
    pushState().then((st) => {
      const T = {
        on: ['🔔 الإشعارات مفعّلة على هذا الجهاز', 'تصلك حتى لو كان التطبيق مسدوداً.', h('button', { type: 'button', class: 'btn ghost sm', onClick: disablePush }, 'إيقاف على هذا الجهاز')],
        off: ['فعّل الإشعارات على هذا الجهاز', 'حتى توصلك التقارير والمهام والإشارات على الموبايل، حتى لو التطبيق مسدود.', h('button', { type: 'button', class: 'btn primary', onClick: enablePush }, 'تفعيل الإشعارات')],
        denied: ['الإشعارات ممنوعة في هذا المتصفح', 'اسمح بها من إعدادات المتصفح للموقع، ثم ارجع هنا.', null],
        'ios-install': ['على الآيفون: ثبّت التطبيق أولاً', 'من Safari اضغط زر المشاركة ثم "إضافة إلى الشاشة الرئيسية"، وافتح التطبيق من الأيقونة وفعّل الإشعارات من هنا.', null],
        unsupported: ['هذا المتصفح لا يدعم الإشعارات', 'جرّب Chrome على أندرويد أو التطبيق المثبّت على الآيفون.', null]
      }[st];
      box.className = 'nt-push st-' + st;
      box.replaceChildren(...[h('div', null, h('b', null, T[0]), h('p', { class: 'muted small' }, T[1])), T[2]].filter(Boolean));
    });
    return box;
  }

  A.views.notifications = {
    title: 'الإشعارات',
    async render() {
      await loadNotes();
      if (!S.notesReady) return A.empty('الإشعارات غير مفعّلة بعد', 'تحتاج تطبيق تحديث قاعدة البيانات.');
      const list = S.notes;
      const ICON = { stage_request: '📋', task_request: '📋', stage_review: '✅', task_review: '✅', task_assigned: '📌', mention: '💬', task_comment: '💬' };
      const page = h('div', { class: 'nt-page' },
        h('div', { class: 'tk-head' }, h('h1', null, 'الإشعارات'),
          unread() ? h('button', { type: 'button', class: 'btn ghost sm', onClick: async () => { await markRead(S.notes.filter((n) => !n.read_at).map((n) => n.id)); A.render(); } }, 'تعليم الكل كمقروء') : null),
        pushCard(),
        list.length ? h('ul', { class: 'nt-list' }, list.map((n) => h('li', { class: n.read_at ? 'read' : 'new' },
          h('a', { href: n.link || '#/home', onClick: () => { if (!n.read_at) markRead([n.id]); } },
            h('span', { class: 'nt-ico', 'aria-hidden': 'true' }, ICON[n.kind] || '🔔'),
            h('span', { class: 'nt-main' }, h('b', null, n.title), n.body ? h('span', null, n.body) : null),
            h('small', { class: 'nt-when' }, since(n.created_at))))))
          : A.empty('لا إشعارات بعد', 'تصلك هنا التقارير والمهام والإشارات.'));
      return page;
    }
  };

  /* ================= التعليقات ================= */
  const cache = new Map();   // مفتاح: project أو task
  async function loadComments(projectId, taskId) {
    let q = S.sb.from('comments').select('*').eq('project_id', projectId).order('created_at');
    q = taskId ? q.eq('task_id', taskId) : q.is('task_id', null);
    const r = await q;
    if (r.error) return null;
    cache.set(taskId || projectId, r.data);
    return r.data;
  }

  // نص التعليق مع إبراز @الاسم (بلا innerHTML)
  function bodyEl(c) {
    const names = (c.mentions || []).map((id) => '@' + nameOf(id)).filter((x) => x.length > 1).sort((a, b) => b.length - a.length);
    const p = h('p', { class: 'cm-body' });
    let rest = c.body;
    while (rest) {
      let at = -1, hit = '';
      names.forEach((n) => { const i = rest.indexOf(n); if (i >= 0 && (at < 0 || i < at)) { at = i; hit = n; } });
      if (at < 0) { p.append(rest); break; }
      p.append(rest.slice(0, at), h('mark', { class: 'cm-at' }, hit));
      rest = rest.slice(at + hit.length);
    }
    return p;
  }

  function thread(projectId, taskId = null) {
    const box = h('div', { class: 'cm-thread' }, h('p', { class: 'muted small' }, 'جارٍ تحميل التعليقات…'));
    const draw = (list) => {
      if (!list) { box.replaceChildren(h('p', { class: 'muted small' }, 'التعليقات غير مفعّلة بعد على قاعدة البيانات.')); return; }
      const ta = h('textarea', { rows: 2, maxlength: 2000, placeholder: taskId ? 'اكتب تعليقاً على المهمة…' : 'اكتب للفريق… واستخدم @ لتذكر شخصاً', class: 'cm-input' });
      const picked = new Set();
      const pick = h('select', { class: 'cm-pick', 'aria-label': 'إشارة لشخص' }, h('option', { value: '' }, '@ إشارة لشخص'),
        people().filter((x) => x.id !== S.user.id).map((x) => h('option', { value: x.id }, x.full_name)));
      pick.addEventListener('change', () => {
        const id = pick.value; pick.value = '';
        if (!id) return;
        picked.add(id);
        const tag = '@' + nameOf(id) + ' ';
        const i = ta.selectionStart ?? ta.value.length;
        ta.value = ta.value.slice(0, i) + (i && !/\s$/.test(ta.value.slice(0, i)) ? ' ' : '') + tag + ta.value.slice(i);
        ta.focus();
      });
      // كتابة @ في أول الكلمة تفتح قائمة الأشخاص
      ta.addEventListener('input', (e) => { if (e.data === '@' && /(^|\s)@$/.test(ta.value.slice(0, ta.selectionStart))) { ta.value = ta.value.slice(0, ta.selectionStart - 1) + ta.value.slice(ta.selectionStart); pick.focus(); pick.showPicker?.(); } });
      const send = h('button', { type: 'button', class: 'btn primary sm' }, 'إرسال');
      send.addEventListener('click', async () => {
        const body = ta.value.trim();
        if (!body) return ta.focus();
        const mentions = [...picked].filter((id) => body.includes('@' + nameOf(id)));
        send.disabled = true;
        const r = await S.sb.from('comments').insert({ project_id: projectId, task_id: taskId, body, mentions }).select().single();
        send.disabled = false;
        if (r.error) return A.fail(r.error);
        list.push(r.data);
        draw(list);
        if (mentions.length) toast(`وصل إشعار لـ ${mentions.map(nameOf).join('، ')}`);
      });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send.click(); });
      box.replaceChildren(
        list.length ? h('ol', { class: 'cm-list' }, list.map((c) => h('li', { class: c.author === S.user.id ? 'me' : '' },
          h('div', { class: 'cm-meta' }, h('b', null, nameOf(c.author)), h('small', { title: dateTime(c.created_at) }, since(c.created_at) + (c.edited_at ? ' · عُدّل' : '')),
            c.author === S.user.id || A.isAdmin() ? h('button', { type: 'button', class: 'link small cm-del', onClick: async () => {
              const ok = await window.UI.confirmBox({ title: 'حذف التعليق؟', body: 'يبقى في سجل العمليات.', okText: 'حذف', danger: true });
              if (!ok) return;
              const d = await S.sb.from('comments').delete().eq('id', c.id).select();
              if (d.error || !d.data.length) return A.fail(d.error || 'permission denied');
              list.splice(list.indexOf(c), 1); draw(list);
              if (taskId) A.render();
            } }, 'حذف') : null),
          bodyEl(c))))
          : h('p', { class: 'muted small cm-empty' }, taskId ? 'لا تعليقات على هذه المهمة.' : 'لا نقاش بعد في هذا المشروع.'),
        h('div', { class: 'cm-form' }, ta, h('div', { class: 'cm-actions' }, pick, send)));
    };
    loadComments(projectId, taskId).then(draw);
    return box;
  }

  function talkPanel(p) {
    return h('div', { class: 'cm-panel' },
      h('p', { class: 'muted small' }, 'نقاش الفريق عن هذا المشروع. اكتب @ أو اختر شخصاً ليصله إشعار.'),
      thread(p.id));
  }

  /* ================= مرفقات المشروع ================= */
  const FKIND = [['contract', 'عقد'], ['drawing', 'مخطط'], ['photo', 'صورة'], ['other', 'أخرى']];
  const FKIND_AR = Object.fromEntries(FKIND);
  const FICON = { contract: '📄', drawing: '📐', photo: '🖼️', other: '📎' };
  const ACCEPT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' };
  const MAX = 20 * 1024 * 1024;
  const BUCKET = 'project-files';
  const size = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' ميغا' : Math.max(1, Math.round(b / 1024)) + ' كيلو');

  async function openFile(f, save) {
    const { data, error } = await S.sb.storage.from(BUCKET).download(f.path);
    if (error || !data) return A.fail(error || 'تعذّر تحميل الملف');
    const url = URL.createObjectURL(data);
    if (save) A.download(data, f.name);
    else window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  function uploadDialog(p, done) {
    const file = h('input', { type: 'file', accept: Object.keys(ACCEPT).join(','), multiple: true });
    const kind = h('select', null, FKIND.map(([k, l]) => h('option', { value: k }, l)));
    const staffOnly = h('input', { type: 'checkbox' });
    A.modal('رفع ملفات', h('div', { class: 'stack sm' },
      A.field('الملفات (PDF، صور، Excel، Word حتى 20 ميغا)', file), A.field('النوع', kind),
      h('label', { class: 'check' }, staffOnly, ' للإدارة فقط (لا يراه الفني)')),
    [{ label: 'رفع', cls: 'primary', run: async () => {
      const files = [...(file.files || [])];
      if (!files.length) { toast('اختر ملفاً', 'error'); return false; }
      for (const f of files) {
        const ext = ACCEPT[f.type];
        if (!ext) { toast(`"${f.name}": نوع غير مسموح`, 'error'); return false; }
        if (f.size > MAX) { toast(`"${f.name}": أكبر من 20 ميغا`, 'error'); return false; }
      }
      let n = 0;
      for (const f of files) {
        const path = `${p.id}/${crypto.randomUUID()}.${ACCEPT[f.type]}`;
        const up = await S.sb.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false });
        if (up.error) { A.fail(up.error); break; }
        const r = await S.sb.from('project_files').insert({ project_id: p.id, path, name: f.name.slice(0, 200), kind: kind.value, mime: f.type, size: f.size, staff_only: staffOnly.checked });
        if (r.error) { await S.sb.storage.from(BUCKET).remove([path]); A.fail(r.error); break; }
        n++;
      }
      if (n) toast(n === 1 ? 'رُفع الملف' : `رُفعت ${num(n)} ملفات`);
      done();
    } }]);
  }

  function filesPanel(p) {
    const box = h('div', { class: 'pf-panel' }, h('p', { class: 'muted small' }, 'جارٍ التحميل…'));
    const staff = A.isStaff();
    const draw = async () => {
      const r = await S.sb.from('project_files').select('*').eq('project_id', p.id).order('created_at', { ascending: false });
      if (r.error) { box.replaceChildren(h('p', { class: 'muted' }, 'المرفقات غير مفعّلة بعد على قاعدة البيانات.')); return; }
      const list = r.data;
      box.replaceChildren(...[
        h('div', { class: 'tk-bar' }, h('p', { class: 'muted small' }, list.length ? `${num(list.length)} ملف` : 'لا ملفات بعد.'),
          staff ? h('button', { type: 'button', class: 'btn primary', onClick: () => uploadDialog(p, draw) }, '+ رفع ملفات') : null),
        list.length ? h('ul', { class: 'pf-list' }, list.map((f) => h('li', null,
          h('button', { type: 'button', class: 'pf-open', onClick: () => openFile(f, false), title: 'فتح' },
            h('span', { class: 'pf-ico', 'aria-hidden': 'true' }, FICON[f.kind]),
            h('span', { class: 'pf-main' }, h('b', { dir: 'auto' }, f.name),
              h('small', null, [FKIND_AR[f.kind], f.size ? size(f.size) : '', nameOf(f.uploaded_by), dateTime(f.created_at).slice(0, 10)].filter(Boolean).join(' · ')))),
          f.staff_only ? h('span', { class: 'chip pf-staff' }, 'للإدارة فقط') : null,
          h('div', { class: 'pf-act' },
            h('button', { type: 'button', class: 'btn ghost sm', onClick: () => openFile(f, true) }, 'تنزيل'),
            staff ? h('button', { type: 'button', class: 'btn ghost sm', onClick: () => editFile(f, draw) }, 'تعديل') : null))))
          : null,
        staff ? h('p', { class: 'd2-note muted small' }, '"للإدارة فقط" يُخفى عن الفني على الخادم، فلا يراه حتى لو عرف رابط الملف.') : null].filter(Boolean));
    };
    draw();
    return box;
  }

  function editFile(f, done) {
    const name = h('input', { maxlength: 200, value: f.name, dir: 'auto' });
    const kind = h('select', null, FKIND.map(([k, l]) => h('option', { value: k, selected: k === f.kind }, l)));
    const so = h('input', { type: 'checkbox', checked: f.staff_only });
    A.modal('تعديل الملف', h('div', { class: 'stack sm' }, A.field('الاسم', name), A.field('النوع', kind),
      h('label', { class: 'check' }, so, ' للإدارة فقط (لا يراه الفني)')),
    [{ label: 'حذف', cls: 'danger', run: async () => {
      const ok = await window.UI.confirmBox({ title: 'حذف الملف؟', body: `"${f.name}" سيُحذف نهائياً.`, okText: 'حذف', danger: true });
      if (!ok) return false;
      const d = await S.sb.from('project_files').delete().eq('id', f.id).select();
      if (d.error || !d.data.length) { A.fail(d.error || 'permission denied'); return false; }
      await S.sb.storage.from(BUCKET).remove([f.path]);
      toast('حُذف الملف'); done();
    } }, { label: 'حفظ', cls: 'primary', run: async () => {
      if (!name.value.trim()) { toast('اكتب الاسم', 'error'); return false; }
      const r = await S.sb.from('project_files').update({ name: name.value.trim(), kind: kind.value, staff_only: so.checked }).eq('id', f.id);
      if (r.error) { A.fail(r.error); return false; }
      toast('حُفظ'); done();
    } }]);
  }

  window.Collab = { bell, loadNotes, thread, talkPanel, filesPanel, pushCard };
})();
