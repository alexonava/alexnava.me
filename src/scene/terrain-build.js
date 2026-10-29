import { Box3, BufferAttribute, BufferGeometry, Group, Mesh, Sphere, Vector3 } from "three";
import { COAST_ALBEDO } from "./coast-detail.js";
import {
  SEA,
  coastDistance,
  coastLand,
  coastPlane,
  coastGeometrySteps,
  COAST_SHOTS,
  coastShot,
  createCliff,
  createFalls,
  createSea,
  FALLS,
  SPRAY_FIT,
  FLOW_RMS,
  landFactor,
  riverFalls,
  RAPIDS,
  RAPIDS_BODY,
  rapidsFrame,
  rapidsGlsl,
  rapidsSpeed,
  riverShelfLift,
  riverRunStart,
  SHORE,
  slateShoreEdits,
} from "./ocean.js";

// A lazy chunk: the film terrain with its foothills, the knoll under the tree
// and its root shading, the puddles and their drips, the tufts, the litter and
// the small stones.

// Three low, broken foothill ridges beyond the estate's entire occupied area,
// rising toward the ranges (the owner's pick of 2026-10-09): radius, half-width
// and lift. The outermost ends where the plain fades into the far air.
const RIDGES = [
  [120, 26, 3.2],
  [139, 22, 5.2],
  [156, 22, 7.4],
];
export function foothillHeight(x, z) {
  const r = Math.hypot(x, z);
  // Nothing inside the estate, and nothing past the outer ridge's reach.
  if (r < 88 || r >= 184) return 0;
  const a = Math.atan2(z, x);
  let height = 0;
  for (let k = 0; k < RIDGES.length; k++) {
    const [radius, width, lift] = RIDGES[k];
    const d = Math.abs(r - radius - 5 * Math.sin(a * 3)) / width;
    height += Math.max(0, 1 - d * d) ** 2 * lift * (0.72 + 0.28 * Math.sin(a * 7 + radius));
  }
  // Keep the north-east tree/lantern window low, like the mountain saddle.
  return height * (0.15 + 0.85 * Math.max(0, -Math.cos(a - 0.6)));
}

// Restate the estate anchor here to keep this optional builder independent of
// first-party entry modules (checked against ESTATE in the terrain regression).
export const TREE_FOOTING = { x: 55.1, z: 36.1 };
const ease = (a, b, value) => {
  const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The trunk stands east of the model origin (the estate anchor): its base
// centre, measured on both GLBs, relative to the tree.
export const TRUNK = [3.9, -0.05];

// How far the tree is set into the soil below its lowest vertex (estate-layout.js
// ESTATE.tree.sink, restated as TREE_FOOTING is): prop-scale.js seats the tree
// on that toe, so without it every resting root would hang 0.3 above the
// footing. Sunk, the resting roots enter the soil 0.1-0.15 deep.
export const TREE_SINK = 0.45;

// The knoll under the tree. The dune falls away from the footing to the
// north-east, east and south, so there the soil rises toward it where the
// roots touch down. It holds within `core` of the trunk ([full radius, rim])
// and runs out along each resting root (lobes: heading in degrees, atan2(z, x);
// reach from the trunk; half-width; the rim beside it and the longer one
// beyond its end, down the dune), each rim's edge moved in and out by a slow
// noise (wobble: amplitude and cell, units) so it never draws a clean arc. The
// lobes join smoothly. Toward a puddle it eases out over `feather` beyond the
// pinned ground's keep (PIN_KEEP), so no puddle sits in a cut. It rises a little
// toward the trunk collar (dome: height, full within, none beyond), fills only
// ground below that level, stays well under the south-east spur (SPUR) and
// keeps off the pinned ground (PIN_KEEP).
export const ROOT_KNOLL = Object.freeze({
  core: Object.freeze([4.4, 3]),
  lobes: Object.freeze([
    Object.freeze([-12, 8.3, 1.2, 6.5, 7]), // east
    Object.freeze([34, 6.8, 1, 4.2, 7.5]), // east-north-east
    Object.freeze([57, 7.4, 0.9, 4, 7.5]), // north-east
    Object.freeze([124, 10.7, 0.9, 2.4, 2.4]), // north
    Object.freeze([-97, 9.7, 0.9, 2.4, 2.4]), // south
    Object.freeze([-48, 7.4, 1.2, 3.8, 5]), // south-east, under the spur
  ]),
  wobble: Object.freeze([0.7, 3.5]),
  feather: 1.6,
  dome: Object.freeze([0.14, 0.8, 3.8]),
});

// The aerial spur heading south-east from the trunk (tree-relative, from where
// it leaves the flare to its tip), the half-width about it and its feather,
// and how far below the footing the knoll keeps there (no relief either): it
// stays an open aerial root, its underside 0.9 or more above the soil.
export const SPUR = Object.freeze([5.4, -2.8, 8.2, -6.2, 1.1, 1.4, 0.35]);
// On the level plain the soil under the spur settles into a soft hollow this
// far below the footing, so the root still arches clear of it.
export const SPUR_HOLLOW = 0.6;

// The micro-relief that keeps the soil under the tree from reading as a level
// plate: three octaves of seeded value noise ([wavelength, amplitude, turn in
// degrees]), full within reach[0] of the trunk and gone by reach[1]. It holds
// off a resting root (a ROOT_LINES stretch of contact `contact` or more) to
// `roots` beyond its half-width, so the roots keep their 0.1-0.15 entry depth,
// and off the pinned ground (PIN_KEEP). It is soil shape only: the settled
// soil (rootBermExcess()) ignores it.
export const ROOT_RELIEF = Object.freeze({
  octaves: Object.freeze([
    Object.freeze([7.5, 0.11, 20]),
    Object.freeze([4.1, 0.065, 65]),
    Object.freeze([2.5, 0.035, 110]),
  ]),
  reach: Object.freeze([10.5, 13.5]),
  roots: Object.freeze([0.25, 1.2]),
  contact: 0.7,
  seed: 6271,
});

// Shallow hollows in the root crooks near the trunk: tree-relative x, z,
// radius and depth. Each lies clear of every root and arch above it.
export const ROOT_HOLLOWS = Object.freeze([
  Object.freeze([9.7, 1.5, 1.7, 0.12]),
  Object.freeze([8.8, -3.8, 1.3, 0.08]),
  Object.freeze([1.4, -5.9, 1.4, 0.1]),
  Object.freeze([-1.8, 2.5, 2.2, 0.12]),
  Object.freeze([-0.9, 4.1, 1.2, 0.07]),
  Object.freeze([-0.5, 0.3, 1.2, 0.06]),
]);

// Where nothing of the knoll, the relief or the hollows reaches, so the pinned
// ground keeps its exact heights and shading normals: within `lantern` of the
// lantern, and `drip` beyond the river's whole bank and each puddle's radius,
// easing in over `feather`. Each margin is its pin plus a fine-grid
// triangle's reach (0.75 x sqrt 2).
export const PIN_KEEP = Object.freeze({ lantern: 2.5, drip: 0.8, feather: 1 });

// Rain stands where the soil lies below its neighbours: the cavity, the fine
// root grid's local mean height (a box `mean` cells either side) less its own
// height, is the slatePool attribute the root shading pools water and mud in
// (SLATE_SOIL.pool). It is 0 on the pinned ground (pinKeep()) and fades in
// over `edge` cells inside the fine grid's own edge.
export const POOL_FIELD = Object.freeze({ mean: 2, edge: 2 });

// Root centrelines for contact shading, relative to the tree: x, z, half-width
// and contact strength (1 where the sunk root enters the soil, lower where it
// rises into an arch and under the aerial spur).
export const ROOT_LINES = [
  [
    [3.4, -3.2, 1, 0.25],
    [3.1, -5.5, 0.8, 0.45],
    [2.5, -7.6, 0.5, 0.85],
    [1.5, -9.1, 0.35, 1],
  ],
  [
    [5.4, -2.8, 1, 0.25],
    [6.6, -5, 0.6, 0.3],
    [7.9, -6, 0.4, 0.3],
  ],
  [
    [6, -1.6, 1.2, 0.3],
    [8.5, -1.7, 1, 0.6],
    [10.5, -1.4, 0.9, 0.95],
    [12.1, -1.1, 0.4, 1],
  ],
  [
    [1.5, -1, 0.8, 0.6],
    [-0.5, -1.3, 0.5, 0.7],
    [-2.5, -1.3, 0.35, 0.95],
    [-4, -1.4, 0.25, 1],
  ],
  [
    [5.8, 2.5, 0.8, 0.85],
    [6.8, 4.2, 0.6, 1],
    [7.4, 6.2, 0.5, 1],
    [7.4, 6.9, 0.4, 1],
  ],
  [
    [6.5, 2.5, 1, 0.85],
    [8, 3.3, 1, 1],
    [9, 4, 0.5, 1],
  ],
  [
    [2.2, 3.5, 0.6, 0.9],
    [1, 5.5, 0.6, 1],
    [-0.5, 6.8, 0.5, 0.95],
    [-2.2, 7.2, 0.9, 1],
    [-3.8, 7.5, 0.4, 1],
  ],
  [
    [2.4, -3, 1, 0.5],
    [1, -4, 0.5, 0.9],
    [-0.2, -4.6, 0.4, 1],
    [-1.1, -5.35, 0.4, 1],
  ],
];
// Contact shading reach beyond a root's half-width, the settled soil about the
// trunk (full within, none beyond), the lip height at which soil is fully
// settled, and how far settled soil reaches beside each root line.
const SHADE = { reach: 0.8, plate: [3.6, 7.5], soilLift: 0.3, band: 1.4 };

// The fine root grid's 0.75 lattice under the tree, in world x/z: its first
// vertex, pitch, and columns x rows of vertices (tree-relative x -8.6..15.4,
// z -12.1..11.15). ROOT_RESTS and ROOT_SHADE are baked on it by
// tools/bake-root-shade.mjs against both authored tree variants.
export const ROOT_LATTICE = Object.freeze({ x: 46.5, z: 24, pitch: 0.75, cols: 33, rows: 32 });
// The lattice value at a world x/z, linear over the fine grid's own triangles
// (diagonal b-d, as liftSampler()), 0 beyond it: the analytic surface and the
// rendered one agree.
function latticeAt(values, x, z) {
  const { pitch, cols, rows } = ROOT_LATTICE,
    u = (x - ROOT_LATTICE.x) / pitch,
    v = (z - ROOT_LATTICE.z) / pitch;
  const col = Math.floor(u),
    row = Math.floor(v);
  if (!(col >= 0 && row >= 0 && col < cols - 1 && row < rows - 1)) return 0;
  const fx = u - col,
    fz = v - row,
    at = (i, j) => values[(row + j) * cols + col + i];
  return fx + fz <= 1
    ? at(0, 0) + (at(1, 0) - at(0, 0)) * fx + (at(0, 1) - at(0, 0)) * fz
    : at(1, 1) + (at(0, 1) - at(1, 1)) * (1 - fx) + (at(1, 0) - at(1, 1)) * (1 - fz);
}

// The lantern (estateLantern(): 5 units from the tree toward the watch) and
// the SLATE_PUDDLES zones (mud-ground.js, placed as estatePoint() places
// them): world centre, radius, stretch along a world angle. Restated so this
// chunk imports only three; the terrain regression holds them equal.
const LANTERN_LENGTH = Math.hypot(TREE_FOOTING.x, TREE_FOOTING.z);
export const LANTERN_FOOT = Object.freeze({
  x: TREE_FOOTING.x * (1 - 5 / LANTERN_LENGTH),
  z: TREE_FOOTING.z * (1 - 5 / LANTERN_LENGTH),
});
const zoneAt = ({ x, z }, deg, dist, radius, stretch = 1, along = 0) =>
  Object.freeze({
    x: x + Math.cos((deg * Math.PI) / 180) * dist,
    z: z + Math.sin((deg * Math.PI) / 180) * dist,
    radius,
    stretch,
    c: Math.cos((along * Math.PI) / 180),
    s: Math.sin((along * Math.PI) / 180),
  });
export const PUDDLE_ZONES = Object.freeze([
  zoneAt(TREE_FOOTING, 185, 8, 1.6),
  zoneAt(TREE_FOOTING, 75, 9, 2.5),
  zoneAt(TREE_FOOTING, -100, 16, 1.5),
]);
// The streams (mud-ground.js SLATE_STREAMS, restated): the courses, the
// current, the white water, the channel, the water's body and the stones.
export const STREAMS = Object.freeze({
  courses: Object.freeze(
    [
      {
        path: [
          [5.6, 2.9],
          [4.9, 2.5],
          [3.7, 1.5],
          [2.9, 0.3],
          [2.4, -1.36],
          [1.5, -2.5],
          [2.31, -4.1],
          [3.2, -5.6],
          [2.3, -7.4],
          [0.7, -9],
          [-1.4, -9.9],
          [-3.6, -10.2],
          [-5.7, -10.9],
          [-6.9, -11.4],
        ],
        width: [0.9, 1.3],
        flare: [1.3, 3.6, 1.2],
        // Fixed treeward station, original course length, lower branch width.
        profile: [5.556, 9.415, 1.2],
      },
    ].map(({ path, width, flare, profile }) =>
      Object.freeze({
        path: Object.freeze(path.map((p) => Object.freeze(p))),
        width: Object.freeze(width),
        ...(flare && { flare: Object.freeze(flare) }),
        ...(profile && { profile: Object.freeze(profile) }),
      }),
    ),
  ),
  step: 0.45,
  meander: 0.28,
  wobble: 1.6,
  flow: -1.4,
  calm: Object.freeze({ from: 5.556, span: 2, foam: 0.25, ripple: 0.5 }),
  confluence: Object.freeze([0.3, 1]),
  current: Object.freeze({
    coarse: Object.freeze([1.1, 2.4]),
    fine: Object.freeze([3, 6.5]),
    tilt: Object.freeze([0.05, 0.024]),
  }),
  foam: Object.freeze({
    cell: Object.freeze([9, 30]),
    patch: Object.freeze([1.2, 2]),
    amount: 0.5,
    join: 0.65,
    mouth: 1,
    reach: Object.freeze([1, 1.9]),
    cover: 0.85,
    far: 0.5,
    plume: 0,
    albedo: 0.34,
    text: 0.9,
    lace: Object.freeze([6, 9]),
    warp: 0.35,
    edge: Object.freeze([0.1, 0.32]),
    clump: Object.freeze([0.3, 0.7]),
    broken: 0.8,
    drift: 0.5,
  }),
  bed: Object.freeze({
    depth: 0.2,
    full: 1.6,
    rise: 0.1,
    level: -0.04,
    drop: 0.1,
    sill: Object.freeze({
      depth: Object.freeze([0.3, 1]),
      along: 3,
      back: 1,
      across: 1.4,
      reach: 1.6,
    }),
    shore: 3,
    texel: 0.05,
    reach: Object.freeze([1.3, 1.7]),
    blend: 0.04,
    turn: 25,
    skew: 0.6,
    cut: 1.6,
  }),
  body: Object.freeze({
    deep: 0.5,
    calm: 0.55,
    silt: Object.freeze([0.11, 0.095, 0.08]),
    darken: 0.55,
  }),
  stones: Object.freeze({
    tone: 0.5,
    sink: 0.22,
    show: 0.5,
    radius: 0.6,
    ring: 0.07,
    wake: 1.6,
    spread: 0.45,
    list: Object.freeze(
      [
        [3.34, 0.26, 0.22, "weathered", 20],
        [2.2, -0.63, 0.28, "lichen", 110],
        [2.4, -2.06, 0.2, "weathered", 250],
        [1.2, -2.42, 0.28, "weathered", 75],
      ].map((stone) => Object.freeze(stone)),
    ),
  }),
});
// A smooth curve through world points (Catmull-Rom; mud-ground.js
// courseSamples()), each span cut into pieces about `step` units long, or the
// span's own step where its first point carries one ([x, z, half-width,
// step]): the samples ([x, z], and the half-width where the points carry one)
// and the sample each point's span starts at.
function courseSamples(p, step) {
  const at = (i) => p[Math.max(0, Math.min(p.length - 1, i))],
    points = [],
    starts = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)],
      pieces = Math.max(1, Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / (b[3] ?? step)));
    starts.push(points.length);
    for (let k = 0; k < pieces; k++) {
      const t = k / pieces,
        t2 = t * t,
        t3 = t2 * t,
        f = (q) =>
          0.5 *
          (2 * b[q] +
            (c[q] - a[q]) * t +
            (2 * a[q] - 5 * b[q] + 4 * c[q] - d[q]) * t2 +
            (3 * b[q] - a[q] - 3 * c[q] + d[q]) * t3);
      points.push(b.length > 2 ? [f(0), f(1), b[2] + (c[2] - b[2]) * t] : [f(0), f(1)]);
    }
  }
  starts.push(points.length);
  points.push(p.at(-1).slice(0, 3));
  return { points, starts };
}
// A smooth course through world points (Catmull-Rom; mud-ground.js
// smoothCourse()), sampled about every `step` units: [x, z, distance along].
function smoothCourse(p, step) {
  const { points } = courseSamples(p, step);
  let s = 0;
  return points.map(([x, z], i) => {
    if (i) s += Math.hypot(x - points[i - 1][0], z - points[i - 1][1]);
    return Object.freeze([+x.toFixed(3), +z.toFixed(3), +s.toFixed(3)]);
  });
}
// Each sample's bend (mud-ground.js courseBends()): the signed turn of the course across
// two samples either side, over `turn` degrees, within -1..1 (positive turning
// from +x toward +z).
function courseBends(points, turn) {
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];
  return points.map((_, k) => {
    const [ax, az] = at(k - 2),
      [bx, bz] = at(k),
      [cx, cz] = at(k + 2),
      ux = bx - ax,
      uz = bz - az,
      vx = cx - bx,
      vz = cz - bz;
    if (!(ux || uz) || !(vx || vz)) return 0;
    const angle = (Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz) * 180) / Math.PI;
    return +Math.max(-1, Math.min(1, angle / turn)).toFixed(4);
  });
}
// A course's width (mud-ground.js courseWidth()): profile pins the treeward
// width to the original course's stations, then narrows the longer branch.
// The last flare[1]..flare[2] units open smoothly into the river.
function courseWidth({ width: [w0, w1], flare, profile }, s, length) {
  const t = flare ? Math.min(1, Math.max(0, (s - length + flare[1]) / (flare[1] - flare[2]))) : 0;
  const base = profile
    ? w0 +
      ((w1 - w0) * Math.min(s, profile[0])) / profile[1] +
      (profile[2] - w0 - ((w1 - w0) * profile[0]) / profile[1]) *
        Math.max(0, (s - profile[0]) / (length - profile[0]))
    : w0 + ((w1 - w0) * s) / length;
  return base + (flare ? flare[0] * t * t * (3 - 2 * t) : 0);
}
// Preserve the treeward grade at fixed stations while the branch lengthens.
function courseLevel({ profile }, s, length, bed) {
  const t = profile
    ? Math.min(s, profile[0]) / profile[1] +
      (1 - profile[0] / profile[1]) * Math.max(0, (s - profile[0]) / (length - profile[0]))
    : s / length;
  return bed.level - bed.drop * (1 - t);
}
// The streams' courses, sampled (mud-ground.js streamLines()).
export const STREAM_LINES = Object.freeze(
  STREAMS.courses.map((course) => {
    const points = smoothCourse(
        course.path.map(([dx, dz]) => [LANTERN_FOOT.x + dx, LANTERN_FOOT.z + dz]),
        STREAMS.step,
      ),
      length = points.at(-1)[2];
    return Object.freeze({
      points: Object.freeze(points),
      width: course.width,
      length,
      bends: Object.freeze(courseBends(points, STREAMS.bed.turn)),
      widths: Object.freeze(points.map(([, , s]) => +courseWidth(course, s, length).toFixed(4))),
      levels: Object.freeze(points.map(([, , s]) => courseLevel(course, s, length, STREAMS.bed))),
    });
  }),
);
// Each course in runs of STREAM_RUN segments, boxed: the half-width at every
// sample, the run's widest, and its box [x0, x1, z0, z1].
const STREAM_RUN = 4;
const STREAM_RUNS = STREAM_LINES.flatMap(({ points, widths }) => {
  const half = widths.map((w) => w / 2),
    runs = [];
  for (let k = 0; k + 1 < points.length; k += STREAM_RUN) {
    const end = Math.min(points.length - 1, k + STREAM_RUN),
      xs = points.slice(k, end + 1).map(([x]) => x),
      zs = points.slice(k, end + 1).map(([, z]) => z);
    runs.push({
      points: points.slice(k, end + 1),
      half: half.slice(k, end + 1),
      reach: Math.max(...half.slice(k, end + 1)),
      box: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)],
    });
  }
  return runs;
});
export function streamDistance(x, z) {
  // Start from the nearest run's head (an upper bound), then measure only the runs whose box could be nearer.
  let best = Infinity;
  for (const { points, half } of STREAM_RUNS)
    best = Math.min(best, Math.hypot(x - points[0][0], z - points[0][1]) - half[0]);
  for (const { points, half, reach, box } of STREAM_RUNS) {
    if (
      Math.hypot(Math.max(box[0] - x, 0, x - box[1]), Math.max(box[2] - z, 0, z - box[3])) -
        reach >=
      best
    )
      continue;
    for (let k = 1; k < points.length; k++) {
      const [ax, az] = points[k - 1],
        bx = points[k][0] - ax,
        bz = points[k][1] - az,
        h = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
      best = Math.min(
        best,
        Math.hypot(x - ax - bx * h, z - az - bz * h) - (half[k - 1] + (half[k] - half[k - 1]) * h),
      );
    }
  }
  return best - STREAMS.meander;
}
// The ground shader's value noise (mud-ground.js slateHash()/slateNoise()).
const fract = (v) => v - Math.floor(v);
function slateHash(x, z) {
  let a = fract(x * 0.1031),
    b = fract(z * 0.1031),
    c = fract(x * 0.1031);
  const k = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += k;
  b += k;
  c += k;
  return fract((a + b) * c);
}
function slateNoise(x, z) {
  const i = Math.floor(x),
    j = Math.floor(z);
  let u = x - i,
    v = z - j;
  u *= u * (3 - 2 * u);
  v *= v * (3 - 2 * v);
  const a = slateHash(i, j),
    b = slateHash(i + 1, j),
    c = slateHash(i, j + 1),
    d = slateHash(i + 1, j + 1);
  return a + (b - a) * u + (c + (d - c) * u - a - (b - a) * u) * v;
}
// Each course's segments with their widths, and its box grown by its bank's
// reach (the ground shader's slateStreamAt()).
const STREAM_COURSES = STREAM_LINES.map(({ points, widths, length, bends }) => {
  const pad = (Math.max(...widths) / 2) * STREAMS.bed.reach[1] + 0.05,
    xs = points.map(([x]) => x),
    zs = points.map(([, z]) => z);
  return {
    length,
    box: [
      Math.min(...xs) - pad,
      Math.max(...xs) + pad,
      Math.min(...zs) - pad,
      Math.max(...zs) + pad,
    ],
    segments: points.slice(1).map(([bx, bz, s1], k) => {
      const [ax, az, s0] = points[k];
      return [
        ax,
        az,
        bx - ax,
        bz - az,
        widths[k],
        widths[k + 1] - widths[k],
        bends[k],
        bends[k + 1] - bends[k],
        s0,
        s1 - s0,
      ];
    }),
  };
});
const STREAMS_BOX = [0, 1, 2, 3].map((q) =>
  (q % 2 ? Math.max : Math.min)(...STREAM_COURSES.map(({ box }) => box[q])),
);
// The streams' normalised radius at a world x/z (1 on their banks, half a
// course's width out; about 2e9 beyond every course's box), as the ground
// shader measures it: through the meander, the nearest course in widths.
export function streamRadius(x, z) {
  const { meander, wobble } = STREAMS;
  if (
    x < STREAMS_BOX[0] - meander ||
    x > STREAMS_BOX[1] + meander ||
    z < STREAMS_BOX[2] - meander ||
    z > STREAMS_BOX[3] + meander
  )
    return 2e9;
  const px = x + (slateNoise(x * wobble, z * wobble) - 0.5) * meander * 2,
    pz = z + (slateNoise(x * wobble + 7.3, z * wobble + 7.3) - 0.5) * meander * 2;
  let best = 1e9;
  streamWidth = 1;
  streamSide = 0;
  for (const { length, box, segments } of STREAM_COURSES) {
    if (!(px > box[0] && px < box[1] && pz > box[2] && pz < box[3])) continue;
    for (const [ax, az, ex, ez, d0, dd, b0, db, s0, ds] of segments) {
      const qx = px - ax,
        qz = pz - az,
        h = Math.min(1, Math.max(0, (qx * ex + qz * ez) / (ex * ex + ez * ez))),
        d = d0 + h * dd,
        w = Math.hypot(qx - ex * h, qz - ez * h) / d;
      if (w < best) {
        best = w;
        streamWidth = d;
        streamAlongAt = s0 + h * ds;
        streamLength = length;
        // Which bank, through the bend: positive toward the outside of the turn.
        streamSide =
          Math.max(-1, Math.min(1, (2 * (qx * ez - qz * ex)) / Math.hypot(ex, ez) / d)) *
          (b0 + h * db);
      }
    }
  }
  return 2 * best;
}
// The width of the course streamRadius() last found nearest, and the point's
// side through its bend (positive toward the outside bank).
let streamWidth = 1,
  streamSide = 0,
  streamAlongAt = 0,
  streamLength = 1;
export const streamPlace = () => ({ width: streamWidth, side: streamSide });
// Its water's level below the lantern's foot at `s` units along a course
// `length` long (STREAMS.bed): the river's where it leaves the river, at its
// mouth, falling `drop` toward the roots, down which it runs.
export const streamLevel = (s, length) => {
  return courseLevel(STREAMS.courses[0], Math.min(length, Math.max(0, s)), length, STREAMS.bed);
};
// The channel's height above its water at normalised radius r (mud-ground.js slateStreamBed()).
// A course narrower than `full` is shallower in proportion; through a bend
// (side, positive toward the outside) it leans: deeper and steep under the cut
// bank, shallow up the point bar.
export function streamBedAt(r, width = Infinity, side = 0) {
  const { depth, full, rise, skew, cut } = STREAMS.bed,
    k = depth * Math.min(1, width / full) * (1 + skew * side),
    R = rise * (1 + (cut - 1) * Math.max(side, 0));
  return r < 1 ? -k * (1 - r * r) : R * (1 - Math.exp((-(r - 1) * 2 * k) / R));
}
// How far the streams' channel lowers the ground at x/z (0 or less), over the
// base height `base` there and the lantern's foot `foot`, as the river's
// (riverCarve()); clear of the lantern's footing.
export function streamCarve(x, z, base, foot) {
  const r = streamRadius(x, z),
    { reach, blend: k } = STREAMS.bed;
  if (r >= reach[1]) return 0;
  const shape =
      foot + streamLevel(streamAlongAt, streamLength) + streamBedAt(r, streamWidth, streamSide),
    h = Math.max(k - Math.abs(base - shape), 0) / k;
  return (
    (Math.min(base, shape) - (h * h * k) / 4 - base) *
    (1 - ease(...reach, r)) *
    ease(STREAM_FOOTING[0], STREAM_FOOTING[1], Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z)) *
    ease(...STREAM_ROOTS, rootClearance(x, z)) *
    ease(...STREAM_HEAD, streamAlongAt) *
    ease(0, RIVER_EDGE, riverInside(x, z))
  );
}
// The lantern's footing stays level: no channel within [0] of its foot, the
// whole of it beyond [1].
const STREAM_FOOTING = [1.3, 1.8];
// The river's and the stream's channels together: where the stream leaves it
// its bed runs smoothly down into the river's (a smooth minimum, `blend` units),
// and inside the river (normalised radii [0] to [1]) the river's shape rules.
const STREAM_MOUTH = [0.7, 1.15];
export function channelCarve(x, z, base, foot) {
  const river = riverCarve(x, z, base, foot),
    stream = streamCarve(x, z, base, foot) * ease(...STREAM_MOUTH, riverRadius(x, z));
  if (!(river < 0 && stream < 0)) return Math.min(river, stream);
  const k = STREAMS.bed.blend,
    h = Math.max(k - Math.abs(river - stream), 0) / k;
  return Math.min(river, stream) - (h * h * k) / 4;
}
// Nor under a root: none within [0] of a root line's edge, all of it beyond [1].
const STREAM_ROOTS = [0, 0.35];
// Its head sinks away under the root arch: no channel within [0] units
// along of it (about the tree's footing), the whole of it from [1].
const STREAM_HEAD = [1.6, 3];
// How far x/z lies outside the nearest root line's half-width (ROOT_LINES).
function rootClearance(x, z) {
  const dx = x - TREE_FOOTING.x,
    dz = z - TREE_FOOTING.z;
  let best = Infinity;
  for (const line of ROOT_LINES)
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az, ah] = line[i],
        [bx, bz, bh] = line[i + 1],
        ex = bx - ax,
        ez = bz - az,
        t = Math.min(1, Math.max(0, ((dx - ax) * ex + (dz - az) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(ax + ex * t - dx, az + ez * t - dz) - (ah + (bh - ah) * t));
    }
  return best;
}
// A zone's distance from its centre in its own stretched frame (units).
export const zoneDistance = ({ x: cx, z: cz, stretch, c, s }, x, z) =>
  Math.hypot((c * (x - cx) + s * (z - cz)) / stretch, -s * (x - cx) + c * (z - cz));

// The river's bed and banks (mud-ground.js SLATE_RIVER_BED, restated): its
// water lies `level` below the lantern's foot; its bed falls to `depth` below
// the water down its middle and its bank rises toward `rise` above it, until
// it meets the ground: the surface is the smooth minimum (`blend` units) of
// the ground and that shape, eased back to the ground from reach[0] to
// reach[1] radii, so the lantern's footing stays level.
export const RIVER_BED = Object.freeze({
  depth: 0.18,
  rise: 0.15,
  level: -0.04,
  reach: Object.freeze([1.25, 1.55]),
  blend: 0.05,
});
// The river (mud-ground.js SLATE_RIVER, riverLine() and riverAt(), restated):
// its sampled centreline and a point's place on it.
export const RIVER = Object.freeze({
  path: Object.freeze(
    [
      [33.1, 52.6, 3.9, 5],
      [17.1, 36.6, 3.3, 3],
      [1.1, 30.6, 2.9, 3],
      [-14.9, 32.6, 2.8, 3],
      [-29.9, 30.6, 2.7, 3],
      [-41.9, 23.6, 2.5, 2.5],
      [-43.9, 14.6, 2.3, 2],
      [-36.9, 9.1, 2.1, 1.5],
      [-21, 0.4, 2, 0.9],
      [-13, -0.9],
      [-8.6, -3.1],
      [-7.1, -5.2],
      [-6.4, -7.5],
      [-6.5, -9.7],
      [-7.3, -11.6],
      [-8.7, -13.5],
      [-9.9, -15.7],
      [-9.9, -19],
      [-8.4, -22.5, 2, 3],
      [-6.9, -26.9, 2.4, 2],
      [-3.4, -30.8, 2.7, 3],
      [4.1, -31.4, 3.2, 3],
      [12.1, -29.2, 3.6, 4],
      [23.1, -28.4, 4, 4],
      [35.1, -32.4, 4.4, 5],
      [45.1, -43.4, 4.8, 6],
      [48.1, -61.4, 5.2, 8],
      [43.1, -83.4, 5.6, 12],
      [25.1, -101.4, 6, 12],
      [-4.9, -111.4, 6.6, 12],
      [-38.9, -109.4, 7.2, 12],
      [-70.9, -103.4, 7.8, 12],
      [-100.9, -97.4, 8.4, 12],
      [-134.9, -89.4, 9.2, 8],
      [-147.9, -81.4, 14, 8],
      [-155.9, -67.4, 24, 7],
      [-159.9, -49.4, 30, 7],
      [-161.9, -29.4, 27, 7],
      [-165.9, -11.4, 18, 8],
      [-173.9, 6.6, 11, 10],
      [-186.9, 24.6, 10, 12],
      [-205.9, 44.6, 10, 12],
      [-226.9, 66.6, 10, 12],
      [-250.9, 90.6, 10, 12],
    ].map((p) => Object.freeze(p)),
  ),
  step: 0.9,
  width: 2,
  wobble: Object.freeze([0.08, 0.05]),
  flow: -0.25,
  datum: Object.freeze([9, 8.109509849439533]),
  valley: Object.freeze({ floor: 1.6, shoulder: 30 }),
});
// Sampled: [x, z, distance along, half-width, the wobble's phase less that
// distance] (mud-ground.js riverLine()).
export const RIVER_LINE = (() => {
  const { path, step, width, datum } = RIVER,
    { points, starts } = courseSamples(
      path.map(([dx, dz, w = width, own = step]) => [
        LANTERN_FOOT.x + dx,
        LANTERN_FOOT.z + dz,
        w,
        own,
      ]),
      step,
    ),
    along = [0],
    phase = [0];
  for (let i = 1; i < points.length; i++)
    along.push(
      along[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]),
    );
  const k0 = starts[datum[0]],
    slow = (i, j) => (along[j] - along[i]) * ((2 * width) / (points[i][2] + points[j][2]) - 1);
  phase[k0] = 0;
  for (let i = k0 + 1; i < points.length; i++) phase[i] = phase[i - 1] + slow(i - 1, i);
  for (let i = k0 - 1; i >= 0; i--) phase[i] = phase[i + 1] - slow(i, i + 1);
  return Object.freeze(
    points.map(([x, z, w], i) =>
      Object.freeze([
        +x.toFixed(3),
        +z.toFixed(3),
        +(along[i] - along[k0] + datum[1]).toFixed(3),
        +w.toFixed(4),
        +phase[i].toFixed(4),
      ]),
    ),
  );
})();
// Its segments in runs of at most RIVER_SPAN segments and RIVER_SPAN_LENGTH
// units (mud-ground.js courseRuns()), each boxed with its widest half-width,
// so riverAt() measures only the runs that could hold the nearest segment (the
// litter tries it thousands of times while the terrain settles, inside the
// reveal's early window). `from` is the first segment's end.
const RIVER_SPAN = 8,
  RIVER_SPAN_LENGTH = 40;
export const RIVER_RUNS = (() => {
  const runs = [],
    length = (k) =>
      Math.hypot(RIVER_LINE[k + 1][0] - RIVER_LINE[k][0], RIVER_LINE[k + 1][1] - RIVER_LINE[k][1]);
  for (let start = 0; start + 1 < RIVER_LINE.length;) {
    let end = start + 1,
      span = length(start);
    while (
      end + 1 < RIVER_LINE.length &&
      end - start < RIVER_SPAN &&
      span + length(end) <= RIVER_SPAN_LENGTH
    )
      span += length(end++);
    const points = RIVER_LINE.slice(start, end + 1),
      xs = points.map(([px]) => px),
      zs = points.map(([, pz]) => pz);
    runs.push(
      Object.freeze({
        from: start + 1,
        to: end + 1,
        box: Object.freeze([Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)]),
        widest: Math.max(...points.map(([, , , w]) => w)),
      }),
    );
    start = end;
  }
  return Object.freeze(runs);
})();
// The nearest segment (riverK, the point riverH along it, riverD away in
// half-widths, riverE in units), the first of equals along the river: the run
// nearest the point first, then any other whose box is no farther than the
// best so far. While the river is `width` wide, riverD is riverE. It allocates
// nothing.
const riverNear = new Float64Array(RIVER_RUNS.length);
let riverK = 0,
  riverH = 0,
  riverD = Infinity,
  riverE = Infinity;
function riverMeasure(x, z, { from, to }) {
  for (let k = from; k < to; k++) {
    const a = RIVER_LINE[k - 1],
      b = RIVER_LINE[k],
      ex = b[0] - a[0],
      ez = b[1] - a[1],
      len = Math.hypot(ex, ez),
      h = Math.min(1, Math.max(0, ((x - a[0]) * ex + (z - a[1]) * ez) / (len * len))),
      e = Math.hypot(x - a[0] - ex * h, z - a[1] - ez * h),
      d = e * (RIVER.width / (a[3] + h * (b[3] - a[3])));
    if (d < riverD || (d === riverD && k < riverK)) {
      riverD = d;
      riverE = e;
      riverK = k;
      riverH = h;
    }
  }
}
function riverNearest(x, z) {
  let first = 0;
  for (let j = 0; j < RIVER_RUNS.length; j++) {
    const { box, widest } = RIVER_RUNS[j];
    riverNear[j] =
      Math.hypot(Math.max(box[0] - x, 0, x - box[1]), Math.max(box[2] - z, 0, z - box[3])) *
      (RIVER.width / widest);
    if (riverNear[j] < riverNear[first]) first = j;
  }
  riverK = 0;
  riverH = 0;
  riverD = Infinity;
  riverE = Infinity;
  riverMeasure(x, z, RIVER_RUNS[first]);
  for (let j = 0; j < RIVER_RUNS.length; j++)
    if (j !== first && riverNear[j] <= riverD + 1e-9) riverMeasure(x, z, RIVER_RUNS[j]);
}
// The river's wobbled half-width, in units of `width`, at the wobble's phase
// t (the distance downstream, while it is `width` wide).
const riverSpan = (t) =>
  RIVER.width *
  (1 + RIVER.wobble[0] * Math.sin(0.9 * t + 1.3) + RIVER.wobble[1] * Math.sin(2.3 * t + 0.4));
