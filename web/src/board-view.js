// The board on screen: a 2D canvas, seen from above like the machine. Board mm, y up, origin at
// the front-left corner (bottom-left on screen), which is where the teacher zeros the machine.
//
// It draws the parts in their job colours, the red spots the planner warns about, handles to
// move / scale / turn the selected part, and in Preview the carved board and the bit's path.
// It never changes a part itself: drags are reported through callbacks, and main.js applies them
// (so undo sees every change).

import { partMatrix, partBounds, hitTest, toBoard } from '../../shared/design.js';
import { bounds } from '../../shared/geometry.js';
import { isDark, onThemeChange } from './theme.js';

const HANDLE_PX = 9;
const TAB_PX = 6; // tab marker radius on screen
const ROTATE_GAP_PX = 28;

export const JOB_COLOURS = {
  light: { cutout: '#c2410c', hole: '#7e22ce', engrave: '#1d4ed8', pocket: '#0f766e', skip: '#9aa3ad' },
  dark: { cutout: '#fb923c', hole: '#c084fc', engrave: '#60a5fa', pocket: '#2dd4bf', skip: '#6e7681' },
};

function palette() {
  const dark = isDark();
  return {
    dark,
    jobs: dark ? JOB_COLOURS.dark : JOB_COLOURS.light,
    bg: dark ? '#121314' : '#e8ecf1', // same as --bg in style.css
    wood: dark ? '#6f5738' : '#e8cf9f',
    woodEdge: dark ? '#9c7d52' : '#b8935a',
    grid: dark ? 'rgba(255,255,255,.07)' : 'rgba(80,50,10,.10)',
    margin: dark ? 'rgba(255,255,255,.35)' : 'rgba(80,50,10,.35)',
    ink: dark ? '#e6edf3' : '#14181d',
    muted: dark ? '#9198a1' : '#5b6570',
    select: dark ? '#60a5fa' : '#1d4ed8',
    bad: dark ? 'rgba(244,112,103,.55)' : 'rgba(198,40,40,.45)',
    badLine: dark ? '#f47067' : '#c62828',
    rapid: dark ? 'rgba(230,237,243,.35)' : 'rgba(20,24,29,.35)',
  };
}

// Path2D per line, in part-local mm, cached with the (never changing) lines array.
const pathCache = new WeakMap();
function linePaths(part) {
  let paths = pathCache.get(part.lines);
  if (!paths) {
    paths = part.lines.map((l) => {
      const p = new Path2D();
      l.points.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      if (l.closed) p.closePath();
      return p;
    });
    pathCache.set(part.lines, paths);
  }
  return paths;
}

