// Reads a G-code file and says whether it is safe to run on the class Shapeoko with this setup.
// The page runs it before every download. The USB sender (later) runs it again before any line
// leaves the browser, whatever program made the file. Never loosen a rule here to make a file pass:
// fix the file.
//
// Refused: GRBL settings or system commands ($...), tool changes, homing/probing/offset commands,
// relative moves, anything we do not know; rapid moves inside the wood; any sideways move below the
// safe height that is not over the board (clamps stand around it); cuts off the board, deeper than
// the board plus the teacher's through-margin, or faster than the teacher's limits; and the
// characters ! ~ ? anywhere, even in comments: GRBL acts on them the moment they arrive (pause,
// resume, status), before it ever reads the line.

const ALLOWED_G = new Set(['0', '1', '2', '3', '4', '17', '20', '21', '40', '49', '54', '80', '90', '94']);
const ALLOWED_M = new Set(['0', '1', '2', '3', '5', '30']);
const ALLOWED_LETTERS = new Set(['G', 'M', 'X', 'Y', 'Z', 'F', 'S', 'I', 'J', 'P', 'N']);
const MAX_LINE = 70; // GRBL's line buffer is 80 characters
const EDGE_TOL_MM = 0.05; // our own files keep the bit centre inside the margin; this is rounding room

function strip(line) {
  return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
}

/**
 * @param {string} text
 * @param {object} limits
 * @param {{w: number, h: number, t: number}} limits.board mm
 * @param {number} limits.maxThroughMm how far below the board bottom a cut may go
 * @param {number} limits.maxFeed mm/min
 * @param {number} [limits.maxRpm]
 * @param {number} [limits.maxLines]
 * @returns {{ok: boolean, errors: {line: number, message: string}[], stats: object}}
 */