// The nearest segment's distance downstream, half-width and wobble phase.
const riverDown = () => {
  const a = RIVER_LINE[riverK - 1],
    b = RIVER_LINE[riverK];
  return a[2] + riverH * Math.hypot(b[0] - a[0], b[1] - a[1]);
};
const riverWidth = () =>
  RIVER_LINE[riverK - 1][3] + riverH * (RIVER_LINE[riverK][3] - RIVER_LINE[riverK - 1][3]);
const riverPhase = () =>
  RIVER_LINE[riverK - 1][4] + riverH * (RIVER_LINE[riverK][4] - RIVER_LINE[riverK - 1][4]);
export function riverAt(x, z) {
  riverNearest(x, z);
  const a = RIVER_LINE[riverK - 1],
    b = RIVER_LINE[riverK],
    ex = b[0] - a[0],
    ez = b[1] - a[1],
    len = Math.hypot(ex, ez),
    s = a[2] + riverH * len;
  return {
    d: riverE,
    s,
    side: Math.sign(ex * (z - a[1]) - ez * (x - a[0])) || 1,
    dx: ex / len,
    dz: ez / len,
    w: riverWidth(),
    r: riverD / riverSpan(s + riverPhase()),
  };
}
// The normalised radius across the river at a world x/z, 1 on its wobbled
// shore (as the ground shader's slateRiver()).
export function riverRadius(x, z) {
  riverNearest(x, z);
  return riverD / riverSpan(riverDown() + riverPhase());
}
// Whether x/z lies inside normalised radius `within` (riverRadius(x, z) <
// within). Where every run's box is farther than the river could reach there
// (its widest wobble), it is not, without measuring a segment: the litter asks
// this for thousands of candidates, most of them far out on the plain.
const RIVER_WOBBLE = 1 + Math.abs(RIVER.wobble[0]) + Math.abs(RIVER.wobble[1]);
export function riverWithin(x, z, within) {
  for (let j = 0; j < RIVER_RUNS.length; j++) {
    const { box, widest } = RIVER_RUNS[j],
      reach = within * (widest * RIVER_WOBBLE) + 1e-6;
    if (x > box[0] - reach && x < box[1] + reach && z > box[2] - reach && z < box[3] + reach)
      return riverRadius(x, z) < within;
  }
  return false;
}
// Whether x/z lies within margin units of the water: the river's wobbled
// shore or a puddle zone's radius (the litter's keepouts).
export const nearWater = (x, z, margin) =>
  riverWithin(x, z, 1 + margin / RIVER.width) ||
  PUDDLE_ZONES.some((zone) => zoneDistance(zone, x, z) < zone.radius + margin);
// The centreline at distance s downstream: [x, z, flow x, flow z].
export function riverPoint(s) {
  let k = 1;
  while (k < RIVER_LINE.length - 1 && RIVER_LINE[k][2] < s) k++;
  const [ax, az, s0] = RIVER_LINE[k - 1],
    [bx, bz, s1] = RIVER_LINE[k],
    t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0))),
    len = Math.hypot(bx - ax, bz - az);
  return [ax + (bx - ax) * t, az + (bz - az) * t, (bx - ax) / len, (bz - az) / len];
}
// How far downstream the river passes the lantern.
export const RIVER_NEAR = riverAt(LANTERN_FOOT.x, LANTERN_FOOT.z).s;
// The rapids' frame at the falls (ocean.js rapidsFrame()) and the river's own
// distance along its course at the lip (`s`): past a few units up from the lip
// its own course takes over from the frame's straight line.
const RAPIDS_DROP = riverFalls(RIVER_LINE);
export const RAPIDS_AT = RAPIDS_DROP
  ? Object.freeze({
      ...rapidsFrame(RAPIDS_DROP),
      s: riverAt(RAPIDS_DROP.lip[0], RAPIDS_DROP.lip[1]).s,
    })
  : null;
// Its height above the water at normalised radius r (mud-ground.js riverBed()).
export function riverBedAt(r) {
  const { depth, rise } = RIVER_BED;
  return r < 1 ? -depth * (1 - r * r) : rise * (1 - Math.exp((-(r - 1) * 2 * depth) / rise));
}
// The original shallow profile remains the pinned ground's baseline. The
// main course has a metre of water, shoaling as the same discharge accelerates
// toward the falls. Both the cap and the falls use this upper datum. Its water
// takes up light by depth, red first, as water does (`absorb`, per unit of
// depth, red, green, blue): the bed shows through the shallows cooled, and the
// deep water keeps the colour it scatters back.
export const RIVER_CHANNEL = Object.freeze({
  absorb: Object.freeze([1.1, 0.75, 0.65]),
  depth: 3.28,
  speed: 3.2,
  freeboard: 0.65,
  pitch: 1.5,
  across: 14,
  bedTriangles: 78000,
  waterTriangles: 8000,
});
export function riverChannel(landHeight) {
  const foot = landHeight(LANTERN_FOOT.x, LANTERN_FOOT.z);
  const water = (x, z) => {
    const away = ease(...PUDDLE_MIRROR.plane, Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z));
    return (
      foot +
      RIVER_BED.level +
      (landHeight(x, z) - foot) * away -
      RIVER_CHANNEL.freeboard * away * keep(x, z) +
      riverShelfLift(x, z)
    );
  };
  const keep = (x, z) => {
    let value = ease(
      PIN_KEEP.lantern,
      PIN_KEEP.lantern + PIN_KEEP.feather,
      Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z),
    );
    if (Math.hypot(x - TREE_FOOTING.x, z - TREE_FOOTING.z) < SUPPORT_REACH) {
      value *= ease(...STREAM_ROOTS, rootClearance(x, z));
      for (const zone of PUDDLE_ZONES)
        value *= ease(
          zone.radius + PIN_KEEP.drip,
          zone.radius + PIN_KEEP.drip + PIN_KEEP.feather,
          zoneDistance(zone, x, z),
        );
    }
    return value;
  };
  const depth = (x, z) =>
    (RIVER_CHANNEL.depth * RIVER_CHANNEL.speed) /
    rapidsSpeed(RAPIDS_AT ? riverAt(x, z).s - RAPIDS_AT.s : RAPIDS.reach);
  const carve = (x, z, base) => {
    if (!riverWithin(x, z, RIVER_BED.reach[1]) || coastDistance(x, z) < 0) return 0;
    const r = riverRadius(x, z),
      bowl = Math.max(0, 1 - r * r),
      shape = Math.max(
        water(x, z) + riverBedAt(r) - (depth(x, z) - RIVER_BED.depth) * bowl * bowl,
        water(x, z) - sillDepth(x, z),
      ),
      k = RIVER_BED.blend,
      h = Math.max(k - Math.abs(base - shape), 0) / k;
    return (Math.min(base, shape) - (h * h * k) / 4 - base) * (1 - ease(...RIVER_BED.reach, r));
  };
  const delta = (x, z, base) => (carve(x, z, base) - riverCarve(x, z, base, foot)) * keep(x, z);
  const bed = Object.assign(
    (x, z) => {
      const base = landHeight(x, z);
      return base + riverCarve(x, z, base, foot) + delta(x, z, base);
    },
    { water },
  );
  // Its depth at the course: the stream's sill shallows it where the stream leaves.
  return {
    water,
    depth: (x, z) => Math.min(depth(x, z), sillDepth(x, z)),
    keep,
    delta,
    bed,
  };
}
// Where the stream's course crosses into the river (its radius 1, from the mouth
// back) and its direction there, into the river; found once.
let STREAM_INLET = null;
function streamInlet() {
  if (STREAM_INLET) return STREAM_INLET;
  const points = STREAM_LINES[0].points;
  let k = points.length - 1;
  while (k > 1 && riverRadius(points[k][0], points[k][1]) < 1) k--;
  const [ax, az] = points[k - 1],
    [bx, bz] = points[k + 1] ?? points[k],
    d = Math.hypot(bx - ax, bz - az);
  return (STREAM_INLET = Object.freeze([points[k][0], points[k][1], (bx - ax) / d, (bz - az) / d]));
}
// The deepest the river lies at x/z by the stream's sill (STREAMS.bed.sill): a
// tongue of shallower bed reaching `along` units into the river along the
// stream's course from its inlet, `back` behind it and `across` either side, depth[0] deep at
// the inlet and depth[1] at its edge, the river's whole depth back by `reach`
// of its size; no limit elsewhere.
function sillDepth(x, z) {
  const { depth, along, back, across, reach } = STREAMS.bed.sill,
    [ix, iz, dx, dz] = streamInlet(),
    ox = x - ix,
    oz = z - iz,
    downstream = ox * dx + oz * dz,
    e = Math.hypot(downstream / (downstream < 0 ? back : along), (ox * dz - oz * dx) / across);
  return (
    depth[0] + (depth[1] - depth[0]) * Math.min(e, 1) + RIVER_CHANNEL.depth * 4 * ease(1, reach, e)
  );
}
// The fine grid's 0.75 cells under the river are cut RIVER_STEPS x RIVER_STEPS
// (0.25 units), so its bed and banks are smooth curves.
export const RIVER_STEPS = 3;
// The world box [x0, x1, z0, z1] the river's carved stretch reaches (its
// wobble at its most). The river is carved only inside the fine grid's window, easing out over
// RIVER_EDGE units inside its edge; beyond, its water lies on the plain.
const RIVER_EDGE = 2.5;
const riverInside = (x, z) =>
  Math.min(
    x - TREE_FOOTING.x - FINE_WINDOW.x[0],
    TREE_FOOTING.x + FINE_WINDOW.x[1] - x,
    z - TREE_FOOTING.z - FINE_WINDOW.z[0],
    TREE_FOOTING.z + FINE_WINDOW.z[1] - z,
  );
export function riverBounds() {
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (const [x, z, , w] of RIVER_LINE) {
    const pad = w * RIVER_BED.reach[1] * (1 + RIVER.wobble[0] + RIVER.wobble[1]);
    if (riverInside(x, z) < -pad) continue;
    x0 = Math.min(x0, x - pad);
    x1 = Math.max(x1, x + pad);
    z0 = Math.min(z0, z - pad);
    z1 = Math.max(z1, z + pad);
  }
  // The streams' channels too.
  const reach = STREAMS.meander + 0.25;
  x0 = Math.min(x0, STREAMS_BOX[0] - reach);
  x1 = Math.max(x1, STREAMS_BOX[1] + reach);
  z0 = Math.min(z0, STREAMS_BOX[2] - reach);
  z1 = Math.max(z1, STREAMS_BOX[3] + reach);
  // Half a coarse cell inside the window, so the sub-grid lies on the fine grid.
  return [
    Math.max(x0, TREE_FOOTING.x + FINE_WINDOW.x[0] + 1.5),
    Math.min(x1, TREE_FOOTING.x + FINE_WINDOW.x[1] - 1.5),
    Math.max(z0, TREE_FOOTING.z + FINE_WINDOW.z[0] + 1.5),
    Math.min(z1, TREE_FOOTING.z + FINE_WINDOW.z[1] - 1.5),
  ];
}
// How far the foothills open along the river (RIVER.valley): fully within
// `floor` half-widths of its centreline, closing over `shoulder` units beyond;
// 0 without a valley. The foothills are nil inside the fine grid's window, so
// it never reaches the carved river or the supports.
export function valleyGap(x, z) {
  const { valley } = RIVER;
  if (!valley) return 0;
  const { floor, shoulder } = valley;
  if (
    !RIVER_RUNS.some(({ box, widest }) => {
      const reach = floor * widest + shoulder;
      return x > box[0] - reach && x < box[1] + reach && z > box[2] - reach && z < box[3] + reach;
    })
  )
    return 0;
  riverNearest(x, z);
  const open = floor * riverWidth();
  return 1 - ease(open, open + shoulder, riverE);
}
// How far the river lowers the ground at x/z (0 or less), over the base
// height `base` there and the lantern's foot `foot`.
export function riverCarve(x, z, base, foot) {
  const r = riverRadius(x, z);
  if (r >= RIVER_BED.reach[1]) return 0;
  const shape = foot + RIVER_BED.level + riverBedAt(r),
    k = RIVER_BED.blend,
    h = Math.max(k - Math.abs(base - shape), 0) / k;
  return (
    (Math.min(base, shape) - (h * h * k) / 4 - base) *
    (1 - ease(...RIVER_BED.reach, r)) *
    ease(0, RIVER_EDGE, riverInside(x, z))
  );
}

// The moon key light's direction (toward it), as rendering.js places it
// (index.js directionalPosition 32, 28, 14 over its target): the direction
// ROOT_SHADE's key occlusion is baked along.
export const KEY_LIGHT = Object.freeze([32, 28, 14].map((v, _, all) => v / Math.hypot(...all)));

// Entry lips where the sunk roots leave the soil, measured on both authored
// tree variants (tools/bake-root-shade.mjs): where a root's underside lies
// within 0.12 above the knoll, the soil rises to 0.035 above it in a small,
// round-topped lip that tapers toward each arch, never lifting soil into the
// space under an arch, burying no root vertex by more than 0.2 and keeping the
// supported ground under a slope of 1.15. Lattice column, row and lift; the
// rest of the lattice stays open ground. No lattice triangle that reaches the
// lantern clearing, the front puddle or a drip-line puddle takes any.
// prettier-ignore
export const ROOT_RESTS = Object.freeze([
  [12,11,0.08], [27,15,0.134], [26,16,0.099], [22,20,0.09], [20,22,0.016], [21,25,0.05],
]);
const BANKS = new Float32Array(ROOT_LATTICE.cols * ROOT_LATTICE.rows);
for (const [col, row, lift] of ROOT_RESTS) BANKS[row * ROOT_LATTICE.cols + col] = lift;
// The bank's lift at a world x/z (0 beyond the lattice).
export const rootBankLift = (x, z) => latticeAt(BANKS, x, z);

// Baked on the same lattice (tools/bake-root-shade.mjs), 6 bits a vertex in
// SHADE_ALPHABET, row by row, 0 neutral: sky occlusion from the tree over the
// banked soil (96 cosine-weighted rays), moon-key occlusion (a 0.02 rad cone
// about KEY_LIGHT, the trunk and roots only) and the lantern's (`lamp`: 16
// rays to points across its flame, LANTERN_IMAGE.glow over its foot, through
// the trunk and roots: their shadows in its light), each averaged over the two
// variants and smoothed so no lattice edge reads: neighbours differ by at
// most 0.33 a unit, and toward the pinned clearing and puddles the occlusion
// ramps down by at most 0.3 a unit, never a straight cliff; and the contact cut, where a
// ROOT_LINES centreline strays over open soil (more than 0.7 from a real root
// footprint) or two roots' vectors meet head-on, so no false crease is drawn.
// The shader reads sky, key and lamp as the slateShade attribute; rootShade()
// takes the cut. None reaches the lantern clearing or the puddles.
export const SHADE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
// prettier-ignore
export const ROOT_SHADE = Object.freeze({
  sky: [
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
    "000000000000001233210000000000000",
    "0000000000001368aa741000000000000",
    "00000000000027elnlf83100000000000",
    "0000000000113amxBwmb6321000000000",
    "0000000001225bnBIDrf9643100000000",
    "0000001112347bkyHFvkeb85310000000",
    "000001123469belwFFyqlie9521000000",
    "0000100018cgikqzGGAvspjc731000000",
    "0001000000bosuxDIIDAywpg952100000",
    "00100000007lzEFJMKGEECvme84100000",
    "00000000006kzMNOPNKJJIExpia510000",
    "00000000007lzNTTTQNMNPOKEwod41000",
    "0000000000boCPVWVTRQQRTTRKzl82000",
    "0000000009jvHQUVVUTRPPPRRODo92000",
    "000000019jtAFLPSTUTRNJGFFBth71000",
    "000068adhmqvAGKOQSSQMFyspmg831000",
    "000468acfjnsyDHLNQRROIyogb7410000",
    "0134579beimsxCFIJMPRQMDqf84210000",
    "0134578bdhmsyDFFFHMQPMEsf73100000",
    "0124568adhmtAAxxxzEKNIApd63100000",
    "00234579chovsmjjjmrzIEvka52100000",
    "00123468cjrpg95558foyCui831000000",
    "00012358empf5000004epAuh621000000",
    "00011248fnf500000006jsod410000000",
    "00000136ci8000000001dfd7200000000",
    "000000136930000000005642100000000",
    "000000012320000000012210000000000",
    "000000000110000000011000000000000",
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
  ].join(""),
  key: [
    "000000000000000000000000000000000",
    "000000000000000111000000000000000",
    "000000000000024896310000000000000",
    "00000000000015bhic510000000000000",
    "0000000000003aktrh710000000000000",
    "0000000000015fsBxk821100000000000",
    "000000000125bnAHBnb65310000000000",
    "00000001237eozKMEpfdb720000000000",
    "000001248dktDNTRGsmnkb30000000000",
    "0000000018juHUYTIywxrf51000000000",
    "0000000000boCPZUMGHIAma3100000000",
    "00000000007lzNZVRPRRIwlc642100000",
    "00000000006kzN-YVVXXSHyqjd7410000",
    "00000000007lzN_-YXWWVSMFzria41000",
    "0000000000boCP_-YUPNOQQNKDsg62000",
    "0000000009jvHU_-XPHBBDEFFCuh72000",
    "000000019jtDO-_ZVNCuqpppqqlc51000",
    "000027cfktDNXYYYUNEwqlgcbba620000",
    "000013bqxENXWTSUUQKDwqia533110000",
    "0000015ixNXYTNJLQSQJCvmd510000000",
    "0000003csHVYSKBAFNRNDume620000000",
    "00000019pEULFAwoszEKEsia510000000",
    "00000018oDJAsmjfgmrzEsf7310000000",
    "00000029oEzpg95558foytg6200000000",
    "0000003apzpf5000004eppf6100000000",
    "0000014cnrf500000006hhb5100000000",
    "0000014ahk80000000017862000000000",
    "000001258930000000002221000000000",
    "000000122220000000000000000000000",
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
  ].join(""),
  lamp: [
    "000000000000000000000000000000000",
    "00000000000000138elsvwwwwwwwwwww0",
    "000000000000017ivHTZ___________w0",
    "00000000000004gvLVZ____________w0",
    "00000000000006mBR-_____________w0",
    "00000000000007mCR-_____________w0",
    "0000000000013aqFV______________w0",
    "000000000028hqAPY______________w0",
    "00000000017lxGPW-______________w0",
    "0000000002guHUZ-_______________w0",
    "0000000000boCP__-ZXZ--_________w0",
    "00000000007lzNTTPJILRVZ________w0",
    "00000000003fqyDEAusvBJU-_______w0",
    "000000000047ciookecgnAPZ_______w0",
    "0000000000bmkfcdgfcdlBQZ_______w0",
    "0000000009jvAvrsvvssAMW-_______w0",
    "000000019jtDOKHILKHIQW-________w0",
    "00000013csDNXYWXZZXXZ-_________w0",
    "000000006kwHRZ_________________w0",
    "000000001alvEPYZZ______________w0",
    "00000000029itCLLLNRX___________w0",
    "000000000017gtxxxzEKS__________w0",
    "0000000000017mjjjmrzIS_________w0",
    "000000000122595558foyJV________w0",
    "0000000149ff5000004epCP________w0",
    "00000015dof500000006jxKY-______w0",
    "0000002brl8000000001ftHUY-_____w0",
    "0000005kvh3000000000ftHMSX-____w0",
    "0000007nvh2000000001ftHILSX-___w0",
    "0000007mvh3000000004hvJLIMSY-__w0",
    "0000002aga3000000005bioqnmosuvww0",
    "000000000000000000000000000000000",
  ].join(""),
  cut: [
    "000000000000000000000000000000000",
    "000uwwwwwwwwwwwwwwwwwwwwwwwwwwww0",
    "000____________________________w0",
    "000____________________________w0",
    "000__________q00q______________w0",
    "001__________O000m_____________w0",
    "00o___________Q000_____________w0",
    "00_____________L00_____________w0",
    "00______________00_____________w0",
    "0e__M0001Z08____0______________w0",
    "0s_I00000000a___a______________w0",
    "0000000000W_0d_________________w0",
    "0000000000X____________________w0",
    "0000000000Z___________60000____w0",
    "000000000040____U______t0000B__w0",
    "0000000000000008______X88000v__w0",
    "00000003ST__qhU________0000v___w0",
    "00000J_________________________w0",
    "0000H_______________U__________w0",
    "000L______________60_00________w0",
    "0v________________2___00O______w0",
    "0w___________80E___00__00______w0",
    "0w__________Y00eN-_00___I______w0",
    "0w_________d0000002_0__________w0",
    "0w_______Z0000000000q0_________w0",
    "0w_____O000000000000y00m_______w0",
    "0w_____00000000000003M_________w0",
    "0w_____ZZh00000000000__________w0",
    "0w_______a00000000001__________w0",
    "0w_______b0000000000f__________w0",
    "0wwwwwwwwh0000000000uwwwwwwwwwww0",
    "000000000000000000000000000000000",
  ].join(""),
});
const shadeTable = (text) =>
  Float32Array.from(
    { length: ROOT_LATTICE.cols * ROOT_LATTICE.rows },
    (_, i) => Math.max(0, SHADE_ALPHABET.indexOf(text[i] ?? "0")) / 63,
  );
const SKY = shadeTable(ROOT_SHADE.sky),
  KEY = shadeTable(ROOT_SHADE.key),
  LAMP = shadeTable(ROOT_SHADE.lamp),
  CUT = shadeTable(ROOT_SHADE.cut);
// [sky, key, lamp] occlusion at a world x/z, as the slateShade attribute holds it.
export const rootOcclusion = (x, z) => [
  latticeAt(SKY, x, z),
  latticeAt(KEY, x, z),
  latticeAt(LAMP, x, z),
];

// Where a root lies within [-0.2, 1.3] of the soil, on a 0.25 grid from the
// lattice's first vertex (base64 bits, row by row): the tufts there collapse
// and no litter lands.
// prettier-ignore
export const ROOT_COVER = Object.freeze({ cols: 97, rows: 94, bits: [
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAMABAAAAAAAAAAAA4IMBAAAAAAAAAAAAwJ8DAAAAAAAA",
    "AAAAAP8HAAAAAAAAAAAAAPwHAAAAAAAAAAAAAPgPAAAAAAAAAAAAAMAfAAAAAAAAAAAAAAB/AAAA",
    "AAAAAAAAAAD8AAAAAAAAAAAAAAD4AQAAAAAAAAAAAADwBwAAAAAAAAAAAADgDwAAAAAAAAAAAADA",
    "HwAAAAAAAAAAAACAPwAAAAAAAAAAAAAAfwAAAAAAAAAAAAAA/wAAAAAAAAAAAAYA/gECAAAAAAAA",
    "ABwA/AMMAAAAAAAAAHgA/AMYAAAAAAAAAOAB+AdwAAAAAAAAAMAH8B/gAQAAAAAAAAAf4B8AAwAA",
    "AAAAAAB84B8ADAAAAAAAAADwwT8AGAAAAAAAAADghz8AMAAAAAAAAACAH38AYAAAAAAAAAAAP/8A",
    "wAAAAAAAAAAAfP4BgA8AAAAAAAAA+P8DAP8PAAAAAAAA8P8HAP5/AAAAAAAAwP8fAPj/AQAAAAAA",
    "8P8/APD/DwAAAOAH/v9/AMD/PwAAAID/////AYD//wAAAADwH/z/B8D/fwAAAACAAfj/H4D/fwAA",
    "AAAAAID/PwD/fwAAAAAAAAD/fwCAfwAAAAAAAADs/wAAAAAAAAAAAACA/wEAAAAAAAAAAAAA/oMA",
    "AAAAAAAAAAAA/g8DAAAAAAAAAAAA/B8OAAAAAAAAAAAA8H8wAAAAAAAAAAAAAP/BAAAAAAAAAAAA",
    "APgHAwAAAAAAAAAAAPAfBgAAAAAAAAAAAMB/GAAAAAAAAAAAAID/YQAAAAAAAAAAAAD+hwMAAAAA",
    "AAAAAAD4Dw4AAAAAAAAAAAPwPzwAAAAAAAAAgA/A/3AAAAAAAAAAgB8A/+EAAAAAAAAAgDMA/AMA",
    "AAAAAAAAgCcA8AcAAAAAAAAAgE8A4B8AAAAAAAAAgH8AgD8AAAAAAAAAgH8AAP4AAAAAAAAAgH8A",
    "APgBAAAAAAAAAP8AAPADAAAAAAAAAP8AAMAPAAAAAAAAgP8AAAAfAAAAAAAAgP8BAAB+AAAAAAAA",
    "4P8BAAB4AAAAAAAA8P8DAAAwAAAAAAAA+P8HAAAAAAAAAAAA+OcHAAAAAAAAAAAAIIAHAAAAAAAA",
    "AAAAAAAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
].join("") });
const COVER = Uint8Array.from(globalThis.atob?.(ROOT_COVER.bits) ?? "", (ch) => ch.charCodeAt(0));
export function rootCovered(x, z) {
  const col = Math.round((x - ROOT_LATTICE.x) / 0.25),
    row = Math.round((z - ROOT_LATTICE.z) / 0.25);
  if (!(col >= 0 && row >= 0 && col < ROOT_COVER.cols && row < ROOT_COVER.rows)) return false;
  const bit = row * ROOT_COVER.cols + col;
  return Boolean(COVER[bit >> 3] & (1 << (bit & 7)));
}

const RAD = Math.PI / 180;
const KNOLL_LOBES = ROOT_KNOLL.lobes.map(([heading, reach, half, side, end]) => [
  Math.cos(heading * RAD),
  Math.sin(heading * RAD),
  reach,
  half,
  side,
  end,
]);
// How fully the knoll holds at a point relative to the trunk (tx, tz; world
// x, z for its wobble): 1 within its core and lobes, 0 beyond their rims.
export function knollWeight(tx, tz, x, z) {
  const [full, rim] = ROOT_KNOLL.core,
    [amplitude, cell] = ROOT_KNOLL.wobble;
  const wobble = amplitude * latticeNoise(x / cell, z / cell, ROOT_RELIEF.seed - 1);
  let open = ease(full, full + rim + wobble, Math.hypot(tx, tz));
  for (const [c, s, reach, half, side, end] of KNOLL_LOBES) {
    if (!open) break;
    const along = tx * c + tz * s,
      beyond = Math.max(0, along - reach) * (side / end);
    open *= ease(
      half,
      half + side + wobble,
      Math.hypot(beyond, along < 0 ? Infinity : tz * c - tx * s),
    );
  }
  return 1 - open;
}
// 1 under the spur, 0 clear of it.
function underSpur(dx, dz) {
  const [ax, az, bx, bz, half, feather] = SPUR,
    ex = bx - ax,
    ez = bz - az;
  const t = Math.min(1, Math.max(0, ((dx - ax) * ex + (dz - az) * ez) / (ex * ex + ez * ez)));
  return 1 - ease(half, half + feather, Math.hypot(ax + ex * t - dx, az + ez * t - dz));
}
// 1 beyond the pinned ground's keep (PIN_KEEP), easing in over feather; 0 on it.
export function pinKeep(x, z, feather = PIN_KEEP.feather) {
  const { lantern, drip } = PIN_KEEP;
  let keep = ease(lantern, lantern + feather, Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z));
  // The river keeps its whole bank clear, and the drip-line margin past it.
  const bank = RIVER.width * RIVER_BED.reach[1] + drip;
  keep *= ease(bank, bank + feather, riverRadius(x, z) * RIVER.width);
  for (let i = 0; keep > 0 && i < PUDDLE_ZONES.length; i++) {
    const zone = PUDDLE_ZONES[i],
      margin = zone.radius + drip;
    keep *= ease(margin, margin + feather, zoneDistance(zone, x, z));
  }
  // The stream keeps its carved channel clear too, but under the roots, where
  // it sinks away beneath them and they rest on the soil as baked.
  if (keep > 0) {
    const d = streamPinDistance(x, z);
    if (d < feather)
      keep *= 1 - (1 - ease(0, feather, d)) * ease(...STREAM_ROOTS, rootClearance(x, z));
  }
  return keep;
}
// How far x/z lies outside the stream's carved reach (its banks out to
// STREAMS.bed.reach[1]), in units; about 1e9 far from it.
export function streamPinDistance(x, z) {
  const r = streamRadius(x, z);
  return r < 1e8 ? ((r - STREAMS.bed.reach[1]) * streamWidth) / 2 : 1e9;
}
// Seeded value noise in [-1, 1] on a unit lattice, C1 (smoothstep weights), the
// same on every engine (an integer hash, as dripHash()).
function latticeNoise(x, z, salt) {
  const i = Math.floor(x),
    j = Math.floor(z),
    u = x - i,
    v = z - j;
  const hash = (a, b) => {
    let h = Math.imul(a, 0x27d4eb2d) ^ Math.imul(b, 0x165667b1) ^ Math.imul(salt, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
  };
  const a = hash(i, j),
    b = hash(i + 1, j),
    c = hash(i, j + 1),
    d = hash(i + 1, j + 1);
  const su = u * u * (3 - 2 * u),
    sv = v * v * (3 - 2 * v);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}
const RELIEF_TURNS = ROOT_RELIEF.octaves.map(([, , turn]) => [
  Math.cos(turn * RAD),
  Math.sin(turn * RAD),
]);
// The relief's noise at a world x/z, before any of its holds.
export function reliefNoise(x, z) {
  let sum = 0;
  ROOT_RELIEF.octaves.forEach(([wavelength, amplitude], k) => {
    const [c, s] = RELIEF_TURNS[k];
    sum +=
      amplitude *
      latticeNoise(
        (c * x + s * z) / wavelength,
        (c * z - s * x) / wavelength,
        ROOT_RELIEF.seed + k,
      );
  });
  return sum;
}
// How much relief a point relative to the tree takes beside the resting roots:
// 0 on a root line of full contact, rising to 1 by ROOT_RELIEF.roots beyond its
// half-width.
function restingKeep(dx, dz) {
  const [near, far] = ROOT_RELIEF.roots,
    floor = ROOT_RELIEF.contact;
  let keep = 1;
  for (const line of ROOT_LINES)
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az, ah, as] = line[i],
        [bx, bz, bh, bs] = line[i + 1],
        ex = bx - ax,
        ez = bz - az;
      const t = Math.min(1, Math.max(0, ((dx - ax) * ex + (dz - az) * ez) / (ex * ex + ez * ez)));
      const d = Math.hypot(ax + ex * t - dx, az + ez * t - dz),
        half = ah + (bh - ah) * t;
      if (d >= half + far) continue;
      const rest = ease(floor - 0.2, floor + 0.2, as + (bs - as) * t);
      keep *= 1 - rest * (1 - ease(half + near, half + far, d));
    }
  return keep;
}

// [base, knoll, relief, lip] at x/z: the knoll's fill (its dome included),
// then the relief and the crook hollows (signed), both held off the pinned
// ground, then the entry lip.
export function rootSupportLifts(x, z, baseHeight, banks = true) {
  const dx = x - TREE_FOOTING.x,
    dz = z - TREE_FOOTING.z,
    tx = dx - TRUNK[0],
    tz = dz - TRUNK[1];
  const base = baseHeight(x, z),
    bank = banks ? rootBankLift(x, z) : 0,
    r = Math.hypot(tx, tz),
    channel = channelCarve(x, z, base, baseHeight(LANTERN_FOOT.x, LANTERN_FOOT.z));
  const keep = Math.hypot(dx, dz) < SUPPORT_REACH ? pinKeep(x, z) : 0;
  if (!keep) return [base, 0, 0, bank, channel];
  const knollKeep = pinKeep(x, z, ROOT_KNOLL.feather);
  const floor = baseHeight(TREE_FOOTING.x, TREE_FOOTING.z),
    spur = underSpur(dx, dz);
  const [dome, domeFull, domeNone] = ROOT_KNOLL.dome;
  const level = floor + dome * (1 - ease(domeFull, domeNone, r)) - SPUR[6] * spur;
  const knoll = Math.max(0, level - base) * knollWeight(tx, tz, x, z);
  let relief = 0;
  const fade = 1 - ease(ROOT_RELIEF.reach[0], ROOT_RELIEF.reach[1], r);
  if (fade > 0) relief = reliefNoise(x, z) * fade * (1 - spur) * restingKeep(dx, dz);
  for (const [hx, hz, radius, depth] of ROOT_HOLLOWS)
    relief -= depth * (1 - ease(0.2 * radius, radius, Math.hypot(dx - hx, dz - hz)));
  relief -= Math.max(0, base + knoll - (floor - SPUR_HOLLOW)) * spur;
  return [base, knoll * knollKeep, relief * keep, bank, channel];
}

// The supported ground at x/z, the river's channel included; banks false leaves
// out the soil banks (what tools/bake-root-shade.mjs measures them against).
export function rootSupportHeight(x, z, baseHeight, banks = true) {
  const [base, knoll, relief, bank, channel] = rootSupportLifts(x, z, baseHeight, banks);
  return base + knoll + relief + bank + channel;
}

// What the entry lips add: where the soil settles (the knoll, its relief and
// the hollows are the ground's own shape).
export function rootBermExcess(x, z) {
  return rootBankLift(x, z);
}

// The ground shader's root contact and settled soil (the slateRoot attribute
// shadeSlateRoots() reads): the vector to the nearest root centreline in units
// of that root's shadow reach (affine within each segment's region, so
// fragments interpolate it exactly and the contact line stays crisp between
// 0.75-unit vertices), the root's contact strength, and 1 minus the settled
// soil (finer earth on the entry lips, around the trunk and along each root).
// The contact strength loses ROOT_SHADE's cut where a centreline strays over
// open soil.
export function rootShade(dx, dz, lift) {
  let best = Infinity,
    vx = 3,
    vz = 0,
    strength = 0,
    band = 0;
  for (const line of ROOT_LINES)
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az, ah, as] = line[i],
        [bx, bz, bh, bs] = line[i + 1];
      const ex = bx - ax,
        ez = bz - az;
      const t = Math.min(1, Math.max(0, ((dx - ax) * ex + (dz - az) * ez) / (ex * ex + ez * ez)));
      const nx = ax + ex * t - dx,
        nz = az + ez * t - dz,
        d = Math.hypot(nx, nz);
      const half = ah + (bh - ah) * t,
        contact = as + (bs - as) * t,
        reach = half + SHADE.reach;
      band = Math.max(band, contact * (1 - ease(half + 0.2, half + SHADE.band, d)));
      if (d / reach < best) {
        best = d / reach;
        vx = nx / reach;
        vz = nz / reach;
        strength = contact;
      }
    }
  const scale = best > 3 ? 3 / best : 1;
  const plate = 1 - ease(SHADE.plate[0], SHADE.plate[1], Math.hypot(dx - TRUNK[0], dz - TRUNK[1]));
  const soil = Math.max(ease(0, SHADE.soilLift, lift), plate, band);
  return [
    vx * scale,
    vz * scale,
    best > 3 ? 0 : strength * (1 - latticeAt(CUT, TREE_FOOTING.x + dx, TREE_FOOTING.z + dz)),
    1 - soil,
  ];
}

/// The slate's root shading (shadeSlateRoots()). In the lantern clearing the
// earlier terms stay exactly as they were (SLATE_SOIL's albedo, flatten and
// contact: settled soil keeps half the slate's albedo contrast and relief, and
// a root line darkens it by up to 0.35 of the contact gain). Everywhere else:
// - settle: fine soil fills the low, dark texels first, so it follows the
//   cracks, with a crumbly grain near the lens; after the rain it is only a
//   little drier than the open slate;
// - crease: each root line's contact falls off as 1/(1 + 6u^2), u in reach
//   units, broken a little by the cracks;
// - occlusion: ROOT_SHADE's sky term dims the unshadowed fills, the sky
//   light and the reflections; its key term dims the moon only where no
//   shadow map does (slateContactGain 1: shadows off); its lamp term is the
//   trunk's and the roots' shadows in the lantern's light, and the creases
//   keep `lantern` of a root line's contact from it;
// - damp: soil in the creases and the deepest cavity is darker and wetter.
export const SLATE_SOIL = Object.freeze({
  albedo: 0.5,
  flatten: 0.5,
  contact: 0.35,
  settle: Object.freeze({
    gain: 1.1,
    crack: 1.4,
    bias: 0.45,
    dry: 0.15,
    mix: 0.15,
    flatten: 0.15,
    depth: 0.6,
    tone: 0.92,
  }),
  grain: Object.freeze({ amount: 0.35, frequency: 9, near: Object.freeze([3, 10]) }),
  crease: 6,
  occlusion: Object.freeze({
    indirect: 0.75,
    fill: 0.7,
    lantern: 0.2,
    key: 0.85,
    creaseSky: 0.9,
    creaseKey: 0.55,
    crack: 0.6,
    // Only the near-root and cavity shade stays: the baked sky is remapped.
    remap: Object.freeze([0.5, 0.95]),
  }),
  // Shadowed ground keeps cool moonlit detail: the indirect light gains a cool
  // tint across the slate ground (the fills' share is mud-ground.js SLATE_LIGHT).
  moonlit: Object.freeze({ indirect: Object.freeze([1.14, 1.19, 1.25]) }),
  damp: Object.freeze({
    crease: Object.freeze([0.1, 0.45]),
    cavity: 0.35,
    albedo: 0.08,
    roughness: 0.55,
    wet: 0.9,
    mud: 0.8, // its share of the pools' mud (pool.tone, .saturation) where the roots enter the soil
  }),
  keep: Object.freeze([1.9, 2.4]),
  // Rain in the soil's low spots (POOL_FIELD's cavity, in units; the detail
  // map's high texels raise the soil by up to `texel`, so shores follow the
  // cracks): standing water beyond `water`; wet mud beyond `mud`, darker
  // (`tone`), a little more saturated and smoother; and the crests above
  // `crest` a little drier (`dry`: less wet) and paler (`lift`).
  pool: Object.freeze({
    texel: 0.05,
    water: Object.freeze([0.022, 0.032]),
    mud: Object.freeze([-0.01, 0.025]),
    tone: Object.freeze([0.74, 0.66, 0.58]),
    saturation: 1.35,
    roughness: 0.26,
    crest: Object.freeze([0.02, 0.06]),
    dry: 0.6,
    lift: 0.08,
  }),
});
const glsl = (value) => (Number.isInteger(value) ? value.toFixed(1) : String(+value.toFixed(4)));
const glslVec = (...values) => `vec${values.length}(${values.map(glsl).join(",")})`;
const LANTERN_GLSL = glslVec(+LANTERN_FOOT.x.toFixed(2), +LANTERN_FOOT.z.toFixed(2));