export class BoardView {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'The board, seen from above');
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.board = { w: 200, h: 200, t: 12 };
    this.margin = 6;
    this.parts = [];
    this.selected = null; // { partId, lines: Set<number> }
    this.warnings = [];
    this.clamps = []; // teacher's clamp areas, board rects
    this.tabs = []; // where the planner put each tab: { x, y, loop, placed }
    this.mode = 'design';
    this.preview = null; // { moves, image (canvas), showPath }
    this.view = { s: 1, ox: 0, oy: 0 };
    this.userZoomed = false;
    this.drag = null;
    this.queued = false;

    new ResizeObserver(() => this.resize()).observe(container);
    onThemeChange(() => this.draw());
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e));
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e));
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('dblclick', () => this.fit(true));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize();
  }

  // ---- state from main.js ----
  setBoard(board, margin) {
    this.board = board;
    this.margin = margin;
    if (!this.userZoomed) this.fit();
    this.draw();
  }

  setParts(parts, selected) {
    this.parts = parts;
    this.selected = selected;
    this.draw();
  }

  setClamps(clamps) {
    this.clamps = clamps;
    this.draw();
  }

  setTabs(tabs) {
    this.tabs = tabs;
    this.draw();
  }

  setWarnings(warnings) {
    this.warnings = warnings;
    this.draw();
  }

  setMode(mode, preview = null) {
    this.mode = mode;
    this.preview = preview;
    this.draw();
  }

  // ---- view ----
  resize() {
    const r = this.container.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = `${r.width}px`;
    this.canvas.style.height = `${r.height}px`;
    this.dpr = dpr;
    this.cssW = r.width;
    this.cssH = r.height;
    if (!this.userZoomed) this.fit();
    this.draw();
  }

  /** Board fills the space left between the floating cards. */
  fit(byUser = false) {
    if (byUser) this.userZoomed = false;
    const pad = { l: 96, r: 330, t: 30, b: 118 };
    // Phones: buttons on top, the bottom sheet and action bar take the lower ~half.
    if (this.cssW < 760) Object.assign(pad, { l: 20, r: 12, t: 104, b: this.cssH * 0.4 + 100 });
    const w = Math.max(50, this.cssW - pad.l - pad.r);
    const h = Math.max(50, this.cssH - pad.t - pad.b);
    const s = Math.min(w / this.board.w, h / this.board.h);
    this.view = { s, ox: pad.l + (w - this.board.w * s) / 2, oy: pad.t + (h + this.board.h * s) / 2 };
    this.draw();
  }

  toScreen([x, y]) {
    return [x * this.view.s + this.view.ox, -y * this.view.s + this.view.oy];
  }

  toWorld(sx, sy) {
    return [(sx - this.view.ox) / this.view.s, -(sy - this.view.oy) / this.view.s];
  }

  eventPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ---- drawing ----
  draw() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.paint();
    });
  }

  paint() {
    const { ctx, board, view } = this;
    const c = palette();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    // Board in world coordinates.
    const world = () => ctx.setTransform(this.dpr * view.s, 0, 0, -this.dpr * view.s, this.dpr * view.ox, this.dpr * view.oy);
    world();
    ctx.fillStyle = c.wood;
    ctx.fillRect(0, 0, board.w, board.h);
    if (this.mode === 'preview' && this.preview?.image) {
      ctx.save();
      ctx.scale(1, -1);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.preview.image, 0, -board.h, board.w, board.h);
      ctx.restore();
    } else {
      this.paintGrid(c);
    }
    ctx.lineWidth = 1.5 / view.s;
    ctx.strokeStyle = c.woodEdge;
    ctx.strokeRect(0, 0, board.w, board.h);
    if (this.mode === 'design') {
      ctx.setLineDash([5 / view.s, 5 / view.s]);
      ctx.lineWidth = 1 / view.s;
      ctx.strokeStyle = c.margin;
      ctx.strokeRect(this.margin, this.margin, board.w - 2 * this.margin, board.h - 2 * this.margin);
      ctx.setLineDash([]);
    }

    this.paintClamps(c, world);
    if (this.mode === 'design') {
      for (const part of this.parts) this.paintPart(part, c, world);
      this.paintWarnings(c, world);
      this.paintSelection(c);
      this.paintTabs(c);
    } else {
      if (this.preview?.showPath) this.paintMoves(c, world);
      this.paintWarnings(c, world);
    }
    this.paintLabels(c);
  }

  paintGrid(c) {
    const { ctx, board, view } = this;
    const step = view.s * 10 > 12 ? 10 : 50;
    ctx.beginPath();
    for (let x = step; x < board.w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, board.h);
    }
    for (let y = step; y < board.h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(board.w, y);
    }
    ctx.lineWidth = 1 / view.s;
    ctx.strokeStyle = c.grid;
    ctx.stroke();
  }

  paintPart(part, c, world) {
    const { ctx, view } = this;
    const [a, b, cc, d, e, f] = partMatrix(part);
    world();
    ctx.transform(a, b, cc, d, e, f);
    const paths = linePaths(part);
    const unit = 1 / (view.s * part.scale); // one screen px in part units
    const sel = this.selected?.partId === part.id ? this.selected : null;
    // Pocket fill first (even-odd across the part's pocket lines, so letter centres stay).
    const pocket = new Path2D();
    let anyPocket = false;
    part.lines.forEach((l, i) => {
      if (part.jobs[i] === 'pocket' && l.closed) {
        pocket.addPath(paths[i]);
        anyPocket = true;
      }
    });
    if (anyPocket) {
      ctx.fillStyle = c.jobs.pocket + '55';
      ctx.fill(pocket, 'evenodd');
    }
    part.lines.forEach((l, i) => {
      const job = part.jobs[i];
      const isSel = sel?.lines.has(i);
      ctx.setLineDash(job === 'skip' ? [4 * unit, 4 * unit] : []);
      if (isSel) {
        ctx.lineWidth = 6 * unit;
        ctx.strokeStyle = c.select + '55';
        ctx.stroke(paths[i]);
      }
      ctx.lineWidth = (job === 'cutout' || job === 'hole' ? 2.2 : 1.6) * unit;
      ctx.strokeStyle = c.jobs[job];
      ctx.stroke(paths[i]);
    });
    ctx.setLineDash([]);
  }

  paintClamps(c, world) {
    if (!this.clamps.length) return;
    const { ctx, view } = this;
    world();
    for (const k of this.clamps) {
      ctx.fillStyle = c.dark ? 'rgba(160,170,180,.28)' : 'rgba(60,70,80,.22)';
      ctx.fillRect(k.x, k.y, k.w, k.h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(k.x, k.y, k.w, k.h);
      ctx.clip();
      ctx.beginPath();
      for (let d = -k.h; d < k.w; d += 4) {
        ctx.moveTo(k.x + d, k.y);
        ctx.lineTo(k.x + d + k.h, k.y + k.h);
      }
      ctx.lineWidth = 1 / view.s;
      ctx.strokeStyle = c.dark ? 'rgba(220,225,230,.35)' : 'rgba(40,45,50,.35)';
      ctx.stroke();
      ctx.restore();
      ctx.setLineDash([4 / view.s, 3 / view.s]);
      ctx.lineWidth = 1.2 / view.s;
      ctx.strokeStyle = c.muted;
      ctx.strokeRect(k.x, k.y, k.w, k.h);
      ctx.setLineDash([]);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = c.ink;
    for (const k of this.clamps) {
      const [sx, sy] = this.toScreen([k.x + k.w / 2, k.y + k.h / 2]);
      if (k.w * view.s > 34) ctx.fillText('clamp', sx, sy + 4);
    }
  }

  tabAt(sp) {
    for (let i = this.tabs.length - 1; i >= 0; i--) {
      const [x, y] = this.toScreen([this.tabs[i].x, this.tabs[i].y]);
      if (Math.hypot(sp[0] - x, sp[1] - y) <= TAB_PX + 3) return i;
    }
    return -1;
  }

  paintTabs(c) {
    if (!this.tabs.length) return;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.tabs.forEach((t, i) => {
      const drag = this.drag?.kind === 'tab' && this.drag.i === i && this.drag.at;
      const [x, y] = this.toScreen(drag ? this.drag.at : [t.x, t.y]);
      ctx.beginPath();
      ctx.arc(x, y, TAB_PX, 0, Math.PI * 2);
      ctx.fillStyle = '#f59e0b';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = c.dark ? '#121314' : '#ffffff';
      ctx.stroke();
      // A small bridge mark: the wood that stays.
      ctx.beginPath();
      ctx.moveTo(x - 3, y);
      ctx.lineTo(x + 3, y);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#3b2600';
      ctx.stroke();
    });
  }

  paintWarnings(c, world) {
    const { ctx, view } = this;
    world();
    for (const w of this.warnings) {
      if (!w.where?.length) continue;
      const p = new Path2D();
      for (const poly of w.where) poly.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
      ctx.fillStyle = c.bad;
      ctx.fill(p, 'nonzero');
      ctx.lineWidth = 1.5 / view.s;
      ctx.strokeStyle = c.badLine;
      ctx.stroke(p);
    }
  }

  paintMoves(c, world) {
    const { ctx, view } = this;
    const moves = this.preview.moves;
    world();
    ctx.lineWidth = 1.2 / view.s;
    let prev = null;
    ctx.beginPath();
    for (const m of moves) {
      if (prev && prev.x !== null && m.k === 'rapid' && (m.x !== prev.x || m.y !== prev.y)) {
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(m.x, m.y);
      }
      prev = m;
    }
    ctx.setLineDash([3 / view.s, 3 / view.s]);
    ctx.strokeStyle = c.rapid;
    ctx.stroke();
    ctx.setLineDash([]);
    prev = null;
    ctx.beginPath();
    for (const m of moves) {
      if (prev && prev.x !== null && m.k !== 'rapid' && m.z < 0) {
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(m.x, m.y);
      }
      prev = m;
    }
    ctx.strokeStyle = c.select;
    ctx.stroke();
  }

  handles(part) {
    // The part's own box, turned with it: corners for scaling, a knob above for turning.
    const lb = bounds(part.lines.map((l) => l.points));
    const corners = toBoard(part, [[lb.minX, lb.minY], [lb.maxX, lb.minY], [lb.maxX, lb.maxY], [lb.minX, lb.maxY]]).map((p) => this.toScreen(p));
    const topMid = this.toScreen(toBoard(part, [[(lb.minX + lb.maxX) / 2, lb.maxY]])[0]);
    const centre = this.toScreen([part.x, part.y]);
    const dx = topMid[0] - centre[0];
    const dy = topMid[1] - centre[1];
    const len = Math.hypot(dx, dy) || 1;
    const knob = [topMid[0] + (dx / len) * ROTATE_GAP_PX, topMid[1] + (dy / len) * ROTATE_GAP_PX];
    return { corners, topMid, knob, centre };
  }

  paintSelection(c) {
    const part = this.parts.find((p) => p.id === this.selected?.partId);
    if (!part) return;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const h = this.handles(part);
    ctx.strokeStyle = c.select;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    h.corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(...h.topMid);
    ctx.lineTo(...h.knob);
    ctx.stroke();
    ctx.fillStyle = c.dark ? '#1b1c1e' : '#ffffff';
    for (const [x, y] of h.corners) {
      ctx.fillRect(x - HANDLE_PX / 2, y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
      ctx.strokeRect(x - HANDLE_PX / 2, y - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
    }
    ctx.beginPath();
    ctx.arc(h.knob[0], h.knob[1], HANDLE_PX / 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  paintLabels(c) {
    const { ctx, board } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillStyle = c.muted;
    const [x0, y0] = this.toScreen([0, 0]);
    const [x1, y1] = this.toScreen([board.w, board.h]);
    ctx.textAlign = 'center';
    ctx.fillText(`${fmtLen(board.w)}`, (x0 + x1) / 2, y0 + 18);
    ctx.save();
    ctx.translate(x0 - 12, (y0 + y1) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${fmtLen(board.h)}`, 0, 0);
    ctx.restore();
    // Zero marker: where the teacher zeros the machine.
    ctx.fillStyle = c.select;
    ctx.beginPath();
    ctx.arc(x0, y0, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillText('Zero', x0 - 8, y0 + 4);
    ctx.fillStyle = c.muted;
    ctx.textAlign = 'center';
    ctx.fillText('Front of the machine', (x0 + x1) / 2, y0 + 36);
  }

  // ---- pointer ----
  onDown(e) {
    const sp = this.eventPoint(e);
    this.canvas.focus({ preventScroll: true });
    if (e.button === 1 || e.button === 2 || this.mode !== 'design') {
      this.drag = { kind: 'pan', start: sp, view: { ...this.view } };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    // Tabs first: they sit on the cut line, on top of everything.
    const ti = this.tabAt(sp);
    if (ti >= 0) {
      this.drag = { kind: 'tab', i: ti, at: null };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const part = this.parts.find((p) => p.id === this.selected?.partId);
    if (part) {
      const h = this.handles(part);
      if (Math.hypot(sp[0] - h.knob[0], sp[1] - h.knob[1]) <= HANDLE_PX) {
        this.drag = { kind: 'rotate', part, centre: h.centre, a0: Math.atan2(sp[1] - h.centre[1], sp[0] - h.centre[0]), r0: part.rotation };
      } else {
        const ci = h.corners.findIndex(([x, y]) => Math.abs(sp[0] - x) <= HANDLE_PX && Math.abs(sp[1] - y) <= HANDLE_PX);
        if (ci >= 0) this.drag = { kind: 'scale', part, centre: h.centre, d0: Math.hypot(sp[0] - h.centre[0], sp[1] - h.centre[1]), s0: part.scale };
      }
      if (this.drag) {
        this.handlers.onTransformStart?.();
        this.canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    const hit = hitTest(this.parts, this.toWorld(...sp), 6 / this.view.s);
    this.handlers.onPick?.(hit, e.shiftKey || e.ctrlKey || e.metaKey);
    if (hit) {
      this.drag = { kind: 'move', part: hit.part, start: this.toWorld(...sp), x0: hit.part.x, y0: hit.part.y, moved: false };
      this.canvas.setPointerCapture(e.pointerId);
    } else {
      this.drag = { kind: 'pan', start: sp, view: { ...this.view } };
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  onMove(e) {
    const sp = this.eventPoint(e);
    const d = this.drag;
    if (!d) {
      this.updateCursor(sp);
      return;
    }
    if (d.kind === 'tab') {
      d.at = this.toWorld(...sp);
      this.draw();
      return;
    }
    if (d.kind === 'pan') {
      if (Math.hypot(sp[0] - d.start[0], sp[1] - d.start[1]) < 3 && !d.panning) return;
      d.panning = true;
      this.userZoomed = true;
      this.view = { ...d.view, ox: d.view.ox + sp[0] - d.start[0], oy: d.view.oy + sp[1] - d.start[1] };
      this.draw();
      return;
    }
    if (d.kind === 'move') {
      const w = this.toWorld(...sp);
      if (!d.moved && Math.hypot(w[0] - d.start[0], w[1] - d.start[1]) * this.view.s < 3) return;
      if (!d.moved) this.handlers.onTransformStart?.();
      d.moved = true;
      this.handlers.onTransform?.(d.part, { x: round1(d.x0 + w[0] - d.start[0]), y: round1(d.y0 + w[1] - d.start[1]) });
    } else if (d.kind === 'scale') {
      const dist = Math.hypot(sp[0] - d.centre[0], sp[1] - d.centre[1]);
      this.handlers.onTransform?.(d.part, { scale: Math.max(0.01, (d.s0 * dist) / Math.max(1, d.d0)) });
    } else if (d.kind === 'rotate') {
      const a = Math.atan2(sp[1] - d.centre[1], sp[0] - d.centre[0]);
      let r = d.r0 - ((a - d.a0) * 180) / Math.PI; // screen y is down, board y is up
      r = e.shiftKey ? r : Math.round(r / 5) * 5;
      this.handlers.onTransform?.(d.part, { rotation: ((r % 360) + 360) % 360 });
    }
  }

  onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.kind === 'tab') {
      if (d.at) this.handlers.onTabMoved?.(d.i, d.at);
      return;
    }
    if (d.kind === 'pan' && !d.panning && this.mode === 'design') this.handlers.onPick?.(null, false);
    if ((d.kind === 'move' && d.moved) || d.kind === 'scale' || d.kind === 'rotate') this.handlers.onTransformEnd?.();
  }

  onWheel(e) {
    e.preventDefault();
    const sp = this.eventPoint(e);
    const w = this.toWorld(...sp);
    const k = Math.exp(-e.deltaY * 0.0015);
    const s = Math.min(Math.max(this.view.s * k, 0.2), 60);
    this.view = { s, ox: sp[0] - w[0] * s, oy: sp[1] + w[1] * s };
    this.userZoomed = true;
    this.draw();
  }

  updateCursor(sp) {
    if (this.mode !== 'design') {
      this.canvas.style.cursor = 'grab';
      return;
    }
    if (this.tabAt(sp) >= 0) {
      this.canvas.style.cursor = 'grab';
      return;
    }
    const part = this.parts.find((p) => p.id === this.selected?.partId);
    if (part) {
      const h = this.handles(part);
      if (Math.hypot(sp[0] - h.knob[0], sp[1] - h.knob[1]) <= HANDLE_PX) {
        this.canvas.style.cursor = 'crosshair';
        return;
      }
      if (h.corners.some(([x, y]) => Math.abs(sp[0] - x) <= HANDLE_PX && Math.abs(sp[1] - y) <= HANDLE_PX)) {
        this.canvas.style.cursor = 'nwse-resize';
        return;
      }
    }
    const hit = hitTest(this.parts, this.toWorld(...sp), 6 / this.view.s);
    this.canvas.style.cursor = hit ? 'move' : 'default';
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function fmtLen(mm) {
  const inches = mm / 25.4;
  return `${Math.round(mm)} mm (${inches.toFixed(inches < 10 ? 2 : 1)} in)`;
}

export { partBounds };
