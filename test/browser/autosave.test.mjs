// Autosave: a reloaded tab gets the design back; Clear board empties it for good.
import { BASE, check, failed, openPage } from './lib.mjs';

const base = process.argv[2] || BASE;
const { browser, page, errors } = await openPage({ base });
await page.click('#emptyShape');
await page.evaluate(() => window.umc.addShape('heart'));
await page.click('#panel [data-job="engrave"]'); // the heart becomes an engraving
await page.waitForTimeout(1200); // saved 0.8 s after the last change
await page.reload();
await page.waitForFunction(() => window.umc && window.umc.state.parts.length === 2, null, { timeout: 10000 }).catch(() => {});
const back = await page.evaluate(() => window.umc.state.parts.map((p) => [p.name, p.jobs.join()]));
check('design is back after reload', JSON.stringify(back) === '[["Keychain tag","cutout,hole"],["Heart","engrave"]]', JSON.stringify(back));
check('told the student', /from last time/.test(await page.textContent('#toasts')));

await page.click('#clearBtn');
check('clear board empties it', (await page.evaluate(() => window.umc.state.parts.length)) === 0);
await page.keyboard.press('Control+z');
check('undo brings it back', (await page.evaluate(() => window.umc.state.parts.length)) === 2);
await page.click('#clearBtn');
await page.waitForTimeout(1200);
await page.reload();
await page.waitForFunction(() => window.umc);
await page.waitForTimeout(300);
check('cleared board stays empty after reload', (await page.evaluate(() => window.umc.state.parts.length)) === 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
