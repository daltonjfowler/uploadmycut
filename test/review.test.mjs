// Regression tests for the bugs found in the 2026-09-26 safety review. Each uses the review's own
// input. A failure here means a real cut could go wrong.
import assert from 'node:assert/strict';
import test from 'node:test';
import { planCut } from '../shared/cam.js';
import { writeGcode } from '../shared/gcode.js';
import { checkGcode } from '../shared/check-gcode.js';
import { pointInRegion, area } from '../shared/geometry.js';
import { DEFAULT_CLASS_CONFIG, validateClassConfig, checkLimits, cutRules } from '../shared/settings.js';

const sq = (x, y, w, h = w) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
const board = { w: 200, h: 150, t: 12 };
const bit = { diameter: 3.175 };
const cut = {
  depthPerPass: 1, stepover: 0.4, safeZ: 5, throughMm: 0.3, engraveDepth: 1, pocketDepth: 3, pocketMaxDepth: 6,
  marginMm: 5, climb: false, tabs: { width: 6, height: 2.5 },
};
const limits = { board, maxThroughMm: 0.35, maxFeed: 2500, safeZ: 5 };
const deep = (plan) => plan.moves.filter((v) => v.z < 0);
// Every cutting segment (both ends below the top) as [from, to].
function cutSegments(moves) {
  const out = [];
  for (let i = 1; i < moves.length; i++) {
    if (moves[i].k !== 'rapid' && moves[i - 1].z < 0 && moves[i].z < 0) out.push([moves[i - 1], moves[i]]);
  }
  return out;
}