// Finds anchor ("before|after", "|" marking where text goes) in source, with
// any run of spaces in the anchor matching any whitespace, or none: the
// published build compacts the slate's GLSL (tools/shader-compact.mjs).
function insertAt(source, anchor, text) {
  const pattern = (part) => part.replace(/[.*+?^${}()[\]\\]/g, "\\$&").replace(/ +/g, "\\s*");
  const [before, after = ""] = anchor.split("|");
  const match = new RegExp(`(${pattern(before)})(${pattern(after)})`).exec(source);
  return (
    match &&
    source.slice(0, match.index) +
      match[1] +
      text +
      match[2] +
      source.slice(match.index + match[0].length)
  );
}
// Applies a whole edit list, or nothing: false, leaving the shader unchanged,
// if any anchor is missing.
function applyEdits(shader, edits, prefix = {}) {
  const edited = { vertexShader: shader.vertexShader, fragmentShader: shader.fragmentShader };
  for (const [stage, anchor, text] of edits)
    if (!(edited[stage] = insertAt(edited[stage], anchor, text))) return false;
  shader.vertexShader = (prefix.vertexShader ?? "") + edited.vertexShader;
  shader.fragmentShader = (prefix.fragmentShader ?? "") + edited.fragmentShader;
  return true;
}

// The moon key's view-space direction, so the root shading finds that light
// among the direct lights (settleRoots() keeps it current per draw).
const KEY_VIEW = { value: new Vector3(...KEY_LIGHT) };
const { settle: SETTLE, grain: GRAIN, occlusion: OCCLUSION, damp: DAMP } = SLATE_SOIL;
// Each direct light is dimmed by the root occlusion: the moon key by its baked
// term (found among the directional lights by direction, mud-ground.js
// slateDirectional), the lantern (the one warm light) by its own baked
// shadows, and the cool fills (the directional fill and the crown's point
// fill) by the sky term, before the film ground's own balance of them
// (mud-ground.js SLATE_LIGHT).
const ROOT_LIGHTS = `
float slateGate(vec3 L, vec3 C) {
  if (slateSky + slateKeyOcc + slateLampOcc <= 0.0) return 1.0;
  if (slateDirectional && dot(L, slateKeyView) > .9995) return 1.0 - slateKeyOcc;
  if (C.b < .4*C.r) return 1.0 - slateLampOcc;
  return 1.0 - ${glsl(OCCLUSION.fill)}*slateSky;
}
void RE_Direct_Slate(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  IncidentLight slateLight = directLight;
  slateLight.color *= slateGate(directLight.direction, directLight.color);
  RE_Direct_Moonlit(slateLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Slate
`;
const ROOT_FRAGMENT = `varying vec4 vSlateRoot;
varying vec3 vSlateShade;
varying float vSlatePool;
uniform vec3 slateKeyView;
float slateSky = 0.0, slateKeyOcc = 0.0, slateLampOcc = 0.0, slateSettle = 0.0, slateDepth = 0.5, slateKeep = 0.0;
float slateKeepAt(vec2 p) { return 1.0 - smoothstep(${glsl(SLATE_SOIL.keep[0])}, ${glsl(SLATE_SOIL.keep[1])}, length(p - ${LANTERN_GLSL})); }
float slateSettleAt(float w, float depth) { return smoothstep(0.0, .25, (1.0 - w)*${glsl(SETTLE.gain)} - (depth - .5)*${glsl(SETTLE.crack)} - ${glsl(SETTLE.bias)})*smoothstep(0.0, .2, 1.0 - w); }
`;
const POOL = SLATE_SOIL.pool;
const POOL_SHADING = `float slatePoolDepth = vSlatePool-(slateH-.5)*${glsl(POOL.texel)};
float slatePoolW = smoothstep(${glsl(POOL.water[0])}, ${glsl(POOL.water[1])}, slatePoolDepth)*(1.0-slateDry)*(1.0-slateKeep);
float slateMud = smoothstep(${glsl(POOL.mud[0])}, ${glsl(POOL.mud[1])}, slatePoolDepth)*(1.0-slateDry)*(1.0-slateKeep);
float slateCrest = smoothstep(${glsl(POOL.crest[0])}, ${glsl(POOL.crest[1])}, -slatePoolDepth)*(1.0-slateKeep);
slatePuddle = max(slatePuddle, slatePoolW);
slateWet = max(slateWet*(1.0-${glsl(POOL.dry)}*slateCrest), slateMud);
vec3 slateMudC = diffuseColor.rgb*${glslVec(...POOL.tone)};
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(dot(slateMudC, vec3(.2126,.7152,.0722))), slateMudC, ${glsl(POOL.saturation)}), slateMud)*(1.0+${glsl(POOL.lift)}*slateCrest);
`;
// The trunk and its flare as the water's dark occluder, as the lantern
// puddle's mirror draws it (PUDDLE_MIRROR), for a ray off level water.
const WATER_VEIL =
  () => `vec3 slateVR = reflect(normalize(vMudWorld-cameraPosition), vec3(0.0, 1.0, 0.0));
vec2 slateVO = vMudWorld.xz-${glslVec(+(TREE_FOOTING.x + TRUNK[0]).toFixed(2), +(TREE_FOOTING.z + TRUNK[1]).toFixed(2))};
float slateVA = max(dot(slateVR.xz, slateVR.xz), 1e-4), slateVT = -dot(slateVO, slateVR.xz)/slateVA;
if (slateVT > 0.0) {
  float slateVH = slateVT*slateVR.y, slateVD = length(slateVO+slateVT*slateVR.xz);
  float slateVS = ${glsl(PUDDLE_MIRROR.tree.soft[0])}+${glsl(PUDDLE_MIRROR.tree.soft[1])}*slateVT;
  slateWaterVeil = ${treeVeil("slateVD", "slateVH", "slateVS")};
  slateWaterBark = ${glslVec(...PUDDLE_MIRROR.bark)};
}
float slatePoolNear = slatePoolW*(1.0-smoothstep(${glsl(PUDDLE_MIRROR.undulationFade[0])}, ${glsl(PUDDLE_MIRROR.undulationFade[1])}, length(vViewPosition)));
if (slatePoolNear > 0.0) {
  vec2 slateUP = vMudWorld.xz*1.7;
  float slateU0 = slateNoise(slateUP);
  slateWaterTilt = mat3(viewMatrix)*vec3(slateU0-slateNoise(slateUP+vec2(.15, 0.0)), 0.0, slateU0-slateNoise(slateUP+vec2(0.0, .15)))*${glsl(+(PUDDLE_MIRROR.undulation * 15).toFixed(4))}*slatePoolNear;
}
`;
const SETTLE_AT =
  "slateKeep = slateKeepAt(vMudWorld.xz);\nslateSettle = slateSettleAt(vSlateRoot.w, slateDepth);\n";

// mud-ground.js configureGroundShading() applies this, through shadeSlateGround(),
// once settleRoots() has set that as the ground material's userData.slateRoot.
// It reads the film terrain's slateRoot and slateShade attributes (a geometry
// without them reads 0,0,0,1 and 0,0: no contact, no settled soil, no
// occlusion). Returns false, leaving the shader unchanged, if the slate
// program lacks an anchor.
export function shadeSlateRoots(shader) {
  const authored = /vec3\s+slateMean/.test(shader.fragmentShader);
  const edits = [
    [
      "vertexShader",
      "#include <begin_vertex>|",
      "\nvSlateRoot = slateRoot;\nvSlateShade = slateShade;\nvSlatePool = slatePool;",
    ],
    ["fragmentShader", "#define RE_Direct RE_Direct_Moonlit|", ROOT_LIGHTS],
    // Settled soil is dry (the procedural -p surface has no map depth or tile blend).
    [
      "fragmentShader",
      "|float slateWet =",
      (authored ? "" : "slateDepth = slateH;\n" + SETTLE_AT) +
        `slateDry = max(slateDry, mix(${glsl(SETTLE.dry)}*slateSettle, 1.0-vSlateRoot.w, slateKeep));\n`,
    ],
    // Rain in the low spots: standing water (a puddle), wet mud about it, drier crests.
    ["fragmentShader", "|float slateLanternPuddle =", POOL_SHADING + WATER_VEIL()],
    // The origin-centred tree contact (slot 0) gives way to the root lines, but in the clearing.
    ["fragmentShader", "slateContacts[i].w|", "*(i > 0 ? 1.0 : slateKeep)"],
    [
      "fragmentShader",
      "diffuseColor.rgb *= 1.0 - slateAo*slateContactGain;|",
      `
if (vSlateShade.x + vSlateShade.y + vSlateShade.z + vSlateRoot.z > 0.0) {
  float slateU = length(vSlateRoot.xy), slateGuard = (1.0-slateKeep)*(1.0-slatePuddle);
  diffuseColor.rgb *= 1.0 - ${glsl(SLATE_SOIL.contact)}*vSlateRoot.z*(1.0-smoothstep(.3, 1.0, slateU))*slateContactGain*slateKeep;
  float slateCrease = vSlateRoot.z/(1.0+${glsl(SLATE_SOIL.crease)}*slateU*slateU)*slateGuard;
  float slateBreak = (slateDepth-.5)*${glsl(OCCLUSION.crack)};
  float slateS0 = max(vSlateShade.x, ${glsl(OCCLUSION.creaseSky)}*slateCrease), slateK0 = vSlateShade.y*${glsl(OCCLUSION.key)};
  slateSky = clamp(slateS0+slateBreak*slateS0*(1.0-slateS0)*2.0, 0.0, 1.0)*slateGuard;
  slateSky = smoothstep(${glsl(OCCLUSION.remap[0])}, ${glsl(OCCLUSION.remap[1])}, slateSky);
  slateSkyVis = 1.0-slateSky;
  slateKeyOcc = clamp(max((slateK0+slateBreak*slateK0*(1.0-slateK0)*2.0)*clamp((slateContactGain-.6)*2.5, 0.0, 1.0), ${glsl(OCCLUSION.creaseKey)}*slateCrease), 0.0, 1.0)*slateGuard;
  slateLampOcc = clamp(max(vSlateShade.z, ${glsl(OCCLUSION.lantern)}*slateCrease), 0.0, 1.0)*slateGuard;
  float slateDamp = clamp(max(smoothstep(${glsl(DAMP.crease[0])}, ${glsl(DAMP.crease[1])}, slateCrease), ${glsl(DAMP.cavity)}*smoothstep(.3, .95, slateSky)), 0.0, 1.0);
  diffuseColor.rgb *= 1.0 - ${glsl(DAMP.albedo)}*slateDamp;
  vec3 slateDampC = diffuseColor.rgb*${glslVec(...POOL.tone)};
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(dot(slateDampC, vec3(.2126,.7152,.0722))), slateDampC, ${glsl(POOL.saturation)}), ${glsl(DAMP.mud)}*slateDamp);
  slateMud = max(slateMud, ${glsl(DAMP.mud)}*slateDamp);
  roughnessFactor = mix(roughnessFactor, ${glsl(DAMP.roughness)}, slateDamp);
  slateWet = max(slateWet, ${glsl(DAMP.wet)}*slateDamp);
}
roughnessFactor = mix(roughnessFactor, ${glsl(POOL.roughness)}, slateMud*(1.0-slatePuddle));`,
    ],
    // The occluded sky: less reflection, less sky light.
    [
      "fragmentShader",
      "reflectedLight.indirectSpecular *= .18;|",
      "\nreflectedLight.indirectSpecular *= 1.0-slateSky;",
    ],
    [
      "fragmentShader",
      "|#include <aomap_fragment>",
      `reflectedLight.indirectDiffuse *= vec3(${SLATE_SOIL.moonlit.indirect.map(glsl).join(", ")});\nreflectedLight.indirectDiffuse *= 1.0-${glsl(OCCLUSION.indirect)}*slateSky;\n`,
    ],
  ];
  // The authored maps' tile blend and close relief.
  if (authored)
    edits.push(
      [
        "fragmentShader",
        "|diffuseColor *= sampledDiffuseColor;",
        `slateDepth = mix(slateH, smoothstep(.04, .3, dot(sampledDiffuseColor.rgb, vec3(.2126,.7152,.0722))), ${glsl(SETTLE.depth)});
${SETTLE_AT}float slateGrain = .5, slateNearG = 1.0-smoothstep(${glsl(GRAIN.near[0])}, ${glsl(GRAIN.near[1])}, length(vViewPosition));
if (slateSettle*slateNearG > 0.0) slateGrain = slateNoise(vMudWorld.xz*${glsl(GRAIN.frequency)})*.6+slateNoise(vMudWorld.xz*${glsl(GRAIN.frequency * 2.3)}+7.1)*.4;
vec3 slateSoilTone = mix(slateMean*${glsl(SETTLE.tone)}*(.8+.4*slateH)*(1.0+(slateGrain-.5)*${glsl(GRAIN.amount)}*slateNearG), slateMean*(.8+.4*slateH), slateKeep);
sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, slateSoilTone, mix(${glsl(SETTLE.mix)}*slateSettle, ${glsl(SLATE_SOIL.albedo)}*(1.-vSlateRoot.w), slateKeep));
`,
      ],
      [
        "fragmentShader",
        "*slatePuddle)|, mix(slateNA.z",
        `*(1.-mix(${glsl(SETTLE.flatten)}*slateSettle, ${glsl(SLATE_SOIL.flatten)}*(1.-vSlateRoot.w), slateKeep))`,
      ],
    );
  if (
    !applyEdits(shader, edits, {
      vertexShader:
        "attribute vec4 slateRoot;\nattribute vec3 slateShade;\nattribute float slatePool;\nvarying vec4 vSlateRoot;\nvarying vec3 vSlateShade;\nvarying float vSlatePool;\n",
      fragmentShader: ROOT_FRAGMENT,
    })
  )
    return false;
  shader.uniforms.slateKeyView = KEY_VIEW;
  return true;
}

