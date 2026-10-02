import { BufferAttribute, BufferGeometry, Mesh, Vector3 } from "three";

// A lazy chunk: the film terrain with its foothills, the knoll under the tree
// and its root shading, the puddles and their drips, the tufts, the litter and
// the small stones.

// Two low, broken ridges beyond the estate's entire occupied area: radius,
// half-width and lift.
const RIDGES = [
  [123, 30, 4],
  [151, 27, 8],
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
// lantern, `front` (its own stretched units) of the front puddle and `drip`
// beyond each other puddle's radius, easing in over `feather`. Each margin is
// its pin plus a fine-grid triangle's reach (0.75 x sqrt 2).
export const PIN_KEEP = Object.freeze({ lantern: 2.5, front: 4.6, drip: 0.8, feather: 1 });

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

// The lantern (estateLantern(): 5 units from the tree toward the tower) and
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
  zoneAt(LANTERN_FOOT, -115, 3, 2.8, 1.4, 33),
  zoneAt(TREE_FOOTING, 185, 8, 2.2),
  zoneAt(TREE_FOOTING, 75, 9, 2.5),
  zoneAt(TREE_FOOTING, -100, 16, 2),
]);
// A zone's distance from its centre in its own stretched frame (units).
export const zoneDistance = ({ x: cx, z: cz, stretch, c, s }, x, z) =>
  Math.hypot((c * (x - cx) + s * (z - cz)) / stretch, -s * (x - cx) + c * (z - cz));

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
  [12,11,0.072], [27,15,0.134], [26,16,0.105], [22,20,0.09], [20,22,0.016], [21,25,0.052],
]);
const BANKS = new Float32Array(ROOT_LATTICE.cols * ROOT_LATTICE.rows);
for (const [col, row, lift] of ROOT_RESTS) BANKS[row * ROOT_LATTICE.cols + col] = lift;
// The bank's lift at a world x/z (0 beyond the lattice).
export const rootBankLift = (x, z) => latticeAt(BANKS, x, z);

