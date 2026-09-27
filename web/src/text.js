// Typed text → lines, from a font file (web/public/fonts, SIL Open Font License). opentype.js and
// the font load only the first time a student makes text. Letters can follow an arc
// (shared/text-bend.js).

import { pathToPolylines } from '../../shared/svg-path.js';
import { bendLetter } from '../../shared/text-bend.js';

export const FONTS = {
  block: { label: 'Block', file: '/fonts/LilitaOne-Regular.ttf', note: 'Chunky letters. Good for engraving and pockets.' },
  script: { label: 'Script', file: '/fonts/Pacifico-Regular.ttf', note: 'Joined-up letters. Cut out a name in one piece.' },
  stencil: { label: 'Stencil', file: '/fonts/AllertaStencil-Regular.ttf', note: 'Letters with bridges, so the middles of O, A and B stay put.' },
};
export const MAX_TEXT = 30;

const loaded = new Map();

async function font(key) {
  if (!loaded.has(key)) {
    loaded.set(key, (async () => {
      const [ot, buf] = await Promise.all([
        import('opentype.js'),
        fetch(FONTS[key].file).then((r) => {
          if (!r.ok) throw new Error('The font did not load. Check the internet and try again.');
          return r.arrayBuffer();
        }),
      ]);
      return (ot.parse ?? ot.default.parse)(buf); // Node (the unit tests) sees the CommonJS build
    })());
    loaded.get(key).catch(() => loaded.delete(key));
  }
  return loaded.get(key);
}

// opentype.js path commands → closed polylines. Font outlines are always closed; opentype.js 2
// leaves out the Z, so each one is closed here.
function outlines(path) {
  let d = '';
  for (const c of path.commands) {
    if (c.type === 'M' && d) d += 'Z';
    if (c.type === 'M' || c.type === 'L') d += `${c.type}${c.x} ${c.y}`;
    else if (c.type === 'C') d += `C${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}`;
    else if (c.type === 'Q') d += `Q${c.x1} ${c.y1} ${c.x} ${c.y}`;
    else if (c.type === 'Z') d += 'Z';
  }
  if (d) d += 'Z';
  return d ? pathToPolylines(d, 0.02).filter((l) => l.closed) : [];
}

/**
 * Lines for `text` with capital letters `heightMm` tall (SVG orientation, y down), bent along an
 * arc of `bendDeg` degrees (0 = straight).
 * @returns {Promise<{points: number[][], closed: boolean}[]>}
 */
export async function textLines(key, text, heightMm, bendDeg = 0) {
  const f = await font(key);
  const cap = f.tables.os2?.sCapHeight || f.unitsPerEm * 0.7;
  const size = (heightMm * f.unitsPerEm) / cap; // font size that makes capitals heightMm tall
  const str = String(text).slice(0, MAX_TEXT);
  let lines;
  if (!bendDeg) {
    lines = outlines(f.getPath(str, 0, 0, size));
  } else {
    // One letter at a time, so each can sit on the arc.
    const scale = size / f.unitsPerEm;
    const glyphs = f.stringToGlyphs(str);
    let x = 0;
    const placed = glyphs.map((g, i) => {
      if (i) x += f.getKerningValue(glyphs[i - 1], g) * scale;
      const item = { g, x, adv: g.advanceWidth * scale };
      x += item.adv;
      return item;
    });
    const width = x;
    lines = placed.flatMap(({ g, x: gx, adv }) => outlines(g.getPath(gx, 0, size))
      .map((l) => ({ points: bendLetter(l.points, gx + adv / 2, width, bendDeg), closed: true })));
  }
  if (!lines.length) throw new Error('Those letters are not in this font.');
  return lines;
}
