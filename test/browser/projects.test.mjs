// Starter projects, Copies, and the board never sliding off the screen (phone and desktop).
import { BASE, OUT, check, failed, openPage } from './lib.mjs';

const base = process.argv[2] || BASE;
{
  const { browser, page, errors } = await openPage({ base });
  // Name keychain from the Shapes menu, through the text dialog.
  await page.click('#shapesBtn');
  await page.click('[data-project="keychain"]');
  check('dialog says Name keychain', (await page.textContent('#textTitle')) === 'Name keychain');
  await page.fill('#textInput', 'Maple');
  await page.click('#textOk');
  await page.waitForFunction(() => window.umc.state.parts.length === 1, null, { timeout: 15000 });
  const jobs = await page.evaluate(() => [...new Set(window.umc.state.parts[0].jobs)].sort());
  check('keychain has pocket letters, cut out outline and a hole', JSON.stringify(jobs) === '["cutout","hole","pocket"]', JSON.stringify(jobs));
  await page.evaluate(() => window.umc.settled());
  const msg = await page.textContent('#action');
  check('keychain can be previewed', !(await page.isDisabled('#go')), msg);
  await page.screenshot({ path: `${OUT}keychain-starter.png` });

  // A class set of star ornaments.
  await page.click('#clearBtn');
  await page.click('#shapesBtn');
  await page.click('[data-project="ornament"]');
  await page.click('#copies');
  await page.fill('#copiesCount', '4');
  await page.click('#copiesForm button[value="ok"]');
  await page.evaluate(() => window.umc.settled());
  const n = await page.evaluate(() => window.umc.state.parts.length);
  check('copies made (as many as fit)', n >= 2 && n <= 4, String(n));
  const bad = await page.evaluate(() => window.umc.state.plan.warnings.filter((w) => ['offBoard', 'clamp', 'noTabs'].includes(w.code)).length);
  check('the class set has no blocking problem', bad === 0);
  await page.screenshot({ path: `${OUT}copies.png` });
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}
// Phone: drag the empty board area far away, the board stays in the free area; Fit brings it back.
{
  const { browser, page, errors } = await openPage({ base, width: 390, height: 844 });
  await page.evaluate(() => window.umc.addShape('heart'));
  await page.evaluate(() => { window.umc.state.selected = null; });
  const box = await page.locator('#board canvas').boundingBox();
  await page.mouse.move(box.x + 30, box.y + 180);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 30 - i * 80, box.y + 180 - i * 90);
  await page.mouse.up();
  const seen = await page.evaluate(() => {
    const v = window.umc.view;
    const f = v.free;
    const x0 = v.view.ox;
    const x1 = v.view.ox + v.board.w * v.view.s;
    const y1 = v.view.oy;
    const y0 = v.view.oy - v.board.h * v.view.s;
    return Math.min(x1, f.x1) - Math.max(x0, f.x0) >= 40 && Math.min(y1, f.y1) - Math.max(y0, f.y0) >= 40;
  });
  check('phone: the board is still on screen after a wild drag', seen);
  await page.click('#fitBtn');
  const fitted = await page.evaluate(() => Math.abs(window.umc.view.view.s - window.umc.view.fitScale) < 1e-9);
  check('phone: Fit shows the whole board again', fitted);
  await page.screenshot({ path: `${OUT}phone-fit.png` });
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
}
process.exitCode = failed() ? 1 : 0;
