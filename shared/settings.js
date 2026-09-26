// The class setup: what the teacher sets and students never change. Imported by the page, the
// teacher page and the Worker (which refuses anything outside these lists and ranges).
//
// Students choose only: which drawing, where it goes, each line's job, and a pocket depth up to
// the teacher's limit. Feeds, plunge, depth per pass, router speed, safe height, tabs and the bit
// all come from here.
//
// Feed numbers are STARTING VALUES (docs/HARDWARE.md §7 says where they come from). None is
// school tested yet.

// Published cutting areas (docs/HARDWARE.md §2). z = usable cut depth, well under Z travel.
export const MACHINES = {
  shapeoko3: { label: 'Shapeoko 3 (standard)', x: 406, y: 406, z: 75 },
  shapeoko3xl: { label: 'Shapeoko 3 XL', x: 838, y: 406, z: 75 },
  shapeoko3xxl: { label: 'Shapeoko 3 XXL', x: 838, y: 838, z: 75 },
  shapeoko4: { label: 'Shapeoko 4 (standard)', x: 444, y: 444, z: 95 },
  shapeoko4xl: { label: 'Shapeoko 4 XL', x: 838, y: 444, z: 95 },
  shapeoko4xxl: { label: 'Shapeoko 4 XXL', x: 838, y: 838, z: 95 },
};

// Flat end mills only for now (cut out, hole, pocket and engrave all work with them). V-bits come
// with V-carving.
export const BITS = {
  102: { label: '#102 · 1/8 in flat end mill', short: '1/8 in flat bit', diameter: 3.175 },
  201: { label: '#201 · 1/4 in flat end mill', short: '1/4 in flat bit', diameter: 6.35 },
  122: { label: '#122 · 1/16 in flat end mill', short: '1/16 in flat bit', diameter: 1.5875 },
};

// Router speed dial → rpm, approximate (docs/HARDWARE.md §6). For the file header and the
// Carbide Motion prompt only: the machine cannot set a manual router's speed.
export const ROUTERS = {
  makita: { label: 'Makita RT0701', dial: [10000, 12000, 17000, 22000, 27000, 30000] },
  carbide: { label: 'Carbide Compact Router', dial: [11000, 13500, 18250, 24500, 29250, 31000] },
};

export const MATERIAL_KINDS = {
  softwood: 'Softwood (pine)',
  hardwood: 'Hardwood (maple, oak)',
  mdf: 'MDF',
  plywood: 'Plywood',
};

// Starting feeds per bit and material kind: feed and plunge mm/min, depth per pass mm, router
// dial. DERIVED from chip loads and Carbide's 1/4 in chart (docs/HARDWARE.md §7), not published
// by Carbide for these bits, and NOT school tested.
export const STARTING_FEEDS = {
  102: {
    softwood: { feed: 900, plunge: 300, depthPerPass: 1.0, dial: 3 },
    hardwood: { feed: 450, plunge: 150, depthPerPass: 0.5, dial: 3 },
    mdf: { feed: 900, plunge: 300, depthPerPass: 1.0, dial: 3 },
    plywood: { feed: 800, plunge: 250, depthPerPass: 0.8, dial: 3 },
  },
  201: {
    softwood: { feed: 1500, plunge: 500, depthPerPass: 3.0, dial: 3.5 },
    hardwood: { feed: 1100, plunge: 400, depthPerPass: 1.2, dial: 3.5 },
    mdf: { feed: 1500, plunge: 500, depthPerPass: 3.0, dial: 3 },
    plywood: { feed: 1500, plunge: 500, depthPerPass: 2.5, dial: 3.5 },
  },
  122: {
    softwood: { feed: 500, plunge: 150, depthPerPass: 0.4, dial: 4 },
    hardwood: { feed: 300, plunge: 100, depthPerPass: 0.25, dial: 4 },
    mdf: { feed: 500, plunge: 150, depthPerPass: 0.4, dial: 4 },
    plywood: { feed: 450, plunge: 150, depthPerPass: 0.35, dial: 4 },
  },
};

