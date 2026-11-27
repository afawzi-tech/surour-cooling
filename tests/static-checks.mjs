// فحوصات ثابتة على المستودع قبل النشر (تعمل في GitHub Actions):
// 1) لا مفتاح service_role ولا أي مفتاح سري في الملفات.  2) رقم النسخة ?v= واحد لكل ملفات index.html،
// وكل ملف في js/ مُحمَّل.  3) سياسة CSP موجودة وتمنع السكربتات الخارجية.
import { readFileSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const fail = [];
const files = execSync('git ls-files -z', { encoding: 'utf8' }).split('\0').filter((f) => f && !f.startsWith('vendor/') && !/\.(png|jpe?g|webp|ico|xlsx)$/i.test(f));

// 1) المفاتيح
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const jwt of text.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g) || []) {
    let payload = {};
    try { payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()); } catch { /* ليس JWT */ }
    if (payload.role && payload.role !== 'anon') fail.push(`${f}: مفتاح بدور "${payload.role}" (المسموح anon فقط)`);
  }
  if (/sb_secret_[\w-]{10,}|sbp_[0-9a-f]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) fail.push(`${f}: يبدو أن فيه مفتاحاً سرياً`);
}

// 2) index.html: رقم النسخة وكل ملفات js
const html = readFileSync('index.html', 'utf8');
const versions = new Set([...html.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
if (versions.size !== 1) fail.push(`index.html: أرقام نسخ مختلفة ${[...versions].join(', ')} (حدّثها كلها معاً)`);
for (const js of readdirSync('js').filter((f) => f.endsWith('.js'))) {
  if (!html.includes(`js/${js}?v=`)) fail.push(`index.html: الملف js/${js} غير محمَّل`);
}

// 3) CSP
const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || '';
if (!csp) fail.push('index.html: لا توجد سياسة CSP');
else {
  if (!/script-src 'self'(;|$)/.test(csp)) fail.push("CSP: script-src يجب أن تكون 'self' فقط");
  if (/unsafe-inline|unsafe-eval/.test(csp)) fail.push('CSP: فيها unsafe-inline أو unsafe-eval');
}

if (fail.length) { console.error('فشلت الفحوصات:\n- ' + fail.join('\n- ')); process.exit(1); }
console.log(`الفحوصات الثابتة نجحت (${files.length} ملفاً)`);
