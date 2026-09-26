// Tool moves (shared/cam.js) → G-code for the Shapeoko (GRBL 1.1, run from Carbide Motion or,
// later, this site's USB sender). Only the commands shared/check-gcode.js allows.
//
// Zero: X0 Y0 is the front-left corner of the board, Z0 is the top of the board. Millimetres.

const MAX_COMMENT = 60;

/** A number the way GRBL likes it: at most 3 decimals, no trailing zeros, no "-0". */
export function num(n) {
  const r = Math.round(n * 1000) / 1000;
  return (Object.is(r, -0) ? 0 : r).toFixed(3).replace(/\.?0+$/, '');
}

/** Text safe inside a G-code comment: ASCII, no parentheses or GRBL realtime characters, short. */
export function commentText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/[()!~?$%;]/g, '') // ! ~ ? are GRBL realtime commands, even inside a comment
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_COMMENT);
}

/**
 * @param {object} p
 * @param {Array} p.moves from planCut
 * @param {{feed: number, plunge: number, rpm: number}} p.feeds mm/min and router rpm
 * @param {number} p.safeZ mm above the board
 * @param {string[]} p.notes comment lines for the header (the teacher reads them in Carbide Motion)
 */
export function writeGcode({ moves, feeds, safeZ, notes = [] }) {
  const out = [];
  for (const n of notes) {
    const c = commentText(n);
    if (c) out.push(`(${c})`);
  }
  out.push('G90 G94', 'G17', 'G21', `G0 Z${num(safeZ)}`, `M3 S${Math.round(feeds.rpm)}`);
  let mode = 'G0';
  let x = null;
  let y = null;
  let z = safeZ;
  let f = null;
  for (const v of moves) {
    const g = v.k === 'rapid' ? 'G0' : 'G1';
    const words = [];
    if (v.x !== null && (x === null || num(v.x) !== num(x))) words.push(`X${num(v.x)}`);
    if (v.y !== null && (y === null || num(v.y) !== num(y))) words.push(`Y${num(v.y)}`);
    if (num(v.z) !== num(z)) words.push(`Z${num(v.z)}`);
    if (!words.length) continue;
    const wantF = v.k === 'plunge' ? feeds.plunge : v.k === 'cut' ? feeds.feed : null;
    if (wantF !== null && wantF !== f) {
      words.push(`F${Math.round(wantF)}`);
      f = wantF;
    }
    out.push((g !== mode ? g : '') + (g !== mode ? ' ' : '') + words.join(' '));
    mode = g;
    if (v.x !== null) x = v.x;
    if (v.y !== null) y = v.y;
    z = v.z;
  }
  if (z < safeZ) out.push(`${mode === 'G0' ? '' : 'G0 '}Z${num(safeZ)}`);
  out.push('M5', 'M30', '');
  return out.join('\n');
}
