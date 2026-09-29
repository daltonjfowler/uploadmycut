// uploadmycut.com. Every request comes through here first (`run_worker_first`), like
// uploadmymodel's src/worker.js:
//   1. http → https (301), and www.uploadmycut.com → uploadmycut.com.
//   2. /api/* is answered here. Everything else is the built student page in public/.
//   3. Every response gets the security headers below; HTML also gets the CSP.
//
// All cutting maths runs in the student's browser, so the server has little to do: it hands out
// the teacher's class setup (bit, materials, speeds, which jobs are allowed). The setup lives in
// this app's own KV namespace under "class". GET /api/class is public; /api/teacher/* needs the
// TEACHER_KEY secret. No secret set = no teacher access.

import { DEFAULT_CLASS_CONFIG, validateClassConfig } from '../shared/settings.js';

const KV_CLASS = 'class';
const MAX_TEACHER_BYTES = 8 * 1024;
const TEACHER_REJECT_DELAY_MS = 300;

const CANONICAL_HOST = 'uploadmycut.com';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const COMMON_HEADERS = [
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['x-content-type-options', 'nosniff'],
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  // serial=(self): kept for the USB test page (PLAN.md phase 2); nothing else gets it.
  ['permissions-policy', 'serial=(self), usb=(), camera=(), microphone=(), geolocation=(), payment=()'],
  ['cross-origin-opener-policy', 'same-origin'],
  ['x-robots-tag', 'noindex, nofollow'],
];

function isLocal(host) {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';
}

// Asset responses have immutable headers, so copy into a new Response first.
function withSecurityHeaders(response) {
  const copy = new Response(response.body, response);
  for (const [name, value] of COMMON_HEADERS) copy.headers.set(name, value);
  const type = (copy.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (type === 'text/html') copy.headers.set('content-security-policy', CONTENT_SECURITY_POLICY);
  return copy;
}

// Where to send this request instead, or null to answer it. The port is dropped: Cloudflare's
// alternate http ports do not speak https.
function redirectTarget(requestUrl) {
  const url = new URL(requestUrl);
  const host = url.hostname.toLowerCase();
  const isWww = host === 'www.' + CANONICAL_HOST;
  if (!isWww && (url.protocol !== 'http:' || isLocal(host))) return null;
  url.protocol = 'https:';
  if (isWww) url.hostname = CANONICAL_HOST;
  url.port = '';
  return url.toString();
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const encoder = new TextEncoder();

// Secret comparison that leaks nothing through timing: both sides hashed to 32 bytes, then
// Cloudflare's timingSafeEqual (same as uploadmymodel).
/** True when `given` equals any of `keys`. Every key is compared, so the time does not say which one. */
async function anyKeyEquals(given, keys) {
  const hits = await Promise.all(keys.map((k) => constantTimeEquals(given, k)));
  return hits.some(Boolean);
}

async function constantTimeEquals(a, b) {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}

// The saved class setup, or the defaults if none is saved (or it no longer passes the checks).
export async function readClassConfig(env) {
  try {
    const saved = await env.CLASS_KV?.get(KV_CLASS, 'json');
    if (saved) {
      const v = validateClassConfig(saved);
      if (v.ok) return v.config;
      console.error(JSON.stringify({ message: 'saved class setup no longer valid; using defaults', errors: v.errors }));
    }
  } catch (e) {
    console.error(JSON.stringify({ message: 'class setup read failed', error: String(e) }));
  }
  return DEFAULT_CLASS_CONFIG;
}

// A wrong key waits a moment (slows guessing). No secret uploaded means no teacher endpoint at
// all: never fall open. No lockout: a school shares one IP, and a lockout would let one student
// lock out the teacher.
async function teacherOk(request, env) {
  // TEACHER_KEY_2: an optional second teacher (a student teacher); delete that secret to remove them.
  const keys = [env.TEACHER_KEY, env.TEACHER_KEY_2].filter(Boolean);
  if (!keys.length) {
    console.error(JSON.stringify({ message: 'TEACHER_KEY is not set; teacher endpoint refused' }));
  } else if (await anyKeyEquals(request.headers.get('x-teacher-key') ?? '', keys)) {
    return true;
  }
  await new Promise((r) => setTimeout(r, TEACHER_REJECT_DELAY_MS));
  return false;
}

async function handleTeacher(request, env, url) {
  if (!(await teacherOk(request, env))) return json(401, { error: 'key', message: 'Wrong teacher key.' });
  if (url.pathname !== '/api/teacher/class') return json(404, { error: 'not_found', message: 'No such API.' });
  if (request.method === 'GET') return json(200, await readClassConfig(env));
  if (request.method === 'DELETE') {
    await env.CLASS_KV?.delete(KV_CLASS);
    return json(200, DEFAULT_CLASS_CONFIG);
  }
  if (request.method !== 'PUT') return json(405, { error: 'method', message: 'Use GET, PUT or DELETE.' });
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_TEACHER_BYTES) return json(413, { error: 'size', message: 'That is too much to save.' });
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json(400, { error: 'json', message: 'The page sent something the server could not read.' });
  }
  const v = validateClassConfig(body);
  if (!v.ok) return json(400, { error: 'invalid', message: 'Some of those values are not allowed.', details: v.errors });
  if (!env.CLASS_KV) return json(503, { error: 'storage', message: 'Storage is not set up on this server.' });
  await env.CLASS_KV.put(KV_CLASS, JSON.stringify(v.config));
  return json(200, v.config);
}

async function handleApi(request, env, url) {
  if (url.pathname === '/api/health') return json(200, { ok: true });
  if (url.pathname === '/api/class') {
    if (request.method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
    return json(200, await readClassConfig(env));
  }
  // Everything under /api/teacher/ needs the key, even paths that do not exist.
  if (url.pathname.startsWith('/api/teacher/')) return handleTeacher(request, env, url);
  return json(404, { error: 'not_found', message: 'No such API.' });
}

export default {
  async fetch(request, env) {
    const target = redirectTarget(request.url);
    if (target !== null) {
      return withSecurityHeaders(new Response(null, { status: 301, headers: { location: target } }));
    }
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return withSecurityHeaders(await handleApi(request, env, url));
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
