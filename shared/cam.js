// The cutting plan: shapes with a job each → tool moves, for one bit. Pure (no DOM): the page runs
// it, and Node tests check it.
//
// Jobs:
//   cutout  - the bit goes around the OUTSIDE of the line, all the way through, and leaves tabs.
//   hole    - the bit goes around the INSIDE of the line, all the way through.
//   engrave - the bit's centre follows the line, shallow.
//   pocket  - the inside of the line is cleared to a depth.
//   skip    - not cut.
//
// Order (never change it without thinking about parts coming loose): engrave, then pockets, then
// holes and cut outs together, innermost first. A part that is cut free can shift, so nothing
// inside it may be cut after it. Same rule as uploadmylaser's "cut through runs last".
//
// Moves: { k, x, y, z } with k = 'rapid' (G0), 'plunge' (G1 at the plunge feed: any move that goes
// down) or 'cut' (G1 at the cut feed). z = 0 is the top of the board; the board bottom is -t.

import {
  area, bounds, boxInside, boxOf, containsAll, difference, offset, pathLength, pointInBox, pointInRegion, samplePoints,
  segmentInside, significant, simplifyLine, union,
} from './geometry.js';

export const JOBS = ['cutout', 'hole', 'engrave', 'pocket', 'skip'];
export const JOB_LABELS = { cutout: 'Cut out', hole: 'Cut hole', engrave: 'Engrave', pocket: 'Pocket', skip: "Don't cut" };
const CLEARANCE_MM = 1; // rapid down to this far above the board, then plunge
// Lost spots narrower than this are not worth a warning. Every round bit leaves round inside
// corners (a square corner keeps a sliver about 0.34 x the bit radius wide), so the bar grows
// with the bit: half its radius, and never under 0.5 mm.
const DETAIL_MIN_MM = 0.5;
const detailMin = (r) => Math.max(DETAIL_MIN_MM, r / 2);
// Grow the 'reached' side by 20 µm before comparing, so arc rounding leaves no slivers to sort.
const SLIVER_MM = 0.02;

/** Depths for each pass, equal steps no deeper than `perPass`, ending at -total. */
export function passDepths(total, perPass) {
  if (!(total > 0) || !(perPass > 0)) return [];
  const n = Math.max(1, Math.ceil(total / perPass - 1e-9));
  return Array.from({ length: n }, (_, i) => -Math.round(((total * (i + 1)) / n) * 1000) / 1000);
}

/** Tab centres along a closed toolpath of length L, evenly spaced, starting half a gap in. */
export function tabCentres(L, count) {
  return Array.from({ length: count }, (_, i) => ((i + 0.5) * L) / count);
}

/** How many tabs a part gets: 2 for a keychain, up to 8 for a big sign. */
export function tabCount(L) {
  return Math.max(2, Math.min(8, Math.round(L / 120)));
}

// Start a closed loop at the vertex nearest to `from`.
function rotateToNearest(loop, from) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const d = (loop[i][0] - from[0]) ** 2 + (loop[i][1] - from[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return loop.slice(best).concat(loop.slice(0, best));
}

class Moves {
  constructor(safeZ) {
    this.safeZ = safeZ;
    this.list = [];
    this.x = null;
    this.y = null;
    this.z = null; // unknown until the first move
  }

  push(k, x, y, z) {
    if (x === this.x && y === this.y && z === this.z) return;
    this.list.push({ k, x, y, z });
    this.x = x;
    this.y = y;
    this.z = z;
  }

  retract() {
    // The very first move: x and y stay null (the machine is wherever the teacher left it).
    if (this.z !== this.safeZ) this.push('rapid', this.x, this.y, this.safeZ);
  }

  /** Lift, travel, drop to just above the board, and plunge to z. */
  enterAt([x, y], z) {
    this.retract();
    this.push('rapid', x, y, this.safeZ);
    this.push('rapid', x, y, CLEARANCE_MM);
    this.push('plunge', x, y, z);
  }

  plunge(z) {
    this.push(z < this.z ? 'plunge' : 'cut', this.x, this.y, z);
  }

  cut(x, y, z = this.z) {
    this.push(z < this.z ? 'plunge' : 'cut', x, y, z);
  }
}

// One lap of a closed loop at depth z, back to the start. Inside a tab the bit rises to tabZ.
function lap(m, loop, z, tabs) {
  const n = loop.length;
  const high = tabs && z < tabs.z ? tabs : null;
  if (!high) {
    for (let i = 1; i <= n; i++) m.cut(loop[i % n][0], loop[i % n][1], z);
    return;
  }
  const inTab = (s) => high.spans.some(([a, b]) => s > a && s < b);
  let s = 0;
  for (let i = 1; i <= n; i++) {
    const p = loop[i - 1];
    const q = loop[i % n];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len === 0) continue;
    // Break the segment where a tab starts or ends.
    const cuts = [];
    for (const [a, b] of high.spans) {
      if (a > s && a < s + len) cuts.push(a - s);
      if (b > s && b < s + len) cuts.push(b - s);
    }
    cuts.sort((u, v) => u - v);
    let t0 = 0;
    for (const t1 of [...cuts, len]) {
      const up = inTab(s + (t0 + t1) / 2);
      const zz = up ? high.z : z;
      if (m.z !== zz) m.cut(m.x, m.y, zz); // straight up into the tab, or down out of it
      const f = t1 / len;
      m.cut(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, zz);
      t0 = t1;
    }
    s += len;
  }
  if (m.z !== z) m.cut(m.x, m.y, z);
}