export const JOB_KEYS = ['cutout', 'hole', 'engrave', 'pocket'];

// Hard limits nobody can set past, not even the teacher page.
export const LIMITS = {
  maxFeed: 2500,
  maxPlunge: 800,
  depthPerPass: [0.2, 4],
  safeZ: [3, 25],
  throughMm: [0, 1],
  tabWidth: [3, 15],
  tabHeight: [1, 8],
  engraveDepth: [0.2, 3],
  pocketMaxDepth: [0.5, 20],
  marginMm: [2, 30],
  stepover: [0.2, 0.6],
  thickness: [2, 40],
  boardMin: 20,
  materials: 8,
  labelLength: 30,
  noteLength: 400,
  maxLines: 200_000,
};

export const DEFAULT_CLASS_CONFIG = {
  machine: 'shapeoko3',
  router: 'makita',
  bit: '102',
  materials: [
    { id: 'pine', label: 'Pine board', kind: 'softwood', t: 19, w: 140, h: 200, ...STARTING_FEEDS[102].softwood },
    { id: 'mdf', label: 'MDF', kind: 'mdf', t: 6, w: 200, h: 200, ...STARTING_FEEDS[102].mdf },
    { id: 'ply', label: 'Birch plywood', kind: 'plywood', t: 6, w: 200, h: 200, ...STARTING_FEEDS[102].plywood },
  ],
  jobs: { cutout: true, hole: true, engrave: true, pocket: true },
  tabs: { width: 6, height: 2.5 },
  engraveDepth: 1,
  pocketMaxDepth: 6,
  safeZ: 5,
  throughMm: 0.3,
  marginMm: 6,
  stepover: 0.4,
  climb: false,
  note: '',
};

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

function inRange(errors, name, v, [lo, hi]) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) {
    errors.push(`${name} must be between ${lo} and ${hi}.`);
    return lo;
  }
  return round(n);
}

function label(errors, name, v, max) {
  const s = String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim();
  if (!s || s.length > max) errors.push(`${name} must be 1 to ${max} characters.`);
  return s.slice(0, max);
}