// Baked on the same lattice (tools/bake-root-shade.mjs), 6 bits a vertex in
// SHADE_ALPHABET, row by row, 0 neutral: sky occlusion from the tree over the
// banked soil (96 cosine-weighted rays), moon-key occlusion (a 0.02 rad cone
// about KEY_LIGHT, the trunk and roots only), both averaged over the two
// variants and smoothed so no lattice edge reads: neighbours differ by at
// most 0.33 a unit, and toward the pinned clearing and puddles the occlusion
// ramps down by at most 0.3 a unit, never a straight cliff; and the contact cut, where a
// ROOT_LINES centreline strays over open soil (more than 0.7 from a real root
// footprint) or two roots' vectors meet head-on, so no false crease is drawn.
// The shader reads sky and key as the slateShade attribute; rootShade() takes
// the cut. None reaches the lantern clearing or the puddles.
export const SHADE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
// prettier-ignore
export const ROOT_SHADE = Object.freeze({
  sky: [
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
    "000000000000001233211000000000000",
    "0000000000001368aa742100000000000",
    "00000000000127flnlf84210000000000",
    "0000000000114bmxBwlc7421000000000",
    "0000000001235bnBHDrga642100000000",
    "0000000000357bkxHFukeb85210000000",
    "000000000029belwFFyqlid8421000000",
    "00000000000bilqzGHBvtqkc731000000",
    "00000000000bmuxEJJEBAyqh942100000",
    "00000000001bmxFJNMIGGExme84100000",
    "00000000005eoyIPRQMKLLFxpia510000",
    "00000000007jsBKUUTRPPQPLEwod41000",
    "0000000000boyGOWWVTSRSTTSKzl82000",
    "0000000009jvFMUVWVUSQPQRRODo92000",
    "000000019jtAFLPSTUTRNJGFFCuh72000",
    "000008adhmqvAGKORSSQMFyspmg931000",
    "000068acfjnsyDHLNQRROIyogb7410000",
    "0004579beimsxCFIJMPRQMDqf84210000",
    "0134578bdhmsyDFFFHMQPMEsf73200000",
    "0124568adhmtAAxxxzEKNIApd63100000",
    "00234579chovsmjjjmrzIEvka52100000",
    "00123468cjrpg95558foyCui831000000",
    "00012359fnpf5000004epAuh621000000",
    "00011259hqf500000006jsod410000000",
    "00000148el8000000001egd7200000000",
    "000001248c30000000006652100000000",
    "000000012420000000012211000000000",
    "000000000120000000000100000000000",
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
  ].join(""),
  key: [
    "000000000000000000000000000000000",
    "000000000000000111000000000000000",
    "000000000000024786200000000000000",
    "00000000000015bhhb410000000000000",
    "0000000000003aksqg610000000000000",
    "0000000000015fsBxj721000000000000",
    "000000000025cnAHAma54210000000000",
    "00000000006eoAKMDofec720000000000",
    "00000000002dpAMRFsnpne51000000000",
    "00000000000bmxJTHwwBxj71000000000",
    "00000000000bmxHTJDGKEpb3100000000",
    "00000000001bmxHSNLPRLxmc642100000",
    "00000000005eoyITTSVWSIyrjd7410000",
    "00000000007jsBKUYWWWVSNFzria41000",
    "0000000000boyGOYZVQOQRQOKDsg62000",
    "0000000009jvFMU-XQIDDFFFFCuh72000",
    "000000019jtDMT-ZVNDvsqppqqlc51000",
    "000007cfktDNUYYYUNEwqlgcbba620000",
    "000013bqxENXWTSUUQKDwqia533110000",
    "0000015ixNXYTNJLQSQJCvmd510000000",
    "0000003csHVYSKBAFNRNDume620000000",
    "00000019pEULFAwoszEKEsia510000000",
    "00000018oDJAsmjfgmrzEsf7310000000",
    "00000029pEzpg95558foytg6200000000",
    "0000003brzpf5000004eppf6100000000",
    "0000014dqrf500000006hhb5100000000",
    "0000014akl80000000017862000000000",
    "00000126ae30000000002221000000000",
    "000000123420000000000000000000000",
    "000000000110000000000000000000000",
    "000000000000000000000000000000000",
    "000000000000000000000000000000000",
  ].join(""),
  cut: [
    "000000000000000000000000000000000",
    "0wwwwwwwwwwwwwwwwwwwwwwwwwwwwwww0",
    "0sJJO__________________________w0",
    "0000000D_______________________w0",
    "000000000-___q00q______________w0",
    "0000000000___O000m_____________w0",
    "00000000000___Q000_____________w0",
    "00000000000z___L00_____________w0",
    "000000000000____00_____________w0",
    "000000000000____0______________w0",
    "0000000000008___a______________w0",
    "0000000000000d_________________w0",
    "000000000000___________________w0",
    "00000000000P__________60000____w0",
    "000000000020____U______t0000B__w0",
    "0000000000000008______X88000v__w0",
    "00000003ST__qhUR_______0000v___w0",
    "000000U________________________w0",
    "00000s______________U__________w0",
    "0000r_____________60_00________w0",
    "000A______________2___00O______w0",
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
  CUT = shadeTable(ROOT_SHADE.cut);
// [sky, key] occlusion at a world x/z, as the slateShade attribute holds it.
export const rootOcclusion = (x, z) => [latticeAt(SKY, x, z), latticeAt(KEY, x, z)];

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
    "HwAAAAAAAAAAAACAPwAAAAAAAAAAAAAAfwAYAAAAAAAAAAAA/wAfAAAAAAAAAAYA/gE/AAAAAAAA",
    "ABwA/AM8AAAAAAAAAHgA/Ac4AAAAAAAAAOAB+A9wAAAAAAAAAMAH8B/gAQAAAAAAAAAf4D/AAwAA",
    "AAAAAAB84H/ADwAAAAAAAADwwX+AHwAAAAAAAADgh/8APwAAAAAAAACAH/8BfAAAAAAAAAAAP/8b",
    "4AAAAAAAAAAAfP5/wA8AAAAAAAAA+P//AP8PAAAAAAAA8P9/AP5/AAAAAAAAwP9/APj/AQAAAAAA",
    "8P//APD/DwAAAOAH/v//AcD/PwAAAID/////B4D//wAAAADwH/z/D8D/fwAAAACAAfj/H4D/fwAA",
    "AAAAAID/PwD/fwAAAAAAAAD/fwCAfwAAAAAAAADs/wAAAAAAAAAAAACA/wEAAAAAAAAAAAAA/4MA",
    "AAAAAAAAAAAA/g8DAAAAAAAAAAAA/B8OAAAAAAAAAAAA8H8wAAAAAAAAAAAAIP/BAAAAAAAAAAAA",
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
  const { lantern, front, drip } = PIN_KEEP;
  let keep = ease(lantern, lantern + feather, Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z));
  for (let i = 0; keep > 0 && i < PUDDLE_ZONES.length; i++) {
    const zone = PUDDLE_ZONES[i],
      margin = i ? zone.radius + drip : front;
    keep *= ease(margin, margin + feather, zoneDistance(zone, x, z));
  }
  return keep;
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
    r = Math.hypot(tx, tz);
  const keep = Math.hypot(dx, dz) < SUPPORT_REACH ? pinKeep(x, z) : 0;
  if (!keep) return [base, 0, 0, bank];
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
  return [base, knoll * knollKeep, relief * keep, bank];
}

// The supported ground at x/z; banks false leaves out the soil banks (what
// tools/bake-root-shade.mjs measures them against).
export function rootSupportHeight(x, z, baseHeight, banks = true) {
  const [base, knoll, relief, bank] = rootSupportLifts(x, z, baseHeight, banks);
  return base + knoll + relief + bank;
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
// - occlusion: ROOT_SHADE's sky term dims the unshadowed fills, the lantern
//   (less: it is the main light under the arches), the sky light and the
//   reflections; its key term dims the moon only where no shadow map does
//   (slateContactGain 1: shadows off);
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
  // Grit and dark organic flecks in the soil near the lens (within near[0],
  // gone by near[1]): cells of 1/frequency units, `share` of them lit or dark,
  // by up to `amount` of the albedo.
  grit: Object.freeze({
    frequency: 11,
    share: 0.12,
    amount: 0.45,
    near: Object.freeze([4, 14]),
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
const { settle: SETTLE, grain: GRAIN, occlusion: OCCLUSION, damp: DAMP, grit: GRIT } = SLATE_SOIL;
// Each direct light is dimmed by the root occlusion: the moon key by its baked
// term (found among the directional lights by direction, mud-ground.js
// slateDirectional), the lantern (the one warm light) and the cool fills (the
// directional fill and the crown's point fill) by the sky term, before the film
// ground's own balance of them (mud-ground.js SLATE_LIGHT).
const ROOT_LIGHTS = `
float slateGate(vec3 L, vec3 C) {
  if (slateSky + slateKeyOcc <= 0.0) return 1.0;
  if (slateDirectional && dot(L, slateKeyView) > .9995) return 1.0 - slateKeyOcc;
  if (C.b < .7*C.r) return 1.0 - ${glsl(OCCLUSION.lantern)}*slateSky;
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
varying vec2 vSlateShade;
varying float vSlatePool;
uniform vec3 slateKeyView;
float slateSky = 0.0, slateKeyOcc = 0.0, slateSettle = 0.0, slateDepth = 0.5, slateKeep = 0.0;
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
float slateGritN = (1.0-smoothstep(${glsl(GRIT.near[0])}, ${glsl(GRIT.near[1])}, length(vViewPosition)))*(1.0-slatePuddle)*(1.0-slateKeep);
if (slateGritN > 0.0) {
  vec2 slateGC = floor(vMudWorld.xz*${glsl(GRIT.frequency)});
  float slateG1 = slateHash(slateGC), slateG2 = slateHash(slateGC+17.31);
  diffuseColor.rgb *= 1.0+${glsl(GRIT.amount)}*slateGritN*(step(${glsl(1 - GRIT.share)}, slateG1)-step(${glsl(1 - GRIT.share)}, slateG2));
}
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
  slateWaterVeil = max((1.0-smoothstep(${glsl(PUDDLE_MIRROR.trunk[0])}, ${glsl(PUDDLE_MIRROR.trunk[1])}, slateVD))*(1.0-smoothstep(${glsl(PUDDLE_MIRROR.trunk[2])}, ${glsl(PUDDLE_MIRROR.trunk[3])}, slateVH)), (1.0-smoothstep(${glsl(PUDDLE_MIRROR.flare[0])}, ${glsl(PUDDLE_MIRROR.flare[1])}, slateVD))*(1.0-smoothstep(${glsl(PUDDLE_MIRROR.flare[2])}, ${glsl(PUDDLE_MIRROR.flare[3])}, slateVH)));
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
if (vSlateShade.x + vSlateShade.y + vSlateRoot.z > 0.0) {
  float slateU = length(vSlateRoot.xy), slateGuard = (1.0-slateKeep)*(1.0-slatePuddle);
  diffuseColor.rgb *= 1.0 - ${glsl(SLATE_SOIL.contact)}*vSlateRoot.z*(1.0-smoothstep(.3, 1.0, slateU))*slateContactGain*slateKeep;
  float slateCrease = vSlateRoot.z/(1.0+${glsl(SLATE_SOIL.crease)}*slateU*slateU)*slateGuard;
  float slateBreak = (slateDepth-.5)*${glsl(OCCLUSION.crack)};
  float slateS0 = max(vSlateShade.x, ${glsl(OCCLUSION.creaseSky)}*slateCrease), slateK0 = vSlateShade.y*${glsl(OCCLUSION.key)};
  slateSky = clamp(slateS0+slateBreak*slateS0*(1.0-slateS0)*2.0, 0.0, 1.0)*slateGuard;
  slateSky = smoothstep(${glsl(OCCLUSION.remap[0])}, ${glsl(OCCLUSION.remap[1])}, slateSky);
  slateSkyVis = 1.0-slateSky;
  slateKeyOcc = clamp(max((slateK0+slateBreak*slateK0*(1.0-slateK0)*2.0)*clamp((slateContactGain-.6)*2.5, 0.0, 1.0), ${glsl(OCCLUSION.creaseKey)}*slateCrease), 0.0, 1.0)*slateGuard;
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
        "attribute vec4 slateRoot;\nattribute vec2 slateShade;\nattribute float slatePool;\nvarying vec4 vSlateRoot;\nvarying vec2 vSlateShade;\nvarying float vSlatePool;\n",
      fragmentShader: ROOT_FRAGMENT,
    })
  )
    return false;
  shader.uniforms.slateKeyView = KEY_VIEW;
  return true;
}

// The lantern puddle's mirror (plan P3): still, clear water. SLATE_PUDDLES'
// grazing sky sheen gives way to a water Fresnel (F0 .02) mirror of the
// terrain horizon, the fog and the zenith, with the tree's trunk as a dark
// occluder and the lantern upside down in it, lit by the lantern light's own
// (flickering) colour and compressed to a luminance knee; the flame's image
// (MIRROR_FLAME) keeps the knee's peak, so it stays well under the flame, but
// not its flattening. The water forms a level plane .02 above the
// lantern's footing, a soft shore that follows the cracks with a damp margin,
// and a static micro-undulation near the lens; rare drips ruffle it. The
// drip-line puddles keep SLATE_PUDDLES' roughness .12 and specular gain 4.
export const PUDDLE_MIRROR = Object.freeze({
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
  water: 0.02,
  cloud: 0.22,
  // hill-silhouette.js TERRAIN_HORIZON and SLATE_PUDDLES.zenith (mud-ground.js).
  horizon: Object.freeze([0.062, 0.065, 0.073]),
  zenith: Object.freeze([0.07, 0.085, 0.13]),
  // The trunk above TREE_FOOTING + TRUNK: radius and height, and its root
  // flare (measured on the tree), and their colour.
  trunk: Object.freeze([1.9, 2.5, 10, 12.5]),
  flare: Object.freeze([3, 4.2, 0.8, 1.8]),
  bark: Object.freeze([0.045, 0.048, 0.05]),
});
// The supplied lantern in its own units (lantern.js LANTERN_AUTHORING_HEIGHT
// 2.48, drawn 1.98 tall): the light sits at its luminous centre, and the
// flame (lantern-flame.js FLAME and FLAME_BASE) stands on the wick at 0.49,
// 0.30 tall and 0.047 wide, its fire in the FLAME colours at gain 1.6, with
// lanternFire's light held in the glass: a halo [strength, half-width, centre
// and height as fractions of the flame's] and fill in the warm colour, a
// glare in the pale one (its no-bloom strength).
export const LANTERN_IMAGE = Object.freeze({ scale: 1.98 / 2.48, glow: 0.7146 });
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
// real flame, added after the knee. The grade inks the real flame's steep
// outline, which the dim, soft image escapes, so the image's body is `width`
// of the flame's and its ends sit `inset` pixel footprints inside the flame's
// (scaling about `mid`, over the `span` of the flame's height it lights).
export const MIRROR_FLAME = Object.freeze({ width: 0.945, inset: 0.7, span: 0.65, mid: 0.46 });
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
    const [front, west, north] = PUDDLE_ZONES;
    if (zone < 0.6) {
      const at = aim(n);
      if (at && zoneDistance(front, at[0], at[1]) < front.radius * DRIP_RIPPLES.inside) {
        const r = DRIP_RIPPLES.aim[0] + (DRIP_RIPPLES.aim[1] - DRIP_RIPPLES.aim[0]) * spread;
        return [at[0] + c * r, at[1] + s * r, age, n];
      }
      const ox = c * Math.sqrt(spread) * 0.45 * front.stretch * front.radius,
        oz = s * Math.sqrt(spread) * 0.45 * front.radius;
      return [front.x + ox * front.c - oz * front.s, front.z + ox * front.s + oz * front.c, age, n];
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
// The puddles that lie on dune slopes keep the ground's height in the mirror:
// the north drip-line puddle and Portrait's foreground one.
const SLOPED = [PUDDLE_ZONES[2], PUDDLE_ZONES[3]];
const LAMP_FOOT = LANTERN_IMAGE.glow * LANTERN_IMAGE.scale;
// slateDrip: the live drip (dripAt(): world x, z, age; w 1 while one lives),
// set per draw on the CPU. slateFlame: the lantern flame's draught (height
// factor, 0 without the flame module; lean in lantern units along world x, z).
const PUDDLE_HEAD = `uniform vec4 slateDrip, slateFlame;
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
  vec3 slateN = normalize(normal*mat3(viewMatrix));
  float slateView = length(vViewPosition);
  if (slateDeep > 0.0) {
    vec2 slateG = vec2(0.0);
    // The undulation's noise only where it has not faded; the rings only while a drip lives.
    if (slateView < ${glsl(M.undulationFade[1])}) {
      vec3 slateU1 = slateNoiseD(mat2(.8, .6, -.6, .8)*vMudWorld.xz*1.7), slateU2 = slateNoiseD(vMudWorld.xz*3.9+17.0);
      slateG = (slateU1.yz*mat2(.8, .6, -.6, .8)+.5*slateU2.yz)*${glsl(M.undulation)}*(1.0-smoothstep(${glsl(M.undulationFade[0])}, ${glsl(M.undulationFade[1])}, slateView));
    }
    if (slateDrip.w > 0.0) slateG += slateRipples(vMudWorld.xz, slatePx*slateView/max(abs(dot(normal, normalize(vViewPosition))), .3));
    slateN = normalize(mix(slateN, normalize(vec3(-slateG.x, 1.0, -slateG.y)), slateDeep));
  }
  vec3 slateV = normalize(cameraPosition-vMudWorld), slateR = reflect(-slateV, slateN);
  float slateF = ${glsl(M.f0)}+${glsl(1 - M.f0)}*pow(1.0-saturate(dot(slateN, slateV)), 5.0), slateRA = max(dot(slateR.xz, slateR.xz), 1e-4);
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
  // The night sky (the film's environment, night-environment.js) at its sharpest; without it, a sky from the horizon, fog and zenith colours.
  #ifdef USE_ENVMAP
  vec3 slateSkyW = textureCubeUV(envMap, slateR, 0.0).rgb*envMapIntensity;
  #else
  vec3 slateSkyW = mix(mix(${glslVec(...M.horizon)}, fogColor, smoothstep(0.0, .1, slateR.y)), ${glslVec(...M.zenith)}, smoothstep(.12, .6, slateR.y));
  slateSkyW *= 1.0+${glsl(2 * M.cloud)}*(slateNoise((slateP.xz+slateR.xz*(60.0/max(slateR.y, .05)))/45.0)-.5)*smoothstep(.02, .12, slateR.y);
  #endif
  // The trunk and its root flare as a dark occluder.
  vec2 slateO = slateP.xz-${TRUNK_GLSL};
  float slateT = -dot(slateO, slateR.xz)/slateRA, slateTH = slateT*slateR.y, slateTD = length(slateO+slateT*slateR.xz), slateTrunk = 0.0;
  if (slateT > 0.0) {
    slateTrunk = max((1.0-smoothstep(${glsl(M.trunk[0])}, ${glsl(M.trunk[1])}, slateTD))*(1.0-smoothstep(${glsl(M.trunk[2])}, ${glsl(M.trunk[3])}, slateTH)), (1.0-smoothstep(${glsl(M.flare[0])}, ${glsl(M.flare[1])}, slateTD))*(1.0-smoothstep(${glsl(M.flare[2])}, ${glsl(M.flare[3])}, slateTH)));
    slateSkyW = mix(slateSkyW, ${glslVec(...M.bark)}, slateTrunk);
  }
  vec3 slateMirror = slateSkyW, slateFlameW = vec3(0.0);
  float slateFlamePk = 0.0;
  vec2 slateLO = slateP.xz-slateLampW.xz;
  float slateLT = -dot(slateLO, slateR.xz)/slateRA;
  if (slateLT > 0.0 && dot(slateLamp, slateLamp) > 0.0 && (slateLT < slateT || slateTrunk < .01)) {
    // Where the reflected ray passes the lantern's axis, in lantern units.
    float slateLX = (slateLO.x*slateR.z-slateLO.y*slateR.x)/sqrt(slateRA)/${glsl(LANTERN_IMAGE.scale)}, slateLY = (slateP.y+slateLT*slateR.y-slateLampW.y)/${glsl(LANTERN_IMAGE.scale)}+${glsl(LANTERN_IMAGE.glow)};
    vec2 slateAA = vec2(slatePx*(slateView+slateLT)/${glsl(LANTERN_IMAGE.scale)})+vec2(.012, .03)*${glsl(M.imageSoft)};
    float slateAX = abs(slateLX), ly = slateLY;
    // Only rays that pass within the lantern's bounds (its widest .59, 0 to 2.49 tall) draw its image.
    if (slateAX < .6+slateAA.x && ly > -slateAA.y && ly < 2.5+slateAA.y) {
    // The cage's silhouette (measured on the lantern): foot, body, eave, dome and finial.
    float slateHW = ly < .1 ? .59 : ly < .3 ? .51 : ly < 1.5 ? .435 : ly < 1.68 ? .59 : ly < 2.1 ? mix(.5, .3, (ly-1.68)/.42) : ly < 2.2 ? mix(.3, .16, (ly-2.1)/.1) : .16-.24*(ly-2.2);
    float slateCageM = (1.0-smoothstep(slateHW-slateAA.x, slateHW+slateAA.x, slateAX))*smoothstep(-slateAA.y, slateAA.y, ly)*(1.0-smoothstep(2.47-slateAA.y, 2.49+slateAA.y, ly));
    float slateGlassM = (1.0-smoothstep(.36-slateAA.x, .36+slateAA.x, slateAX))*smoothstep(.34-slateAA.y, .34+slateAA.y, ly)*(1.0-smoothstep(1.48-slateAA.y, 1.48+slateAA.y, ly));
    float slateLampY = dot(slateLamp, vec3(.2126, .7152, .0722)), slateGlobe = length(vec2(slateAX/.2, (ly-.74)/.34));
    // Through the clear globe the sky and, without the flame module, a faint glow (with it, the flame's image carries the glass's light); the dark cage with the flame-lit inner faces of its posts and the roof's underside.
    vec3 slateGlassC = slateSkyW*.8+slateLamp*(.03*(1.0-smoothstep(.5, 1.0, slateGlobe))+.02*exp(-3.0*slateGlobe*slateGlobe))*(1.0-step(.01, slateFlame.x));
    vec3 slateCageC = vec3(.012, .013, .026)+slateLamp*(.25*exp(-pow2((slateAX-.37)/(.018+slateAA.x))-pow2((ly-.8)/.55))*step(.3, ly)*step(ly, 1.52)+.12*exp(-pow2((ly-1.49)/(.02+slateAA.y))))*step(slateAX, .44);
    // The v3 flame (lantern-flame.js lanternFire): blue cup, dark vapour cone, yellow-white core, yellow body, orange-red tip, at
    // the flame's own draught (slateFlame): its height, and its lean, which grows up the flame. Its ends sit MIRROR_FLAME.inset
    // pixel footprints (fp) inside the flame's.
    float fp = slatePx*(slateView+slateLT)/${glsl(LANTERN_IMAGE.scale)};
    float fh = ${glsl(F.height)}*max(slateFlame.x, .01), fu = ((ly-${glsl(F.base)})/fh-${glsl(MF.mid)})*(1.0+${glsl((2 * MF.inset) / MF.span)}*fp/fh)+${glsl(MF.mid)}, fs = clamp((fu+.08)/1.08, 0.0, 1.0), fr = clamp(fu, 0.0, 1.0);
    float fw = ${glsl(F.halfWidth * 1.45)}*sin(3.1416*pow(fs, .74))*(1.0-.22*fs), fx = abs(slateLX-(slateFlame.z*slateR.z-slateFlame.w*slateR.x)/sqrt(slateRA)*fr*fr), fq = fx/max(fw, .005), fa = max(fp-.7*fw, 1e-4);
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
    slateFlameW *= slateSharp;
    slateFlamePk = ${glsl(FLAME_PEAK)}*slateLampY;
    }
  }
  // Water Fresnel, then a soft luminance knee that keeps the hue. The flame's image comes after it, at the knee's share of
  // the flame's peak (its core at the lamp's light) over the rest: as bright as the knee lets the flame be, without its flattening.
  vec3 slateRefl = slateMirror*slateF;
  float slateY = dot(slateRefl, vec3(.2126, .7152, .0722)), slateKnee = ${glsl(M.knee)}*(1.0-exp(-slateY/${glsl(M.knee)}));
  slateRefl *= slateKnee/max(slateY, 1e-5);
  slateRefl += slateFlameW*(${glsl(M.knee)}*(1.0-exp(-(slateY+slateFlamePk*slateF)/${glsl(M.knee)}))-slateKnee);
  reflectedLight.directDiffuse *= 1.0-slateF*slateWater;
  reflectedLight.indirectDiffuse *= 1.0-slateF*slateWater;
  reflectedLight.directSpecular *= mix(1.0, ${glsl(M.ggxKeep)}, slateLanternPuddle);
  vec3 slateZoneRefl = slateRefl*slateWater;
  reflectedLight.indirectSpecular += slateZoneRefl/(1.0+slateBehind*dot(slateZoneRefl, vec3(.2126, .7152, .0722))/SLATE_TEXT_KNEE);
}
#endif
`;
// The mirror's own drip clock (settleRoots() advances it), the live drip and
// the flame's draught (settleRoots() sets both per draw of the ground).
const RIPPLE_TIME = { value: DRIP_RIPPLES.start },
  DRIP = { value: [0, 0, 0, 0] },
  FLAME_DRAUGHT = { value: [0, 0, 0, 0] };

// The puddles' own edit list: all or nothing, independent of the root list
// (shadeSlateGround() applies it first; either may fail alone). Returns false,
// leaving the shader unchanged, if the slate program lacks an anchor.
export function shadeSlatePuddles(shader) {
  const edits = [
    ["fragmentShader", "|#define STANDARD", PUDDLE_HEAD],
    // The continuous water level (depth above the detail map's floor).
    ["fragmentShader", "|float slatePuddle =", "float slateLevel;\n"],
    ["fragmentShader", "float slatePuddle = smoothstep(-.04, .04, |", "slateLevel="],
    // Only inside the puddle zones (slateZoneW: the level's zone term is
    // positive; beyond them nothing changes): a soft shore at least a couple
    // of pixels wide, a damp margin that follows the cracks, and the thin
    // film's coat.
    [
      "fragmentShader",
      "|float slateLanternPuddle =",
      `float slateShore = fwidth(slateLevel), slatePx = length(fwidth(normalize(vViewPosition))), slateZoneW = smoothstep(0.0, .04, slateLevel+slateH);
slatePuddle = mix(slatePuddle, smoothstep(${glsl(M.shore[0])}-slateShore, ${glsl(M.shore[1])}+slateShore, slateLevel)*(1.0-slateDry), slateZoneW);
float slateMargin = smoothstep(${glsl(M.margin[0])}-slateShore, ${glsl(M.margin[1])}, slateLevel)*(1.0-slateDry)*(1.0-slatePuddle)*slateZoneW, slateCoat = mix(1.0, smoothstep(0.0, ${glsl(M.coat)}, slateLevel), slateZoneW);
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
      `slatePuddle = slateBody;\nslateLanternPuddle = slateBodyL;\ndiffuseColor.rgb *= 1.0-${glsl(M.marginAlbedo)}*slateMargin;\n`,
    ],
    // In the zone's water, the water film's and the puddles' sky mirror give way to the zone's own.
    [
      "fragmentShader",
      "|vec3 slateWaterRefl =",
      "slateWaterCover *= 1.0-slatePuddle*slateZoneW;\n",
    ],
    ["fragmentShader", "|#include <aomap_fragment>", MIRROR],
  ];
  if (!applyEdits(shader, edits)) return false;
  shader.uniforms.slateDrip = DRIP;
  shader.uniforms.slateFlame = FLAME_DRAUGHT;
  return true;
}