function profileLoop(m, loop, zs, tabs) {
  m.enterAt(loop[0], zs[0]);
  for (const z of zs) {
    m.plunge(z);
    lap(m, loop, z, tabs);
  }
  m.retract();
}

function engraveLine(m, pts, closed, zs) {
  m.enterAt(pts[0], zs[0]);
  let forward = true;
  for (const z of zs) {
    m.plunge(z);
    if (closed) {
      for (let i = 1; i <= pts.length; i++) m.cut(pts[i % pts.length][0], pts[i % pts.length][1], z);
    } else {
      // Back and forth, so there is no lift between passes.
      const seq = forward ? pts.slice(1) : pts.slice(0, -1).reverse();
      for (const p of seq) m.cut(p[0], p[1], z);
      forward = !forward;
    }
  }
  m.retract();
}

// Loops that clear `region` (where the bit centre may go), outermost level first in the array.
function pocketLoops(region, step) {
  const levels = [];
  let cur = region;
  for (let guard = 0; cur.length && guard < 500; guard++) {
    levels.push(cur);
    cur = offset(cur, -step);
  }
  return levels;
}

// Stay down between pocket loops only for a short hop that is clearly inside: the plain
// segmentInside test misses a link running exactly along an edge (two pockets side by side on one
// baseline), so every point of the hop must also be inside the pocket shrunk by 50 um.
function linkInside(a, b, region, eroded, maxLen) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len > maxLen || !eroded.length || !segmentInside(a, b, region)) return false;
  const n = Math.max(2, Math.ceil(len / 0.25));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (t * len < 0.1 || (1 - t) * len < 0.1) continue; // the ends sit on loop lines
    if (!pointInRegion([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], eroded)) return false;
  }
  return true;
}

function pocketRegion(m, region, zs, step, climb, bitDiameter) {
  const levels = pocketLoops(region, step);
  const eroded = offset(region, -0.05);
  const maxLink = bitDiameter * 1.5;
  // Innermost level first: plunge in the middle, finish on the wall.
  const order = [];
  let from = [m.x ?? 0, m.y ?? 0];
  for (let li = levels.length - 1; li >= 0; li--) {
    const pending = levels[li].map((p) => (climb ? p : p.slice().reverse()));
    while (pending.length) {
      let bi = 0;
      let bd = Infinity;
      pending.forEach((loop, i) => {
        for (const q of loop) {
          const d = (q[0] - from[0]) ** 2 + (q[1] - from[1]) ** 2;
          if (d < bd) {
            bd = d;
            bi = i;
          }
        }
      });
      const loop = rotateToNearest(pending.splice(bi, 1)[0], from);
      order.push(loop);
      from = loop[0];
    }
  }
  let first = true;
  for (const z of zs) {
    for (const loop of order) {
      const here = [m.x, m.y];
      if (first) {
        m.enterAt(loop[0], z);
        first = false;
      } else if (m.z <= 0 && linkInside(here, loop[0], region, eroded, maxLink)) {
        m.cut(loop[0][0], loop[0][1]); // stay down: the link never leaves the pocket
        m.plunge(z);
      } else {
        m.enterAt(loop[0], z);
      }
      lap(m, loop, z, null);
    }
  }
  m.retract();
}

