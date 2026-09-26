// 2D geometry for the cutting plan, in millimetres. Board coordinates: x to the right, y away from
// the student (toward the back of the machine), origin at the board's front-left corner. So a
// polygon with positive area runs counter-clockwise, seen from above.
//
// Offsets and unions go through clipper-lib (Angus Johnson's Clipper 6, Boost licence), which
// works in integers: 1 unit = 1 µm here.

import ClipperLib from 'clipper-lib';

export const SCALE = 1000; // Clipper units per mm
const ARC_TOL_MM = 0.01; // round corners of offsets stay within 10 µm of a true arc

const FILL = { nonzero: ClipperLib.PolyFillType.pftNonZero, evenodd: ClipperLib.PolyFillType.pftEvenOdd };

export function toClip(polys) {
  return polys.map((pts) => pts.map(([x, y]) => ({ X: Math.round(x * SCALE), Y: Math.round(y * SCALE) })));
}

export function fromClip(paths) {
  return paths.filter((p) => p.length >= 3).map((p) => p.map((q) => [q.X / SCALE, q.Y / SCALE]));
}

/** Signed area in mm² (positive = counter-clockwise). */
export function area(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function totalArea(polys) {
  return polys.reduce((s, p) => s + area(p), 0);
}

function clip(type, subject, clipPolys, fill) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toClip(subject), ClipperLib.PolyType.ptSubject, true);
  if (clipPolys.length) c.AddPaths(toClip(clipPolys), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, FILL[fill], FILL[fill]);
  return fromClip(out);
}

/** Merge polygons into clean outer (CCW) and hole (CW) contours. */
export function union(polys, fill = 'nonzero') {
  return clip(ClipperLib.ClipType.ctUnion, polys, [], fill);
}

export function difference(a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toClip(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(toClip(b), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctDifference, out, FILL.nonzero, FILL.nonzero);
  return fromClip(out);
}

export function intersection(a, b) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(toClip(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(toClip(b), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, out, FILL.nonzero, FILL.nonzero);
  return fromClip(out);
}

/**
 * Grow (+) or shrink (-) a region by `d` mm with round corners. Input must already be clean
 * (the output of union()). Output keeps Clipper's orientation: outer contours CCW, holes CW.
 */
export function offset(region, d) {
  if (!region.length) return [];
  if (d === 0) return region.map((p) => p.slice());
  // Shrinking never joins separate pieces, so each outside edge (with its own holes) can go on its
  // own: several times faster in clipper-lib for drawings with many small shapes.
  if (d < 0 && region.length > 1) {
    const groups = groupByOutside(region);
    if (groups.length > 1) return groups.flatMap((g) => offsetOnce(g, d));
  }
  return offsetOnce(region, d);
}

function offsetOnce(region, d) {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL_MM * SCALE);
  co.AddPaths(toClip(region), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out = new ClipperLib.Paths();
  co.Execute(out, d * SCALE);
  return fromClip(out);
}

// Clean contours (union output) → [outside edge, ...its holes] groups. A hole belongs to the
// smallest outside edge around it.
function groupByOutside(region) {
  const outs = [];
  const holes = [];
  for (const p of region) (area(p) > 0 ? outs : holes).push(p);
  const groups = outs.map((p) => ({ box: bounds([p]), a: area(p), polys: [p] }));
  for (const h of holes) {
    const hb = bounds([h]);
    let best = null;
    for (const g of groups) {
      if (hb.minX < g.box.minX || hb.maxX > g.box.maxX || hb.minY < g.box.minY || hb.maxY > g.box.maxY) continue;
      if (!pointInRegion(h[0], [g.polys[0]])) continue;
      if (!best || g.a < best.a) best = g;
    }
    if (best) best.polys.push(h);
    else return [region]; // unexpected shape: do it all in one go
  }
  return groups.map((g) => g.polys);
}

/** The area a round bit of radius `r` sweeps along an open or closed line. */
export function strokeRegion(line, closed, r) {
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL_MM * SCALE);
  co.AddPaths(toClip([line]), ClipperLib.JoinType.jtRound, closed ? ClipperLib.EndType.etClosedLine : ClipperLib.EndType.etOpenRound);
  const out = new ClipperLib.Paths();
  co.Execute(out, r * SCALE);
  return fromClip(out);
}

/** Even-odd point in polygon set (holes count). */
export function pointInRegion(pt, region) {
  let inside = false;
  const [x, y] = pt;
  for (const poly of region) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when the straight segment a→b stays inside the region (crosses no edge, middle inside). */
export function segmentInside(a, b, region) {
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (!pointInRegion(mid, region)) return false;
  for (const poly of region) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (segmentsCross(a, b, poly[j], poly[i])) return false;
    }
  }
  return true;
}

export function bounds(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polys) {
    for (const [x, y] of p) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pathLength(pts, closed) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) s += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return s;
}

/**
 * Pieces of `lost` that matter: at least `minWidth` mm wide somewhere (thin slivers from rounding
 * and the tiny rounded inside corners every round bit leaves are dropped).
 */
export function significant(lost, minWidth) {
  // Rounding slivers (thousands of them between a circle and the bit's path) cannot hold a
  // minWidth circle if their box is thinner than that: drop them before the slow offsets.
  const pieces = lost.filter((p) => {
    const b = bounds([p]);
    return Math.min(b.w, b.h) >= minWidth && Math.abs(area(p)) >= (Math.PI * minWidth * minWidth) / 4;
  });
  if (!pieces.length) return [];
  const merged = union(pieces);
  const core = offset(merged, -minWidth / 2);
  if (!core.length) return [];
  return intersection(merged, offset(core, minWidth / 2 + 0.01));
}

// Ramer-Douglas-Peucker on an open run of points: keeps every point further than tol from the
// simplified line. Iterative, so a 400,000-point line cannot overflow the stack.
function rdp(pts, tol) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tol * tol;
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const len2 = dx * dx + dy * dy;
    let best = -1;
    let bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][0] - ax;
      const py = pts[i][1] - ay;
      let d2;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Fewer points, same shape within `tol` mm. Drawings often carry far more points than a router
 * can follow (one every 0.02 mm), and every later step costs time per point.
 */
export function simplifyLine(pts, closed, tol = 0.01) {
  if (pts.length < 4) return pts;
  if (!closed) return rdp(pts, tol);
  // Closed: split at the point furthest from the first, simplify both halves.
  let far = 0;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp([...pts.slice(far), pts[0]], tol);
  const out = a.concat(b.slice(1, -1));
  return out.length >= 3 ? out : pts;
}

/** Up to n points spread along a line (all of them if it has fewer). */
export function samplePoints(pts, n) {
  if (pts.length <= n) return pts;
  return Array.from({ length: n }, (_, i) => pts[Math.floor((i * pts.length) / n)]);
}

/** True when every sampled point of `inner` is inside the closed line `outer`. */
export function containsAll(outer, inner, n = 32) {
  return samplePoints(inner, n).every((p) => pointInRegion(p, [outer]));
}

export function pointInBox([x, y], b) {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

export function boxOf(pts) {
  return bounds([pts]);
}

export function boxInside(inner, outer) {
  return inner.minX >= outer.minX && inner.maxX <= outer.maxX && inner.minY >= outer.minY && inner.maxY <= outer.maxY;
}

/** Drop points closer than `tol` mm to the line through their neighbours (Clipper's CleanPolygon). */
export function simplify(pts, tol = 0.005) {
  const out = ClipperLib.Clipper.CleanPolygon(toClip([pts])[0], tol * SCALE);
  return out.map((q) => [q.X / SCALE, q.Y / SCALE]);
}