/** Check a class setup from the teacher page (or KV). Returns a clean copy. */
export function validateClassConfig(input) {
  const errors = [];
  const c = input && typeof input === 'object' ? input : {};
  const out = {};
  out.machine = Object.hasOwn(MACHINES, c.machine) ? c.machine : (errors.push('Unknown machine.'), DEFAULT_CLASS_CONFIG.machine);
  out.router = Object.hasOwn(ROUTERS, c.router) ? c.router : (errors.push('Unknown router.'), DEFAULT_CLASS_CONFIG.router);
  out.bit = Object.hasOwn(BITS, String(c.bit)) ? String(c.bit) : (errors.push('Unknown bit.'), DEFAULT_CLASS_CONFIG.bit);
  const machine = MACHINES[out.machine];
  const mats = Array.isArray(c.materials) ? c.materials : [];
  if (mats.length < 1 || mats.length > LIMITS.materials) errors.push(`Set up 1 to ${LIMITS.materials} materials.`);
  const ids = new Set();
  out.materials = mats.slice(0, LIMITS.materials).map((m, i) => {
    const e = [];
    const id = String(m?.id ?? '');
    if (!/^[a-z0-9-]{1,20}$/.test(id) || ids.has(id)) e.push('bad id');
    ids.add(id);
    const mat = {
      id,
      label: label(e, 'Name', m?.label, LIMITS.labelLength),
      kind: Object.hasOwn(MATERIAL_KINDS, m?.kind) ? m.kind : (e.push('kind'), 'softwood'),
      t: inRange(e, 'Thickness', m?.t, LIMITS.thickness),
      w: inRange(e, 'Width', m?.w, [LIMITS.boardMin, machine.x]),
      h: inRange(e, 'Length', m?.h, [LIMITS.boardMin, machine.y]),
      feed: inRange(e, 'Feed', m?.feed, [50, LIMITS.maxFeed]),
      plunge: inRange(e, 'Plunge', m?.plunge, [20, LIMITS.maxPlunge]),
      depthPerPass: inRange(e, 'Depth per pass', m?.depthPerPass, LIMITS.depthPerPass),
      dial: inRange(e, 'Router dial', m?.dial, [1, 6]),
    };
    for (const x of e) errors.push(`Material ${i + 1}: ${x}`);
    return mat;
  });
  out.jobs = {};
  for (const k of JOB_KEYS) out.jobs[k] = c.jobs?.[k] !== false;
  if (!JOB_KEYS.some((k) => out.jobs[k])) errors.push('Allow at least one job.');
  out.tabs = { width: inRange(errors, 'Tab width', c.tabs?.width, LIMITS.tabWidth), height: inRange(errors, 'Tab height', c.tabs?.height, LIMITS.tabHeight) };
  out.engraveDepth = inRange(errors, 'Engrave depth', c.engraveDepth, LIMITS.engraveDepth);
  out.pocketMaxDepth = inRange(errors, 'Deepest pocket', c.pocketMaxDepth, LIMITS.pocketMaxDepth);
  out.safeZ = inRange(errors, 'Safe height', c.safeZ, LIMITS.safeZ);
  out.throughMm = inRange(errors, 'Cut-through depth', c.throughMm, LIMITS.throughMm);
  out.marginMm = inRange(errors, 'Edge margin', c.marginMm, LIMITS.marginMm);
  out.stepover = inRange(errors, 'Stepover', c.stepover, LIMITS.stepover);
  out.climb = c.climb === true;
  // Cross-checks against the thinnest material, so no setup can make a file that cuts through
  // where it should not, or tabs that hold nothing.
  const thinnest = Math.min(...out.materials.map((m) => m.t));
  if (Number.isFinite(thinnest)) {
    if (out.tabs.height > thinnest - 0.5) errors.push(`Tabs must be at least 0.5 mm thinner than the thinnest material (${thinnest} mm).`);
    if (out.engraveDepth > thinnest - 0.5) errors.push(`Engrave depth must be at least 0.5 mm less than the thinnest material (${thinnest} mm).`);
  }
  for (const m of out.materials) {
    if (m.depthPerPass > m.t) errors.push(`${m.label}: depth per pass is more than the whole thickness.`);
  }
  out.note = String(c.note ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, LIMITS.noteLength);
  return errors.length ? { ok: false, errors } : { ok: true, config: out };
}

/** Everything planCut needs for one material, from the class setup. */
export function cutRules(config, material) {
  return {
    depthPerPass: material.depthPerPass,
    stepover: config.stepover,
    safeZ: config.safeZ,
    throughMm: config.throughMm,
    engraveDepth: config.engraveDepth,
    pocketDepth: Math.min(3, config.pocketMaxDepth, material.t / 2),
    pocketMaxDepth: config.pocketMaxDepth,
    marginMm: config.marginMm,
    climb: config.climb,
    tabs: { ...config.tabs },
  };
}

/** What the checker holds a file to. */
export function checkLimits(config, material) {
  return {
    board: { w: material.w, h: material.h, t: material.t },
    maxThroughMm: config.throughMm + 0.05,
    maxFeed: Math.max(material.feed, material.plunge),
    maxRpm: 32000, // above any hand-dialled router; M3 S is only a prompt for the teacher
    safeZ: config.safeZ,
    maxLines: LIMITS.maxLines,
  };
}

/** Dial (1-6, halves allowed) → approximate rpm, in between the table's steps. */
export function rpmFor(config, material) {
  const table = ROUTERS[config.router].dial;
  const d = Math.min(6, Math.max(1, material.dial)) - 1;
  const lo = Math.floor(d);
  const hi = Math.min(5, lo + 1);
  return Math.round((table[lo] + (table[hi] - table[lo]) * (d - lo)) / 250) * 250;
}

/** A student's file name → "name.nc", letters, digits, dashes only. */
export function ncFileName(name, fallback = 'my-cut') {
  const base = String(name ?? '')
    .normalize('NFKD')
    .replace(/\.(nc|gcode|ngc|tap|svg)$/i, '')
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `${base || fallback}.nc`;
}
