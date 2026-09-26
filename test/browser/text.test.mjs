// Text: script name with letter centres as holes, a border for a keychain, block letters pocketed.
import { BASE, OUT, check, failed, openPage } from './lib.mjs';

const base = process.argv[2] || BASE;
const { browser, page, errors } = await openPage({ base });

// Through the dialog, like a student.
await page.click('#textBtn');
await page.fill('#textInput', 'Maple');
await page.check('input[name="font"][value="script"]');
await page.fill('#textHeight', '30');
await page.click('#textForm button[value="ok"]');
await page.waitForFunction(() => window.umc.state.parts.length === 1, null, { timeout: 15000 });
const t = await page.evaluate(() => {
  const p = window.umc.state.parts[0];
  return { jobs: p.jobs, fill: p.fill, kind: p.kind };
});
const holes = t.jobs.filter((j) => j === 'hole').length;
// a and e have centres, the p loop too: at least 3 holes; the rest cut out.
check('script text has letter centres as holes', holes >= 3, JSON.stringify(t.jobs));
check('script text has cut outs', t.jobs.includes('cutout'));
check('text is non-zero fill', t.fill === 'nonzero');
check('dialog closed', !(await page.isVisible('#textDialog')));
await page.evaluate(() => window.umc.settled());
await page.screenshot({ path: `${OUT}text-script.png` });

// Border: letters become a pocket, the new outline is cut out.
await page.click('#border');
const b = await page.evaluate(() => {
  const p = window.umc.state.parts[0];
  return { n: p.lines.length, last: p.jobs.at(-1), pockets: p.jobs.filter((j) => j === 'pocket').length };
});
check('border added and cut out', b.last === 'cutout', JSON.stringify(b));
check('letters became pocket', b.pockets >= 6, JSON.stringify(b));
await page.evaluate(() => window.umc.settled());
await page.screenshot({ path: `${OUT}text-border.png` });
const msg = await page.textContent('#action');
check('border design has no blocking problem', !/✕/.test(msg), msg);
await page.click('#go');
await page.waitForSelector('#download:not([disabled])', { timeout: 20000 });
await page.screenshot({ path: `${OUT}text-border-preview.png` });

// Block letters, all pocketed, are fine to preview too.
await page.click('#back');
await page.keyboard.press('Delete');
await page.evaluate(() => window.umc.addText('HELLO', 'block', 25));
await page.waitForFunction(() => window.umc.state.parts.length === 1);
const blockJobs = await page.evaluate(() => window.umc.state.parts[0].jobs);
check('block O has a hole', blockJobs.filter((j) => j === 'hole').length === 1, JSON.stringify(blockJobs));

// Stencil letters: the O has no loose middle (bridges split it), so no island needs holding.
await page.keyboard.press('Delete');
await page.evaluate(() => window.umc.addText('OBA', 'stencil', 30));
await page.waitForFunction(() => window.umc.state.parts.length === 1);
const stencilHoles = await page.evaluate(() => window.umc.state.parts[0].jobs.filter((j) => j === 'hole').length);
check('stencil letters have no loose centres', stencilHoles === 0, String(stencilHoles));
// Bent text through the dialog: arch up 90 degrees.
await page.keyboard.press('Delete');
await page.click('#textBtn');
await page.fill('#textInput', 'COASTER');
await page.check('input[name="font"][value="block"]');
await page.fill('#textBend', '90');
await page.dispatchEvent('#textBend', 'input');
check('bend label reads arch up', /arch up 90/.test(await page.textContent('#textBendOut')));
await page.click('#textForm button[value="ok"]');
await page.waitForFunction(() => window.umc.state.parts.length === 1, null, { timeout: 15000 });
const shape = await page.evaluate(() => {
  const p = window.umc.state.parts[0];
  const ys = p.lines.map((l) => Math.min(...l.points.map((q) => q[1])));
  return { first: ys[0], mid: ys[Math.floor(ys.length / 2)] };
});
check('bent text: the middle sits higher than the ends (y up on the board)', shape.mid > shape.first + 3, JSON.stringify(shape));
await page.evaluate(() => window.umc.settled());
await page.screenshot({ path: `${OUT}text-bent.png` });
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
