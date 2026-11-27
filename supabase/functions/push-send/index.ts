// إرسال الإشعارات إلى الموبايل (Web Push).
// - GET: يعيد مفتاح VAPID العام ليشترك به المتصفح (يُنشأ زوج المفاتيح مرة واحدة ويُحفظ في app_secrets).
// - POST: تستدعيه قاعدة البيانات (public.notify عبر pg_net) برقم الإشعار ورمز داخلي سري،
//   فيرسل الإشعار لكل أجهزة صاحبه، ويحذف الاشتراكات المنتهية.
// مفتاح service_role متوفر هنا تلقائياً من بيئة Supabase، ولا يصل للواجهة أبداً.
// تُنشر هذه الدالة بدون التحقق من JWT (verify_jwt = false): الحماية برمز x-hook-token.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const ALLOWED_ORIGINS = ['https://afawzi-tech.github.io'];
const SUBJECT = 'https://afawzi-tech.github.io/surour-cooling/';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function secret(key: string): Promise<string | null> {
  const { data } = await admin.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return data?.value || null;
}

async function vapid() {
  let pub = await secret('vapid_public'), priv = await secret('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    // إذا سبقنا طلب آخر، نأخذ مفاتيحه (on conflict do nothing)
    await admin.from('app_secrets').upsert([{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }], { onConflict: 'key', ignoreDuplicates: true });
    pub = await secret('vapid_public'); priv = await secret('vapid_private');
  }
  return { pub: pub!, priv: priv! };
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json'
  };
  const out = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  try {
    if (req.method === 'GET') return out(200, { publicKey: (await vapid()).pub });
    if (req.method !== 'POST') return out(405, { error: 'method' });

    const token = await secret('push_hook_token');
    if (!token || !timingSafeEqual(req.headers.get('x-hook-token') || '', token)) return out(403, { error: 'forbidden' });

    const { id } = await req.json();
    const { data: n } = await admin.from('notifications').select('id, user_id, title, body, link').eq('id', String(id)).maybeSingle();
    if (!n) return out(404, { error: 'not found' });
    const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id);
    if (!subs?.length) return out(200, { sent: 0 });

    const k = await vapid();
    webpush.setVapidDetails(SUBJECT, k.pub, k.priv);
    const payload = JSON.stringify({ title: n.title, body: n.body || '', link: n.link || '#/home', id: n.id });
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: 'high' });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);   // اشتراك منتهٍ
      }
    }));
    return out(200, { sent });
  } catch (e) {
    console.error(e);
    return out(500, { error: 'server' });
  }
});