/**
 * Plan every cut for one bit.
 *
 * @param {object} p
 * @param {Array<{points: number[][], closed: boolean, job: string, depth?: number, group?: string}>} p.shapes
 *   in board mm. `group` keeps pocket shapes from one drawing together, filled by its `fill`
 *   rule ('evenodd' default, 'nonzero' for text), so letter centres stay; `depth` is a pocket's
 *   depth.
 * @param {{w: number, h: number, t: number}} p.board
 * @param {{diameter: number}} p.bit
 * @param {object} p.cut feed-free cut rules: depthPerPass, stepover (0-1 of the diameter),
 *   safeZ, throughMm, engraveDepth, pocketDepth, pocketMaxDepth, marginMm, climb,
 *   tabs { width, height } or null.
 */
export function planCut({ shapes: input, board, bit, cut }) {
  const r = bit.diameter / 2;
  // 10 µm is far below what the machine can cut, and big drawings get much faster.
  const shapes = input.map((s) => ({ ...s, points: simplifyLine(s.points, s.closed, 0.01) }));
  const warnings = [];
  const m = new Moves(cut.safeZ);
  const byJob = (job) => shapes.filter((s) => s.job === job);

  // ---- Engrave ----
  // Never through the board: an engraved closed line would free a piece with no tabs.
  const engraveZs = passDepths(Math.min(cut.engraveDepth, board.t - 0.5), cut.depthPerPass);
  for (const s of byJob('engrave')) {
    if (s.points.length < 2) continue;
    engraveLine(m, s.points, s.closed, engraveZs);
  }

  // ---- Pockets, grouped by drawing and depth ----
  const pocketGroups = new Map();
  for (const s of byJob('pocket')) {
    if (!s.closed) continue;
    // The teacher's deepest pocket wins over whatever the part asks for (or kept from last time).
    const depth = Math.min(Math.max(s.depth ?? cut.pocketDepth, 0.1), cut.pocketMaxDepth ?? Infinity, board.t - 1);
    const key = `${s.group ?? ''}|${depth}`;
    if (!pocketGroups.has(key)) pocketGroups.set(key, { depth, fill: s.fill === 'nonzero' ? 'nonzero' : 'evenodd', polys: [] });
    pocketGroups.get(key).polys.push(s.points);
  }
  const pocketFill = [];
  for (const { depth, fill, polys } of pocketGroups.values()) {
    const region = union(polys, fill);
    const inner = offset(region, -r);
    if (!inner.length) {
      warnings.push({ code: 'tooSmall', job: 'pocket', where: region, message: 'This pocket is thinner than the bit, so the bit cannot fit in it.' });
      continue;
    }
    const reach = offset(inner, r);
    const lost = significant(difference(region, offset(reach, SLIVER_MM)), detailMin(r));
    if (lost.length) warnings.push({ code: 'detail', job: 'pocket', where: lost, message: 'The bit is too thick to reach the red spots of this pocket. They stay wood.' });
    pocketFill.push(...reach);
    pocketRegion(m, inner, passDepths(depth, cut.depthPerPass), bit.diameter * cut.stepover, cut.climb, bit.diameter);
  }

  // ---- Holes and cut outs: through the board ----
  const throughZs = passDepths(board.t + cut.throughMm, cut.depthPerPass);
  const through = shapes.filter((s) => s.closed && (s.job === 'cutout' || s.job === 'hole'));
  const tabZ = -board.t + (cut.tabs?.height ?? 0);
  if (through.length && cut.tabs && tabZ >= -0.2) {
    warnings.push({ code: 'tabs', message: 'The tabs are as thick as the board, so nothing would be cut through. Ask your teacher.' });
  }
  const useTabs = !!cut.tabs && tabZ < -0.2;
  const loops = []; // { loop, kind }

  // How deep each through shape is nested: how many other through shapes hold ALL of it. A part
  // inside another part's hole is deeper, so it is never merged with the part around it.
  const info = through.map((s) => ({ s, a: Math.abs(area(s.points)), box: boxOf(s.points) }));
  for (const x of info) {
    x.depth = info.filter((y) => y !== x && y.a > x.a && boxInside(x.box, y.box) && containsAll(y.s.points, x.s.points)).length;
  }
  const cuts = info.filter((x) => x.s.job === 'cutout');
  const holeShapes = info.filter((x) => x.s.job === 'hole');
  // A hole that touches a part (inside it, or a notch across its edge) is cut as part of that
  // part's outline, so it can never be cut after the part is free.
  const touchesPart = (h) => samplePoints(h.s.points, 24).some((p) => cuts.some((c) => pointInBox(p, c.box) && pointInRegion(p, [c.s.points])));
  const partHoles = holeShapes.filter(touchesPart);
  const lonelyHoles = holeShapes.filter((h) => !partHoles.includes(h));

  const voidStarts = [];
  for (const d of [...new Set(cuts.map((c) => c.depth))].sort((a, b) => a - b)) {
    const outsD = union(cuts.filter((c) => c.depth === d).map((c) => c.s.points));
    const holesD = partHoles.filter((h) => h.depth >= d).map((h) => h.s.points);
    const material = holesD.length ? difference(outsD, union(holesD)) : outsD;
    if (!material.length) continue;
    const path = offset(material, r);
    const closedIn = offset(path, -r); // what is really left: inside corners stay round
    const extra = significant(difference(closedIn, offset(material, SLIVER_MM)), detailMin(r));
    if (extra.length) warnings.push({ code: 'detail', job: 'cutout', where: extra, message: 'The bit is too thick to cut into the red spots. They stay wood.' });
    // Clipper keeps the part on the left: that is conventional milling for a clockwise bit.
    for (const p of path) {
      const kind = area(p) > 0 ? 'cutout' : 'void';
      loops.push({ loop: cut.climb ? p.slice().reverse() : p, kind });
      if (kind === 'void') voidStarts.push({ pt: p[0], box: boxOf(p) });
    }
  }
  for (const h of partHoles) {
    if (!voidStarts.some((v) => boxInside(v.box, h.box) && pointInRegion(v.pt, [h.s.points]))) {
      warnings.push({ code: 'tooSmall', job: 'hole', where: [h.s.points], message: 'This hole is smaller than the bit. The bit cannot fit in it.' });
    }
  }

  const holes = union(lonelyHoles.map((h) => h.s.points));
  if (holes.length) {
    const path = offset(holes, -r);
    const reach = offset(path, r);
    // A hole the bit cannot enter has no toolpath inside it.
    const starts = path.filter((p) => area(p) > 0).map((p) => ({ pt: p[0], box: boxOf(p) }));
    const lostHoles = holes.filter((h) => {
      if (area(h) <= 0) return false;
      const hb = boxOf(h);
      return !starts.some((st) => boxInside(st.box, hb) && pointInRegion(st.pt, [h]));
    });
    for (const h of lostHoles) warnings.push({ code: 'tooSmall', job: 'hole', where: [h], message: 'This hole is smaller than the bit. The bit cannot fit in it.' });
    // Slivers first (cheap), then take out the holes already reported as too small.
    let lost = significant(difference(holes, offset(reach, SLIVER_MM)), detailMin(r));
    if (lost.length && lostHoles.length) lost = difference(lost, lostHoles);
    if (lost.length) warnings.push({ code: 'detail', job: 'hole', where: lost, message: 'The bit is too thick to reach the red corners of this hole. They stay wood.' });
    // An island (wood left inside a ring-shaped hole) comes loose like a part: it gets tabs.
    for (const p of path) loops.push({ loop: cut.climb ? p : p.slice().reverse(), kind: area(p) > 0 ? 'hole' : 'island' });
  }

  // Innermost first: a loop inside another loop is cut before it.
  for (const a of loops) {
    a.area = Math.abs(area(a.loop));
    a.box = boxOf(a.loop);
    a.length = pathLength(a.loop, true);
  }
  for (const a of loops) {
    a.depth = loops.filter((b) => b !== a && b.area > a.area && boxInside(a.box, b.box) && pointInRegion(a.loop[0], [b.loop])).length;
  }
  const pending = loops.slice();
  let from = [m.x ?? 0, m.y ?? 0];
  const planTabs = []; // where each tab ends up, for the markers on the board
  let loopNo = 0;
  // Which loop each placed tab belongs to: its nearest tab-taking loop (so a tab dropped a little
  // off the line still snaps onto it, and never onto two loops).
  const tabbable = (a) => {
    const b = boxOf(a.loop);
    return useTabs && (a.kind === 'cutout' || a.kind === 'island' || ((a.kind === 'hole' || a.kind === 'void') && Math.min(b.maxX - b.minX, b.maxY - b.minY) > 25));
  };
  for (const a of loops) a.placed = [];
  for (const p of cut.tabPoints ?? []) {
    let best = null;
    for (const a of loops) {
      if (!tabbable(a)) continue;
      const pr = projectOnLoop(a.loop, p);
      if (pr.dist <= TAB_SNAP_MM + r && (!best || pr.dist < best.dist)) best = { a, p, dist: pr.dist };
    }
    if (best) best.a.placed.push(best.p);
  }
  while (pending.length) {
    const deepest = Math.max(...pending.map((a) => a.depth));
    let bi = -1;
    let bd = Infinity;
    pending.forEach((a, i) => {
      if (a.depth !== deepest) return;
      for (const q of a.loop) {
        const d = (q[0] - from[0]) ** 2 + (q[1] - from[1]) ** 2;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
    });
    const a = pending.splice(bi, 1)[0];
    const loop = rotateToNearest(a.loop, from);
    // Tabs on parts and islands, and on big hole slugs (small slugs just drop).
    const b = bounds([loop]);
    const frees = a.kind === 'cutout' || a.kind === 'island';
    const wantsTabs = useTabs && (frees || ((a.kind === 'hole' || a.kind === 'void') && Math.min(b.w, b.h) > 25));
    let tabs = null;
    let run = loop;
    if (wantsTabs) {
      const span = cut.tabs.width + bit.diameter; // the bit eats r on each side of the tab
      // Tabs the student placed (board points near this loop), else evenly spaced ones.
      const placed = a.placed.map((p) => projectOnLoop(loop, p));
      let centres;
      if (placed.length) {
        // Start the loop in the middle of the widest gap, so no tab sits on the start/end seam.
        const s = placed.map((t) => t.s).sort((u, v) => u - v);
        let gapAt = 0;
        let gap = -1;
        s.forEach((v, i) => {
          const g = ((s[(i + 1) % s.length] - v + a.length) % a.length) || a.length;
          if (g > gap) {
            gap = g;
            gapAt = v + g / 2;
          }
        });
        run = rotateAtLength(loop, gapAt % a.length);
        const s0 = gapAt % a.length;
        centres = [];
        for (const v of s.map((c) => (c - s0 + a.length) % a.length).sort((u, w) => u - w)) {
          // Keep each tab whole, off the seam, and apart from the one before it.
          if (v - span / 2 < 0.5 || v + span / 2 > a.length - 0.5) continue;
          if (centres.length && v - centres[centres.length - 1] < span + 1) continue;
          centres.push(v);
        }
      } else {
        // Fewer tabs on a small part; each needs its own stretch of the loop, clear of the seam.
        const n = Math.min(tabCount(a.length), Math.floor(a.length / (2 * span)));
        centres = n >= 1 ? tabCentres(a.length, n) : [];
      }
      if (centres.length) {
        tabs = { z: tabZ, spans: centres.map((c) => [c - span / 2, c + span / 2]) };
        for (const c of centres) {
          const [x, y] = pointAtLength(run, c);
          planTabs.push({ x, y, loop: loopNo, placed: placed.length > 0 });
        }
      } else if (frees) {
        warnings.push({ code: 'noTabs', where: [loop], message: 'A piece is too small to hold with tabs, so it would come loose and could fly. Make it bigger, or give it another job.' });
      }
    }
    profileLoop(m, run, throughZs, tabs);
    from = run[0];
    loopNo++;
  }

  // ---- Clamps: the cut must stay clear of every clamp the teacher marked ----
  const hitClamps = (cut.clamps ?? []).filter((c) => moveNearRect(m.list, c, r + CLAMP_CLEAR_MM, cut.safeZ));
  if (hitClamps.length) {
    warnings.push({
      code: 'clamp',
      where: hitClamps.map((c) => [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]]),
      message: 'The cut goes into a clamp. Move your drawing away from the grey clamp areas.',
    });
  }

  // ---- Stay on the board ----
  const cutMoves = m.list.filter((v) => v.z < 0);
  if (cutMoves.length) {
    const xs = cutMoves.map((v) => v.x);
    const ys = cutMoves.map((v) => v.y);
    const gap = cut.marginMm ?? 0;
    const off = Math.min(...xs) - r < gap - 1e-6 || Math.min(...ys) - r < gap - 1e-6
      || Math.max(...xs) + r > board.w - gap + 1e-6 || Math.max(...ys) + r > board.h - gap + 1e-6;
    if (off) warnings.push({ code: 'offBoard', message: `Part of the cut is off the board or closer than ${gap} mm to its edge. Move it in.` });
  }
  if (!m.list.length) warnings.push({ code: 'empty', message: 'Nothing to cut yet. Give a shape a job.' });

  return { moves: m.list, warnings, pocketFill, bitRadius: r, tabs: planTabs };
}