export function checkGcode(text, limits) {
  const errors = [];
  const fail = (line, message) => {
    if (errors.length < 20) errors.push({ line, message });
  };
  const lines = String(text).split(/\r?\n/);
  if (limits.maxLines && lines.length > limits.maxLines) {
    return { ok: false, errors: [{ line: 0, message: `The file has ${lines.length} lines; the most is ${limits.maxLines}.` }], stats: {} };
  }
  const { board } = limits;
  const minZ = -(board.t + limits.maxThroughMm);
  let unit = 1; // mm per file unit
  let motion = null;
  let absolute = true;
  const pos = { x: null, y: null, z: null };
  let feed = 0;
  let maxFeed = 0;
  let maxRpm = 0;
  let lowZ = Infinity;
  let cutMoves = 0;
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

  const travelZ = limits.safeZ ?? 0;
  const onBoard = (x, y) => x !== null && y !== null && x >= -EDGE_TOL_MM && y >= -EDGE_TOL_MM
    && x <= board.w + EDGE_TOL_MM && y <= board.h + EDGE_TOL_MM;

  lines.forEach((raw, idx) => {
    const n = idx + 1;
    if (/[^\x20-\x7e\t\r]/.test(raw)) return fail(n, 'The line has characters that are not plain text.');
    if (/[!~?]/.test(raw)) return fail(n, 'The characters ! ~ ? pause or restart the machine, even inside a comment.');
    if (raw.trimStart().startsWith('$')) return fail(n, 'GRBL settings and system commands ($) are not allowed.');
    const line = strip(raw).toUpperCase();
    if (!line || line === '%') return;
    if (line.length > MAX_LINE) return fail(n, 'Line is too long for the machine.');
    const words = [];
    const rest = line.replace(/([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))/g, (_, l, v) => {
      words.push([l, v]);
      return '';
    });
    if (rest.trim()) return fail(n, `Cannot read "${rest.trim().slice(0, 12)}".`);
    const word = {};

    for (const [l, v] of words) {
      if (!ALLOWED_LETTERS.has(l)) return fail(n, `${l} commands are not allowed (tool changes and offsets stay with the teacher).`);
      if (l === 'G') {
        const g = String(Number(v));
        if (!ALLOWED_G.has(g)) return fail(n, `G${g} is not allowed.`);
        if (g === '20') unit = 25.4;
        else if (g === '21') unit = 1;
        else if (g === '90') absolute = true;
        else if (['0', '1', '2', '3'].includes(g)) {
          motion = g;

        }
        continue;
      }
      if (l === 'M') {
        const mm = String(Number(v));
        if (!ALLOWED_M.has(mm)) return fail(n, `M${mm} is not allowed.`);
        continue;
      }
      if (l in word) return fail(n, `Two ${l} words on one line.`);
      word[l] = Number(v);
    }
    if (!absolute) return fail(n, 'Relative moves are not allowed.');
    if ('F' in word) {
      feed = word.F * unit;
      maxFeed = Math.max(maxFeed, feed);
      if (feed > limits.maxFeed + 0.5) fail(n, `Feed ${Math.round(feed)} mm/min is faster than the class limit (${limits.maxFeed}).`);
    }
    if ('S' in word) {
      maxRpm = Math.max(maxRpm, word.S);
      if (limits.maxRpm && word.S > limits.maxRpm) fail(n, `Router speed ${word.S} is above the class limit.`);
    }
    const moves = 'X' in word || 'Y' in word || 'Z' in word;
    if (!moves) return;
    if (motion === null) return fail(n, 'A move comes before G0 or G1.');
    const to = {
      x: 'X' in word ? word.X * unit : pos.x,
      y: 'Y' in word ? word.Y * unit : pos.y,
      z: 'Z' in word ? word.Z * unit : pos.z,
    };
    if (to.z === null) return fail(n, 'The first moves must lift the bit (Z) before moving sideways.');
    const sideways = to.x !== pos.x || to.y !== pos.y;
    if (pos.z === null && sideways) return fail(n, 'The first move must only lift the bit (Z). Move sideways after that.');
    // Every point the move can reach (an arc may bulge past its ends).
    const reach = [[pos.x, pos.y], [to.x, to.y]];
    if ((motion === '2' || motion === '3') && ('I' in word || 'J' in word) && pos.x !== null) {
      const cx = pos.x + (word.I ?? 0) * unit;
      const cy = pos.y + (word.J ?? 0) * unit;
      const rad = Math.hypot(pos.x - cx, pos.y - cy);
      reach.push([cx - rad, cy - rad], [cx + rad, cy + rad]); // conservative: the whole circle
    }
    if (sideways && Math.min(to.z, pos.z) < travelZ - 1e-6 && !reach.every(([x, y]) => onBoard(x, y))) {
      fail(n, `A move below the safe height (${travelZ} mm) goes outside the board, where clamps are.`);
    }
    if (motion === '0') {
      if (to.z < -1e-6) fail(n, 'A fast move (G0) goes down into the wood.');
      else if (sideways && pos.z < -1e-6) fail(n, 'A fast move (G0) goes sideways inside the wood.');
    } else {
      if (feed <= 0) fail(n, 'A cut comes before any feed rate (F).');
      if (to.z < 0 || (pos.z !== null && pos.z < 0)) {
        if (to.x === null || to.y === null) return fail(n, 'The machine does not know where it is yet (no X or Y).');
        cutMoves++;
        if ((motion === '2' || motion === '3') && !('I' in word || 'J' in word)) return fail(n, 'Arcs must use I and J.');
        // The start counts too: a cut can ramp into the wood from off the board.
        for (const [x, y] of reach.filter(([x0]) => x0 !== null)) {
          box.minX = Math.min(box.minX, x);
          box.minY = Math.min(box.minY, y);
          box.maxX = Math.max(box.maxX, x);
          box.maxY = Math.max(box.maxY, y);
          if (x < -EDGE_TOL_MM || y < -EDGE_TOL_MM || x > board.w + EDGE_TOL_MM || y > board.h + EDGE_TOL_MM) {
            fail(n, `A cut goes off the board (X ${x.toFixed(1)}, Y ${y.toFixed(1)} mm).`);
          }
        }
      }
      if (to.z < minZ - 1e-6) fail(n, `A cut goes ${(-to.z).toFixed(2)} mm deep: deeper than the board plus ${limits.maxThroughMm} mm.`);
    }
    lowZ = Math.min(lowZ, to.z);

    pos.x = to.x;
    pos.y = to.y;
    pos.z = to.z;
  });

  return {
    ok: errors.length === 0,
    errors,
    stats: { lines: lines.length, cutMoves, minZ: lowZ === Infinity ? 0 : lowZ, maxFeed, maxRpm, box },
  };
}
