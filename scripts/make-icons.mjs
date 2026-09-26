// Draws the uploadmycut icon: uploadmycode's friendly face and upload-arrow hat, holding a hand drill
// in one hand and a round buzz saw on the other arm (a generic blade, not any game's artwork). Writes icon.svg and the PNGs from the same shapes, so
// they never drift apart. Adapted from uploadmylaser's scripts/make-icons.mjs.
// No dependencies: shapes are sampled per pixel with 4x4 supersampling, PNG written with zlib.
// Usage: node scripts/make-icons.mjs web/public
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const OUT = process.argv[2] || '.';
// Family look shared with uploadmycode, uploadmylaser and uploadmymodel: a grey robot face on a deep
// tile of the site's colour, wearing an upload arrow in a brighter tint of that colour. uploadmycut's
// colour is blue.
const BG = '#1E3A8A', FACE = '#AEB6C0', ARROW = '#60A5FA';
const WHITE = '#FFFFFF', DARK = '#0F3D40';
const COLLET = '#5B6470', STEEL = '#DDE3EA', BLADE = '#B9C2CD';
const DRILL = '#F59E0B', DRILL_DARK = '#374151'; // a cordless drill in shop yellow

// Each shape: an SVG element and an inside(x, y) test, in the 64-unit space.
const rrect = (x, y, w, h, r, fill) => ({
  svg: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`,
  fill,
  inside: (px, py) => {
    if (px < x || py < y || px > x + w || py > y + h) return false;
    const cx = Math.min(Math.max(px, x + r), x + w - r), cy = Math.min(Math.max(py, y + r), y + h - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  },
});
const circle = (cx, cy, r, fill) => ({
  svg: `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`,
  fill,
  inside: (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r,
});
const poly = (pts, fill) => ({
  svg: `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="${fill}"/>`,
  fill,
  inside: (px, py) => { // even-odd ray cast
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  },
});
// A thick quadratic curve with round caps (the smile).
const curve = (x0, y0, qx, qy, x1, y1, width, stroke) => {
  const pts = Array.from({ length: 33 }, (_, i) => { const t = i / 32; return [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * qx + t * t * x1, (1 - t) ** 2 * y0 + 2 * (1 - t) * t * qy + t * t * y1]; });
  const r2 = (width / 2) ** 2;
  return {
    svg: `<path d="M${x0} ${y0} Q${qx} ${qy} ${x1} ${y1}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`,
    fill: stroke,
    inside: (px, py) => pts.some(([ax, ay], i) => {
      if (i === pts.length - 1) return false;
      const [bx, by] = pts[i + 1], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
      return (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2 <= r2;
    }),
  };
};
// A thick straight bar (an arm) from a to b, `w` wide, with round ends.
const bar = (x0, y0, x1, y1, w, fill) => {
  const len = Math.hypot(x1 - x0, y1 - y0), nx = (-(y1 - y0) / len) * (w / 2), ny = ((x1 - x0) / len) * (w / 2);
  return poly([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]].map((p) => p.map((v) => +v.toFixed(2))), fill);
};
// A round saw blade: teeth all the way round, a lighter disc, and a hub.
const SAW = { cx: 49, cy: 53, r: 7.4, tooth: 2.4, teeth: 14 };
const sawTeeth = [];
for (let i = 0; i < SAW.teeth; i++) {
  const a0 = (i / SAW.teeth) * 2 * Math.PI, a1 = ((i + 0.55) / SAW.teeth) * 2 * Math.PI, a2 = ((i + 1) / SAW.teeth) * 2 * Math.PI;
  sawTeeth.push([SAW.cx + SAW.r * Math.cos(a0), SAW.cy + SAW.r * Math.sin(a0)]);
  sawTeeth.push([SAW.cx + (SAW.r + SAW.tooth) * Math.cos(a1), SAW.cy + (SAW.r + SAW.tooth) * Math.sin(a1)]);
  sawTeeth.push([SAW.cx + SAW.r * Math.cos(a2), SAW.cy + SAW.r * Math.sin(a2)]);
}

const shapes = [
  rrect(0, 0, 64, 64, 14, BG),
  // upload arrow (hat), same as uploadmycode
  poly([[32, 5], [23, 15], [41, 15]], ARROW),
  rrect(29, 14, 6, 7, 0, ARROW),
  // arms, under the face and tools
  bar(18, 42, 14, 53, 3.6, FACE),
  bar(46, 42, 49, 53, 3.6, FACE),
  // face
  rrect(14, 20, 36, 25, 7, FACE),
  curve(27, 38, 32, 42.5, 37, 38, 2.6, DARK),
  circle(25, 30, 3.6, DARK), circle(39, 30, 3.6, DARK),
  circle(26.2, 28.8, 1.1, WHITE), circle(40.2, 28.8, 1.1, WHITE), // eye shine
  // hand drill in the left hand, pointing left: body, grip, battery, chuck, bit
  poly([[11, 51.5], [16.5, 51.5], [15.5, 59], [10.5, 59]], DRILL),
  rrect(8.5, 58, 9.5, 3.6, 1, DRILL_DARK),
  rrect(7, 45.5, 13, 7, 2.5, DRILL),
  rrect(8.5, 47, 2.2, 4, 0.8, DRILL_DARK), // vents
  rrect(3.6, 46.6, 3.8, 4.8, 1, COLLET),
  rrect(0.8, 48.2, 3.2, 1.6, 0.5, STEEL),
  // buzz saw on the right arm
  poly(sawTeeth.map((p) => p.map((v) => +v.toFixed(2))), STEEL),
  circle(SAW.cx, SAW.cy, SAW.r - 1.6, BLADE),
  circle(SAW.cx, SAW.cy, 2.6, COLLET),
  circle(SAW.cx, SAW.cy, 1, DARK),
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <!-- uploadmycut icon: uploadmycode's face holding a hand drill and a buzz saw. Generated by scripts/make-icons.mjs, edit it there. -->
  ${shapes.map((s) => s.svg).join('\n  ')}
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function render(size) {
  const px = Buffer.alloc(size * size * 4), SS = 4, scale = 64 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const ux = (x + (sx + 0.5) / SS) * scale, uy = (y + (sy + 0.5) / SS) * scale;
      let col = null;
      for (const s of shapes) if (s.inside(ux, uy)) col = s.fill;
      if (col) { const [cr, cg, cb] = hex(col); r += cr; g += cg; b += cb; a += 255; }
    }
    const n = SS * SS, o = (y * size + x) * 4, cov = a / 255;
    px[o] = cov ? r / cov : 0; px[o + 1] = cov ? g / cov : 0; px[o + 2] = cov ? b / cov : 0; px[o + 3] = a / n;
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const [name, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(join(OUT, name), render(size));
}
console.log('icons written to', OUT);
