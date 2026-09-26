// An SVG file → lines in millimetres (SVG orientation: y down). The path maths is in
// shared/svg-path.js; this file walks the document (groups, transforms, <use>) in the browser.

import {
  IDENTITY, apply, lengthToMm, multiply, parseTransform, pathToPolylines, scaleOf, shapeToPath,
} from '../../shared/svg-path.js';

const TOL_MM = 0.02; // curves become straight pieces within 20 µm of the curve
const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'metadata', 'title', 'desc', 'style', 'script', 'marker', 'pattern', 'linearGradient', 'radialGradient', 'filter', 'foreignObject']);
const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);
const MAX_LINES = 5000;
const MAX_POINTS = 400_000;

function attrs(elem) {
  const a = {};
  for (const at of elem.attributes) a[at.name] = at.value;
  return a;
}

function hidden(elem) {
  const style = elem.getAttribute('style') ?? '';
  return elem.getAttribute('display') === 'none' || /display\s*:\s*none/.test(style)
    || elem.getAttribute('visibility') === 'hidden' || /visibility\s*:\s*hidden/.test(style);
}

// Root user units → mm: width/height with units, scaled by the viewBox. No width = 96 px per inch.
function rootTransform(svg) {
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasVb = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0;
  const wMm = lengthToMm(svg.getAttribute('width'));
  const hMm = lengthToMm(svg.getAttribute('height'));
  if (!hasVb) return [25.4 / 96, 0, 0, 25.4 / 96, 0, 0];
  let sx = wMm ? wMm / vb[2] : hMm ? hMm / vb[3] : 25.4 / 96;
  let sy = hMm ? hMm / vb[3] : sx;
  if (!wMm) sx = sy;
  // preserveAspectRatio "none" is rare in drawings; keep the shape square instead.
  const s = Math.min(sx, sy);
  return [s, 0, 0, s, -vb[0] * s, -vb[1] * s];
}

/**
 * @returns {{ lines: {points: number[][], closed: boolean}[], notes: string[] }}
 * Throws Error with a student-friendly message when the file cannot be used.
 */
export function importSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.nodeName.toLowerCase() !== 'svg') {
    throw new Error('That file is not a drawing this page can read. Save it as SVG and try again.');
  }
  const byId = new Map();
  for (const e of doc.querySelectorAll('[id]')) byId.set(e.getAttribute('id'), e);
  const lines = [];
  const notes = new Set();
  let points = 0;

  function walk(elem, m, depth) {
    if (depth > 40 || lines.length > MAX_LINES) return;
    const tag = elem.localName;
    if (SKIP.has(tag) || hidden(elem)) return;
    const mine = multiply(m, parseTransform(elem.getAttribute('transform')));
    if (tag === 'text') {
      notes.add('Text in the file was left out. In Inkscape use Path → Object to Path first, or type it here with the Text button.');
      return;
    }
    if (tag === 'image') {
      notes.add('Pictures inside the file were left out. Only lines and shapes can be cut.');
      return;
    }
    if (tag === 'use') {
      const ref = (elem.getAttribute('href') ?? elem.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').replace(/^#/, '');
      const target = byId.get(ref);
      if (!target || target === elem) return;
      const x = Number.parseFloat(elem.getAttribute('x') ?? '0') || 0;
      const y = Number.parseFloat(elem.getAttribute('y') ?? '0') || 0;
      const t = multiply(mine, [1, 0, 0, 1, x, y]);
      if (target.localName === 'symbol') for (const c of target.children) walk(c, t, depth + 1);
      else walk(target, t, depth + 1);
      return;
    }
    if (SHAPES.has(tag)) {
      const d = tag === 'path' ? elem.getAttribute('d') : shapeToPath(tag, attrs(elem));
      if (!d) return;
      let pls;
      try {
        pls = pathToPolylines(d, TOL_MM / scaleOf(mine));
      } catch {
        notes.add('One shape in the file was damaged and was left out.');
        return;
      }
      for (const pl of pls) {
        points += pl.points.length;
        if (points > MAX_POINTS) throw new Error('That drawing has too much detail to cut. Simplify it, or pick a simpler one.');
        lines.push({ points: pl.points.map((p) => apply(mine, p)), closed: pl.closed });
      }
      return;
    }
    for (const c of elem.children) walk(c, mine, depth + 1);
  }

  walk(svg, multiply(rootTransform(svg), IDENTITY), 0);
  if (!lines.length) throw new Error('No lines or shapes were found in that drawing.');
  return { lines, notes: [...notes] };
}
