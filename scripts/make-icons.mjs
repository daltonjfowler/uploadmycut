// Draws the uploadmycut icon: the family robot face and upload-arrow hat, holding a hand drill in
// one bent arm and a spinning buzz saw on the other (a generic blade, not any game's artwork).
// The look (ink outline, hand-drawn wobble) lives in scripts/icon-kit.mjs, shared by all four sites.
// Usage: node scripts/make-icons.mjs web/public
import { circle, curve, inked, poly, rrect, tag, tile, writeIcons } from './icon-kit.mjs';

const OUT = process.argv[2] || '.';
// Family colours: grey face, deep tile of the site's colour, arrow in a brighter tint of it.
const BG = '#1E3A8A', FACE = '#AEB6C0', ARROW = '#60A5FA', INK = '#0B1B3F';
const WHITE = '#FFFFFF', DARK = '#0F3D40';
const COLLET = '#5B6470', STEEL = '#DDE3EA', BLADE = '#B9C2CD', CHIP = '#E9C58F';
const DRILL = '#F59E0B', DRILL_DARK = '#374151'; // a cordless drill in shop yellow

const SAW = { cx: 49, cy: 53, r: 7.4, tooth: 2.4, teeth: 14 };
const teeth = [];
for (let i = 0; i < SAW.teeth; i++) {
  const a0 = (i / SAW.teeth) * 2 * Math.PI, a1 = ((i + 0.55) / SAW.teeth) * 2 * Math.PI, a2 = ((i + 1) / SAW.teeth) * 2 * Math.PI;
  teeth.push([SAW.cx + SAW.r * Math.cos(a0), SAW.cy + SAW.r * Math.sin(a0)]);
  teeth.push([SAW.cx + (SAW.r + SAW.tooth) * Math.cos(a1), SAW.cy + (SAW.r + SAW.tooth) * Math.sin(a1)]);
  teeth.push([SAW.cx + SAW.r * Math.cos(a2), SAW.cy + SAW.r * Math.sin(a2)]);
}

writeIcons(OUT, [
  tile(BG),
  ...inked([poly([[32, 5], [23, 15], [41, 15]], ARROW), rrect(29, 14, 6, 7, 0, ARROW)], INK),
  ...inked([curve(19, 42, 10.5, 45, 14, 52.5, 3.6, FACE), curve(45, 42, 53.5, 44.5, 49, 52, 3.6, FACE)], INK),
  ...inked([rrect(14, 20, 36, 25, 7, FACE)], INK),
  curve(27, 38, 32, 42.5, 37, 38, 2.6, DARK),
  ...tag('blink', [circle(25, 30, 3.6, DARK), circle(39, 30, 3.6, DARK), circle(26.2, 28.8, 1.1, WHITE), circle(40.2, 28.8, 1.1, WHITE)]),
  // hand drill, pointing left: grip, battery, body, chuck, bit, then a vent on the body
  ...tag('drill', [...inked([
    poly([[11, 51.5], [16.5, 51.5], [15.5, 58.5], [10.5, 58.5]], DRILL),
    rrect(8.5, 57.6, 9.5, 3.6, 1, DRILL_DARK),
    rrect(7, 45.5, 13, 7, 2.5, DRILL),
    rrect(3.6, 46.6, 3.8, 4.8, 1, COLLET),
    rrect(0.9, 48.2, 3.2, 1.6, 0.5, STEEL),
  ], INK),
  rrect(9, 47.2, 2, 3.6, 0.8, DRILL_DARK)]),
  // buzz saw: blade, disc, hub, spin marks, flying chips
  ...tag('saw', [...inked([poly(teeth, STEEL)], INK),
    circle(SAW.cx, SAW.cy, SAW.r - 1.6, BLADE), circle(SAW.cx, SAW.cy, 2.6, COLLET)]),
  ...tag('hub', [circle(SAW.cx + 1.1, SAW.cy - 0.5, 0.9, DARK)]), // off centre, so the spin shows
  ...tag('spin', [curve(55.5, 42.5, 59.5, 45.5, 60.5, 50.5, 1.3, ARROW), curve(38.5, 58.5, 40, 62, 44, 62.8, 1.3, ARROW)]),
  ...tag('chips', [circle(58.2, 38.6, 1.1, CHIP), circle(61, 41.6, 0.8, CHIP), circle(55.4, 37, 0.7, CHIP)]),
], 'uploadmycut icon: the family robot holding a hand drill and a buzz saw.', `
  .saw { animation: spin 0.5s linear infinite; }
  .hub { transform-box: view-box; transform-origin: 49px 53px; animation: spin 0.5s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .drill { animation: buzz 0.12s linear infinite; }
  @keyframes buzz { 0%, 100% { transform: translate(0, 0); } 25% { transform: translate(-0.6px, 0.3px); } 50% { transform: translate(0.4px, -0.3px); } 75% { transform: translate(-0.3px, -0.2px); } }
  .spin { animation: flash 0.3s steps(2) infinite; }
  @keyframes flash { 50% { opacity: 0.25; } }
  .chips { animation: chips 0.7s ease-out infinite; }
  @keyframes chips { 0% { transform: translate(0, 0); opacity: 1; } 100% { transform: translate(3px, -4px); opacity: 0; } }`);
