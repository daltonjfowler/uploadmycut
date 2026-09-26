// What the board looks like after the cut: every cutting move stamps the round bit into a height
// map, then light from the top-left shades the walls. Cut-through spots show the wasteboard.

const MAX_CELLS = 1400; // per side, so a big board stays quick on a Chromebook

function hex(c) {
  const n = Number.parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * @param {Array} moves from planCut
 * @param {{w: number, h: number, t: number}} board
 * @param {number} r bit radius mm
 * @returns {HTMLCanvasElement}
 */
export function carveImage(moves, board, r, { dark = false } = {}) {
  const cell = Math.max(0.15, Math.max(board.w, board.h) / MAX_CELLS, r / 6);
  const W = Math.ceil(board.w / cell);
  const H = Math.ceil(board.h / cell);
  const height = new Float32Array(W * H);

  const stamp = (ax, ay, bx, by, z) => {
    const minX = Math.max(0, Math.floor((Math.min(ax, bx) - r) / cell));
    const maxX = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + r) / cell));
    const minY = Math.max(0, Math.floor((Math.min(ay, by) - r) / cell));
    const maxY = Math.min(H - 1, Math.ceil((Math.max(ay, by) + r) / cell));
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const r2 = r * r;
    for (let j = minY; j <= maxY; j++) {
      const py = (j + 0.5) * cell;
      for (let i = minX; i <= maxX; i++) {
        const px = (i + 0.5) * cell;
        let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - ax - t * dx;
        const ey = py - ay - t * dy;
        if (ex * ex + ey * ey <= r2) {
          const k = j * W + i;
          if (z < height[k]) height[k] = z;
        }
      }
    }
  };

  let prev = null;
  for (const m of moves) {
    if (prev && prev.x !== null && m.k !== 'rapid' && Math.min(prev.z, m.z) < 0) {
      const same = prev.x === m.x && prev.y === m.y;
      const z = same ? Math.min(prev.z, m.z) : Math.max(prev.z, m.z);
      // Long lines in short pieces, so each stamp's box stays small.
      const len = Math.hypot(m.x - prev.x, m.y - prev.y);
      const n = Math.max(1, Math.ceil(len / 8));
      for (let s = 0; s < n; s++) {
        const a = s / n;
        const b = (s + 1) / n;
        stamp(prev.x + (m.x - prev.x) * a, prev.y + (m.y - prev.y) * a, prev.x + (m.x - prev.x) * b, prev.y + (m.y - prev.y) * b, z);
      }
    }
    prev = m;
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const wood = hex(dark ? '#8a6c45' : '#e8cf9f');
  const deep = hex(dark ? '#4a3620' : '#a8804a');
  const spoil = hex(dark ? '#2a2723' : '#6d655c');
  const through = -board.t + 1e-3;
  const at = (i, j) => height[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  for (let j = 0; j < H; j++) {
    const row = H - 1 - j; // image row 0 is the back of the board (top of the screen)
    for (let i = 0; i < W; i++) {
      const z = height[j * W + i];
      const o = (row * W + i) * 4;
      let col;
      if (z <= through) {
        col = spoil;
      } else {
        // Darker with depth; a 3 mm pocket in a thick board must still show.
        const f = Math.min(1, -z / Math.min(board.t, 8)) ** 0.6;
        col = [0, 1, 2].map((k) => wood[k] + (deep[k] - wood[k]) * f);
        // Walls: light comes from the back-left.
        const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
        const gy = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
        const shade = Math.max(-0.45, Math.min(0.35, (gx - gy) * 0.35));
        col = col.map((v) => (shade > 0 ? v + (255 - v) * shade : v * (1 + shade)));
      }
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
