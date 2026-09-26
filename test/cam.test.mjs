import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToPolylines, parseTransform, apply, lengthToMm, shapeToPath } from '../shared/svg-path.js';
import { area, union, offset } from '../shared/geometry.js';
import { planCut, passDepths, estimateSeconds } from '../shared/cam.js';
import { writeGcode } from '../shared/gcode.js';
import { checkGcode } from '../shared/check-gcode.js';

const square = (x, y, s) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const board = { w: 200, h: 150, t: 12 };
const bit = { diameter: 3.175 };
const cut = {
  depthPerPass: 1.5, stepover: 0.4, safeZ: 5, throughMm: 0.3, engraveDepth: 1, pocketDepth: 3, marginMm: 5, climb: false,
  tabs: { width: 6, height: 3 },
};
const feeds = { feed: 1000, plunge: 250, rpm: 18000 };
const limits = { board, maxThroughMm: 0.5, maxFeed: 2500 };

test('path data: lines, relative moves, implicit lineto, close', () => {
  const [pl] = pathToPolylines('M10 10 h20 v20 l-20 0 z');
  assert.equal(pl.closed, true);
  assert.deepEqual(pl.points, [[10, 10], [30, 10], [30, 30], [10, 30]]);
  const [b] = pathToPolylines('m0,0 10,0 0,10');
  assert.deepEqual(b.points, [[0, 0], [10, 0], [10, 10]]);
});

test('path data: a circle made of arcs has the right area', () => {
  const [c] = pathToPolylines(shapeToPath('circle', { cx: '0', cy: '0', r: '25' }), 0.01);
  assert.equal(c.closed, true);
  assert.ok(Math.abs(Math.abs(area(c.points)) - Math.PI * 625) < 3, `area ${area(c.points)}`);
});

test('path data: arc flags without spaces, cubic curve ends on its end point', () => {
  const [a] = pathToPolylines('M0 0a5 5 0 0010 0');
  assert.deepEqual(a.points.at(-1), [10, 0]);
  const [c] = pathToPolylines('M0 0C0 10 10 10 10 0');
  assert.deepEqual(c.points.at(-1), [10, 0]);
  assert.ok(c.points.length > 4);
});

test('transforms and units', () => {
  const m = parseTransform('translate(10 20) scale(2)');
  assert.deepEqual(apply(m, [1, 1]), [12, 22]);
  const r = parseTransform('rotate(90 5 5)');
  const p = apply(r, [10, 5]);
  assert.ok(Math.abs(p[0] - 5) < 1e-9 && Math.abs(p[1] - 10) < 1e-9);
  assert.equal(lengthToMm('1in'), 25.4);
  assert.equal(lengthToMm('96'), 25.4);
  assert.equal(lengthToMm('50mm'), 50);
});

test('pass depths: equal steps, never deeper than asked', () => {
  assert.deepEqual(passDepths(12.3, 1.5), [-1.367, -2.733, -4.1, -5.467, -6.833, -8.2, -9.567, -10.933, -12.3]);
  assert.deepEqual(passDepths(1, 1.5), [-1]);
});

test('cut out: bit goes around the outside, through the board, with tabs', () => {
  const plan = planCut({ shapes: [{ points: square(50, 50, 50), closed: true, job: 'cutout' }], board, bit, cut });
  assert.deepEqual(plan.warnings, []);
  const deep = plan.moves.filter((v) => v.z < 0);
  const xs = deep.map((v) => v.x);
  // Tool centre is one radius outside the square.
  assert.ok(Math.abs(Math.min(...xs) - (50 - 1.5875)) < 0.01);
  assert.ok(Math.abs(Math.max(...xs) - (100 + 1.5875)) < 0.01);
  assert.equal(Math.min(...deep.map((v) => v.z)), -12.3);
  // Tabs: the bit rises to 3 mm above the bottom on the deep passes.
  assert.ok(deep.some((v) => v.z === -9), 'tab height reached');
  // Conventional milling for an outside cut: counter-clockwise around the part.
  const lap = deep.filter((v) => v.z === -1.367);
  assert.ok(area(lap.map((v) => [v.x, v.y])) > 0);
});

test('order: engrave, then holes, then the part around them', () => {
  const shapes = [
    { points: square(40, 40, 80), closed: true, job: 'cutout' },
    { points: square(60, 60, 20), closed: true, job: 'hole' },
    { points: [[45, 110], [115, 110]], closed: false, job: 'engrave' },
  ];
  const plan = planCut({ shapes, board, bit, cut });
  assert.deepEqual(plan.warnings, []);
  const firstDeep = (pred) => plan.moves.findIndex((v) => v.z < 0 && pred(v));
  const engrave = firstDeep((v) => v.y === 110);
  const hole = firstDeep((v) => v.x > 60 && v.x < 80 && v.y > 60 && v.y < 80);
  const outside = firstDeep((v) => v.x < 40);
  assert.ok(engrave >= 0 && engrave < hole && hole < outside, `${engrave} ${hole} ${outside}`);
  // Engrave depth is 1 mm, one pass.
  assert.ok(plan.moves.filter((v) => v.y === 110 && v.z < 0).every((v) => v.z === -1));
});

