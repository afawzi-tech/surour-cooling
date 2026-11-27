// فحص الكود (يعمل في GitHub Actions مع كل رفع): أسماء غير معرّفة، متغيرات غير مستخدمة، أخطاء شائعة،
// ومنع innerHTML وeval حتى لا يُدخل أحد ثغرة XSS بالخطأ.
const browser = {
  window: 'readonly', document: 'readonly', location: 'readonly', navigator: 'readonly', console: 'readonly',
  localStorage: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', URL: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly', fetch: 'readonly',
  crypto: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', Intl: 'readonly', IntersectionObserver: 'readonly',
  Image: 'readonly', HTMLElement: 'readonly', Node: 'readonly', Event: 'readonly', CustomEvent: 'readonly', getComputedStyle: 'readonly',
  CompressionStream: 'readonly', DecompressionStream: 'readonly', Response: 'readonly', createImageBitmap: 'readonly',
  OffscreenCanvas: 'readonly', alert: 'readonly', confirm: 'readonly', history: 'readonly', matchMedia: 'readonly', self: 'readonly',
  caches: 'readonly', globalThis: 'readonly', module: 'writable', Uint8Array: 'readonly', Uint32Array: 'readonly', DataView: 'readonly',
  performance: 'readonly', DOMParser: 'readonly', XMLSerializer: 'readonly', atob: 'readonly', btoa: 'readonly', Notification: 'readonly'
};
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-redeclare': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error',
  'no-self-assign': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'use-isnan': 'error', 'valid-typeof': 'error',
  'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error',
  'no-restricted-properties': ['error',
    { property: 'innerHTML', message: 'ممنوع: استخدم UI.h أو textContent' },
    { property: 'outerHTML', message: 'ممنوع: استخدم UI.h أو textContent' },
    { property: 'insertAdjacentHTML', message: 'ممنوع: استخدم UI.h' }]
};
export default [
  { ignores: ['vendor/**', 'supabase/functions/**'] },
  { files: ['js/**/*.js', 'sw.js'], languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: browser }, rules },
  { files: ['tests/**/*.{js,mjs}', 'eslint.config.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module',
    globals: { ...browser, process: 'readonly', require: 'readonly', __dirname: 'readonly', Buffer: 'readonly' } }, rules }
];
