// The student page: open a drawing, place it, give each line a job, preview, download a .nc file.
// Everything happens in this browser; the server only hands out the teacher's class setup.

import './style.css';
import { initThemeButton, isDark, onThemeChange } from './theme.js';
import { $, el, esc, fmt } from './dom.js';
import { BoardView, fmtLen } from './board-view.js';
import { importSvg } from './svg-import.js';
import { carveImage } from './carve-preview.js';
import { textLines } from './text.js';
import { loadDesign, saveDesign } from './design-store.js';
import { SHAPES } from '../../shared/shapes.js';
import {
  cloneForCopy, designShapes, designTabPoints, doorSignPart, fitOnBoard, gridSpots, keychainPart, makePart, ornamentPart, partBounds, partSize, placeOnBoard, revivePart, snapshot, toBoard, toLocal, withBorder,
} from '../../shared/design.js';
import { estimateSeconds, JOB_LABELS, planCut } from '../../shared/cam.js';
import { cutArea, writeFrameGcode, writeGcode } from '../../shared/gcode.js';
import { checkGcode } from '../../shared/check-gcode.js';
import {
  BITS, DEFAULT_CLASS_CONFIG, MACHINES, ROUTERS, checkLimits, clampRects, cutRules, ncFileName, rpmFor, validateClassConfig,
} from '../../shared/settings.js';

const MATERIAL_KEY = 'umc.material';
const HISTORY_MAX = 80;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
// These stop the Preview: the file would be wrong or unsafe.
const BLOCKING = new Set(['offBoard', 'empty', 'tabs', 'noTabs', 'clamp']);

const JOB_HELP = {
  cutout: 'Cuts around the outside and frees the part',
  hole: 'Cuts inside the line, all the way through',
  engrave: 'Bit follows the line, not deep',
  pocket: 'Digs out the inside to a depth',
  skip: 'Leave this line alone',
};
const CLOSED_ONLY = new Set(['cutout', 'hole', 'pocket']);

const state = {
  config: DEFAULT_CLASS_CONFIG,
  materialId: null,
  parts: [],
  selected: null, // { partId, lines: Set<number> }
  stage: 'design',
  plan: null,
  result: null, // preview: { gcode, check, seconds, image }
  past: [],
  future: [],
  fileName: '',
  showPath: false,
};

// ---- class setup ----
function material() {
  return state.config.materials.find((m) => m.id === state.materialId) ?? state.config.materials[0];
}
function board() {
  const m = material();
  return { w: m.w, h: m.h, t: m.t };
}
function bit() {
  return BITS[state.config.bit];
}
function rules() {
  return cutRules(state.config, material());
}
function allowed(job) {
  return job === 'skip' || state.config.jobs[job] !== false;
}

async function loadConfig() {
  try {
    const r = await fetch('/api/class', { cache: 'no-store' });
    if (r.ok) {
      const v = validateClassConfig(await r.json());
      if (v.ok) state.config = v.config;
    }
  } catch {
    // offline or dev without the Worker: the defaults work
  }
  let saved = null;
  try {
    saved = localStorage.getItem(MATERIAL_KEY);
  } catch { /* storage blocked */ }
  state.materialId = state.config.materials.some((m) => m.id === saved) ? saved : state.config.materials[0].id;
}

// ---- undo ----
function record() {
  state.past.push({ parts: snapshot(state.parts) });
  if (state.past.length > HISTORY_MAX) state.past.shift();
  state.future = [];
}
function restore(from, to) {
  const s = from.pop();
  if (!s) return;
  to.push({ parts: snapshot(state.parts) });
  state.parts = s.parts.map((p) => ({ ...p, jobs: p.jobs.slice() }));
  if (state.selected && !state.parts.some((p) => p.id === state.selected.partId)) state.selected = null;
  changed();
}
const undo = () => restore(state.past, state.future);
const redo = () => restore(state.future, state.past);

// ---- parts ----
function selectedPart() {
  return state.parts.find((p) => p.id === state.selected?.partId) ?? null;
}

// Jobs the teacher turned off become Engrave (or Don't cut); open lines can only be engraved.
function fixJobs(part) {
  part.jobs = part.jobs.map((j, i) => {
    let job = j;
    if (!part.lines[i].closed && CLOSED_ONLY.has(job)) job = 'engrave';
    if (!allowed(job)) job = allowed('engrave') ? 'engrave' : 'skip';
    return job;
  });
  return part;
}

// How far lines must stay from the board edge: the margin, plus a whole bit width (a cut out runs
// the bit's centre one radius outside the line, and its edge one more radius out).
function keepOut() {
  return state.config.marginMm + bit().diameter + 0.2;
}