test('warnings: hole smaller than the bit, off the board, detail too small', () => {
  const tiny = planCut({ shapes: [{ points: square(50, 50, 2), closed: true, job: 'hole' }], board, bit, cut });
  assert.ok(tiny.warnings.some((w) => w.code === 'tooSmall'));
  const off = planCut({ shapes: [{ points: square(-10, 50, 30), closed: true, job: 'cutout' }], board, bit, cut });
  assert.ok(off.warnings.some((w) => w.code === 'offBoard'));
  // A 1 mm wide slot into a cut out part: the bit cannot get in.
  const comb = [[50, 50], [100, 50], [100, 100], [75.5, 100], [75.5, 70], [74.5, 70], [74.5, 100], [50, 100]];
  const c = planCut({ shapes: [{ points: comb, closed: true, job: 'cutout' }], board, bit, cut });
  assert.ok(c.warnings.some((w) => w.code === 'detail'));
});

test('pocket: stays inside the line, reaches the depth, clears the middle', () => {
  const plan = planCut({ shapes: [{ points: square(50, 50, 40), closed: true, job: 'pocket', depth: 3 }], board, bit, cut });
  assert.deepEqual(plan.warnings, []);
  const deep = plan.moves.filter((v) => v.z < 0);
  assert.equal(Math.min(...deep.map((v) => v.z)), -3);
  for (const v of deep) assert.ok(v.x >= 50 + 1.58 && v.x <= 90 - 1.58 && v.y >= 50 + 1.58 && v.y <= 90 - 1.58);
  // Middle is visited (innermost loop is near the centre).
  assert.ok(deep.some((v) => Math.abs(v.x - 70) < 2 && Math.abs(v.y - 70) < 2));
});

test('G-code: own output passes the checker; time estimate is sane', () => {
  const shapes = [{ points: square(50, 50, 50), closed: true, job: 'cutout' }, { points: square(60, 60, 30), closed: true, job: 'pocket' }];
  const plan = planCut({ shapes, board, bit, cut });
  const g = writeGcode({ moves: plan.moves, feeds, safeZ: cut.safeZ, notes: ['uploadmycut test (x)'] });
  assert.match(g, /^\(uploadmycut test x\)\nG90 G94\nG17\nG21\nG0 Z5\nM3 S18000\n/);
  assert.match(g, /M5\nM30\n$/);
  const r = checkGcode(g, limits);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.minZ, -12.3);
  const s = estimateSeconds(plan.moves, feeds);
  assert.ok(s > 60 && s < 3600, `${s} s`);
});

test('checker refuses dangerous files', () => {
  const ok = 'G21 G90\nG0 Z5\nG0 X10 Y10\nG1 Z-1 F200\nG1 X20 F1000\nG0 Z5\n';
  assert.deepEqual(checkGcode(ok, limits).errors, []);
  const bad = {
    '$H': '$H\n',
    '$ setting': '$110=9000\n',
    'G28': 'G28\n',
    'G92': 'G92 X0 Y0\n',
    'relative': 'G91\nG1 X10 F100\n',
    'tool change': 'T1 M6\n',
    'rapid into wood': 'G0 Z5\nG0 X10 Y10\nG0 Z-1\n',
    'rapid sideways in wood': 'G0 Z5\nG0 X10 Y10\nG1 Z-1 F200\nG0 X20\n',
    'too deep': 'G0 Z5\nG0 X10 Y10\nG1 Z-13 F200\n',
    'too fast': 'G0 Z5\nG0 X10 Y10\nG1 Z-1 F5000\n',
    'off board': 'G0 Z5\nG0 X10 Y10\nG1 Z-1 F200\nG1 X250 F1000\n',
    'inch file too deep': 'G20\nG0 Z0.2\nG0 X1 Y1\nG1 Z-0.6 F10\n',
    'no position': 'G0 Z5\nG1 Z-1 F100\n',
    'garbage': 'hello\n',
  };
  for (const [name, text] of Object.entries(bad)) assert.equal(checkGcode(text, limits).ok, false, name);
});

test('geometry: offset grows a square by the radius with round corners', () => {
  const g = offset(union([square(0, 0, 10)]), 1);
  // Arcs are short straight pieces within 10 µm of the true arc, so a hair under the exact area.
  assert.ok(Math.abs(area(g[0]) - (100 + 40 + Math.PI)) < 0.1);
});