const TAB_SNAP_MM = 25; // a placed tab snaps to the nearest cut line within this distance
const CLAMP_CLEAR_MM = 2; // keep the bit's edge this far from a clamp

/** The point `s` mm along a closed loop. */
export function pointAtLength(loop, s) {
  let left = s;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (left <= len || i === loop.length - 1) {
      const f = len ? Math.min(1, left / len) : 0;
      return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
    }
    left -= len;
  }
  return loop[0];
}

/** Nearest point of a closed loop to `pt`: how far along (s) and how far away (dist). */
export function projectOnLoop(loop, pt) {
  let best = { s: 0, dist: Infinity };
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / len2)) : 0;
    const d = Math.hypot(pt[0] - p[0] - t * dx, pt[1] - p[1] - t * dy);
    if (d < best.dist) best = { s: s + t * Math.sqrt(len2), dist: d };
    s += Math.sqrt(len2);
  }
  return best;
}

// The same loop, starting at the point `s` mm along it.
function rotateAtLength(loop, s) {
  let left = s;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (left < len) {
      const f = left / len;
      const start = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
      const rest = loop.slice(i + 1).concat(loop.slice(0, i + 1));
      return f > 1e-6 ? [start, ...rest] : rest.slice(-1).concat(rest.slice(0, -1));
    }
    left -= len;
  }
  return loop;
}