function addPart(part) {
  record();
  fixJobs(part);
  placeOnBoard(part, board(), keepOut());
  // Do not stack new parts exactly on top of each other.
  while (state.parts.some((p) => Math.abs(p.x - part.x) < 0.5 && Math.abs(p.y - part.y) < 0.5)) {
    part.x += 10;
    part.y -= 10;
  }
  fitOnBoard(part, board(), keepOut());
  state.parts.push(part);
  state.selected = { partId: part.id, lines: new Set(part.lines.map((_, i) => i)) };
  changed();
}

// The part a board point belongs to: the smallest one whose box (grown by the bit and a little)
// holds it. Tabs sit on the bit's path, just outside the drawn line.
function partAt(pt) {
  const pad = bit().diameter + 5;
  let best = null;
  for (const p of state.parts) {
    const b = partBounds(p);
    if (pt[0] < b.minX - pad || pt[0] > b.maxX + pad || pt[1] < b.minY - pad || pt[1] > b.maxY + pad) continue;
    if (!best || b.w * b.h < best.a) best = { p, a: b.w * b.h };
  }
  return best?.p ?? null;
}

// A tab was dragged: every tab of that cut line becomes a placed tab (so the others stay where
// they are), with the dragged one at its new spot. The planner snaps them onto the line.
function moveTab(i, at) {
  const tabs = state.plan?.tabs ?? [];
  const t = tabs[i];
  if (!t) return;
  const same = tabs.filter((x) => x.loop === t.loop);
  const snap = 1; // the planner reports each tab exactly where it put the stored point
  const part = partAt([t.x, t.y]);
  if (!part) return;
  record();
  // Drop this line's old placed tabs, keep the part's tabs on its other lines.
  const others = (part.tabs ?? []).filter((q) => {
    const [bx, by] = toBoard(part, [q])[0];
    return !same.some((x) => Math.hypot(bx - x.x, by - x.y) <= snap);
  });
  const pts = same.map((x) => (x === t ? at : [x.x, x.y]));
  part.tabs = [...others, ...pts.map((pt) => toLocal(part, pt))];
  changed();
}

// A class set: the picked part and copies of it in rows from the front-left corner, clear of the
// board edge and the clamps. The gap leaves room for the bit between parts.
function makeCopies(n) {
  const part = selectedPart();
  if (!part) return 0;
  const gap = bit().diameter * 2 + 2;
  const spots = gridSpots(part, n, board(), keepOut(), gap, clampRects(material()), bit().diameter + 2);
  if (!spots.length) return 0;
  record();
  const others = state.parts.filter((p) => p !== part);
  const set = spots.map((spot, i) => {
    const p = i === 0 ? part : cloneForCopy(part);
    p.x = spot.x;
    p.y = spot.y;
    return p;
  });
  state.parts = [...others, ...set];
  state.selected = { partId: part.id, lines: new Set(part.lines.map((_, i) => i)) };
  changed();
  return spots.length;
}

function deleteSelected() {
  const part = selectedPart();
  if (!part) return;
  record();
  state.parts = state.parts.filter((p) => p !== part);
  state.selected = null;
  changed();
}

function copySelected() {
  const part = selectedPart();
  if (!part) return;
  const copy = cloneForCopy(part);
  record();
  const b = partBounds(part);
  copy.x += Math.min(b.w + 5, 30);
  state.parts.push(copy);
  state.selected = { partId: copy.id, lines: new Set(copy.lines.map((_, i) => i)) };
  changed();
}

function setJob(job) {
  const part = selectedPart();
  if (!part || !state.selected.lines.size || !allowed(job)) return;
  record();
  for (const i of state.selected.lines) {
    if (CLOSED_ONLY.has(job) && !part.lines[i].closed) continue;
    part.jobs[i] = job;
  }
  changed();
}

function transformSelected(changes) {
  const part = selectedPart();
  if (!part) return;
  record();
  Object.assign(part, changes);
  changed();
}