// The river's and the puddles' mirror (plan P3): clear water. SLATE_PUDDLES'
// grazing sky sheen gives way to a water Fresnel (F0 .02) mirror of the
// terrain horizon, the fog and the zenith (the night sky), with the tree's trunk as a dark
// occluder and the lantern upside down in it, lit by the lantern light's own
// (flickering) colour and compressed to a luminance knee; the flame's image
// (MIRROR_FLAME) keeps the knee's peak, so it stays well under the flame, but
// not its flattening. The water forms a level plane .02 above the
// lantern's footing, a soft shore that follows the cracks with a damp margin,
// and a static micro-undulation near the lens; the river's current
// (RIVER_RIPPLE) ripples it as it flows, and rare drips ruffle it. The
// drip-line puddles keep SLATE_PUDDLES' roughness .12 and specular gain 4.
export const PUDDLE_MIRROR = Object.freeze({
  // The sky in the water, times its own radiance: the water's Fresnel alone dims it.
  sky: 1,
  undulation: 0.006,
  undulationFade: Object.freeze([12, 34]),
  imageSoft: 0.45,
  ggxKeep: 0.22,
  knee: 0.5,
  f0: 0.02,
  shore: Object.freeze([-0.02, 0.09]),
  margin: Object.freeze([-0.16, -0.02]),
  marginAlbedo: 0.08,
  coat: 0.15,
  darken: Object.freeze([0.3, 0.75]),
  // The level water plane, relative to the lantern's foot: the river's (RIVER_BED.level).
  water: -0.04,
  // Where set, the plane eases back to the water's own place from plane[0] to
  // plane[1] units from the lantern: far water lies at the plain's level, not
  // the lantern's, and mirrors no trunk or lantern.
  plane: Object.freeze([14, 28]),
  cloud: 0.22,
  // hill-silhouette.js TERRAIN_HORIZON and SLATE_PUDDLES.zenith (mud-ground.js).
  horizon: Object.freeze([0.062, 0.065, 0.073]),
  zenith: Object.freeze([0.07, 0.085, 0.13]),
  // The tree above TREE_FOOTING + TRUNK as the water sees it (treeVeil()): its
  // root flare (radius and height ranges, measured on the tree); its trunk,
  // `radius` [at the foot, at the crotch] tapering up to the crotch, which ends
  // over [from, to] in height; its two limbs leaning apart above it, their
  // middles `lean` [from the axis, per unit up] out and half `width` [at the
  // crotch, at the top], fading out over `top`; edges `soft` [units, share of
  // the reflected ray's length] wide, never under 1.5 pixels; and its colour.
  flare: Object.freeze([3, 4.2, 0.8, 1.8]),
  tree: Object.freeze({
    radius: Object.freeze([2.4, 1.9]),
    crotch: Object.freeze([8.5, 11.5]),
    lean: Object.freeze([1.1, 0.55]),
    width: Object.freeze([0.8, 0.35]),
    top: Object.freeze([11.5, 14]),
    soft: Object.freeze([0.3, 0.02]),
  }),
  bark: Object.freeze([0.045, 0.048, 0.05]),
});
// The tree's silhouette in the water's mirror (PUDDLE_MIRROR.flare and tree), a
// GLSL expression: where a ray off the water passes `d` from the trunk's axis at
// `h` above the water, with edges `aa` units soft. The flare, the trunk tapering
// to its crotch and two limbs leaning apart above it, so its image reads as a
// tree's, never as a box with level ends.
function treeVeil(d, h, aa) {
  const { flare } = PUDDLE_MIRROR,
    { radius, crotch, lean, width, top } = PUDDLE_MIRROR.tree,
    n = (v) => glsl(+v.toFixed(4)),
    fork = crotch[0] - 1;
  const trunk = `(1.0-smoothstep(-${aa}, ${aa}, ${d}-mix(${n(radius[0])}, ${n(radius[1])}, clamp(${h}/${n(crotch[1])}, 0.0, 1.0))))*(1.0-smoothstep(${n(crotch[0])}-${aa}, ${n(crotch[1])}+${aa}, ${h}))`,
    limbs = `(1.0-smoothstep(-${aa}, ${aa}, abs(${d}-${n(lean[0])}-${n(lean[1])}*max(${h}-${n(fork)}, 0.0))-mix(${n(width[0])}, ${n(width[1])}, smoothstep(${n(fork)}, ${n(top[1])}, ${h}))))*smoothstep(${n(fork - 1)}, ${n(fork)}, ${h})*(1.0-smoothstep(${n(top[0])}, ${n(top[1])}+${aa}, ${h}))`,
    root = `(1.0-smoothstep(${n(flare[0])}, ${n(flare[1])}, ${d}))*(1.0-smoothstep(${n(flare[2])}, ${n(flare[3])}, ${h}))`;
  return `max(max(${trunk}, ${limbs}), ${root})`;
}
// The supplied lantern in its own units (lantern.js LANTERN_AUTHORING_HEIGHT
// 2.48, drawn 1.98 tall): the light sits at its luminous centre (`glow`, and
// `scale` the drawn size), and the flame (lantern-flame.js FLAME and
// FLAME_BASE) stands on the wick at 0.49, 0.30 tall and 0.047 wide, its fire
// in the FLAME colours at gain 1.6, with lanternFire's light held in the
// glass: a halo [strength, half-width, centre and height as fractions of the
// flame's] and fill in the warm colour, a glare in the pale one (its no-bloom
// strength). In the water the cage's silhouette eases each step of its width
// over `round` (lantern units), so its eave never stands out as a rectangular
// tab, and the flame-lit underside of its roof keeps `roof` of its light, so
// the image's lower crossbar never closes it into a lit frame.
// The flame's glints on the moving water (the owner's pick of 2026-10-20: "a column
// of glints off the moving ripples, like real lamplight on moving water"): the
// current's finest ripples (`cells` [along, across] per unit, `slope` their
// steepness) tumble with it, and each face turned to throw the flame's light
// toward the eye glints, as bright as the flame's reflection (`gain` of the
// lamp's light) and as small as the flame and its glass look from there (`size`
// units); ripples finer than the pixel spread their glints wider and dimmer, so
// they never flicker. On moving water the flame's mirrored image gives way to
// them (`image` of it goes), the lantern's dark cage still standing in it.
export const LANTERN_GLINT = Object.freeze({
  cells: Object.freeze([4.5, 3.5]),
  slope: 0.08,
  size: 0.25,
  gain: 0.5,
  image: 0.85,
});
export const LANTERN_IMAGE = Object.freeze({
  scale: 1.98 / 2.48,
  glow: 0.7146,
  round: 0.04,
  roof: 0.6,
});
export const LANTERN_FLAME = Object.freeze({
  base: 0.49,
  height: 0.3,
  halfWidth: 0.047,
  gain: 1.6,
  color: Object.freeze({
    blue: Object.freeze([0.07, 0.16, 0.62]),
    core: Object.freeze([1.35, 1.12, 0.62]),
    body: Object.freeze([1.12, 0.8, 0.25]),
    tip: Object.freeze([1, 0.24, 0.035]),
  }),
  glass: Object.freeze({
    halo: Object.freeze([0.05, 0.075, 0.4, 0.62]),
    fill: 0.015,
    glare: Object.freeze([0.05, 0.11, 0.45, 0.8]),
    warm: Object.freeze([1, 0.48, 0.14]),
    pale: Object.freeze([1, 0.62, 0.28]),
  }),
});
// The flame's mirror image reads the size of the flame (its extent at 30% and
// 50% of its own peak 0.9-1.0x the real flame's in the same frame): it is the flame's own light as the frame shows it, lanternFire's
// fire and glass light with the gain clipped at white as the grade clamps the
// real flame, added after the knee. The image's body is `width` of the
// flame's, the flame's own falloff (the film grade leaves the flame without a
// cel step or ink), and its ends, soft where the flame's are cut, sit `inset`
// pixel footprints inside the flame's (scaling about `mid`, over the `span` of
// the flame's height it lights).
export const MIRROR_FLAME = Object.freeze({ width: 1, inset: 0.7, span: 0.65, mid: 0.46 });
// Rare drips: one per 6.5 s cell, landing +-1.25 s about the cell's middle
// (4-9 s apart), so at most one lives at a time, inside a puddle (60% the
// lantern's). In the lantern's puddle a drip falls within `aim` (units) of
// where the camera sees the lantern's image, when that lies well inside the
// water (`inside` of the zone's radius); otherwise, and in the drip-line
// puddles, at a seeded point. Two soft rings run out at .35 u/s and fade by
// 2.6 s; they only tilt the water's mirror normal, by at most maxTilt, so the
// lantern's image wobbles and shimmers rather than breaking into strips. The
// clock starts in a calm gap between two cells, so no half-run ring shows
// when the water appears.
export const DRIP_RIPPLES = Object.freeze({
  cell: 6.5,
  jitter: 2.5,
  speed: 0.35,
  life: 2.6,
  gap: 0.32,
  slope: Object.freeze([0.02, 0.012]),
  wavelength: Object.freeze([0.24, 0.08]),
  decay: 1.2,
  maxTilt: 0.018,
  start: 7.2,
  aim: Object.freeze([0.08, 0.45]),
  inside: 0.7,
});
// The drips' seeded values: an integer hash of the cell and a salt, the same on every engine.
function dripHash(n, salt) {
  let h = Math.imul((n | 0) ^ Math.imul(salt, 0x9e3779b1), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// The drip alive at drip-clock time t, or null: [world x, world z, age in
// seconds, cell]. aim(cell), for a drip into the lantern's puddle, may give
// the point [x, z] to fall near (the lantern's image, taken once per drip).
export function dripAt(t, aim = () => null) {
  const { cell, jitter, life } = DRIP_RIPPLES;
  for (let k = 0; k < 2; k++) {
    const n = Math.floor(t / cell) - k,
      age = t - ((n + 0.5) * cell + (dripHash(n, 1) - 0.5) * jitter);
    if (age < 0 || age > life) continue;
    const zone = dripHash(n, 2),
      turn = dripHash(n, 3) * 2 * Math.PI,
      spread = dripHash(n, 4),
      c = Math.cos(turn),
      s = Math.sin(turn);
    const [west, north] = PUDDLE_ZONES;
    if (zone < 0.6) {
      const at = aim(n);
      if (at && riverRadius(at[0], at[1]) < DRIP_RIPPLES.inside) {
        const r = DRIP_RIPPLES.aim[0] + (DRIP_RIPPLES.aim[1] - DRIP_RIPPLES.aim[0]) * spread;
        return [at[0] + c * r, at[1] + s * r, age, n];
      }
      // Elsewhere on the river within a few units of the lantern.
      const [px, pz, dx, dz] = riverPoint(RIVER_NEAR + (spread - 0.5) * 7);
      return [px - dz * c * 0.45 * RIVER.width, pz + dx * c * 0.45 * RIVER.width, age, n];
    }
    const { x, z, radius } = zone < 0.8 ? west : north;
    return [
      x + c * Math.sqrt(spread) * 0.45 * radius,
      z + s * Math.sqrt(spread) * 0.45 * radius,
      age,
      n,
    ];
  }
  return null;
}
const zoneGlsl = (zone) => glslVec(+zone.x.toFixed(2), +zone.z.toFixed(2));
// The river's current on the water (MIRROR): two octaves of ripples, each
// [along, across] cycles per unit (about as long as wide: drawn out further, a
// mirror rules them into brushed streaks), and the tilt of each (livelier, the
// owner's pick of 2026-10-23, so the near river in Lantern study visibly runs as
// the stream does). They are the
// rapids' smooth flow noise where the river has its falls, turning as they
// drift (`flow`: its slope's share against the value noise's), in broad boils
// and slicks drifting with it (`boils`: their cells per unit, the calm and the
// rough share). Where `fade` is set, the coarse octave fades as the fine one does,
// where its ripples would fall under fade[0] to fade[1] pixels of ground, so
// far water keeps the sky still instead of shimmering. The lantern's image
// takes none of the currents' tilt up or down: each ripple would shift the
// reflected height by more than the lantern's eave is deep and break its image
// into stacked, offset strips. It sways instead, `sway` times the river's
// coarse ripples' tilt across the view: its posts lean and bend by about a
// post's width as the water drifts, slowly, the image never sliced. A lens
// looking down on the water sees the same ripple bend the image less, so the
// sway grows as the view flattens, `swayLow` [0] over the sine of the view's
// elevation, at least 1 and at most [1] times: a small, far image (a landscape
// phone, a wide screen, the phone's Root and lantern) sways as a near one does,
// and its lit roof underside, which would stay level while the posts sway,
// dims by as much. The
// moving water (the river's and the streams') mirrors the sky at `rough`
// roughness (the environment's own prefiltered blur), and the stream up to
// `roughTilt` more where its ripples are steepest (where it leaves the river): sharp,
// its ripples swept the sky's fine strokes into closed contour rings; still
// puddles stay sharp.
// Where the stream leaves the river, its steeper ripples ease into the river's own
// between `mouth` [0] and [1] river radii, keeping [2] of them, so the plume's
// steep ripples never contour the river's mirror.
export const RIVER_RIPPLE = Object.freeze({
  coarse: Object.freeze([0.85, 1.25]),
  fine: Object.freeze([2.4, 3.2]),
  boils: Object.freeze([0.14, 0.45, 1.35]),
  flow: 0.55,
  tilt: Object.freeze([0.04, 0.02]),
  fade: Object.freeze([1.5, 3]),
  sway: 3,
  swayLow: Object.freeze([0.5, 5]),
  rough: 0.12,
  roughTilt: 0.3,
  mouth: 0.2,
});
// The river's current noise: the rapids' smooth flow noise where the river has
// its falls (turning on the drips' clock), else the slate's value noise.
const RIVER_NOISE = RAPIDS_AT ? "slateRpF" : "slateNoiseD",
  RIVER_TURN = (rate) => (RAPIDS_AT ? `, slateFlow*${glsl(rate)}` : "");
// The streams' current (STREAMS.current), on the same octaves' terms.
const SC = STREAMS.current;
// The puddles that lie on dune slopes keep the ground's height in the mirror:
// the north drip-line puddle and Portrait's foreground one.
const SLOPED = [PUDDLE_ZONES[1], PUDDLE_ZONES[2]];
const LAMP_FOOT = LANTERN_IMAGE.glow * LANTERN_IMAGE.scale;
// slateDrip: the live drip (dripAt(): world x, z, age; w 1 while one lives),
// set per draw on the CPU. slateFlame: the lantern flame's draught (height
// factor, 0 without the flame module; lean in lantern units along world x, z).
const PUDDLE_HEAD = `uniform vec4 slateDrip, slateFlame;
uniform float slateFlow, slateCoastStudy;
vec3 slateNoiseD(vec2 p){vec2 i=floor(p),f=fract(p),u=f*f*(3.-2.*f),du=6.*f*(1.-f);float a=slateHash(i),b=slateHash(i+vec2(1,0)),c=slateHash(i+vec2(0,1)),d=slateHash(i+1.),k=a-b-c+d;return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,du*(vec2(b-a,c-a)+k*u.yx));}
// The live drip's tilt of the water at p (world xz); rings finer than about
// three pixels of ground footprint (fp, units) fade out instead of aliasing.
vec2 slateRipples(vec2 p, float fp) {
  vec2 q = p-slateDrip.xy;
  float a = slateDrip.z, r = length(q), s = 0.0;
  for (int j = 0; j < 2; j++) {
    float aj = a-${glsl(DRIP_RIPPLES.gap)}*float(j);
    if (aj <= 0.0) continue;
    float lam = ${glsl(DRIP_RIPPLES.wavelength[0])}+${glsl(DRIP_RIPPLES.wavelength[1])}*aj, dr = (r-${glsl(DRIP_RIPPLES.speed)}*aj)/lam;
    s -= (j == 0 ? ${glsl(DRIP_RIPPLES.slope[0])} : ${glsl(DRIP_RIPPLES.slope[1])})*2.3316*dr*exp(-dr*dr-${glsl(DRIP_RIPPLES.decay)}*aj)*smoothstep(1.5, 3.0, lam/fp);
  }
  vec2 g = s*q/max(r, .001)/sqrt(1.0+2.0*r)*(1.0-smoothstep(${glsl(DRIP_RIPPLES.life - 0.6)}, ${glsl(DRIP_RIPPLES.life)}, a));
  return g*min(1.0, ${glsl(DRIP_RIPPLES.maxTilt)}/max(length(g), 1e-5));
}
${RAPIDS_AT ? rapidsGlsl("slateRp", RAPIDS_AT, RAPIDS, "slateCoastStudy", "slateLoop") : ""}
`;
// The flame's colours and glass light; its core's luminance, and the core's once the gain is clipped at white.
const MF = MIRROR_FLAME,
  C = LANTERN_FLAME.color,
  G = LANTERN_FLAME.glass,
  luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const FLAME_PEAK = luminance(C.core),
  FLAME_WHITE = luminance(C.core.map((v) => Math.min(1, v * LANTERN_FLAME.gain)));
const M = PUDDLE_MIRROR,
  F = LANTERN_FLAME,
  TRUNK_GLSL = glslVec(
    +(TREE_FOOTING.x + TRUNK[0]).toFixed(2),
    +(TREE_FOOTING.z + TRUNK[1]).toFixed(2),
  );
const MIRROR = `#ifdef USE_FOG
float slateWater = slatePuddle*slateZoneW;
if (slateWater > 0.0) {
  // The water's own normal, for the mirror and its Fresnel only (the bottom keeps the soil's): level as it deepens, a still micro-undulation near the lens, and the drips.
  float slateDeep = smoothstep(-.01, .05, slateLevel)*(1.0-slateDry)*slateZoneW;
  vec3 slateN = normalize(normal*mat3(viewMatrix)), slateNI = slateN, slateV = normalize(cameraPosition-vMudWorld);
  float slateView = length(vViewPosition), slateRough = 0.0, slateRoughT = 0.0, slateSWG = 1.0, slateGR = 0.0, slateBrink = 0.0;
  vec2 slateGG = vec2(0.0);
  vec3 slateNG = vec3(0.0, 1.0, 0.0);
  if (slateDeep > 0.0) {
    vec2 slateG = vec2(0.0);
    // The undulation's noise only where it has not faded; the rings only while a drip lives.
    if (slateView < ${glsl(M.undulationFade[1])}) {
      vec3 slateU1 = slateNoiseD(mat2(.8, .6, -.6, .8)*vMudWorld.xz*1.7), slateU2 = slateNoiseD(vMudWorld.xz*3.9+17.0);
      slateG = (slateU1.yz*mat2(.8, .6, -.6, .8)+.5*slateU2.yz)*${glsl(M.undulation)}*(1.0-smoothstep(${glsl(M.undulationFade[0])}, ${glsl(M.undulationFade[1])}, slateView));
    }
    if (slateDrip.w > 0.0) slateG += slateRipples(vMudWorld.xz, slatePx*slateView/max(abs(dot(normal, normalize(vViewPosition))), .3));
    // The currents' tilt (slateGC: the river's, slateGT: the streams'), which the lantern's image takes none of; it sways
    // with the river's coarse ripples (slateGS) across the view instead (RIVER_RIPPLE.sway).
    vec2 slateGC = vec2(0.0), slateGS = vec2(0.0), slateGT = vec2(0.0);
    // The river's current: ripples drawn out along the flow drift downstream at RIVER.flow (on the drips' clock, so they hold
    // as the drips do); the finer octave fades where it would fall under three pixels of ground. They ease out toward the shore.
    if (slateRiverR < 1.1) {
      vec2 slateFU = vec2(slateRiverQ.y+slateFlow*${glsl(RIVER_CHANNEL.speed)}, slateRiverQ.z);
      float slateFP = slatePx*slateView/max(abs(dot(normal, normalize(vViewPosition))), .3);
      // Smooth flow noise (no lattice lines for the mirror to rule into streaks), turning as it
      // drifts, about as long as wide; in broad boils and slicks the current calms or roughens.
      vec3 slateF1 = ${RIVER_NOISE}(slateFU*${glslVec(...RIVER_RIPPLE.coarse)}${RIVER_TURN(0.25)}), slateF2 = ${RIVER_NOISE}(slateFU*${glslVec(...RIVER_RIPPLE.fine)}+13.0${RIVER_TURN(0.4)});
      float slateBoil = ${glsl(RIVER_RIPPLE.boils[1])}+${glsl(RIVER_RIPPLE.boils[2] - RIVER_RIPPLE.boils[1])}*smoothstep(.3, .75, .5+.5*${RIVER_NOISE}(slateFU*${glsl(RIVER_RIPPLE.boils[0])}+31.0${RIVER_TURN(0.08)}).x);
      slateF1.yz *= ${glsl(RIVER_RIPPLE.flow)}*slateBoil; slateF2.yz *= ${glsl(RIVER_RIPPLE.flow)}*slateBoil;
      float slateFF = ${RIVER_RIPPLE.fade ? `smoothstep(${glsl(RIVER_RIPPLE.fade[0])}, ${glsl(RIVER_RIPPLE.fade[1])}, ${glsl(+(1 / RIVER_RIPPLE.coarse[1]).toFixed(4))}/slateFP)` : "1.0"};
      vec2 slateFC = slateF1.yz*${glslVec(...RIVER_RIPPLE.coarse)}*${glsl(RIVER_RIPPLE.tilt[0])}*slateFF, slateFG = slateFC+slateF2.yz*${glslVec(...RIVER_RIPPLE.fine)}*${glsl(RIVER_RIPPLE.tilt[1])}*smoothstep(1.5, 3.0, ${glsl(1 / RIVER_RIPPLE.fine[1])}/slateFP);
      vec2 slateFX = vec2(-slateRiverDir.y, slateRiverDir.x);
      // The glints' ripples (LANTERN_GLINT): the current's finest, tumbling with it; resolved where they span a few pixels.
      vec3 slateGlR = ${RIVER_NOISE}(slateFU*${glslVec(...LANTERN_GLINT.cells)}+41.0${RIVER_TURN(0.9)});
      slateGR = smoothstep(1.5, 3.0, ${glsl(+(1 / LANTERN_GLINT.cells[0]).toFixed(4))}/slateFP);
      slateGG = (slateRiverDir*slateGlR.y+slateFX*slateGlR.z)*${glsl(+(LANTERN_GLINT.slope / FLOW_RMS).toFixed(5))}*(1.0-smoothstep(.8, 1.1, slateRiverR));
      float slateFS = 1.0-smoothstep(.8, 1.1, slateRiverR);
      slateGC = (slateRiverDir*slateFG.x+slateFX*slateFG.y)*slateFS*mix(1.,3.,vSlateRiverSurface.x);
      slateGS = (slateRiverDir*slateFC.x+slateFX*slateFC.y)*slateFS;
      slateRough = slateFS;
    }
    // The streams' current: steeper, finer ripples drawn out along each course drift down it at STREAMS.flow, each
    // octave fading where it would fall under three pixels of ground, and easing into the river's own where it leaves it
    // (RIVER_RIPPLE.mouth).
    if (slateStreamQ.x > 0.0) {
      vec2 slateSU = vec2(slateStreamQ.y-slateFlow*${glsl(STREAMS.flow)}, slateStreamQ.z*slateStreamQ.w);
      float slateSP = slatePx*slateView/max(abs(dot(normal, normalize(vViewPosition))), .3);
      vec3 slateS1 = slateNoiseD(slateSU*${glslVec(...SC.coarse)}+5.0), slateS2 = slateNoiseD(slateSU*${glslVec(...SC.fine)}+29.0);
      vec2 slateSG = slateS1.yz*${glslVec(...SC.coarse)}*${glsl(SC.tilt[0])}*smoothstep(1.5, 3.0, ${glsl(+(1 / SC.coarse[1]).toFixed(4))}/slateSP)+slateS2.yz*${glslVec(...SC.fine)}*${glsl(SC.tilt[1])}*smoothstep(1.5, 3.0, ${glsl(+(1 / SC.fine[1]).toFixed(4))}/slateSP);
      slateRough = max(slateRough, slateStreamQ.x);
      slateRoughT = min(length(slateSG)/.08, 1.0)*slateStreamQ.x;
      slateGT = (slateStreamDir*slateSG.x+vec2(-slateStreamDir.y, slateStreamDir.x)*slateSG.y)*slateStreamQ.x*mix(${glsl(RIVER_RIPPLE.mouth)}, 1.0, slateShoal)*mix(1.0, ${glsl(STREAMS.calm.ripple)}, slateStreamCalm);
    }
${
  RAPIDS_AT
    ? `    // The rapids' streaks and standing waves (STREAM_FOAM's slateRpP) take over from the calm current as it quickens;
    // where they are steep the sky blurs.
    if (slateRpWt > 0.0) {
      vec2 slateRpDir = slateRiverDir;
      if (slateCoastStudy > .5) slateRpDir = normalize(mix(slateRpDir, ${glslVec(-RAPIDS_AT.head[0], -RAPIDS_AT.head[1])}, slateRpBlend));
      slateGC = slateGC*(1.0-slateRpWt)+slateRpDir*slateRpP.x+vec2(-slateRpDir.y, slateRpDir.x)*slateRpP.y;
      slateRoughT = max(slateRoughT, slateRpP.w);
      // The same world gradient and roughness reach the falling body's head.
      // Suppress only the old independent micro ripples as this field takes over.
      if (slateCoastStudy > .5) {
        slateBrink = slateRpWt;
        slateG *= 1.0-slateRpWt;
        slateRoughT = mix(slateRoughT, slateRpP.w, slateRpWt);
      }
    }
`
    : ""
}
    // The lantern's image: the still water's tilt, swayed across the view by the river's coarse ripples.
    vec2 slateSide = normalize(vec2(slateV.z, -slateV.x)+1e-6);
    slateSWG = clamp(${glsl(RIVER_RIPPLE.swayLow[0])}/max(slateV.y, .02), 1.0, ${glsl(RIVER_RIPPLE.swayLow[1])});
    vec2 slateGI = slateG+${glsl(RIVER_RIPPLE.sway)}*slateSWG*dot(slateGS, slateSide)*slateSide;
    slateNI = normalize(mix(slateN, normalize(vec3(-slateGI.x, 1.0, -slateGI.y)), slateDeep));
    slateG += slateGC+slateGT;
    slateN = normalize(mix(slateN, normalize(vec3(-slateG.x, 1.0, -slateG.y)), slateDeep));
    slateNG = normalize(vec3(-slateG.x-slateGG.x, 1.0, -slateG.y-slateGG.y));
  }
  vec3 slateR = reflect(-slateV, slateN), slateRI = reflect(-slateV, slateNI);
  float slateF = ${glsl(M.f0)}+${glsl(1 - M.f0)}*pow(1.0-saturate(dot(slateN, slateV)), 5.0), slateRA = max(dot(slateR.xz, slateR.xz), 1e-4), slateRAI = max(dot(slateRI.xz, slateRI.xz), 1e-4);
  // The lantern, found by its light's world position among the point lights.
  vec3 slateLamp = vec3(0.0), slateLampW = vec3(0.0);
  #if NUM_POINT_LIGHTS > 0
  for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
    vec3 w = (pointLights[i].position-viewMatrix[3].xyz)*mat3(viewMatrix);
    if (length(w.xz-${LANTERN_GLSL}) < .3) { slateLamp = pointLights[i].color; slateLampW = w; }
  }
  #endif
  // Reflect from a level water plane just above the lantern's footing (the puddles on dune slopes keep the ground's height).
  vec3 slateP = vMudWorld;
  if (dot(slateLamp, slateLamp) > 0.0${SLOPED.map((zone) => ` && length(vMudWorld.xz-${zoneGlsl(zone)}) > ${glsl(zone.radius + 0.1)}`).join("")})
    slateP = cameraPosition+(vMudWorld-cameraPosition)*((cameraPosition.y-slateLampW.y+${glsl(LAMP_FOOT - M.water)})/max(cameraPosition.y-vMudWorld.y, .01));
${
  M.plane
    ? `  slateP = mix(slateP, vMudWorld, smoothstep(${glsl(M.plane[0])}, ${glsl(M.plane[1])}, length(vMudWorld.xz-${LANTERN_GLSL})));
`
    : ""
}  // The night sky (the film's environment, night-environment.js) at its sharpest, brighter in a lightning flash away from the text (film-light.js FLASH_GROUND); without it, a sky from the horizon, fog and zenith colours.
  #ifdef USE_ENVMAP
  float slateEnvRough = ${glsl(RIVER_RIPPLE.rough)}*slateRough+${glsl(RIVER_RIPPLE.roughTilt)}*slateRoughT;
  if (slateCoastStudy > .5) slateEnvRough = max(slateEnvRough, (.25+.5*slateRoughT)*slateBrink);
  vec3 slateSkyW = textureCubeUV(envMap, slateR, slateEnvRough).rgb*envMapIntensity*${glsl(M.sky)}*(babelFlash.y > 0.0 ? 1.0+babelFlash.y*(1.0-slateBehindText()) : 1.0);
  #else
  vec3 slateSkyW = mix(mix(${glslVec(...M.horizon)}, fogColor, smoothstep(0.0, .1, slateR.y)), ${glslVec(...M.zenith)}, smoothstep(.12, .6, slateR.y));
  slateSkyW *= 1.0+${glsl(2 * M.cloud)}*(slateNoise((slateP.xz+slateR.xz*(60.0/max(slateR.y, .05)))/45.0)-.5)*smoothstep(.02, .12, slateR.y);
  #endif
  // The trunk and its root flare as a dark occluder.
  vec2 slateO = slateP.xz-${TRUNK_GLSL};
  float slateT = -dot(slateO, slateR.xz)/slateRA, slateTH = slateT*slateR.y, slateTD = length(slateO+slateT*slateR.xz), slateTrunk = 0.0;
  if (slateT > 0.0) {
    float slateTS = max(${glsl(M.tree.soft[0])}+${glsl(M.tree.soft[1])}*slateT, 1.5*slatePx*(slateView+slateT));
    slateTrunk = ${treeVeil("slateTD", "slateTH", "slateTS")};
    slateSkyW = mix(slateSkyW, ${glslVec(...M.bark)}, slateTrunk);
  }
  vec3 slateMirror = slateSkyW, slateFlameW = vec3(0.0);
  float slateFlamePk = 0.0;
  vec2 slateLO = slateP.xz-slateLampW.xz;
  float slateLT = -dot(slateLO, slateRI.xz)/slateRAI;
  if (slateLT > 0.0 && dot(slateLamp, slateLamp) > 0.0 && (slateLT < slateT || slateTrunk < .01)) {
    // Where the reflected ray passes the lantern's axis, in lantern units.
    float slateLX = (slateLO.x*slateRI.z-slateLO.y*slateRI.x)/sqrt(slateRAI)/${glsl(LANTERN_IMAGE.scale)}, slateLY = (slateP.y+slateLT*slateRI.y-slateLampW.y)/${glsl(LANTERN_IMAGE.scale)}+${glsl(LANTERN_IMAGE.glow)};
    vec2 slateAA = vec2(slatePx*(slateView+slateLT)/${glsl(LANTERN_IMAGE.scale)})+vec2(.012, .03)*${glsl(M.imageSoft)};
    float slateAX = abs(slateLX), ly = slateLY;
    // Only rays that pass within the lantern's bounds (its widest .59, 0 to 2.49 tall) draw its image.
    if (slateAX < .6+slateAA.x && ly > -slateAA.y && ly < 2.5+slateAA.y) {
    // The cage's silhouette (measured on the lantern): foot, body, eave, dome and finial.
    // Its steps (foot to body, body to eave, eave to dome) eased over LANTERN_IMAGE.round, so no corner reads as a tab.
    float slateHR = ${glsl(LANTERN_IMAGE.round)}, slateHT = ly < 2.1 ? mix(.5, .3, (ly-1.68)/.42) : ly < 2.2 ? mix(.3, .16, (ly-2.1)/.1) : .16-.24*(ly-2.2);
    float slateHW = mix(.59-.08*smoothstep(.1-slateHR, .1+slateHR, ly)-.075*smoothstep(.3-slateHR, .3+slateHR, ly)+.155*smoothstep(1.5-slateHR, 1.5+slateHR, ly), slateHT, smoothstep(1.68-slateHR, 1.68+slateHR, ly));

    float slateCageM = (1.0-smoothstep(slateHW-slateAA.x, slateHW+slateAA.x, slateAX))*smoothstep(-slateAA.y, slateAA.y, ly)*(1.0-smoothstep(2.47-slateAA.y, 2.49+slateAA.y, ly));
    float slateGlassM = (1.0-smoothstep(.36-slateAA.x, .36+slateAA.x, slateAX))*smoothstep(.34-slateAA.y, .34+slateAA.y, ly)*(1.0-smoothstep(1.48-slateAA.y, 1.48+slateAA.y, ly));
    float slateLampY = dot(slateLamp, vec3(.2126, .7152, .0722)), slateGlobe = length(vec2(slateAX/.2, (ly-.74)/.34));
    // Through the clear globe the sky and, without the flame module, a faint glow (with it, the flame's image carries the glass's light); the dark cage with the flame-lit inner faces of its posts and the roof's underside.
    vec3 slateGlassC = slateSkyW*.8+slateLamp*(.03*(1.0-smoothstep(.5, 1.0, slateGlobe))+.02*exp(-3.0*slateGlobe*slateGlobe))*(1.0-step(.01, slateFlame.x));
    vec3 slateCageC = vec3(.012, .013, .026)+slateLamp*(1.0-${glsl(LANTERN_GLINT.image)}*slateRough)*(.25*exp(-pow2((slateAX-.37)/(.018+slateAA.x))-pow2((ly-.8)/.55))*step(.3, ly)*step(ly, 1.52)+${glsl(0.12 * LANTERN_IMAGE.roof)}/slateSWG*exp(-pow2((ly-1.49)/(.02+slateAA.y))))*(1.0-smoothstep(.44-slateAA.x, .44+slateAA.x, slateAX));
    // The v3 flame (lantern-flame.js lanternFire): blue cup, dark vapour cone, yellow-white core, yellow body, orange-red tip, at
    // the flame's own draught (slateFlame): its height, and its lean, which grows up the flame. Its ends sit MIRROR_FLAME.inset
    // pixel footprints (fp) inside the flame's.
    float fp = slatePx*(slateView+slateLT)/${glsl(LANTERN_IMAGE.scale)};
    float fh = ${glsl(F.height)}*max(slateFlame.x, .01), fu = ((ly-${glsl(F.base)})/fh-${glsl(MF.mid)})*(1.0+${glsl((2 * MF.inset) / MF.span)}*fp/fh)+${glsl(MF.mid)}, fs = clamp((fu+.08)/1.08, 0.0, 1.0), fr = clamp(fu, 0.0, 1.0);
    float fw = ${glsl(F.halfWidth * 1.45)}*sin(3.1416*pow(fs, .74))*(1.0-.22*fs), fx = abs(slateLX-(slateFlame.z*slateRI.z-slateFlame.w*slateRI.x)/sqrt(slateRAI)*fr*fr), fq = fx/max(fw, .005), fa = max(fp-.7*fw, 1e-4);
    // The body (MIRROR_FLAME.width of the flame's) falls off as the flame's, which has no AA of its own: only where that falloff is
    // narrower than a footprint does it widen to one (fa). The base and tip keep the image's AA.
    float slateFlameM = step(.01, slateFlame.x)*(1.0-smoothstep(${glsl(0.3 * MF.width)}*fw-fa*.6, ${glsl(MF.width)}*fw+fa*.6, fx))*smoothstep(-.08-slateAA.y/fh, -.04+slateAA.y/fh, fu)*(1.0-smoothstep(.96-slateAA.y/fh, 1.0+slateAA.y/fh, fu));
    float slateLit = smoothstep(.05, .2, fu), slateCore = (1.0-smoothstep(0.0, .6, fq))*smoothstep(.14, .34, fu)*(1.0-smoothstep(.44, .74, fu));
    float slateCone = (1.0-smoothstep(.2, .7, fq/max(.001, 1.0-fu/.34)))*smoothstep(-.04, .02, fu)*(1.0-smoothstep(.2, .36, fu));
    vec2 slateHalo = vec2(slateLX/${glsl(G.halo[1])}, (ly-${glsl(F.base)}-${glsl(G.halo[2])}*fh)/(${glsl(G.halo[3])}*fh)), slateGlare = vec2(slateLX/${glsl(G.glare[1])}, (ly-${glsl(F.base)}-${glsl(G.glare[2])}*fh)/(${glsl(G.glare[3])}*fh));
    // Its light: the fire and its blue cup, and the glass's halo, fill and glare, as the frame shows the real flame (the
    // fire's gain clipped at white by the grade), kept in the ramp's hue and 1 at the core.
    vec3 slateFire = mix(mix(${glslVec(...C.body)}, ${glslVec(...C.tip)}, smoothstep(.45, .88, fu)), ${glslVec(...C.core)}, slateCore)*slateFlameM*slateLit*(.5+.5*smoothstep(.1, .38, fu))*(1.0-.5*slateCone)*(1.0-.6*smoothstep(.62, 1.0, fu))*smoothstep(.002, .016, fw)
      +${glslVec(...C.blue)}*.35*(1.0-slateLit)*(.35+.65*smoothstep(.2, .85, fq))*slateFlameM
      +(${glslVec(...G.warm)}*(${glsl(G.halo[0])}*exp(-1.6*dot(slateHalo, slateHalo))+${glsl(G.fill)})+${glslVec(...G.pale)}*${glsl(G.glare[0])}*exp(-dot(slateGlare, slateGlare)))*slateGlassM*step(.01, slateFlame.x)/${glsl(F.gain)};
    slateFlameW = slateFire/max(dot(slateFire, vec3(.2126, .7152, .0722)), 1e-5)*dot(min(slateFire*${glsl(F.gain)}, 1.0), vec3(.2126, .7152, .0722))/${glsl(FLAME_WHITE)};
    // Still water mirrors alike at any depth: only the shore and dry islands cut the image.
    float slateSharp = smoothstep(0.0, .04, slateLevel)*slateDeep;
    slateMirror = mix(slateSkyW, mix(slateCageC, slateGlassC, slateGlassM), slateCageM*slateSharp);
    slateFlameW *= slateSharp*(1.0-${glsl(LANTERN_GLINT.image)}*slateRough);
    slateFlamePk = ${glsl(FLAME_PEAK)}*slateLampY;
    }
  }
  // Water Fresnel, then a soft luminance knee that keeps the hue. The flame's image comes after it, at the knee's share of
  // the flame's peak (its core at the lamp's light) over the rest: as bright as the knee lets the flame be, without its flattening.
  vec3 slateRefl = slateMirror*slateF;
  float slateY = dot(slateRefl, vec3(.2126, .7152, .0722)), slateKnee = ${glsl(M.knee)}*(1.0-exp(-slateY/${glsl(M.knee)}));
  slateRefl *= slateKnee/max(slateY, 1e-5);
  slateRefl += slateFlameW*(${glsl(M.knee)}*(1.0-exp(-(slateY+slateFlamePk*slateF)/${glsl(M.knee)}))-slateKnee);
  // The flame's glints: each ripple face turned to throw its light toward the eye (LANTERN_GLINT), a column of
  // broken glints below the lantern on the moving water (off the level plane the image takes, slateP); finer than
  // the pixel, wider and dimmer.
  if (slateRough > 0.0 && dot(slateLamp, slateLamp) > 0.0) {
    vec3 slateLD = slateLampW-slateP;
    float slateLL = max(length(slateLD), .01), slateA0 = ${glsl(LANTERN_GLINT.size)}/slateLL, slateA2 = slateA0*slateA0+${glsl(+(2 * LANTERN_GLINT.slope * LANTERN_GLINT.slope).toFixed(5))}*(1.0-slateGR);
    float slateGC = dot(reflect(-slateV, slateNG), slateLD/slateLL), slateGF = ${glsl(M.f0)}+${glsl(1 - M.f0)}*pow(1.0-saturate(dot(slateNG, slateV)), 5.0);
    slateRefl += slateLamp*${glsl(LANTERN_GLINT.gain)}*slateGF*sqrt(slateA0*slateA0/slateA2)*exp(-(1.0-slateGC)/slateA2)*slateRough*slateDeep;
  }
  reflectedLight.directDiffuse *= 1.0-slateF*slateWater;
  reflectedLight.indirectDiffuse *= 1.0-slateF*slateWater;
  reflectedLight.directSpecular *= mix(1.0, ${glsl(M.ggxKeep)}, slateLanternPuddle);
  vec3 slateZoneRefl = slateRefl*slateWater;
  // Behind the text it passes the ground's text knee (mud-ground.js slateTextKnee()).
  reflectedLight.indirectSpecular += slateTextKnee(slateZoneRefl, slateBehind);
}
#endif
`;
// The stream's water body and white water. As it deepens its water hides the
// cracks under silt and darkens (STREAMS.body), easing into the river's own
// water where it leaves it. Its white water (STREAMS.foam) is a lace of bubble
// rafts drifting down it with the current, in clumps where it churns: most
// about its stones and where it leaves the river. It is rough, pale
// froth lit like the soil, not water: the mirror and the water's gloss give
// way to it.
const SF = STREAMS.foam;
const SB = STREAMS.body;
// The white water about the stream's stones: a ring hugging each at the
// waterline and a wake trailing downstream (toward its head: it flows that
// way, STREAMS.flow), widening as it goes, that raises the churn of the lace (STREAMS.stones).
const ST = STREAMS.stones;
const STONE_FOAM = ST.list
  .map(([dx, dz, height]) => {
    const r = +(ST.radius * height).toFixed(3),
      c = glslVec(+(LANTERN_FOOT.x + dx).toFixed(3), +(LANTERN_FOOT.z + dz).toFixed(3));
    return `slateSO = vMudWorld.xz-${c};slateSD = length(slateSO)-${glsl(r)};
if (slateSD < ${glsl(ST.wake)}) {
  float slateSA = ${STREAMS.flow < 0 ? "-" : ""}dot(slateSO, slateStreamDir), slateSX = abs(slateSO.x*slateStreamDir.y-slateSO.y*slateStreamDir.x);
  slateRing = max(slateRing, 1.0-smoothstep(0.0, ${glsl(ST.ring)}, slateSD));
  slateStone = max(slateStone, step(0.0, slateSA)*(1.0-smoothstep(0.0, ${glsl(ST.wake)}, slateSA))*(1.0-smoothstep(${glsl(+(r * 0.5).toFixed(3))}+slateSA*${glsl(ST.spread)}, ${glsl(r)}+slateSA*${glsl(ST.spread)}, slateSX)));
}`;
  })
  .join("\n");
const STREAM_FOAM = `float slateFoam = 0.0;
float slateStreamBody = smoothstep(0.0, ${glsl(SB.deep)}, slateLevel)*(1.0-smoothstep(.9, 1.05, slateStreamR))*(vSlateRiverSurface.x > .5 ? slateCapStream : smoothstep(.7, 1.1, slateRiverR))*slatePuddle;
diffuseColor.rgb = mix(diffuseColor.rgb, ${glslVec(...SB.silt)}, ${glsl(SB.calm)}*slateStreamBody)*(1.0-${glsl(SB.darken)}*slateStreamBody);
if (slateStreamQ.x > 0.0) {
  vec2 slateSU = vec2(slateStreamQ.y-slateFlow*${glsl(STREAMS.flow * SF.drift)}, slateStreamQ.z*slateStreamQ.w), slateSF = slateSU*${glslVec(...SF.cell)};
  float slateSN = .6*slateNoise(slateSF)+.4*slateNoise(slateSF*2.2+11.0);
  vec2 slateSO;
  float slateSD, slateRing = 0.0, slateStone = 0.0;
  ${STONE_FOAM}
  float slateChurn = max(${glsl(SF.amount)}, max(${glsl(SF.join)}*smoothstep(.2, .8, slateStreamJoin), ${glsl(SF.mouth)}*smoothstep(${glsl(SF.reach[0] - 0.3)}, ${glsl(SF.reach[0])}, slateRiverR)*(1.0-smoothstep(${glsl(SF.reach[0])}, ${glsl(SF.reach[1])}, slateRiverR))))*(.2+1.6*slateNoise(slateSU*${glslVec(...SF.patch)}+23.0));
  slateChurn = max(slateChurn, slateStone*(.5+.5*slateNoise(slateSU*${glslVec(...SF.patch)}*2.0+5.0)));
  // The lace: the borders of cells drifting with the current, thicker and closer where it churns. Where its cells fall
  // under about two pixels it gives way to a faint share of its churn, so it never aliases nor washes a far stream
  // pale; out in the river the plume thins as it spreads (SF.plume of it toward the river's middle).
  vec2 slateLC = slateSU*${glslVec(...SF.lace)};
  slateLC += ${glsl(SF.warp)}*vec2(slateNoise(slateLC*.45+3.0), slateNoise(slateLC*.45+9.0))*2.0;
  vec2 slateLI = floor(slateLC), slateLF = fract(slateLC);
  float slateF1 = 8.0, slateF2 = 8.0;
  for (int j = -1; j <= slateLoop; j++) for (int i = -1; i <= slateLoop; i++) {
    vec2 slateLG = vec2(float(i), float(j)), slateLO = slateLG+vec2(slateHash(slateLI+slateLG), slateHash(slateLI+slateLG+17.3))*.8+.1-slateLF;
    float slateLD = dot(slateLO, slateLO);
    if (slateLD < slateF1) { slateF2 = slateF1; slateF1 = slateLD; } else if (slateLD < slateF2) slateF2 = slateLD;
  }
  float slateLW = length(fwidth(slateLC)), slateLace = (1.0-smoothstep(0.0, mix(${glsl(SF.edge[0])}, ${glsl(SF.edge[1])}, slateChurn)+slateLW, sqrt(slateF2)-sqrt(slateF1)))*smoothstep(${glsl(SF.clump[0])}, ${glsl(SF.clump[1])}, slateChurn)*smoothstep(.35, .65, slateNoise(slateLC*${glsl(+(1 / SF.broken).toFixed(3))}+41.0));
  slateFoam = mix(slateLace, ${glsl(SF.far)}*slateChurn, clamp(slateLW*2.0-1.0, 0.0, 1.0))*${glsl(SF.cover)}*smoothstep(.45, .95, slateStreamQ.x)*slatePuddle;
  slateFoam = max(slateFoam, ${glsl(SF.cover * 0.6)}*slateRing*smoothstep(.35, .75, slateSN));
  slateFoam *= mix(${glsl(SF.plume)}, 1.0, slateShoal)*mix(1.0, ${glsl(STREAMS.calm.foam)}, slateStreamCalm);
  // Lit froth is diffuse, past the reflections' text knee: behind the text it thins (mud-ground.js slateBehindText()).
  slateFoam *= 1.0-${glsl(SF.text)}*slateBehindText();
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${glsl(SF.albedo)}), slateFoam);
${
  RAPIDS_AT
    ? `// The rapids (ocean.js RAPIDS): over its last units the river quickens toward the falls, its
// streaks, standing waves and white water (the falls' run takes the same, so they meet at the
// shelf's edge). Near the lip in the falls' straight frame, farther up along its own course; only
// on its last stretch. The froth thins behind the text.
vec2 slateRpU = slateRpUQ(vMudWorld.xz);
vec2 slateRpWorld = slateRpU;
float slateRpBlend = 0.0;
if (slateCoastStudy > .5) slateRpBlend = 1.0-smoothstep(3.0, 8.0, slateRpRA(slateRpWorld));
slateRpU = mix(slateRpU, vec2(slateRiverQ.y-(${glsl(RAPIDS_AT.s)}), slateRiverQ.z), smoothstep(3.0, 8.0, slateRpU.x));
if (slateCoastStudy > .5) slateRpU = mix(slateRpU, slateRpWorld, slateRpBlend);
float slateRpA = slateRpRA(slateRpU), slateRpFP = max(length(fwidth(vMudWorld.xz)), 1e-4), slateRapid = 0.0;
float slateRpR = slateRiverR;
if (slateCoastStudy > .5) slateRpR = mix(slateRpR, abs(slateRpWorld.y)/${glsl(RAPIDS_AT.half)}, slateRpBlend);
float slateRpWt = slateRpW(slateRpA, slateRpR)*step(slateRiverQ.y-(${glsl(RAPIDS_AT.s)}), ${glsl(RAPIDS.reach + 8)});
vec4 slateRpP = vec4(0.0);
if (slateRpWt > 0.0) {
  slateRpP = slateRpRapids(slateRpU.y, slateRpA, slateRpR, slateFlow, slateRpFP)*step(slateRiverQ.y-(${glsl(RAPIDS_AT.s)}), ${glsl(RAPIDS.reach + 8)});
  slateRapid = slateRpP.z*slatePuddle*(1.0-${glsl(RAPIDS.text)}*slateBehindText());
  if (slateCoastStudy > .5) diffuseColor.rgb = mix(diffuseColor.rgb, ${glslVec(...RAPIDS_BODY)}, slateRpWt*slatePuddle);
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${glsl(RAPIDS.albedo)}), slateRapid);
slateFoam = max(slateFoam, slateRapid);
`
    : ""
}roughnessFactor = mix(roughnessFactor, .85, slateFoam);
slatePuddle *= 1.0-slateFoam;
slateLanternPuddle *= 1.0-slateFoam;
// The moving water softens the moon's shadow on it (mud-ground.js slateShadow()).
slateShadowWater = slateLanternPuddle;
`;
// The mirror's own drip clock (settleRoots() advances it), the live drip and
// the flame's draught (settleRoots() sets both per draw of the ground).
const RIPPLE_TIME = { value: DRIP_RIPPLES.start },
  DRIP = { value: [0, 0, 0, 0] },
  FLAME_DRAUGHT = { value: [0, 0, 0, 0] };

// The puddles' own edit list: all or nothing, independent of the root list
// (shadeSlateGround() applies it first; either may fail alone). Returns false,
// leaving the shader unchanged, if the slate program lacks an anchor.
export function shadeSlatePuddles(shader, coastStudy = { value: 0 }) {
  const edits = [
    [
      "vertexShader",
      "|#include <common>",
      "attribute vec2 slateRiverSurface;\nvarying vec2 vSlateRiverSurface;\n",
    ],
    ["vertexShader", "|#include <begin_vertex>", "vSlateRiverSurface=slateRiverSurface;\n"],
    ["fragmentShader", "|#include <common>", "varying vec2 vSlateRiverSurface;\n"],
    ["fragmentShader", "|#define STANDARD", PUDDLE_HEAD],
    // The continuous water level (depth above the detail map's floor).
    ["fragmentShader", "|float slatePuddle =", "float slateLevel;\n"],
    ["fragmentShader", "float slatePuddle = smoothstep(-.04, .04, |", "slateLevel="],
    // Only inside the puddle zones (slateZoneW: the level's zone term is
    // positive; beyond them nothing changes): a soft shore at least a couple
    // of pixels wide, a damp margin that follows the cracks, and the thin
    // film's coat. The water's sheet is all water; down the stream's channel
    // (slateCapStream: easing in as the water shoals across STREAMS.confluence)
    // it keeps the stream's own level and shading, as the stream's painted
    // water beside it, so no edge shows where the sheet ends.
    [
      "fragmentShader",
      "|float slateLanternPuddle =",
      `float slateShore = fwidth(slateLevel), slatePx = length(fwidth(normalize(vViewPosition))), slateZoneW = smoothstep(0.0, .04, slateLevel+slateH);
slatePuddle = mix(slatePuddle, smoothstep(${glsl(M.shore[0])}-slateShore, ${glsl(M.shore[1])}+slateShore, slateLevel)*(1.0-slateDry), slateZoneW);
float slateMargin = smoothstep(${glsl(M.margin[0])}-slateShore, ${glsl(M.margin[1])}, slateLevel)*(1.0-slateDry)*(1.0-slatePuddle)*slateZoneW, slateCoat = mix(1.0, smoothstep(0.0, ${glsl(M.coat)}, slateLevel), slateZoneW);
float slateCapStream=0.,slateShoal=1.;
if(vSlateRiverSurface.x>.5){slateShoal=1.-smoothstep(${STREAMS.confluence.map(glsl).join(",")},vSlateRiverSurface.y);slateCapStream=slateShoal*(1.-smoothstep(${STREAMS.bed.reach.map(glsl).join(",")},slateStreamR));slateDry=0.;slatePuddle=1.;slateLevel=mix(max(.06,vSlateRiverSurface.y),max(.06,slateLevel),slateCapStream);slateZoneW=1.;slateCoat=1.;slateMargin=0.;}
`,
    ],
    [
      "fragmentShader",
      "slateWet = max(slateWet, slatePuddle);|",
      "\nslateWet = max(slateWet, slateMargin);",
    ],
    // The thin film at the shore keeps wet-soil roughness; the water smooths as it deepens.
    [
      "fragmentShader",
      "|roughnessFactor = mix(mix(roughnessFactor,",
      "float slateBody = slatePuddle, slateBodyL = slateLanternPuddle;\nslatePuddle *= slateCoat;\nslateLanternPuddle *= slateCoat;\n",
    ],
    // Wet soil under clear water, not black: the pinned darkening from shallow to deep.
    [
      "fragmentShader",
      "|diffuseColor.rgb *= (1.0 -",
      `slatePuddle = slateBody*mix(1.0, mix(${glsl(M.darken[0])}, ${glsl(M.darken[1])}, smoothstep(0.0, .3, slateLevel)), slateZoneW);\n`,
    ],
    [
      "fragmentShader",
      "|float slateAo =",
      `slatePuddle = slateBody;
slateLanternPuddle = slateBodyL;
diffuseColor.rgb *= 1.0-${glsl(M.marginAlbedo)}*slateMargin;
if(vSlateRiverSurface.x>.5){
vec3 slateStreamC=diffuseColor.rgb;float slateStreamRF=roughnessFactor;
float riverDepth=max(0.,vSlateRiverSurface.y);vec3 riverClear=exp(-riverDepth*${glslVec(...RIVER_CHANNEL.absorb)});
vec2 riverUV=vec2(slateRiverQ.y+slateFlow*${glsl(RIVER_CHANNEL.speed)},slateRiverQ.z);
float riverCurrent=slateNoise(riverUV*vec2(.8,2.7))*.65+slateNoise(riverUV*vec2(1.9,5.1)+19.)*.35;
float riverFP=max(.001,length(fwidth(vMudWorld.xz))),riverAA=1.-smoothstep(.18,.6,riverFP);
float riverCrest=smoothstep(.56,.79,riverCurrent)*smoothstep(.3,.7,slateNoise(riverUV*vec2(.23,6.8)+7.))*riverAA;
float riverBank=smoothstep(.7,1.,slateRiverR)*smoothstep(.36,.74,riverCurrent)*.24;
diffuseColor.rgb=mix(vec3(.016,.035,.037),diffuseColor.rgb*.32,riverClear)*(1.+.48*(riverCurrent-.5));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.19,.23,.23),max(riverBank,riverCrest*.2));
roughnessFactor=.13+.045*riverCurrent;
diffuseColor.rgb=mix(diffuseColor.rgb,slateStreamC,slateCapStream);roughnessFactor=mix(roughnessFactor,slateStreamRF,slateCapStream);
}
${STREAM_FOAM}`,
    ],
    // In the zone's water, the water film's and the puddles' sky mirror give way to the zone's own.
    [
      "fragmentShader",
      "|vec3 slateWaterRefl =",
      "slateWaterCover *= 1.0-slatePuddle*slateZoneW;\n",
    ],
    ["fragmentShader", "|#include <aomap_fragment>", MIRROR],
    [
      "fragmentShader",
      "|#include <clearcoat_normal_fragment_begin>",
      "if(vSlateRiverSurface.x>.5)normal=normalize(mat3(viewMatrix)*vec3(0.,1.,0.));\n",
    ],
  ];
  if (!applyEdits(shader, edits)) return false;
  shader.uniforms.slateDrip = DRIP;
  shader.uniforms.slateFlow = RIPPLE_TIME;
  shader.uniforms.slateCoastStudy = coastStudy;
  shader.uniforms.slateFlame = FLAME_DRAUGHT;
  return true;
}

// The hook settleRoots() sets as the ground material's userData.slateRoot
// (mud-ground.js applies it last under the "+root" key): the puddle mirror,
// then the root shading, each all or nothing on its own.
// The shelf's bedrock: full within `near` of the fault and gone by `far`,
// its edge moved up to `wobble` by a `cell` noise. second, blendCell: a
// second lookup of the coast's albedo and detail maps,
// `scale` times as large, turned (a 7-24-25 turn) and offset, blended in by a
// `blendCell` noise, so the shelf's rock never shows the tile repeat; relief:
// how far the detail map tilts its normal. The worn shelf keeps a shallower
// relief than the freshly exposed cliff so its pits never read as raised rims.
export const COAST_BEDROCK = Object.freeze({
  near: 2,
  far: 18,
  wobble: 4,
  cell: 11,
  second: Object.freeze({
    scale: 0.83,
    turn: Object.freeze([0.28, 0.96, -0.96, 0.28]),
    offset: Object.freeze([0.41, 0.17]),
  }),
  blendCell: 2.6,
  relief: 0.26,
});

// The eroded shelf is the same rock as the face, with its colour and its
// pitted, worn stone (the cliff's own maps, lent when they land), never the
// soil's relief. Soil returns gradually inland along irregular pockets rather
// than a straight strip at the rim.
export function coastBedrockWeight(x, z) {
  const d = Math.max(0, coastDistance(x, z));
  return (
    1 -
    ease(
      COAST_BEDROCK.near,
      COAST_BEDROCK.far,
      d + (slateNoise(x / COAST_BEDROCK.cell, z / COAST_BEDROCK.cell) - 0.5) * COAST_BEDROCK.wobble,
    )
  );
}

// The plain's mud (the owner's picks of 2026-10-27: "smooth and minimal", "a more muted
// ground", "keep the ground color the sort of tan it looks like in artistic", and "a little
// browner, like a brown pastel", then "a little browner too"): a soft, warm brown mud over the slate, keeping only its broad variation (`tone` linear, `amount` over the
// slate's own colour); its relief flattens by `flat` in mud-ground.js, and its film, gloss
// and puddles mirror the sky as before.
export const PLAIN_MUD = Object.freeze({
  tone: Object.freeze([0.1, 0.066, 0.04]),
  amount: 0.9,
  flat: 0.8,
});
// The coast's bedrock (2026-10-27, "near the falls is more bedrock"): its band runs `band`
// [near, far] in from the fault, wider than the coast maps' own, and wherever the maps are
// not on it is dark layered stone: beds along the fault (`bed` apart), each its own tone
// about `tone`, crossed by two sets of joints. It keeps `film` less of the plain's wet
// film and is `rough` and `dry` (mud-ground.js, by the SLATE_ROCK_* defines). The cliff
// shelf is drawn in the cliff's own stone (ocean.js CLIFF_STONE).
export const COAST_ROCK = Object.freeze({
  band: Object.freeze([10, 40]),
  tone: Object.freeze([0.07, 0.065, 0.062]),
  bed: 1.6,
  film: 0.85,
  rough: 0.9,
  dry: 0.8,
});
const PLAIN_MUD_GLSL = `
{float mudBroad=slateNoise(vMudWorld.xz/23.), mudPatch=slateNoise(vMudWorld.xz/6.3);
vec3 mudCol=${glslVec(...PLAIN_MUD.tone)}*(.86+.24*mudBroad)*(.93+.1*mudPatch);
diffuseColor.rgb=mix(diffuseColor.rgb,mudCol,(1.-slateBedrock)*${glsl(PLAIN_MUD.amount)});}
`;

export function shadeCoastBedrock(shader, uniforms) {
  const edits = [
    [
      "fragmentShader",
      "|#define STANDARD",
      `uniform sampler2D coastAlbedo, coastDetail;\nuniform float coastAlbedoOn, coastDetailOn;\n#define SLATE_MUD_FLAT ${glsl(PLAIN_MUD.flat)}\n#define SLATE_ROCK_FILM ${glsl(COAST_ROCK.film)}\n#define SLATE_ROCK_ROUGH ${glsl(COAST_ROCK.rough)}\n#define SLATE_ROCK_DRY ${glsl(COAST_ROCK.dry)}\n`,
    ],
    [
      "fragmentShader",
      "diffuseColor *= sampledDiffuseColor;|",
      `
float slateBedrock = 0.;
vec3 slateRockXY = vec3(0.);
// The rock's own tone (and below, its scans) only where it lies: elsewhere slateBedrock is 0.
{float rockEdge=max(0.,seaCoast(vMudWorld.xz))+(slateNoise(vMudWorld.xz/${glsl(COAST_BEDROCK.cell)})-.5)*${glsl(COAST_BEDROCK.wobble)};
slateBedrock=1.-smoothstep(${glsl(COAST_ROCK.band[0])},${glsl(COAST_ROCK.band[1])},rockEdge);
if(slateBedrock>0.){
float rockC=seaCoast(vMudWorld.xz)+(slateNoise(vMudWorld.xz/7.)-.5)*3.;
float rockBed=floor(rockC/${glsl(COAST_ROCK.bed)}), rockStrata=fract(sin(rockBed*12.9898)*43758.5453);
float rockBedEdge=1.-smoothstep(.0,.12,min(fract(rockC/${glsl(COAST_ROCK.bed)}),1.-fract(rockC/${glsl(COAST_ROCK.bed)})));
vec2 rockJ=vMudWorld.xz+(vec2(slateNoise(vMudWorld.xz/3.),slateNoise(vMudWorld.xz/3.+7.))-.5)*1.4;
float rockJoint=max(1.-smoothstep(.0,.07,abs(fract(dot(rockJ,vec2(.6,.8))/3.1)-.5)*2.),1.-smoothstep(.0,.06,abs(fract(dot(rockJ,vec2(-.8,.6))/4.7)-.5)*2.));
vec3 rockTone=${glslVec(...COAST_ROCK.tone)}*(.6+.9*rockStrata)*(1.-.7*max(rockJoint,rockBedEdge*.8))*(.8+.4*slateNoise(vMudWorld.xz/1.1));
diffuseColor.rgb=mix(diffuseColor.rgb,rockTone,slateBedrock);}}
if(coastAlbedoOn>.5||coastDetailOn>.5){
if(slateBedrock>0.){
// Both lookups (the cliff's tops use the first alone), blended by a noise.
vec2 rockU=vMudWorld.xz/${glsl(COAST_ALBEDO.tile)},rockV=mat2(${COAST_BEDROCK.second.turn.map(glsl)})*rockU*${glsl(COAST_BEDROCK.second.scale)}+${glslVec(...COAST_BEDROCK.second.offset)};
float rockW=smoothstep(.3,.7,slateNoise(vMudWorld.xz/${glsl(COAST_BEDROCK.blendCell)}));
if(coastAlbedoOn>.5){
vec3 rockScan=clamp(mix(texture2D(coastAlbedo,rockU).rgb,texture2D(coastAlbedo,rockV).rgb,rockW)/${glslVec(...COAST_ALBEDO.mean)},vec3(.5),vec3(1.8));
vec3 rockColour=vec3(.17,.1525,.1465)*mix(vec3(1.),rockScan,.6);
diffuseColor.rgb=mix(diffuseColor.rgb,rockColour,slateBedrock*.9);
}
if(coastDetailOn>.5){
// The second lookup's slope turned back into world x/z; the relief fades as a texel shrinks, as on the cliff.
vec2 rockPx=fwidth(vMudWorld.xz);
slateRockXY=vec3(mix(texture2D(coastDetail,rockU).rg*2.-1.,(texture2D(coastDetail,rockV).rg*2.-1.)*mat2(${COAST_BEDROCK.second.turn.map(glsl)}),rockW),
(1.-smoothstep(.06,.24,max(rockPx.x,rockPx.y)))*${glsl(COAST_BEDROCK.relief)});
}}}${PLAIN_MUD_GLSL}
#ifdef SLATE_CLOSE_SOIL
slateSoilMask=1.-slateBedrock;
#endif
`,
    ],
    [
      "fragmentShader",
      "|#include <clearcoat_normal_fragment_begin>",
      // The rock keeps none of the soil's relief; its own detail (world x and z
      // on the shelf's tangent plane) tilts it as the cliff's tops are tilted.
      `if(slateBedrock>0.){
if(coastDetailOn>.5){
vec3 rockT=mat3(viewMatrix)*vec3(1.,0.,0.);rockT=normalize(rockT-nonPerturbedNormal*dot(nonPerturbedNormal,rockT));
vec3 rockB=cross(rockT,nonPerturbedNormal);
float rockR=slateRockXY.z;
normal=normalize(mix(normal,nonPerturbedNormal*sqrt(max(.15,1.-dot(slateRockXY.xy,slateRockXY.xy)*rockR*rockR))+(rockT*slateRockXY.x+rockB*slateRockXY.y)*rockR,slateBedrock));
}else normal=normalize(mix(normal,nonPerturbedNormal,slateBedrock*.8));}
`,
    ],
  ];
  if (!applyEdits(shader, edits)) return false;
  Object.assign(shader.uniforms, uniforms);
  return true;
}

export function shadeSlateGround(
  shader,
  coastRock = {
    coastAlbedo: { value: null },
    coastAlbedoOn: { value: 0 },
    coastDetail: { value: null },
    coastDetailOn: { value: 0 },
  },
) {
  const puddles = shadeSlatePuddles(shader, coastRock.coastStudy);
  // The fault (ocean.js): its distance.
  const shore = applyEdits(shader, slateShoreEdits());
  if (shore) shadeCoastBedrock(shader, coastRock);
  return { puddles, shore, roots: shadeSlateRoots(shader) };
}

// The drips' clock: it advances by each drawn frame's time, at most 0.1 s,
// only while the scene animates (never under reduced motion or a visitor
// pause: the flame's own holds), and starts in a calm gap. A gap
// of a quarter second or more between drawn frames (a hold just ended, a
// hidden page, a lost context) adds nothing, so nothing jumps on resuming.
export function dripClock(uniform = RIPPLE_TIME, held = () => false) {
  let last = null;
  return {
    uniform,
    tick(now) {
      if (last !== null && !held() && now - last < 250)
        uniform.value += Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      return uniform.value;
    },
    reset() {
      last = null;
      uniform.value = DRIP_RIPPLES.start;
    },
  };
}
// Where an eye at `eye` (world) sees the lantern's light `light` mirrored in
// the water (the level plane the mirror reflects from), as [x, z], or null.
export function mirrorPoint(eye, light) {
  const water = light.y - LAMP_FOOT + PUDDLE_MIRROR.water,
    image = 2 * water - light.y;
  if (!(eye.y > water + 0.05)) return null;
  const t = (eye.y - water) / (eye.y - image);
  return [eye.x + (light.x - eye.x) * t, eye.z + (light.z - eye.z) * t];
}
// The same holds index.js passes the flame: reduced motion and a visitor
// pause (scene.isVisitorPaused()).
function motionHeld() {
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  return () => Boolean(reduced?.matches || globalThis.BabelSite?.scene?.isVisitorPaused?.());
}

// Each film terrain's root lift at a world x/z, interpolated over the rendered
// root grid (0 beyond it), and its rendered height there (NaN beyond it).
const LIFTS = new WeakMap(),
  SURFACES = new WeakMap();
export function terrainLift(geometry) {
  return LIFTS.get(geometry) ?? (() => 0);
}
export function terrainHeight(geometry) {
  return SURFACES.get(geometry) ?? (() => NaN);
}

// A value as rendered: linear over the same triangles (diagonal b-d) as the
// fine root grid, cols x rows cells of pitch from left/top, where every lifted
// vertex lies (outside beyond it). It keeps only that grid's values (row by
// row), none of the build's working arrays.
function liftSampler(lifts, left, top, cols, rows, pitch, outside = 0) {
  return (x, z) => {
    const u = (x - left) / pitch,
      v = (z - top) / pitch,
      col = Math.floor(u),
      row = Math.floor(v);
    if (!(col >= 0 && row >= 0 && col < cols && row < rows)) return outside;
    const fx = u - col,
      fz = v - row,
      at = (i, j) => lifts[(row + j) * (cols + 1) + col + i];
    return fx + fz <= 1
      ? at(0, 0) + (at(1, 0) - at(0, 0)) * fx + (at(0, 1) - at(0, 0)) * fz
      : at(1, 1) + (at(0, 1) - at(1, 1)) * (1 - fx) + (at(1, 0) - at(1, 1)) * (1 - fz);
  };
}

const nextFrame = (task) =>
  (globalThis.requestAnimationFrame ?? ((next) => setTimeout(next, 16)))(task);

// Whether the canvas is fading in over the title card (styles.css, timed from the
// reveal's babel:reveal mark), or, unless hidden is false, still hidden.
function fading(rendering, hidden = true) {
  let fadeEnd = null;
  return () => {
    const container = rendering?.renderer?.domElement?.parentNode;
    if (!container?.classList?.contains("is-ready")) return hidden;
    if (fadeEnd === null) {
      const duration = globalThis.getComputedStyle?.(container)?.transitionDuration ?? "0s";
      fadeEnd =
        (performance.getEntriesByName?.("babel:reveal", "mark").at(-1)?.startTime ?? -Infinity) +
        (parseFloat(duration) * (/ms/.test(duration) ? 1 : 1000) || 0);
    }
    return performance.now() < fadeEnd;
  };
}
// Whether a change to the ground can land now without showing mid-shot: before
// the reveal or during the canvas's fade-in over the title card, on a tour cut
// under the dissolve's kept frame, while the tour waits on a shot's last frame for
// this very ground (The watch, which shows none; index.js GROUND_WAIT_S), or on
// any frame while the tour is not running.
function unseen(rendering, tour) {
  const early = fading(rendering);
  return () => !tour?.running || tour.transition.cut || tour.waiting === true || early();
}
// Whether the canvas is still hidden or within `ms` of the reveal, early in
// its fade-in, while it is still mostly transparent over the title card.
function earlyFade(rendering, ms) {
  let revealed = null;
  return () => {
    const container = rendering?.renderer?.domElement?.parentNode;
    if (!container?.classList?.contains("is-ready")) return true;
    revealed ??=
      performance.getEntriesByName?.("babel:reveal", "mark").at(-1)?.startTime ?? -Infinity;
    return performance.now() < revealed + ms;
  };
}
// The ground's shading switch is unseen only in the first SHADING_EARLY ms of
// the fade-in (the canvas under half opaque): later in the fade it showed as
// a pop on shots that open at the tree.
export const SHADING_EARLY = 150;
// How long the shaded program's link is waited on before the switch's draw takes what
// remains of it: past its slowest measured compile on an integrated GPU (about 5 s), and
// inside the tour's hold for the ground (index.js GROUND_WAIT_S).
export const LINK_WAIT_MS = 12000;

// The estate tufts (estate-ground-detail.js) on the film terrain: a blade
// where a root covers the soil, in the trunk's deep cavity (sky occlusion
// over TUFTS.cull) or in the stream's water collapses to a point under the ground; the rest rise and
// fall with the knoll, its relief and the lips, and those in the tree's shade
// darken.
export const TUFTS = Object.freeze({ cull: 0.6, shade: 0.75 });
function settleTufts(growth, liftAt) {
  const p = growth.geometry.attributes.position,
    color = growth.geometry.attributes.color,
    grass = growth.geometry.attributes.aGrass,
    stride = growth.geometry.userData.bladeVertices ?? 4;
  let culled = 0;
  // `stride` vertices per blade; the first two straddle its foot.
  for (let i = 0; i + stride - 1 < p.count; i += stride) {
    const x = (p.getX(i) + p.getX(i + 1)) / 2,
      z = (p.getZ(i) + p.getZ(i + 1)) / 2,
      lift = liftAt(x, z);
    const [sky] = rootOcclusion(x, z);
    if (rootCovered(x, z) || sky > TUFTS.cull || streamRadius(x, z) < 1.02) {
      const y = (p.getY(i) + p.getY(i + 1)) / 2 + lift - 0.05;
      for (let k = i; k < i + stride; k++) {
        p.setXYZ(k, x, y, z);
        grass?.setX(k, 0);
      }
      culled++;
      continue;
    }
    if (lift) for (let k = i; k < i + stride; k++) p.setY(k, p.getY(k) + lift);
    if (color && sky > 0.02)
      for (let k = i; k < i + stride; k++)
        color.setXYZ(
          k,
          color.getX(k) * (1 - TUFTS.shade * sky),
          color.getY(k) * (1 - TUFTS.shade * sky),
          color.getZ(k) * (1 - TUFTS.shade * sky),
        );
  }
  p.needsUpdate = true;
  if (color) color.needsUpdate = true;
  if (grass) grass.needsUpdate = true;
  growth.geometry.computeBoundingSphere();
  return culled;
}

// Sparse dark litter in the root crooks: pebbles (flattened octahedra), bark
// flakes (bent quads) and a few twigs (tapering, kinked prisms, never under
// 0.04 wide), seeded beside the roots, in their shade, clear of the lantern,
// the puddles, the roots themselves and the open ground. Its colours follow the
// ground's albedo (the slate tile's mean, about 0.23 of the ground colour), so
// it reads dark. One draw with the tufts' material.
export const LITTER = Object.freeze({
  count: 50,
  twigs: 16,
  twigChance: 0.3,
  seed: 40127,
  pebbleShare: 0.62,
  beside: Object.freeze([0.05, 0.75]),
  near: Object.freeze([0.12, 0.85]),
  sky: Object.freeze([0.12, 0.9]),
  lantern: 2.2,
  puddle: 0.5,
  spacing: 0.22,
  shade: 0.5,
  albedo: 0.23,
  pebble: Object.freeze([0.035, 0.1]),
  flake: Object.freeze([0.1, 0.28]),
  twig: Object.freeze([0.45, 1.05]),
  twigWidth: Object.freeze([0.055, 0.075]),
  minWidth: 0.04,
  tone: Object.freeze({ pebble: Object.freeze([0.3, 0.5]), flake: 0.28, twig: 0.34 }),
  // Small stones among the roots and about the trunk's base: rounded, a cool
  // grey `tone` times the soil's mean (they catch the light the dark slate
  // swallows), `size` wide, sunk `sink` of their height, their bumps eased
  // smoothly over them (`round`: the falloff's sharpness between the 42
  // points that carry them).
  // Most lie beside a resting root (`beside` beyond its half-width); the rest
  // in the crooks `crook` from the trunk, within `among` of a root. Never
  // under a root or an arch, nor at the lantern or a puddle.
  stones: Object.freeze({
    count: 40,
    seed: 52817,
    rootShare: 0.6,
    size: Object.freeze([0.12, 0.3]),
    height: Object.freeze([0.5, 0.75]),
    sink: Object.freeze([0.3, 0.5]),
    beside: Object.freeze([0.1, 0.55]),
    crook: Object.freeze([2.6, 6]),
    among: 1.4,
    spacing: 0.5,
    tone: Object.freeze([1.1, 2.3]),
    tint: Object.freeze([0.94, 1, 1.1]),
    round: 12,
  }),
  // The fine pieces on their own seed, after the stones: fallen leaves (curled,
  // cupped ovals, `leafSize` long, dull brown `leafTone` rgb, darker in the
  // shade), soil clods (flattened lumps, `clodTone` times the litter's base)
  // and grit (tiny flattened octahedra, `gravelTone` times its grey, a few
  // `pale` ones lighter). They lie in the tree shots' foreground: `arc` degrees
  // about the tree (atan2(z, x)), `reach` units out, on the soil (never under a
  // root, at the lantern's foot or in the water). Leaves keep near the roots
  // (`leafNear`: acceptance in the open). Balanced draws GROWTH.balanced of
  // them (estate-ground-detail.js).
  fine: Object.freeze({
    seed: 61331,
    counts: Object.freeze({ leaves: 220, clods: 200, gravel: 2000 }),
    arc: Object.freeze([-175, -55]),
    reach: Object.freeze([2, 16]),
    lantern: 0.45,
    puddle: 0.15,
    leafNear: 0.45,
    leafSize: Object.freeze([0.12, 0.22]),
    leafTone: Object.freeze([0.17, 0.14, 0.1]),
    clod: Object.freeze([0.035, 0.09]),
    clodTone: Object.freeze([0.85, 1.3]),
    grit: Object.freeze([0.012, 0.036]),
    gravelTone: Object.freeze([0.5, 1.3]),
    pale: Object.freeze([0.03, 1.8]),
  }),
});
// A unit icosphere, the stones' shape: two subdivisions (162 vertices, 320
// faces); its first 42 vertices are the once-subdivided sphere's, which carry
// each stone's bumps (LITTER.stones.round).
const ICOSPHERE = (() => {
  const t = (1 + Math.sqrt(5)) / 2,
    vertices = [
      [-1, t, 0],
      [1, t, 0],
      [-1, -t, 0],
      [1, -t, 0],
      [0, -1, t],
      [0, 1, t],
      [0, -1, -t],
      [0, 1, -t],
      [t, 0, -1],
      [t, 0, 1],
      [-t, 0, -1],
      [-t, 0, 1],
    ].map((v) => v.map((c) => c / Math.hypot(...v)));
  const faces = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  const middle = new Map(),
    mid = (a, b) => {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      if (!middle.has(key)) {
        const m = vertices[a].map((c, k) => c + vertices[b][k]);
        vertices.push(m.map((c) => c / Math.hypot(...m)));
        middle.set(key, vertices.length - 1);
      }
      return middle.get(key);
    };
  const split = (list) =>
    list.flatMap(([a, b, c]) => {
      const ab = mid(a, b),
        bc = mid(b, c),
        ca = mid(c, a);
      return [
        [a, ab, ca],
        [b, bc, ab],
        [c, ca, bc],
        [ab, bc, ca],
      ];
    });
  const once = split(faces),
    bumps = vertices.length;
  return { vertices, faces: split(once), bumps };
})();
// Distance from x/z to the nearest root-covered cell, up to limit (Infinity beyond).
function coverDistance(x, z, limit) {
  let best = Infinity;
  const reach = Math.ceil(limit / 0.25);
  for (let i = -reach; i <= reach; i++)
    for (let j = -reach; j <= reach; j++) {
      const d = Math.hypot(i, j) * 0.25;
      if (d < best && d <= limit && rootCovered(x + i * 0.25, z + j * 0.25)) best = d;
    }
  return best;
}
function buildNow(steps) {
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

// Match r160's non-indexed normal calculation, including its Float32 write
// before normalization, but leave a scheduling point every few triangles.
function* litterNormals(geometry) {
  const position = geometry.attributes.position,
    normal = new BufferAttribute(new Float32Array(position.count * 3), 3),
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    cb = new Vector3(),
    ab = new Vector3();
  geometry.setAttribute("normal", normal);
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    cb.subVectors(c, b);
    ab.subVectors(a, b);
    cb.cross(ab);
    for (let k = 0; k < 3; k++) normal.setXYZ(i + k, cb.x, cb.y, cb.z);
    if (i % 1536 === 0) yield;
  }
  for (let i = 0; i < position.count; i++) {
    a.fromBufferAttribute(normal, i).normalize();
    normal.setXYZ(i, a.x, a.y, a.z);
    if (i % 2048 === 0) yield;
  }
  normal.needsUpdate = true;
}

function* geometryBounds(geometry, keepBox = false) {
  const position = geometry.attributes.position,
    box = new Box3(),
    point = new Vector3(),
    sphere = new Sphere();
  for (let i = 0; i < position.count; i++) {
    box.expandByPoint(point.fromBufferAttribute(position, i));
    if (i % 2048 === 0) yield;
  }
  box.getCenter(sphere.center);
  let radiusSq = 0;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    radiusSq = Math.max(radiusSq, sphere.center.distanceToSquared(point));
    if (i % 2048 === 0) yield;
  }
  sphere.radius = Math.sqrt(radiusSq);
  if (keepBox) geometry.boundingBox = box;
  geometry.boundingSphere = sphere;
}

