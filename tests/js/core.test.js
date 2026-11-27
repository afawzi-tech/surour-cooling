// اختبارات النواة (js/core.js): معادلات ملف VRF QC Tracker والمواعيد والتقدّم.
// التشغيل: node --test tests/js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../js/core.js');
const { F } = C;

const KEYS = ['site_ready', 'equipment_set', 'piping', 'pressure_test', 'vacuum', 'insulation', 'drain_test',
  'megger', 'addressing', 'charging', 'commissioning', 'punch_closed', 'handover'];
const CPS = KEYS.map((key) => ({ key }));
const unit = (results = {}) => ({ id: 'u1', results });
const passUpTo = (n) => Object.fromEntries(KEYS.slice(0, n).map((k) => [k, 'pass']));

test('Villa Tracker: وحدة لم تبدأ', () => {
  const r = F.row(unit(), CPS, 0);
  assert.equal(r.Q, 0); assert.equal(r.R, 0); assert.equal(r.S, 0);
  assert.equal(r.U, 'Not started');
  assert.equal(r.V.key, 'site_ready');
  assert.equal(r.W, false);
});

test('Villa Tracker: جارية، والخطوة التالية أول خانة غير ناجحة', () => {
  const r = F.row(unit(passUpTo(3)), CPS, 0);
  assert.equal(r.Q, 3); assert.equal(r.U, 'In progress');
  assert.equal(r.V.key, 'pressure_test');
  assert.equal(r.S, 3 / 13);
});

test('Villa Tracker: الفشل يغلب، والخطوة التالية هي الخانة الفاشلة إن سبقت', () => {
  const r = F.row(unit({ ...passUpTo(3), pressure_test: 'fail' }), CPS, 2);
  assert.equal(r.R, 1); assert.equal(r.U, 'Has failure'); assert.equal(r.T, 2);
  assert.equal(r.V.key, 'pressure_test');
});

test('Villa Tracker: مكتملة مع N/A، والنسبة تستثني N/A', () => {
  const res = passUpTo(13); res.drain_test = 'na'; res.addressing = 'na';
  const r = F.row(unit(res), CPS, 0);
  assert.equal(r.Q, 11); assert.equal(r.NA, 2);
  assert.equal(r.S, 1); assert.equal(r.U, 'Complete'); assert.equal(r.V, '-');
});

test('Villa Tracker: كل الخانات N/A لا تقسم على صفر', () => {
  const r = F.row(unit(Object.fromEntries(KEYS.map((k) => [k, 'na']))), CPS, 0);
  assert.equal(r.S, 0); assert.equal(r.U, 'Complete');
});

test('SEQUENCE ALERT كما في معادلة الملف', () => {
  assert.equal(F.row(unit({ insulation: 'pass', pressure_test: 'pass' }), CPS, 0).W, true, 'عزل قبل الفاكيوم');
  assert.equal(F.row(unit({ insulation: 'pass', pressure_test: 'pass', vacuum: 'pass' }), CPS, 0).W, false);
  assert.equal(F.row(unit({ charging: 'pass', pressure_test: 'pass', vacuum: 'pass' }), CPS, 0).W, true, 'شحن قبل الميغر');
  assert.equal(F.row(unit({ charging: 'pass', pressure_test: 'pass', vacuum: 'pass', megger: 'pass' }), CPS, 0).W, false);
  assert.equal(F.row(unit({ commissioning: 'pass' }), CPS, 0).W, true, 'تشغيل قبل الشحن');
});

const LIM = { lim_pressure_drop: 0.02, lim_vacuum_max: 500, lim_vacuum_hold: 60, lim_charge_tol: 0.05 };

test('Test Records: هبوط الضغط والحدّ (أقل من أو يساوي = OK)', () => {
  assert.deepEqual([F.test({ start_mpa: 4.15, end_mpa: 4.13 }, LIM).H, F.test({ start_mpa: 4.15, end_mpa: 4.13 }, LIM).I], [0.02, 'OK']);
  assert.equal(F.test({ start_mpa: 4.15, end_mpa: 4.12 }, LIM).I, 'CHECK');
  assert.equal(F.test({ start_mpa: 4.15 }, LIM).H, '');
  assert.equal(F.test({ start_mpa: 4.15 }, LIM).I, '');
});

test('Test Records: الفاكيوم (المايكرون والمدة والارتفاع 50 ثابت)', () => {
  assert.equal(F.test({ vacuum_microns: 500, vacuum_hold_min: 60, vacuum_rise: 50 }, LIM).N, 'OK');
  assert.equal(F.test({ vacuum_microns: 501, vacuum_hold_min: 60, vacuum_rise: 0 }, LIM).N, 'CHECK');
  assert.equal(F.test({ vacuum_microns: 400, vacuum_hold_min: 59, vacuum_rise: 0 }, LIM).N, 'CHECK');
  assert.equal(F.test({ vacuum_microns: 400, vacuum_hold_min: 60, vacuum_rise: 51 }, LIM).N, 'CHECK');
  assert.equal(F.test({ vacuum_microns: 400 }, LIM).N, 'CHECK', 'المدة الفارغة = صفر كما في Excel');
  assert.equal(F.test({}, LIM).N, '');
});

