/* ==========================================================
   النواة: الحسابات الصافية بلا واجهة ولا قاعدة بيانات
   (معادلات ملف VRF QC Tracker، تقدّم المراحل، المواعيد، توحيد النص العربي).
   تعمل في المتصفح (window.Core) وفي Node للاختبارات (tests/js).
   أي تعديل هنا يجب أن تمرّ معه اختبارات tests/js/core.test.js.
   ========================================================== */
(function (g) {
  'use strict';

  const num = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString('en-US'));

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
    // المفرد، المعرّف، الجمع، الجمع المعرّف، مؤنث؟، المثنى، التمييز المنصوب (11-99)
    'فيلا': ['فيلا', 'الفيلا', 'فلل', 'الفلل', true, 'فيلتان', 'فيلا'], 'بيت': ['بيت', 'البيت', 'بيوت', 'البيوت', false, 'بيتان', 'بيتاً'],
    'شقة': ['شقة', 'الشقة', 'شقق', 'الشقق', true, 'شقتان', 'شقة'], 'طابق': ['طابق', 'الطابق', 'طوابق', 'الطوابق', false, 'طابقان', 'طابقاً'],
    'مبنى': ['مبنى', 'المبنى', 'مبانٍ', 'المباني', false, 'مبنيان', 'مبنى'], 'منظومة': ['منظومة', 'المنظومة', 'منظومات', 'المنظومات', true, 'منظومتان', 'منظومة'],
    'وحدة': ['وحدة', 'الوحدة', 'وحدات', 'الوحدات', true, 'وحدتان', 'وحدة']
  };
  const unitWords = (p) => { const w = UNIT_WORDS[p?.unit_label] || UNIT_WORDS['وحدة']; return { one: w[0], the: w[1], many: w[2], theMany: w[3], fem: w[4], two: w[5], acc: w[6] }; };
  // عدد الوحدات بصيغة عربية صحيحة: فيلا واحدة، فيلتان، 5 فلل، 60 فيلا، 250 فيلا
  const unitCount = (p, n) => {
    const w = p && p.one ? p : unitWords(p), r = n % 100;   // يقبل المشروع أو كلماته الجاهزة
    if (n === 1) return `${w.one} ${w.fem ? 'واحدة' : 'واحد'}`;
    if (n === 2) return w.two;
    if (n >= 3 && n <= 10) return `${num(n)} ${w.many}`;
    return `${num(n)} ${r >= 11 && r <= 99 ? w.acc : w.one}`;
  };
  // قيم الخانات كما في الملف، مع الاسم العربي للعرض
  const RES = { pass: 'Pass', fail: 'Fail', pending: 'Pending', na: 'N/A' };
  const RES_AR = { pass: 'ناجح', fail: 'فاشل', pending: 'معلّق', na: 'لا ينطبق' };
  const STATUS_AR = { 'Complete': 'مكتملة', 'In progress': 'جارية', 'Not started': 'لم تبدأ', 'Has failure': 'بها فشل' };

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
  // داخل عزل اتجاه (LRI…PDI) حتى لا تنقلب علامة % في الجمل العربية
  const pctText = (x) => '\u2066' + (Math.round((x || 0) * 1000) / 10) + '%\u2069';

  const STAGE_AR = { not_started: 'لم تبدأ', in_progress: 'جارية', done: 'مكتملة', na: 'لا تنطبق' };
  // التقدّم: المكتملة ÷ (13 − لا تنطبق)، والمرحلة الحالية = أول مرحلة غير مكتملة
  // getStage(key) يعيد صف المرحلة أو { status: 'not_started' }
  function progress(checkpoints, getStage) {
    const list = checkpoints.map((c) => ({ c, s: getStage(c.key) }));
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
  // التاريخ المحلي للجهاز (بغداد UTC+3)، لا UTC، حتى لا يصير "اليوم" أمس بعد منتصف الليل
  const todayStr = () => new Date().toLocaleDateString('en-CA');
  // روابط الخرائط المسموحة فقط (نفس شرط الخادم في schema.sql)
  const MAP_URL = /^https:\/\/((www\.)?google\.[a-z.]{2,8}\/maps|maps\.google\.[a-z.]{2,8}|maps\.app\.goo\.gl|goo\.gl\/maps|(www\.|ul\.)?waze\.com|maps\.apple\.com)([/?#][^\s<>"]*)?$/i;
  const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000);
  function schedule(p, pct, status, today) {
    const t = today || todayStr();
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
  const cntAr = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${num(n)} ${few}` : `${num(n)} ${many}`);
  const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();
  // أرقام لوحة المفاتيح العربية ٠-٩ و۰-۹ تُعامل مثل 0-9
  const digits = (t) => String(t || '').replace(/[٠-٩]/g, (c) => c.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (c) => c.charCodeAt(0) - 0x6F0).replace(/[^0-9]/g, '');

  // كلمة المرور: 8 أحرف على الأقل فيها حروف إنجليزية وأرقام (نفس قاعدة إعداد Supabase Auth)
  const strongEnough = (p) => p.length >= 8 && p.length <= 72 && /[0-9]/.test(p) && /[A-Za-z]/.test(p);

  const Core = { ROLES, GOVS, PTYPES, isCompound, BRAND_SUGGEST, UNIT_WORDS, unitWords, unitCount, RES, RES_AR, STATUS_AR, STAGE_AR,
    F, openNcrsOf, pctText, progress, BEHIND_GAP, MAP_URL, todayStr, dayDiff, schedule, daysAr, dueText, cntAr, norm, digits, strongEnough };
  g.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
