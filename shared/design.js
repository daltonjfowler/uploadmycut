// A student's design: a list of parts on the board. Pure data + maths, used by the page and tests.
//
// A part is one drawing, shape or text. Its lines are stored once in part-local mm (y up, centred
// on 0,0) and never change; moving, scaling, turning and mirroring only change the part's numbers.
// Each line has its own job (shared/cam.js JOBS).
//
//   part = { id, name, kind, fill, lines: [{ points, closed }], jobs: ['cutout', ...], pocketDepth,
//            x, y, scale, rotation (degrees, counter-clockwise), mirror, tabs }
//
// `tabs` (optional) are tab spots the student dragged, in part-local mm, so they move with the
// part. null = the planner places tabs by itself. Always replaced, never changed in place (undo
// snapshots share it).
//
// `fill` says which areas a set of closed lines encloses: 'nonzero' for text (fonts wind letter
// centres the other way round), 'evenodd' for drawings (safest guess for an unknown SVG).

import { area, bounds, offset, pointInRegion, union } from './geometry.js';

let nextId = 1;

/** Lines in SVG orientation (y down, any position) → a new part centred on 0,0 with y up. */
export function makePart({ name, kind, lines, flipY = true, fill = 'evenodd' }) {
  const flipped = lines.map((l) => ({ points: l.points.map(([x, y]) => [x, flipY ? -y : y]), closed: l.closed }));
  const b = bounds(flipped.map((l) => l.points));
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const centred = flipped.map((l) => ({ points: l.points.map(([x, y]) => [x - cx, y - cy]), closed: l.closed }));
  return {
    id: `p${nextId++}`,
    name: String(name ?? 'drawing').slice(0, 60),
    kind,
    fill,
    lines: centred,
    // A line may bring its own job (the coaster's pocket); the rest get the first guess.
    jobs: (fill === 'nonzero' ? autoJobsByFill(centred) : autoJobs(centred)).map((j, i) => lines[i].job ?? j),
    pocketDepth: null,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    mirror: false,
    tabs: null,
  };
}

/**
 * First guess at each line's job: open lines are engraved; a closed line inside an even number
 * of other closed lines is cut out, inside an odd number it is a hole (a letter O: outside cut
 * out, the middle a hole; a keychain: the ring hole).
 */
export function autoJobs(lines) {
  return lines.map((l, i) => {
    if (!l.closed) return 'engrave';
    const a = Math.abs(area(l.points));
    let depth = 0;
    lines.forEach((o, j) => {
      if (j === i || !o.closed || Math.abs(area(o.points)) <= a) return;
      if (pointInRegion(l.points[0], [o.points])) depth++;
    });
    return depth % 2 === 0 ? 'cutout' : 'hole';
  });
}

function winding(pt, lines) {
  let w = 0;
  const [x, y] = pt;
  for (const l of lines) {
    if (!l.closed) continue;
    const p = l.points;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xa, ya] = p[j];
      const [xb, yb] = p[i];
      if (ya <= y) {
        if (yb > y && (xb - xa) * (y - ya) - (x - xa) * (yb - ya) > 0) w++;
      } else if (yb <= y && (xb - xa) * (y - ya) - (x - xa) * (yb - ya) < 0) w--;
    }
  }
  return w;
}

/**
 * First guess for text (non-zero fill): a closed line with filled area just inside it is an
 * outside edge (cut out); one with empty space inside is a letter centre (hole). Unlike
 * autoJobs, this stays right when joined-up script letters overlap each other.
 */
export function autoJobsByFill(lines) {
  return lines.map((l) => {
    if (!l.closed) return 'engrave';
    const p = l.points;
    let best = 0;
    let bestLen = -1;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      const len = Math.hypot(q[0] - p[i][0], q[1] - p[i][1]);
      if (len > bestLen) {
        bestLen = len;
        best = i;
      }
    }
    const a = p[best];
    const b = p[(best + 1) % p.length];
    const sign = area(p) > 0 ? 1 : -1; // counter-clockwise: the inside is on the left
    const eps = Math.min(0.02, bestLen / 4);
    const nx = (-(b[1] - a[1]) / bestLen) * sign * eps;
    const ny = ((b[0] - a[0]) / bestLen) * sign * eps;
    const probe = [(a[0] + b[0]) / 2 + nx, (a[1] + b[1]) / 2 + ny];
    return winding(probe, lines) !== 0 ? 'cutout' : 'hole';
  });
}

