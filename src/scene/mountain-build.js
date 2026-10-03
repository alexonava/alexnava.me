import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from "three";

// The film mountains' geometry, kept outside the initial scene (the lazy
// scene.mountain-build.HASH.js chunk). hill-silhouette.js requests it when the
// film activates at a visible quality (high or balanced, never low) and draws
// an empty stand-in until the build lands: at once where the change cannot
// show mid-shot, otherwise fading in (entrance()). Everything the shader
// needs arrives as vertex attributes; this module imports only Three.js, never
// a first-party module, and hill-silhouette.js mirrors the snowline it shades.

// Film alpine ranges, built around the camera: crests are elevation angles (degrees)
// per world azimuth atan2(z, x), so every shot and viewport gets a known backdrop and
// the camera can never stand inside a range. Five ranges, near to far, all inside the
// camera's far plane (450). Prime lattice counts keep the crest from repeating around
// the ring. peaks: [azimuth, apex, half-width, range]; background: [azimuth, cap] knots,
// the tallest a range's noise may rise, capped low under the sun and roof saddle
// (171-183), across the tree shots (22-86, so sky stays open above the lantern on every
// width) and at 234-280.
export const MOUNTAINS = Object.freeze({
  radii: Object.freeze([225, 275, 300, 330, 385]),
  share: Object.freeze([0.45, 0.6, 0.72, 0.84, 1]),
  // Radius factor per row, crest first: 6 rows x 2160 columns x 5 ranges is
  // 64,800 vertices, inside Uint16 indices. Row 0 is the crest; each lower row
  // follows a progressively smoothed crest, so spurs broaden downward.
  rows: Object.freeze([1, 0.975, 0.945, 0.91, 0.87, 0.8]),
  columns: 2160,
  foot: -18,
  octaves: Object.freeze([7, 17, 41, 97, 211]),
  summits: Object.freeze([53, 67, 61, 83, 101]),
  // Asymmetric, domain-warped summits: each flank's share of the width (skew),
  // its concavity (exponent), the warp of the lattice (cells, at 3x and 7x the
  // cell count) and a rounded shoulder on the long flank [at, +range, width,
  // +range, rise, +range], never a flat plateau.
  summit: Object.freeze({
    skew: Object.freeze([0.55, 1.45]),
    exponent: Object.freeze([1.35, 2.15]),
    warp: Object.freeze([0.22, 0.1]),
    shoulder: Object.freeze([0.38, 0.3, 0.22, 0.12, 0.1, 0.14]),
  }),
  // Authored peaks keep their exact apex: tighter skew and exponent, 1.3x the
  // half-width, a flank warp that is zero at the apex, and per-peak skew
  // overrides (the Close-up horn keeps a full left flank).
  authored: Object.freeze({
    skew: Object.freeze([0.62, 1.38]),
    exponent: Object.freeze([1.35, 1.75]),
    widen: 1.3,
    warp: 0.035,
    shoulder: Object.freeze([0.34, 0.26, 0.2, 0.1, 0.06, 0.1]),
    skewOverride: Object.freeze({ 0: 1.1 }),
  }),
  notch: 0.14,
  // Crest teeth that grow with height, in degrees of relief (near, far).
  teeth: Object.freeze({
    octaves: Object.freeze([131, 241, 557]),
    weights: Object.freeze([1, 0.7, 0.5]),
    base: Object.freeze([0.1, 0.06]),
    perDegree: Object.freeze([0.05, 0.045]),
  }),
  // Row form smoothing (columns each way) for rows 0-4; the foot copies row 4's.
  smooth: Object.freeze([6, 9, 14, 28, 60]),
  // Each lower row: min(row above - gap, scale x smoothed crest + offset).
  drops: Object.freeze([
    Object.freeze([0.95, -0.12, 0.08]),
    Object.freeze([0.8, -0.5, 0.15]),
    Object.freeze([0.55, -1.3, 0.25]),
    Object.freeze([0.25, -2.7, 0.4]),
  ]),
  // Face normal along the ring = -slope x d(tan elevation)/d(arc), clamped +-3;
  // lean toward the viewer per row (steep near the crest, gentler feet).
  slope: 2.6,
  lean: Object.freeze([1.35, 1.2, 1.05, 0.9, 0.75, 0.6]),
  // Massif height (the snowline's reference): a max filter then a box smooth.
  massif: Object.freeze({ window: 18, smooth: 24 }),
  // The index runs sector by sector (15 degrees each, every range in it, the
  // nearest first) from the seam, an azimuth no tour shot looks toward on any
  // viewport (their views span -147 to 193 degrees), so the sectors in view
  // are one contiguous draw range (showRanges()); `margin` degrees pad it.
  sectors: Object.freeze({ count: 24, seam: 202.5, margin: 3 }),
  lowWindow: 2.6,
  background: Object.freeze(
    [
      [0, 3.1],
      [9, 3.2],
      [17, 3.4],
      [22, 2],
      [86, 2],
      [96, 3.6],
      [126, 4.4],
      [140, 4.8],
      [163, 4],
      [168, 2.6],
      [185, 2.6],
      [200, 4.6],
      [226, 3.6],
      [232, 2.6],
      [282, 2.6],
      [296, 4.8],
      [340, 4.2],
    ].map(Object.freeze),
  ),
  peaks: Object.freeze(
    [
      [11, 6, 6, 4],
      [17, 4.2, 4, 3],
      [101, 3.6, 4, 3],
      [114, 4.6, 6, 4],
      [143, 6.8, 5, 4],
      [150, 8, 8, 4],
      [158, 6.2, 5, 3],
      [175, 2.4, 3.5, 4],
      [180.5, 2.1, 2.5, 3],
      [188, 4.6, 3.5, 3],
      [210, 8.5, 9, 4],
      [222, 6, 5, 3],
      [305, 7, 8, 4],
      [318, 5, 5, 1],
      [330, 6, 6, 3],
    ].map(Object.freeze),
  ),
});
// The moon key (rendering's sun light, 32,28,14), for the coarse vertex shade;
// the film shader lights each pixel from aForm.
const KEY = [32, 28, 14].map((v) => v / Math.hypot(32, 28, 14));
// Columns per yield: each step takes a fraction of a millisecond on a desktop
// and a few on a throttled phone, so a 12 ms slice fits several. The first
// range's first columns run before the engine has optimized the loops (about
// 17 ms per 120 columns at 4x CPU throttle), so they go 20 at a time.
const STEP = 120;
const pace = (range, j) => (j + 1) % (range === 0 && j < 240 ? 20 : STEP) === 0;