async function openFiles(files) {
  for (const file of files) {
    if (!/\.svg$/i.test(file.name) && file.type !== 'image/svg+xml') {
      toast(`${file.name}: only SVG drawings can be opened. Save it as SVG first.`, 'bad');
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name} is too big (the most is 8 MB).`, 'bad');
      continue;
    }
    busy('Reading your drawing…');
    try {
      const { lines, notes } = importSvg(await file.text());
      const part = makePart({ name: file.name.replace(/\.svg$/i, ''), kind: 'svg', lines });
      addPart(part);
      const s = partSize(part);
      if (Math.max(s.w, s.h) < 5) toast('That drawing is tiny. Drag a corner to make it bigger.', 'warn');
      if (part.scale < 1) toast(`It was too big for the board, so it was shrunk to ${Math.round(part.scale * 100)}%.`);
      for (const n of notes) toast(n, 'warn');
    } catch (e) {
      toast(`${file.name}: ${e.message}`, 'bad');
    } finally {
      busy(null);
    }
  }
}

async function addText(text, font, heightMm) {
  const lines = await textLines(font, text, heightMm);
  addPart(makePart({ name: text, kind: 'text', lines, fill: 'nonzero' }));
}

function addBorder() {
  const part = selectedPart();
  if (!part) return;
  const bordered = withBorder(part, 4);
  if (!bordered) {
    toast('A border needs closed shapes to go around.', 'warn');
    return;
  }
  record();
  const shrunk = bordered.scale;
  fitOnBoard(bordered, board(), keepOut());
  if (bordered.scale < shrunk) toast(`With the border it was too big for the board, so it was shrunk to ${Math.round((bordered.scale / shrunk) * 100)}%.`);
  state.parts = state.parts.map((p) => (p === part ? fixJobs(bordered) : p));
  state.selected = { partId: part.id, lines: new Set([bordered.lines.length - 1]) };
  changed();
  toast('Border added: it gets cut out, the inside is now a pocket. Click the letters to make them Engrave instead.');
}

function addShape(key) {
  const def = SHAPES[key];
  addPart(makePart({ name: def.label, kind: 'shape', lines: def.make(), flipY: false }));
}

// ---- planning ----
let planTimer = 0;
function schedulePlan() {
  clearTimeout(planTimer);
  planTimer = setTimeout(planNow, 250);
}

// The planner runs in a Web Worker. A newer request stops an older one that is still running
// (a fresh worker is cheap), so only the latest design is ever planned.
let worker = null;
let inFlight = null; // { id, resolve, reject }
let planId = 0;

function startWorker() {
  try {
    worker = new Worker(new URL('./plan-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const job = inFlight;
      if (!job || e.data.id !== job.id) return;
      inFlight = null;
      if (e.data.ok) job.resolve(e.data.plan);
      else job.reject(new Error(e.data.error));
    };
    worker.onerror = () => {
      const job = inFlight;
      inFlight = null;
      job?.reject(new Error('planner stopped'));
    };
  } catch {
    worker = null; // no workers here: plan on the page instead
  }
}

function planInWorker(args) {
  if (inFlight) {
    worker?.terminate();
    inFlight.reject(new Error('superseded'));
    inFlight = null;
    startWorker();
  }
  if (!worker) startWorker();
  if (!worker) return Promise.resolve(planCut(args));
  return new Promise((resolve, reject) => {
    inFlight = { id: ++planId, resolve, reject };
    worker.postMessage({ id: planId, args });
  });
}

/** Plan the current design; resolves with the plan (null if a newer plan replaced this one). */
async function planNow() {
  clearTimeout(planTimer);
  planTimer = 0;
  const r = rules();
  const args = { shapes: designShapes(state.parts, r.pocketDepth), board: board(), bit: bit(), cut: { ...r, tabPoints: designTabPoints(state.parts) } };
  let plan;
  try {
    plan = await planInWorker(args);
  } catch (e) {
    if (e.message === 'superseded') return null;
    plan = planCut(args); // the worker failed: do it here
  }
  state.plan = plan;
  view.setWarnings(plan.warnings);
  view.setTabs(plan.tabs ?? []);
  renderAction();
  return plan;
}

let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDesign({ parts: state.parts, fileName: state.fileName }), 800);
}
// Closing or reloading the tab saves at once, not 0.8 s later.
addEventListener('pagehide', () => {
  clearTimeout(saveTimer);
  saveDesign({ parts: state.parts, fileName: state.fileName });
});

function changed() {
  state.result = null;
  scheduleSave();
  if (state.stage === 'preview') setStage('design');
  view.setParts(state.parts, state.selected);
  renderPanel();
  renderAction();
  $('#empty').hidden = state.parts.length > 0;
  document.body.classList.toggle('is-empty', !state.parts.length);
  $('#undoBtn').disabled = !state.past.length;
  $('#redoBtn').disabled = !state.future.length;
  $('#clearBtn').disabled = !state.parts.length;
  schedulePlan();
}

// ---- stages ----
async function setStage(stage) {
  if (stage === 'preview') {
    busy('Making your cut file…');
    try {
      const plan = await planNow();
      if (!plan) return; // the design changed meanwhile
      const stop = plan.warnings.find((w) => BLOCKING.has(w.code));
      if (stop) {
        toast(stop.message, 'bad');
        return;
      }
      buildResult(plan);
      state.stage = 'preview';
      showStage();
    } finally {
      busy(null);
    }
    return;
  }
  state.stage = 'design';
  showStage();
}

function frameFileName() {
  return ncFileName(state.fileName).replace(/\.nc$/, '-frame.nc');
}

function buildResult(plan) {
  const m = material();
  const b = bit();
  const feeds = { feed: m.feed, plunge: m.plunge, rpm: rpmFor(state.config, m) };
  if (!state.fileName) state.fileName = state.parts[0]?.name ?? '';
  const name = ncFileName(state.fileName);
  const notes = [
    `uploadmycut ${name}`,
    `Material ${m.label} ${m.t} mm, board ${m.w} x ${m.h} mm`,
    `Bit ${b.label}`,
    'Zero X0 Y0 front-left corner, Z0 top of board',
    `Router ${ROUTERS[state.config.router].label} dial ${m.dial}`,
  ];
  const gcode = writeGcode({ moves: plan.moves, feeds, safeZ: state.config.safeZ, notes });
  const check = checkGcode(gcode, checkLimits(state.config, m));
  const seconds = estimateSeconds(plan.moves, feeds);
  const image = carveImage(plan.moves, board(), plan.bitRadius, { dark: isDark() });
  // The frame check (uploadmylaser's lesson: frame before every job): router off, trace the cut area.
  const box = cutArea(plan.moves, plan.bitRadius, board());
  const frame = box
    ? writeFrameGcode({
      box,
      safeZ: state.config.safeZ,
      feed: m.feed,
      notes: [`uploadmycut ${frameFileName()} FRAME CHECK`, 'Router OFF. The bit traces the cut area in the air', notes[3]],
    })
    : null;
  const frameCheck = frame ? checkGcode(frame, checkLimits(state.config, m)) : null;
  state.result = { gcode, check, seconds, image, feeds, frame, frameCheck };
}

function showStage() {
  const preview = state.stage === 'preview';
  for (const b of document.querySelectorAll('.stage')) {
    const on = b.dataset.stage === state.stage;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'step');
    else b.removeAttribute('aria-current');
  }
  $('#panel').hidden = preview;
  $('#previewPanel').hidden = !preview;
  $('.open-group').hidden = preview;
  view.setMode(state.stage, preview ? { moves: state.plan.moves, image: state.result.image, showPath: state.showPath } : null);
  if (preview) renderPreview();
  renderAction();
}

// ---- rendering ----
function renderPanel() {
  const panel = $('#panel');
  const m = material();
  const b = bit();
  const part = selectedPart();
  const sel = state.selected;
  let html = `
    <div class="section">
      <h2>Board</h2>
      <dl class="facts">
        <dt>Material</dt><dd>${esc(m.label)}</dd>
        <dt>Size</dt><dd>${fmt(m.w)} × ${fmt(m.h)} mm</dd>
        <dt>Thickness</dt><dd>${fmt(m.t, 1)} mm (${fmt(m.t / 25.4, 2)} in)</dd>
        <dt>Bit</dt><dd>${esc(b.short)}</dd>
      </dl>
      ${state.config.note ? `<p class="teacher-note">${esc(state.config.note)}</p>` : ''}
    </div>`;
  if (!part) {
    html += `<div class="section"><h2>Your drawing</h2><p class="note">${state.parts.length
      ? 'Click a line on the board to pick it. Then give it a job.'
      : 'Open a drawing or pick a shape to start.'}</p></div>`;
  } else {
    const size = partSize(part);
    const picked = sel.lines.size;
    const jobsOfPicked = new Set([...sel.lines].map((i) => part.jobs[i]));
    const allOpen = [...sel.lines].every((i) => !part.lines[i].closed);
    html += `
      <div class="section">
        <div class="row"><h2 class="grow">Selected</h2><button id="deselect" class="linkbtn" type="button">✕</button></div>
        <div class="part-name" title="${esc(part.name)}">${esc(part.name)}</div>
        <div class="fields">
          <label class="field"><span class="field-label">W</span><input id="fW" type="number" min="1" step="0.5" value="${fmt(size.w, 1).replace(/,/g, '')}"><span class="field-unit">mm</span></label>
          <label class="field"><span class="field-label">H</span><input id="fH" type="number" min="1" step="0.5" value="${fmt(size.h, 1).replace(/,/g, '')}"><span class="field-unit">mm</span></label>
          <label class="field"><span class="field-label">Turn</span><input id="fR" type="number" step="5" value="${Math.round(part.rotation)}"><span class="field-unit">°</span></label>
          <button id="centre" type="button" title="Put it in the middle of the board">Centre</button>
        </div>
        <div class="tool-row">
          <button id="border" type="button" title="Add an outline 4 mm around it, to cut out (name keychains)">▢ Border</button>
          <button id="copies" type="button" title="Make a class set: copies in rows across the board">▦ Copies</button>
          <button id="mirror" type="button" title="Flip left to right">⇋ Flip</button>
          <button id="rot90" type="button" title="Turn a quarter">⟳ 90°</button>
          <button id="copy" type="button" title="Copy (Ctrl+D)">⧉ Copy</button>
          <button id="delete" class="danger" type="button" title="Delete (Delete key)">🗑 Delete</button>
        </div>
      </div>
      <div class="section">
        <div class="row"><h2 class="grow">Job</h2><span class="note">${picked} of ${part.lines.length} line${part.lines.length === 1 ? '' : 's'}</span></div>
        <div class="jobs" role="group" aria-label="Job for the picked lines">
          ${['cutout', 'hole', 'engrave', 'pocket', 'skip'].map((j) => {
            const off = !allowed(j) ? 'Your teacher turned this off.' : (CLOSED_ONLY.has(j) && allOpen ? 'Only for closed shapes. This line has open ends.' : '');
            const on = jobsOfPicked.size === 1 && jobsOfPicked.has(j);
            return `<button class="job ${j}${on ? ' on' : ''}" type="button" data-job="${j}" aria-pressed="${on}" ${off ? `disabled title="${esc(off)}"` : ''}>
              <span class="swatch" aria-hidden="true"></span><span>${JOB_LABELS[j]}<small>${JOB_HELP[j]}</small></span></button>`;
          }).join('')}
        </div>
        ${picked < part.lines.length ? '<button id="pickAll" class="linkbtn" type="button">Pick all lines of this drawing</button>' : ''}
        ${part.tabs?.length ? '<button id="resetTabs" class="linkbtn" type="button" title="Let the planner place the tabs again">↺ Reset tabs</button>' : ''}
      </div>`;
    if (part.jobs.includes('pocket')) {
      const max = Math.max(0.5, Math.min(state.config.pocketMaxDepth, m.t - 1));
      const depth = Math.min(part.pocketDepth ?? rules().pocketDepth, max);
      html += `
        <div class="section">
          <label class="slider"><span>Pocket depth</span><output id="pdOut">${fmt(depth, 1)} mm</output>
            <input id="pocketDepth" type="range" min="0.5" max="${max}" step="0.5" value="${depth}"></label>
        </div>`;
    }
  }
  panel.innerHTML = html;
  bindPanel(part);
}

function bindPanel(part) {
  if (!part) return;
  const on = (id, ev, fn) => $(`#${id}`)?.addEventListener(ev, fn);
  on('deselect', 'click', () => {
    state.selected = null;
    changed();
  });
  const size = () => partSize(part);
  on('fW', 'change', (e) => {
    const v = Number(e.target.value);
    if (v > 0) transformSelected({ scale: (part.scale * v) / size().w });
  });
  on('fH', 'change', (e) => {
    const v = Number(e.target.value);
    if (v > 0) transformSelected({ scale: (part.scale * v) / size().h });
  });
  on('fR', 'change', (e) => transformSelected({ rotation: ((Number(e.target.value) % 360) + 360) % 360 }));
  on('centre', 'click', () => {
    const b = board();
    const pb = partBounds(part);
    transformSelected({ x: part.x + b.w / 2 - (pb.minX + pb.maxX) / 2, y: part.y + b.h / 2 - (pb.minY + pb.maxY) / 2 });
  });
  on('border', 'click', addBorder);
  on('copies', 'click', () => {
    $('#copiesError').hidden = true;
    $('#copiesDialog').showModal();
    $('#copiesCount').focus();
  });
  on('mirror', 'click', () => transformSelected({ mirror: !part.mirror }));
  on('rot90', 'click', () => transformSelected({ rotation: (part.rotation + 90) % 360 }));
  on('copy', 'click', copySelected);
  on('delete', 'click', deleteSelected);
  on('resetTabs', 'click', () => transformSelected({ tabs: null }));
  on('pickAll', 'click', () => {
    state.selected = { partId: part.id, lines: new Set(part.lines.map((_, i) => i)) };
    changed();
  });
  for (const b of document.querySelectorAll('#panel [data-job]')) b.addEventListener('click', () => setJob(b.dataset.job));
  const pd = $('#pocketDepth');
  if (pd) {
    pd.addEventListener('input', () => {
      $('#pdOut').textContent = `${fmt(Number(pd.value), 1)} mm`;
    });
    pd.addEventListener('change', () => transformSelected({ pocketDepth: Number(pd.value) }));
  }
}

function renderAction() {
  const box = $('#action');
  if (state.stage === 'preview') {
    box.innerHTML = `<button id="back" type="button">◀ Back to design</button>
      <div class="msgs"><div class="msg">Nothing is sent to the machine. Download the file and give it to your teacher.</div></div>`;
    $('#back').addEventListener('click', () => setStage('design'));
    return;
  }
  const w = state.parts.length ? state.plan?.warnings ?? [] : [];
  const blocking = w.some((x) => BLOCKING.has(x.code));
  const msgs = !state.parts.length
    ? '<div class="msg">Open a drawing or pick a shape.</div>'
    : w.length
      ? w.map((x) => `<div class="msg ${BLOCKING.has(x.code) ? 'bad' : 'warn'}"><b>${BLOCKING.has(x.code) ? '✕' : '⚠'}</b><span>${esc(x.message)}</span></div>`).join('')
      : '<div class="msg ok"><b>✓</b><span>Ready. Every line has a job the bit can do.</span></div>';
  box.innerHTML = `<div class="msgs">${msgs}</div>
    <button id="go" class="primary big" type="button" ${!state.parts.length || blocking ? 'disabled' : ''}>Preview cut ▶</button>`;
  $('#go').addEventListener('click', () => setStage('preview'));
}

function fmtTime(s) {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

function renderPreview() {
  const r = state.result;
  const m = material();
  const deep = state.plan.moves.filter((v) => v.z < 0);
  const depth = deep.length ? -Math.min(...deep.map((v) => v.z)) : 0;
  const box = $('#previewPanel');
  box.innerHTML = `
    <div class="section">
      <h2>Your cut</h2>
      <div class="result-big">about ${fmtTime(r.seconds)}</div>
      <dl class="facts">
        <dt>Deepest</dt><dd>${fmt(depth, 1)} mm</dd>
        <dt>Bit</dt><dd>${esc(bit().short)}</dd>
        <dt>Material</dt><dd>${esc(m.label)}, ${fmt(m.t, 1)} mm</dd>
        <dt>Lines</dt><dd>${fmt(r.gcode.split('\n').length)}</dd>
      </dl>
      <label class="check"><input id="showPath" type="checkbox" ${state.showPath ? 'checked' : ''}> Show the bit's path</label>
    </div>
    <div class="section">
      ${r.check.ok
        ? '<div class="msg ok"><b>✓</b><span>Passed the class limits check: on the board, not too deep, class speeds. That does not make a cut safe: your teacher checks it and stays at the machine.</span></div>'
        : `<div class="msg bad"><b>✕</b><span>The file did not pass the safety check. Tell your teacher:<br>${r.check.errors.map((e) => esc(`line ${e.line}: ${e.message}`)).join('<br>')}</span></div>`}
      <label class="name-field">File name
        <input id="fileName" type="text" maxlength="40" value="${esc(state.fileName)}" placeholder="my-cut" spellcheck="false"></label>
      <button id="download" class="primary big wide" type="button" ${r.check.ok ? '' : 'disabled'}>⬇ Download ${esc(ncFileName(state.fileName))}</button>
      <button id="downloadFrame" class="wide" type="button" ${r.check.ok && r.frameCheck?.ok ? '' : 'disabled'}>⬚ Frame check: ${esc(frameFileName())}</button>
      <p class="note">The frame check file moves the bit around the cut area high in the air, router off, so your teacher sees where it cuts before the real file runs.</p>
    </div>
    <div class="section">
      <h2>For the teacher</h2>
      <ol class="steps">
        <li>Clamp or tape the board: ${esc(m.label)} (${fmt(m.w)} × ${fmt(m.h)} mm). Clamps stay out of the cut.</li>
        <li>Put in the ${esc(bit().short)}.</li>
        <li>Carbide Motion: Load File, then zero X and Y on the <strong>front-left corner</strong> and Z on the <strong>top</strong> of the board.</li>
        <li><strong>Frame first:</strong> run <code>${esc(frameFileName())}</code> with the router off. The bit traces the cut area ${esc(String(state.config.safeZ))} mm above the board. Check it stays on the board and clears every clamp.</li>
        <li>Router dial <strong>${esc(String(m.dial))}</strong>. Start the job, switch on the router when asked.</li>
      </ol>
      <p class="safety"><strong>Stay at the machine.</strong> Eye and ear protection on. Pause or stop in Carbide Motion does not stop the router: switch the router off too.</p>
    </div>`;
  $('#showPath').addEventListener('change', (e) => {
    state.showPath = e.target.checked;
    view.setMode('preview', { moves: state.plan.moves, image: state.result.image, showPath: state.showPath });
  });
  $('#fileName').addEventListener('input', (e) => {
    state.fileName = e.target.value;
    scheduleSave();
    $('#download').textContent = `⬇ Download ${ncFileName(state.fileName)}`;
    $('#downloadFrame').textContent = `⬚ Frame check: ${frameFileName()}`;
  });
  $('#download').addEventListener('click', download);
  $('#downloadFrame').addEventListener('click', () => download('frame'));
}

function download(which = 'cut') {
  // Rebuild the header with the name as typed now.
  buildResult(state.plan);
  const frame = which === 'frame';
  if (!state.result.check.ok || (frame && !state.result.frameCheck?.ok)) {
    renderPreview();
    return;
  }
  const name = frame ? frameFileName() : ncFileName(state.fileName);
  const text = frame ? state.result.frame : state.result.gcode;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast(frame ? `Saved ${name}. Your teacher runs it first, router off.` : `Saved ${name}. Give it to your teacher.`);
}

// ---- small UI helpers ----
function toast(text, kind = '') {
  const t = el('div', { class: `toast ${kind}`, role: kind === 'bad' ? 'alert' : 'status' }, text);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 5000);
}

function busy(text) {
  $('#busy').hidden = !text;
  if (text) $('#busyText').textContent = text;
}

function renderMaterials() {
  const sel = $('#material');
  sel.innerHTML = state.config.materials
    .map((m) => `<option value="${esc(m.id)}">${esc(m.label)} · ${fmt(m.t, 1)} mm</option>`).join('');
  sel.value = state.materialId;
  $('#bitText').textContent = `${MACHINES[state.config.machine].label.replace(/ \(standard\)/, '')} · ${bit().short}`;
}

// ---- start ----
const view = new BoardView($('#board'), {
  onPick(hit, additive) {
    if (!hit) {
      if (state.selected) {
        state.selected = null;
        changed();
      }
      return;
    }
    if (additive && state.selected?.partId === hit.part.id) {
      const lines = new Set(state.selected.lines);
      if (lines.has(hit.line) && lines.size > 1) lines.delete(hit.line);
      else lines.add(hit.line);
      state.selected = { partId: hit.part.id, lines };
    } else {
      state.selected = { partId: hit.part.id, lines: new Set([hit.line]) };
    }
    view.setParts(state.parts, state.selected);
    renderPanel();
  },
  onTransformStart: () => record(),
  onTransform(part, changes) {
    Object.assign(part, changes);
    view.setTabs([]); // the markers come back with the next plan
    state.result = null;
    view.setParts(state.parts, state.selected);
  },
  onTransformEnd: () => changed(),
  onTabMoved: (i, at) => moveTab(i, at),
});

initThemeButton($('#theme'));
onThemeChange(() => {
  if (state.stage === 'preview' && state.plan) {
    state.result.image = carveImage(state.plan.moves, board(), state.plan.bitRadius, { dark: isDark() });
    view.setMode('preview', { moves: state.plan.moves, image: state.result.image, showPath: state.showPath });
  }
});

$('#open').addEventListener('click', () => $('#fileInput').click());
$('#emptyOpen').addEventListener('click', () => $('#fileInput').click());
$('#emptyShape').addEventListener('click', () => addShape('tag'));
$('#fileInput').addEventListener('change', (e) => {
  openFiles([...e.target.files]);
  e.target.value = '';
});
let textMode = 'text'; // 'text' | 'keychain' | 'sign': what the text dialog makes
const TEXT_MODES = {
  text: { title: 'Add text', button: 'Add text', font: null, height: null },
  keychain: { title: 'Name keychain', button: 'Make keychain', font: 'script', height: 22 },
  sign: { title: 'Door sign', button: 'Make sign', font: 'block', height: 26 },
};
function openTextDialog(mode) {
  textMode = mode;
  const m = TEXT_MODES[mode];
  $('#textTitle').textContent = m.title;
  $('#textOk').textContent = m.button;
  if (m.font) $(`input[name="font"][value="${m.font}"]`).checked = true;
  if (m.height) $('#textHeight').value = m.height;
  $('#textError').hidden = true;
  $('#textDialog').showModal();
  $('#textInput').focus();
}
$('#textBtn').addEventListener('click', () => openTextDialog('text'));
$('#textForm').addEventListener('submit', async (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const text = $('#textInput').value.trim();
  if (!text) return;
  const font = new FormData($('#textForm')).get('font');
  const height = Math.min(150, Math.max(8, Number($('#textHeight').value) || 25));
  busy('Making letters…');
  try {
    if (textMode === 'text') await addText(text, font, height);
    else {
      const lines = await textLines(font, text, height);
      addPart(fixJobs(textMode === 'keychain' ? keychainPart(text, lines) : doorSignPart(text, lines)));
      toast(textMode === 'keychain'
        ? 'Keychain made: the name is a pocket, the outline is cut out, and it has a keyring hole.'
        : 'Door sign made: the name is a pocket, with a screw hole at each end.');
    }
    $('#textDialog').close();
  } catch (err) {
    $('#textError').textContent = err.message;
    $('#textError').hidden = false;
  } finally {
    busy(null);
  }
});
$('#copiesForm').addEventListener('submit', (e) => {
  if (e.submitter?.value !== 'ok') return;
  e.preventDefault();
  const n = Math.min(60, Math.max(2, Math.round(Number($('#copiesCount').value) || 2)));
  const made = makeCopies(n);
  if (!made) {
    $('#copiesError').textContent = 'It is too big for even one spot clear of the edges and clamps. Make it smaller.';
    $('#copiesError').hidden = false;
    return;
  }
  $('#copiesDialog').close();
  toast(made < n ? `Only ${made} fit on this board (you asked for ${n}). Make it smaller to fit more.` : `${made} on the board, in rows.`, made < n ? 'warn' : '');
});
$('#undoBtn').addEventListener('click', undo);
$('#fitBtn').addEventListener('click', () => view.fit(true));
$('#clearBtn').addEventListener('click', () => {
  if (!state.parts.length) return;
  record();
  state.parts = [];
  state.selected = null;
  state.fileName = '';
  changed();
  toast('Board cleared. Undo (Ctrl+Z) brings it back.');
});
$('#redoBtn').addEventListener('click', redo);
$('#help').addEventListener('click', () => $('#helpDialog').showModal());
for (const b of document.querySelectorAll('.stage')) b.addEventListener('click', () => setStage(b.dataset.stage));

const shapesMenu = $('#shapesMenu');
const PROJECTS = { keychain: 'Name keychain', sign: 'Door sign', ornament: 'Star ornament' };
shapesMenu.innerHTML = '<div class="menu-head">Shapes</div>'
  + Object.entries(SHAPES).map(([k, s]) => `<button type="button" role="menuitem" data-shape="${k}">${esc(s.label)}</button>`).join('')
  + '<div class="menu-head">Projects to start from</div>'
  + Object.entries(PROJECTS).map(([k, label]) => `<button type="button" role="menuitem" data-project="${k}">${esc(label)}</button>`).join('');
const toggleShapes = (open) => {
  shapesMenu.hidden = !open;
  $('#shapesBtn').setAttribute('aria-expanded', String(open));
};
$('#shapesBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  toggleShapes(shapesMenu.hidden);
});
shapesMenu.addEventListener('click', (e) => {
  const b = e.target.closest('[data-shape], [data-project]');
  if (!b) return;
  toggleShapes(false);
  if (b.dataset.shape) addShape(b.dataset.shape);
  else if (b.dataset.project === 'ornament') addPart(fixJobs(ornamentPart()));
  else openTextDialog(b.dataset.project);
});
document.addEventListener('click', () => toggleShapes(false));

