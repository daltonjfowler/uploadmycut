// The title-bar logo wakes up after 3 seconds of hovering (the animated drawing goes inline) and
// goes still when the pointer leaves. Checks all four family sites, which share
// web/public/logo-alive.js:   node test/browser/logo.test.mjs [local base for uploadmycut]
import { chromium } from 'playwright-core';
import { CHROME, OUT, check, failed } from './lib.mjs';

const sites = ['uploadmycode', 'uploadmylaser', 'uploadmymodel', 'uploadmycut'];
const browser = await chromium.launch({ executablePath: CHROME });
for (const site of sites) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`https://${site}.com/`);
  const logo = page.locator('img[data-logo]').first();
  await logo.waitFor();
  const alive = () => page.evaluate(() => {
    const img = document.querySelector('img[data-logo]');
    const next = img.nextElementSibling;
    return !!next && next.nodeName.toLowerCase() === 'svg' && getComputedStyle(img).display === 'none';
  });
  const box = await logo.boundingBox();
  await logo.hover();
  await page.waitForTimeout(1500);
  check(`${site}: still after 1.5 s`, !(await alive()));
  await page.waitForTimeout(2000);
  check(`${site}: awake after 3.5 s`, await alive());
  const clip = { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 };
  const a = await page.screenshot({ clip });
  await page.waitForTimeout(190);
  const b = await page.screenshot({ clip });
  await page.screenshot({ path: `${OUT}logo-${site}.png`, clip });
  check(`${site}: the drawing moves`, !a.equals(b));
  check(`${site}: same size as the still logo`, await page.evaluate(() => {
    const svg = document.querySelector('img[data-logo] + svg').getBoundingClientRect();
    const img = document.querySelector('img[data-logo]');
    return Math.abs(svg.width - img.width) < 1 && Math.abs(svg.height - img.height) < 1;
  }));
  await page.mouse.move(700, 500);
  await page.waitForTimeout(200);
  check(`${site}: still again after leaving`, !(await alive()) && (await logo.isVisible()));
  check(`${site}: no page errors`, errors.length === 0, errors.join(' | '));
  await page.close();
}
// Less motion asked for: never wakes.
const calm = await browser.newPage({ reducedMotion: 'reduce' });
await calm.goto('https://uploadmycut.com/');
await calm.locator('img[data-logo]').first().hover();
await calm.waitForTimeout(3600);
check('reduced motion: stays still', await calm.evaluate(() => !document.querySelector('img[data-logo] + svg')));
await browser.close();
process.exitCode = failed() ? 1 : 0;
