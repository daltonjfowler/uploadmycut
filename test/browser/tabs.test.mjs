// Tab markers can be dragged and reset; the teacher's clamp areas show and block cuts near them.
import { readFileSync } from 'node:fs';
import { BASE, OUT, check, failed, openPage, refuseUnlessLocal } from './lib.mjs';

const base = process.argv[2] || BASE;
refuseUnlessLocal(base, 'the tabs and clamps test');
const key = process.env.UMC_TEACHER_KEY
  || /TEACHER_KEY=(.*)/.exec(readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8'))?.[1].trim();
const { browser, page, errors } = await openPage({ base });

await page.evaluate(() => window.umc.addShape('square'));
await page.evaluate(() => window.umc.settled());
const before = await page.evaluate(() => window.umc.state.plan.tabs);
check('tab markers come from the plan', before.length >= 2, JSON.stringify(before));

// Drag the first tab 15 mm along the edge it sits on.
const drag = await page.evaluate(() => {
  const { state, view } = window.umc;
  const t = state.plan.tabs[0];
  const r = view.canvas.getBoundingClientRect();
  const a = view.toScreen([t.x, t.y]);
  // Move along whichever axis the edge runs: try +15 mm in x and y, keep the one that stays near.
  const b = view.toScreen([t.x + 15, t.y]);
  return { from: [r.left + a[0], r.top + a[1]], to: [r.left + b[0], r.top + b[1]], t };
});
await page.mouse.move(...drag.from);
await page.mouse.down();
await page.mouse.move((drag.from[0] + drag.to[0]) / 2, drag.from[1], { steps: 4 });
await page.mouse.move(...drag.to, { steps: 4 });
await page.mouse.up();
await page.evaluate(() => window.umc.settled());
const after = await page.evaluate(() => ({ tabs: window.umc.state.plan.tabs, placed: window.umc.state.parts[0].tabs }));
check('the part now has placed tabs', after.placed?.length === before.length, JSON.stringify(after.placed));
check('same number of tabs after the drag', after.tabs.length === before.length, JSON.stringify(after.tabs));
const moved = after.tabs.some((t) => Math.hypot(t.x - drag.t.x, t.y - drag.t.y) > 5);
check('one tab moved to the new spot', moved, JSON.stringify(after.tabs));
await page.screenshot({ path: `${OUT}tabs-moved.png` });

check('undo brings the automatic tabs back', await (async () => {
  await page.keyboard.press('Control+z');
  await page.evaluate(() => window.umc.settled());
  return page.evaluate(() => !window.umc.state.parts[0].tabs);
})());

// Clamps: the teacher marks 4 corners; a part pushed into a corner is blocked.
const put = await page.evaluate(async (k) => {
  const cfg = await (await fetch('/api/teacher/class', { headers: { 'x-teacher-key': k } })).json();
  for (const m of cfg.materials) { m.clampLayout = 'corners'; m.clampSize = 30; }
  return (await fetch('/api/teacher/class', { method: 'PUT', headers: { 'x-teacher-key': k, 'content-type': 'application/json' }, body: JSON.stringify(cfg) })).status;
}, key);
check('teacher saved clamp corners', put === 200, String(put));
await page.reload();
await page.waitForFunction(() => window.umc);
await page.evaluate(() => window.umc.settled());
check('clamps are drawn', await page.evaluate(() => window.umc.view.clamps.length === 4));
check('the saved design (away from corners) is fine', !/clamp/i.test(await page.textContent('#action')));
if (!(await page.evaluate(() => window.umc.state.parts.length))) await page.evaluate(() => window.umc.addShape('square'));
await page.evaluate(() => {
  const p = window.umc.state.parts[0];
  p.x = 40; // overlaps the front-left clamp, but well inside the board edge
  p.y = 45;
});
await page.evaluate(() => window.umc.planNow());
const msg = await page.textContent('#action');
check('a part in a clamp corner is blocked', /clamp/i.test(msg) && !/off the board/.test(msg) && await page.isDisabled('#go'), msg);
await page.screenshot({ path: `${OUT}clamps.png` });

// Put the class setup back.
await page.evaluate(async (k) => fetch('/api/teacher/class', { method: 'DELETE', headers: { 'x-teacher-key': k } }), key);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
