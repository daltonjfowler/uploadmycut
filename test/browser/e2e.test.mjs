// Student flow: shape and SVG onto the board, jobs, preview, download, and the file passes the
// checker. Screenshots go to test/browser/.out/.
import { readFileSync } from 'node:fs';
import { BASE, FIXTURES, OUT, check, failed, openPage } from './lib.mjs';
import { checkGcode } from '../../shared/check-gcode.js';

const base = process.argv[2] || BASE;
const { browser, page, errors } = await openPage({ base });

await page.screenshot({ path: `${OUT}empty.png` });
check('empty state shows', await page.isVisible('#empty'));

// Keychain tag: tag cut out, ring hole a hole.
await page.click('#emptyShape');
const jobs = await page.evaluate(() => window.umc.state.parts[0].jobs);
check('tag jobs are cut out + hole', JSON.stringify(jobs) === '["cutout","hole"]', JSON.stringify(jobs));
await page.evaluate(() => window.umc.settled());
const msgs = await page.textContent('#action');
check('tag is ready', /Ready/.test(msgs), msgs);

// The SVG: text left out with a note, star and sign cut, wave engraved.
await page.setInputFiles('#fileInput', `${FIXTURES}star-sign.svg`);
await page.waitForFunction(() => window.umc.state.parts.length === 2);
const svgPart = await page.evaluate(() => {
  const p = window.umc.state.parts[1];
  return { lines: p.lines.length, jobs: p.jobs, scale: p.scale };
});
check('svg has 4 lines', svgPart.lines === 4, JSON.stringify(svgPart));
check('svg auto jobs', JSON.stringify(svgPart.jobs) === '["cutout","hole","hole","engrave"]', JSON.stringify(svgPart.jobs));
const toasts = await page.textContent('#toasts');
check('text note shown', /Text in the file was left out/.test(toasts), toasts);

// The board is 140 mm wide; the 100 mm sign fits, so it stays full size. Two parts overlap now:
// move the tag off to the back of the board and give the star a pocket.
await page.evaluate(() => {
  const s = window.umc.state;
  s.parts[0].y = 175;
  s.parts[0].x = 70;
  s.parts[1].y = 70;
});
await page.evaluate(() => window.umc.setStage('design'));
// Click the star line on the canvas: find its screen position through the view.
const starPt = await page.evaluate(() => {
  const { state, view } = window.umc;
  const p = state.parts[1];
  const [lx, ly] = p.lines[2].points[0];
  const t = (p.rotation * Math.PI) / 180;
  const bx = p.x + p.scale * (lx * Math.cos(t) - ly * Math.sin(t));
  const by = p.y + p.scale * (lx * Math.sin(t) + ly * Math.cos(t));
  const r = view.canvas.getBoundingClientRect();
  const [sx, sy] = view.toScreen([bx, by]);
  return [r.left + sx, r.top + sy];
});
await page.mouse.click(starPt[0], starPt[1]);
const picked = await page.evaluate(() => [...window.umc.state.selected.lines]);
check('click picks the star line', JSON.stringify(picked) === '[2]', JSON.stringify(picked));
await page.click('#panel [data-job="pocket"]');
const starJob = await page.evaluate(() => window.umc.state.parts[1].jobs[2]);
check('star is now a pocket', starJob === 'pocket', starJob);
check('pocket depth slider shows', await page.isVisible('#pocketDepth'));
await page.evaluate(() => window.umc.settled());
await page.screenshot({ path: `${OUT}design.png` });

// Undo brings the hole back.
await page.keyboard.press('Control+z');
check('undo', (await page.evaluate(() => window.umc.state.parts[1].jobs[2])) === 'hole');
await page.keyboard.press('Control+y');
check('redo', (await page.evaluate(() => window.umc.state.parts[1].jobs[2])) === 'pocket');

// Preview and download.
await page.evaluate(() => window.umc.settled());
const msgs2 = await page.textContent('#action');
check('design ready before preview', !/✕/.test(msgs2), msgs2);
await page.click('#go');
await page.waitForSelector('#download:not([disabled])');
await page.screenshot({ path: `${OUT}preview.png` });
await page.check('#showPath');
await page.screenshot({ path: `${OUT}preview-path.png` });
await page.fill('#fileName', 'Keychain & Sign!');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
check('file name cleaned', dl.suggestedFilename() === 'Keychain-Sign.nc', dl.suggestedFilename());
const file = `${OUT}${dl.suggestedFilename()}`;
await dl.saveAs(file);
const gcode = readFileSync(file, 'utf8');
const r = checkGcode(gcode, { board: { w: 140, h: 200, t: 19 }, maxThroughMm: 0.35, maxFeed: 900 });
check('downloaded file passes the checker', r.ok, JSON.stringify(r.errors));
check('file header', /^\(uploadmycut Keychain-Sign\.nc\)\n/.test(gcode) && gcode.includes('M3 S17000'), gcode.slice(0, 300));
check('cuts through 19 mm + 0.3', r.stats.minZ === -19.3, String(r.stats.minZ));
const [dlf] = await Promise.all([page.waitForEvent('download'), page.click('#downloadFrame')]);
check('frame file name', dlf.suggestedFilename() === 'Keychain-Sign-frame.nc', dlf.suggestedFilename());
await dlf.saveAs(`${OUT}${dlf.suggestedFilename()}`);
const frame = readFileSync(`${OUT}${dlf.suggestedFilename()}`, 'utf8');
check('frame file: router off, stays up, passes the checker', !/\bM0?3\b/.test(frame) && !/Z-/.test(frame)
  && checkGcode(frame, { board: { w: 140, h: 200, t: 19 }, maxThroughMm: 0.35, maxFeed: 900, safeZ: 5 }).ok, frame.slice(0, 300));

// Dark theme screenshot of the same preview.
await page.click('#theme'); // system -> light
await page.click('#theme'); // light -> dark
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}preview-dark.png` });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