function* litterAttribute(values, size) {
  const array = new Float32Array(values.length);
  for (let start = 0; start < values.length; start += 8192) {
    for (let i = start, end = Math.min(values.length, start + 8192); i < end; i++)
      array[i] = values[i];
    yield;
  }
  return new BufferAttribute(array, size);
}

export function scatterLitter(surface, groundColor) {
  return buildNow(litterSteps(surface, groundColor));
}

function* litterSteps(surface, groundColor) {
  let seed = LITTER.seed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const L = LITTER,
    positions = [],
    colors = [],
    placed = [];
  const base = [groundColor.r, groundColor.g, groundColor.b].map((value) => value * L.albedo);
  const tone = (k, warm) => [
    base[0] * k * (1 + 0.1 * warm),
    base[1] * k,
    base[2] * k * (1 - 0.15 * warm),
  ];
  // `normals` (one per corner) keeps a piece smooth-shaded; without them its
  // faces take their own flat normals. `color` is one rgb or one per corner.
  // Thousands of pieces go through here as the roots settle, under the reveal's
  // fade-in: plain pushes, and `smooth` as flat (first vertex, normals) pairs.
  const smooth = [];
  const triangle = (a, b, c, color, normals = null) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    if (Array.isArray(color[0])) {
      const [p, q, r] = color;
      colors.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    } else
      colors.push(
        color[0],
        color[1],
        color[2],
        color[0],
        color[1],
        color[2],
        color[0],
        color[1],
        color[2],
      );
    if (normals) smooth.push(positions.length / 3 - 3, normals);
  };
  const ground = (x, z, fallback) => {
    const y = surface(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  const { x: left, z: top, pitch, cols, rows } = ROOT_LATTICE;
  let twigs = 0;
  for (let attempt = 0; placed.length < L.count && attempt < 20000; attempt++) {
    if (attempt % 16 === 0) yield;
    // A point beside a root line where it meets the soil, stepped off one side.
    const line = ROOT_LINES[Math.floor(random() * ROOT_LINES.length)],
      s = Math.floor(random() * (line.length - 1));
    const [ax, az, ah, as] = line[s],
      [bx, bz, bh, bs] = line[s + 1],
      t = random();
    if (as + (bs - as) * t < 0.45) continue;
    const hx = bx - ax,
      hz = bz - az,
      hl = Math.hypot(hx, hz),
      side = random() < 0.5 ? -1 : 1;
    const off = ah + (bh - ah) * t + L.beside[0] + random() * (L.beside[1] - L.beside[0]);
    const x = TREE_FOOTING.x + ax + hx * t - (hz / hl) * off * side,
      z = TREE_FOOTING.z + az + hz * t + (hx / hl) * off * side;
    if (
      x < left + 1 ||
      z < top + 1 ||
      x > left + (cols - 1) * pitch - 1 ||
      z > top + (rows - 1) * pitch - 1
    )
      continue;
    if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < L.lantern) continue;
    if (nearWater(x, z, L.puddle)) continue;
    if (streamDistance(x, z) < 0) continue;
    // Beside a real root, never under one.
    const near = rootCovered(x, z) ? 0 : coverDistance(x, z, L.near[1]);
    if (!(near >= L.near[0] && near <= L.near[1])) continue;
    const [sky] = rootOcclusion(x, z);
    if (sky < L.sky[0] || sky > L.sky[1]) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < L.spacing)) continue;
    const y = surface(x, z);
    if (!Number.isFinite(y)) continue;
    const kind =
      twigs < L.twigs && random() < L.twigChance
        ? "twig"
        : random() < L.pebbleShare
          ? "pebble"
          : "flake";
    const yaw = random() * Math.PI * 2,
      cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      dim = 1 - L.shade * sky;
    if (kind === "pebble") {
      const a = L.pebble[0] + random() * (L.pebble[1] - L.pebble[0]),
        b = a * (0.65 + 0.35 * random()),
        h = a * (0.35 + 0.25 * random());
      const color = tone(
        (L.tone.pebble[0] + random() * (L.tone.pebble[1] - L.tone.pebble[0])) * dim,
        random() * 0.6,
      );
      pebbleDome(
        a,
        b,
        h,
        random,
        (u, w, lift) => {
          const tx = u * cy - w * sy,
            tz = u * sy + w * cy;
          return [x + tx, Math.max(ground(x + tx, z + tz, y), y) + lift, z + tz];
        },
        [cy, sy],
        color,
        triangle,
      );
    } else if (kind === "flake") {
      const length = L.flake[0] + random() * (L.flake[1] - L.flake[0]),
        width = length * (0.35 + 0.25 * random()),
        curl = 0.012 + random() * 0.03;
      const point = (u, w, lift) => {
        const tx = u * cy - w * sy,
          tz = u * sy + w * cy;
        return [x + tx, ground(x + tx, z + tz, y) + 0.012 + lift, z + tz];
      };
      const q = [
        point(-length / 2, -width / 2, 0),
        point(-length / 2, 0, curl),
        point(-length / 2, width / 2, 0),
        point(length / 2, -width / 2, 0),
        point(length / 2, 0, curl),
        point(length / 2, width / 2, 0),
      ];
      const color = tone(L.tone.flake * (0.8 + 0.4 * random()) * dim, 1);
      triangle(q[0], q[3], q[1], color);
      triangle(q[1], q[3], q[4], color);
      triangle(q[1], q[4], q[2], color);
      triangle(q[2], q[4], q[5], color);
    } else {
      // Roughly along the root, kinked every second segment, some with a short fork.
      const length = L.twig[0] + random() * (L.twig[1] - L.twig[0]);
      const width = L.twigWidth[0] + random() * (L.twigWidth[1] - L.twigWidth[0]),
        turn = 0.6 * (random() - 0.5);
      const hx2 = (hx / hl) * Math.cos(turn) - (hz / hl) * Math.sin(turn),
        hz2 = (hx / hl) * Math.sin(turn) + (hz / hl) * Math.cos(turn);
      const color = tone(L.tone.twig * (0.85 + 0.3 * random()) * dim, 0.6);
      const stick = (sx, sz, dx0, dz0, span, wa, wb, segments, kink) => {
        const rings = [];
        let px = sx,
          pz = sz,
          dx = dx0,
          dz = dz0;
        for (let k = 0; k <= segments; k++) {
          if (k && k % 2 === 0) {
            const bend = kink * (random() - 0.5),
              c = Math.cos(bend),
              s2 = Math.sin(bend);
            [dx, dz] = [dx * c - dz * s2, dx * s2 + dz * c];
          }
          const w = Math.max(L.minWidth, wa + (wb - wa) * (k / segments)),
            gy = ground(px, pz, y) + w * 0.4;
          rings.push([
            [px - (dz * w) / 2, gy - w * 0.3, pz + (dx * w) / 2],
            [px + (dz * w) / 2, gy - w * 0.3, pz - (dx * w) / 2],
            [px, gy + w * 0.5, pz],
          ]);
          px += (dx * span) / segments;
          pz += (dz * span) / segments;
        }
        for (let k = 0; k < segments; k++)
          for (let e = 0; e < 3; e++) {
            const p0 = rings[k][e],
              p1 = rings[k][(e + 1) % 3],
              p2 = rings[k + 1][e],
              p3 = rings[k + 1][(e + 1) % 3];
            triangle(p0, p2, p1, color);
            triangle(p1, p2, p3, color);
          }
      };
      const sx = x - (hx2 * length) / 2,
        sz = z - (hz2 * length) / 2;
      stick(sx, sz, hx2, hz2, length, width, width * 0.6, 6, 0.7);
      if (random() < 0.5) {
        const at = 0.35 + 0.3 * random(),
          fork = random() < 0.5 ? 1 : -1,
          angle = 0.5 + 0.3 * random();
        const fx = hx2 * Math.cos(angle) - fork * hz2 * Math.sin(angle),
          fz = fork * hx2 * Math.sin(angle) + hz2 * Math.cos(angle);
        stick(
          sx + hx2 * length * at,
          sz + hz2 * length * at,
          fx,
          fz,
          length * 0.3,
          width * 0.7,
          width * 0.6,
          2,
          0.4,
        );
      }
      twigs++;
    }
    placed.push([x, z, kind]);
  }
  // The small stones, on their own seed after the litter (which they keep
  // clear of): rounded, smooth-shaded, a little darker where they meet the soil.
  const S = L.stones,
    stones = [],
    litterVertices = positions.length / 3,
    stoneNormals = [];
  let stoneSeed = S.seed;
  const draw = () => (stoneSeed = (Math.imul(stoneSeed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + draw() * (b - a);
  for (let attempt = 0; stones.length < S.count && attempt < 20000; attempt++) {
    if (attempt % 8 === 0) yield;
    let x, z;
    if (draw() < S.rootShare) {
      // Beside a resting root, stepped off one side.
      const line = ROOT_LINES[Math.floor(draw() * ROOT_LINES.length)],
        s = Math.floor(draw() * (line.length - 1));
      const [ax, az, ah, as] = line[s],
        [bx, bz, bh, bs] = line[s + 1],
        t = draw();
      if (as + (bs - as) * t < 0.7) continue;
      const hx = bx - ax,
        hz = bz - az,
        hl = Math.hypot(hx, hz),
        side = draw() < 0.5 ? -1 : 1,
        off = ah + (bh - ah) * t + between(S.beside);
      x = TREE_FOOTING.x + ax + hx * t - (hz / hl) * off * side;
      z = TREE_FOOTING.z + az + hz * t + (hx / hl) * off * side;
    } else {
      // In a crook about the trunk's base.
      const turn = draw() * Math.PI * 2,
        r = between(S.crook);
      x = TREE_FOOTING.x + TRUNK[0] + Math.cos(turn) * r;
      z = TREE_FOOTING.z + TRUNK[1] + Math.sin(turn) * r;
    }
    const width = between(S.size),
      depth = width * between([0.7, 1]),
      height = width * between(S.height),
      sunk = between(S.sink),
      yaw = draw() * Math.PI * 2,
      tone = between(S.tone),
      jitter = draw() * 1e4;
    if (
      x < left + 1 ||
      z < top + 1 ||
      x > left + (cols - 1) * pitch - 1 ||
      z > top + (rows - 1) * pitch - 1
    )
      continue;
    if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < L.lantern) continue;
    if (nearWater(x, z, L.puddle)) continue;
    if (streamDistance(x, z) < 0) continue;
    // Clear of every root and arch above it (the stone's own reach), yet among them.
    if (rootCovered(x, z)) continue;
    const near = coverDistance(x, z, S.among);
    if (!(near > width * 0.6 + 0.1 && near <= S.among)) continue;
    if (stones.some(([px, pz]) => Math.hypot(px - x, pz - z) < S.spacing)) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < L.spacing + width / 2)) continue;
    const y = surface(x, z);
    if (!Number.isFinite(y)) continue;
    const [sky] = rootOcclusion(x, z),
      dim = 1 - L.shade * sky,
      cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    // Its bumps on the 42 coarse points, eased smoothly over the sphere between
    // them (S.round: the falloff's sharpness), so it reads as a rounded stone,
    // never a faceted nugget.
    const bumps = ICOSPHERE.vertices
      .slice(0, ICOSPHERE.bumps)
      .map((v, k) => [v, 0.86 + 0.26 * dripHash(Math.floor(jitter) + k, 7)]);
    const shape = ICOSPHERE.vertices.map((v) => {
      let sum = 0,
        weight = 0;
      for (const [p, b] of bumps) {
        const w = Math.exp(S.round * (v[0] * p[0] + v[1] * p[1] + v[2] * p[2] - 1));
        sum += w * b;
        weight += w;
      }
      const bump = sum / weight;
      return [v[0] * bump, v[1] * bump, v[2] * bump];
    });
    const world = shape.map(([vx, vy, vz]) => {
      const px = (vx * width) / 2,
        pz = (vz * depth) / 2;
      return [
        x + px * cy - pz * sy,
        y + (vy * height) / 2 + height * (0.5 - sunk),
        z + px * sy + pz * cy,
      ];
    });
    // Smooth normals: the mean of the faces about each vertex.
    const normals = world.map(() => [0, 0, 0]);
    for (const [a, b, c] of ICOSPHERE.faces) {
      const [ax, ay, az] = world[a],
        [bx, by, bz] = world[b],
        [qx, qy, qz] = world[c];
      const ux = bx - ax,
        uy = by - ay,
        uz = bz - az,
        vx = qx - ax,
        vy = qy - ay,
        vz = qz - az;
      const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      for (const k of [a, b, c]) for (let e = 0; e < 3; e++) normals[k][e] += n[e];
    }
    for (const n of normals) {
      const length = Math.hypot(...n) || 1;
      for (let e = 0; e < 3; e++) n[e] /= length;
    }
    const grey = (0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2]) * tone * dim;
    for (const face of ICOSPHERE.faces)
      for (const k of face) {
        positions.push(...world[k]);
        stoneNormals.push(...normals[k]);
        // A little darker toward the soil it is sunk in.
        const shade = grey * (0.62 + 0.38 * Math.min(1, Math.max(0, (normals[k][1] + 0.4) / 1.2)));
        colors.push(...S.tint.map((t) => shade * t));
      }
    stones.push([x, z, width]);
  }
  const fineStart = positions.length / 3;
  const pieces = yield* fineLitterSteps(
    surface,
    base,
    stones,
    triangle,
    () => positions.length / 3,
  );
  const geometry = new BufferGeometry();
  let finished = false;
  try {
    geometry.setAttribute("position", yield* litterAttribute(positions, 3));
    geometry.setAttribute("color", yield* litterAttribute(colors, 3));
    // The growth material's wind and sky lean (estate-ground-detail.js): none here.
    geometry.setAttribute(
      "aGrass",
      new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
    );
    yield* litterNormals(geometry);
    geometry.attributes.normal.array.set(stoneNormals, litterVertices * 3);
    const normalArray = geometry.attributes.normal.array;
    for (let i = 0; i < smooth.length; i += 2) {
      if (i % 512 === 0) yield;
      const first = smooth[i] * 3,
        normals = smooth[i + 1];
      for (let k = 0; k < 3; k++)
        for (let e = 0; e < 3; e++) normalArray[first + k * 3 + e] = normals[k][e];
    }
    yield* geometryBounds(geometry);
    geometry.userData.litter = placed;
    // The stones' vertices follow the litter's.
    geometry.userData.stones = stones;
    geometry.userData.litterVertices = litterVertices;
    // The fine pieces' vertices [first, end): balanced draws a share of them.
    geometry.userData.fine = [fineStart, positions.length / 3];
    // Each fine piece's first vertex, in order.
    geometry.userData.finePieces = pieces;
    finished = true;
    return geometry;
  } finally {
    if (!finished) geometry.dispose();
  }
}

// A rounded pebble or clod, half-width `a` by `b`, `h` high: a top, a ring
// at PEBBLE_DOME.ring of its width and a ring sunk into the soil, each ring of
// PEBBLE_DOME.sides jittered points, smooth-shaded from its ellipsoid's normals
// and a little darker toward the soil. A piece at least `large` wide (one the
// lens can come close to) takes `round` points a ring, so its outline never
// reads as a polygon, and its rings follow its ellipsoid at `profile` degrees
// up from the sunk ring, so its side never bends at one ring into a flat cone
// (a faceted nugget); one at least `widest` wide (45-90 px near the lens on a
// portrait monitor) takes `smooth` points a ring. A grain at least `mid` wide
// takes `midSides`, so a bank stone near the lens on a wide screen is never a
// hexagon. The jitter of every ring eases between the `sides` drawn, so every
// piece takes the same draws and the scatter keeps its places. `at(u, w,
// lift)` places a local point (u along its yaw) on the ground; `turn` is
// [cos, sin] of that yaw.
export const PEBBLE_DOME = Object.freeze({
  sides: 6,
  round: 12,
  large: 0.035,
  ring: 0.62,
  jitter: 0.18,
  full: 0.035,
  widest: 0.05,
  smooth: 16,
  mid: 0.02,
  midSides: 9,
  profile: Object.freeze([35, 65]),
});
function pebbleDome(a, b, h, random, at, [cy, sy], rgb, triangle) {
  const { sides, round, large, full, widest, smooth, mid, midSides, ring, jitter, profile } =
      PEBBLE_DOME,
    spin = random() * Math.PI,
    drawn = () => Array.from({ length: sides }, () => 1 + jitter * (random() * 2 - 1)),
    upperJitter = drawn(),
    lowerJitter = drawn(),
    n =
      Math.max(a, b) >= widest
        ? smooth
        : Math.max(a, b) >= large
          ? round
          : Math.max(a, b) >= mid
            ? midSides
            : sides;
  // The jitter `k` sides round from the first drawn point, eased between them.
  const eased = (drawnJitter, k) => {
    const i = Math.floor(k),
      f = k - i,
      s = f * f * (3 - 2 * f);
    return drawnJitter[i % sides] * (1 - s) + drawnJitter[(i + 1) % sides] * s;
  };
  const point = (r, y, m, offset, drawnJitter) => {
    const k = (m * sides) / n + offset,
      t = spin + (k * 2 * Math.PI) / sides,
      j = eased(drawnJitter, k - offset),
      u = Math.cos(t) * a * r * j,
      w = Math.sin(t) * b * r * j;
    // The ellipsoid's normal (its centre at the sunk ring), turned to the world.
    const nu = u / (a * a),
      ny = (y + h * 0.15) / (h * h),
      nw = w / (b * b),
      l = Math.hypot(nu, ny, nw) || 1;
    return [at(u, w, y), [(nu * cy - nw * sy) / l, ny / l, (nu * sy + nw * cy) / l]];
  };
  // The rings from the sunk one up: a small piece's at PEBBLE_DOME.ring; a large
  // one's on its ellipsoid (centre at the sunk ring, 1.15 h high), each turned a
  // little further and its jitter eased from the sunk ring's to the upper's.
  const top = [at(0, 0, h), [0, 1, 0]],
    shape =
      Math.max(a, b) < full
        ? [[ring, h * 0.8, 0.5, 1]]
        : profile.map((degrees, i) => {
            const e = (degrees * Math.PI) / 180;
            return [
              Math.cos(e),
              -h * 0.15 + h * 1.15 * Math.sin(e),
              (i + 1) * 0.25,
              Math.min(1, (i + 1) / (profile.length - 1 || 1)),
            ];
          }),
    blend = (share) => upperJitter.map((v, k) => lowerJitter[k] + (v - lowerJitter[k]) * share),
    rings = [
      Array.from({ length: n }, (_, m) => point(1, -h * 0.15, m, 0, lowerJitter)),
      ...shape.map(([r, y, offset, share]) =>
        Array.from({ length: n }, (_, m) => point(r, y, m, offset, blend(share))),
      ),
    ];
  const shade = (normal) => {
    const k = 0.68 + 0.32 * Math.max(0, normal[1]);
    return [rgb[0] * k, rgb[1] * k, rgb[2] * k];
  };
  const face = (p, q, r) =>
    triangle(p[0], q[0], r[0], [shade(p[1]), shade(q[1]), shade(r[1])], [p[1], q[1], r[1]]);
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n,
      upper = rings.at(-1);
    face(top, upper[k1], upper[k]);
    for (let i = rings.length - 1; i > 0; i--) {
      const [above, below] = [rings[i], rings[i - 1]];
      face(above[k], above[k1], below[k1]);
      face(above[k], below[k1], below[k]);
    }
  }
}

