// Clamp zones and placed tabs (2026-09-26 refinements).
import assert from 'node:assert/strict';
import test from 'node:test';
import { planCut, projectOnLoop, pointAtLength, moveNearRect } from '../shared/cam.js';
import { writeGcode } from '../shared/gcode.js';
import { checkGcode } from '../shared/check-gcode.js';
import { makePart, designTabPoints, toBoard } from '../shared/design.js';
import { DEFAULT_CLASS_CONFIG, V_CARVE_ENABLED, clampRects, validateClassConfig } from '../shared/settings.js';

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

import { gridSpots, keychainPart, doorSignPart, ornamentPart, partBounds, placeOnBoard, designShapes } from '../shared/design.js';

const plan = (parts, b = { w: 200, h: 200, t: 6 }) => planCut({ shapes: designShapes(parts, 3), board: b, bit, cut: { ...cut, pocketMaxDepth: 3 } });

test('copies: a grid from the front-left, inside the edges, skipping clamps, never overlapping', () => {
  const p = makePart({ name: 'x', kind: 'shape', flipY: false, lines: [{ points: sq(0, 0, 30), closed: true }] });
  const spots = gridSpots(p, 50, { w: 200, h: 150 }, 10, 8);
  // 30 wide + 8 gap: 4 across (10..168), 3 down (10..124).
  assert.equal(spots.length, 12);
  assert.deepEqual(spots[0], { x: 25, y: 25 });
  const clamps = clampRects({ w: 200, h: 150, clampLayout: 'corners', clampSize: 30 });
  const clear = gridSpots(p, 50, { w: 200, h: 150 }, 10, 8, clamps, 5);
  assert.ok(clear.length < 12 && clear.length > 0);
  assert.ok(clear.every((s) => !clamps.some((c) => s.x - 15 < c.x + c.w + 5 && s.x + 15 > c.x - 5 && s.y - 15 < c.y + c.h + 5 && s.y + 15 > c.y - 5)));
  assert.equal(gridSpots(p, 3, { w: 200, h: 150 }, 10, 8).length, 3);
});

test('starters: keychain, door sign and ornament plan cleanly', () => {
  // A stand-in for text (SVG orientation): two letters, the second with a centre.
  const lines = [
    { points: [[0, 0], [8, 0], [8, 20], [0, 20]], closed: true },
    { points: [[12, 0], [24, 0], [24, 20], [12, 20]], closed: true },
    { points: [[15, 5], [15, 15], [21, 15], [21, 5]], closed: true },
  ];
  const k = keychainPart('AB', lines);
  assert.deepEqual([...new Set(k.jobs)].sort(), ['cutout', 'hole', 'pocket']);
  placeOnBoard(k, { w: 200, h: 200 }, 12);
  assert.deepEqual(plan([k]).warnings.filter((w) => w.code !== 'detail').map((w) => w.code), []);
  const d = doorSignPart('AB', lines);
  assert.equal(d.jobs.filter((j) => j === 'hole').length, 2);
  placeOnBoard(d, { w: 200, h: 200 }, 12);
  assert.deepEqual(plan([d]).warnings.filter((w) => w.code !== 'detail').map((w) => w.code), []);
  const o = ornamentPart();
  placeOnBoard(o, { w: 200, h: 200 }, 12);
  assert.deepEqual(plan([o]).warnings.map((w) => w.code), []);
  assert.ok(partBounds(o).w > 60);
});

import { bendLetter } from '../shared/text-bend.js';

test('bend: straight stays put; arch up drops the ends and tilts them; arch down lifts them', () => {
  const letter = [[45, 0], [55, 0], [55, -20], [45, -20]]; // centre 50 on a 100 mm line
  assert.deepEqual(bendLetter(letter, 50, 100, 0), letter);
  const mid = bendLetter(letter, 50, 100, 90);
  assert.ok(mid.every((p, i) => Math.abs(p[0] - letter[i][0]) < 1e-9 && Math.abs(p[1] - letter[i][1]) < 1e-9), 'middle letter unchanged');
  const endUp = bendLetter([[95, 0]], 95, 100, 90)[0];
  const endDown = bendLetter([[95, 0]], 95, 100, -90)[0];
  assert.ok(endUp[1] > 5, `arch up: right end drops (y down), got ${endUp[1]}`);
  assert.ok(endDown[1] < -5, `arch down: right end rises, got ${endDown[1]}`);
  // A letter's top leans outward at the ends of an arch up (turned clockwise on screen).
  const top = bendLetter([[95, -20]], 95, 100, 90)[0];
  assert.ok(top[0] > endUp[0], 'top of the right-end letter leans right');
  assert.deepEqual(bendLetter([[1, 1]], 0, 100, 999)[0].map((v) => Number.isFinite(v)), [true, true], 'bend is capped');
});

