// Text on a curve: each letter sits on a circle arc, turned to follow it. Pure maths, so Node
// tests check it; web/src/text.js feeds it one letter at a time.
//
// Coordinates are SVG-style (y down), the baseline at y = 0, the line `width` mm long. `bendDeg`
// is the whole arc the line covers: 0 straight, positive arches up (the ends drop, like the top
// of a coaster), negative arches down (the ends rise, like the bottom of one).

export const MAX_BEND = 180;

/**
 * Move one letter's points onto the arc. `cx` is where the letter's middle sits along the
 * straight line (from the line's left end).
 */
export function bendLetter(points, cx, width, bendDeg) {
  const bend = Math.max(-MAX_BEND, Math.min(MAX_BEND, bendDeg));
  if (!bend || !(width > 0)) return points.map((p) => [p[0], p[1]]);
  const s = bend > 0 ? 1 : -1;
  const R = width / ((Math.abs(bend) * Math.PI) / 180); // the arc keeps the line's length
  const t = (cx - width / 2) / R; // angle of this letter from the middle
  const bx = width / 2 + R * Math.sin(t);
  const by = s * (R - R * Math.cos(t));
  const a = s * t;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return points.map(([x, y]) => {
    const dx = x - cx;
    return [bx + dx * cos - y * sin, by + dx * sin + y * cos];
  });
}