// The hook settleRoots() sets as the ground material's userData.slateRoot
// (mud-ground.js applies it last under the "+root" key): the puddle mirror,
// then the root shading, each all or nothing on its own.
export function shadeSlateGround(shader) {
  const puddles = shadeSlatePuddles(shader);
  return { puddles, roots: shadeSlateRoots(shader) };
}

// The drips' clock: it advances by each drawn frame's time, at most 0.1 s,
// only while the scene animates (never under reduced motion, a visitor pause
// or an open panel: the flame's own holds), and starts in a calm gap. A gap
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
// The same holds index.js passes the flame: reduced motion, a visitor pause
// (scene.isVisitorPaused()) and an open panel (<body data-panel-open>).
function motionHeld() {
  const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  return () =>
    Boolean(
      reduced?.matches ||
      globalThis.BabelSite?.scene?.isVisitorPaused?.() ||
      globalThis.document?.body?.hasAttribute?.("data-panel-open"),
    );
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
// under the dissolve's kept frame, or on any frame while the tour is not
// running. light-shafts.js switches its treatments by the same rule.
function unseen(rendering, tour) {
  const early = fading(rendering);
  return () => !tour?.running || tour.transition.cut || early();
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

// The estate tufts (estate-ground-detail.js) on the film terrain: a blade
// where a root covers the soil, or in the trunk's deep cavity (sky occlusion
// over TUFTS.cull), collapses to a point under the ground; the rest rise and
// fall with the knoll, its relief and the lips, and those in the tree's shade
// darken.
export const TUFTS = Object.freeze({ cull: 0.6, shade: 0.75 });
function settleTufts(growth, liftAt) {
  const p = growth.geometry.attributes.position,
    color = growth.geometry.attributes.color;
  let culled = 0;
  // Four vertices per blade; the first two straddle the tuft's centre.
  for (let i = 0; i + 3 < p.count; i += 4) {
    const x = (p.getX(i) + p.getX(i + 1)) / 2,
      z = (p.getZ(i) + p.getZ(i + 1)) / 2,
      lift = liftAt(x, z);
    const [sky] = rootOcclusion(x, z);
    if (rootCovered(x, z) || sky > TUFTS.cull) {
      const y = (p.getY(i) + p.getY(i + 1)) / 2 + lift - 0.05;
      for (let k = i; k < i + 4; k++) p.setXYZ(k, x, y, z);
      culled++;
      continue;
    }
    if (lift) for (let k = i; k < i + 4; k++) p.setY(k, p.getY(k) + lift);
    if (color && sky > 0.02)
      for (let k = i; k < i + 4; k++)
        color.setXYZ(
          k,
          color.getX(k) * (1 - TUFTS.shade * sky),
          color.getY(k) * (1 - TUFTS.shade * sky),
          color.getZ(k) * (1 - TUFTS.shade * sky),
        );
  }
  p.needsUpdate = true;
  if (color) color.needsUpdate = true;
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
  twigs: 8,
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
  // swallows), `size` wide, sunk `sink` of their height.
  // Most lie beside a resting root (`beside` beyond its half-width); the rest
  // in the crooks `crook` from the trunk, within `among` of a root. Never
  // under a root or an arch, nor at the lantern or a puddle.
  stones: Object.freeze({
    count: 16,
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
  }),
});
// A unit icosphere (one subdivision: 42 vertices, 80 faces), the stones' shape.
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
  const split = faces.flatMap(([a, b, c]) => {
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
  return { vertices, faces: split };
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
export function scatterLitter(surface, groundColor) {
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
  const triangle = (a, b, c, color) => {
    positions.push(...a, ...b, ...c);
    colors.push(...color, ...color, ...color);
  };
  const ground = (x, z, fallback) => {
    const y = surface(x, z);
    return Number.isFinite(y) ? y : fallback;
  };
  const { x: left, z: top, pitch, cols, rows } = ROOT_LATTICE;
  let twigs = 0;
  for (let attempt = 0; placed.length < L.count && attempt < 20000; attempt++) {
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
    if (PUDDLE_ZONES.some((zone) => zoneDistance(zone, x, z) < zone.radius + L.puddle)) continue;
    // Beside a real root, never under one.
    const near = rootCovered(x, z) ? 0 : coverDistance(x, z, L.near[1]);
    if (!(near >= L.near[0] && near <= L.near[1])) continue;
    const [sky] = rootOcclusion(x, z);
    if (sky < L.sky[0] || sky > L.sky[1]) continue;
    if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < L.spacing)) continue;
    const y = surface(x, z);
    if (!Number.isFinite(y)) continue;
    const kind =
      twigs < L.twigs && random() < 0.16 ? "twig" : random() < L.pebbleShare ? "pebble" : "flake";
    const yaw = random() * Math.PI * 2,
      cy = Math.cos(yaw),
      sy = Math.sin(yaw),
      dim = 1 - L.shade * sky;
    if (kind === "pebble") {
      const a = L.pebble[0] + random() * (L.pebble[1] - L.pebble[0]),
        b = a * (0.65 + 0.35 * random()),
        h = a * (0.35 + 0.25 * random());
      const corners = [
        [a, 0, 0],
        [-a, 0, 0],
        [0, 0, b],
        [0, 0, -b],
        [0, h, 0],
        [0, -h * 0.4, 0],
      ].map(([px, py, pz]) => {
        const tx = px * cy - pz * sy,
          tz = px * sy + pz * cy;
        return [x + tx, Math.max(ground(x + tx, z + tz, y), y) + py + h * 0.12, z + tz];
      });
      const color = tone(
        (L.tone.pebble[0] + random() * (L.tone.pebble[1] - L.tone.pebble[0])) * dim,
        random() * 0.6,
      );
      for (const [i, j, k] of [
        [4, 0, 2],
        [4, 2, 1],
        [4, 1, 3],
        [4, 3, 0],
        [5, 2, 0],
        [5, 1, 2],
        [5, 3, 1],
        [5, 0, 3],
      ])
        triangle(
          corners[i],
          corners[j],
          corners[k],
          color.map((value) => value * (i === 4 ? 1 : 0.8)),
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
    if (PUDDLE_ZONES.some((zone) => zoneDistance(zone, x, z) < zone.radius + L.puddle)) continue;
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
    const shape = ICOSPHERE.vertices.map(([vx, vy, vz], k) => {
      const bump = 0.86 + 0.26 * dripHash(Math.floor(jitter) + k, 7);
      return [vx * bump, vy * bump, vz * bump];
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
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  geometry.attributes.normal.array.set(stoneNormals, litterVertices * 3);
  geometry.computeBoundingSphere();
  geometry.userData.litter = placed;
  // The stones' vertices follow the litter's.
  geometry.userData.stones = stones;
  geometry.userData.litterVertices = litterVertices;
  return geometry;
}

// Once the film terrain is in place (film-scene.js): settle the estate tufts
// (settleTufts()), strew the litter as a child of their mesh, and return the
// terrain-aware height the rocks are seated with. The slate's ground shading
// (shadeSlateGround(): the puddle mirror and the root shading) never holds the
// reveal or links in a draw: once the canvas shows, its program links on a
// detached stand-in, and the ground switches to it where the change cannot
// show mid-shot: on a tour cut, on any frame while the tour is not running,
// or in the fade-in's first SHADING_EARLY ms. A light, map or quality change
// that alters the ground's program meanwhile links it again first. Where
// programs cannot link in parallel, the switch's own draw links it, on a cut
// (or a still frame), never in the fade-in, which the light shafts' own
// links need (light-shafts.js). From the switch on,
// each draw of the ground brings the moon key's view direction up to date and
// advances the drips' clock. Disposing the terrain withdraws all of it.
export function settleRoots(
  terrain,
  ground,
  rendering,
  groundHeight,
  invalidate = () => {},
  tour = null,
) {
  const liftAt = terrainLift(terrain),
    material = ground.material;
  const height = (x, z) => groundHeight(x, z) + liftAt(x, z);
  const growth = ground.parent?.getObjectByName("estate-ground-growth");
  let litter = null;
  if (growth?.geometry.attributes.position) {
    settleTufts(growth, liftAt);
    litter = new Mesh(
      scatterLitter(terrainHeight(terrain), material.color ?? { r: 0.36, g: 0.31, b: 0.28 }),
      growth.material,
    );
    litter.name = "estate-root-litter";
    litter.receiveShadow = true;
    litter.castShadow = false;
    litter.matrixAutoUpdate = false;
    litter.updateMatrix();
    growth.add(litter);
  }
  const renderer = rendering.renderer,
    scene = rendering.homeScene,
    early = earlyFade(rendering, SHADING_EARLY);
  const allowed = () => !tour?.running || tour.transition.cut || (parallel && early());
  const clock = dripClock(RIPPLE_TIME, motionHeld()),
    keyWorld = new Vector3(),
    keyTarget = new Vector3();
  const lampAt = new Vector3(),
    eye = new Vector3(),
    lean = new Vector3(),
    origin = new Vector3();
  let live = true,
    probe = null,
    linking = false,
    linked = "",
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
  }
  // A stand-in's material is freed only once its link has settled: Three
  // polls the program of every material it is still linking.
  const release = () => {
    const stale = probe;
    probe = null;
    stale?.userData.settled.then(() => stale.material.dispose());
  };
  terrain.addEventListener("dispose", () => {
    live = false;
    release();
    if (material.userData.slateRoot === shadeSlateGround) {
      delete material.userData.slateRoot;
      material.needsUpdate = true;
    }
    if (ground.onBeforeRender === beforeRender) delete ground.onBeforeRender;
    if (ground.userData.slateDrips === clock) delete ground.userData.slateDrips;
    if (litter) {
      litter.removeFromParent();
      litter.geometry.dispose();
    }
  });
  const shadedKey = () => {
    material.userData.slateRoot = shadeSlateGround;
    const key = material.customProgramCacheKey?.();
    delete material.userData.slateRoot;
    return key;
  };
  // Everything that enters the shaded program's key: the slate's key and
  // state, and the scene's visible lights and shadows.
  const programState = () => {
    let state = `${shadedKey()}|${material.version}|${Boolean(renderer?.shadowMap?.enabled)}`;
    scene?.traverseVisible((object) => {
      if (object.isLight) state += `|${object.type}${object.castShadow ? "+" : ""}`;
    });
    return state;
  };
  function link() {
    const state = programState(),
      key = shadedKey();
    release();
    // Only a slate that takes the shading has a new program, and only where
    // programs link in parallel; otherwise the switch's draw links it.
    parallel =
      typeof key === "string" &&
      key.endsWith("+root") &&
      typeof renderer?.compileAsync === "function" &&
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
          shadeSlateGround(shader);
        },
      }),
    );
    // Against a composer target, whose program keys the scene pass uses
    // (rendering.compileShaders()), with the scene's lights and fog.
    const previous = renderer.getRenderTarget?.() ?? null;
    let pending = null;
    try {
      renderer.setRenderTarget?.(rendering.composer?.readBuffer ?? null);
      pending = renderer.compileAsync(stand, rendering.camera, scene);
    } catch {
      pending = null;
    } finally {
      renderer.setRenderTarget?.(previous);
    }
    stand.userData.settled = Promise.resolve(pending).catch(() => {});
    probe = stand;
    linking = true;
    // A link still pending after two seconds is left to the switch's draw.
    Promise.race([
      stand.userData.settled,
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]).then(() => {
      if (probe !== stand) return;
      linking = false;
      linked = state;
    });
  }
  function commit() {
    material.userData.slateRoot = shadeSlateGround;
    material.needsUpdate = true;
    // The water first shows now: its drips start in a calm gap.
    if (!clocked) {
      clocked = true;
      clock.reset();
      ground.onBeforeRender = beforeRender;
      // Scripted review can read or set the drips' time here.
      ground.userData.slateDrips = clock;
    }
    // Hold the stand-in's program until the ground has drawn with it.
    if (probe)
      ground.onAfterRender = function () {
        delete this.onAfterRender;
        release();
      };
    invalidate();
  }
  (function check() {
    if (!live) return;
    const container = renderer?.domElement?.parentNode;
    if (!linking && !linked && (!container || container.classList?.contains("is-ready"))) link();
    if (linked && allowed()) {
      if (linked === programState()) return commit();
      linked = "";
    }
    nextFrame(check);
  })();
  return height;
}

// POOL_FIELD over a w x h grid of heights (row by row); at(i, j) gives a
// vertex's world [x, z].
export function poolField(heights, w, h, at) {
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
  for (let j = 0; j < h; j++) box(heights, across, w, (i) => j * w + i);
  const mean = new Float32Array(w * h);
  for (let i = 0; i < w; i++) box(across, mean, h, (j) => j * w + i);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const edge = Math.min(i, j, w - 1 - i, h - 1 - j) - r;
      if (edge < 0) continue;
      const [x, z] = at(i, j);
      cavity[j * w + i] =
        (mean[j * w + i] - heights[j * w + i]) *
        pinKeep(x, z) *
        Math.min(1, (edge + 1) / POOL_FIELD.edge);
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

// The film terrain's surface before the root supports (the dunes blended out
// beyond 88 units, and the foothills), a few rows at a time. Returns its
// sampler: height, and optionally the shading normal, at x/z.
function* coarseSurface(baseHeight, EARTH) {
  // Beyond the blend the base term is exactly zero; it is not evaluated there.
  const groundHeight = (x, z) => {
    const t = Math.min(1, Math.max(0, (Math.hypot(x, z) - 88) / 25));
    return (t < 1 ? baseHeight(x, z) * (1 - t * t * (3 - 2 * t)) : 0) + foothillHeight(x, z);
  };
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
  const count = grid + fans,
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
  // ROOT_SHADE's sky and key occlusion (0 beyond its lattice), also at float precision.
  const occlusion = new Float32Array(count * 2);
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
    if (near) occlusion.set(rootOcclusion(x, z), i * 2);
    if (i % 8 === 7) yield;
  }
  const pools = poolField(surface, cols + 1, rows + 1, (i, j) => [xs[fineX + i], zs[fineZ + j]]);
  const pool = new Float32Array(count);
  for (let j = 0; j <= rows; j++)
    pool.set(pools.subarray(j * (cols + 1), (j + 1) * (cols + 1)), (fineZ + j) * xs.length + fineX);
  yield;
  let cursor = 0,
    center = grid;
  const vertex = (i, j) => j * xs.length + i;
  const triangle = (corners, polygon, x, z) => {
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
            const a = vertex(col, row),
              b = vertex(col, row + 1),
              c = vertex(col + 1, row + 1),
              d = vertex(col + 1, row);
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
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normalArray, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setAttribute("slateRoot", new BufferAttribute(shading, 4));
  geometry.setAttribute("slateShade", new BufferAttribute(occlusion, 2));
  geometry.setAttribute("slatePool", new BufferAttribute(pool, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  LIFTS.set(geometry, liftSampler(lifts, xs[fineX], zs[fineZ], cols, rows, pitch));
  SURFACES.set(geometry, liftSampler(surface, xs[fineX], zs[fineZ], cols, rows, pitch, NaN));
  return geometry;
}

// Runs a build in slices of a few milliseconds, never a long task, so neither
// the reveal nor a frame waits on it. While the canvas fades in (early), where
// the terrain has to land and the fade itself is the compositor's, slices of
// up to 12 ms run back to back; before it (the reveal's own work goes first)
// and after it they take idle time, and less where the idle wait timed out,
// as nothing else is idle. index.js requests this chunk with the scene, so
// the build starts as the tower arrives, well before a warm load's reveal.
// The terrain has the idle time first: while it slices, rendering.terrainSlicing
// holds a promise the light shafts' own build waits on (light-shafts.js), as
// the terrain can land only under the fade or on a cut while the warm star can
// fade in mid-hold. A cancelled build (the film scene disposed) stops and
// resolves to nothing.
function inSlices(steps, rendering = null, early = () => false, cancelled = () => false) {
  const idle =
    typeof globalThis.requestIdleCallback === "function"
      ? (task) => globalThis.requestIdleCallback(task, { timeout: 100 })
      : (task) => setTimeout(task, 0);
  let done;
  const slicing = new Promise((resolve) => {
    done = resolve;
  });
  if (rendering) rendering.terrainSlicing = slicing;
  return new Promise((resolve, reject) => {
    const finish = (settle, value) => {
      if (rendering?.terrainSlicing === slicing) rendering.terrainSlicing = null;
      done();
      settle(value);
    };
    // Without idle callbacks (Safari), short tasks leave room for the frames.
    const slice = (deadline) => {
      if (cancelled()) return finish(resolve, null);
      const rush = early();
      const until =
        performance.now() +
        (rush
          ? 12
          : !deadline
            ? 5
            : deadline.didTimeout
              ? 2
              : Math.max(2, Math.min(8, deadline.timeRemaining())));
      try {
        for (;;) {
          const next = steps.next();
          if (next.done) return finish(resolve, next.value);
          if (performance.now() >= until) break;
        }
      } catch (error) {
        return finish(reject, error);
      }
      if (rush) setTimeout(slice, 0);
      else idle(slice);
    };
    idle(slice);
  });
}

// The film terrain. Given the scene's rendering, it builds in slices
// (inSlices()) and resolves only where the new ground cannot show mid-shot
// (unseen()); without it (tests), it builds at once. cancelled: the film scene
// is gone, so the build stops, or the finished geometry is freed, and it
// resolves to nothing.
export function createEarthGeometry(
  groundHeight,
  EARTH = { width: 384, subdivisions: 128 },
  rendering = null,
  tour = null,
  cancelled = () => false,
) {
  const steps = earthSteps(groundHeight, EARTH);
  if (!rendering) {
    for (;;) {
      const next = steps.next();
      if (next.done) return next.value;
    }
  }
  const allowed = unseen(rendering, tour);
  return inSlices(steps, rendering, fading(rendering, false), cancelled).then(
    (geometry) =>
      new Promise((resolve) => {
        (function check() {
          if (!geometry || cancelled()) return resolve(geometry?.dispose());
          if (!allowed()) return nextFrame(check);
          rendering.invalidateShadows?.();
          resolve(geometry);
        })();
      }),
  );
}