$('#material').addEventListener('change', (e) => {
  state.materialId = e.target.value;
  try {
    localStorage.setItem(MATERIAL_KEY, state.materialId);
  } catch { /* storage blocked */ }
  view.setBoard(board(), state.config.marginMm);
  view.setClamps(clampRects(material()));
  changed();
});

// Drag and drop a file anywhere on the stage.
const stageEl = $('#stage');
let dragDepth = 0;
stageEl.addEventListener('dragenter', (e) => {
  if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
  e.preventDefault();
  dragDepth++;
  $('#drop').hidden = false;
});
stageEl.addEventListener('dragover', (e) => {
  if ([...(e.dataTransfer?.types ?? [])].includes('Files')) e.preventDefault();
});
stageEl.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('#drop').hidden = true;
});
stageEl.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('#drop').hidden = true;
  if (state.stage === 'preview') setStage('design');
  openFiles([...(e.dataTransfer?.files ?? [])]);
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea, dialog')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if (ctrl && (k === 'y' || (k === 'z' && e.shiftKey))) {
    e.preventDefault();
    redo();
  } else if (ctrl && k === 'o') {
    e.preventDefault();
    $('#fileInput').click();
  } else if (ctrl && k === 'd') {
    e.preventDefault();
    copySelected();
  } else if (state.stage === 'design' && (e.key === 'Delete' || e.key === 'Backspace')) {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape' && state.selected) {
    state.selected = null;
    changed();
  } else if (state.stage === 'design' && e.key.startsWith('Arrow') && selectedPart()) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const part = selectedPart();
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    transformSelected({ x: part.x + d[0], y: part.y + d[1] });
  }
});

await loadConfig();
renderMaterials();
view.setBoard(board(), state.config.marginMm);
view.setClamps(clampRects(material()));
const saved = await loadDesign();
if (saved) {
  const budget = { points: 400_000 };
  state.parts = saved.parts.map((p) => revivePart(p, budget)).filter(Boolean).map(fixJobs);
  state.fileName = typeof saved.fileName === 'string' ? saved.fileName.slice(0, 40) : '';
  if (state.parts.length) toast('Your design from last time is back. Undo history starts fresh.');
}
changed();
if (new URLSearchParams(location.search).has('debug')) window.umc = {
    state, view, planNow, addShape, addText, openFiles, setStage,
    // Resolves once no plan is waiting or running (browser tests).
    async settled() {
      await new Promise((r) => setTimeout(r, 30));
      while (planTimer || inFlight) await new Promise((r) => setTimeout(r, 30));
    },
  };