/**
 * A new part with an outline `gap` mm around everything closed in `part` (a name keychain: the
 * border is cut out, the letters become a pocket). Lines stay in the part's local units.
 */
export function withBorder(part, gapMm) {
  const closed = part.lines.filter((l) => l.closed).map((l) => l.points);
  if (!closed.length) return null;
  const gap = gapMm / part.scale;
  const outer = offset(union(closed, part.fill === 'nonzero' ? 'nonzero' : 'evenodd'), gap).filter((p) => area(p) > 0);
  if (!outer.length) return null;
  const lines = [...part.lines, ...outer.map((points) => ({ points, closed: true }))];
  const jobs = [...part.jobs.map((j, i) => (part.lines[i].closed ? 'pocket' : j)), ...outer.map(() => 'cutout')];
  return { ...part, lines, jobs, fill: part.fill === 'nonzero' ? 'nonzero' : 'evenodd' };
}

/** The part's local → board transform as [a, b, c, d, e, f] (x' = a x + c y + e). */
export function partMatrix(part) {
  const t = (part.rotation * Math.PI) / 180;
  const s = part.scale;
  const mx = part.mirror ? -1 : 1;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  return [cos * s * mx, sin * s * mx, -sin * s, cos * s, part.x, part.y];
}

export function toBoard(part, pts) {
  const [a, b, c, d, e, f] = partMatrix(part);
  return pts.map(([x, y]) => [a * x + c * y + e, b * x + d * y + f]);
}

/** Board point → part-local point. */
export function toLocal(part, [x, y]) {
  const [a, b, c, d, e, f] = partMatrix(part);
  const det = a * d - b * c;
  const px = x - e;
  const py = y - f;
  return [(d * px - c * py) / det, (-b * px + a * py) / det];
}

export function partBounds(part) {
  return bounds(part.lines.map((l) => toBoard(part, l.points)));
}

/** Local size (before turning), for the W × H boxes. */
export function partSize(part) {
  const b = bounds(part.lines.map((l) => l.points));
  return { w: b.w * part.scale, h: b.h * part.scale };
}

/** Every tab spot students placed, in board mm, for planCut's cut.tabPoints. */
export function designTabPoints(parts) {
  return parts.flatMap((p) => (p.tabs?.length ? toBoard(p, p.tabs) : []));
}

/** Every line of every part in board mm, ready for planCut. Mirroring flips the winding back. */
export function designShapes(parts, defaultPocketDepth) {
  const out = [];
  for (const p of parts) {
    p.lines.forEach((l, i) => {
      const job = p.jobs[i];
      if (job === 'skip') return;
      out.push({ points: toBoard(p, l.points), closed: l.closed, job, depth: p.pocketDepth ?? defaultPocketDepth, group: p.id, fill: p.fill });
    });
  }
  return out;
}

/** Put a new part in the middle of the board, shrunk to fit inside the margin if it is too big. */
export function placeOnBoard(part, board, margin) {
  const size = bounds(part.lines.map((l) => l.points));
  const room = { w: board.w - 2 * margin, h: board.h - 2 * margin };
  if (size.w > room.w || size.h > room.h) part.scale = Math.min(room.w / size.w, room.h / size.h);
  part.x = board.w / 2;
  part.y = board.h / 2;
  return part;
}

/**
 * Keep a part inside the board less `margin`: shrink it (about its centre) if it is too big, then
 * slide it back in. Returns true when anything changed.
 */
