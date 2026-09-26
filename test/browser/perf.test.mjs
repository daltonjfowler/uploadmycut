// Speed on a slow Chromebook: CPU slowed 4x, a heavy drawing (a 20,000-point wiggly outline plus
// 150 small circles). Prints timings; FAILs when a step would make the page feel stuck.
//   node test/browser/perf.test.mjs [base] [points]
import { writeFileSync } from 'node:fs';
import { BASE, OUT, check, failed, openPage } from './lib.mjs';

const base = process.argv[2] || BASE;
const N = Number(process.argv[3] || 20000);

// A flower-ish outline with N points, 120 mm across, and 150 circles inside it.
let d = '';
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2;
  const r = 55 + 4 * Math.sin(a * 24) + 1.5 * Math.sin(a * 190);
  d += `${i ? 'L' : 'M'}${(60 + r * Math.cos(a)).toFixed(3)} ${(60 + r * Math.sin(a)).toFixed(3)}`;
}
d += 'Z';
let circles = '';
for (let i = 0; i < 150; i++) {
  const a = i * 2.39996;
  const rr = 3 + 45 * Math.sqrt(i / 150);
  circles += `<circle cx="${(60 + rr * Math.cos(a)).toFixed(2)}" cy="${(60 + rr * Math.sin(a)).toFixed(2)}" r="1.8"/>`;
}
const file = `${OUT}heavy.svg`;
writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 120 120"><path d="${d}"/>${circles}</svg>`);

const { browser, page, errors } = await openPage({ base });
// Pick the 200 x 200 MDF board so the drawing fits at full size.
await page.selectOption('#material', 'mdf');
const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

const time = async (label, fn, limitMs) => {
  const t0 = Date.now();
  await fn();
  const ms = Date.now() - t0;
  console.log(`${label}: ${ms} ms (limit ${limitMs})`);
  check(`${label} under ${limitMs} ms`, ms < limitMs, `${ms} ms`);
  return ms;
};

await time('open the drawing', async () => {
  await page.setInputFiles('#fileInput', file);
  await page.waitForFunction(() => window.umc.state.parts.length === 1);
}, 4000);
// Planning runs in a Web Worker: it may take a while, but the page must keep drawing frames.
await time('plan every cut (warnings, in the background)', () => page.evaluate(() => window.umc.planNow()), 10000);
const gap = await page.evaluate(async () => {
  let worst = 0;
  let last = performance.now();
  let run = true;
  const tick = (t) => {
    worst = Math.max(worst, t - last);
    last = t;
    if (run) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  await window.umc.planNow();
  run = false;
  return Math.round(worst);
});
console.log(`longest frame while planning: ${gap} ms`);
check('page keeps drawing while planning (no frame over 250 ms)', gap < 250, `${gap} ms`);
// Holes are tiny circles: pockets would be too small anyway. Make it a sign: outline cut out,
// circles as holes (the default guess).
await time('preview (G-code + carved board)', async () => {
  await page.click('#go');
  await page.waitForSelector('#download:not([disabled])', { timeout: 60000 });
}, 8000);
await page.click('#back');
// Moving the mouse over the board must stay quick (hit test on every move).
await time('60 mouse moves over the drawing', async () => {
  const box = await page.locator('#board canvas').boundingBox();
  for (let i = 0; i < 60; i++) await page.mouse.move(box.x + box.width * (0.3 + i / 200), box.y + box.height * 0.5);
}, 3000);
await time('drag the drawing 40 steps', async () => {
  const box = await page.locator('#board canvas').boundingBox();
  const [sx, sy] = await page.evaluate(() => {
    const { state, view } = window.umc;
    const p = state.parts[0];
    const r = view.canvas.getBoundingClientRect();
    const [x, y] = view.toScreen([p.x + p.lines[0].points[0][0] * p.scale, p.y + p.lines[0].points[0][1] * p.scale]);
    return [r.left + x, r.top + y];
  });
  void box;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(sx + i, sy + i / 2);
  await page.mouse.up();
}, 4000);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