// A fallen leaf (LITTER.fine's, and the banks' debris): a cupped oval on a
// midrib, `length` long and `width` wide, its rim raised by `cup` and its
// ends by `curl`, both as drawn times FALLEN_LEAF.lie (damp leaves lie nearly
// flat, so a low lens never looks under a raised rim), `rise` above the
// surface `at(u, w, lift)` places it on. Toward its stalk and tip, where its
// outline narrows, the rim is raised less, as its half-width over the widest
// to the power `ends`, so a low lens never sees a long dark underside along
// the near rim. Its normals lean out from its middle by `round` of their
// offset over its length and its rim is `rim` as light as its midrib, so it
// shades over like a curled leaf, never flat as a card.
export const FALLEN_LEAF = Object.freeze({
  lie: 0.5,
  ends: 1.5,
  round: 1.2,
  rim: 0.8,
  // Its outline: [along the midrib, half-width] from stalk to tip, so its edge
  // curves as a leaf's, never a card's straight sides.
  outline: Object.freeze(
    [
      [0.12, 0.3],
      [0.3, 0.46],
      [0.5, 0.48],
      [0.7, 0.4],
      [0.88, 0.24],
    ].map((station) => Object.freeze(station)),
  ),
});
function fallenLeaf(at, length, width, cup, curl, rise, rgb, triangle) {
  const { lie, ends, round, rim, outline } = FALLEN_LEAF,
    lift = (u) => rise + curl * lie * (2 * u - 1) ** 2,
    widest = Math.max(...outline.map(([, half]) => half)),
    raise = (half) => cup * lie * (half / widest) ** ends;
  const [[, A], ...rest] = [[0, 0], ...outline, [1, 0]].map(([u, half]) => [
      at((u - 0.5) * length, -half * width, lift(u) + raise(half)),
      at((u - 0.5) * length, 0, lift(u)),
      at((u - 0.5) * length, half * width, lift(u) + raise(half)),
    ]),
    [, T] = rest.pop(),
    middle = new Set(rest.map(([, M]) => M));
  const centre = rest[outline.findIndex(([u]) => u === 0.5)][1],
    normal = ([px, , pz]) => {
      const n = [((px - centre[0]) / length) * round, 1, ((pz - centre[2]) / length) * round],
        l = Math.hypot(...n);
      return n.map((v) => v / l);
    },
    edge = rgb.map((c) => c * rim),
    tone = (v) => (middle.has(v) ? rgb : edge),
    faces = [
      [A, rest[0][1], rest[0][0]],
      [A, rest[0][2], rest[0][1]],
    ];
  for (let k = 1; k < rest.length; k++) {
    const [L1, M1, R1] = rest[k - 1],
      [L2, M2, R2] = rest[k];
    faces.push([L1, M1, M2], [L1, M2, L2], [M1, R1, R2], [M1, R2, M2]);
  }
  const [L, M, R] = rest.at(-1);
  faces.push([L, M, T], [M, R, T]);
  for (const [a, b, c] of faces)
    triangle(a, b, c, [tone(a), tone(b), tone(c)], [normal(a), normal(b), normal(c)]);
}

// The fine litter (LITTER.fine), appended through `triangle(a, b, c, rgb)`:
// leaves, clods and grit interleaved, so a draw range cut thins all three.
// A loose grain's burial is independent of the placement random stream.
// Keep 40–85% of its original height exposed, with the lower ring in soil.
export function loosePebbleBurial(x, z, kind = 0) {
  let hash =
    Math.imul(Math.floor(x * 4096), 374761393) ^
    Math.imul(Math.floor(z * 4096), 668265263) ^
    Math.imul(kind | 0, 1274126177);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return 0.15 + 0.45 * (((hash ^ (hash >>> 16)) >>> 0) / 4294967296);
}

function* fineLitterSteps(surface, base, stones, triangle, vertices) {
  const pieces = [];
  const F = LITTER.fine;
  let seed = F.seed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  const left = { ...F.counts },
    grey = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const { x: lx, z: lz, pitch, cols, rows } = ROOT_LATTICE;
  for (let attempt = 0; attempt < 30000 && left.leaves + left.clods + left.gravel > 0; attempt++) {
    if (attempt % 16 === 0) yield;
    let pick = random() * (left.leaves + left.clods + left.gravel);
    const kind = (pick -= left.gravel) < 0 ? "gravel" : pick < left.clods ? "clod" : "leaf";
    const turn = (between(F.arc) * Math.PI) / 180,
      r = Math.sqrt(between([F.reach[0] ** 2, F.reach[1] ** 2]));
    const x = TREE_FOOTING.x + TRUNK[0] + Math.cos(turn) * r,
      z = TREE_FOOTING.z + TRUNK[1] + Math.sin(turn) * r;
    if (
      x < lx + 1 ||
      z < lz + 1 ||
      x > lx + (cols - 1) * pitch - 1 ||
      z > lz + (rows - 1) * pitch - 1
    )
      continue;
    if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < F.lantern) continue;
    if (nearWater(x, z, F.puddle)) continue;
    // Clear of a root by a quarter unit, so no piece reaches under its edge.
    if (riverWithin(x, z, 1.05) || coverDistance(x, z, 0.25) <= 0.25 || streamDistance(x, z) < 0)
      continue;
    if (stones.some(([px, pz, w]) => Math.hypot(px - x, pz - z) < w * 0.6)) continue;
    if (kind === "leaf" && coverDistance(x, z, 0.8) > 0.8 && random() > F.leafNear) continue;
    const y = surface(x, z);
    if (!Number.isFinite(y)) continue;
    const ground = (px, pz) => {
      const h = surface(px, pz);
      return Number.isFinite(h) ? h : y;
    };
    const [sky] = rootOcclusion(x, z),
      dim = 1 - LITTER.shade * sky,
      yaw = random() * Math.PI * 2,
      cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    const at = (u, w, lift) => {
      const tx = u * cy - w * sy,
        tz = u * sy + w * cy;
      return [x + tx, ground(x + tx, z + tz) + lift, z + tz];
    };
    pieces.push(vertices());
    if (kind === "leaf") {
      // A cupped oval on a midrib, curled along its length.
      const length = between(F.leafSize),
        width = length * between([0.45, 0.62]),
        cup = width * between([0.12, 0.3]),
        curl = length * between([0.05, 0.22]),
        age = random(),
        rgb = F.leafTone.map(
          (c, k) => c * (0.6 + 0.6 * age) * dim * (k === 1 ? 1 - 0.15 * age : 1),
        );
      fallenLeaf(at, length, width, cup, curl, 0.008, rgb, triangle);
      left.leaves--;
    } else {
      // A rounded, jittered dome: a soil clod or a grain of grit.
      const clod = kind === "clod",
        a = between(clod ? F.clod : F.grit),
        b = a * between([0.6, 1]),
        h = a * between(clod ? [0.35, 0.55] : [0.4, 0.75]);
      let rgb;
      if (clod) {
        const k = between(F.clodTone) * dim;
        rgb = base.map((c) => c * k);
      } else {
        const k = (random() < F.pale[0] ? F.pale[1] : between(F.gravelTone)) * grey * dim,
          warm = random() * 0.2;
        rgb = [k * (1 + warm), k, k * (1 - warm)];
      }
      const buried = clod ? 0 : h * loosePebbleBurial(x, z);
      pebbleDome(a, b, h, random, (u, w, lift) => at(u, w, lift - buried), [cy, sy], rgb, triangle);
      left[clod ? "clods" : "gravel"]--;
    }
  }
  return pieces;
}

// The river's rushes (drawn with the grass material, estate-ground-detail.js,
// so they sway): clumps of thin, bowed stems on either bank, `bank`
// normalised radii out, within `reach` units along the river of where it
// passes the lantern but never within `clear` units of it, where the lantern
// and its image stand between the banks. Each stem is a tapering 4-row strip
// as a grass blade; `heads` of them carry a slim brown seed head near the top.
export const RUSHES = Object.freeze({
  seed: 90417,
  clumps: 11,
  stems: Object.freeze([18, 32]),
  bank: Object.freeze([1.08, 1.45]),
  reach: 9,
  clear: 2.2,
  lantern: 0.7,
  height: Object.freeze([0.35, 0.9]),
  width: Object.freeze([0.008, 0.013]),
  heads: 0.12,
  base: Object.freeze([0.045, 0.06, 0.04]),
  tip: Object.freeze([0.12, 0.13, 0.085]),
  head: Object.freeze([0.075, 0.055, 0.04]),
  sway: 0.08,
  up: 0.35,
});
export function plantRushes(surface) {
  return buildNow(rushSteps(surface));
}
function* rushSteps(surface) {
  const R = RUSHES;
  let seed = R.seed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  const { strip, geometry } = stemStrips();
  let clumps = 0;
  for (let attempt = 0; clumps < R.clumps && attempt < 400; attempt++) {
    yield;
    // A point on either bank within R.reach units of where the river passes
    // the lantern, but not within R.clear of it, where the lantern and its
    // image stand between the banks.
    const along = (random() * 2 - 1) * R.reach;
    if (Math.abs(along) < R.clear) continue;
    const [px, pz, fx, fz] = riverPoint(RIVER_NEAR + along),
      out = (random() < 0.5 ? -1 : 1) * between(R.bank) * RIVER.width,
      cx = px - fz * out,
      cz = pz + fx * out;
    if (riverWithin(cx, cz, 1.05) || rootCovered(cx, cz)) continue;
    if (Math.hypot(cx - LANTERN_FOOT.x, cz - LANTERN_FOOT.z) < R.lantern) continue;
    plantClump(
      R,
      random,
      between,
      surface,
      strip,
      [cx, cz, Math.atan2(fx * Math.sign(out), -fz * Math.sign(out))],
      (x, z) => riverWithin(x, z, 1.02),
    );
    clumps++;
  }
  const out = geometry();
  out.userData.clumps = clumps;
  return out;
}

// Reeds on the stream's banks (the owner's pick of 2026-10-10: "make the ground
// more interesting"): the rushes' clumps (RUSHES' stems, heads and sway), on
// their own seed, `bank` normalised radii out on either bank from where the
// stream leaves the roots (`from` units along) to `before` units short of its
// mouth, leaning off the water, clear of the lantern (`lantern`), the roots and
// the river's own rushes.
export const STREAM_REEDS = Object.freeze({
  seed: 31877,
  clumps: 9,
  stems: Object.freeze([10, 22]),
  bank: Object.freeze([1.15, 1.6]),
  from: 2.6,
  before: 1.2,
  lantern: 1.6,
  height: Object.freeze([0.3, 0.75]),
});
// The stream's course at distance s along it: [x, z, flow x, flow z, half-width].
function streamPoint(s, line = STREAM_LINES[0]) {
  const p = line.points;
  let k = 1;
  while (k < p.length - 1 && p[k][2] < s) k++;
  const [ax, az, s0] = p[k - 1],
    [bx, bz, s1] = p[k],
    t = Math.min(1, Math.max(0, (s - s0) / (s1 - s0))),
    len = Math.hypot(bx - ax, bz - az);
  return [
    ax + (bx - ax) * t,
    az + (bz - az) * t,
    (bx - ax) / len,
    (bz - az) / len,
    (line.widths[k - 1] + (line.widths[k] - line.widths[k - 1]) * t) / 2,
  ];
}
// A clump's stems (RUSHES' recipe) about cx, cz, leaning toward `outward`
// (radians in x/z) give or take a radian; `inWater(x, z)` drops a stem.
function plantClump(R, random, between, surface, strip, [cx, cz, outward], inWater) {
  const stems = Math.round(between(R.stems));
  for (let n = 0; n < stems; n++) {
    const spread = 0.12 * Math.sqrt(random()),
      at = random() * Math.PI * 2,
      x = cx + Math.cos(at) * spread,
      z = cz + Math.sin(at) * spread,
      y = surface(x, z);
    if (!Number.isFinite(y) || inWater(x, z)) continue;
    const height = between(R.height),
      width = between(RUSHES.width),
      lean = height * between([0.05, 0.3]),
      // They lean off the water, give or take a radian.
      turn = outward + (random() - 0.5) * 2,
      lx = Math.cos(turn),
      lz = Math.sin(turn),
      tone = 0.8 + 0.4 * random();
    const rows = RUSH_ROWS.map((t) => {
      const bend = lean * t * t;
      return [x + lx * bend, y - 0.02 + height * t - bend * bend * 0.4, z + lz * bend, -lz, lx];
    });
    strip(
      rows,
      [1, 0.9, 0.7, 0.15].map((k) => width * k),
      RUSH_ROWS.map((t) => RUSHES.base.map((b, k) => (b + (RUSHES.tip[k] - b) * t) * tone)),
      RUSH_ROWS.map((t) => t * t * height * RUSHES.sway),
    );
    if (random() < RUSHES.heads) {
      const lerp = (k) => rows[2].map((c, e) => (e < 3 ? c + (rows[3][e] - c) * k : c));
      const sway = 0.8 * 0.8 * height * RUSHES.sway;
      strip(
        [lerp(0.15), lerp(0.85)],
        [width * 1.7, width * 1.5],
        [RUSHES.head, RUSHES.head.map((c) => c * 0.8)],
        [sway, sway * 1.2],
      );
    }
  }
}
const RUSH_ROWS = [0, 0.35, 0.7, 1];
// Crossed tapering strips for stems and heads, indexed, with the grass
// material's colour and sway; geometry() builds the mesh's geometry.
function stemStrips() {
  const positions = [],
    colors = [],
    grass = [],
    indices = [];
  const flat = (points, widths, rgbs, sways) => {
    const start = positions.length / 3;
    points.forEach(([px, py, pz, ax, az], row) => {
      const w = widths[row] / 2;
      positions.push(px - ax * w, py, pz - az * w, px + ax * w, py, pz + az * w);
      colors.push(...rgbs[row], ...rgbs[row].map((c) => c * 0.9));
      grass.push(sways[row], RUSHES.up, sways[row], RUSHES.up);
    });
    for (let row = 0; row + 1 < points.length; row++) {
      const a = start + row * 2;
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  };
  const strip = (points, widths, rgbs, sways) => {
    flat(points, widths, rgbs, sways);
    flat(
      points.map(([px, py, pz, ax, az]) => [px, py, pz, -az, ax]),
      widths,
      rgbs,
      sways,
    );
  };
  const geometry = () => {
    const out = new BufferGeometry();
    out.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    out.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    out.setAttribute("aGrass", new BufferAttribute(new Float32Array(grass), 2));
    out.setIndex(indices);
    out.computeVertexNormals();
    out.computeBoundingSphere();
    return out;
  };
  return { strip, geometry };
}
export function plantReeds(surface) {
  const R = STREAM_REEDS,
    line = STREAM_LINES[0];
  let seed = R.seed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  const { strip, geometry } = stemStrips();
  const mouth = line.length - R.before;
  let clumps = 0;
  for (let attempt = 0; clumps < R.clumps && attempt < 400; attempt++) {
    const s = between([R.from, mouth]),
      [px, pz, fx, fz, half] = streamPoint(s),
      side = random() < 0.5 ? -1 : 1,
      out = side * between(R.bank) * half,
      cx = px - fz * out,
      cz = pz + fx * out;
    if (streamRadius(cx, cz) < R.bank[0] - 0.05 || riverWithin(cx, cz, 1.3)) continue;
    if (rootCovered(cx, cz) || coverDistance(cx, cz, 0.3) <= 0.3) continue;
    if (Math.hypot(cx - LANTERN_FOOT.x, cz - LANTERN_FOOT.z) < R.lantern) continue;
    plantClump(
      R,
      random,
      between,
      surface,
      strip,
      [cx, cz, Math.atan2(fx * side, -fz * side)],
      (x, z) => streamRadius(x, z) < 1.04,
    );
    clumps++;
  }
  const out = geometry();
  out.userData.clumps = clumps;
  return out;
}

// The water's banks (the owner's picks of 2026-10-10): gravel bars on the
// inside of the stream's bends, a fan of gravel where it leaves the river
// and a gravel shore along the river where the lantern shots see it, with
// leaves and twigs caught at the waterline and in the eddies behind the
// stream's stones. On their own seed, as the fine litter's domes and leaves
// (PEBBLE_DOME, LITTER.fine's leaf), a separate draw of the grass material,
// never under a root or at the lantern's foot.
// - gravel: `count` pebbles `size` wide (`coarse` near the water), on the
//   stream's inside banks (side under -`inside`, between `stream` normalised
//   radii), the delta (river radii `delta` within `fan` units of the mouth) and
//   the river's near bank (river radii `river`, within `reach` units along of
//   where it passes the lantern but not within `clear` of it); `tone` times
//   the soil's grey, darker (`wet`) at the water. None lies in the river: a
//   pebble inside `shore` river radii (its own width past the waterline) is
//   left out, its draws still taken, so the rest keep their places.
// - debris: `count` leaves and twigs at the stream's waterline (radii
//   `waterline`) and `eddy` of them in the slack water just behind each stone;
//   as the gravel, one inside `shore` river radii is left out, its draws still
//   taken, so none lies on the river where the stream leaves it.
export const WATER_BANKS = Object.freeze({
  seed: 47713,
  gravel: Object.freeze({
    count: 1600,
    size: Object.freeze([0.014, 0.038]),
    coarse: Object.freeze([0.03, 0.07]),
    tone: Object.freeze([1.2, 2.6]),
    wet: 0.5,
    inside: 0.12,
    stream: Object.freeze([0.88, 1.55]),
    delta: Object.freeze([0.8, 1.3]),
    fan: 2.4,
    river: Object.freeze([1.0, 1.4]),
    reach: 7,
    clear: 1.6,
    lantern: 0.9,
    shore: 1.04,
  }),
  debris: Object.freeze({
    count: 60,
    eddy: 2,
    waterline: Object.freeze([0.92, 1.12]),
    twigs: 0.3,
    twig: Object.freeze([0.18, 0.42]),
  }),
  // A few leaves drifting down the stream: `count` of LITTER.fine's leaves,
  // `size` long, carried at `speed` of its flow from its mouth on the river up
  // to where it sinks under the roots, wandering `wander` of its half-width across and turning
  // slowly, shrinking in and out over the first and last `fade` units.
  drift: Object.freeze({
    count: 8,
    size: Object.freeze([0.1, 0.17]),
    speed: 0.45,
    wander: 0.45,
    fade: 0.9,
  }),
});
export function scatterBanks(surface, groundColor) {
  const steps = bankSteps(surface, groundColor);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
// The same, a few pieces at a time (settleRoots() builds it in idle slices).
function* bankSteps(surface, groundColor) {
  const B = WATER_BANKS,
    G = B.gravel,
    D = B.debris,
    F = LITTER.fine,
    line = STREAM_LINES[0];
  let seed = B.seed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  const base = [groundColor.r, groundColor.g, groundColor.b].map((v) => v * LITTER.albedo),
    grey = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const positions = [],
    colors = [],
    normals = [],
    pieces = [];
  const triangle = (a, b, c, rgb, n) => {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    const [p, q, r] = Array.isArray(rgb[0]) ? rgb : [rgb, rgb, rgb];
    colors.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
    normals.push(n[0][0], n[0][1], n[0][2], n[1][0], n[1][1], n[1][2], n[2][0], n[2][1], n[2][2]);
  };
  // Test each emitted triangle against the covered root cells, including its
  // edges and interior. Testing only the piece's centre misses overhanging
  // leaves and gravel. Rollback after construction keeps the seeded draws.
  const finishPiece = (start, clear = true) => {
    if (!clear) {
      positions.length = colors.length = normals.length = start;
      return false;
    }
    for (let i = start; i < positions.length; i += 9) {
      const p = [0, 3, 6].map((k) => [positions[i + k], positions[i + k + 2]]),
        xs = p.map(([x]) => x),
        zs = p.map(([, z]) => z),
        col0 = Math.floor((Math.min(...xs) - ROOT_LATTICE.x - 0.126) / 0.25),
        col1 = Math.ceil((Math.max(...xs) - ROOT_LATTICE.x + 0.126) / 0.25),
        row0 = Math.floor((Math.min(...zs) - ROOT_LATTICE.z - 0.126) / 0.25),
        row1 = Math.ceil((Math.max(...zs) - ROOT_LATTICE.z + 0.126) / 0.25);
      for (let row = row0; row <= row1; row++)
        for (let col = col0; col <= col1; col++) {
          const x = ROOT_LATTICE.x + col * 0.25,
            z = ROOT_LATTICE.z + row * 0.25;
          if (
            !rootCovered(x, z) ||
            Math.max(...xs) < x - 0.126 ||
            Math.min(...xs) > x + 0.126 ||
            Math.max(...zs) < z - 0.126 ||
            Math.min(...zs) > z + 0.126
          )
            continue;
          const separate = p.some(([ax, az], k) => {
            const [bx, bz] = p[(k + 1) % 3],
              nx = az - bz,
              nz = bx - ax,
              projections = p.map(([px, pz]) => (px - x) * nx + (pz - z) * nz),
              reach = 0.126 * (Math.abs(nx) + Math.abs(nz));
            return Math.min(...projections) > reach || Math.max(...projections) < -reach;
          });
          if (!separate) {
            positions.length = colors.length = normals.length = start;
            return false;
          }
        }
    }
    return true;
  };
  const water = G.lantern;
  const [mx, mz] = streamPoint(line.length);
  // The bend at distance s along the course (STREAM_LINES' bends).
  const bendAt = (at) => {
    const p = line.points;
    let k = 1;
    while (k < p.length - 1 && p[k][2] < at) k++;
    const t = Math.min(1, Math.max(0, (at - p[k - 1][2]) / (p[k][2] - p[k - 1][2])));
    return line.bends[k - 1] + (line.bends[k] - line.bends[k - 1]) * t;
  };
  // A candidate near a kind of bank, [x, z, how near the water, weight], or
  // null: on the stream's inside banks (a point bar), about its mouth (the
  // delta) or on the river's banks by the lantern. Each kind measures only
  // its own water.
  const candidate = () => {
    const pick = random();
    if (pick < 0.6) {
      const at = between([STREAM_REEDS.from, line.length]),
        [px, pz, fx, fz, half] = streamPoint(at),
        out = (random() < 0.5 ? -1 : 1) * between([G.stream[0] - 0.1, G.stream[1] + 0.1]) * half,
        // Its side through the bend before measuring: out is to the flow's left.
        guess = -Math.sign(out) * bendAt(at);
      if (random() > ease(G.inside, 0.5, -guess)) return null;
      const x = px - fz * out,
        z = pz + fx * out;
      if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < water) return null;
      const r = streamRadius(x, z),
        { side } = streamPlace();
      if (r < G.stream[0] || r > G.stream[1] || side > -G.inside) return null;
      if (Math.hypot(x - mx, z - mz) < G.fan + 1 && riverRadius(x, z) < G.river[0] - 0.12)
        return null;
      return [x, z, 1 - ease(G.stream[0], G.stream[1], r)];
    }
    if (pick < 0.85) {
      const turn = random() * Math.PI * 2,
        reach = G.fan * Math.sqrt(random()),
        x = mx + Math.cos(turn) * reach,
        z = mz + Math.sin(turn) * reach;
      if (random() > 1 - reach / G.fan) return null;
      const rr = riverRadius(x, z);
      if (rr < G.delta[0] || rr > G.delta[1] || streamRadius(x, z) < G.stream[0]) return null;
      if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < water) return null;
      return [x, z, 1 - ease(G.delta[0], G.delta[1], rr)];
    }
    const along = (random() * 2 - 1) * G.reach;
    if (Math.abs(along) < G.clear || random() > 0.55) return null;
    const [px, pz, fx, fz] = riverPoint(RIVER_NEAR + along),
      out = (random() < 0.5 ? -1 : 1) * between(G.river) * RIVER.width,
      x = px - fz * out,
      z = pz + fx * out;
    if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < water) return null;
    const rr = riverRadius(x, z);
    if (rr < G.river[0] || rr > G.river[1] || streamRadius(x, z) < G.stream[0]) return null;
    return [x, z, 1 - ease(G.river[0], G.river[1], rr)];
  };
  const groundAt = (x, z, fallback) => {
    const y = surface(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  let placed = 0,
    drawn = 0;
  for (let attempt = 0; placed < G.count && attempt < G.count * 8; attempt++) {
    const spot = candidate();
    if (!spot) continue;
    const [x, z, wet] = spot;
    if (rootCovered(x, z) || coverDistance(x, z, 0.2) <= 0.2) continue;
    const y = surface(x, z);
    if (!Number.isFinite(y)) continue;
    const coarse = random() < 0.25 + 0.5 * wet,
      a = between(coarse ? G.coarse : G.size),
      b = a * between([0.6, 1]),
      h = a * between([0.35, 0.7]),
      yaw = random() * Math.PI * 2,
      cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      [sky] = rootOcclusion(x, z),
      k = between(G.tone) * grey * (1 - G.wet * wet * 0.5) * (1 - LITTER.shade * sky),
      warm = random() * 0.25;
    const at = (u, w, lift) => {
      const tx = u * cy - w * sy,
        tz = u * sy + w * cy;
      return [x + tx, groundAt(x + tx, z + tz, y) + lift, z + tz];
    };
    const dry = riverRadius(x, z) >= G.shore,
      start = positions.length;
    pebbleDome(
      a,
      b,
      h,
      random,
      at,
      [cy, sy],
      [k * (1 + warm), k, k * (1 - warm)],
      dry ? (p, q, r, rgb, n) => triangle(p, q, r, rgb, n) : () => {},
    );
    if (dry && finishPiece(start)) {
      pieces.push(start / 3);
      drawn++;
    }
    if (++placed % 64 === 0) yield;
  }
  // Leaves and twigs at the waterline, and in the eddy behind each stone.
  const foot = groundAt(LANTERN_FOOT.x, LANTERN_FOOT.z, 0);
  const debris = [];
  let floating = 0;
  for (const [dx, dz] of STREAMS.stones.list) {
    const sx = LANTERN_FOOT.x + dx,
      sz = LANTERN_FOOT.z + dz;
    for (let n = 0; n < D.eddy; n++) debris.push([sx, sz, true]);
  }
  for (
    let attempt = 0;
    debris.length < D.count + STREAMS.stones.list.length * D.eddy && attempt < 4000;
    attempt++
  ) {
    const s = between([STREAM_REEDS.from, line.length - 0.6]),
      [px, pz, fx, fz, half] = streamPoint(s),
      out = (random() < 0.5 ? -1 : 1) * between(D.waterline) * half,
      x = px - fz * out,
      z = pz + fx * out;
    if (Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < water + 0.4) continue;
    // Its whole footprint clear of the roots, as the gravel.
    if (rootCovered(x, z) || coverDistance(x, z, 0.2) <= 0.2) continue;
    debris.push([x, z, false]);
  }
  yield;
  for (const [sx, sz, eddy] of debris) {
    let x = sx,
      z = sz;
    if (eddy) {
      // Just downstream of the stone, in its slack water.
      const [, , fx, fz] = streamPoint(streamAlong(sx, sz)),
        back = Math.sign(STREAMS.flow) * between([0.12, 0.35]),
        across = between([-0.12, 0.12]);
      x += fx * back - fz * across;
      z += fz * back + fx * across;
    }
    const ground = surface(x, z);
    if (!Number.isFinite(ground)) continue;
    // Afloat where the water stands over the bed (at its level there), else on the bank.
    const y = Math.max(
        ground,
        streamRadius(x, z) < 1 ? foot + streamLevel(streamAlongAt, streamLength) + 0.004 : ground,
      ),
      yaw = random() * Math.PI * 2,
      cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      at = (u, w, lift) => [x + u * cy - w * sy, y + lift, z + u * sy + w * cy],
      dry = riverRadius(x, z) >= G.shore,
      draw = dry ? triangle : () => {};
    const start = positions.length;
    if (random() < D.twigs) {
      // A twig: a long, thin, rounded stick.
      const length = between(D.twig),
        k = between([0.6, 0.9]);
      pebbleDome(
        length / 2,
        0.012,
        0.018,
        random,
        at,
        [cy, sy],
        F.leafTone.map((c) => c * k),
        draw,
      );
      if (dry && finishPiece(start, eddy || streamRadius(x, z) >= 0.85)) {
        pieces.push(start / 3);
        floating++;
      }
      continue;
    }
    const length = between(F.leafSize),
      width = length * between([0.45, 0.62]),
      cup = width * between([0.12, 0.3]),
      age = random(),
      // Darker than the litter's leaves: wet, and lit by the lantern beside the water.
      rgb = F.leafTone.map((c, k) => c * (0.32 + 0.33 * age) * (k === 1 ? 1 - 0.15 * age : 1));
    fallenLeaf(at, length, width, cup, 0, 0.006, rgb, draw);
    if (dry && finishPiece(start, eddy || streamRadius(x, z) >= 0.85)) {
      pieces.push(start / 3);
      floating++;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute(
    "aGrass",
    new BufferAttribute(new Float32Array((positions.length / 3) * 2), 2),
  );
  geometry.computeBoundingSphere();
  geometry.userData.gravel = drawn;
  geometry.userData.debris = floating;
  // Balanced draws GROWTH.balanced of the pieces (estate-ground-detail.js).
  geometry.userData.fine = [0, positions.length / 3];
  geometry.userData.finePieces = pieces;
  return geometry;
}
// The drifting leaves (WATER_BANKS.drift): one small mesh whose leaves
// update(time) moves down the stream on the drips' clock (settleRoots()), so
// they hold still with the drips (reduced motion, a visitor pause). `foot`
// is the lantern's foot's height: they ride the water at its level there
// (streamLevel()).
export function driftLeaves(foot) {
  const D = WATER_BANKS.drift,
    F = LITTER.fine,
    line = STREAM_LINES[0],
    from = STREAM_REEDS.from,
    run = line.length - 0.4 - from;
  let seed = WATER_BANKS.seed + 7;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  // Each leaf: its local corners (u along, w across, lift), phase, yaw and turning rate.
  const leaves = Array.from({ length: D.count }, () => {
    const length = between(D.size),
      width = length * between([0.45, 0.62]),
      cup = width * between([0.12, 0.3]),
      age = random(),
      // Darker than the litter's leaves: wet, and lit by the lantern beside the water.
      rgb = F.leafTone.map((c, k) => c * (0.32 + 0.33 * age) * (k === 1 ? 1 - 0.15 * age : 1));
    const [[, A], [L1, M1, R1], [L2, M2, R2], [, T]] = [
      [0, 0],
      [0.3, 0.46],
      [0.65, 0.4],
      [1, 0],
    ].map(([u, h]) => [
      [(u - 0.5) * length, -h * width, cup],
      [(u - 0.5) * length, 0, 0],
      [(u - 0.5) * length, h * width, cup],
    ]);
    return {
      corners: [
        A,
        M1,
        L1,
        A,
        R1,
        M1,
        L1,
        M1,
        M2,
        L1,
        M2,
        L2,
        M1,
        R1,
        R2,
        M1,
        R2,
        M2,
        L2,
        M2,
        T,
        M2,
        R2,
        T,
      ],
      rgb,
      phase: random(),
      yaw: random() * Math.PI * 2,
      spin: (random() - 0.5) * 0.4,
      sway: random() * Math.PI * 2,
    };
  });
  const count = leaves.length * 24,
    positions = new Float32Array(count * 3),
    colors = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  leaves.forEach(({ rgb }, i) => {
    for (let v = 0; v < 24; v++) {
      colors.set(rgb, (i * 24 + v) * 3);
      normals.set([0, 1, 0], (i * 24 + v) * 3);
    }
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));
  geometry.setAttribute("aGrass", new BufferAttribute(new Float32Array(count * 2), 2));
  let last = NaN;
  function update(time) {
    if (time === last) return;
    last = time;
    leaves.forEach(({ corners, phase, yaw, spin, sway }, i) => {
      const along = from + ((((phase * run + time * STREAMS.flow * D.speed) % run) + run) % run),
        [px, pz, fx, fz, half] = streamPoint(along),
        scale = ease(0, D.fade, along - from) * ease(0, D.fade, from + run - along),
        across = D.wander * half * Math.sin(time * 0.3 + sway),
        x = px - fz * across,
        z = pz + fx * across,
        turn = yaw + time * spin,
        c = Math.cos(turn),
        si = Math.sin(turn);
      corners.forEach(([u, w, lift], v) => {
        positions.set(
          [
            x + (u * c - w * si) * scale,
            foot + streamLevel(along, line.length) + 0.006 + lift * scale,
            z + (u * si + w * c) * scale,
          ],
          (i * 24 + v) * 3,
        );
      });
    });
    geometry.attributes.position.needsUpdate = true;
  }
  update(0);
  geometry.computeBoundingSphere();
  // Its bounds hold the whole run of the stream, wherever the leaves are.
  const [x0, x1, z0, z1] = STREAMS_BOX;
  geometry.boundingSphere.center.set((x0 + x1) / 2, foot + STREAMS.bed.level, (z0 + z1) / 2);
  geometry.boundingSphere.radius = Math.hypot(x1 - x0, z1 - z0) / 2 + 0.5;
  geometry.userData.update = update;
  return geometry;
}
// How far along the stream's course the nearest point to x/z lies.
function streamAlong(x, z, line = STREAM_LINES[0]) {
  let best = Infinity,
    along = 0;
  const p = line.points;
  for (let k = 1; k < p.length; k++) {
    const [ax, az, s0] = p[k - 1],
      ex = p[k][0] - ax,
      ez = p[k][1] - az,
      h = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez))),
      d = Math.hypot(x - ax - ex * h, z - az - ez * h);
    if (d < best) {
      best = d;
      along = s0 + h * Math.hypot(ex, ez);
    }
  }
  return along;
}

// The ground draws only with its ancestors shown, and The watch hides the environment and with
// it the lantern's light. A program linked meanwhile would key no point light, and the cut's
// first draw would link the right one in one blocking compile (seconds on a first visit). So
// links of the ground's programs, and the state checks that accept them, run with the
// ground's chain shown: they key the lights the ground will draw with.
export function withChainShown(object, run) {
  const hidden = [];
  for (let node = object?.parent; node; node = node.parent)
    if (!node.visible) {
      hidden.push(node);
      node.visible = true;
    }
  try {
    return run();
  } finally {
    for (const node of hidden) node.visible = false;
  }
}

// A tree opening links the slate's shaded program (its "+root" key: the scene's longest link,
// seconds on a first visit) on a detached stand-in as soon as the ground's maps and the scene's
// lights are final, so it links beside the terrain's build rather than after it. settleRoots()
// then takes the same program from Three's cache; release() frees the stand-in once it has.
// Null where the ground takes no root shading or programs cannot link in parallel.
export function prelinkSlateGround(ground, rendering) {
  const renderer = rendering?.renderer,
    material = ground?.material;
  if (
    !material ||
    typeof rendering.compilePrograms !== "function" ||
    typeof renderer?.compile !== "function" ||
    renderer.extensions?.has?.("KHR_parallel_shader_compile") !== true ||
    renderer.getContext?.()?.isContextLost?.()
  )
    return null;
  // The shading's uniforms only bind values; the program's source is the same.
  const coastRock = {
      coastStudy: { value: 0 },
      coastAlbedo: { value: null },
      coastAlbedoOn: { value: 0 },
      coastDetail: { value: null },
      coastDetailOn: { value: 0 },
    },
    shade = (shader) => shadeSlateGround(shader, coastRock);
  material.userData.slateRoot = shade;
  const key = material.customProgramCacheKey?.();
  delete material.userData.slateRoot;
  if (typeof key !== "string" || !key.endsWith("+root")) return null;
  const stand = new Mesh(
    ground.geometry,
    Object.assign(material.clone(), {
      customProgramCacheKey: () => key,
      onBeforeCompile(shader, target) {
        material.onBeforeCompile(shader, target);
        shade(shader);
      },
    }),
  );
  let live = true;
  const previous = renderer.getRenderTarget?.() ?? null;
  try {
    renderer.setRenderTarget?.(rendering.composer?.readBuffer ?? null);
    withChainShown(ground, () =>
      rendering.compilePrograms(
        renderer,
        stand,
        rendering.camera,
        rendering.homeScene,
        () => live && !renderer.getContext?.()?.isContextLost?.(),
      ),
    );
  } catch {
    // The terrain's own link (settleRoots()) remains.
  } finally {
    renderer.setRenderTarget?.(previous);
  }
  return {
    release() {
      if (!live) return;
      live = false;
      stand.material.dispose();
    },
  };
}