test('1. pocket links never cut between separate pockets on one baseline', () => {
  const shapes = [sq(20, 20, 20), sq(50, 20, 20), sq(80, 20, 20)].map((points) => ({ points, closed: true, job: 'pocket', depth: 3, group: 'g' }));
  const plan = planCut({ shapes, board, bit, cut });
  const r = bit.diameter / 2;
  const allowed = [sq(20, 20, 20), sq(50, 20, 20), sq(80, 20, 20)];
  for (const [a, b] of cutSegments(plan.moves)) {
    for (let t = 0; t <= 1; t += 0.05) {
      const p = [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
      // The bit centre must stay at least r inside one of the squares (0.01 mm rounding room).
      const inside = allowed.some(([[x0, y0], [x1], [, y1]]) => p[0] >= x0 + r - 0.01 && p[0] <= x1 - r + 0.01 && p[1] >= y0 + r - 0.01 && p[1] <= y1 - r + 0.01);
      assert.ok(inside, `cut at ${p.map((n) => n.toFixed(2))} between pockets`);
    }
  }
});

test('2. a small cut out gets fewer tabs, and a tiny one blocks instead of coming loose', () => {
  const circle = (cx, cy, rr) => Array.from({ length: 64 }, (_, i) => [cx + rr * Math.cos((i / 64) * 2 * Math.PI), cy + rr * Math.sin((i / 64) * 2 * Math.PI)]);
  const small = planCut({ shapes: [{ points: circle(50, 50, 4), closed: true, job: 'cutout' }], board, bit, cut });
  assert.ok(deep(small).some((v) => v.z === -9.5), 'an 8 mm circle still gets a tab');
  assert.deepEqual(small.warnings, []);
  const tiny = planCut({ shapes: [{ points: circle(50, 50, 1), closed: true, job: 'cutout' }], board, bit, cut });
  assert.ok(tiny.warnings.some((w) => w.code === 'noTabs'));
});

test('3. a part inside another part\'s hole is cut, on its outside, before the hole', () => {
  for (const flip of [false, true]) {
    const inner = flip ? sq(60, 60, 20).reverse() : sq(60, 60, 20);
    const shapes = [
      { points: sq(20, 20, 100), closed: true, job: 'cutout' },
      { points: sq(40, 40, 60), closed: true, job: 'hole' },
      { points: inner, closed: true, job: 'cutout' },
    ];
    const plan = planCut({ shapes, board: { w: 200, h: 150, t: 12 }, bit, cut });
    const d = deep(plan);
    // The inner part's path runs 1.59 mm OUTSIDE its line: x down to 58.41.
    const innerMoves = d.filter((v) => v.x > 55 && v.x < 85 && v.y > 55 && v.y < 85);
    assert.ok(innerMoves.length > 0, `flip=${flip}: inner part is cut`);
    assert.ok(Math.abs(Math.min(...innerMoves.map((v) => v.x)) - 58.4125) < 0.02, `flip=${flip}: outside the line`);
    const firstInner = plan.moves.indexOf(innerMoves[0]);
    const firstHole = plan.moves.findIndex((v) => v.z < 0 && Math.abs(v.x - 41.5875) < 0.02);
    const firstOuter = plan.moves.findIndex((v) => v.z < 0 && v.x < 20);
    assert.ok(firstInner < firstHole && firstHole < firstOuter, `flip=${flip}: order ${firstInner} ${firstHole} ${firstOuter}`);
    assert.ok(innerMoves.some((v) => v.z === -9.5), `flip=${flip}: inner part has tabs`);
  }
});

test('4. a hole across a part\'s edge becomes a notch in the same cut', () => {
  const shapes = [
    { points: sq(20, 20, 60, 40), closed: true, job: 'cutout' },
    { points: sq(70, 30, 20, 20), closed: true, job: 'hole' },
  ];
  const plan = planCut({ shapes, board, bit, cut });
  // One loop only: the tool never cuts the notch square as a separate lap.
  const entries = plan.moves.filter((v, i) => v.k === 'plunge' && plan.moves[i - 1]?.z === 1);
  assert.equal(entries.length, 1);
  // And the notch really is cut: the bit runs on the notch side of its wall, x = 70 + r.
  assert.ok(deep(plan).some((v) => Math.abs(v.x - 71.5875) < 0.02 && v.y > 30 && v.y < 50));
});

test('5 & 6. engraving never goes through; pockets obey the teacher\'s deepest pocket', () => {
  const thin = { w: 200, h: 150, t: 2 };
  const e = planCut({ shapes: [{ points: sq(50, 50, 20), closed: true, job: 'engrave' }], board: thin, bit, cut: { ...cut, engraveDepth: 3 } });
  assert.ok(Math.min(...deep(e).map((v) => v.z)) >= -1.5);
  const p = planCut({ shapes: [{ points: sq(50, 50, 30), closed: true, job: 'pocket', depth: 18 }], board: { w: 200, h: 150, t: 19 }, bit, cut: { ...cut, pocketMaxDepth: 2 } });
  assert.equal(Math.min(...deep(p).map((v) => v.z)), -2);
  assert.equal(cutRules(DEFAULT_CLASS_CONFIG, DEFAULT_CLASS_CONFIG.materials[0]).pocketMaxDepth, DEFAULT_CLASS_CONFIG.pocketMaxDepth);
});

test('7 & 8. checker: no ramping in from off the board, no low travel off the board, Z first', () => {
  const bad = {
    'ramp in from off the board': 'G0 Z5\nG0 X-100 Y50\nG0 Z0\nG1 X10 Y50 Z-11 F500\n',
    'G0 at Z0 off the board': 'G0 Z5\nG0 X10 Y10\nG0 Z0\nG0 X-60 Y-60\n',
    'G1 at Z0.2 off the board': 'G0 Z5\nG0 X10 Y10\nG1 Z0.2 F300\nG1 X-80\n',
    'first move XY and Z together': 'G0 X10 Y10 Z5\n',
    'feed hold in a comment': '(Pine! board)\nG0 Z5\n',
    'resume in a comment': '(~)\nG0 Z5\n',
    'override byte': '(\u0091)\nG0 Z5\n',
    'arc bulging off the board at low height': 'G0 Z5\nG0 X2 Y50\nG1 Z-1 F300\nG2 X2 Y60 I0 J5\n',
  };
  for (const [name, text] of Object.entries(bad)) assert.equal(checkGcode(text, limits).ok, false, name);
  // Our own style still passes: lift, travel high, drop, cut on the board.
  assert.deepEqual(checkGcode('G0 Z5\nG0 X10 Y10\nG0 Z1\nG1 Z-1 F200\nG1 X20 F900\nG0 Z5\nG0 X0 Y0\n', limits).errors, []);
});

test('writer drops GRBL realtime characters from comments', () => {
  const g = writeGcode({ moves: [], feeds: { feed: 900, plunge: 300, rpm: 17000 }, safeZ: 5, notes: ['Pine! ~ board? 100%'] });
  assert.ok(!/[!~?%]/.test(g), g);
});

test('9. tabs warning only when something is cut through; teacher cannot save tabs thicker than a board', () => {
  const plan = planCut({ shapes: [{ points: [[50, 50], [80, 60]], closed: false, job: 'engrave' }], board: { w: 200, h: 150, t: 2 }, bit, cut });
  assert.deepEqual(plan.warnings.map((w) => w.code), []);
  const c = structuredClone(DEFAULT_CLASS_CONFIG);
  c.materials[1].t = 2;
  c.tabs.height = 2.5;
  assert.equal(validateClassConfig(c).ok, false);
  c.tabs.height = 1;
  c.engraveDepth = 1.8;
  assert.equal(validateClassConfig(c).ok, false);
  c.engraveDepth = 1;
  assert.equal(validateClassConfig(c).ok, true);
  c.materials[1].depthPerPass = 3; // more than the 2 mm board
  assert.equal(validateClassConfig(c).ok, false);
});

test('fuzz: random designs always make files that pass the checker, on every material', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 60; k++) {
    const shapes = [];
    for (let j = 0; j < 4; j++) {
      const w = 5 + rnd() * 40;
      const x = 12 + rnd() * (200 - 24 - w);
      const y = 12 + rnd() * (150 - 24 - w);
      const job = ['cutout', 'hole', 'engrave', 'pocket'][Math.floor(rnd() * 4)];
      shapes.push({ points: rnd() > 0.5 ? sq(x, y, w) : sq(x, y, w).reverse(), closed: true, job, depth: 1 + rnd() * 5, group: `g${j}` });
    }
    for (const m of DEFAULT_CLASS_CONFIG.materials) {
      const b = { w: 200, h: 150, t: m.t };
      const rules = { ...cutRules(DEFAULT_CLASS_CONFIG, m), climb: rnd() > 0.5 };
      const plan = planCut({ shapes, board: b, bit, cut: rules });
      if (plan.warnings.some((w) => ['offBoard', 'noTabs', 'empty'].includes(w.code))) continue;
      const g = writeGcode({ moves: plan.moves, feeds: { feed: m.feed, plunge: m.plunge, rpm: 17000 }, safeZ: rules.safeZ, notes: [m.label] });
      const lim = { ...checkLimits(DEFAULT_CLASS_CONFIG, m), board: b };
      assert.deepEqual(checkGcode(g, lim).errors, [], `design ${k} on ${m.id}`);
    }
  }
  void pointInRegion;
  void area;
});
