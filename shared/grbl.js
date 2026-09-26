// Reading what GRBL 1.1 says (docs/HARDWARE.md §3-4). Pure, so Node tests check it.
//
// The USB test page may send ONLY the read-only questions in READ_ONLY. Nothing here builds a
// command that moves the machine or changes a setting.

/** The only things the USB test page may send. Exact bytes. */
export const READ_ONLY = Object.freeze({
  status: '?', // realtime status report, no newline
  version: '$I\n', // build info
  settings: '$$\n', // settings list (read only: writing is "$x=value", never sent)
  parser: '$G\n', // parser state (units, modes)
});

export function isReadOnly(bytes) {
  return Object.values(READ_ONLY).includes(bytes);
}

const STATES = ['Idle', 'Run', 'Hold', 'Jog', 'Alarm', 'Door', 'Check', 'Home', 'Sleep'];

/**
 * "<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:...>" → { state, sub, mpos, wpos, wco, feed, speed, pins }
 * WPos is worked out from MPos - WCO when the report has MPos (Carbide's $10 is unknown).
 */
export function parseStatus(line, lastWco = null) {
  const m = /^<([^>]*)>$/.exec(String(line).trim());
  if (!m) return null;
  const [head, ...fields] = m[1].split('|');
  const [state, sub] = head.split(':');
  if (!STATES.includes(state)) return null;
  const out = { state, sub: sub ?? null, mpos: null, wpos: null, wco: lastWco, feed: null, speed: null, pins: '' };
  const nums = (v) => v.split(',').map(Number);
  for (const f of fields) {
    const [k, v = ''] = f.split(':');
    if (k === 'MPos') out.mpos = nums(v);
    else if (k === 'WPos') out.wpos = nums(v);
    else if (k === 'WCO') out.wco = nums(v);
    else if (k === 'FS') [out.feed, out.speed] = nums(v);
    else if (k === 'F') out.feed = Number(v);
    else if (k === 'Pn') out.pins = v;
  }
  if (!out.wpos && out.mpos && out.wco) out.wpos = out.mpos.map((n, i) => Math.round((n - out.wco[i]) * 1000) / 1000);
  if (!out.mpos && out.wpos && out.wco) out.mpos = out.wpos.map((n, i) => Math.round((n + out.wco[i]) * 1000) / 1000);
  return out;
}

/** "$110=5000.000" → ['110', 5000]; anything else → null. */
export function parseSetting(line) {
  const m = /^\$(\d+)=([-+]?\d*\.?\d+)\s*$/.exec(String(line).trim());
  return m ? [m[1], Number(m[2])] : null;
}

/** Plain words for the settings that tell us about the machine (read only). */
export const SETTING_NAMES = {
  100: 'X steps/mm', 101: 'Y steps/mm', 102: 'Z steps/mm (40 belt Z, 200 Z-Plus, 320 HDZ)',
  110: 'X max rate mm/min', 111: 'Y max rate mm/min', 112: 'Z max rate mm/min',
  120: 'X accel mm/s²', 121: 'Y accel mm/s²', 122: 'Z accel mm/s²',
  130: 'X max travel mm', 131: 'Y max travel mm', 132: 'Z max travel mm',
  20: 'Soft limits', 21: 'Hard limits', 22: 'Homing', 10: 'Status report mask', 13: 'Report inches',
};

/** What the settings suggest about the machine, in plain words (a guess, never used to cut). */
export function guessMachine(settings) {
  const s = (k) => settings[k];
  const notes = [];
  if (s('102') !== undefined) {
    const z = s('102');
    notes.push(z === 40 ? 'Z steps 40: belt-driven Z (original Shapeoko 3 Z).'
      : z === 200 ? 'Z steps 200: Z-Plus lead-screw Z (Shapeoko 4, or an upgraded 3).'
        : z === 320 ? 'Z steps 320: HDZ ball-screw Z.' : `Z steps ${z}: not a Carbide default.`);
  }
  if (s('130') !== undefined && s('131') !== undefined) {
    const x = s('130');
    const y = s('131');
    notes.push(`Travel ${x} × ${y} mm: ${x < 500 && y < 500 ? 'standard size' : x > 700 && y > 700 ? 'XXL size' : x > 700 ? 'XL size' : 'unusual size'}.`);
  }
  if (s('22') !== undefined) notes.push(s('22') ? 'Homing is on: it has homing switches.' : 'Homing is off: maybe no homing switches.');
  return notes;
}
