// SVG path data and transforms → polylines. Pure functions (no DOM), so Node tests can check them.
// web/src/svg-import.js walks the SVG file and calls these.
//
// A polyline is { points: [[x, y], ...], closed: boolean }. Curves are cut into straight pieces no
// further than `tol` from the true curve (in the path's own units; the caller scales it).

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;

/** Split path data into [{ cmd, args }] with the implicit repeats expanded. Throws on garbage. */
export function tokenizePath(d) {
  const out = [];
  let i = 0;
  let cmd = null;
  const s = String(d ?? '');
  const skip = () => {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
  };
  const number = () => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(s);
    if (!m) throw new Error(`bad number at ${i}`);
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  // Arc flags may be written with no separator: "a1 1 0 00 10 10".
  const flag = () => {
    skip();
    const c = s[i];
    if (c !== '0' && c !== '1') throw new Error(`bad arc flag at ${i}`);
    i++;
    return c === '1' ? 1 : 0;
  };
  const counts = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  for (;;) {
    skip();
    if (i >= s.length) break;
    if (COMMAND.test(s[i])) {
      cmd = s[i++];
      if (cmd === 'z' || cmd === 'Z') {
        out.push({ cmd, args: [] });
        continue;
      }
    } else if (cmd === null || cmd === 'z' || cmd === 'Z') {
      throw new Error(`path data must start with a command (at ${i})`);
    }
    const lower = cmd.toLowerCase();
    const args = [];
    for (let k = 0; k < counts[lower]; k++) args.push(lower === 'a' && (k === 3 || k === 4) ? flag() : number());
    out.push({ cmd, args });
    // A moveto followed by more pairs means lineto for the rest.
    if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
  }
  return out;
}


// Number of pieces for a cubic/quadratic so the chord error stays under tol (Wang's formula).
function bezierSteps(pts, tol) {
  let dd = 0;
  for (let k = 0; k + 2 < pts.length; k++) {
    const x = pts[k][0] - 2 * pts[k + 1][0] + pts[k + 2][0];
    const y = pts[k][1] - 2 * pts[k + 1][1] + pts[k + 2][1];
    dd = Math.max(dd, Math.hypot(x, y));
  }
  const n = pts.length - 1; // degree
  const steps = Math.ceil(Math.sqrt((n * (n - 1) * dd) / (8 * Math.max(tol, 1e-9))));
  return Math.max(1, Math.min(1000, steps));
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function quadAt(p0, p1, p2, t) {
  const u = 1 - t;
  return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]];
}

// SVG arc (endpoint form) → points after the start point. SVG spec F.6.5 / F.6.6.
function arcPoints(p0, rx, ry, phiDeg, large, sweep, p1, tol) {
  if (p0[0] === p1[0] && p0[1] === p1[1]) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return [p1];
  const phi = (phiDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cx1 = (coef * rx * y1) / ry;
  const cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dtheta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const r = Math.max(rx, ry);
  // Chord error r(1 - cos(step/2)) <= tol.
  const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)));
  const n = Math.max(2, Math.min(1000, Math.ceil(Math.abs(dtheta) / Math.max(maxStep, 1e-3))));
  const pts = [];
  for (let k = 1; k <= n; k++) {
    const t = theta1 + (dtheta * k) / n;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    pts.push([cos * x - sin * y + cx, sin * x + cos * y + cy]);
  }
  pts[pts.length - 1] = [p1[0], p1[1]];
  return pts;
}