export function fitOnBoard(part, board, margin) {
  let b = partBounds(part);
  const room = { w: board.w - 2 * margin, h: board.h - 2 * margin };
  let changed = false;
  if (b.w > room.w || b.h > room.h) {
    const k = Math.min(room.w / b.w, room.h / b.h) * 0.999;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    part.scale *= k;
    part.x = cx + (part.x - cx) * k;
    part.y = cy + (part.y - cy) * k;
    b = partBounds(part);
    changed = true;
  }
  const dx = Math.max(0, margin - b.minX) - Math.max(0, b.maxX - (board.w - margin));
  const dy = Math.max(0, margin - b.minY) - Math.max(0, b.maxY - (board.h - margin));
  if (dx || dy) {
    part.x += dx;
    part.y += dy;
    changed = true;
  }
  return changed;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/**
 * Which part and line is under a board point: a line within `tol` mm wins; otherwise the
 * smallest closed line around the point. Top part (last in the list) first. null = nothing.
 */
export function hitTest(parts, pt, tol) {
  for (let pi = parts.length - 1; pi >= 0; pi--) {
    const part = parts[pi];
    const b = partBounds(part);
    if (pt[0] < b.minX - tol || pt[0] > b.maxX + tol || pt[1] < b.minY - tol || pt[1] > b.maxY + tol) continue;
    const local = toLocal(part, pt);
    const ltol = tol / part.scale;
    let best = null;
    part.lines.forEach((l, li) => {
      const pts = l.points;
      const n = pts.length;
      for (let i = 1; i < n + (l.closed ? 1 : 0); i++) {
        const d = distToSegment(local, pts[i - 1], pts[i % n]);
        if (d <= ltol && (!best || d < best.d)) best = { d, li };
      }
    });
    if (best) return { part, line: best.li, onLine: true };
    let inside = null;
    part.lines.forEach((l, li) => {
      if (!l.closed || !pointInRegion(local, [l.points])) return;
      const a = Math.abs(area(l.points));
      if (!inside || a < inside.a) inside = { a, li };
    });
    if (inside) return { part, line: inside.li, onLine: false };
  }
  return null;
}

/** The numbers undo needs (the lines themselves never change, so they are shared). */
export function snapshot(parts) {
  return parts.map((p) => ({ ...p, jobs: p.jobs.slice() }));
}

const SAVED_JOBS = new Set(['cutout', 'hole', 'engrave', 'pocket', 'skip']);
const MAX_SAVED_POINTS = 400_000;

/**
 * A part read back from browser storage, checked field by field, with a fresh id; null if any
 * of it looks wrong (then the page just starts without it).
 */
export function revivePart(raw, budget = { points: MAX_SAVED_POINTS }) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.lines) || !Array.isArray(raw.jobs)) return null;
  if (!raw.lines.length || raw.lines.length !== raw.jobs.length || raw.lines.length > 5000) return null;
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const lines = [];
  for (const l of raw.lines) {
    if (!l || !Array.isArray(l.points) || l.points.length < 2) return null;
    budget.points -= l.points.length;
    if (budget.points < 0) return null;
    if (!l.points.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))) return null;
    lines.push({ points: l.points.map((p) => [p[0], p[1]]), closed: l.closed === true });
  }
  if (!raw.jobs.every((j) => SAVED_JOBS.has(j))) return null;
  if (![raw.x, raw.y, raw.scale, raw.rotation].every(num) || !(raw.scale > 0)) return null;
  if (raw.pocketDepth !== null && raw.pocketDepth !== undefined && !num(raw.pocketDepth)) return null;
  let tabs = null;
  if (Array.isArray(raw.tabs)) {
    if (raw.tabs.length > 64 || !raw.tabs.every((p) => Array.isArray(p) && p.length === 2 && num(p[0]) && num(p[1]))) return null;
    tabs = raw.tabs.map((p) => [p[0], p[1]]);
  }
  return {
    id: `p${nextId++}`,
    name: String(raw.name ?? 'drawing').slice(0, 60),
    kind: ['svg', 'shape', 'text'].includes(raw.kind) ? raw.kind : 'svg',
    fill: raw.fill === 'nonzero' ? 'nonzero' : 'evenodd',
    lines,
    jobs: raw.jobs.slice(),
    pocketDepth: raw.pocketDepth ?? null,
    x: raw.x,
    y: raw.y,
    scale: raw.scale,
    rotation: raw.rotation,
    mirror: raw.mirror === true,
    tabs,
  };
}

