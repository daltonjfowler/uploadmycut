// Ready-made shapes for students with no drawing file. Lines in mm, y up, any position
// (makePart centres them). Sizes are a sensible first size; students scale them.

const TAU = Math.PI * 2;

function circlePts(cx, cy, r, n = Math.max(48, Math.ceil(r * 4))) {
  return Array.from({ length: n }, (_, i) => [cx + r * Math.cos((TAU * i) / n), cy + r * Math.sin((TAU * i) / n)]);
}

function roundedRect(w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  if (r <= 0) return [[0, 0], [w, 0], [w, h], [0, h]];
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= 12; i++) {
      const a = a0 + (Math.PI / 2) * (i / 12);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(w - r, r, -Math.PI / 2);
  corner(w - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  return pts;
}

function heart(size) {
  const pts = [];
  for (let i = 0; i < 160; i++) {
    const t = (TAU * i) / 160;
    // The classic heart curve, 32 units wide.
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(x / 34) * size, (y / 34) * size]);
  }
  return pts;
}

function star(points, outer, inner) {
  return Array.from({ length: points * 2 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (Math.PI * i) / points;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

function polygon(sides, r) {
  return Array.from({ length: sides }, (_, i) => {
    const a = Math.PI / 2 + (TAU * i) / sides;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

export const SHAPES = {
  circle: { label: 'Circle', make: () => [{ points: circlePts(0, 0, 25), closed: true }] },
  square: { label: 'Rounded square', make: () => [{ points: roundedRect(50, 50, 6), closed: true }] },
  heart: { label: 'Heart', make: () => [{ points: heart(50), closed: true }] },
  star: { label: 'Star', make: () => [{ points: star(5, 30, 13), closed: true }] },
  hexagon: { label: 'Hexagon', make: () => [{ points: polygon(6, 28), closed: true }] },
  // A keychain tag: the tag is cut out, the ring hole is a hole (autoJobs sees it inside).
  tag: {
    label: 'Keychain tag',
    make: () => [
      { points: roundedRect(70, 30, 10), closed: true },
      { points: circlePts(10, 15, 3.5), closed: true },
    ],
  },
  coaster: {
    label: 'Coaster',
    make: () => [
      { points: circlePts(0, 0, 50), closed: true },
      { points: circlePts(0, 0, 42), closed: true, job: 'pocket' },
    ],
  },
};