/** Path data → polylines, in the path's own units. */
export function pathToPolylines(d, tol = 0.05) {
  const out = [];
  let cur = null; // current polyline
  let pos = [0, 0];
  let start = [0, 0];
  let lastCtrl = null; // for S/T reflection
  let lastCmd = '';
  const begin = (p) => {
    if (cur && cur.points.length > 1) out.push(cur);
    cur = { points: [p], closed: false };
    start = p;
  };
  const lineTo = (p) => {
    if (!cur) begin(pos);
    cur.points.push(p);
  };
  for (const { cmd, args } of tokenizePath(d)) {
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    const at = (x, y) => (rel ? [pos[0] + x, pos[1] + y] : [x, y]);
    let ctrl = null;
    switch (c) {
      case 'M': {
        pos = at(args[0], args[1]);
        begin(pos);
        break;
      }
      case 'L': {
        pos = at(args[0], args[1]);
        lineTo(pos);
        break;
      }
      case 'H': {
        pos = [rel ? pos[0] + args[0] : args[0], pos[1]];
        lineTo(pos);
        break;
      }
      case 'V': {
        pos = [pos[0], rel ? pos[1] + args[0] : args[0]];
        lineTo(pos);
        break;
      }
      case 'C':
      case 'S': {
        let p1;
        let p2;
        let p3;
        if (c === 'C') {
          p1 = at(args[0], args[1]);
          p2 = at(args[2], args[3]);
          p3 = at(args[4], args[5]);
        } else {
          p1 = lastCtrl && /[CS]/.test(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
          p2 = at(args[0], args[1]);
          p3 = at(args[2], args[3]);
        }
        const n = bezierSteps([pos, p1, p2, p3], tol);
        const p0 = pos;
        for (let k = 1; k <= n; k++) lineTo(k === n ? p3 : cubicAt(p0, p1, p2, p3, k / n));
        pos = p3;
        ctrl = p2;
        break;
      }
      case 'Q':
      case 'T': {
        let p1;
        let p2;
        if (c === 'Q') {
          p1 = at(args[0], args[1]);
          p2 = at(args[2], args[3]);
        } else {
          p1 = lastCtrl && /[QT]/.test(lastCmd) ? [2 * pos[0] - lastCtrl[0], 2 * pos[1] - lastCtrl[1]] : pos;
          p2 = at(args[0], args[1]);
        }
        const n = bezierSteps([pos, p1, p2], tol);
        const p0 = pos;
        for (let k = 1; k <= n; k++) lineTo(k === n ? p2 : quadAt(p0, p1, p2, k / n));
        pos = p2;
        ctrl = p1;
        break;
      }
      case 'A': {
        const end = at(args[5], args[6]);
        for (const p of arcPoints(pos, args[0], args[1], args[2], args[3], args[4], end, tol)) lineTo(p);
        pos = end;
        break;
      }
      case 'Z': {
        if (cur) {
          cur.closed = true;
          if (cur.points.length > 1) out.push(cur);
        }
        cur = null;
        pos = start;
        break;
      }
      default:
        break;
    }
    lastCtrl = ctrl;
    lastCmd = c;
  }
  if (cur && cur.points.length > 1) out.push(cur);
  return out.map(tidy).filter(Boolean);
}

// Drop repeated points; a closed polyline does not repeat its first point at the end.
function tidy(pl) {
  const pts = [];
  for (const p of pl.points) {
    const q = pts[pts.length - 1];
    if (!q || Math.abs(q[0] - p[0]) > 1e-9 || Math.abs(q[1] - p[1]) > 1e-9) pts.push(p);
  }
  if (pl.closed && pts.length > 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
  }
  if (pts.length < 2 || (pl.closed && pts.length < 3)) return null;
  return { points: pts, closed: pl.closed };
}

// ---- Transforms: [a, b, c, d, e, f] means x' = a x + c y + e, y' = b x + d y + f (like SVG). ----

export const IDENTITY = [1, 0, 0, 1, 0, 0];

export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

/** How much the transform stretches lengths (the larger axis), to scale the curve tolerance. */
export function scaleOf(m) {
  return Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3])) || 1;
}

/** Parse an SVG transform attribute. Unknown parts are ignored. */
export function parseTransform(text) {
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let hit;
  while ((hit = re.exec(String(text ?? '')))) {
    const v = (hit[2].match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
    let t = null;
    switch (hit[1]) {
      case 'matrix':
        if (v.length === 6) t = v;
        break;
      case 'translate':
        t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const r = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        if (v.length >= 3) t = multiply(multiply([1, 0, 0, 1, v[1], v[2]], r), [1, 0, 0, 1, -v[1], -v[2]]);
        else t = r;
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        break;
    }
    if (t) m = multiply(m, t);
  }
  return m;
}

/** An SVG length ("210mm", "8.5in", "300", "12pt") in millimetres, or null. User units are 96/in. */
export function lengthToMm(text) {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(mm|cm|in|pt|pc|px|q)?\s*$/i.exec(String(text ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  const per = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, q: 0.25 };
  return n * per[(m[2] ?? 'px').toLowerCase()];
}

/** Basic shape elements as path data, so everything goes through one reader. */
export function shapeToPath(tag, a) {
  const n = (k, def = 0) => {
    const v = Number.parseFloat(a[k]);
    return Number.isFinite(v) ? v : def;
  };
  switch (tag) {
    case 'rect': {
      const x = n('x');
      const y = n('y');
      const w = n('width');
      const h = n('height');
      if (!(w > 0 && h > 0)) return null;
      let rx = a.rx !== undefined ? n('rx') : a.ry !== undefined ? n('ry') : 0;
      let ry = a.ry !== undefined ? n('ry') : rx;
      rx = Math.min(Math.max(rx, 0), w / 2);
      ry = Math.min(Math.max(ry, 0), h / 2);
      if (rx === 0 || ry === 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}`
        + `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`
        + `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case 'circle':
    case 'ellipse': {
      const cx = n('cx');
      const cy = n('cy');
      const rx = tag === 'circle' ? n('r') : n('rx');
      const ry = tag === 'circle' ? n('r') : n('ry');
      if (!(rx > 0 && ry > 0)) return null;
      return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;
    }
    case 'line':
      return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
    case 'polyline':
    case 'polygon': {
      const v = (String(a.points ?? '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []).map(Number);
      if (v.length < 4) return null;
      let d = `M${v[0]} ${v[1]}`;
      for (let k = 2; k + 1 < v.length; k += 2) d += `L${v[k]} ${v[k + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    default:
      return null;
  }
}
