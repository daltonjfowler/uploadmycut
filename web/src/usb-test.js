// Read-only USB test for the class Shapeoko (PLAN.md phase 2). Web Serial, 115200 baud. The ONLY
// bytes this page can write are shared/grbl.js READ_ONLY; send() refuses anything else.

import './style.css';
import './teacher.css';
import { initThemeButton } from './theme.js';
import { $, esc } from './dom.js';
import { READ_ONLY, SETTING_NAMES, guessMachine, isReadOnly, parseSetting, parseStatus } from '../../shared/grbl.js';

const BAUD = 115200;
const MAX_LOG = 400;

initThemeButton($('#theme'));

let port = null;
let reader = null;
let liveTimer = 0;
let wco = null;
const log = [];
const settings = {};
const report = { usb: null, banner: null, version: [], parser: null, status: null };

function addLog(dir, text) {
  log.push(`${new Date().toLocaleTimeString()} ${dir} ${text}`);
  if (log.length > MAX_LOG) log.shift();
  $('#log').textContent = log.join('\n');
  $('#log').scrollTop = $('#log').scrollHeight;
}

function setConnected(on, text) {
  $('#conn').textContent = text;
  $('#connect').disabled = on;
  $('#disconnect').disabled = !on;
  for (const b of document.querySelectorAll('[data-ask], #askAll, #live, #save')) b.disabled = !on && b.id !== 'save';
  if (!on) {
    $('#live').checked = false;
    clearInterval(liveTimer);
  }
}

async function send(bytes) {
  if (!isReadOnly(bytes)) throw new Error('refused: not a read-only question'); // never happens by design
  if (!port?.writable) return;
  const w = port.writable.getWriter();
  try {
    await w.write(new TextEncoder().encode(bytes));
  } finally {
    w.releaseLock();
  }
  if (bytes !== READ_ONLY.status) addLog('→', bytes.trim());
}

function onLine(line) {
  if (!line) return;
  const st = parseStatus(line, wco);
  if (st) {
    if (st.wco) wco = st.wco;
    report.status = line;
    $('#state').textContent = st.sub !== null ? `${st.state}:${st.sub}` : st.state;
    if (st.wpos) $('#wpos').textContent = st.wpos.map((n) => n.toFixed(2)).join('  ');
    if (st.mpos) $('#mpos').textContent = st.mpos.map((n) => n.toFixed(2)).join('  ');
    if (!$('#live').checked) addLog('←', line);
    return;
  }
  addLog('←', line);
  if (/^Grbl /.test(line)) {
    report.banner = line;
    $('#banner').textContent = line;
    $('#conn').textContent = `Connected at ${BAUD} baud. GRBL answered.`;
  } else if (/^\[VER:|^\[OPT:/.test(line)) {
    report.version.push(line);
    $('#version').textContent = report.version.join(' ');
  } else if (/^\[GC:/.test(line)) {
    report.parser = line;
  }
  const s = parseSetting(line);
  if (s) {
    settings[s[0]] = s[1];
    renderSettings();
  }
}

function renderSettings() {
  const keys = Object.keys(settings).sort((a, b) => Number(a) - Number(b));
  $('#settings').innerHTML = `<thead><tr><th>Setting</th><th>Value</th><th>Means</th></tr></thead><tbody>${keys
    .map((k) => `<tr><td>$${esc(k)}</td><td>${esc(String(settings[k]))}</td><td class="note">${esc(SETTING_NAMES[k] ?? '')}</td></tr>`).join('')}</tbody>`;
  $('#guess').innerHTML = guessMachine(settings).map((n) => `<li>${esc(n)}</li>`).join('');
}

async function readLoop() {
  const decoder = new TextDecoder();
  let buf = '';
  reader = port.readable.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i).replace(/\r$/, '').trim());
        buf = buf.slice(i + 1);
      }
      if (buf.length > 4096) buf = ''; // not GRBL talking
    }
  } catch (e) {
    addLog('!', `read stopped: ${e.message}`);
  } finally {
    reader.releaseLock();
    reader = null;
  }
}

async function connect() {
  try {
    port = await navigator.serial.requestPort(); // no filter: Carbide's USB id is not known yet
  } catch {
    return; // picker closed
  }
  const info = port.getInfo();
  const hex = (n) => (n === undefined ? '?' : n.toString(16).padStart(4, '0'));
  report.usb = { vendorId: hex(info.usbVendorId), productId: hex(info.usbProductId) };
  $('#usbId').textContent = `VID ${report.usb.vendorId} · PID ${report.usb.productId}`;
  try {
    await port.open({ baudRate: BAUD });
  } catch (e) {
    setConnected(false, `Could not open the port: ${e.message} Is Carbide Motion still open?`);
    port = null;
    return;
  }
  setConnected(true, `Connected at ${BAUD} baud. Waiting for GRBL to say hello…`);
  readLoop();
  // GRBL restarts when the port opens and prints its banner; ask for status once it is up.
  setTimeout(() => send(READ_ONLY.status), 2500);
}

async function disconnect() {
  clearInterval(liveTimer);
  try {
    await reader?.cancel();
  } catch { /* already stopped */ }
  try {
    await port?.close();
  } catch { /* already closed */ }
  port = null;
  setConnected(false, 'Not connected.');
}

function saveReport() {
  const text = [
    `uploadmycut USB test report, ${new Date().toISOString()}`,
    `USB id: VID ${report.usb?.vendorId ?? '?'} PID ${report.usb?.productId ?? '?'}`,
    `Banner: ${report.banner ?? '-'}`,
    `Version: ${report.version.join(' ') || '-'}`,
    `Parser: ${report.parser ?? '-'}`,
    `Last status: ${report.status ?? '-'}`,
    '',
    'Settings:',
    ...Object.keys(settings).sort((a, b) => Number(a) - Number(b)).map((k) => `$${k}=${settings[k]}  ${SETTING_NAMES[k] ?? ''}`),
    '',
    'Guess:',
    ...guessMachine(settings),
    '',
    'Log:',
    ...log,
    '',
  ].join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shapeoko-usb-report.txt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

if (!('serial' in navigator)) {
  $('#noSerial').hidden = false;
  $('#connect').disabled = true;
}
$('#connect').addEventListener('click', connect);
$('#disconnect').addEventListener('click', disconnect);
for (const b of document.querySelectorAll('[data-ask]')) b.addEventListener('click', () => send(READ_ONLY[b.dataset.ask]));
$('#askAll').addEventListener('click', async () => {
  for (const k of ['status', 'version', 'parser', 'settings']) {
    await send(READ_ONLY[k]);
    await new Promise((r) => setTimeout(r, 400));
  }
});
$('#live').addEventListener('change', (e) => {
  clearInterval(liveTimer);
  if (e.target.checked) liveTimer = setInterval(() => send(READ_ONLY.status), 500);
});
$('#save').addEventListener('click', saveReport);
navigator.serial?.addEventListener('disconnect', (e) => {
  if (e.target === port) {
    port = null;
    setConnected(false, 'The USB cable was unplugged.');
  }
});
