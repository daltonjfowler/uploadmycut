// USB test page against a pretend GRBL 1.1 Shapeoko (a fake navigator.serial in the page).
// Checks: the answers show up, and the page writes nothing but the four read-only questions.
import { readFileSync } from 'node:fs';
import { BASE, OUT, check, failed, openPage } from './lib.mjs';
import { isReadOnly } from '../../shared/grbl.js';

const base = process.argv[2] || BASE;
const { browser, ctx, page, errors } = await openPage({ base });
await ctx.addInitScript(() => {
  const enc = new TextEncoder();
  const written = [];
  window.__written = written;
  let push = null;
  const say = (text) => push?.(enc.encode(text));
  const answers = {
    '?': '<Alarm|MPos:-100.000,-50.000,-5.000|FS:0,0|Pn:XYZ|WCO:-120.000,-60.000,-10.000>\r\n',
    '$I\n': '[VER:1.1f.20170801:]\r\n[OPT:VL,15,128]\r\nok\r\n',
    '$G\n': '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\r\nok\r\n',
    '$$\n': '$0=10\r\n$10=1\r\n$22=1\r\n$100=40.000\r\n$101=40.000\r\n$102=40.000\r\n$130=420.000\r\n$131=430.000\r\n$132=100.000\r\nok\r\n',
  };
  const port = {
    getInfo: () => ({ usbVendorId: 0x2a03, usbProductId: 0x0043 }),
    async open() {
      setTimeout(() => say("\r\nGrbl 1.1f ['$' for help]\r\n[MSG:'$H'|'$X' to unlock]\r\n"), 200);
    },
    async close() {},
    readable: new ReadableStream({ start(c) { push = (b) => c.enqueue(b); } }),
    writable: new WritableStream({
      write(chunk) {
        const text = new TextDecoder().decode(chunk);
        written.push(text);
        setTimeout(() => say(answers[text] ?? 'error:1\r\n'), 30);
      },
    }),
  };
  Object.defineProperty(navigator, 'serial', {
    value: { requestPort: async () => port, getPorts: async () => [port], addEventListener() {} },
  });
});

await page.goto(`${base}usb-test/`);
check('page says it cannot move the machine', /cannot move the machine/.test(await page.textContent('main')));
await page.click('#connect');
await page.waitForFunction(() => /Grbl 1\.1f/.test(document.querySelector('#banner').textContent));
check('connection text updated', /GRBL answered/.test(await page.textContent('#conn')));
check('USB id shown', (await page.textContent('#usbId')) === 'VID 2a03 · PID 0043');
await page.click('#askAll');
await page.waitForFunction(() => document.querySelectorAll('#settings tbody tr').length >= 9, null, { timeout: 5000 });
check('state shown', (await page.textContent('#state')) === 'Alarm');
check('work position from WCO', (await page.textContent('#wpos')).trim() === '20.00  10.00  5.00', await page.textContent('#wpos'));
check('version shown', /VER:1\.1f/.test(await page.textContent('#version')));
const guess = await page.textContent('#guess');
check('machine guess: belt Z, standard, homing', /belt-driven Z/.test(guess) && /standard size/.test(guess) && /homing switches/.test(guess), guess);
await page.check('#live');
await page.waitForTimeout(1300);
await page.uncheck('#live');
await page.screenshot({ path: `${OUT}usb-test.png`, fullPage: true });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#save')]);
await dl.saveAs(`${OUT}${dl.suggestedFilename()}`);
const rep = readFileSync(`${OUT}${dl.suggestedFilename()}`, 'utf8');
check('report has USB id and settings', /VID 2a03 PID 0043/.test(rep) && /\$102=40/.test(rep), rep.slice(0, 200));
const written = await page.evaluate(() => window.__written);
check('only read-only questions were written', written.length > 4 && written.every(isReadOnly), JSON.stringify(written));
await page.click('#disconnect');
check('disconnected', (await page.textContent('#conn')) === 'Not connected.');
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
process.exitCode = failed() ? 1 : 0;