// Prepare the film terrain's tufts, shore and shading, then land them together
// over film-scene.js's borrowed geometry. The returned sampler's ready promise
// settles at its first commit; setActive(false) withdraws the tuple, and its
// height and shore then follow the borrowed ground until a new eligible cut.
// Tufts and optional litter follow the rendered surface. The slate's shading
// (shadeSlateGround(): the puddle mirror and the root shading) never holds the
// reveal or links in a draw: once the canvas shows, its program links on a
// detached stand-in, and the ground switches to it where the change cannot
// show mid-shot: on a tour cut, on any frame while the tour is not running,
// or in the fade-in's first SHADING_EARLY ms. A light, map or quality change
// that alters the ground's program meanwhile links it again first. Where
// programs cannot link in parallel, the switch's own draw links it, on a cut
// (or a still frame), never in the fade-in. From the switch on, each draw of
// the ground brings the moon key's view direction up to date and advances the
// drips' clock. Disposing the terrain withdraws all of it.
export function settleRoots(
  terrain,
  ground,
  rendering,
  groundHeight,
  invalidate = () => {},
  tour = null,
  lib = null,
) {
  let landed = ground.geometry === terrain,
    resolveReady,
    openingPreparing = false,
    opening = null,
    rootDetails = Promise.resolve(true),
    bankDetails = Promise.resolve(true),
    resolveForeground;
  const foregroundReady = new Promise((resolve) => (resolveForeground = resolve)),
    openingState = { terrain: false, details: false, foreground: false, failed: false };
  const liftAt = terrainLift(terrain),
    material = ground.material,
    landHeight = filmHeight(groundHeight, true),
    originalGeometry = lib?.originalGeometry ?? ground.geometry;
  const coastHeight = terrain.userData.riverCoastHeight ?? landHeight;
  // The shelf's bindings for the coast's albedo and detail maps (ocean.js lends them).
  const previousRock = material.userData.coastRockUniforms,
    coastRock = {
      coastStudy: lib?.COAST_MOOD ?? { value: 0 },
      coastAlbedo: { value: null },
      coastAlbedoOn: { value: 0 },
      coastDetail: { value: null },
      coastDetailOn: { value: 0 },
    },
    shadeGround = (shader) => shadeSlateGround(shader, coastRock);
  material.userData.coastRockUniforms = coastRock;
  // The walk follows the visible surface and fault. Asynchronous rock builds
  // take the stable film height, even if film withdraws while their GLBs load.
  const film = (x, z) =>
    coastDistance(x, z) < SHORE.shelf ? coastHeight(x, z) : landHeight(x, z) + liftAt(x, z);
  const height = Object.assign((x, z) => (landed ? film(x, z) : groundHeight(x, z)), {
    film,
    shore: (x, z) => (landed ? coastDistance(x, z) : Infinity),
    ready: new Promise((resolve) => (resolveReady = resolve)),
    openingState,
  });
  const growth = ground.parent?.getObjectByName("estate-ground-growth");
  let litter = null,
    rushes = null,
    drift = null,
    tuftsSettled = false,
    foreground = null,
    foregroundFrame = null,
    foregroundTried = false;
  const extras = [];
  // The water's banks, built in idle slices once the shading has switched
  // (commit()), so they never hold its early switch.
  let buildRoots = () => {},
    buildBanks = () => {},
    seatBanks = () => {};
  if (growth?.geometry.attributes.position) {
    if (landed) {
      settleTufts(growth, liftAt);
      tuftsSettled = true;
    }
    const seat = (mesh) => {
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      growth.add(mesh);
    };
    // The stream's reeds, the water's banks (gravel, leaves and twigs) and its
    // drifting leaves follow the shading's switch in idle slices, so they never
    // hold its early switch, and join the scene only where that cannot show
    // mid-shot (unseen(): in the fade-in, on a cut or while the tour is still).
    const surface = terrainHeight(terrain),
      soil = material.color ?? { r: 0.36, g: 0.31, b: 0.28 },
      unseenNow = unseen(rendering, tour),
      landable = () => landed && active && (hiddenOpening() || unseenNow());
    // Optional litter and rushes build detached in idle slices. Tuft seating
    // and the rocks' analytic height stay immediate; neither the reveal nor
    // the ground's shading link waits for these meshes.
    buildRoots = () =>
      inSlices(
        (function* () {
          const built = [];
          let finished = false;
          try {
            const geometry = yield* litterSteps(surface, soil);
            built.push(
              Object.assign(new Mesh(geometry, growth.material), { name: "estate-root-litter" }),
            );
            yield;
            const reeds = yield* rushSteps(surface);
            built.push(
              Object.assign(new Mesh(reeds, growth.material), { name: "estate-river-rushes" }),
            );
            finished = true;
            return built;
          } finally {
            if (!finished) for (const mesh of built) mesh.geometry.dispose();
          }
        })(),
        () => hiddenOpening(),
        () => !live,
        () => {
          if (hiddenOpening()) rendering.openingProgress = (rendering.openingProgress ?? 0) + 1;
        },
      )
        .then(
          (built) =>
            new Promise((resolve) => {
              if (!built) return resolve(false);
              (function land() {
                if (!live) {
                  built.forEach((mesh) => mesh.geometry.dispose());
                  return resolve(false);
                }
                if (!landable()) return nextFrame(land);
                [litter, rushes] = built;
                built.forEach(seat);
                growth.userData.retier?.();
                invalidate();
                resolve(true);
              })();
            }),
        )
        .catch(() => false);
    seatBanks = (built) => {
      built.forEach(seat);
      extras.push(...built);
      drift = built[2];
      growth.userData.retier?.();
    };
    buildBanks = () =>
      inSlices(
        (function* () {
          const reeds = plantReeds(surface);
          yield;
          const banks = yield* bankSteps(surface, soil);
          return [
            [reeds, "estate-stream-reeds"],
            [banks, "estate-water-banks"],
            [driftLeaves(surface(LANTERN_FOOT.x, LANTERN_FOOT.z)), "estate-drift-leaves"],
          ].map(([geometry, name]) => Object.assign(new Mesh(geometry, growth.material), { name }));
        })(),
        () => hiddenOpening(),
        () => !live,
        () => {
          if (hiddenOpening()) rendering.openingProgress = (rendering.openingProgress ?? 0) + 1;
        },
      )
        .then(
          (built) =>
            new Promise((resolve) => {
              if (!built) return resolve(false);
              (function land() {
                if (!live) {
                  built.forEach((mesh) => mesh.geometry.dispose());
                  return resolve(false);
                }
                if (!landable()) return nextFrame(land);
                seatBanks(built);
                invalidate();
                resolve(true);
              })();
            }),
        )
        .catch(() => false);
  }
  const renderer = rendering.renderer,
    scene = rendering.homeScene,
    early = earlyFade(rendering, SHADING_EARLY);
  const hiddenOpening = () =>
    (openingPreparing || rendering.openingPreparing === true) &&
    !renderer?.domElement?.parentNode?.classList?.contains("is-ready");
  const allowed = () =>
    hiddenOpening() ||
    !tour?.running ||
    tour.transition.cut ||
    tour.waiting === true ||
    (parallel && early());
  const clock = dripClock(RIPPLE_TIME, motionHeld()),
    keyWorld = new Vector3(),
    keyTarget = new Vector3();
  const lampAt = new Vector3(),
    eye = new Vector3(),
    lean = new Vector3(),
    origin = new Vector3();
  let live = true,
    active = lib?.active ?? true,
    checking = false,
    probe = null,
    linking = false,
    linked = "",
    linkingState = "",
    clocked = false,
    lamp = null,
    sought = -Infinity,
    aimed = null,
    aim = null,
    parallel = false;
  // The lantern's light (found by its place, as the mirror finds it among the
  // point lights; looked for at most once a second while missing).
  function lantern() {
    const near = (light) =>
      light.parent &&
      Math.hypot(light.getWorldPosition(lampAt).x - LANTERN_FOOT.x, lampAt.z - LANTERN_FOOT.z) <
        0.3;
    if (lamp && near(lamp)) return lamp;
    lamp = null;
    const now = performance.now();
    if (now - sought < 1000) return null;
    sought = now;
    scene?.traverse((object) => {
      if (!lamp && object.isPointLight && near(object)) lamp = object;
    });
    if (lamp) lamp.getWorldPosition(lampAt);
    return lamp;
  }
  // Per draw of the shaded ground: the key's view direction (the live light,
  // so it matches three's own), the drips, and the flame's draught: the flame
  // module (lantern-flame.js) keeps its flicker on the lantern root, beside the
  // light; without it the mirror shows no flame.
  function beforeRender(_renderer, _scene, camera) {
    // Optional coast maps never hold the reveal and only enter on an unseen
    // tour cut. A cached map can rejoin after the film was withdrawn.
    const revealed = Boolean(renderer?.domElement?.parentNode?.classList?.contains("is-ready"));
    for (const part of shore)
      part.take?.({
        revealed,
        running: Boolean(tour?.running),
        cut: Boolean(tour?.transition.cut),
      });
    const sun = rendering.lights?.sun;
    if (sun?.target)
      keyWorld
        .setFromMatrixPosition(sun.matrixWorld)
        .sub(keyTarget.setFromMatrixPosition(sun.target.matrixWorld));
    else keyWorld.set(...KEY_LIGHT);
    KEY_VIEW.value.copy(keyWorld).transformDirection(camera.matrixWorldInverse);
    const light = lantern(),
      flame = light?.parent.children.find((child) => child.userData?.lanternFlicker);
    const flicker = flame?.userData.lanternFlicker.value,
      draught = FLAME_DRAUGHT.value;
    if (flicker) {
      origin.setFromMatrixPosition(flame.matrixWorld);
      lean
        .set(flicker[2], 0, flicker[3])
        .applyMatrix4(flame.matrixWorld)
        .sub(origin)
        .divideScalar(LANTERN_IMAGE.scale);
      draught[0] = flicker[1];
      draught[2] = lean.x;
      draught[3] = lean.z;
    } else draught.fill(0);
    // A drip into the lantern's puddle falls near its image, as this camera
    // sees it when the drip lands.
    camera.getWorldPosition(eye);
    const drip = dripAt(clock.tick(performance.now()), (n) => {
      if (aimed !== n) {
        aimed = n;
        aim = light ? mirrorPoint(eye, lampAt) : null;
      }
      return aim;
    });
    DRIP.value[3] = drip ? 1 : 0;
    if (drip) [DRIP.value[0], DRIP.value[1], DRIP.value[2]] = drip;
    drift?.geometry.userData.update(RIPPLE_TIME.value);
  }
  // Releasing a probe invalidates the old bounded readiness poll. A timeout
  // need not finish the driver's link: retire its owned material only after
  // that work settles, keeping shared geometry and maps borrowed.
  const release = () => {
    const stale = probe;
    probe = null;
    stale?.userData.settled.then(() =>
      rendering.retireMaterial
        ? rendering.retireMaterial(stale.material)
        : stale.material.dispose(),
    );
  };
  // The sea, the cliffs and the falls (ocean.js) meet the terrain's fault: their
  // programs link with the slate's shading (link()) and they land with it
  // (commit(), unseen), the ranges past the fault sinking then
  // (hill-silhouette.js SEA_SINK); all of it goes with the terrain.
  const seaClock = dripClock(SEA_TIME, motionHeld()),
    drop = riverFalls(RIVER_LINE),
    seaside = lib && rendering?.homeScene && ground.parent;
  // The river pours off the cliff where it meets the fault (ocean.js riverFalls()).
  const falls =
    seaside && drop
      ? createFalls({
          lib,
          clock: seaClock,
          rendering,
          drop,
          height: coastHeight,
          flow: RIPPLE_TIME,
        })
      : null;
  const shore = seaside
    ? [
        createSea({ lib, clock: seaClock, rendering, plunge: falls?.plunge, sheet: falls?.sheet }),
        createCliff({
          lib,
          clock: seaClock,
          rendering,
          height: coastHeight,
          groundMaterial: material,
          prepared: terrain.userData.coastGeometry,
          drop,
          plunge: falls?.plunge,
        }),
        ...(falls ? [falls] : []),
      ]
    : [];
  // The fault's own shots (ocean.js COAST_SHOTS) join the tree's list, and
  // with it the tour, while the sea stands.
  const coastShots =
      shore.length && lib.DIRECTED_SHOTS
        ? COAST_SHOTS.map((shot) => coastShot(shot, ground.parent, falls))
        : [],
    shotList = lib?.DIRECTED_SHOTS?.tree;
  // Optional camera-near cover borrows the entry's providers. Keeping the
  // lazy field independent of entry modules avoids a new shared boot chunk.
  height.updateForeground = (frame = {}) => {
    if (frame.revealed) openingPreparing = false;
    foregroundFrame = frame;
    if (foreground) {
      foreground.setActive(active && landed);
      foreground.update(frame);
      if (openingPreparing) {
        openingState.foreground = ["ready", "fallback"].includes(foreground.state.openingStatus);
        openingState.foregroundStatus = foreground.state.openingStatus;
      }
      return;
    }
    if (
      foregroundTried ||
      !live ||
      !active ||
      !landed ||
      (!frame.revealed && !frame.preparing) ||
      (frame.preparing && !openingState.details) ||
      !frame.camera ||
      frame.profile?.tier === "low" ||
      !ground.parent ||
      !lib?.createCinematicCamera ||
      !lib?.cinematicSafeArea ||
      !lib?.grassMaterial ||
      !lib?.GROWTH ||
      !lib?.ESTATE ||
      !lib?.estatePathDistance ||
      !lib?.rockKeepouts ||
      !ground.parent.getObjectByName("supplied-meshy-tree")
    )
      return;
    foregroundTried = true;
    const root = ground.parent,
      color = material.color ?? { r: 0.36, g: 0.31, b: 0.28 };
    void import("./foreground-detail.js")
      .then(({ prepareForegroundDetail }) =>
        prepareForegroundDetail({
          root,
          terrain,
          surface: terrainHeight(terrain),
          soil: [color.r, color.g, color.b].map((v) => v * LITTER.albedo),
          plunge: falls?.plunge,
          legacy: () =>
            [litter, ...extras].filter((mesh) => mesh?.geometry).map((mesh) => mesh.geometry),
          windTime: growth?.material.userData.grassTime,
          rendering,
          openingFrame: frame.preparing ? frame : null,
          invalidate,
          cancelled: () => !live,
          helpers: {
            ...lib,
            coastDistance,
            FALLS,
            SPRAY_FIT,
            coastBedrockWeight,
            loosePebbleBurial,
            LANTERN_FOOT,
            ROOT_LATTICE,
            rootCovered,
            rootOcclusion,
            PUDDLE_ZONES,
            streamRadius,
            TREE_FOOTING,
            TRUNK,
            zoneDistance,
          },
        }),
      )
      .then((detail) => {
        if (!detail) return;
        if (!live) return detail.dispose();
        foreground = detail;
        root.add(detail.group);
        detail.setActive(active && landed);
        if (foregroundFrame) detail.update(foregroundFrame);
        resolveForeground(detail);
        invalidate();
      })
      .catch(() => resolveForeground(null));
  };
  height.prepareOpening = (frame = {}) => {
    foregroundFrame = { ...frame, preparing: true, revealed: false };
    openingPreparing = true;
    if (foreground && openingState.details) {
      const next = foreground.prepareOpening(foregroundFrame);
      openingState.foreground = ["ready", "fallback"].includes(foreground.state.openingStatus);
      openingState.foregroundStatus = foreground.state.openingStatus;
      return next.then((ready) => {
        openingState.foreground = ready;
        openingState.foregroundStatus = foreground.state.openingStatus;
        return ready;
      });
    }
    if (opening) return opening;
    opening = (async () => {
      if (!live || (await height.ready) === false) return false;
      openingState.terrain = true;
      const details = await Promise.all([rootDetails, bankDetails]);
      if (!live || details.includes(false)) return false;
      openingState.details = true;
      height.updateForeground(foregroundFrame);
      if (!foregroundTried) {
        openingState.foreground = true;
        openingState.foregroundStatus = "fallback";
        return true;
      }
      const detail = await foregroundReady;
      if (!live) return false;
      if (!detail) {
        openingState.foreground = true;
        openingState.foregroundStatus = "fallback";
        return true;
      }
      const ready = await detail.prepareOpening(foregroundFrame);
      openingState.foreground = ready;
      openingState.foregroundStatus = detail.state.openingStatus;
      return ready;
    })().then(
      (ready) => {
        openingState.failed = !ready;
        return ready;
      },
      () => {
        openingState.failed = true;
        return false;
      },
    );
    if (!checking) check();
    return opening;
  };
  const landShore = () => {
    if (!shore.length || shore[0].mesh.parent || !ground.parent) return;
    for (const part of shore) {
      ground.parent.add(part.mesh);
      part.setActive?.(true);
    }
    for (const shot of coastShots) if (!shotList.includes(shot)) shotList.push(shot);
    const sink = lib.SEA_SINK?.value;
    if (sink) [sink.x, sink.y, sink.z, sink.w] = [...coastPlane(), 1];
    if (globalThis.BabelSite?.sceneDebug) globalThis.BabelSite.sceneDebug.sea = "ready";
  };
  height.setActive = (next) => {
    active = Boolean(next);
    foreground?.setActive(active && landed);
    if (active) {
      if (live && !landed && !checking) check();
      return;
    }
    if (ground.geometry === terrain) ground.geometry = originalGeometry;
    landed = false;
    for (const part of shore) {
      part.setActive?.(false);
      part.mesh.removeFromParent();
    }
    for (const shot of coastShots)
      if (shotList.includes(shot)) shotList.splice(shotList.indexOf(shot), 1);
    if (lib?.SEA_SINK) lib.SEA_SINK.value.w = 0;
    if (globalThis.BabelSite?.sceneDebug) delete globalThis.BabelSite.sceneDebug.sea;
    if (material.userData.slateRoot === shadeGround) {
      delete material.userData.slateRoot;
      material.needsUpdate = true;
    }
    if (ground.onBeforeRender === beforeRender) delete ground.onBeforeRender;
    if (ground.onAfterRender === afterRender) delete ground.onAfterRender;
    if (ground.userData.slateDrips === clock) delete ground.userData.slateDrips;
    release();
    linking = false;
    linked = "";
    if (live) invalidate();
  };
  terrain.addEventListener("dispose", () => {
    live = false;
    resolveForeground(null);
    foreground?.dispose();
    height.setActive(false);
    resolveReady(false);
    for (const part of shore.splice(0)) part.dispose();
    if (material.userData.coastRockUniforms === coastRock) {
      if (previousRock) material.userData.coastRockUniforms = previousRock;
      else delete material.userData.coastRockUniforms;
    }
    if (litter) {
      litter.removeFromParent();
      litter.geometry.dispose();
    }
    if (rushes) {
      rushes.removeFromParent();
      rushes.geometry.dispose();
    }
    for (const mesh of extras.splice(0)) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
  });
  rootDetails = buildRoots();
  const shadedKey = () => {
    material.userData.slateRoot = shadeGround;
    const key = material.customProgramCacheKey?.();
    delete material.userData.slateRoot;
    return key;
  };
  // Everything that enters the shaded program's key: the slate's key and
  // state, and the lights and shadows visible where the ground draws.
  const programState = () => {
    let state = `${shadedKey()}|${material.version}|${Boolean(renderer?.shadowMap?.enabled)}`;
    withChainShown(ground, () =>
      scene?.traverseVisible((object) => {
        if (object.isLight) state += `|${object.type}${object.castShadow ? "+" : ""}`;
      }),
    );
    return state;
  };
  function link() {
    const state = programState(),
      key = shadedKey();
    release();
    linkingState = state;
    // Only a slate that takes the shading has a new program, and only where
    // programs link in parallel; otherwise the switch's draw links it.
    parallel =
      typeof key === "string" &&
      key.endsWith("+root") &&
      typeof rendering.compilePrograms === "function" &&
      typeof renderer?.compile === "function" &&
      renderer.extensions?.has?.("KHR_parallel_shader_compile") === true &&
      !renderer.getContext?.()?.isContextLost?.();
    if (!parallel) {
      linked = state;
      return;
    }
    const stand = new Mesh(
      terrain,
      Object.assign(material.clone(), {
        customProgramCacheKey: () => key,
        onBeforeCompile(shader, target) {
          material.onBeforeCompile(shader, target);
          shadeGround(shader);
        },
      }),
    );
    // Against a composer target, whose program keys the scene pass uses
    // (rendering.compileShaders()), with the scene's lights and fog.
    const properties = renderer.properties;
    const valid = () =>
      live &&
      probe === stand &&
      renderer.properties === properties &&
      !renderer.getContext?.()?.isContextLost?.();
    stand.userData.valid = valid;
    probe = stand;
    linking = true;
    // The shore's programs link beside the stand-in's, before the shore lands.
    const waiting = shore.filter(({ mesh }) => !mesh.parent).map(({ mesh }) => mesh),
      batch = waiting.length ? new Group().add(stand, ...waiting) : stand;
    // The poll waits up to LINK_WAIT_MS of visible time: accepting a link still compiling
    // would leave the rest of the compile to the switch's draw, which blocks for it.
    const previous = renderer.getRenderTarget?.() ?? null;
    let pending = null;
    try {
      renderer.setRenderTarget?.(rendering.composer?.readBuffer ?? null);
      pending = withChainShown(ground, () =>
        rendering.compilePrograms(renderer, batch, rendering.camera, scene, valid, LINK_WAIT_MS),
      );
    } catch {
      pending = null;
    } finally {
      renderer.setRenderTarget?.(previous);
      if (batch !== stand) batch.remove(...batch.children);
    }
    stand.userData.settled = Promise.resolve(pending).catch(() => {});
    // A link still pending after LINK_WAIT_MS is left to the switch's draw.
    stand.userData.settled.then(() => {
      if (probe !== stand) return;
      linking = false;
      if (!valid()) {
        release();
        return;
      }
      linked = state;
    });
  }
  function afterRender() {
    delete ground.onAfterRender;
    release();
  }
  function commit() {
    ground.geometry = terrain;
    landed = true;
    if (!tuftsSettled && growth?.geometry.attributes.position) {
      settleTufts(growth, liftAt);
      tuftsSettled = true;
    }
    material.userData.slateRoot = shadeGround;
    material.needsUpdate = true;
    // Then the water's banks are built, in idle slices.
    if (!clocked) bankDetails = buildBanks();
    // The water first shows now: its drips start in a calm gap.
    if (!clocked) {
      clocked = true;
      clock.reset();
    }
    ground.onBeforeRender = beforeRender;
    // Scripted review can read or set the drips' time here.
    ground.userData.slateDrips = clock;
    // Hold the stand-in's program until the ground has drawn with it.
    if (probe) ground.onAfterRender = afterRender;
    landShore();
    resolveReady(true);
    rendering.invalidateShadows?.();
    invalidate();
  }
  function check() {
    checking = false;
    if (!live || !active) return;
    // r160 replaces renderer.properties on restoration. Identity catches a
    // loss and restore between poll ticks, even when isContextLost() is false.
    if (probe && !probe.userData.valid()) {
      release();
      linking = false;
      linked = "";
    }
    if (renderer?.getContext?.()?.isContextLost?.()) {
      checking = true;
      return nextFrame(check);
    }
    const container = renderer?.domElement?.parentNode;
    if (
      !linking &&
      !linked &&
      (hiddenOpening() || !container || container.classList?.contains("is-ready"))
    )
      link();
    // A hidden opening commits while the program still links: nothing draws the ground
    // before the opening's own shader warm-up, which waits for it, and the terrain's
    // details build meanwhile.
    const ready = linked || (linking && hiddenOpening() ? linkingState : "");
    if (ready && allowed()) {
      if (ready === programState()) return commit();
      linked = "";
    }
    checking = true;
    nextFrame(check);
  }
  check();
  return height;
}

// POOL_FIELD over a w x h grid of heights (row by row); at(i, j) gives a
// vertex's world [x, z].
export function poolField(heights, w, h, at) {
  return buildNow(poolFieldSteps(heights, w, h, at));
}
function* poolFieldSteps(heights, w, h, at) {
  const r = POOL_FIELD.mean,
    across = new Float32Array(w * h),
    cavity = new Float32Array(w * h);
  const box = (source, target, n, index) => {
    for (let k = 0; k < n; k++) {
      let sum = 0,
        count = 0;
      for (let d = -r; d <= r; d++)
        if (k + d >= 0 && k + d < n) {
          sum += source[index(k + d)];
          count++;
        }
      target[index(k)] = sum / count;
    }
  };
  for (let j = 0; j < h; j++) {
    box(heights, across, w, (i) => j * w + i);
    yield;
  }
  const mean = new Float32Array(w * h);
  for (let i = 0; i < w; i++) {
    box(across, mean, h, (j) => j * w + i);
    yield;
  }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const edge = Math.min(i, j, w - 1 - i, h - 1 - j) - r;
      if (edge < 0) continue;
      const [x, z] = at(i, j);
      cavity[j * w + i] =
        (mean[j * w + i] - heights[j * w + i]) *
        pinKeep(x, z) *
        Math.min(1, (edge + 1) / POOL_FIELD.edge);
      if (i % 16 === 15) yield;
    }
  return cavity;
}

// The fine root grid refines the coarse cells whose centres lie within this
// window about the tree (tree-relative x and z): 15 either side of 3 east of
// the tree, and two cells further east, where the knoll's rim falls into the
// dune hollow.
export const FINE_WINDOW = Object.freeze({
  x: Object.freeze([-12, 24]),
  z: Object.freeze([-15, 15]),
});
function terrainAxis(width, subdivisions, [lo, hi]) {
  const axis = [],
    step = width / subdivisions;
  for (let i = 0; i < subdivisions; i++) {
    const start = -width / 2 + i * step;
    const pieces = start + step / 2 > lo && start + step / 2 < hi ? 4 : 1;
    for (let j = 0; j < pieces; j++) axis.push(start + (step * j) / pieces);
  }
  axis.push(width / 2);
  return axis;
}

// Beyond this distance from the tree no support reaches: past the rim of the
// knoll's core and every lobe (wobble included) and the relief's reach about
// the trunk, every crook hollow and the triangles about every banked lattice
// vertex.
const SUPPORT_REACH =
  Math.max(
    Math.hypot(...TRUNK) +
      Math.max(
        ROOT_KNOLL.core[0] + ROOT_KNOLL.core[1],
        ...ROOT_KNOLL.lobes.map(([, reach, half, side, end]) => reach + half + end),
        ROOT_RELIEF.reach[1] - ROOT_KNOLL.wobble[0],
      ) +
      ROOT_KNOLL.wobble[0],
    ...ROOT_HOLLOWS.map(([x, z, radius]) => Math.hypot(x, z) + radius),
    ...ROOT_RESTS.map(
      ([col, row]) =>
        Math.hypot(
          ROOT_LATTICE.x + col * ROOT_LATTICE.pitch - TREE_FOOTING.x,
          ROOT_LATTICE.z + row * ROOT_LATTICE.pitch - TREE_FOOTING.z,
        ) +
        ROOT_LATTICE.pitch * Math.SQRT2,
    ),
  ) + 0.5;
const OPEN_SOIL = [3, 0, 0, 1];

// The plain's level, restating mud-ground.js TERRAIN_BASE (a test holds them
// equal): this chunk imports no first-party code.
export const TERRAIN_BASE = 1.25;
// Coarse triangles wholly below this height lie under the sea (ocean.js SEA.level).
const SEA_CULL = SEA.level - 0.6;
// The sea's own clock (its swell, waves and surf), held as the drips' are.
const SEA_TIME = { value: 0 };

// The film terrain's analytic height over a base (the procedural ground): the
// dunes blended out beyond 88 units, the foothills (open along the river and
// fading before the fault), and past the fault the fall to the seabed
// (ocean.js), unless `land` asks for the plain's own height there (the cliff's
// shelf).
export function filmHeight(baseHeight, land = false) {
  return (x, z) => {
    const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - 88) / 25));
    // The foothills open where the river crosses them (valleyGap()).
    let hills = foothillHeight(x, z);
    if (hills > 0 && RIVER.valley) hills *= 1 - valleyGap(x, z);
    const d = coastDistance(x, z);
    if (hills > 0) hills *= landFactor(d);
    const h =
      TERRAIN_BASE +
      (t < 1 ? (baseHeight(x, z) - TERRAIN_BASE) * (1 - t * t * (3 - 2 * t)) : 0) +
      hills;
    return land ? h : coastLand(d, h);
  };
}

// The film terrain's surface before the root supports (filmHeight()), a few
// rows at a time. Returns its sampler: height, and optionally the shading
// normal, at x/z.
function* coarseSurface(baseHeight, EARTH) {
  // Beyond the blend the base term is exactly the plain's level; its swell is
  // not evaluated there.
  const groundHeight = filmHeight(baseHeight);
  // First reconstruct the pre-support surface, including its triangle planes
  // and normals, at the float precision the coarse grid stores. Re-sampling
  // the analytic dunes on a finer grid would itself change the puddle's slopes
  // and reflections even with zero support lift.
  const n = EARTH.subdivisions,
    side = n + 1,
    cell = EARTH.width / n,
    half = EARTH.width / 2;
  const step = EARTH.width / EARTH.subdivisions / 2,
    normal = new Vector3();
  const heights = new Float32Array(side * side),
    normals = new Float32Array(side * side * 3);
  // Neighbouring vertices share their finite-difference taps (a vertex's
  // right tap is the next one's left, its upper tap the next row's lower);
  // each is evaluated once when the two sample points are the same.
  const above = new Float64Array(side);
  let previousZ = NaN;
  for (let row = 0; row < side; row++) {
    const z = Math.fround(row * cell - half),
      shared = previousZ + step === z - step;
    let previousX = NaN,
      right = 0;
    for (let col = 0; col < side; col++) {
      const i = row * side + col,
        x = Math.fround(col * cell - half);
      heights[i] = groundHeight(x, z);
      const left = previousX + step === x - step ? right : groundHeight(x - step, z);
      right = groundHeight(x + step, z);
      const below = shared ? above[col] : groundHeight(x, z - step);
      above[col] = groundHeight(x, z + step);
      const dx = (right - left) / (2 * step);
      const dz = (above[col] - below) / (2 * step);
      normal.set(-dx, dz, 1).normalize();
      normals[i * 3] = normal.x;
      normals[i * 3 + 1] = normal.y;
      normals[i * 3 + 2] = normal.z;
      previousX = x;
      if (col % 16 === 15) yield;
    }
    previousZ = z;
    yield;
  }
  function sample(x, z, target) {
    const u = Math.min(n, Math.max(0, (x + EARTH.width / 2) / (2 * step)));
    const v = Math.min(n, Math.max(0, (z + EARTH.width / 2) / (2 * step)));
    const col = Math.min(Math.floor(u), n - 1),
      row = Math.min(Math.floor(v), n - 1);
    const fx = u - col,
      fz = v - row,
      a = row * (n + 1) + col;
    const b = a + n + 1,
      d = a + 1,
      lower = fx + fz <= 1;
    const i0 = lower ? a : b,
      i1 = lower ? b : b + 1,
      w0 = lower ? 1 - fx - fz : 1 - fx;
    const w1 = lower ? fz : fx + fz - 1,
      w2 = lower ? fx : 1 - fz;
    let height = 0;
    height += heights[i0] * w0;
    height += heights[i1] * w1;
    height += heights[d] * w2;
    if (target) {
      target.set(0, 0, 0);
      target.x += normals[i0 * 3] * w0;
      target.y += normals[i0 * 3 + 1] * w0;
      target.z += normals[i0 * 3 + 2] * w0;
      target.x += normals[i1 * 3] * w1;
      target.y += normals[i1 * 3 + 1] * w1;
      target.z += normals[i1 * 3 + 2] * w1;
      target.x += normals[d * 3] * w2;
      target.y += normals[d * 3 + 1] * w2;
      target.z += normals[d * 3 + 2] * w2;
    }
    return height;
  }
  return sample;
}

