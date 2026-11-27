// اختبار دخاني للواجهة: يفتح كل صفحة رئيسية ببيانات وهمية (بلا اتصال بالقاعدة الحقيقية)
// على الكمبيوتر والهاتف، ويفشل إذا ظهر أي خطأ JavaScript أو صفحة فارغة.
// التشغيل: node tests/ui/smoke.mjs   (يحتاج Playwright وChromium)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = new URL('../../', import.meta.url).pathname;
const REF = 'ecfxadnbeuvuuxoocyjn';

// ---- البيانات الوهمية ----
const ids = { admin: '00000000-0000-0000-0000-0000000000a1', tech: '00000000-0000-0000-0000-0000000000c3',
  p1: '10000000-0000-0000-0000-000000000001', p2: '10000000-0000-0000-0000-000000000002', crew: '20000000-0000-0000-0000-000000000001' };
const schema = readFileSync(join(ROOT, 'supabase/schema.sql'), 'utf8');
const cpBlock = schema.slice(schema.indexOf('insert into public.qc_checkpoints'));
const checkpoints = [...cpBlock.matchAll(/\('([a-z_]+)',\s*(\d+),\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\)/g)].slice(0, 13)
  .map(([, key, position, name_ar, name_en, itp_ref]) => ({ key, position: +position, name_ar, name_en, itp_ref }));
if (checkpoints.length !== 13) throw new Error('لم أجد المراحل الـ13 في schema.sql');
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const lim = { lim_pressure_drop: 0.02, lim_vacuum_max: 500, lim_vacuum_hold: 60, lim_charge_tol: 0.05 };
const projects = [
  { id: ids.p1, client: 'بيت الاختبار', project_type: 'houses', unit_label: 'بيت', governorate: 'بغداد', city: 'الكرادة', brand: 'LG',
    customer_name: 'عميل', customer_phone: '07700000000', start_date: day(-20), due_date: day(10), created_at: day(-20), ...lim },
  { id: ids.p2, client: 'مجمّع الاختبار', project_type: 'compound', unit_label: 'فيلا', governorate: 'البصرة', brand: 'Midea',
    start_date: day(-40), due_date: day(-1), created_at: day(-40), ...lim }
];
const stages = [
  { project_id: ids.p1, checkpoint: 'site_ready', status: 'done', start_date: day(-20), end_date: day(-15), crew_id: ids.crew, updated_at: day(-15) },
  { project_id: ids.p1, checkpoint: 'equipment_set', status: 'in_progress', start_date: day(-15), crew_id: ids.crew, updated_at: day(-2) }
];
const units = ['V-001', 'V-002', 'V-003'].map((code, i) => ({ id: `30000000-0000-0000-0000-00000000000${i}`, project_id: ids.p2, code, zone: 'A',
  crew_id: ids.crew, position: i, created_at: day(-30),
  results: i === 0 ? Object.fromEntries(checkpoints.map((c) => [c.key, 'pass'])) : i === 1 ? { site_ready: 'pass', pressure_test: 'fail' } : {} }));
const tests = [{ unit_id: units[1].id, start_mpa: 4.15, end_mpa: 4.1, vacuum_microns: 400, vacuum_hold_min: 60, vacuum_rise: 10,
  pressure_by: ids.tech, pressure_at: day(-3), units: { project_id: ids.p2 } }];
const ncrs = [{ id: '40000000-0000-0000-0000-000000000001', project_id: ids.p2, unit_id: units[1].id, ncr_no: 'NCR-001', checkpoint: 'pressure_test',
  status: 'open', date_raised: day(-3), due_date: day(-1), description: 'هبوط ضغط' }];
const people = [
  { id: ids.admin, full_name: 'مدير تجربة', role: 'admin', active: true, crew_id: null, created_at: day(-100) },
  { id: ids.tech, full_name: 'فني تجربة', role: 'technician', active: true, crew_id: ids.crew, created_at: day(-50) }];
