// Clamp zones and placed tabs (2026-09-26 refinements).
import assert from 'node:assert/strict';
import test from 'node:test';
import { planCut, projectOnLoop, pointAtLength, moveNearRect } from '../shared/cam.js';
import { writeGcode } from '../shared/gcode.js';
import { checkGcode } from '../shared/check-gcode.js';
import { makePart, designTabPoints, toBoard } from '../shared/design.js';
import { DEFAULT_CLASS_CONFIG, clampRects, validateClassConfig } from '../shared/settings.js';

const sq = (x, y, w, h = w) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const board = { w: 200, h: 150, t: 12 };
const bit = { diameter: 3.175 };
const cut = {
  depthPerPass: 1, stepover: 0.4, safeZ: 5, throughMm: 0.3, engraveDepth: 1, pocketDepth: 3, pocketMaxDepth: 6,
  marginMm: 5, climb: false, tabs: { width: 6, height: 2.5 },
};
const tabZ = -12 + 2.5;

test('clamp layouts make the right rectangles; old setups without clamps still load', () => {
  const m = { w: 200, h: 150, clampLayout: 'corners', clampSize: 30 };
  assert.deepEqual(clampRects(m).map((r) => [r.x, r.y]), [[0, 0], [170, 0], [0, 120], [170, 120]]);
  assert.equal(clampRects({ ...m, clampLayout: 'sides' }).length, 2);
  assert.deepEqual(clampRects({ ...m, clampLayout: 'none' }), []);
  const old = structuredClone(DEFAULT_CLASS_CONFIG);
  for (const x of old.materials) { delete x.clampLayout; delete x.clampSize; }
  const v = validateClassConfig(old);
  assert.equal(v.ok, true);
  assert.equal(v.config.materials[0].clampLayout, 'none');
  const huge = structuredClone(DEFAULT_CLASS_CONFIG);
  huge.materials[0].clampLayout = 'corners';
  huge.materials[0].clampSize = 80; // 80 x 2 >= 140 wide pine
  assert.equal(validateClassConfig(huge).ok, false);
});

test('a cut near a clamp is a blocking warning; clear of it is fine', () => {
  const clamps = clampRects({ w: 200, h: 150, clampLayout: 'corners', clampSize: 30 });
  const near = planCut({ shapes: [{ points: sq(28, 60, 40), closed: true, job: 'cutout' }], board, bit, cut: { ...cut, clamps } });
  assert.deepEqual(near.warnings.map((w) => w.code), []);
  const into = planCut({ shapes: [{ points: sq(20, 20, 40), closed: true, job: 'cutout' }], board, bit, cut: { ...cut, clamps } });
  assert.ok(into.warnings.some((w) => w.code === 'clamp'));
  // The checker refuses the same file on its own.
  const g = writeGcode({ moves: into.moves, feeds: { feed: 900, plunge: 300, rpm: 17000 }, safeZ: 5 });
  const r = checkGcode(g, { board, maxThroughMm: 0.35, maxFeed: 900, safeZ: 5, clamps });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /clamp/.test(e.message)));
  assert.equal(moveNearRect([{ x: 50, y: 50, z: 5 }, { x: 60, y: 60, z: 5 }], { x: 40, y: 40, w: 30, h: 30 }, 0, 5), false, 'travel at safe height is fine');
});

test('loop helpers: project a point, find the point at a length', () => {
  const loop = sq(0, 0, 10);
  assert.deepEqual(pointAtLength(loop, 15), [10, 5]);
  const p = projectOnLoop(loop, [12, 7]);
  assert.ok(Math.abs(p.s - 17) < 1e-9 && Math.abs(p.dist - 2) < 1e-9, JSON.stringify(p));
});

test('the planner reports where tabs go; a placed tab moves the tab there and no others appear', () => {
  const shapes = [{ points: sq(50, 50, 60), closed: true, job: 'cutout' }];
  const auto = planCut({ shapes, board, bit, cut });
  assert.equal(auto.tabs.length, 2);
  // Put one tab on the middle of the front edge (y = 50, the bit path is at y = 48.41).
  const placed = planCut({ shapes, board, bit, cut: { ...cut, tabPoints: [[80, 49]] } });
  assert.equal(placed.tabs.length, 1);
  assert.ok(Math.abs(placed.tabs[0].x - 80) < 0.05 && Math.abs(placed.tabs[0].y - (50 - 1.5875)) < 0.05, JSON.stringify(placed.tabs));
  // The lap really lifts over that spot on the deep passes, and nowhere else.
  const up = placed.moves.filter((v) => v.z === tabZ);
  assert.ok(up.length > 0 && up.every((v) => Math.abs(v.y - 48.41) < 0.05 && Math.abs(v.x - 80) < 6), JSON.stringify(up.slice(0, 4)));
  // A tab placed on the loop's start is moved off the seam, not lost.
  const seam = planCut({ shapes, board, bit, cut: { ...cut, tabPoints: [[auto.moves.find((v) => v.z < 0).x, auto.moves.find((v) => v.z < 0).y]] } });
  assert.equal(seam.tabs.length, 1);
  // Tabs far from any cut line are ignored.
  assert.equal(planCut({ shapes, board, bit, cut: { ...cut, tabPoints: [[5, 5]] } }).tabs.length, 2);
});

test('placed tabs move and turn with the part', () => {
  const p = makePart({ name: 'x', kind: 'shape', flipY: false, lines: [{ points: sq(0, 0, 20), closed: true }] });
  p.tabs = [[10, 0]];
  p.x = 100;
  p.y = 100;
  p.rotation = 90;
  const [pt] = designTabPoints([p]);
  const [expect] = toBoard(p, [[10, 0]]);
  assert.deepEqual(pt, expect);
  assert.ok(Math.abs(pt[0] - 100) < 1e-9 && Math.abs(pt[1] - 110) < 1e-9, JSON.stringify(pt));
});
