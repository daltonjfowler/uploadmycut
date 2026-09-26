// axe-core accessibility scan of the main screens, light and dark. Any problem fails the test.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';

const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const base = process.argv[2] || BASE;
const key = process.env.UMC_TEACHER_KEY
  || /TEACHER_KEY=(.*)/.exec(readFileSync(new URL('../../.dev.vars', import.meta.url), 'utf8'))?.[1].trim();
const browser = await chromium.launch({ executablePath: CHROME });
const scan = async (page, label) => {
  await page.addScriptTag({ content: axe });
  const r = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }));
  console.log(`${r.violations.length ? 'FAIL' : 'PASS'} ${label}: ${r.violations.length} kinds of problem`);
  if (r.violations.length) process.exitCode = 1;
  for (const v of r.violations) {
    console.log(`  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length}x)`);
    for (const n of v.nodes.slice(0, 3)) console.log(`      ${n.target.join(' ')} ${n.any?.[0]?.message ? '- ' + n.any[0].message.slice(0, 140) : ''}`);
  }
};
for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, colorScheme: scheme, bypassCSP: true });
  await page.goto(`${base}?debug`);
  await page.waitForFunction(() => window.umc);
  await scan(page, `${scheme}: empty student page`);
  await page.click('#emptyShape');
  await page.evaluate(() => window.umc.settled());
  await scan(page, `${scheme}: tag selected, job panel`);
  await page.click('#textBtn');
  await scan(page, `${scheme}: text dialog`);
  await page.keyboard.press('Escape');
  await page.click('#go');
  await page.waitForSelector('#download');
  await scan(page, `${scheme}: preview`);
  await page.goto(`${base}teacher/`);
  await page.fill('#key', key);
  await page.click('#keyForm button');
  await page.waitForSelector('#setup:not([hidden])');
  await scan(page, `${scheme}: teacher page`);
  await page.goto(`${base}usb-test/`);
  await scan(page, `${scheme}: USB test page`);
  await page.close();
}
await browser.close();
