// The teacher page: load the class setup with the teacher key, edit it, save it. The Worker checks
// everything again (shared/settings.js validateClassConfig).

import './style.css';
import './teacher.css';
import { initThemeButton } from './theme.js';
import { $, esc } from './dom.js';
import {
  BITS, CLAMP_LAYOUTS, DEFAULT_CLASS_CONFIG, JOB_KEYS, MACHINES, MATERIAL_KINDS, ROUTERS, STARTING_FEEDS, LIMITS,
} from '../../shared/settings.js';
import { JOB_LABELS } from '../../shared/cam.js';

const KEY = 'umc.teacherKey';
let key = '';
let config = null;

initThemeButton($('#theme'));

const options = (obj, label = (v) => v.label ?? v) => Object.entries(obj).map(([k, v]) => `<option value="${esc(k)}">${esc(label(v))}</option>`).join('');
$('#machine').innerHTML = options(MACHINES);
$('#router').innerHTML = options(ROUTERS);
$('#bit').innerHTML = options(BITS);
$('#jobs').innerHTML = JOB_KEYS.map((j) => `<label class="check"><input type="checkbox" data-job="${j}"> ${esc(JOB_LABELS[j])}</label>`).join('');

async function api(method, body) {
  const r = await fetch('/api/teacher/class', {
    method,
    headers: { 'x-teacher-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

const COLUMN = { clampSize: 'Clamp size mm', t: 'Thickness mm', w: 'Width mm', h: 'Length mm', feed: 'Feed mm/min', plunge: 'Plunge mm/min', depthPerPass: 'Depth per pass mm', dial: 'Router dial' };

function matRow(m, i) {
  const n = i + 1;
  const num = (f, v, step) => `<td><input class="text" type="number" data-f="${f}" step="${step}" value="${esc(String(v))}" aria-label="Material ${n} ${COLUMN[f]}"></td>`;
  return `<tr data-id="${esc(m.id)}">
    <td><input class="text" data-f="label" maxlength="${LIMITS.labelLength}" value="${esc(m.label)}" aria-label="Material ${n} name"></td>
    <td><select data-f="kind" aria-label="Material ${n} kind">${options(MATERIAL_KINDS)}</select></td>
    ${num('t', m.t, 0.1)}${num('w', m.w, 1)}${num('h', m.h, 1)}
    ${num('feed', m.feed, 10)}${num('plunge', m.plunge, 10)}${num('depthPerPass', m.depthPerPass, 0.05)}${num('dial', m.dial, 0.5)}
    <td><select data-f="clampLayout" aria-label="Material ${n} clamps">${options(CLAMP_LAYOUTS)}</select></td>${num('clampSize', m.clampSize ?? 30, 1)}
    <td class="nowrap"><button type="button" data-act="start" title="Fill feed, plunge, per pass and dial for this bit and kind">Starting values</button>
      <button type="button" data-act="del" class="danger" title="Remove">✕</button></td>
  </tr>`;
}

function fill(c) {
  config = c;
  $('#machine').value = c.machine;
  $('#router').value = c.router;
  $('#bit').value = c.bit;
  $('#matRows').innerHTML = c.materials.map(matRow).join('');
  [...$('#matRows').rows].forEach((row, i) => {
    row.querySelector('[data-f="kind"]').value = c.materials[i].kind;
    row.querySelector('[data-f="clampLayout"]').value = c.materials[i].clampLayout ?? 'none';
  });
  for (const cb of document.querySelectorAll('[data-job]')) cb.checked = c.jobs[cb.dataset.job] !== false;
  $('#tabW').value = c.tabs.width;
  $('#tabH').value = c.tabs.height;
  for (const f of ['engraveDepth', 'pocketMaxDepth', 'safeZ', 'throughMm', 'marginMm', 'stepover']) $(`#${f}`).value = c[f];
  $('#climb').checked = c.climb;
  $('#note').value = c.note;
}

function read() {
  const materials = [...$('#matRows').rows].map((row) => {
    const m = { id: row.dataset.id };
    for (const input of row.querySelectorAll('[data-f]')) {
      m[input.dataset.f] = input.type === 'number' ? Number(input.value) : input.value;
    }
    return m;
  });
  const jobs = {};
  for (const cb of document.querySelectorAll('[data-job]')) jobs[cb.dataset.job] = cb.checked;
  const n = (id) => Number($(`#${id}`).value);
  return {
    machine: $('#machine').value,
    router: $('#router').value,
    bit: $('#bit').value,
    materials,
    jobs,
    tabs: { width: n('tabW'), height: n('tabH') },
    engraveDepth: n('engraveDepth'),
    pocketMaxDepth: n('pocketMaxDepth'),
    safeZ: n('safeZ'),
    throughMm: n('throughMm'),
    marginMm: n('marginMm'),
    stepover: n('stepover'),
    climb: $('#climb').checked,
    note: $('#note').value,
  };
}

function say(text, bad = false) {
  const m = $('#saveMsg');
  m.textContent = text;
  m.classList.toggle('bad-text', bad);
}

async function open() {
  const r = await api('GET');
  if (r.status === 401) {
    $('#keyMsg').textContent = 'That key is not right.';
    $('#keyMsg').classList.add('bad-text');
    try {
      sessionStorage.removeItem(KEY);
    } catch { /* blocked */ }
    return;
  }
  if (!r.ok) {
    $('#keyMsg').textContent = r.data.message ?? 'The server did not answer. Try again.';
    return;
  }
  try {
    sessionStorage.setItem(KEY, key);
  } catch { /* blocked */ }
  $('#keyCard').hidden = true;
  $('#setup').hidden = false;
  fill(r.data);
}

$('#keyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  key = $('#key').value.trim();
  open();
});

$('#matRows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const row = b.closest('tr');
  if (b.dataset.act === 'del') {
    if ($('#matRows').rows.length > 1) row.remove();
    return;
  }
  const kind = row.querySelector('[data-f="kind"]').value;
  const start = STARTING_FEEDS[$('#bit').value]?.[kind];
  if (!start) return;
  for (const [f, v] of Object.entries(start)) row.querySelector(`[data-f="${f}"]`).value = v;
  say('Starting values filled in. Save to keep them.');
});

$('#addMat').addEventListener('click', () => {
  const rows = $('#matRows').rows;
  if (rows.length >= LIMITS.materials) return;
  const ids = new Set([...rows].map((r) => r.dataset.id));
  let i = rows.length + 1;
  while (ids.has(`m${i}`)) i++;
  const m = { id: `m${i}`, label: 'New material', kind: 'softwood', t: 12, w: 200, h: 200, ...STARTING_FEEDS[$('#bit').value].softwood };
  $('#matRows').insertAdjacentHTML('beforeend', matRow(m, rows.length));
});

$('#setup').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Saving…');
  const r = await api('PUT', read());
  if (r.ok) {
    fill(r.data);
    say('Saved. Students get it when they reload the page.');
  } else {
    say(`${r.data.message ?? 'Not saved.'} ${(r.data.details ?? []).join(' ')}`, true);
  }
});

$('#reset').addEventListener('click', async () => {
  if (!confirm('Put every class setting back to the defaults?')) return;
  const r = await api('DELETE');
  if (r.ok) {
    fill(r.data ?? DEFAULT_CLASS_CONFIG);
    say('Back to the defaults.');
  } else {
    say(r.data.message ?? 'Could not reset.', true);
  }
});

try {
  key = sessionStorage.getItem(KEY) ?? '';
} catch { /* blocked */ }
if (key) open();