/** True when any move below the safe height comes within `pad` mm of the rectangle. */
export function moveNearRect(moves, c, pad, safeZ) {
  const x0 = c.x - pad;
  const y0 = c.y - pad;
  const x1 = c.x + c.w + pad;
  const y1 = c.y + c.h + pad;
  const inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
  let prev = null;
  for (const v of moves) {
    if (v.x !== null && v.z < safeZ - 1e-6) {
      if (inside(v.x, v.y)) return true;
      if (prev && prev.x !== null) {
        const n = Math.ceil(Math.hypot(v.x - prev.x, v.y - prev.y) / 0.5);
        for (let k = 1; k < n; k++) if (inside(prev.x + ((v.x - prev.x) * k) / n, prev.y + ((v.y - prev.y) * k) / n)) return true;
      }
    }
    prev = v;
  }
  return false;
}

/** Rough run time in seconds: straight-line moves at their feed, rapids at the machine's speed. */
export function estimateSeconds(moves, feeds, rapid = { xy: 5000, z: 1500 }) {
  let t = 0;
  let prev = null;
  for (const v of moves) {
    if (prev && prev.x !== null) {
      const dxy = Math.hypot(v.x - prev.x, v.y - prev.y);
      const dz = Math.abs(v.z - prev.z);
      if (v.k === 'rapid') t += Math.max(dxy / rapid.xy, dz / rapid.z) * 60;
      else if (v.k === 'plunge') t += (Math.hypot(dxy, dz) / feeds.plunge) * 60;
      else t += (Math.hypot(dxy, dz) / feeds.feed) * 60;
    }
    prev = v;
  }
  return t * 1.1; // corners slow the machine down a little
}
