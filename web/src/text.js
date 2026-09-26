// Typed text → lines, from a font file (web/public/fonts, SIL Open Font License). opentype.js and
// the font load only the first time a student makes text.

import { pathToPolylines } from '../../shared/svg-path.js';

export const FONTS = {
  block: { label: 'Block', file: '/fonts/LilitaOne-Regular.ttf', note: 'Chunky letters. Good for engraving and pockets.' },
  script: { label: 'Script', file: '/fonts/Pacifico-Regular.ttf', note: 'Joined-up letters. Cut out a name in one piece.' },
};
export const MAX_TEXT = 30;

const loaded = new Map();

async function font(key) {
  if (!loaded.has(key)) {
    loaded.set(key, (async () => {
      const [{ parse }, buf] = await Promise.all([
        import('opentype.js'),
        fetch(FONTS[key].file).then((r) => {
          if (!r.ok) throw new Error('The font did not load. Check the internet and try again.');
          return r.arrayBuffer();
        }),
      ]);
      return parse(buf);
    })());
    loaded.get(key).catch(() => loaded.delete(key));
  }
  return loaded.get(key);
}

/**
 * Lines for `text` with capital letters `heightMm` tall (SVG orientation, y down).
 * @returns {Promise<{points: number[][], closed: boolean}[]>}
 */
export async function textLines(key, text, heightMm) {
  const f = await font(key);
  const cap = f.tables.os2?.sCapHeight || f.unitsPerEm * 0.7;
  const size = (heightMm * f.unitsPerEm) / cap; // font size that makes capitals heightMm tall
  const path = f.getPath(String(text).slice(0, MAX_TEXT), 0, 0, size);
  // Font outlines are always closed; opentype.js 2 leaves out the Z, so close each one here.
  let d = '';
  for (const c of path.commands) {
    if (c.type === 'M' && d) d += 'Z';
    if (c.type === 'M' || c.type === 'L') d += `${c.type}${c.x} ${c.y}`;
    else if (c.type === 'C') d += `C${c.x1} ${c.y1} ${c.x2} ${c.y2} ${c.x} ${c.y}`;
    else if (c.type === 'Q') d += `Q${c.x1} ${c.y1} ${c.x} ${c.y}`;
    else if (c.type === 'Z') d += 'Z';
  }
  if (d) d += 'Z';
  const lines = pathToPolylines(d, 0.02).filter((l) => l.closed);
  if (!lines.length) throw new Error('Those letters are not in this font.');
  return lines;
}
