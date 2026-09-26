import assert from 'node:assert/strict';
import test from 'node:test';
import { revivePart, autoJobs, autoJobsByFill, fitOnBoard, makePart, partBounds, withBorder, hitTest, designShapes } from '../shared/design.js';
import { DEFAULT_CLASS_CONFIG, validateClassConfig, ncFileName, rpmFor } from '../shared/settings.js';

const sq = (x, y, s, cw = false) => {
  const p = [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
  return cw ? p.reverse() : p;
};

test('autoJobs: outside cut out, inside hole, island inside a hole cut out, open line engraved', () => {
  const lines = [{ points: sq(0, 0, 100), closed: true }, { points: sq(10, 10, 50), closed: true }, { points: sq(20, 20, 10), closed: true }, { points: [[0, 0], [5, 5]], closed: false }];
  assert.deepEqual(autoJobs(lines), ['cutout', 'hole', 'cutout', 'engrave']);
});

test('autoJobsByFill: overlapping letters stay cut outs, the centre (wound the other way) is a hole', () => {
  // Two overlapping CCW "letters"; the second has a CW centre.
  const lines = [{ points: sq(0, 0, 32), closed: true }, { points: sq(20, 5, 30), closed: true }, { points: sq(30, 15, 10, true), closed: true }];
  assert.deepEqual(autoJobsByFill(lines), ['cutout', 'cutout', 'hole']);
  // autoJobs (nesting) would get the overlap wrong: the second square starts inside the first.
  assert.equal(autoJobs(lines)[1], 'hole');
});

test('makePart centres the drawing and flips SVG y', () => {
  const p = makePart({ name: 'x', kind: 'svg', lines: [{ points: [[10, 10], [30, 10], [30, 20], [10, 20]], closed: true }] });
  const b = partBounds(p);
  assert.deepEqual([b.minX, b.maxX, b.minY, b.maxY], [-10, 10, -5, 5]);
});

test('withBorder adds an outline around everything; letters become pocket', () => {
  const p = makePart({ name: 't', kind: 'text', fill: 'nonzero', flipY: false, lines: [{ points: sq(0, 0, 20), closed: true }, { points: sq(5, 5, 10, true), closed: true }] });
  const b = withBorder(p, 4);
  assert.equal(b.lines.length, 3);
  assert.deepEqual(b.jobs, ['pocket', 'pocket', 'cutout']);
  const bb = partBounds({ ...b, lines: [b.lines[2]] });
  assert.ok(Math.abs(bb.w - 28) < 0.05, String(bb.w));
});

test('fitOnBoard shrinks and slides a part back inside the margin', () => {
  const p = makePart({ name: 'x', kind: 'shape', flipY: false, lines: [{ points: sq(0, 0, 200), closed: true }] });
  p.x = 10;
  p.y = 10;
  assert.equal(fitOnBoard(p, { w: 140, h: 200 }, 10), true);
  const b = partBounds(p);
  assert.ok(b.minX >= 10 - 1e-6 && b.maxX <= 130 + 1e-6 && b.minY >= 10 - 1e-6 && b.maxY <= 190 + 1e-6, JSON.stringify(b));
});

test('hitTest finds a line, then the smallest shape around the point', () => {
  const p = makePart({ name: 'x', kind: 'shape', flipY: false, lines: [{ points: sq(0, 0, 100), closed: true }, { points: sq(40, 40, 20), closed: true }] });
  p.x = 100;
  p.y = 100;
  assert.equal(hitTest([p], [100, 100], 1).line, 1); // inside the small square
  assert.equal(hitTest([p], [60, 100], 1).line, 0); // inside only the big one
  assert.equal(hitTest([p], [50.5, 100], 1).onLine, true); // on the big square's left edge
  assert.equal(hitTest([p], [5, 5], 1), null);
  assert.equal(designShapes([p], 3)[0].fill, 'evenodd');
});

test('class setup: defaults pass; out-of-range values are refused', () => {
  assert.equal(validateClassConfig(DEFAULT_CLASS_CONFIG).ok, true);
  const fast = structuredClone(DEFAULT_CLASS_CONFIG);
  fast.materials[0].feed = 99999;
  assert.equal(validateClassConfig(fast).ok, false);
  const big = structuredClone(DEFAULT_CLASS_CONFIG);
  big.materials[0].w = 1000; // bigger than a Shapeoko 3
  assert.equal(validateClassConfig(big).ok, false);
  const none = structuredClone(DEFAULT_CLASS_CONFIG);
  none.jobs = { cutout: false, hole: false, engrave: false, pocket: false };
  assert.equal(validateClassConfig(none).ok, false);
  assert.equal(validateClassConfig({ ...DEFAULT_CLASS_CONFIG, note: 'x'.repeat(1000) }).config.note.length, 400);
});

test('file names and router rpm', () => {
  assert.equal(ncFileName('Keychain & Sign!'), 'Keychain-Sign.nc');
  assert.equal(ncFileName('../../etc/passwd'), 'etcpasswd.nc');
  assert.equal(ncFileName(''), 'my-cut.nc');
  assert.equal(rpmFor(DEFAULT_CLASS_CONFIG, { dial: 3 }), 17000);
  assert.equal(rpmFor(DEFAULT_CLASS_CONFIG, { dial: 3.5 }), 19500);
});

test('revivePart: a saved part comes back with a new id; damaged ones are dropped', () => {
  const p = makePart({ name: 'x', kind: 'text', fill: 'nonzero', flipY: false, lines: [{ points: sq(0, 0, 10), closed: true }] });
  p.x = 50;
  const back = revivePart(structuredClone(p));
  assert.notEqual(back.id, p.id);
  assert.deepEqual({ ...back, id: 0 }, { ...p, id: 0 });
  assert.equal(revivePart({ ...p, jobs: ['explode'] }), null);
  assert.equal(revivePart({ ...p, scale: -1 }), null);
  assert.equal(revivePart({ ...p, lines: [{ points: [[0, NaN], [1, 1]], closed: false }] }), null);
  assert.equal(revivePart(p, { points: 3 }), null); // over the point budget
  assert.equal(revivePart('<script>'), null);
});