export function cloneForCopy(part) {
  return { ...part, id: `p${nextId++}`, jobs: part.jobs.slice(), tabs: part.tabs ? part.tabs.map((p) => p.slice()) : null };
}

// ---- Class sets and starter projects ----

/**
 * Board spots for `n` copies of a part in a grid: rows from the front-left corner, `gap` mm
 * apart, inside `keep` mm of the edges, skipping any spot that would touch a clamp. Returns
 * [{ x, y }] part positions (at most n; fewer when the board is full).
 */
export function gridSpots(part, n, board, keep, gap, clamps = [], clampPad = 0) {
  const b = partBounds(part);
  const dx = part.x - b.minX;
  const dy = part.y - b.minY;
  const spots = [];
  for (let y = keep; y + b.h <= board.h - keep + 1e-6 && spots.length < n; y += b.h + gap) {
    for (let x = keep; x + b.w <= board.w - keep + 1e-6 && spots.length < n; x += b.w + gap) {
      const hit = clamps.some((c) => x < c.x + c.w + clampPad && x + b.w > c.x - clampPad && y < c.y + c.h + clampPad && y + b.h > c.y - clampPad);
      if (!hit) spots.push({ x: x + dx, y: y + dy });
    }
  }
  return spots;
}

function circleLine(cx, cy, r, n = 48) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);
}

function roundedRectLine(x, y, w, h, r) {
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= 10; i++) {
      const a = a0 + (Math.PI / 2) * (i / 10);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

/**
 * A name keychain from text lines (SVG orientation, y down): the letters are a pocket, a border
 * 4 mm round them and a round lobe at the left end is cut out, and the lobe has the keyring hole.
 */
export function keychainPart(name, textLines) {
  const letters = textLines.filter((l) => l.closed).map((l) => l.points);
  const b = bounds(letters);
  const lobe = [b.minX - 8, (b.minY + b.maxY) / 2];
  const outline = offset(union([...letters, circleLine(lobe[0], lobe[1], 7.5)], 'nonzero'), 4).filter((p) => area(p) > 0);
  return makePart({
    name,
    kind: 'text',
    fill: 'nonzero',
    lines: [
      ...textLines.map((l) => ({ ...l, job: 'pocket' })),
      ...outline.map((points) => ({ points, closed: true, job: 'cutout' })),
      { points: circleLine(lobe[0], lobe[1], 2.8), closed: true, job: 'hole' },
    ],
  });
}

/** A door sign: a rounded board, the name pocketed in the middle, a screw hole at each end. */
export function doorSignPart(name, textLines) {
  const letters = textLines.filter((l) => l.closed).map((l) => l.points);
  const b = bounds(letters);
  const w = b.w + 44;
  const h = b.h + 28;
  const x = b.minX - 22;
  const y = b.minY - 14;
  return makePart({
    name,
    kind: 'text',
    fill: 'nonzero',
    lines: [
      { points: roundedRectLine(x, y, w, h, 8), closed: true, job: 'cutout' },
      ...textLines.map((l) => ({ ...l, job: 'pocket' })),
      { points: circleLine(x + 10, y + h / 2, 2.2), closed: true, job: 'hole' },
      { points: circleLine(x + w - 10, y + h / 2, 2.2), closed: true, job: 'hole' },
    ],
  });
}

/** A five-point star ornament with a hanging hole near the top point. */
export function ornamentPart() {
  const star = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? 16 : 34;
    const a = Math.PI / 2 + (Math.PI * i) / 5;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  return makePart({
    name: 'Star ornament',
    kind: 'shape',
    flipY: false,
    lines: [{ points: star, closed: true, job: 'cutout' }, { points: circleLine(0, 18, 2.5), closed: true, job: 'hole' }],
  });
}
