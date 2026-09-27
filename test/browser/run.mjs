// Run the browser tests against a running site and print a summary.
//   npm run dev, then: npm run test:browser            (local wrangler dev on :8791)
//   npm run test:browser -- http://127.0.0.1:8792/     (another local port)
//   npm run test:browser -- https://uploadmycut.com/   (read-only tests only)
// Needs Chrome (CHROME_PATH to override). Never put the teacher key on the command line.
// The tests that change the class setup (tabs, teacher) run only against a local dev server:
// against the live site they would wipe the teacher's real setup.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isLocal } from './lib.mjs';

const base = process.argv[2] || 'http://127.0.0.1:8791/';
const WRITES = new Set(['tabs', 'teacher']);
let failed = 0;
for (const t of ['e2e', 'text', 'autosave', 'tabs', 'projects', 'teacher', 'check', 'usb', 'a11y']) {
  if (WRITES.has(t) && !isLocal(base)) {
    console.log(`${t.padEnd(8)} skipped: it changes the class setup, so it runs only against a local dev server`);
    continue;
  }
  const file = fileURLToPath(new URL(`./${t}.test.mjs`, import.meta.url));
  const r = spawnSync(process.execPath, [file, base], { encoding: 'utf8', timeout: 300_000, env: process.env });
  const out = `${r.stdout}${r.stderr}`;
  const pass = (out.match(/^PASS/gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length + (r.status !== 0 && !/^FAIL/m.test(out) ? 1 : 0);
  failed += fail;
  console.log(`${t.padEnd(8)} ${pass} pass, ${fail} fail`);
  for (const line of out.split('\n')) if (/^FAIL|Error:/.test(line)) console.log(`   ${line}`);
}
process.exitCode = failed ? 1 : 0;