test('Test Records: الشحن والنسبة المطلقة', () => {
  const a = F.test({ charge_calc_kg: 10, charge_actual_kg: 10.5 }, LIM);
  assert.equal(a.Q, 0.5); assert.equal(a.R, 0.05); assert.equal(a.S, 'OK');
  assert.equal(F.test({ charge_calc_kg: 10, charge_actual_kg: 9.4 }, LIM).S, 'CHECK');
  const z = F.test({ charge_calc_kg: 0, charge_actual_kg: 1 }, LIM);
  assert.equal(z.R, ''); assert.equal(z.S, '', 'IFERROR عند القسمة على صفر');
});

test('Dashboard: الأعداد ونسبة الإنجاز الكلية', () => {
  const units = [
    { id: 'a', results: passUpTo(13) },
    { id: 'b', results: passUpTo(2) },
    { id: 'c', results: {} },
    { id: 'd', results: { site_ready: 'fail' } },
    { id: 'e', results: { site_ready: 'pass', commissioning: 'pass' } }
  ];
  const d = { units, ncrs: [{ unit_id: 'd', status: 'open' }, { unit_id: 'a', status: 'closed' }] };
  const D = F.dashboard(d, CPS);
  assert.equal(D.B3, 5); assert.equal(D.B4, 1); assert.equal(D.B5, 2); assert.equal(D.B6, 1); assert.equal(D.B7, 1);
  assert.equal(D.B8, 1); assert.equal(D.B9, 1);
  assert.equal(D.B10, (13 + 2 + 0 + 0 + 2) / (5 * 13));
  assert.equal(D.per[0].Pass, 3); assert.equal(D.per[0].Fail, 1);
});

test('تقدّم مراحل المشروع', () => {
  const st = { site_ready: { status: 'done' }, equipment_set: { status: 'in_progress', updated_at: '2026-11-02' }, drain_test: { status: 'na' } };
  const p = C.progress(CPS, (k) => st[k] || { status: 'not_started' });
  assert.equal(p.total, 12); assert.equal(p.done, 1); assert.equal(p.pct, 1 / 12);
  assert.equal(p.status, 'in_progress'); assert.equal(p.cur.c.key, 'equipment_set'); assert.equal(p.last, '2026-11-02');
  const all = C.progress(CPS, () => ({ status: 'done' }));
  assert.equal(all.status, 'done'); assert.equal(all.cur, null);
  assert.equal(C.progress(CPS, () => ({ status: 'not_started' })).status, 'not_started');
});

test('المواعيد: متأخر، ومتأخر عن الجدول بفارق 15 نقطة', () => {
  const p = { start_date: '2026-11-01', due_date: '2026-12-01' };          // 30 يوماً
  const late = C.schedule(p, 0.5, 'in_progress', '2026-12-05');
  assert.equal(late.late, true); assert.equal(late.daysLeft, -4);
  assert.equal(C.schedule(p, 0.5, 'done', '2026-12-05').late, false, 'المكتمل لا يكون متأخراً');
  const mid = '2026-11-16';                                                   // نصف المدة
  assert.equal(C.schedule(p, 0.35, 'in_progress', mid).behind, true);
  assert.equal(C.schedule(p, 0.36, 'in_progress', mid).behind, false);
  assert.equal(C.schedule({}, 0, 'in_progress', mid).has, false);
});

test('النص العربي: الأعداد والتوحيد', () => {
  assert.equal(C.daysAr(1), 'يوم'); assert.equal(C.daysAr(2), 'يومين'); assert.equal(C.daysAr(3), '3 أيام'); assert.equal(C.daysAr(11), '11 يوماً');
  assert.equal(C.dueText(C.schedule({ due_date: '2026-11-20' }, 0, 'in_progress', '2026-11-23'), 'in_progress'), 'متأخر 3 أيام');
  assert.equal(C.norm('  مؤسسةُ  الإعمار '), C.norm('موسسه الاعمار'));
  assert.equal(C.norm('مستشفى'), 'مستشفي');
});

test('قاعدة كلمة المرور', () => {
  assert.equal(C.strongEnough('abc12345'), true);
  assert.equal(C.strongEnough('abcdefgh'), false);
  assert.equal(C.strongEnough('12345678'), false);
  assert.equal(C.strongEnough('كلمة1234'), false, 'حروف إنجليزية مطلوبة مثل إعداد Supabase');
  assert.equal(C.strongEnough('ab1'), false);
});