// Integer lattice hash and periodic value noise: the same crest on every engine.
function lattice(i, seed) {
  let h = Math.imul(i ^ Math.imul(seed, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// The noise below reads lattice() through tables, one per seed and period,
// filled once per range: the same values, without rehashing every column.
function tables() {
  const cache = new Map();
  return (seed, n) => {
    const key = seed * 4096 + n;
    let values = cache.get(key);
    if (!values) {
      values = new Float64Array(n);
      for (let i = 0; i < n; i++) values[i] = lattice(i, seed);
      cache.set(key, values);
    }
    return values;
  };
}
const RIDGE_WEIGHTS = [0.6, 0.8, 1, 0.8, 0.45];
// Ridged multifractal over the ring, t in [0, 1): sharp creases, each octave
// partly gated by the last.
function ridged(table, seed, octaves, weights = RIDGE_WEIGHTS) {
  const values = octaves.map((n) => table(seed + n, n));
  return (t) => {
    let sum = 0,
      weight = 1;
    for (let octave = 0; octave < octaves.length; octave++) {
      const n = octaves[octave],
        x = t * n,
        i = Math.floor(x),
        f = x - i,
        lattice = values[octave];
      const v = lattice[((i % n) + n) % n] * (1 - f) + lattice[(i + 1) % n] * f;
      const signal = (1 - Math.abs(v * 2 - 1)) ** 2;
      sum += signal * weights[octave] * weight;
      weight = Math.min(1, 0.4 + signal);
    }
    return sum;
  };
}
function normalize(values) {
  let low = Infinity,
    high = -Infinity;
  for (const v of values) {
    if (v < low) low = v;
    if (v > high) high = v;
  }
  const span = high - low || 1;
  for (let j = 0; j < values.length; j++) values[j] = (values[j] - low) / span;
  return values;
}
function backgroundCap(azimuth) {
  const knots = MOUNTAINS.background;
  for (let i = 0; i < knots.length; i++) {
    const [a0, c0] = knots[i],
      [a1, c1] = knots[(i + 1) % knots.length];
    const span = (a1 - a0 + 360) % 360 || 360,
      t = (azimuth - a0 + 360) % 360;
    if (t <= span) return c0 + ((c1 - c0) * t) / span;
  }
  return knots[0][1];
}
// backgroundCap() per column, shared by every range.
let capColumns = null;
function capsOf(columns) {
  if (capColumns?.length !== columns)
    capColumns = Float64Array.from({ length: columns }, (_, j) =>
      backgroundCap((j / columns) * 360),
    );
  return capColumns;
}
// Periodic smooth value noise with n knots around the ring.
function vn(table, n, seed) {
  const lattice = table(seed, n);
  return (u) => {
    const x = u * n,
      i = Math.floor(x),
      f = x - i,
      s = f * f * (3 - 2 * f);
    return lattice[((i % n) + n) % n] * (1 - s) + lattice[(((i + 1) % n) + n) % n] * s;
  };
}

// One flank: dd is the distance from the apex in flank half-widths (0 apex, 1
// foot) and e its concavity; a long flank carries a rounded shoulder at ds of
// width sw, rising sh of the way from the flank to the apex.
function flankProfile(dd, e, long, ds, sw, sh) {
  if (dd >= 1) return 0;
  let v = (1 - dd) ** e;
  if (long) {
    const base = (1 - ds) ** e,
      q = Math.abs(dd - ds) / sw,
      top = base + sh * (1 - base);
    if (q < 1) v = Math.max(v, top * (1 - q * q) ** 2);
  }
  return v;
}

// Jittered, domain-warped periodic lattice of asymmetric summits: the tallest
// over each azimuth (u in [0, 1)).
function summits(table, seed, cells) {
  const { skew, exponent, warp, shoulder } = MOUNTAINS.summit;
  const warp3 = vn(table, cells * 3, seed + 11),
    warp7 = vn(table, cells * 7, seed + 12),
    L = Array.from({ length: 8 }, (_, q) => table(seed + q, cells));
  return (u) => {
    const x = u * cells + warp[0] * (2 * warp3(u) - 1) + warp[1] * (2 * warp7(u) - 1),
      i0 = Math.floor(x);
    let best = 0;
    for (let k = -2; k <= 2; k++) {
      const i = (((i0 + k) % cells) + cells) % cells,
        at = i0 + k + 0.15 + 0.7 * L[0][i],
        half = 0.9 + 1.1 * L[1][i],
        s = skew[0] + (skew[1] - skew[0]) * L[3][i];
      const left = x < at,
        hl = half * s,
        hr = half * (2 - s),
        dd = left ? (at - x) / hl : (x - at) / hr;
      if (dd >= 1) continue;
      const height = 0.4 + 0.6 * L[2][i],
        e = exponent[0] + (exponent[1] - exponent[0]) * L[4][i];
      const v = flankProfile(
        dd,
        e,
        left === hl > hr,
        shoulder[0] + shoulder[1] * L[5][i],
        shoulder[2] + shoulder[3] * L[6][i],
        shoulder[4] + shoulder[5] * L[7][i],
      );
      best = Math.max(best, height * v);
    }
    return best;
  };
}

// One range's crest elevation (degrees) per column, in steps: asymmetric
// summits, varied by the ridged multifractal, notched by a finer summit lattice
// and toothed in proportion to height. Authored peaks keep their exact apex and
// get warped, shouldered flanks; the low windows keep their 2.6 degree ceiling.
// As the backdrop behind the Meshy massifs (RANGE_BACKDROP) a range has no
// authored peaks and its noise rises to capScale of the background caps.
function* crestSteps(range, backdrop = null) {
  const {
    columns,
    share,
    octaves,
    summits: cells,
    notch: notchDepth,
    teeth: tt,
    authored,
    lowWindow,
  } = MOUNTAINS;
  const peaks = backdrop ? [] : MOUNTAINS.peaks,
    capScale = backdrop ? backdrop.capScale : 1;
  const part = share[range],
    far = range / (share.length - 1),
    rough = new Float64Array(columns),
    fine = new Float64Array(columns),
    teeth = new Float64Array(columns),
    crest = new Float64Array(columns),
    table = tables();
  // Each noise's tables fill in a step of their own (thousands of hashes).
  const roughAt = ridged(table, 7919 * (range + 1), octaves);
  yield;
  const fineAt = summits(table, 104729 + 31 * range, 197);
  yield;
  const teethAt = ridged(table, 15485863 + 97 * range, tt.octaves, tt.weights);
  yield;
  const summitAt = summits(table, 613 * (range + 3), cells[range]);
  yield;
  for (let j = 0; j < columns; j++) {
    const u = j / columns;
    rough[j] = roughAt(u);
    fine[j] = fineAt(u);
    teeth[j] = teethAt(u);
    if (pace(range, j)) yield;
  }
  normalize(rough);
  normalize(fine);
  normalize(teeth);
  // This range's authored peaks: their skewed half-widths, concavity, shoulder
  // and flank warps.
  const sh = authored.shoulder;
  const own = [];
  for (let p = 0; p < peaks.length; p++) {
    const [at, apex, half0, peakRange] = peaks[p];
    if (peakRange !== range) continue;
    const s =
        authored.skewOverride[p] ??
        authored.skew[0] + (authored.skew[1] - authored.skew[0]) * lattice(p, 4241),
      half = half0 * authored.widen;
    own.push({
      at,
      apex,
      hl: half * s,
      hr: half * (2 - s),
      e: authored.exponent[0] + (authored.exponent[1] - authored.exponent[0]) * lattice(p, 4243),
      shoulder: [
        sh[0] + sh[1] * lattice(p, 4245),
        sh[2] + sh[3] * lattice(p, 4247),
        sh[4] + sh[5] * lattice(p, 4249),
      ],
      warp360: vn(table, 360, 977 + p),
      warp1080: vn(table, 1080, 979 + p),
    });
    yield;
  }
  const caps = capsOf(columns);
  for (let j = 0; j < columns; j++) {
    const u = j / columns,
      azimuth = u * 360,
      cap = caps[j],
      notch = notchDepth * (1 - fine[j]);
    let value =
      cap * capScale * part * (0.3 + 0.7 * summitAt(u)) * (0.8 + 0.2 * rough[j]) * (1 - notch);
    for (const { at, apex, hl, hr, e, shoulder, warp360, warp1080 } of own) {
      const signed = ((azimuth - at + 540) % 360) - 180,
        left = signed < 0,
        raw = left ? -signed / hl : signed / hr;
      // The warp moves a flank by at most 1.5 x warp: beyond that it is bare.
      if (raw >= 1 + 1.5 * authored.warp) continue;
      // Domain warp along the flank, zero at the apex so the apex stays exact.
      const delta =
        raw +
        authored.warp * Math.min(1, 4 * raw) * (2 * warp360(u) - 1 + 0.5 * (2 * warp1080(u) - 1));
      const v = flankProfile(
        Math.max(0, delta),
        e,
        left === hl > hr,
        shoulder[0],
        shoulder[1],
        shoulder[2],
      );
      if (v > 0) value = Math.max(value, apex * v * (1 - notch * Math.min(1, 3 * delta)));
    }
    // Teeth grow with height.
    const relief =
      tt.base[0] +
      (tt.base[1] - tt.base[0]) * far +
      (tt.perDegree[0] + (tt.perDegree[1] - tt.perDegree[0]) * far) * value;
    value += relief * (teeth[j] - 0.35);
    crest[j] = Math.max(0.2, cap <= lowWindow ? Math.min(value, lowWindow) : value);
    if (pace(range, j)) yield;
  }
  return crest;
}

// Crest elevation in degrees per range and column, near range first; as the
// Meshy massifs' backdrop (RANGE_BACKDROP) with `backdrop`.
export function mountainCrests(backdrop = null) {
  return MOUNTAINS.share.map((_, range) => run(crestSteps(range, backdrop)));
}

// Periodic box smooth and max filter over `radius` columns each way.
function smoothRing(values, radius) {
  const n = values.length,
    out = new Float64Array(n);
  let sum = 0;
  for (let k = -radius; k <= radius; k++) sum += values[((k % n) + n) % n];
  for (let j = 0; j < n; j++) {
    out[j] = sum / (2 * radius + 1);
    sum += values[(j + radius + 1) % n] - values[(((j - radius) % n) + n) % n];
  }
  return out;
}
function maxRing(values, radius) {
  const n = values.length,
    out = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let m = -Infinity;
    for (let k = -radius; k <= radius; k++) m = Math.max(m, values[(j + k + n) % n]);
    out[j] = m;
  }
  return out;
}

// Row elevations (degrees) under one range's crest: progressively smoothed
// crests minus drops, each strictly below the row above; the last is the foot.
export function mountainRows(crest, smoothed = MOUNTAINS.smooth.map((r) => smoothRing(crest, r))) {
  const rows = [Float64Array.from(crest)];
  MOUNTAINS.drops.forEach(([scale, offset, gap], k) => {
    const above = rows[k],
      S = smoothed[k + 1],
      row = new Float64Array(crest.length);
    for (let j = 0; j < crest.length; j++) {
      row[j] = Math.min(above[j] - gap, scale * S[j] + offset);
    }
    rows.push(row);
  });
  rows.push(new Float64Array(crest.length).fill(MOUNTAINS.foot));
  return rows;
}

// The whole build, in steps. Five ranges (or, as the Meshy massifs' backdrop,
// RANGE_BACKDROP's two) x six rows x one ring of columns; columns wrap, so
// there is no seam column at azimuth 0, and triangles face the centre. Vertex
// attributes:
// aTerrain = (degrees below this column's crest, range, coarse moonlight 0..1,
//   massif height: the snowline's reference, 0 on the near range, which stays
//   bare).
// aForm = (face normal along the ring: minus the slope of the row's smoothed
//   profile, clamped +-3; lean toward the viewer; fold, convex + and concave -,
//   clamped +-1; the nearer ranges' skyline in degrees, -90 on the near range).
// backdrop: build only its ranges, with its crests; nearer: the Meshy massifs'
// skyline per column (degrees), which the backdrop's mist rises from too.
function* geometrySteps({ backdrop = null, nearer = null } = {}) {
  const { radii, rows: rowRadius, columns, slope: slopeGain, lean, massif, smooth } = MOUNTAINS;
  const built = backdrop ? backdrop.ranges : radii.map((_, range) => range),
    crests = [];
  for (const range of built) crests[range] = yield* crestSteps(range, backdrop);
  const R = built.length,
    nRows = rowRadius.length,
    perRange = nRows * columns,
    V = R * perRange;
  const positions = new Float32Array(V * 3),
    terrain = new Float32Array(V * 4),
    form = new Float32Array(V * 4),
    index = new Uint16Array(R * (nRows - 1) * columns * 6);
  const rad = Math.PI / 180,
    step = (2 * Math.PI) / columns;
  let cursor = 0,
    farthest = 0;
  for (let slot = 0; slot < R; slot++) {
    const range = built[slot],
      crest = crests[range],
      radius = radii[range],
      far = range / (radii.length - 1);
    const smoothed = smooth.map((r) => smoothRing(crest, r));
    yield;
    const rows = mountainRows(crest, smoothed);
    yield;
    const height = range > 0 ? smoothRing(maxRing(crest, massif.window), massif.smooth) : null;
    yield;
    // Per smoothed row: its slope along the ring and its curvature (fold).
    const formRows = [];
    for (let k = 0; k < smoothed.length; k++) {
      const profile = smoothed[k],
        m = Math.max(2, Math.round(smooth[k] / 2)),
        tangents = profile.map((e) => Math.tan(e * rad)),
        slope = new Float64Array(columns),
        curve = new Float64Array(columns);
      for (let j = 0; j < columns; j++) {
        const a = tangents[(j + m) % columns],
          b = tangents[(j - m + columns) % columns];
        slope[j] = (a - b) / (2 * m * step);
        curve[j] = (a + b - 2 * tangents[j]) / (m * step) ** 2;
      }
      formRows.push({ slope, curve });
      yield;
    }
    for (let j = 0; j < columns; j++) {
      const azimuth = j * step,
        tx = -Math.sin(azimuth),
        tz = Math.cos(azimuth),
        ix = -Math.cos(azimuth),
        iz = -Math.sin(azimuth);
      // Coarse moonlight from the massif-scale form (row 3's smoothing).
      const cx = -formRows[3].slope[j] * slopeGain,
        nx = cx * tx + lean[2] * ix,
        nz = cx * tz + lean[2] * iz,
        coarse = (nx * KEY[0] + KEY[1] + nz * KEY[2]) / Math.hypot(nx, 1, nz);
      let skyline = -90;
      if (range) {
        skyline = Math.max(-5, nearer ? nearer[j] : -90);
        for (const q of built) if (q < range) skyline = Math.max(skyline, crests[q][j]);
      }
      for (let row = 0; row < nRows; row++) {
        const e = rows[row][j],
          v = slot * perRange + row * columns + j,
          r = radius * rowRadius[row],
          y = r * Math.tan(e * rad),
          f = formRows[Math.min(row, formRows.length - 1)];
        positions[v * 3] = Math.cos(azimuth) * r;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = Math.sin(azimuth) * r;
        farthest = Math.max(farthest, r * r + y * y);
        terrain[v * 4] = crest[j] - e;
        terrain[v * 4 + 1] = range;
        terrain[v * 4 + 2] = Math.min(1, Math.max(0, (coarse + 0.1) / 1.1));
        terrain[v * 4 + 3] = range > 0 ? height[j] : 0;
        form[v * 4] = Math.max(-3, Math.min(3, -f.slope[j] * slopeGain));
        form[v * 4 + 1] = lean[row] * (1 - 0.25 * far);
        form[v * 4 + 2] = Math.max(-1, Math.min(1, -f.curve[j] * 0.06 * (1 + row)));
        form[v * 4 + 3] = skyline;
      }
      if (pace(range, j)) yield;
    }
    yield;
  }
  // Sector by sector from the seam; in each, the ranges nearest first, so
  // early depth rejects the farther ones.
  const { count: sectors, seam } = MOUNTAINS.sectors,
    span = columns / sectors,
    first = Math.round((seam / 360) * columns);
  for (let sector = 0; sector < sectors; sector++) {
    for (let slot = 0; slot < R; slot++)
      for (let row = 0; row < nRows - 1; row++)
        for (let i = 0; i < span; i++) {
          const j = (first + sector * span + i) % columns,
            s = slot * perRange + row * columns + j,
            n = slot * perRange + row * columns + ((j + 1) % columns);
          index[cursor] = s;
          index[cursor + 1] = s + columns;
          index[cursor + 2] = n;
          index[cursor + 3] = s + columns;
          index[cursor + 4] = n + columns;
          index[cursor + 5] = n;
          cursor += 6;
        }
    yield;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aTerrain", new BufferAttribute(terrain, 4));
  geometry.setAttribute("aForm", new BufferAttribute(form, 4));
  geometry.setIndex(new BufferAttribute(index, 1));
  // The ranges ride on the camera; their bounds are the ring about the origin.
  geometry.boundingSphere = new Sphere(new Vector3(), Math.sqrt(farthest));
  geometry.userData.sectors = { count: sectors, size: index.length / sectors };
  return geometry;
}

function run(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

// The whole geometry at once (tests): the five rings, or with { backdrop,
// nearer } the backdrop behind the Meshy massifs.
export function createMountainGeometry(options) {
  return run(geometrySteps(options));
}

// The Meshy massifs: the owner's three Meshy mountains (images/architecture/
// mountain-ridge, mountain-spine and mountain-summit, prepared in
// Assets/Architecture/mountains-v1), set as copies around the camera to form
// the near ranges, with RANGE_BACKDROP's two farthest rings left behind them as
// hazy depth. Each GLB is the part of its massif an eye in front of it can see
// (front +Z; frame: bounding X/Z centred, base y = 0, largest horizontal
// half-extent 1), its relief baked into an object-space normal map.
//
// A placement is one eye in the model's frame, and every transform below is
// affine, which keeps what that eye sees: `distance` from the bounding centre
// and `yaw` about the front (frame units, degrees), `sink` (the eye's height
// above the base as a share of the model's height: how deep the massif stands
// in the plain), `squash` (its vertical scale) and `mirror`. The eye's line to
// the centre points at world `azimuth` (atan2(z, x), degrees), and each vertex
// slides along its own sight line so the massif fills its `layer`'s shell
// (RANGE_LAYERS, distances from the camera): the layers stay in order and
// inside the far plane, and not a pixel of the view changes. Layer 0 stays
// bare; `snow` is a copy's snowline (hill-silhouette.js MASSIF_SNOW line, in
// degrees; 0 bare). The GLB's extras record the envelope of eyes its
// shell was culled for, and every placement stays inside it.
export const RANGE_LAYERS = Object.freeze([
  Object.freeze([200, 218]),
  Object.freeze([222, 240]),
  Object.freeze([244, 258]),
]);
export const RANGE_BACKDROP = Object.freeze({ ranges: Object.freeze([3, 4]), capScale: 1 });
// The watch's summit leads (about 9 degrees) with a smaller one right of the
// tower; the broad ridge stands behind Portrait's tree; snowy massifs rise
// behind the tree shots (up to about 3.3 degrees, an 8% band of open sky above
// them); a mirrored summit makes the Close-up horn; bare low copies form the
// near layer across every tour view (none from about 305 to 340 degrees,
// which no shot faces).
// [id, role, layer, azimuth, distance, yaw, mirror, sink, squash, snow]
export const RANGE_PLACEMENTS = Object.freeze(
  [
    ["watch", "mountain-summit", 2, 155, 3.8, 0, false, 0.28, 1, 2.4],
    ["east", "mountain-ridge", 1, 196, 4.8, -25, true, 0.4, 0.85, 2.2],
    ["bridge", "mountain-summit", 2, 127, 5, 25, true, 0.4, 0.9, 2],
    ["portrait", "mountain-ridge", 1, 108, 3.6, -5, false, 0.25, 1, 2.4],
    ["lantern", "mountain-summit", 2, 62, 6, -10, false, 0.5, 0.8, 2.6],
    ["closeup", "mountain-ridge", 2, 36, 5, 10, false, 0.35, 0.74, 2],
    ["horn", "mountain-summit", 1, 13, 6, 15, true, 0.25, 1, 2.9],
    ["threshold", "mountain-ridge", 2, 206, 4, 20, true, 0.35, 0.9, 2],
    ["west", "mountain-summit", 2, 300, 5, -20, false, 0.45, 0.9, 2],
    ["near-a", "mountain-spine", 0, -6, 4, 0, false, 0.25, 0.9, 0],
    ["near-b", "mountain-ridge", 0, 30, 4.6, 25, true, 0.5, 0.45, 0],
    ["near-c", "mountain-spine", 0, 66, 3.2, -20, false, 0.35, 0.7, 0],
    ["near-d", "mountain-summit", 0, 96, 6, 20, false, 0.55, 0.6, 0],
    ["near-e", "mountain-spine", 0, 128, 3, 25, true, 0.3, 0.72, 0],
    ["near-f", "mountain-ridge", 0, 166, 4.2, -15, false, 0.5, 0.5, 0],
    ["near-g", "mountain-spine", 0, 198, 3.8, -10, false, 0.3, 0.85, 0],
    ["near-h", "mountain-ridge", 0, 232, 4, 10, true, 0.5, 0.5, 0],
    ["near-i", "mountain-spine", 0, 265, 3.4, 15, true, 0.3, 0.85, 0],
    ["near-j", "mountain-summit", 0, 296, 5.5, -15, false, 0.55, 0.6, 0],
  ].map(([id, role, layer, azimuth, distance, yaw, mirror, sink, squash, snow]) =>
    Object.freeze({ id, role, layer, azimuth, distance, yaw, mirror, sink, squash, snow }),
  ),
);
// Skylines run in bins of RANGE_SKY.bin degrees; the nearer layers' skyline
// reaches the shader as RANGE_SKY.texture bins around the ring (RGBA8: two
// 16-bit values, layer 0's and layers 0-1's, over RANGE_SKY.span degrees from
// RANGE_SKY.floor).
export const RANGE_SKY = Object.freeze({ bin: 0.05, texture: 4096, floor: -10, span: 40 });
const DEG = 180 / Math.PI;

// One placement of a model ({ position, uv, index, height }: the GLB's
// attributes, read through getX() so quantized ones decode): camera-relative
// positions after the shell remap, each vertex's elevation and azimuth
// (degrees, the azimuth unwrapped about the placement's), the triangle index
// (wound for the mirror) and the placement's turn about the vertical (radians).
export function placeRange(model, placement) {
  const { position, index } = model,
    n = position.count,
    { azimuth, distance, yaw, mirror, sink, squash = 1, layer } = placement,
    flip = mirror ? -1 : 1,
    y0 = yaw / DEG,
    ex = distance * Math.sin(y0),
    ey = sink * model.height,
    ez = distance * Math.cos(y0),
    turn = azimuth / DEG - Math.atan2(-Math.cos(y0), -Math.sin(y0)),
    c = Math.cos(turn),
    s = Math.sin(turn);
  const out = new Float32Array(n * 3),
    elevation = new Float32Array(n),
    azimuths = new Float32Array(n),
    reach = new Float64Array(n);
  let near = Infinity,
    far = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = flip * position.getX(i) - ex,
      y = squash * (position.getY(i) - ey),
      z = position.getZ(i) - ez,
      px = x * c - z * s,
      pz = x * s + z * c,
      d = Math.hypot(px, y, pz);
    out[i * 3] = px;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = pz;
    reach[i] = d;
    near = Math.min(near, d);
    far = Math.max(far, d);
    elevation[i] = Math.atan2(y, Math.hypot(px, pz)) * DEG;
    azimuths[i] = azimuth + ((((Math.atan2(pz, px) * DEG - azimuth) % 360) + 540) % 360) - 180;
  }
  const [inner, outer] = RANGE_LAYERS[layer];
  for (let i = 0; i < n; i++) {
    const k = (inner + ((reach[i] - near) / (far - near)) * (outer - inner)) / reach[i];
    out[i * 3] *= k;
    out[i * 3 + 1] *= k;
    out[i * 3 + 2] *= k;
  }
  const count = index.count ?? index.length,
    at = index.getX ? (i) => index.getX(i) : (i) => index[i],
    triangles = new Uint32Array(count);
  for (let t = 0; t < count; t += 3) {
    triangles[t] = at(t);
    triangles[t + 1] = at(mirror ? t + 2 : t + 1);
    triangles[t + 2] = at(mirror ? t + 1 : t + 2);
  }
  return { position: out, elevation, azimuth: azimuths, index: triangles, turn };
}

// A placed massif's skyline: the highest elevation per RANGE_SKY.bin of
// azimuth, along every triangle edge (sampled under half a bin apart), so it
// follows the crest between vertices. { from: the first bin's azimuth, start:
// its index (from / bin, exact), values: degrees, -90 where the massif does not
// reach }.
export function rangeSkyline({ position, elevation, azimuth, index }) {
  const { bin } = RANGE_SKY;
  let lo = Infinity,
    hi = -Infinity;
  for (const a of azimuth) {
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  const start = Math.floor(lo / bin),
    from = start * bin,
    values = new Float32Array(Math.ceil((hi - from) / bin) + 1).fill(-90);
  for (let t = 0; t < index.length; t += 3) {
    // Only the faces the camera sees (FrontSide): a culled back face never draws, so it
    // must not raise the crest above what shows.
    if (position && !facesCamera(position, index[t], index[t + 1], index[t + 2])) continue;
    for (let k = 0; k < 3; k++) {
      const a = index[t + k],
        b = index[t + ((k + 1) % 3)],
        a0 = azimuth[a],
        da = azimuth[b] - a0,
        e0 = elevation[a],
        de = elevation[b] - e0,
        steps = Math.max(1, Math.ceil((2 * Math.abs(da)) / bin));
      for (let q = 0; q <= steps; q++) {
        const f = q / steps,
          j = Math.floor((a0 + da * f - from) / bin),
          e = e0 + de * f;
        if (e > values[j]) values[j] = e;
      }
    }
  }
  return { from, start, values };
}

// Whether triangle a, b, c (camera-relative positions) winds counter-clockwise as the
// camera at the origin sees it: its normal points back toward the camera.
function facesCamera(p, a, b, c) {
  const ax = p[a * 3],
    ay = p[a * 3 + 1],
    az = p[a * 3 + 2],
    ux = p[b * 3] - ax,
    uy = p[b * 3 + 1] - ay,
    uz = p[b * 3 + 2] - az,
    vx = p[c * 3] - ax,
    vy = p[c * 3 + 1] - ay,
    vz = p[c * 3 + 2] - az;
  return (uy * vz - uz * vy) * ax + (uz * vx - ux * vz) * ay + (ux * vy - uy * vx) * az < 0;
}

// The snowline's reference along a massif, as the rings' (massif): its
// skyline's maximum over 3 degrees each way, then averaged over 4.
export function rangeMassif({ values }) {
  const { bin } = RANGE_SKY,
    n = values.length,
    wide = Math.round(3 / bin),
    even = Math.round(4 / bin),
    peak = new Float32Array(n),
    out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    let m = -90;
    for (let k = Math.max(0, j - wide); k <= Math.min(n - 1, j + wide); k++)
      m = Math.max(m, values[k]);
    peak[j] = m;
  }
  for (let j = 0; j < n; j++) {
    let sum = 0,
      count = 0;
    for (let k = Math.max(0, j - even); k <= Math.min(n - 1, j + even); k++)
      if (peak[k] > -90) {
        sum += peak[k];
        count++;
      }
    out[j] = count ? sum / count : -90;
  }
  return out;
}

// The Meshy massifs in steps: each placement placed, its skyline and massif;
// then one geometry per model with every copy of it, its triangles ordered
// sector by sector from the seam (nearest layer first), as the rings'. Vertex
// attributes:
// aTerrain = (degrees below its own copy's crest, layer, snowline or 0, massif),
// aInst = (cos and sin of the copy's turn, its mirror 1 or -1, its squash), with
//   which the shader turns the object-space normal map into the world,
// and the GLB's uv. Also returns the massifs' skyline per ring column (the
// backdrop's nearer skyline) and the nearer layers' skyline texels (RANGE_SKY).
function* rangeSteps(models, placements = RANGE_PLACEMENTS) {
  const { bin } = RANGE_SKY,
    { count: sectors, seam } = MOUNTAINS.sectors,
    width = 360 / sectors;
  const placed = [];
  for (const placement of placements) {
    const model = models[placement.role],
      shape = placeRange(model, placement);
    yield;
    const sky = rangeSkyline(shape);
    yield;
    placed.push({ placement, model, shape, sky, massif: rangeMassif(sky) });
    yield;
  }
  // Each layer's skyline around the ring (finest bins), for the mist and the backdrop.
  const ring = Math.round(360 / bin),
    layers = [0, 1, 2].map(() => new Float32Array(ring).fill(-90));
  for (const { placement, sky } of placed) {
    const line = layers[placement.layer];
    // By the skyline's integer start: from / bin in floating point could round
    // either way and skip a bin, a hole in the mist.
    sky.values.forEach((e, j) => {
      const k = (((sky.start + j) % ring) + ring) % ring;
      if (e > line[k]) line[k] = e;
    });
  }
  yield;
  const { columns } = MOUNTAINS,
    nearer = new Float64Array(columns).fill(-90),
    per = ring / columns;
  for (let j = 0; j < columns; j++)
    for (let k = Math.floor(j * per - per / 2); k <= Math.ceil(j * per + per / 2); k++) {
      const kk = ((k % ring) + ring) % ring;
      nearer[j] = Math.max(nearer[j], layers[0][kk], layers[1][kk], layers[2][kk]);
    }
  const { texture: texels, floor, span } = RANGE_SKY,
    texture = new Uint8Array(texels * 4),
    pack = (e, at) => {
      const v = Math.round(Math.min(1, Math.max(0, (e - floor) / span)) * 65535);
      texture[at] = v >> 8;
      texture[at + 1] = v & 255;
    };
  for (let t = 0; t < texels; t++) {
    let near = -90,
      both = -90;
    for (let k = Math.floor((t * ring) / texels); k < Math.floor(((t + 1) * ring) / texels); k++) {
      near = Math.max(near, layers[0][k]);
      both = Math.max(both, layers[0][k], layers[1][k]);
    }
    pack(near, t * 4);
    pack(both, t * 4 + 2);
  }
  yield;
  const geometries = {};
  for (const role of Object.keys(models)) {
    const copies = placed.filter(({ placement }) => placement.role === role);
    if (!copies.length) continue;
    let vertices = 0,
      triangles = 0;
    for (const { shape } of copies) {
      vertices += shape.elevation.length;
      triangles += shape.index.length / 3;
    }
    const position = new Float32Array(vertices * 3),
      uv = new Float32Array(vertices * 2),
      terrain = new Float32Array(vertices * 4),
      inst = new Float32Array(vertices * 4),
      corners = new Uint32Array(triangles * 3),
      keys = new Uint16Array(triangles);
    let base = 0,
      tri = 0,
      farthest = 0;
    for (const { placement, model, shape, sky, massif } of copies) {
      const n = shape.elevation.length,
        cos = Math.cos(shape.turn),
        sin = Math.sin(shape.turn);
      position.set(shape.position, base * 3);
      for (let i = 0; i < n; i++) {
        const v = base + i,
          j = Math.min(sky.values.length - 1, Math.floor((shape.azimuth[i] - sky.from) / bin));
        uv[v * 2] = model.uv.getX(i);
        uv[v * 2 + 1] = model.uv.getY(i);
        terrain[v * 4] = Math.max(0, sky.values[j] - shape.elevation[i]);
        terrain[v * 4 + 1] = placement.layer;
        terrain[v * 4 + 2] = placement.snow || 0;
        terrain[v * 4 + 3] = massif[j];
        inst[v * 4] = cos;
        inst[v * 4 + 1] = sin;
        inst[v * 4 + 2] = placement.mirror ? -1 : 1;
        inst[v * 4 + 3] = placement.squash;
        farthest = Math.max(farthest, Math.hypot(...shape.position.subarray(i * 3, i * 3 + 3)));
      }
      for (let t = 0; t < shape.index.length; t += 3, tri++) {
        const a = shape.index[t],
          b = shape.index[t + 1],
          c = shape.index[t + 2],
          centre = (shape.azimuth[a] + shape.azimuth[b] + shape.azimuth[c]) / 3,
          sector = Math.floor(((((centre - seam) % 360) + 360) % 360) / width);
        corners.set([base + a, base + b, base + c], tri * 3);
        keys[tri] = sector * 3 + placement.layer;
      }
      base += n;
      yield;
    }
    // Counting sort: sector by sector, the nearest layer first in each.
    const counts = new Uint32Array(sectors * 3 + 1);
    for (const key of keys) counts[key + 1]++;
    for (let k = 1; k < counts.length; k++) counts[k] += counts[k - 1];
    const index =
        vertices < 65536 ? new Uint16Array(triangles * 3) : new Uint32Array(triangles * 3),
      next = counts.slice(0, -1);
    for (let t = 0; t < triangles; t++)
      index.set(corners.subarray(t * 3, t * 3 + 3), next[keys[t]]++ * 3);
    const starts = Array.from({ length: sectors + 1 }, (_, s) => counts[s * 3] * 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(position, 3));
    geometry.setAttribute("uv", new BufferAttribute(uv, 2));
    geometry.setAttribute("aTerrain", new BufferAttribute(terrain, 4));
    geometry.setAttribute("aInst", new BufferAttribute(inst, 4));
    geometry.setIndex(new BufferAttribute(index, 1));
    geometry.boundingSphere = new Sphere(new Vector3(), farthest);
    // Large triangles reach a little past their centre's sector: one sector of padding.
    geometry.userData.sectors = { count: sectors, starts, pad: 1 };
    geometries[role] = geometry;
    yield;
  }
  return { geometries, nearer, texture, placed };
}

// The Meshy massifs and their backdrop at once (tests): models as placeRange()
// takes them, keyed by role.
export function createRangeGeometry(models, placements = RANGE_PLACEMENTS) {
  return run(rangeSteps(models, placements));
}

// The whole Meshy build: the massifs, then the backdrop rings behind them with
// the massifs' skyline as their nearer one. `texels` (RANGE_SKY.texture x 4
// bytes) receives the nearer layers' skyline.
function* composedSteps(models, texels) {
  const ranges = yield* rangeSteps(models);
  const backdrop = yield* geometrySteps({ backdrop: RANGE_BACKDROP, nearer: ranges.nearer });
  texels?.set(ranges.texture);
  return { backdrop, massifs: ranges.geometries };
}

const nextFrame = (task) =>
  (globalThis.requestAnimationFrame ?? ((next) => setTimeout(next, 16)))(task);

// Whether the canvas is fading in over the title card (styles.css, timed from the
// reveal's babel:reveal mark), or, unless hidden is false, still hidden. Like
// terrain-build.js's (a copy keeps this chunk free of first-party imports),
// except that it reads the fade's duration up front: styles.css sets it on the
// canvas container before the reveal too, and reading it just after the reveal
// forced a style recalculation inside the first rushed slice (about 6 ms at 4x
// CPU throttle).
function fading(rendering, hidden = true) {
  const container = () => rendering?.renderer?.domElement?.parentNode,
    style = container() && globalThis.getComputedStyle?.(container())?.transitionDuration,
    duration =
      typeof style === "string" ? parseFloat(style) * (/ms/.test(style) ? 1 : 1000) || 0 : 0;
  let fadeEnd = null;
  return () => {
    if (!container()?.classList?.contains("is-ready")) return hidden;
    fadeEnd ??=
      (performance.getEntriesByName?.("babel:reveal", "mark").at(-1)?.startTime ?? -Infinity) +
      duration;
    return performance.now() < fadeEnd;
  };
}
// How the ranges enter once built, in seconds of fade-in. At once (0) where
// the change cannot show mid-shot: before the reveal, on a tour cut under the
// dissolve's kept frame, or on any frame while the tour is not running (the
// rule terrain-build.js and light-shafts.js follow). Under the canvas's fade-in
// over the title card, which is already partly opaque, over `fade`; and mid-shot,
// where a slow phone missed both, over `late`, rather than leaving the horizon
// bare until the next cut (up to a whole 9 s hold).
export const MOUNTAIN_ENTRANCE = Object.freeze({ fade: 0.45, late: 1.8 });
function entrance(rendering, tour) {
  const early = fading(rendering, false);
  return () =>
    !tour?.running ||
    tour.transition.cut ||
    !rendering.renderer?.domElement?.parentNode?.classList?.contains("is-ready")
      ? 0
      : early()
        ? MOUNTAIN_ENTRANCE.fade
        : MOUNTAIN_ENTRANCE.late;
}

// The sectors of the ring in view of a perspective camera, as [first, count]
// from the seam, or null to draw them all (a view across the seam, very wide
// or steep). Any direction inside the frustum lies within the azimuths of its
// four corner rays while they span less than a half turn.
const DEGREES = 180 / Math.PI,
  corner = new Vector3(),
  ahead = new Vector3();
export function sectorsInView(camera) {
  const { count, seam, margin } = MOUNTAINS.sectors;
  if (!camera?.isPerspectiveCamera) return null;
  ahead.set(0, 0, -1).transformDirection(camera.matrixWorld);
  if (Math.abs(ahead.y) > 0.9) return null;
  const forward = Math.atan2(ahead.z, ahead.x) * DEGREES;
  let low = 0,
    high = 0;
  for (let k = 0; k < 4; k++) {
    corner
      .set(k & 1 ? 1 : -1, k & 2 ? 1 : -1, 1)
      .applyMatrix4(camera.projectionMatrixInverse)
      .transformDirection(camera.matrixWorld);
    const turn = ((((Math.atan2(corner.z, corner.x) * DEGREES - forward) % 360) + 540) % 360) - 180;
    low = Math.min(low, turn);
    high = Math.max(high, turn);
  }
  const from = (((forward + low - margin - seam) % 360) + 360) % 360,
    to = from + high - low + 2 * margin,
    width = 360 / count;
  if (high - low > 150 || to >= 360) return null;
  const first = Math.floor(from / width);
  return [first, Math.floor(to / width) - first + 1];
}

// Shows landed ranges on their mesh: each draw of them takes only the sectors
// in view (sectorsInView(); the whole ring again once drawn, so exports and
// bounds see it all), and, given `seconds`, fades them in over that many
// seconds of drawn frames (each frame's step at most 0.1 s, so a hidden or
// paused page resumes where it left off). The fade blends the mountain
// material by a constant alpha over what the canvas already shows there (the
// sky, its clouds and stars), its depth-layer code too, so the grade's relief
// exemption (postprocess.js) fades in with the colour and no cel band pops.
// Literal three constants (CustomBlending 5, AddEquation 100,
// ConstantAlphaFactor 213, OneMinusConstantAlphaFactor 214) keep this chunk
// from growing the shared three exports; the material's own blending (none)
// returns once the ranges are whole. False, doing nothing, without a mesh or
// sectored ranges.
export function showRanges(mesh, ranges, seconds = 0) {
  const sectors = ranges?.userData.sectors;
  if (!mesh || !sectors) return false;
  // The rings' sectors are equal (size); the massifs' are not (starts, padded by
  // `pad` sectors each side for triangles reaching past their centre's sector).
  const { count, size, starts, pad = 0 } = sectors,
    at = (sector) => (starts ? starts[sector] : sector * size),
    shading = mesh.material,
    whole = at(count),
    blending = shading?.blending;
  let fading = seconds > 0 && Boolean(shading?.isShaderMaterial),
    shown = 0,
    last = null;
  if (fading)
    Object.assign(shading, {
      blending: 5,
      blendEquation: 100,
      blendEquationAlpha: 100,
      blendSrc: 213,
      blendDst: 214,
      blendSrcAlpha: 213,
      blendDstAlpha: 214,
      blendAlpha: 0,
    });
  ranges.setDrawRange(0, whole);
  mesh.onBeforeRender = function (_renderer, _scene, camera, geometry) {
    if (geometry !== ranges) return;
    const view = sectorsInView(camera);
    if (view) {
      const first = Math.max(0, view[0] - pad),
        last = Math.min(count, view[0] + view[1] + pad);
      ranges.setDrawRange(at(first), at(last) - at(first));
    }
    if (!fading) return;
    const now = performance.now();
    if (last !== null) shown += Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    const k = Math.min(1, shown / seconds);
    shading.blendAlpha = k * k * (3 - 2 * k);
    if (k < 1) return;
    shading.blending = blending;
    fading = false;
  };
  mesh.onAfterRender = function (_renderer, _scene, _camera, geometry) {
    if (geometry === ranges) ranges.setDrawRange(0, whole);
  };
  return true;
}

// The film backdrop takes the idle time before the light shafts, which wait
// while rendering.terrainSlicing holds a promise (light-shafts.js): the ranges
// should land under the fade or on a cut, while a shaft can fade in
// mid-hold. The slot is shared with the terrain's build (terrain-build.js):
// while both slice it holds a promise for both, and it clears once both end.
function holdSlot(rendering, work) {
  if (!rendering) return () => {};
  let held = null;
  const claim = () => {
    const current = rendering.terrainSlicing;
    if (current && current === held) return;
    held = current ? Promise.all([current, work]) : work;
    rendering.terrainSlicing = held;
    const mine = held;
    mine.then(() => {
      if (rendering.terrainSlicing === mine) rendering.terrainSlicing = null;
    });
  };
  claim();
  return claim;
}

// The film mountains in slices of a few milliseconds, never a long task (the
// terrain's schedule, terrain-build.js): while the canvas fades in over the
// title card, slices of up to 12 ms run back to back, so the ranges land inside
// the fade even on a throttled phone; otherwise they take idle time, less
// where the idle wait timed out. An idle wait can starve behind the reveal's
// own work and the terrain's rushed slices (at 4x CPU throttle the first slice
// came 130 ms into the fade), so a pending wait also checks every frame and
// rushes as soon as the fade begins. The finished geometry resolves as soon as
// it is built; mesh (the ranges' mesh, whose material is the mountain shader)
// then draws only the sectors in view and, where the change could show
// mid-shot, fades it in (entrance(), showRanges()); the geometry's
// userData.fadeIn records the seconds (0: at once). cancelled: the
// ranges were disposed, so the build stops, or the finished geometry is freed,
// and it resolves to null.
export function buildMountains({
  rendering = null,
  tour = null,
  cancelled = () => false,
  mesh = null,
  models = null,
  massifs = null,
  texels = null,
} = {}) {
  const steps = models ? composedSteps(models, texels) : geometrySteps();
  // With models (placeRange()'s, by role) the build is the Meshy massifs and
  // their backdrop: each massif's geometry lands on its mesh (massifs, by role)
  // and shows as the rings do; the backdrop is what resolves, carrying the
  // massifs' geometries in userData.massifs.
  const settle = (built, seconds) => {
    if (!models) return built;
    for (const [role, geometry] of Object.entries(built.massifs)) {
      const target = massifs?.[role];
      if (!target) {
        geometry.dispose();
        continue;
      }
      target.geometry = geometry;
      showRanges(target, geometry, seconds);
    }
    built.backdrop.userData.massifs = built.massifs;
    return built.backdrop;
  };
  const free = (built) =>
    models
      ? [built.backdrop, ...Object.values(built.massifs)].forEach((g) => g.dispose())
      : built.dispose();
  if (!rendering) return Promise.resolve(cancelled() ? null : settle(run(steps), 0));
  const idle =
    typeof globalThis.requestIdleCallback === "function"
      ? (task) => globalThis.requestIdleCallback(task, { timeout: 100 })
      : (task) => setTimeout(task, 0);
  const rush = fading(rendering, false),
    enter = entrance(rendering, tour);
  let done,
    longest = 0,
    sliced = 0;
  const slicing = new Promise((resolve) => {
    done = resolve;
  });
  const claim = holdSlot(rendering, slicing);
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      done();
      settle(value);
    };
    const land = (built) => {
      if (cancelled()) {
        free(built);
        return resolve(null);
      }
      const seconds = enter(),
        geometry = settle(built, seconds);
      showRanges(mesh, geometry, (geometry.userData.fadeIn = seconds));
      resolve(geometry);
    };
    // One pending slice at a time: whichever of its waits fires first runs it.
    let ticket = 0;
    const post = () => {
      const mine = ++ticket;
      const go = (deadline) => {
        if (mine !== ticket) return;
        ticket++;
        slice(deadline);
      };
      if (rush()) return void setTimeout(go, 0);
      idle(go);
      const watch = () => {
        if (mine !== ticket) return;
        if (rush()) setTimeout(go, 0);
        else nextFrame(watch);
      };
      nextFrame(watch);
    };
    // A slice stops before a step that could overrun it: the longest recent step,
    // which decays after a one-off slow step (a cold start) so later slices still
    // fit several steps. The first rushed slices take half the time: the engine
    // optimizes the hot loops there, which added about 6 ms at 4x CPU throttle.
    const slice = (deadline) => {
      if (cancelled()) return finish(resolve, null);
      claim();
      const early = rush();
      const until =
        performance.now() +
        (early
          ? sliced++ < 2
            ? 6
            : 12
          : !deadline
            ? 5
            : deadline.didTimeout
              ? 2
              : Math.max(2, Math.min(8, deadline.timeRemaining())));
      try {
        for (;;) {
          const began = performance.now(),
            next = steps.next(),
            now = performance.now();
          if (next.done) {
            done();
            return land(next.value);
          }
          longest = Math.max(now - began, 0.8 * longest);
          if (now + longest >= until) break;
        }
      } catch (error) {
        return finish(reject, error);
      }
      post();
    };
    post();
  });
}
