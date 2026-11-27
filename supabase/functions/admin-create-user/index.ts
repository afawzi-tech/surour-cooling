// إنشاء مستخدم من داخل التطبيق - للمدير فقط.
// مفتاح service_role متوفر هنا تلقائياً من بيئة Supabase، ولا يصل للواجهة أبداً.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ALLOWED_ORIGINS = ['https://afawzi-tech.github.io'];
const ROLES = ['admin', 'supervisor', 'technician'];

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json' };
  const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  // أي خطأ غير متوقع يرجع برسالة عامة ومع ترويسات CORS (حتى لا يظهر للمتصفح كخطأ شبكة)
  try { return await handle(req, out); } catch (e) {
    console.error('admin-create-user', e instanceof Error ? e.message : e);
    return out(500, { error: 'حدث خطأ غير متوقع، حاول مرة أخرى' });
  }
});

async function handle(req: Request, out: (status: number, body: unknown) => Response): Promise<Response> {
  if (req.method !== 'POST') return out(405, { error: 'طريقة غير مسموحة' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // 1) من يطلب؟ يجب أن يكون مديراً مفعّلاً
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return out(401, { error: 'سجّل الدخول أولاً' });
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return out(401, { error: 'انتهت الجلسة، سجّل الدخول مرة أخرى' });
  const { data: me } = await admin.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle();
  if (!me || !me.active || me.role !== 'admin') return out(403, { error: 'إضافة المستخدمين للمدير فقط' });

  // 2) التحقق من المدخلات
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return out(400, { error: 'طلب غير صالح' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return out(400, { error: 'طلب غير صالح' });
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const fullName = String(body.full_name || '').trim().slice(0, 120);
  const role = String(body.role || 'technician');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) return out(400, { error: 'البريد الإلكتروني غير صحيح' });
  if (password.length < 8 || password.length > 72 || !/[0-9]/.test(password) || !/[^0-9]/.test(password)) {
    return out(400, { error: 'كلمة المرور 8 أحرف على الأقل، وفيها أرقام وحروف' });
  }
  if (!fullName) return out(400, { error: 'اكتب اسم المستخدم' });
  if (!ROLES.includes(role)) return out(400, { error: 'دور غير معروف' });

  // 3) إنشاء الحساب مؤكَّداً، ثم ضبط الاسم والدور
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName }
  });
  if (cErr || !created?.user) {
    const m = String(cErr?.message || '');
    if (/already|registered|exists/i.test(m)) return out(409, { error: 'هذا البريد مسجّل مسبقاً' });
    if (/password/i.test(m)) return out(400, { error: 'كلمة المرور ضعيفة، اختر أقوى' });
    return out(500, { error: 'تعذّر إنشاء الحساب' });
  }
  const id = created.user.id;
  const { data: prof, error: pErr } = await admin.from('profiles')
    .upsert({ id, full_name: fullName, role, active: true }, { onConflict: 'id' }).select().single();
  if (pErr) {
    // لا نترك حساباً بلا دور صحيح: نحذفه ونطلب الإعادة
    await admin.auth.admin.deleteUser(id).catch(() => {});
    return out(500, { error: 'تعذّر إنشاء الحساب، حاول مرة أخرى' });
  }

  // 4) سجل العمليات باسم المدير الذي أضاف (بدون كلمة المرور)
  const { error: aErr } = await admin.from('audit_log').insert({ actor: who.user.id, table_name: 'profiles', row_id: id, action: 'INSERT',
    new_data: { email, full_name: fullName, role, created_from: 'app' } });
  if (aErr) console.error('audit insert failed', aErr.message);

  return out(200, { profile: prof });
}
