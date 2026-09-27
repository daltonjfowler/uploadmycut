// Teacher file check page (/check/): a good file passes, a file hiding $H behind a bare carriage
// return does not, a file with no material asks for one, and nothing is ever uploaded.
import { chromium } from 'playwright-core';
import { BASE, CHROME, OUT, check, failed } from './lib.mjs';
import { writeGcode } from '../../shared/gcode.js';

const base = process.argv[2] || BASE;
const config = await (await fetch(`${base}api/class`)).json();
const m = config.materials[0];
const cx = m.w / 2;
const cy = m.h / 2;
const good = writeGcode({
  moves: [
    { k: 'rapid', x: null, y: null, z: config.safeZ },
    { k: 'rapid', x: cx, y: cy, z: config.safeZ },
    { k: 'rapid', x: cx, y: cy, z: 1 },
    { k: 'plunge', x: cx, y: cy, z: -1 },
    { k: 'cut', x: cx + 10, y: cy, z: -1 },
  ],
  feeds: { feed: m.feed, plunge: m.plunge, rpm: 17000 },
  safeZ: config.safeZ,
  notes: ['uploadmycut good.nc', `Material ${m.label} ${m.t} mm, board ${m.w} x ${m.h} mm`],
});
const sneaky = good.replace('M5\n', '(b\r$H\r)\nM5\n');
const unnamed = good.split('\n').filter((l) => !l.startsWith('(Material')).join('\n');
const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

const res = await fetch(`${base}check/`);
check('page served', res.ok, String(res.status));
check('page has the CSP', /default-src 'self'/.test(res.headers.get('content-security-policy') ?? ''));
check('page cannot be framed', res.headers.get('x-frame-options') === 'DENY');

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const errors = [];
const sent = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('request', (r) => {
  if (r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
});
await page.goto(`${base}check/`);
await page.waitForFunction(() => /loaded/.test(document.querySelector('#configMsg').textContent));
check('class setup loaded', !(await page.isDisabled('#pick')));

await page.setInputFiles('#files', [file('good.nc', good), file('sneaky.nc', sneaky), file('unnamed.nc', unnamed)]);
await page.waitForFunction(() => document.querySelectorAll('.result').length === 3);
const verdicts = await page.$$eval('.result', (els) => els.map((e) => e.querySelector('.verdict').textContent));
check('good file: OK to run', /OK to run/.test(verdicts[0]), verdicts[0]);
check('bare carriage return hiding $H: do not run', /Do not run/.test(verdicts[1]), verdicts[1]);
const why = await page.textContent('.result:nth-child(2) .reasons');
check('the reason is in plain words', /\$\)|not allowed|Cannot read/.test(why), why);
check('file without a material asks for one', /Pick the material/.test(verdicts[2]), verdicts[2]);
await page.selectOption('#material', m.id);
const after = await page.$$eval('.result', (els) => els.map((e) => e.querySelector('.verdict').textContent));
check('picking the material checks it again', /OK to run/.test(after[2]), after[2]);
await page.screenshot({ path: `${OUT}check.png`, fullPage: true });
check('nothing was uploaded', sent.length === 0, sent.join(' | '));
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