// That surface built at once (tools/bake-root-shade.mjs measures the roots
// against it).
export function terrainSurface(groundHeight, EARTH = { width: 384, subdivisions: 128 }) {
  const steps = coarseSurface(groundHeight, EARTH);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

// The film terrain, a few vertices at a time: the coarse dune grid, then a
// grid refined around the roots and raised onto their supports, then its
// triangles. Returns the geometry.
// Conforming subdivision only along the wet course. A marked edge is shared
// by both neighbours, so its midpoint cannot leave a T-junction in dry soil.
// The cap is appended after the bed index range and shares its material/draw.
function* riverSurfaceSteps(geometry, sample, landHeight, EARTH) {
  const channel = riverChannel(landHeight),
    arrays = Object.fromEntries(
      Object.entries(geometry.attributes).map(([name, attribute]) => [
        name,
        { size: attribute.itemSize, data: Array.from(attribute.array) },
      ]),
    ),
    p = arrays.position.data,
    normal = new Vector3();
  let indices = Array.from(geometry.index.array);
  const key = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const midpoint = (a, b) => {
    const at = p.length / 3;
    for (const { size, data } of Object.values(arrays))
      for (let k = 0; k < size; k++) data.push((data[a * size + k] + data[b * size + k]) / 2);
    return at;
  };
  for (let round = 0; round < 3; round++) {
    const edges = new Map();
    for (let i = 0; i < indices.length; i += 3) {
      const corners = indices.slice(i, i + 3);
      for (let k = 0; k < 3; k++) {
        const a = corners[k],
          b = corners[(k + 1) % 3],
          ax = p[a * 3],
          az = -p[a * 3 + 1],
          bx = p[b * 3],
          bz = -p[b * 3 + 1],
          length = Math.hypot(ax - bx, az - bz),
          x = (ax + bx) / 2,
          z = (az + bz) / 2;
        if (
          length > RIVER_CHANNEL.pitch * 1.43 &&
          coastDistance(x, z) >= -2 &&
          riverWithin(x, z, RIVER_BED.reach[1] + length / RIVER.width)
        ) {
          const id = key(a, b);
          if (!edges.has(id)) edges.set(id, midpoint(a, b));
        }
      }
      if (i % 768 === 0) yield;
    }
    if (!edges.size) break;
    const next = [];
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3),
        ab = edges.get(key(a, b)),
        bc = edges.get(key(b, c)),
        ca = edges.get(key(c, a)),
        mask =
          Number(ab !== undefined) |
          (Number(bc !== undefined) << 1) |
          (Number(ca !== undefined) << 2);
      if (mask === 0) next.push(a, b, c);
      else if (mask === 1) next.push(a, ab, c, ab, b, c);
      else if (mask === 2) next.push(b, bc, a, bc, c, a);
      else if (mask === 4) next.push(c, ca, b, ca, a, b);
      else if (mask === 3) next.push(b, bc, ab, a, ab, c, ab, bc, c);
      else if (mask === 6) next.push(c, ca, bc, b, bc, a, bc, ca, a);
      else if (mask === 5) next.push(a, ab, ca, c, ca, b, ca, ab, b);
      else next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      if (i % 1536 === 0) yield;
    }
    indices = next;
    yield;
  }
  // Pin the sampled course itself into the bed, so the authored metre depth
  // is represented physically even where a narrow bend crosses a grid cell.
  for (const [x, z] of RIVER_LINE) {
    if (
      coastDistance(x, z) < SHORE.shelf ||
      Math.abs(x) >= EARTH.width / 2 ||
      Math.abs(z) >= EARTH.width / 2
    )
      continue;
    for (let i = 0; i < indices.length; i += 3) {
      const tri = indices.slice(i, i + 3),
        [a, b, c] = tri,
        ax = p[a * 3],
        az = -p[a * 3 + 1],
        bx = p[b * 3],
        bz = -p[b * 3 + 1],
        cx = p[c * 3],
        cz = -p[c * 3 + 1],
        det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz),
        u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det,
        v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det,
        w = 1 - u - v;
      if (u >= -1e-8 && v >= -1e-8 && w >= -1e-8) {
        if (Math.max(u, v, w) > 1 - 1e-7) break;
        // An exact edge hit is already represented by its shared endpoints;
        // leaving it untouched avoids a one-sided split of its neighbour.
        if (Math.min(u, v, w) < 1e-7) break;
        const at = p.length / 3;
        for (const { size, data } of Object.values(arrays))
          for (let k = 0; k < size; k++)
            data.push(
              Math.fround(u * data[a * size + k] + v * data[b * size + k] + w * data[c * size + k]),
            );
        p[at * 3] = x;
        p[at * 3 + 1] = -z;
        indices.splice(i, 3, a, b, at, b, c, at, c, a, at);
        break;
      }
      if (i % 1536 === 0) yield;
    }
    yield;
  }
  // Constrain the carved reach explicitly. Its zero-lift rim splits both
  // incident triangles, keeping dry triangle planes beyond it unchanged.
  const reach = RIVER_BED.reach[1],
    signed = [],
    cuts = new Map(),
    constrained = [];
  for (let i = 0; i < p.length / 3; i++) {
    signed[i] = riverWithin(p[i * 3], -p[i * 3 + 1], reach + 1)
      ? riverRadius(p[i * 3], -p[i * 3 + 1]) - reach
      : 1;
    if (i % 128 === 0) yield;
  }
  const cut = (a, b) => {
    const id = key(a, b);
    if (cuts.has(id)) return cuts.get(id);
    let lo = 0,
      hi = 1;
    for (let k = 0; k < 18; k++) {
      const t = (lo + hi) / 2,
        x = p[a * 3] + (p[b * 3] - p[a * 3]) * t,
        z = -p[a * 3 + 1] - (p[b * 3 + 1] - p[a * 3 + 1]) * t;
      if (riverRadius(x, z) < reach === signed[a] < 0) lo = t;
      else hi = t;
    }
    const t = (lo + hi) / 2,
      at = p.length / 3;
    for (const { size, data } of Object.values(arrays))
      for (let k = 0; k < size; k++)
        data.push(data[a * size + k] + (data[b * size + k] - data[a * size + k]) * t);
    signed[at] = 0;
    cuts.set(id, at);
    return at;
  };
  for (let i = 0; i < indices.length; i += 3) {
    const tri = indices.slice(i, i + 3),
      inside = tri.map((v) => signed[v] < 0);
    if (inside.every(Boolean) || inside.every((v) => !v)) constrained.push(...tri);
    else
      for (const side of [true, false]) {
        const polygon = [];
        for (let k = 0; k < 3; k++) {
          const a = tri[k],
            b = tri[(k + 1) % 3];
          if (inside[k] === side) polygon.push(a);
          if (inside[k] !== inside[(k + 1) % 3]) polygon.push(cut(a, b));
        }
        for (let k = 1; k < polygon.length - 1; k++)
          constrained.push(polygon[0], polygon[k], polygon[k + 1]);
      }
    if (i % 768 === 0) yield;
  }
  indices = constrained;
  const count = p.length / 3,
    oldLift = terrainLift(geometry),
    h = 0.1;
  for (let i = 0; i < count; i++) {
    p[i * 3] = Math.fround(p[i * 3]);
    p[i * 3 + 1] = Math.fround(p[i * 3 + 1]);
    const x = p[i * 3],
      z = -p[i * 3 + 1],
      delta = channel.delta(x, z, sample(x, z));
    if (delta) {
      p[i * 3 + 2] = Math.fround(p[i * 3 + 2] + delta);
      const n = arrays.normal.data,
        sx =
          (channel.delta(x + h, z, sample(x + h, z)) - channel.delta(x - h, z, sample(x - h, z))) /
          (2 * h),
        sz =
          (channel.delta(x, z + h, sample(x, z + h)) - channel.delta(x, z - h, sample(x, z - h))) /
          (2 * h);
      normal.set(n[i * 3] / n[i * 3 + 2] - sx, n[i * 3 + 1] / n[i * 3 + 2] + sz, 1).normalize();
      n.splice(i * 3, 3, normal.x, normal.y, normal.z);
    }
    if (i % 32 === 0) yield;
  }
  // A small spatial index samples only the solid bed, never the upper cap. A lookup walks
  // its cell's triangles in order, though only those whose box (grown far past the test's
  // tolerance) reaches the point's unit square, listed per square on first use: the same
  // first triangle as a walk of the whole cell, in a fraction of the tests.
  const buckets = new Map(),
    squares = new Map(),
    cell = 3,
    grown = 0.01,
    cellKey = (x, z) => (Math.floor(x / cell) + 32768) * 65536 + Math.floor(z / cell) + 32768;
  for (let i = 0; i < indices.length; i += 3) {
    const tri = indices.slice(i, i + 3),
      xs = tri.map((v) => p[v * 3]),
      zs = tri.map((v) => -p[v * 3 + 1]);
    for (let x = Math.floor(Math.min(...xs) / cell); x <= Math.floor(Math.max(...xs) / cell); x++)
      for (
        let z = Math.floor(Math.min(...zs) / cell);
        z <= Math.floor(Math.max(...zs) / cell);
        z++
      ) {
        const id = (x + 32768) * 65536 + z + 32768;
        if (!buckets.has(id)) buckets.set(id, []);
        buckets.get(id).push(...tri);
      }
    if (i % 768 === 0) yield;
  }
  const square = (key, bucket, fx, fz) => {
    let lists = squares.get(key);
    if (!lists) squares.set(key, (lists = new Map()));
    const id = (fx + 32768) * 65536 + fz + 32768;
    let list = lists.get(id);
    if (list) return list;
    list = [];
    for (let i = 0; i < bucket.length; i += 3) {
      const a = bucket[i] * 3,
        b = bucket[i + 1] * 3,
        c = bucket[i + 2] * 3;
      if (
        Math.max(p[a], p[b], p[c]) + grown >= fx &&
        Math.min(p[a], p[b], p[c]) - grown <= fx + 1 &&
        Math.max(-p[a + 1], -p[b + 1], -p[c + 1]) + grown >= fz &&
        Math.min(-p[a + 1], -p[b + 1], -p[c + 1]) - grown <= fz + 1
      )
        list.push(bucket[i], bucket[i + 1], bucket[i + 2]);
    }
    lists.set(id, list);
    return list;
  };
  const bed = (x, z) => {
    const key = cellKey(x, z),
      cellTriangles = buckets.get(key);
    if (!cellTriangles) return NaN;
    const bucket = square(key, cellTriangles, Math.floor(x), Math.floor(z));
    for (let i = 0; i < bucket.length; i += 3) {
      const a = bucket[i],
        b = bucket[i + 1],
        c = bucket[i + 2],
        ax = p[a * 3],
        az = -p[a * 3 + 1],
        bx = p[b * 3],
        bz = -p[b * 3 + 1],
        cx = p[c * 3],
        cz = -p[c * 3 + 1],
        det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz),
        u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det,
        v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7)
        return u * p[a * 3 + 2] + v * p[b * 3 + 2] + (1 - u - v) * p[c * 3 + 2];
    }
    return NaN;
  };
  const solidBed = (x, z) => (coastDistance(x, z) < SHORE.shelf ? channel.bed(x, z) : bed(x, z));
  // The water's surface: the river's, and down the stream's channel the
  // stream's own (streamLevel()), which is the river's where it leaves the
  // river, so one sheet of water turns from the river into the stream.
  const foot = landHeight(LANTERN_FOOT.x, LANTERN_FOOT.z),
    water = (x, z) => {
      const river = channel.water(x, z);
      if (streamRadius(x, z) >= STREAMS.bed.reach[1]) return river;
      const stream = foot + streamLevel(streamAlongAt, streamLength);
      return stream + (river - stream) * (1 - ease(...STREAM_MOUTH, riverRadius(x, z)));
    };
  const bedCount = indices.length,
    cap = new Array(count * 2).fill(0),
    across = RIVER_CHANNEL.across;
  const capPoint = (px, pz) => {
    const at = p.length / 3,
      top = water(px, pz),
      bottom = solidBed(px, pz);
    for (const [name, { size, data }] of Object.entries(arrays)) {
      if (name === "position") data.push(px, -pz, top);
      else if (name === "normal") data.push(0, 0, 1);
      else if (name === "uv") data.push(px / EARTH.width + 0.5, 0.5 - pz / EARTH.width);
      else if (name === "slateRoot") data.push(...OPEN_SOIL);
      else for (let k = 0; k < size; k++) data.push(0);
    }
    cap.push(1, Number.isFinite(bottom) ? top - bottom : -1);
    return at;
  };
  const clip = (polygon, distance, physical = false) => {
    const result = [];
    for (let k = 0; k < polygon.length; k++) {
      const a = polygon[k],
        b = polygon[(k + 1) % polygon.length],
        da = distance(p[a * 3], -p[a * 3 + 1]),
        db = distance(p[b * 3], -p[b * 3 + 1]);
      if (da >= 0) result.push(a);
      if (da >= 0 !== db >= 0) {
        let t = da / (da - db);
        if (physical) {
          let lo = 0,
            hi = 1;
          for (let j = 0; j < 16; j++) {
            const v = (lo + hi) / 2,
              d = distance(
                p[a * 3] + (p[b * 3] - p[a * 3]) * v,
                -p[a * 3 + 1] - (p[b * 3 + 1] - p[a * 3 + 1]) * v,
              );
            if (d >= 0 === da >= 0) lo = v;
            else hi = v;
          }
          t = (lo + hi) / 2;
        }
        result.push(
          capPoint(
            p[a * 3] + (p[b * 3] - p[a * 3]) * t,
            -p[a * 3 + 1] - (p[b * 3 + 1] - p[a * 3 + 1]) * t,
          ),
        );
      }
    }
    return result;
  };
  const wet = (x, z) => {
    const bottom = solidBed(x, z);
    return Number.isFinite(bottom) ? water(x, z) - bottom - 0.003 : -1;
  };
  const emit = (polygon) => {
    for (let k = 1; k < polygon.length - 1; k++) {
      const [a, b, c] = [polygon[0], polygon[k], polygon[k + 1]],
        area =
          (p[b * 3] - p[a * 3]) * (p[c * 3 + 1] - p[a * 3 + 1]) -
          (p[b * 3 + 1] - p[a * 3 + 1]) * (p[c * 3] - p[a * 3]);
      if (area > 1e-9) indices.push(a, b, c);
    }
  };
  // The near-estate water window includes the relocated bend and its coarse
  // bank triangles. Their actual wet polygons keep the water continuous where
  // a parallel strip cannot follow the wet outline. This water-only extension
  // leaves the solid refinement and the root lattice unchanged.
  const box = [
      TREE_FOOTING.x + FINE_WINDOW.x[0] - 12,
      TREE_FOOTING.x + FINE_WINDOW.x[1],
      TREE_FOOTING.z + FINE_WINDOW.z[0] - 12,
      TREE_FOOTING.z + FINE_WINDOW.z[1],
    ],
    sides = [(x) => x - box[0], (x) => box[1] - x, (_x, z) => z - box[2], (_x, z) => box[3] - z];
  const strip = (tri) => {
    let rest = clip(tri, wet, true);
    for (const side of sides) {
      if (rest.length < 3) break;
      emit(clip(rest, (x, z) => -side(x, z)));
      rest = clip(rest, side);
    }
  };
  const seam = RAPIDS_DROP
      ? Array.from({ length: across + 1 }, (_, k) =>
          riverRunStart(RAPIDS_DROP, 1 - (k / across) * 2),
        )
      : null,
    seamS = seam ? Math.max(...seam.map(([x, z]) => riverAt(x, z).s)) : -Infinity,
    course = RIVER_LINE.filter(([x, z, s]) => s > seamS && coastDistance(x, z) > 0);
  let previous = null;
  for (let row = seam ? -1 : 0; row < course.length; row++) {
    const [x, z, s, width, phase] = course[Math.max(0, row)];
    if (Math.abs(x) > EARTH.width / 2 + width || Math.abs(z) > EARTH.width / 2 + width) {
      previous = null;
      continue;
    }
    const [, , dx, dz] = riverPoint(s),
      half = (width / RIVER.width) * riverSpan(s + phase),
      current = [];
    for (let k = 0; k <= across; k++) {
      const r = ((k / across) * 2 - 1) * 1.18,
        [px, pz] = row === -1 ? seam[k] : [x - dz * half * r, z + dx * half * r],
        at = capPoint(px, pz);
      current.push(at);
    }
    if (previous)
      for (let k = 0; k < across; k++) {
        const a = previous[k],
          b = current[k],
          c = current[k + 1],
          d = previous[k + 1];
        for (const tri of [
          [a, d, b],
          [b, d, c],
        ]) {
          strip(tri);
        }
      }
    previous = current;
    yield;
  }
  const upper = new Map();
  const capVertex = (i) => {
    if (!upper.has(i)) upper.set(i, capPoint(p[i * 3], -p[i * 3 + 1]));
    return upper.get(i);
  };
  for (let i = 0; i < bedCount; i += 3) {
    // Yields on the scan, before the skips, every 16 triangles: where the
    // water is dense each one is clipped, and a run of them must never make a
    // long task.
    if (i % 48 === 0) yield;
    const tri = indices.slice(i, i + 3),
      xs = tri.map((v) => p[v * 3]),
      zs = tri.map((v) => -p[v * 3 + 1]);
    if (
      Math.max(...xs) < box[0] ||
      Math.min(...xs) > box[1] ||
      Math.max(...zs) < box[2] ||
      Math.min(...zs) > box[3]
    )
      continue;
    if (
      !tri.some(
        (v) =>
          riverWithin(p[v * 3], -p[v * 3 + 1], 1.3) ||
          streamRadius(p[v * 3], -p[v * 3 + 1]) < STREAMS.bed.reach[0],
      )
    )
      continue;
    let polygon = tri.map(capVertex);
    for (const side of sides) polygon = clip(polygon, side);
    emit(clip(polygon, wet, true));
  }
  for (const [name, { size, data }] of Object.entries(arrays)) {
    geometry.setAttribute(name, new BufferAttribute(new Float32Array(data), size));
    yield;
  }
  geometry.setAttribute("slateRiverSurface", new BufferAttribute(new Float32Array(cap), 2));
  const Index = p.length / 3 > 65535 ? Uint32Array : Uint16Array;
  geometry.setIndex(new BufferAttribute(new Index(indices), 1));
  geometry.userData.riverBedIndexCount = bedCount;
  geometry.userData.riverWater = channel.water;
  geometry.userData.riverCoastHeight = channel.bed;
  geometry.userData.riverStats = {
    bedTriangles: bedCount / 3,
    waterTriangles: (indices.length - bedCount) / 3,
  };
  if (
    EARTH.subdivisions === 128 &&
    (bedCount / 3 > RIVER_CHANNEL.bedTriangles ||
      (indices.length - bedCount) / 3 > RIVER_CHANNEL.waterTriangles)
  )
    throw new Error("River geometry budget exceeded");
  SURFACES.set(geometry, bed);
  LIFTS.set(geometry, (x, z) => {
    const here = bed(x, z);
    return Number.isNaN(here) ? oldLift(x, z) : here - sample(x, z);
  });
  yield* geometryBounds(geometry, true);
}

function* earthSteps(groundHeight, EARTH) {
  const sample = yield* coarseSurface(groundHeight, EARTH);
  const n = EARTH.subdivisions,
    step = EARTH.width / EARTH.subdivisions / 2,
    normal = new Vector3();
  const lift = (x, z) => rootSupportHeight(x, z, sample) - sample(x, z);
  // Sub-unit samples around the roots share the existing ground draw. Only
  // this local rectangle is refined; the rest keeps its original triangles.
  const xs = terrainAxis(
    EARTH.width,
    EARTH.subdivisions,
    FINE_WINDOW.x.map((v) => TREE_FOOTING.x + v),
  );
  const zs = terrainAxis(
    EARTH.width,
    EARTH.subdivisions,
    FINE_WINDOW.z.map((v) => TREE_FOOTING.z + v),
  );
  // The fine grid: its first column and row, and how many cells of pitch.
  const pitch = step / 2,
    fineX = xs.indexOf(xs.find((x, i) => xs[i + 1] - x < step));
  const fineZ = zs.indexOf(zs.find((z, i) => zs[i + 1] - z < step));
  let cols = 0,
    rows = 0;
  while (xs[fineX + cols + 1] - xs[fineX + cols] === pitch) cols++;
  while (zs[fineZ + rows + 1] - zs[fineZ + rows] === pitch) rows++;
  const coarseX = Array.from({ length: n + 1 }, (_, i) =>
    xs.indexOf(-EARTH.width / 2 + i * step * 2),
  );
  const coarseZ = Array.from({ length: n + 1 }, (_, i) =>
    zs.indexOf(-EARTH.width / 2 + i * step * 2),
  );
  const refined = (i, j) => coarseX[i + 1] - coarseX[i] > 1 && coarseZ[j + 1] - coarseZ[j] > 1;
  // The river's own refinement: the fine cells within its reach, fine-grid
  // columns [c0, c1) and rows [r0, r1), each cut into RIVER_STEPS x RIVER_STEPS.
  const S = RIVER_STEPS,
    [px0, px1, pz0, pz1] = riverBounds();
  const c0 = fineX + Math.floor((px0 - xs[fineX]) / pitch),
    c1 = fineX + Math.ceil((px1 - xs[fineX]) / pitch),
    r0 = fineZ + Math.floor((pz0 - zs[fineZ]) / pitch),
    r1 = fineZ + Math.ceil((pz1 - zs[fineZ]) / pitch);
  const nc = c1 - c0,
    nr = r1 - r0,
    riverCols = S * nc + 1;
  // Size every array once: a coarse triangle beside a refined neighbour is a
  // fan about one added centre point.
  const grid = xs.length * zs.length;
  let fans = 0,
    size = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      if (i === 0 && j % 8 === 7) yield;
      const w = coarseX[i + 1] - coarseX[i],
        h = coarseZ[j + 1] - coarseZ[j];
      if (refined(i, j)) {
        size += w * h * 6;
        continue;
      }
      for (const corners of [
        3 + (refined(i - 1, j) ? h - 1 : 0) + (refined(i, j - 1) ? w - 1 : 0),
        3 + (refined(i, j + 1) ? w - 1 : 0) + (refined(i + 1, j) ? h - 1 : 0),
      ]) {
        size += corners > 3 ? corners * 3 : 3;
        if (corners > 3) fans++;
      }
    }
  // The river's cells take S x S quads each, and each fine cell beside them a
  // fan of S + 1 triangles about its far corner, through the shared edge's
  // added points; the sub-grid's points that are not fine-grid vertices follow
  // the centres.
  size += nc * nr * (S * S - 1) * 6 + 2 * (nc + nr) * (S - 1) * 3;
  const riverExtra = new Int32Array(riverCols * (S * nr + 1)).fill(-1);
  let extra = 0;
  for (let gj = 0; gj <= S * nr; gj++)
    for (let gi = 0; gi <= S * nc; gi++)
      if (gi % S || gj % S) riverExtra[gj * riverCols + gi] = extra++;
  const count = grid + fans + extra,
    positions = new Float32Array(count * 3),
    normalArray = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2),
    lifts = new Float32Array((cols + 1) * (rows + 1)),
    surface = new Float32Array(lifts.length);
  const indices = count > 65535 ? new Uint32Array(size) : new Uint16Array(size);
  // The root shading (rootShade()) at full float precision: byte or 16-bit
  // packing moves the grade's cel bands on single pixels of settled soil.
  const shading = new Float32Array(count * 4);
  const shade = (i, values) => shading.set(values, i * 4);
  // ROOT_SHADE's sky, key and lamp occlusion (0 beyond its lattice), also at float precision.
  const occlusion = new Float32Array(count * 3);
  const point = (i, x, z, y) => {
    positions[i * 3] = x;
    positions[i * 3 + 1] = -z;
    positions[i * 3 + 2] = y;
    normalArray[i * 3] = normal.x;
    normalArray[i * 3 + 1] = normal.y;
    normalArray[i * 3 + 2] = normal.z;
    uvs[i * 2] = x / EARTH.width + 0.5;
    uvs[i * 2 + 1] = 0.5 - z / EARTH.width;
  };
  // Ground mesh is rotated -PI/2: local +Y becomes world -Z. Add only the
  // support's slope to the preserved baseline shading normal.
  for (let i = 0; i < grid; i++) {
    const col = i % xs.length,
      row = Math.floor(i / xs.length),
      x = xs[col],
      z = zs[row];
    const dx = x - TREE_FOOTING.x,
      dz = z - TREE_FOOTING.z;
    const raised = Math.hypot(dx, dz) < SUPPORT_REACH ? lift(x, z) : 0;
    const y = sample(x, z, normal) + raised;
    if (col >= fineX && col <= fineX + cols && row >= fineZ && row <= fineZ + rows) {
      lifts[(row - fineZ) * (cols + 1) + col - fineX] = raised;
      surface[(row - fineZ) * (cols + 1) + col - fineX] = y;
    }
    // A finite-difference tap outside a protected area must not tilt a vertex
    // that itself stayed at the baseline (that would bend the puddle highlight).
    if (raised) {
      const h = step / 8;
      const sx = (lift(x + h, z) - lift(x - h, z)) / (2 * h);
      const sz = (lift(x, z + h) - lift(x, z - h)) / (2 * h);
      normal.set(normal.x / normal.z - sx, normal.y / normal.z + sz, 1).normalize();
    }
    point(i, x, z, y);
    const near = Math.abs(x - TREE_FOOTING.x - 3) < 15 && Math.abs(z - TREE_FOOTING.z) < 15;
    shade(i, near ? rootShade(dx, dz, raised && rootBermExcess(x, z, sample)) : OPEN_SOIL);
    if (near) occlusion.set(rootOcclusion(x, z), i * 3);
    if (i % 8 === 7) yield;
  }
  // The river's added points, raised (lowered) and shaded as the grid's; its
  // sub-grid's lifts and heights, for the samplers.
  const riverBase = grid + fans,
    riverLifts = new Float32Array(riverExtra.length),
    riverSurface = new Float32Array(riverExtra.length);
  for (let gj = 0; gj <= S * nr; gj += S)
    for (let gi = 0; gi <= S * nc; gi += S) {
      const at = (r0 + gj / S - fineZ) * (cols + 1) + c0 + gi / S - fineX;
      riverLifts[gj * riverCols + gi] = lifts[at];
      riverSurface[gj * riverCols + gi] = surface[at];
    }
  const gridVertex = (i, j) => j * xs.length + i;
  for (let gj = 0; gj <= S * nr; gj++) {
    for (let gi = 0; gi <= S * nc; gi++) {
      const k = riverExtra[gj * riverCols + gi];
      if (k < 0) continue;
      const x = xs[c0] + (gi * pitch) / S,
        z = zs[r0] + (gj * pitch) / S,
        dx = x - TREE_FOOTING.x,
        dz = z - TREE_FOOTING.z,
        at = riverBase + k;
      // A point on the sub-grid's border lies on its fine edge, between that
      // edge's two vertices (as a stitching fan's centre lies in its triangle's
      // plane), so the cells beside it keep their surface exactly.
      if (gi === 0 || gi === S * nc || gj === 0 || gj === S * nr) {
        const across = gj === 0 || gj === S * nr,
          from = across ? gi - (gi % S) : gj - (gj % S),
          t = ((across ? gi : gj) - from) / S;
        const [i0, i1] = across
          ? [gridVertex(c0 + from / S, r0 + gj / S), gridVertex(c0 + from / S + 1, r0 + gj / S)]
          : [gridVertex(c0 + gi / S, r0 + from / S), gridVertex(c0 + gi / S, r0 + from / S + 1)];
        const mix = (array, size, j) =>
          array[i0 * size + j] + (array[i1 * size + j] - array[i0 * size + j]) * t;
        for (let j = 0; j < 3; j++) {
          positions[at * 3 + j] = mix(positions, 3, j);
          normalArray[at * 3 + j] = mix(normalArray, 3, j);
        }
        for (let j = 0; j < 2; j++) uvs[at * 2 + j] = mix(uvs, 2, j);
        for (let j = 0; j < 3; j++) occlusion[at * 3 + j] = mix(occlusion, 3, j);
        for (let j = 0; j < 4; j++) shading[at * 4 + j] = mix(shading, 4, j);
        const l0 = riverLifts[across ? gj * riverCols + from : from * riverCols + gi],
          l1 = riverLifts[across ? gj * riverCols + from + S : (from + S) * riverCols + gi];
        riverLifts[gj * riverCols + gi] = l0 + (l1 - l0) * t;
        riverSurface[gj * riverCols + gi] = positions[at * 3 + 2];
        continue;
      }
      const raised = lift(x, z),
        y = sample(x, z, normal) + raised;
      if (raised) {
        const h = step / 8;
        const sx = (lift(x + h, z) - lift(x - h, z)) / (2 * h);
        const sz = (lift(x, z + h) - lift(x, z - h)) / (2 * h);
        normal.set(normal.x / normal.z - sx, normal.y / normal.z + sz, 1).normalize();
      }
      riverLifts[gj * riverCols + gi] = raised;
      riverSurface[gj * riverCols + gi] = y;
      point(at, x, z, y);
      shade(at, rootShade(dx, dz, raised && rootBermExcess(x, z, sample)));
      occlusion.set(rootOcclusion(x, z), at * 3);
    }
    yield;
  }
  const pools = yield* poolFieldSteps(surface, cols + 1, rows + 1, (i, j) => [
    xs[fineX + i],
    zs[fineZ + j],
  ]);
  const pool = new Float32Array(count);
  for (let j = 0; j <= rows; j++) {
    pool.set(pools.subarray(j * (cols + 1), (j + 1) * (cols + 1)), (fineZ + j) * xs.length + fineX);
    if (j % 4 === 0) yield;
  }
  yield;
  let cursor = 0,
    center = grid;
  const vertex = (i, j) => j * xs.length + i;
  // A point of the river's sub-grid (gi, gj from its first corner): a fine-grid
  // vertex where it lies on one, else an added point.
  const riverVertex = (gi, gj) =>
    gi % S || gj % S
      ? riverBase + riverExtra[gj * riverCols + gi]
      : vertex(c0 + gi / S, r0 + gj / S);
  // A river cell's S x S quads, split as the grid's (a, b, d and b, c, d).
  const riverCell = (col, row) => {
    for (let sj = 0; sj < S; sj++)
      for (let si = 0; si < S; si++) {
        const gi = (col - c0) * S + si,
          gj = (row - r0) * S + sj;
        const a = riverVertex(gi, gj),
          b = riverVertex(gi, gj + 1),
          c = riverVertex(gi + 1, gj + 1),
          d = riverVertex(gi + 1, gj);
        indices[cursor++] = a;
        indices[cursor++] = b;
        indices[cursor++] = d;
        indices[cursor++] = b;
        indices[cursor++] = c;
        indices[cursor++] = d;
      }
  };
  // A fine cell sharing an edge with the river's: its corners in the grid's
  // winding (a, b, c, d) with that edge's added points between, starting from
  // the end of the cell's own b-d diagonal off that edge, so the fan keeps the
  // diagonal and every triangle lies in one of the cell's two planes; null for
  // any other cell.
  const riverBeside = (col, row, a, b, c, d) => {
    const inRows = row >= r0 && row < r1,
      inCols = col >= c0 && col < c1,
      along = (at) => Array.from({ length: S - 1 }, (_, k) => at(k + 1));
    if (inRows && col === c1)
      return [d, a, ...along((k) => riverVertex(nc * S, (row - r0) * S + k)), b, c];
    if (inRows && col === c0 - 1)
      return [b, c, ...along((k) => riverVertex(0, (row - r0) * S + S - k)), d, a];
    if (inCols && row === r1)
      return [b, c, d, ...along((k) => riverVertex((col - c0) * S + S - k, nr * S)), a];
    if (inCols && row === r0 - 1)
      return [d, a, b, ...along((k) => riverVertex((col - c0) * S + k, 0)), c];
    return null;
  };
  // A coarse triangle wholly under the sea is left out (the sea covers it).
  const sunk = (i) => positions[i * 3 + 2] < SEA_CULL;
  const triangle = (corners, polygon, x, z) => {
    if (polygon.length === 3 && corners.every(sunk)) return;
    if (polygon.length === 3) {
      for (const corner of corners) indices[cursor++] = corner;
      return;
    }
    // Stitch a coarse triangle to its refined neighbour with a centre fan.
    // Every added point lies in that original triangle's plane; the shared
    // edge indices eliminate T-junctions without changing distant geometry.
    point(center, x, z, sample(x, z, normal));
    shade(center, OPEN_SOIL);
    for (let k = 0; k < polygon.length; k++) {
      indices[cursor++] = center;
      indices[cursor++] = polygon[k];
      indices[cursor++] = polygon[(k + 1) % polygon.length];
    }
    center++;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = coarseX[i],
        x1 = coarseX[i + 1],
        z0 = coarseZ[j],
        z1 = coarseZ[j + 1];
      if (refined(i, j)) {
        for (let row = z0; row < z1; row++)
          for (let col = x0; col < x1; col++) {
            if (col >= c0 && col < c1 && row >= r0 && row < r1) {
              riverCell(col, row);
              continue;
            }
            const a = vertex(col, row),
              b = vertex(col, row + 1),
              c = vertex(col + 1, row + 1),
              d = vertex(col + 1, row);
            const polygon = riverBeside(col, row, a, b, c, d);
            if (polygon) {
              // A fine cell beside the river's: a fan from its far corner through
              // the shared edge's points (no T-junction).
              for (let k = 1; k < polygon.length - 1; k++) {
                indices[cursor++] = polygon[0];
                indices[cursor++] = polygon[k];
                indices[cursor++] = polygon[k + 1];
              }
              continue;
            }
            indices[cursor++] = a;
            indices[cursor++] = b;
            indices[cursor++] = d;
            indices[cursor++] = b;
            indices[cursor++] = c;
            indices[cursor++] = d;
          }
      } else {
        const a = vertex(x0, z0),
          b = vertex(x0, z1),
          c = vertex(x1, z1),
          d = vertex(x1, z0);
        const first = [a],
          second = [b];
        if (refined(i - 1, j)) for (let row = z0 + 1; row < z1; row++) first.push(vertex(x0, row));
        first.push(b, d);
        if (refined(i, j - 1)) for (let col = x1 - 1; col > x0; col--) first.push(vertex(col, z0));
        if (refined(i, j + 1)) for (let col = x0 + 1; col < x1; col++) second.push(vertex(col, z1));
        second.push(c);
        if (refined(i + 1, j)) for (let row = z1 - 1; row > z0; row--) second.push(vertex(x1, row));
        second.push(d);
        triangle([a, b, d], first, xs[x0] + (step * 2) / 3, zs[z0] + (step * 2) / 3);
        triangle([b, c, d], second, xs[x0] + (step * 4) / 3, zs[z0] + (step * 4) / 3);
      }
    }
    yield;
  }
  const geometry = new BufferGeometry();
  let finished = false;
  try {
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new BufferAttribute(normalArray, 3));
    geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
    geometry.setAttribute("slateRoot", new BufferAttribute(shading, 4));
    geometry.setAttribute("slateShade", new BufferAttribute(occlusion, 3));
    geometry.setAttribute("slatePool", new BufferAttribute(pool, 1));
    geometry.setIndex(new BufferAttribute(indices.subarray(0, cursor), 1));
    yield* geometryBounds(geometry, true);
    // Inside the river's sub-grid, its own (finer) triangles.
    const within = (outer, inner) => (x, z) => {
      const value = inner(x, z);
      return Number.isNaN(value) ? outer(x, z) : value;
    };
    LIFTS.set(
      geometry,
      within(
        liftSampler(lifts, xs[fineX], zs[fineZ], cols, rows, pitch),
        liftSampler(riverLifts, xs[c0], zs[r0], S * nc, S * nr, pitch / S, NaN),
      ),
    );
    SURFACES.set(
      geometry,
      within(
        liftSampler(surface, xs[fineX], zs[fineZ], cols, rows, pitch, NaN),
        liftSampler(riverSurface, xs[c0], zs[r0], S * nc, S * nr, pitch / S, NaN),
      ),
    );
    yield* riverSurfaceSteps(geometry, sample, filmHeight(groundHeight, true), EARTH);
    finished = true;
    return geometry;
  } finally {
    if (!finished) geometry.dispose();
  }
}

// Hidden preparation uses short, unclamped tasks; the fade keeps its existing
// faster slices, and visible refinement takes idle time. The lazy scheduler
// owns its queued callbacks and closes its resources when work ends.
function inSlices(
  steps,
  early = () => false,
  cancelled = () => false,
  progress = null,
  priorityMs = () => 4,
) {
  return import("./preparation-tasks.js").then(({ runPreparationSteps }) =>
    runPreparationSteps(steps, { priority: early, cancelled, progress, priorityMs }),
  );
}

// The cliff's shelf (ocean.js cliffGeometry()) lies a little above the ground along the fault,
// its height sampled at its own coarse vertices. Between them the ground's finer detail, the
// river's banks beside the falls, rose through it in ragged pale patches (Alex's report of
// 2026-10-28). Settle every bed vertex under the shelf to `margin` beneath its top surface;
// the water's cap (its own vertices) keeps its height.
export function* tuckUnderShelf(geometry, cliff, margin = 0.06) {
  if (!cliff?.index) return 0;
  const cp = cliff.attributes.position.array,
    ci = cliff.index.array,
    bins = new Map(),
    cell = 1,
    key = (x, z) => (Math.floor(x / cell) + 32768) * 65536 + Math.floor(z / cell) + 32768;
  for (let t = 0; t < ci.length; t += 3) {
    const a = ci[t] * 3,
      b = ci[t + 1] * 3,
      c = ci[t + 2] * 3;
    for (
      let x = Math.floor(Math.min(cp[a], cp[b], cp[c]) / cell);
      x <= Math.floor(Math.max(cp[a], cp[b], cp[c]) / cell);
      x++
    )
      for (
        let z = Math.floor(Math.min(cp[a + 2], cp[b + 2], cp[c + 2]) / cell);
        z <= Math.floor(Math.max(cp[a + 2], cp[b + 2], cp[c + 2]) / cell);
        z++
      ) {
        const id = (x + 32768) * 65536 + z + 32768;
        if (!bins.has(id)) bins.set(id, []);
        bins.get(id).push(a, b, c);
      }
    if (t % 3000 === 0) yield;
  }
  // The highest cliff surface over (x, z), or -Infinity where it has none.
  const top = (x, z) => {
    const list = bins.get(key(x, z)) ?? [];
    let best = -Infinity;
    for (let i = 0; i < list.length; i += 3) {
      const a = list[i],
        b = list[i + 1],
        c = list[i + 2],
        det = (cp[b + 2] - cp[c + 2]) * (cp[a] - cp[c]) + (cp[c] - cp[b]) * (cp[a + 2] - cp[c + 2]);
      if (Math.abs(det) < 1e-12) continue;
      const u = ((cp[b + 2] - cp[c + 2]) * (x - cp[c]) + (cp[c] - cp[b]) * (z - cp[c + 2])) / det,
        v = ((cp[c + 2] - cp[a + 2]) * (x - cp[c]) + (cp[a] - cp[c]) * (z - cp[c + 2])) / det;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      best = Math.max(best, u * cp[a + 1] + v * cp[b + 1] + (1 - u - v) * cp[c + 1]);
    }
    return best;
  };
  const p = geometry.attributes.position.array,
    index = geometry.index.array,
    bed = new Set();
  for (let i = 0; i < (geometry.userData.riverBedIndexCount ?? index.length); i++)
    bed.add(index[i]);
  let settled = 0,
    n = 0;
  for (const v of bed) {
    // The ground's positions are (x, -z, height) before its turn into the estate's frame.
    const y = top(p[v * 3], -p[v * 3 + 1]);
    if (y > -Infinity && p[v * 3 + 2] > y - margin) {
      p[v * 3 + 2] = y - margin;
      settled++;
    }
    if (++n % 4000 === 0) yield;
  }
  if (settled) geometry.attributes.position.needsUpdate = true;
  geometry.userData.tuckedUnderShelf = settled;
  return settled;
}

// The film terrain. Given the scene's rendering, it builds in slices
// (inSlices()) and resolves only where the new ground cannot show mid-shot
// (unseen()); without it (tests), it builds at once. cancelled: the film scene
// is gone, so the build stops, or the finished geometry is freed, and it
// resolves to nothing. prepareOnly leaves publication and shadow invalidation
// to settleRoots()'s atomic commit, so detached preparation never waits a cut.
function* preparedEarthSteps(groundHeight, EARTH, rendering) {
  const tier = rendering.assetTier ?? rendering.tier ?? "high";
  let geometry,
    prepared,
    complete = false;
  const release = () => {
    for (const key of ["cliff", "stacks"]) {
      prepared?.[key]?.dispose();
      if (prepared) prepared[key] = null;
    }
  };
  try {
    geometry = yield* earthSteps(groundHeight, EARTH);
    yield;
    // Reuse the terrain's idle scheduler for the much denser coast. No map or
    // shader starts here, and the same arithmetic produces the same buffers.
    prepared = yield* coastGeometrySteps(
      geometry.userData.riverCoastHeight ?? filmHeight(groundHeight, true),
      tier,
      riverFalls(RIVER_LINE),
    );
    yield* tuckUnderShelf(geometry, prepared.cliff);
    prepared.tier = tier;
    geometry.userData.coastGeometry = prepared;
    geometry.addEventListener("dispose", release);
    complete = true;
    return geometry;
  } finally {
    if (!complete) {
      geometry?.dispose();
      release();
    }
  }
}

export function createEarthGeometry(
  groundHeight,
  EARTH = { width: 384, subdivisions: 128 },
  rendering = null,
  tour = null,
  cancelled = () => false,
  prepareOnly = false,
) {
  const steps =
    prepareOnly && rendering?.homeScene
      ? preparedEarthSteps(groundHeight, EARTH, rendering)
      : earthSteps(groundHeight, EARTH);
  if (!rendering) {
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
    }
  }
  const allowed = unseen(rendering, tour);
  const fade = fading(rendering, false),
    opening = () =>
      rendering.openingPreparing === true &&
      !rendering.renderer?.domElement?.parentNode?.classList?.contains("is-ready");
  return inSlices(
    steps,
    () => opening() || fade(),
    cancelled,
    () => {
      if (opening()) rendering.openingProgress = (rendering.openingProgress ?? 0) + 1;
    },
    () => (opening() ? 4 : 12),
  ).then(
    (geometry) =>
      new Promise((resolve) => {
        (function check() {
          if (!geometry || cancelled()) return resolve(geometry?.dispose());
          if (!prepareOnly && !allowed()) return nextFrame(check);
          if (!prepareOnly) rendering.invalidateShadows?.();
          resolve(geometry);
        })();
      }),
  );
}