const TABLES = {
  projects, qc_checkpoints: checkpoints, project_stages: stages, unit_overview: units, units, test_records: tests, ncrs,
  crews: [{ id: ids.crew, name: 'فرقة أحمد', kind: 'internal', active: true, governorates: ['بغداد'], created_at: day(-60) }],
  crew_unit_stats: [{ crew_id: ids.crew, project_id: ids.p2, units: 3, done: 1, in_progress: 0, failing: 1 }],
  stage_requests: [{ id: '50000000-0000-0000-0000-000000000001', project_id: ids.p1, checkpoint: 'equipment_set', action: 'start', status: 'pending',
    requested_by: ids.tech, requested_at: day(-1) }],
  unit_checks: [], audit_log: [{ id: 1, at: day(-1), actor: ids.admin, table_name: 'projects', action: 'UPDATE', new_data: { client: 'بيت الاختبار' } }],
  backups: [{ id: 1, taken_at: day(0), kind: 'auto', counts: { projects: 2 }, size_bytes: 20480 }],
  project_tasks: [{ id: '60000000-0000-0000-0000-000000000001', project_id: ids.p1, title: 'جلب مواد', priority: 'urgent', status: 'todo',
    assignee: ids.tech, due_date: day(1), position: 1, created_at: day(-2), updated_at: day(-2) }],
  task_requests: [], comments: [{ id: '70000000-0000-0000-0000-000000000001', project_id: ids.p1, task_id: null, body: 'المواد ناقصة',
    mentions: [ids.admin], author: ids.tech, created_at: day(-1) }],
  notifications: [{ id: '80000000-0000-0000-0000-000000000001', user_id: ids.admin, kind: 'mention', title: 'فني تجربة ذكرك', body: 'المواد ناقصة',
    link: '#/project/' + ids.p1 + '/talk', read_at: null, created_at: day(-1) }],
  push_subscriptions: [], project_files: [{ id: '90000000-0000-0000-0000-000000000001', project_id: ids.p1, path: ids.p1 + '/a.pdf', name: 'العقد.pdf',
    kind: 'contract', size: 1000, staff_only: false, uploaded_by: ids.admin, created_at: day(-3) }]
};
const RPC = {
  tech_performance: people.map((p) => ({ user_id: p.id, full_name: p.full_name, role: p.role, active: true, crew_id: p.crew_id,
    readings: 3, pressure: 1, vacuum: 1, charge: 1, failed: 1, ncrs: 1, ncrs_open: 1, results: 2, reports: 1, reports_approved: 0,
    reports_rejected: 0, team_ncrs: 1, team_ncrs_open: 1, last_at: day(-1) })),
  take_backup: 2, backup_data: { app: 'surour', tables: {} }
};

// ---- خادم الملفات ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  try { res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' }); res.end(await readFile(join(ROOT, path))); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
async function session(page, who) {
  const me = people.find((p) => p.id === ids[who]);
  const user = { id: me.id, email: who + '@x.iq', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} };
  const jwt = `${b64({ alg: 'HS256' })}.${b64({ sub: me.id, role: 'authenticated', exp: 4102444800 })}.x`;
  const tok = { access_token: jwt, refresh_token: 'r', expires_in: 3600, expires_at: 4102444800, token_type: 'bearer', user };
  await page.route(`https://${REF}.supabase.co/**`, (route) => {
    const u = new URL(route.request().url());
    const json = (x) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(x) });
    if (u.pathname.startsWith('/auth/v1/')) return json(u.pathname.endsWith('/user') ? user : tok);
    if (u.pathname.startsWith('/storage/')) return route.fulfill({ status: 404, body: '{}' });
    const name = u.pathname.split('/').pop();
    if (u.pathname.includes('/rpc/')) return json(RPC[name] ?? null);
    // تصفية بسيطة مثل PostgREST: ?عمود=eq.قيمة
    let rows = name === 'profiles' ? people : TABLES[name] ?? [];
    for (const [k, v] of u.searchParams) if (v.startsWith('eq.') && !k.includes('.')) rows = rows.filter((x) => String(x[k]) === v.slice(3));
    const single = (route.request().headers().accept || '').includes('vnd.pgrst.object');
    return json(single ? rows[0] ?? null : rows);
  });
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(tok)]);
}

const ROUTES = ['home', 'projects', 'compounds', 'crews', 'techs', `techs/${ids.tech}`, 'reports', 'users', 'audit', 'backup',
  `project/${ids.p1}`, `project/${ids.p1}/settings`, `project/${ids.p2}`, `project/${ids.p2}/tracker`, `project/${ids.p2}/tests`,
  `project/${ids.p2}/ncr`, `project/${ids.p2}/guide`, `project/${ids.p2}/villa/${units[1].id}`,
  'calendar', 'tasks', 'notifications', `project/${ids.p1}/tasks`, `project/${ids.p1}/talk`, `project/${ids.p1}/files`];

const browser = await chromium.launch();
const problems = [];
try {
  for (const [who, vp] of [['admin', { width: 1280, height: 900 }], ['admin', { width: 390, height: 844 }], ['tech', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport: vp });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await session(page, who);
    await page.goto(base + '#/home');
    try { await page.waitForSelector('#root .side', { state: 'attached', timeout: 10000 }); }
    catch (e) { throw new Error('لم يفتح التطبيق: ' + errs.join(' / ') + ' / ' + (await page.locator('body').innerText()).slice(0, 300)); }
    for (const r of ROUTES) {
      await page.evaluate((h) => { location.hash = h; }, '#/' + r);
      await page.waitForTimeout(250);
      const text = (await page.locator('#root').innerText()).trim();
      const label = `${who} ${vp.width}px #/${r}`;
      if (text.length < 20) problems.push(`${label}: الصفحة فارغة`);
      if (/حدث خطأ غير متوقع/.test(text)) problems.push(`${label}: ظهرت رسالة خطأ`);
      errs.splice(0).forEach((e) => problems.push(`${label}: ${e}`));
    }
    await page.close();
  }
} finally { await browser.close(); server.close(); }

if (problems.length) { console.error('مشاكل في الواجهة:\n- ' + problems.join('\n- ')); process.exit(1); }
console.log(`الاختبار الدخاني نجح: ${ROUTES.length} صفحة × 3 (مدير على الكمبيوتر والهاتف، وفني على الهاتف)`);
