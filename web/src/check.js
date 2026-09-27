// Teacher file check: any .nc file → shared/check-gcode.js with the class limits saved right now
// (GET /api/class, like the student page). All in this browser; the file is never uploaded.

import './style.css';
import './teacher.css';
import './check.css';
import { initThemeButton } from './theme.js';
import { $, esc, fmt } from './dom.js';
import { checkGcode } from '../../shared/check-gcode.js';
import { commentText } from '../../shared/gcode.js';
import { checkLimits, validateClassConfig } from '../../shared/settings.js';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

initThemeButton($('#theme'));

let config = null;
let last = []; // [{ name, text }] so a new material choice re-checks them

function setConfigMsg(text, kind) {
  const m = $('#configMsg');
  m.textContent = text;
  m.className = `msg ${kind}`;
}

async function loadConfig() {
  try {
    const r = await fetch('/api/class', { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    const v = validateClassConfig(await r.json());
    if (!v.ok) throw new Error('invalid');
    config = v.config;
  } catch {
    // Never check against made-up limits: without the real setup there is no answer.
    setConfigMsg('The class setup did not load, so nothing can be checked. Check the internet and reload the page.', 'bad');
    return;
  }
  const sel = $('#material');
  for (const m of config.materials) {
    sel.insertAdjacentHTML('beforeend', `<option value="${esc(m.id)}">${esc(`${m.label} (${m.t} mm, ${m.w} x ${m.h} mm)`)}</option>`);
  }
  sel.disabled = false;
  $('#pick').disabled = false;
  setConfigMsg(`Class setup loaded: ${config.materials.length} material${config.materials.length === 1 ? '' : 's'}, safe height ${config.safeZ} mm.`, 'ok');
}

// The material a file of ours names in its header: "(Material Pine board 19 mm, board 140 x 200 mm)".
function namedMaterial(text) {
  const head = text.slice(0, 2000);
  const hit = /\(Material (.+?) ([\d.]+) mm, board ([\d.]+) x ([\d.]+) mm\)/.exec(head);
  if (!hit) return { claim: null, material: null };
  const [, label, t, w, h] = hit;
  // The writer cleaned the label for a comment (shared/gcode.js commentText); compare it cleaned.
  const material = config.materials.find((m) => commentText(m.label) === label && m.t === Number(t) && m.w === Number(w) && m.h === Number(h));
  return { claim: `${label} ${t} mm, ${w} x ${h} mm`, material: material ?? null };
}

function resultCard({ name, text, tooBig }) {
  const title = `<h2 class="fname">${esc(name)}</h2>`;
  if (tooBig) {
    return `<section class="card page-card result bad">${title}<p class="verdict bad">✖ Do not run this file</p>
      <p class="note">It is far bigger than any file the student page makes (the most is 20 MB).</p></section>`;
  }
  const chosen = config.materials.find((m) => m.id === $('#material').value) ?? null;
  const named = namedMaterial(text);
  const material = chosen ?? named.material;
  if (!material) {
    const why = named.claim
      ? `The file says it is for "${named.claim}", and the class setup has no material like that now.`
      : 'The file does not say which material it is for (files from the student page do).';
    return `<section class="card page-card result bad">${title}<p class="verdict bad">Pick the material</p>
      <p class="note">${esc(why)} Pick the board that is on the machine in <strong>Material</strong> above, and the file is checked again.</p></section>`;
  }
  const r = checkGcode(text, checkLimits(config, material));
  const board = `${material.label}, ${material.t} mm thick, ${material.w} x ${material.h} mm`;
  const mismatch = chosen && named.claim && named.material !== chosen
    ? `<p class="safety"><strong>Different material:</strong> the file says it was made for ${esc(named.claim)}.</p>` : '';
  const frame = /FRAME CHECK/.test(text.slice(0, 400));
  if (!r.ok) {
    const reasons = r.errors.map((e) => `<li>${e.line ? `Line ${fmt(e.line)}: ` : ''}${esc(e.message)}</li>`).join('');
    return `<section class="card page-card result bad">${title}<p class="verdict bad">✖ Do not run this file</p>
      <p class="note">Checked for ${esc(board)}. It breaks the class limits here${r.errors.length >= 20 ? ' (the first 20 problems)' : ''}:</p>
      <ul class="reasons">${reasons}</ul>${mismatch}
      <p class="note">Ask the student to make the file again on the student page, which only makes files that pass.</p></section>`;
  }
  const s = r.stats;
  const cut = Number.isFinite(s.box.minX)
    ? `X ${fmt(s.box.minX, 1)} to ${fmt(s.box.maxX, 1)}, Y ${fmt(s.box.minY, 1)} to ${fmt(s.box.maxY, 1)} mm` : 'none (it never goes into the wood)';
  return `<section class="card page-card result ok">${title}<p class="verdict ok">✔ OK to run${frame ? ' (frame check, router off)' : ''}</p>
    <p class="note">Checked for ${esc(board)}, zero at the front-left corner, top of the board. Make sure that board is the one on the machine.</p>${mismatch}
    <dl class="facts">
      <dt>Lines</dt><dd>${fmt(s.lines)}</dd>
      <dt>Deepest</dt><dd>${fmt(-s.minZ, 2)} mm</dd>
      <dt>Fastest feed</dt><dd>${fmt(s.maxFeed)} mm/min (class limit ${fmt(Math.max(material.feed, material.plunge))})</dd>
      <dt>Cut area</dt><dd>${esc(cut)}</dd>
    </dl></section>`;
}

function render() {
  $('#results').innerHTML = last.map(resultCard).join('');
}

async function openFiles(files) {
  if (!config || !files.length) return;
  const read = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) {
      read.push({ name: f.name, text: '', tooBig: true });
      continue;
    }
    read.push({ name: f.name, text: await f.text() });
  }
  last = read;
  render();
}

$('#pick').addEventListener('click', () => $('#files').click());
$('#files').addEventListener('change', (e) => {
  openFiles([...e.target.files]);
  e.target.value = '';
});
$('#material').addEventListener('change', render);

const zone = $('#dropZone');
for (const t of ['dragenter', 'dragover']) {
  document.addEventListener(t, (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
    e.preventDefault();
    zone.classList.add('over');
  });
}
document.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) zone.classList.remove('over');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.classList.remove('over');
  openFiles([...(e.dataTransfer?.files ?? [])]);
});

loadConfig();
