// Teacher page: wrong key refused; right key loads, saves, and students get the new setup; reset.
// Key: UMC_TEACHER_KEY, else TEACHER_KEY from .dev.vars (never on the command line: npm echoes it).
import { readFileSync } from 'node:fs';
import { BASE, OUT, check, failed, openPage } from './lib.mjs';

const base = process.argv[2] || BASE;
const key = process.env.UMC_TEACHER_KEY
  || /TEACHER_KEY=(.*)/.exec(readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8'))?.[1].trim();
const { browser, page, errors } = await openPage({ base });

await page.goto(`${base}teacher/`);
await page.fill('#key', 'wrong-key');
await page.click('#keyForm button');
await page.waitForFunction(() => /not right/.test(document.querySelector('#keyMsg').textContent));
check('wrong key refused', await page.isHidden('#setup'));

await page.fill('#key', key);
await page.click('#keyForm button');
await page.waitForSelector('#setup:not([hidden])');
check('right key opens the setup', true);
await page.screenshot({ path: `${OUT}teacher.png`, fullPage: true });

// 1/4 in bit, starting values for the pine row, pockets off, a note.
await page.selectOption('#bit', '201');
await page.click('#matRows tr:first-child [data-act="start"]');
const feed = await page.inputValue('#matRows tr:first-child [data-f="feed"]');
check('starting values filled for the 1/4 in bit', feed === '1500', feed);
await page.uncheck('[data-job="pocket"]');
await page.fill('#note', 'Safety glasses on!');
await page.click('#setup button[type="submit"]');
await page.waitForFunction(() => /Saved/.test(document.querySelector('#saveMsg').textContent));
check('saved', true);

// Bad values are refused by the server, not just the page.
const bad = await page.evaluate(async (k) => {
  const r = await fetch('/api/teacher/class', { method: 'PUT', headers: { 'x-teacher-key': k, 'content-type': 'application/json' }, body: JSON.stringify({ machine: 'shapeoko3', router: 'makita', bit: '102', materials: [{ id: 'x', label: 'x', kind: 'mdf', t: 6, w: 100, h: 100, feed: 99999, plunge: 100, depthPerPass: 1, dial: 3 }], jobs: {}, tabs: { width: 6, height: 2 }, engraveDepth: 1, pocketMaxDepth: 3, safeZ: 5, throughMm: 0.3, marginMm: 6, stepover: 0.4 }) });
  return r.status;
}, key);
check('server refuses a feed over the limit', bad === 400, String(bad));

// The student page follows.
await page.goto(`${base}?debug`);
await page.waitForFunction(() => window.umc);
const bitText = await page.textContent('#bitText');
check('student page shows the 1/4 in bit', /1\/4 in/.test(bitText), bitText);
await page.evaluate(() => window.umc.addShape('coaster'));
const coasterJobs = await page.evaluate(() => window.umc.state.parts[0].jobs);
check('pocket turned off: coaster pocket becomes engrave', JSON.stringify(coasterJobs) === '["cutout","engrave"]', JSON.stringify(coasterJobs));
const noteShown = await page.textContent('#panel');
check('class note shown', /Safety glasses on!/.test(noteShown));

// Put it back.
const reset = await page.evaluate(async (k) => (await fetch('/api/teacher/class', { method: 'DELETE', headers: { 'x-teacher-key': k } })).status, key);
check('reset to defaults', reset === 200);

check('no page errors', errors.filter((e) => !/status of 40[01]/.test(e)).length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