import { planVCarve, planJob } from '../shared/cam.js';
import { vRules, checkLimits as limitsFor } from '../shared/settings.js';

test('V-carve: rings reach the line; depth follows the bit angle; capped at the deepest', () => {
  const stroke = [{ points: sq(50, 50, 6, 30), closed: true, job: 'vcarve', group: 'a' }];
  const rules = { bit: { angle: 90 }, depthPerPass: 1.5, maxDepth: 4, safeZ: 5, marginMm: 5, clamps: [] };
  const v90 = planVCarve({ shapes: stroke, board, rules });
  const deep90 = Math.min(...v90.moves.map((v) => v.z));
  assert.ok(Math.abs(deep90 + 2.75) < 1e-6, String(deep90)); // 6 mm stroke: half is 3 mm, last ring at 2.75
  const v60 = planVCarve({ shapes: stroke, board, rules: { ...rules, bit: { angle: 60 }, maxDepth: 6 } }); // deep enough not to cap
  const deep60 = Math.min(...v60.moves.map((v) => v.z));
  assert.ok(Math.abs(deep60 + 2.75 / Math.tan(Math.PI / 6)) < 0.01, String(deep60)); // 60°: deeper for the same width
  assert.equal(Math.min(...planVCarve({ shapes: stroke, board, rules: { ...rules, bit: { angle: 60 }, maxDepth: 3 } }).moves.map((v) => v.z)) >= -3, true);
  // No single move goes deeper than one pass below the previous depth at that spot: passes step down.
  for (let i = 1; i < v90.moves.length; i++) {
    const a = v90.moves[i - 1];
    const b = v90.moves[i];
    if (b.k === 'plunge' && a.x === b.x && a.y === b.y && a.z < 0) assert.ok(a.z - b.z <= 1.5 + 1e-6);
  }
  const wide = planVCarve({ shapes: [{ points: sq(50, 50, 40), closed: true, job: 'vcarve' }], board, rules });
  assert.ok(wide.warnings.some((w) => w.code === 'vwide'));
});

test('planJob: V-carve and cut out make two plans; each file passes the checker', () => {
  const config = { ...DEFAULT_CLASS_CONFIG, vBit: '301' };
  const mat = { ...DEFAULT_CLASS_CONFIG.materials[1], w: 200, h: 150 }; // MDF 6 mm
  const shapes = [
    { points: sq(60, 60, 5, 25), closed: true, job: 'vcarve', group: 'sign' },
    { points: sq(40, 40, 80, 60), closed: true, job: 'cutout', group: 'board' },
  ];
  const b = { w: 200, h: 150, t: mat.t };
  const plan = planJob({ shapes, board: b, bit, cut: { ...cut, depthPerPass: mat.depthPerPass }, vrules: vRules(config, mat) });
  assert.ok(plan.vplan.moves.length > 0 && plan.moves.length > 0);
  assert.deepEqual(plan.warnings.map((w) => w.code), []);
  const vg = writeGcode({ moves: plan.vplan.moves, feeds: { feed: config.vFeed, plunge: config.vPlunge, rpm: 17000 }, safeZ: 5 });
  assert.deepEqual(checkGcode(vg, { ...limitsFor(config, mat, true), board: b }).errors, []);
  // Only V-carving: no "nothing to cut" warning from the empty flat plan.
  const onlyV = planJob({ shapes: [shapes[0]], board: b, bit, cut, vrules: vRules(config, mat) });
  assert.deepEqual(onlyV.warnings.map((w) => w.code), []);
  // No V-bit in the class: V-carve shapes are simply not planned.
  assert.equal(planJob({ shapes, board: b, bit, cut, vrules: null }).vplan, null);
  assert.equal(vRules(DEFAULT_CLASS_CONFIG, mat), null);
});

test('class setup: V-carve cannot go within 1 mm of the thinnest board', () => {
  const c = structuredClone(DEFAULT_CLASS_CONFIG);
  c.vBit = '302';
  c.vMaxDepth = 5.5; // MDF and plywood are 6 mm
  assert.equal(validateClassConfig(c, { vCarve: true }).ok, false);
  c.vMaxDepth = 4;
  assert.equal(validateClassConfig(c, { vCarve: true }).ok, true);
  const old = structuredClone(DEFAULT_CLASS_CONFIG);
  delete old.vBit;
  assert.equal(validateClassConfig(old, { vCarve: true }).config.vBit, 'none');
});

test('V-carving stays switched off: a saved V-bit is ignored until V_CARVE_ENABLED', () => {
  assert.equal(V_CARVE_ENABLED, false);
  const c = structuredClone(DEFAULT_CLASS_CONFIG);
  c.vBit = '301';
  c.vMaxDepth = 4;
  const v = validateClassConfig(c);
  assert.equal(v.ok, true);
  assert.equal(v.config.vBit, 'none');
});
