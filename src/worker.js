// uploadmycut.com. Every request comes through here first (`run_worker_first`), like
// uploadmymodel's src/worker.js:
//   1. http → https (301), and www.uploadmycut.com → uploadmycut.com.
//   2. /api/* is answered here. Everything else is the built student page in public/.
//   3. Every response gets the security headers below; HTML also gets the CSP.
//
// All cutting maths runs in the student's browser, so the server has little to do: it hands out
// the teacher's class setup (bit, materials, speeds, which jobs are allowed). The setup lives in
// this app's own KV namespace under "class". GET /api/class is public; /api/teacher/* needs a
// teacher: a signed-in account (src/teachers.ts, shared by all four uploadmy sites) or the old shared
// TEACHER_KEY. Nothing set up = no teacher access.

import { DEFAULT_CLASS_CONFIG, validateClassConfig } from '../shared/settings.js';
import { AccountError, accountRoute, checkCredential, logChange, readSignIn, setupAllows, signInOptions } from './teachers.ts';

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

// Who this is (src/teachers.ts), or null. A wrong key, password, start code or session waits a
// moment (slows guessing). Nothing set up (no TEACHER_KEY / TEACHER_KEY_2, no accounts) means no
// teacher endpoint at all: never fall open. No lockout: a school shares one IP, and a lockout would
// let one student lock out the teacher.
async function teacherWho(env, cred) {
  // TEACHER_KEY_2: an optional second shared key (a student teacher); delete that secret to remove it.
  if (!env.TEACHER_KEY && !env.TEACHER_KEY_2 && !(env.TEACHERS_KV && env.TEACHER_SESSION_KEY)) {
    console.error(JSON.stringify({ message: 'no teacher key or accounts set up; teacher endpoint refused' }));
  } else {
    const who = await checkCredential(env, cred, Date.now());
    if (who) return who;
  }
  await new Promise((r) => setTimeout(r, TEACHER_REJECT_DELAY_MS));
  return null;
}

async function handleTeacher(request, env, url) {
  const path = url.pathname;
  // Signing in sends the name and password in the body; every other call sends the session (or the
  // old shared key) in x-teacher-key.
  const cred = path === '/api/teacher/signin' && request.method === 'POST'
    ? await readSignIn(request)
    : request.headers.get('x-teacher-key') ?? '';
  const who = await teacherWho(env, cred);
  if (!who) return json(401, { error: 'key', message: 'Wrong teacher key.' });
  if (who.setup && !setupAllows(path)) return json(403, { error: 'setup', message: 'Choose your own password first.' });
  const account = await accountRoute(request, path, env, env.CLASS_KV, who, cred, Date.now());
  if (account) return account;
  if (path !== '/api/teacher/class') return json(404, { error: 'not_found', message: 'No such API.' });
  if (request.method === 'GET') return json(200, await readClassConfig(env));
  if (request.method === 'DELETE') {
    await env.CLASS_KV?.delete(KV_CLASS);
    await logChange(env.CLASS_KV, who, 'Reset the class setup to the defaults', Date.now());
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
  await logChange(env.CLASS_KV, who, 'Saved the class setup', Date.now());
  return json(200, v.config);
}

async function handleApi(request, env, url) {
  if (url.pathname === '/api/health') return json(200, { ok: true });
  if (url.pathname === '/api/class') {
    if (request.method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
    return json(200, await readClassConfig(env));
  }
  // The teacher sign-in list: names only.
  if (url.pathname === '/api/teachers') {
    if (request.method !== 'GET') return json(405, { error: 'method', message: 'Use GET.' });
    return json(200, await signInOptions(env));
  }
  // Everything under /api/teacher/ needs a teacher, even paths that do not exist.
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
    if (url.pathname.startsWith('/api/')) {
      try {
        return withSecurityHeaders(await handleApi(request, env, url));
      } catch (e) {
        // A sign-in body too large or not JSON (src/teachers.ts readSignIn); `error` is the sentence
        // the shared sign-in box shows.
        if (e instanceof AccountError) return withSecurityHeaders(json(e.status, { error: e.message }));
        throw e;
      }
    }
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
