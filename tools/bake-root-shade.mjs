// Bakes the twisted tree's root tables for src/scene/terrain-build.js from both
// authored tree variants (images/architecture/tree-{high,balanced}.glb):
//   ROOT_RESTS  soil banks under the resting stretches of the roots,
//   ROOT_SHADE  sky and moon-key occlusion and the contact cut on the 0.75
//               fine lattice (6-bit, 0 neutral),
//   ROOT_COVER  where a root covers the soil (0.25 grid), for the tufts and
//               the litter.
// Deterministic (seeded, no Math.random). `node tools/bake-root-shade.mjs`
// prints the constants to paste into terrain-build.js; the terrain regression
// re-bakes and compares.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  KEY_LIGHT, LANTERN_FOOT, PUDDLE_ZONES, ROOT_LATTICE, ROOT_LINES, rootSupportHeight, SHADE_ALPHABET, terrainSurface, TREE_FOOTING,
  zoneDistance,
} from "../src/scene/terrain-build.js";
import { DOOR_HEIGHT } from "../src/scene/mud-ground.js";

const ease = (a, b, value) => {
  const t = Math.min(1, Math.max(0, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// The ground the root tables must leave exactly as it was (the terrain
// regression pins it): the lantern clearing (2 units about the lantern, where
// the clearing is measured, beyond the 1.4 pin), the front puddle and its
// 0.75 margin, and each drip-line puddle to 0.8 beyond its radius. Distance
// from x/z (world) to that ground; negative inside. A zone's stretched-frame
// distance never exceeds the world distance, so this is a lower bound. The
// occlusion tables pin the puddles closer (SHADE_PIN): the shader already
// keeps root occlusion off the water (slateGuard), and the wider margin left
// pale ground under the roots beside the puddles.
export const SHADE_PIN = Object.freeze([0, 0.05]);
export function pinDistance(x, z, [front, drip] = [0.75, 0.8]) {
  let d = Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) - 2;
  PUDDLE_ZONES.forEach((zone, i) => { d = Math.min(d, zoneDistance(zone, x, z) - zone.radius - (i ? drip : front)); });
  return d;
}
// A lattice vertex's value spreads linearly over the six fine-grid triangles
// about it (diagonal b-d: its neighbours one step along +-x and +-z and at
// (+1,-1) and (-1,+1)). latticeClear() is how far that hexagon stays from the
// pinned ground (0 or less where it reaches it); the vertex may carry a value
// only where it is positive, a bank in full half a unit clear of it.
const HEXAGON = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export function latticeClear(x, z, pitch = ROOT_LATTICE.pitch, margins = undefined) {
  let clear = Infinity;
  for (let k = 0; k < 6; k++) {
    const [ax, az] = HEXAGON[k], [bx, bz] = HEXAGON[(k + 1) % 6];
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8 - i; j++)
      clear = Math.min(clear, pinDistance(x + (ax * i + bx * j) * pitch / 8, z + (az * i + bz * j) * pitch / 8, margins));
  }
  return clear;
}
// Where the occlusion tables may carry a value (their own, closer puddle pins).
export function shadeGuard(x, z, pitch = ROOT_LATTICE.pitch) {
  return latticeClear(x, z, pitch, SHADE_PIN) > 0;
}
export function latticeGuard(x, z, pitch = ROOT_LATTICE.pitch) {
  const clear = latticeClear(x, z, pitch);
  return clear <= 0 ? 0 : ease(0, 0.5, clear);
}
const pointGuard = (x, z) => {
  const d = pinDistance(x, z);
  return d <= 0 ? 0 : ease(0, 0.5, d);
};

// The analytic dunes the film terrain is built on (helpers.js, which runs
// without imports).
export function groundBase() {
  const window = {};
  Function("window", readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"))(window);
  return window.BabelSite.scene.groundHeight;
}

// The tree's triangles as the scene places it: x/z relative to the tree
// anchor, y above its footing (bottom at 0, height DOOR_HEIGHT x 4.2).
export function treeMesh(tier) {
  const raw = readFileSync(new URL(`../images/architecture/tree-${tier}.glb`, import.meta.url));
  const length = raw.readUInt32LE(12), json = JSON.parse(raw.subarray(20, 20 + length));
  const primitive = json.meshes[0].primitives[0], binary = 28 + length;
  const accessor = json.accessors[primitive.attributes.POSITION], view = json.bufferViews[accessor.bufferView];
  if (accessor.componentType !== 5122 || !accessor.normalized) throw new Error("expected normalized int16 positions");
  const start = binary + (view.byteOffset || 0) + (accessor.byteOffset || 0), stride = view.byteStride || 6;
  const positions = new Float64Array(accessor.count * 3);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < accessor.count; i++)
    for (let k = 0; k < 3; k++) {
      const value = raw.readInt16LE(start + i * stride + k * 2) / 32767;
      positions[i * 3 + k] = value;
      if (k === 1) { min = Math.min(min, value); max = Math.max(max, value); }
    }
  const scale = DOOR_HEIGHT * 4.2 / (max - min);
  for (let i = 0; i < accessor.count; i++) {
    positions[i * 3] *= scale;
    positions[i * 3 + 1] = (positions[i * 3 + 1] - min) * scale;
    positions[i * 3 + 2] *= scale;
  }
  const indexAccessor = json.accessors[primitive.indices], indexView = json.bufferViews[indexAccessor.bufferView];
  const indexStart = binary + (indexView.byteOffset || 0) + (indexAccessor.byteOffset || 0);
  const read = indexAccessor.componentType === 5125 ? (i) => raw.readUInt32LE(indexStart + i * 4) : (i) => raw.readUInt16LE(indexStart + i * 2);
  const indices = Uint32Array.from({ length: indexAccessor.count }, (_, i) => read(i));
  return { positions, indices };
}

// The lowest tree surface above x/z (tree-relative) between y0 and y1 (above
// the footing), or Infinity: exact vertical probes through the triangles that
// reach below 3 units, bucketed in half-unit cells.
export function rootProbe({ positions, indices }) {
  const cell = 0.5, x0 = -12, z0 = -15, n = 72, buckets = Array.from({ length: n * n }, () => []);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    if (Math.min(positions[a + 1], positions[b + 1], positions[c + 1]) > 3) continue;
    const i0 = Math.floor((Math.min(positions[a], positions[b], positions[c]) - x0) / cell);
    const i1 = Math.floor((Math.max(positions[a], positions[b], positions[c]) - x0) / cell);
    const j0 = Math.floor((Math.min(positions[a + 2], positions[b + 2], positions[c + 2]) - z0) / cell);
    const j1 = Math.floor((Math.max(positions[a + 2], positions[b + 2], positions[c + 2]) - z0) / cell);
    for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(n - 1, j1); j++) buckets[j * n + i].push(t);
  }
  return (x, z, y0, y1) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((z - z0) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return Infinity;
    let best = Infinity;
    for (const t of buckets[j * n + i]) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const ax = positions[a], az = positions[a + 2], bx = positions[b], bz = positions[b + 2], cx = positions[c], cz = positions[c + 2];
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-12) continue;
      const l0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det, l1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det;
      const l2 = 1 - l0 - l1;
      if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
      const y = l0 * positions[a + 1] + l1 * positions[b + 1] + l2 * positions[c + 1];
      if (y >= y0 && y <= y1 && y < best) best = y;
    }
    return best;
  };
}

// The tree's surface in 0.1-unit voxels over its lower part, and a ray march
// through them (Amanatides-Woo): does a ray from x/y/z (tree-relative, y above
// the footing) hit the tree within reach?
function treeVoxels({ positions, indices }) {
  const size = 0.1, x0 = -10.5, z0 = -14.5, y0 = -1, nx = 290, nz = 290, ny = 150;
  const voxels = new Uint8Array(nx * ny * nz);
  const mark = (x, y, z) => {
    const i = Math.floor((x - x0) / size), j = Math.floor((y - y0) / size), k = Math.floor((z - z0) / size);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) voxels[i + nx * (k + nz * j)] = 1;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    if (Math.min(positions[a + 1], positions[b + 1], positions[c + 1]) > y0 + ny * size) continue;
    const edge = Math.max(
      Math.hypot(positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]),
      Math.hypot(positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]),
      Math.hypot(positions[c] - positions[b], positions[c + 1] - positions[b + 1], positions[c + 2] - positions[b + 2]));
    const steps = Math.max(1, Math.ceil(edge / (size * 0.45)));
    for (let i = 0; i <= steps; i++)
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps, w = j / steps;
        mark(positions[a] + (positions[b] - positions[a]) * u + (positions[c] - positions[a]) * w,
          positions[a + 1] + (positions[b + 1] - positions[a + 1]) * u + (positions[c + 1] - positions[a + 1]) * w,
          positions[a + 2] + (positions[b + 2] - positions[a + 2]) * u + (positions[c + 2] - positions[a + 2]) * w);
      }
  }
  return (ox, oy, oz, dx, dy, dz, reach) => {
    const x = (ox - x0) / size, y = (oy - y0) / size, z = (oz - z0) / size;
    let i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
    const si = dx > 0 ? 1 : -1, sj = dy > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
    const di = dx ? Math.abs(1 / dx) : Infinity, dj = dy ? Math.abs(1 / dy) : Infinity, dk = dz ? Math.abs(1 / dz) : Infinity;
    let ti = dx ? (dx > 0 ? i + 1 - x : x - i) * di : Infinity, tj = dy ? (dy > 0 ? j + 1 - y : y - j) * dj : Infinity;
    let tk = dz ? (dz > 0 ? k + 1 - z : z - k) * dk : Infinity;
    const end = reach / size;
    for (let t = 0; t <= end;) {
      if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return false;
      if (voxels[i + nx * (k + nz * j)]) return true;
      if (ti < tj && ti < tk) { t = ti; ti += di; i += si; } else if (tj < tk) { t = tj; tj += dj; j += sj; } else { t = tk; tk += dk; k += sk; }
    }
    return false;
  };
}

// The film terrain on the lattice before the banks, as terrain-build.js
// renders it: the coarse surface plus the plate and berms at each lattice
// point (every one is a vertex of the fine root grid), linear over the fine
// grid's triangles between them. Heights are ground-local, like groundHeight().
export function latticeGround(base = groundBase()) {
  const { x, z, pitch, cols, rows } = ROOT_LATTICE, sample = terrainSurface(base);
  const heights = Float64Array.from({ length: cols * rows }, (_, i) =>
    rootSupportHeight(x + (i % cols) * pitch, z + Math.floor(i / cols) * pitch, sample, false));
  return { heights, at: (wx, wz) => latticeLinear(heights, wx, wz), floor: base(TREE_FOOTING.x, TREE_FOOTING.z) };
}
// A lattice field at a world x/z, linear over the fine grid's triangles
// (diagonal b-d, as the terrain), with the vertices and weights it used.
export function latticeTriangle(wx, wz) {
  const { x, z, pitch, cols, rows } = ROOT_LATTICE, u = (wx - x) / pitch, v = (wz - z) / pitch;
  const c = Math.min(cols - 2, Math.max(0, Math.floor(u))), r = Math.min(rows - 2, Math.max(0, Math.floor(v))), fx = u - c, fz = v - r;
  const at = (i, j) => (r + j) * cols + c + i;
  return fx + fz <= 1
    ? [[at(0, 0), 1 - fx - fz], [at(1, 0), fx], [at(0, 1), fz]]
    : [[at(1, 1), fx + fz - 1], [at(0, 1), 1 - fx], [at(1, 0), 1 - fz]];
}
const latticeLinear = (values, wx, wz) => latticeTriangle(wx, wz).reduce((sum, [i, w]) => sum + values[i] * w, 0);

// Bake constants (plan 2A; the prototype's Stronger variant).
export const BAKE = Object.freeze({
  rest: Object.freeze({ step: 0.2, low: -0.05, high: 0.62, over: 0.08, arch: 0.6, taper: 1.2, top: 0.1, slope: 1.1, bury: 0.2, clear: 0.62, steep: 1.15 }),
  sky: Object.freeze({ rays: 96, reach: 12, floor: 0.08, seed: 9127, smooth: 2 }),
  // The key's sharp cone needs a third pass: its penumbra then spans two or
  // more lattice cells, so balanced (no shadow map) draws no polygonal edge.
  key: Object.freeze({ rays: 12, reach: 8, cone: 0.02, jitter: 0.05, smooth: 3 }),
  cover: Object.freeze({ gap: 0.3, lift: 0.15 }),
  // Occlusion rises from the pinned ground at most `ramp` per unit (0.23
  // across a lattice step): a soft fade toward the lantern clearing and the
  // puddles, never a straight cliff; and nowhere does either table change by
  // more than `slope` per unit between neighbours (0.25 across a lattice step),
  // which would draw a lattice edge.
  ramp: 0.3,
  slope: 0.33,
  edge: 1.5,
  foot: 0.6,
  gate: Object.freeze([0.25, 0.7]),
  coverGrid: 0.25,
  coverBand: Object.freeze([-0.2, 1.3]),
});

const LCG = (seed) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
const radical = (i) => {
  let b = i >>> 0;
  b = ((b << 16) | (b >>> 16)) >>> 0;
  b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0;
  b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0;
  b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0;
  b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0;
  return b / 4294967296;
};

// Everything the tables hold, from both tree variants.
export function bakeRootShade({ tiers = ["high", "balanced"], base = groundBase() } = {}) {
  const { x: LX, z: LZ, pitch, cols, rows } = ROOT_LATTICE, T = TREE_FOOTING;
  const ground = latticeGround(base), floor = ground.floor;
  const meshes = tiers.map(treeMesh), probes = meshes.map(rootProbe);
  // The lowest surface of either variant within [y0, y1] (ground-local heights).
  const under = (x, z, y0, y1) => Math.min(...probes.map((probe) => probe(x - T.x, z - T.z, y0 - floor, y1 - floor))) + floor;
  const rx = [LX - T.x, LX + (cols - 1) * pitch - T.x], rz = [LZ - T.z, LZ + (rows - 1) * pitch - T.z];
  const edgeFade = (x, z) => ease(0, BAKE.edge, Math.min(x - LX, LX + (cols - 1) * pitch - x, z - LZ, LZ + (rows - 1) * pitch - z));
  const vertices = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const x = LX + col * pitch, z = LZ + row * pitch, y = ground.heights[row * cols + col];
      const clear = latticeClear(x, z), edge = edgeFade(x, z);
      vertices.push({ col, row, x, z, y, gap: under(x, z, y - 0.35, y + 1.3) - y, shadeClear: latticeClear(x, z, pitch, SHADE_PIN), edge,
        guard: (clear <= 0 ? 0 : ease(0, 0.5, clear)) * edge });
    }
  const vertexAt = (col, row) => (col >= 0 && row >= 0 && col < cols && row < rows ? vertices[row * cols + col] : null);

  // Soil banks: where a root's underside lies within R.high of the soil, a
  // narrow round-topped ridge rises to R.over above it, tapering toward each
  // arch; never into the hover band under an arch, never burying by more than
  // R.bury, and none in the lantern clearing or the puddles.
  const R = BAKE.rest, rests = [], arches = [];
  for (let j = 0; LZ + j * R.step <= LZ + (rows - 1) * pitch + 1e-9; j++)
    for (let i = 0; LX + i * R.step <= LX + (cols - 1) * pitch + 1e-9; i++) {
      const x = LX + i * R.step, z = LZ + j * R.step, y = ground.at(x, z), gap = under(x, z, y - 0.35, y + 1.3) - y;
      if (gap > R.high && gap <= R.high + R.arch) arches.push([x, z]);
      else if (gap >= R.low && gap <= R.high && pointGuard(x, z) * edgeFade(x, z) > 0)
        rests.push([x, z, (gap + R.over) * pointGuard(x, z) * edgeFade(x, z)]);
    }
  for (const rest of rests) {
    let near = Infinity;
    for (const [ax, az] of arches) near = Math.min(near, Math.hypot(ax - rest[0], az - rest[1]));
    rest[2] = Math.min(rest[2], R.taper * near);
  }
  const bank = new Float64Array(cols * rows);
  for (const v of vertices) {
    let lift = 0;
    for (const [x, z, h] of rests) {
      const d = Math.hypot(v.x - x, v.z - z), reach = R.top + h / R.slope;
      if (d < reach) lift = Math.max(lift, h * (1 - ease(R.top, reach, d)));
    }
    if (v.gap > R.clear) lift = Math.min(lift, Math.max(0, v.gap - R.clear));
    lift = Math.min(lift, Number.isFinite(v.gap) ? Math.max(0, v.gap + R.bury) : Infinity) * v.guard;
    bank[v.row * cols + v.col] = lift > 0.005 ? +lift.toFixed(3) : 0;
  }
  // Between lattice points the banks are linear, and a root's underside may
  // dip lower: no tree vertex of either variant may end up more than
  // R.bury below the soil where the bank lifts it (or deeper than it was).
  // Every triangle that would bury one gives up the excess.
  const near = meshes.flatMap(({ positions }) => {
    const points = [];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] + T.x, z = positions[i + 2] + T.z;
      if (x < LX || z < LZ || x > LX + (cols - 1) * pitch || z > LZ + (rows - 1) * pitch) continue;
      const soil = ground.at(x, z), y = positions[i + 1] + floor;
      if (y <= soil + 1.3) points.push([x, z, Math.max(0, y - soil + R.bury - 0.005)]);
    }
    return points;
  });
  for (let pass = 0; pass < 24; pass++) {
    let buried = 0;
    for (const [x, z, allowed] of near) {
      const triangle = latticeTriangle(x, z), lifted = triangle.reduce((sum, [i, w]) => sum + bank[i] * w, 0);
      if (lifted <= allowed + 1e-9) continue;
      buried++;
      for (const [i, w] of triangle) if (w > 0) bank[i] = Math.floor(bank[i] * allowed / lifted * 1000) / 1000;
    }
    if (!buried) break;
  }
  // Where a bank meets a berm or the plate's rim, their slopes add: the
  // supported ground stays under R.steep (measured as the terrain regression
  // measures it, on the analytic dunes, 0.25 either side); the banks there
  // give way.
  const supported = (x, z) => rootSupportHeight(x, z, base, false) + latticeTriangle(x, z).reduce((sum, [i, w]) => sum + bank[i] * w, 0);
  for (let pass = 0; pass < 80; pass++) {
    let steep = 0;
    for (let j = Math.ceil(LZ / 0.25); j * 0.25 <= LZ + (rows - 1) * pitch; j++)
      for (let i = Math.ceil(LX / 0.25); i * 0.25 <= LX + (cols - 1) * pitch; i++) {
        const x = i * 0.25, z = j * 0.25, stencil = [[x + 0.25, z], [x - 0.25, z], [x, z + 0.25], [x, z - 0.25]];
        const corners = stencil.flatMap(([sx, sz]) => latticeTriangle(sx, sz)).filter(([k, w]) => w > 0 && bank[k] > 0);
        if (!corners.length) continue;
        const slope = Math.hypot(supported(x + 0.25, z) - supported(x - 0.25, z), supported(x, z + 0.25) - supported(x, z - 0.25)) / 0.5;
        if (slope <= R.steep) continue;
        steep++;
        for (const [k] of corners) bank[k] = Math.floor(bank[k] * 0.92 * 1000) / 1000;
      }
    // ...and so does each rendered triangle of the fine grid (diagonal b-d).
    for (let row = 0; row < rows - 1; row++)
      for (let col = 0; col < cols - 1; col++) {
        const a = row * cols + col, b = a + cols, c = b + 1, d = a + 1;
        for (const [p, q, r] of [[a, b, d], [b, c, d]]) {
          if (!(bank[p] || bank[q] || bank[r])) continue;
          const h = (k) => ground.heights[k] + bank[k], px = (k) => k % cols * pitch, pz = (k) => Math.floor(k / cols) * pitch;
          const ex = px(q) - px(p), ez = pz(q) - pz(p), fx = px(r) - px(p), fz = pz(r) - pz(p), det = ex * fz - fx * ez;
          const gx = ((h(q) - h(p)) * fz - (h(r) - h(p)) * ez) / det, gz = (ex * (h(r) - h(p)) - fx * (h(q) - h(p))) / det;
          if (Math.hypot(gx, gz) <= R.steep) continue;
          steep++;
          for (const k of [p, q, r]) bank[k] = Math.floor(bank[k] * 0.92 * 1000) / 1000;
        }
      }
    if (!steep) break;
  }
  for (let i = 0; i < bank.length; i++) if (bank[i] <= 0.005) bank[i] = 0;
  const bankAt = (col, row) => (col >= 0 && row >= 0 && col < cols && row < rows ? bank[row * cols + col] : 0);

  // Sky (cosine-weighted, per-vertex rotation) and moon-key (a small cone)
  // occlusion from the banked soil, per variant, then averaged.
  const S = BAKE.sky, K = BAKE.key, key = KEY_LIGHT;
  const up = [0, 1, 0], ku = normalize(cross(up, key)), kv = normalize(cross(key, ku));
  const skyRays = Array.from({ length: S.rays }, (_, k) => {
    const u = (k + 0.5) / S.rays, r = Math.sqrt(u), phi = 2 * Math.PI * radical(k);
    return [r * Math.cos(phi), Math.sqrt(1 - u), r * Math.sin(phi)];
  });
  const keyRays = Array.from({ length: K.rays }, (_, k) => {
    const r = K.cone * Math.sqrt((k + 0.5) / K.rays), phi = 2.399963 * k;
    return normalize([0, 1, 2].map((a) => key[a] + ku[a] * r * Math.cos(phi) + kv[a] * r * Math.sin(phi)));
  });
  const channels = meshes.map((mesh) => {
    const hit = treeVoxels(mesh), random = LCG(S.seed), sky = new Float64Array(cols * rows), keyOcc = new Float64Array(cols * rows);
    for (const v of vertices) {
      const ox = v.x - T.x, oz = v.z - T.z, oy = v.y + bankAt(v.col, v.row) - floor + 0.04;
      const turn = random() * Math.PI * 2, c = Math.cos(turn), s = Math.sin(turn);
      let blocked = 0;
      for (const [x, y, z] of skyRays) if (hit(ox, oy, oz, x * c - z * s, y, x * s + z * c, S.reach)) blocked++;
      let shaded = 0;
      for (const [x, y, z] of keyRays)
        if (hit(ox + (random() - 0.5) * 2 * K.jitter, oy, oz + (random() - 0.5) * 2 * K.jitter, x, y, z, K.reach)) shaded++;
      sky[v.row * cols + v.col] = Math.min(1, Math.max(0, (blocked / S.rays - S.floor) / (1 - S.floor)));
      keyOcc[v.row * cols + v.col] = shaded / K.rays;
    }
    // Soil a root covers is never seen; its raw value (about 1) would only
    // bleed into the cells beside the root as straight lattice ramps. It takes
    // its open neighbours' mean plus a little instead.
    const covered = vertices.filter((v) => v.gap - bankAt(v.col, v.row) <= BAKE.cover.gap);
    for (const [field, passes] of [[sky, S.smooth], [keyOcc, K.smooth]]) {
      const next = covered.map((v) => {
        let sum = 0, count = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const u = vertexAt(v.col + a, v.row + b);
          if (u && !(u.gap - bankAt(u.col, u.row) <= BAKE.cover.gap)) { sum += field[u.row * cols + u.col]; count++; }
        }
        return count ? Math.min(field[v.row * cols + v.col], sum / count + BAKE.cover.lift) : field[v.row * cols + v.col];
      });
      covered.forEach((v, k) => { field[v.row * cols + v.col] = next[k]; });
      // [1 2 1] x [1 2 1] passes, so no lattice triangle edge reads.
      for (let pass = 0; pass < passes; pass++) {
        const copy = Float64Array.from(field);
        for (const v of vertices) {
          let sum = 0, weight = 0;
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
            const u = vertexAt(v.col + a, v.row + b);
            if (!u) continue;
            const w = (a ? 1 : 2) * (b ? 1 : 2);
            sum += copy[u.row * cols + u.col] * w;
            weight += w;
          }
          field[v.row * cols + v.col] = sum / weight;
        }
      }
      // Steeper neighbours meet halfway: each pass moves both toward each
      // other by half the excess, which keeps the local mean (a wider
      // penumbra, not a smaller shadow).
      for (let pass = 0; pass < 64; pass++) {
        let excess = 0;
        for (const v of vertices)
          for (const [a, b] of [[1, 0], [0, 1], [1, -1]]) {
            const u = vertexAt(v.col + a, v.row + b);
            if (!u) continue;
            const i = v.row * cols + v.col, j = u.row * cols + u.col, limit = BAKE.slope * pitch * Math.hypot(a, b), d = field[i] - field[j];
            if (Math.abs(d) <= limit) continue;
            const move = (Math.abs(d) - limit) / 2 * Math.sign(d);
            field[i] -= move;
            field[j] += move;
            excess++;
          }
        if (!excess) break;
      }
      // Then the ramp from the pinned ground (exactly 0 on it) and the fade to
      // the lattice's edge, after the smoothing, so neither spreads a cliff.
      for (const v of vertices) field[v.row * cols + v.col] = Math.min(field[v.row * cols + v.col], BAKE.ramp * Math.max(0, v.shadeClear)) * v.edge;
    }
    return { sky, key: keyOcc };
  });

  // The contact cut: ROOT_LINES that stray from the real roots draw no crease
  // over open soil. A vertex more than BAKE.gate from any footprint (a root
  // within BAKE.foot of the soil) loses its contact strength; so does a seam,
  // where neighbouring vertices point at different roots from opposite sides
  // (the interpolated vector would cross zero midway and draw a false crease).
  const foot = [];
  for (let j = 0; LZ + j * 0.2 <= LZ + (rows - 1) * pitch + 1e-9; j++)
    for (let i = 0; LX + i * 0.2 <= LX + (cols - 1) * pitch + 1e-9; i++) {
      const x = LX + i * 0.2, z = LZ + j * 0.2, y = ground.at(x, z);
      if (under(x, z, y - 0.35, y + BAKE.foot) < Infinity) foot.push([x, z]);
    }
  const nearest = (dx, dz) => {
    let best = Infinity, id = -1, vx = 0, vz = 0;
    ROOT_LINES.forEach((line, index) => {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az, ah] = line[i], [bx, bz, bh] = line[i + 1], ex = bx - ax, ez = bz - az;
        const t = Math.min(1, Math.max(0, ((dx - ax) * ex + (dz - az) * ez) / (ex * ex + ez * ez)));
        const nx = ax + ex * t - dx, nz = az + ez * t - dz, d = Math.hypot(nx, nz) / (ah + (bh - ah) * t + 0.8);
        if (d < best) { best = d; id = index; vx = nx; vz = nz; }
      }
    });
    return { id, vx, vz };
  };
  const lines = vertices.map((v) => nearest(v.x - T.x, v.z - T.z));
  const cut = new Float64Array(cols * rows);
  for (const v of vertices) {
    const a = lines[v.row * cols + v.col];
    let seam = 0;
    for (let p = -1; p <= 1 && !seam; p++) for (let q = -1; q <= 1; q++) {
      const u = vertexAt(v.col + p, v.row + q), b = u && lines[u.row * cols + u.col];
      if (b && b.id !== a.id && a.vx * b.vx + a.vz * b.vz < 0) { seam = 1; break; }
    }
    let d = Infinity;
    for (const [fx, fz] of foot) d = Math.min(d, Math.hypot(fx - v.x, fz - v.z));
    const keep = (1 - seam * v.guard) * (1 - ease(...BAKE.gate, d) * v.guard);
    cut[v.row * cols + v.col] = 1 - keep;
  }

  // Root cover on a 0.25 grid over the lattice: a root lies within
  // BAKE.coverBand of the soil there (the tufts collapse, no litter lands).
  const coverCols = Math.round((cols - 1) * pitch / BAKE.coverGrid) + 1, coverRows = Math.round((rows - 1) * pitch / BAKE.coverGrid) + 1;
  const cover = new Uint8Array(Math.ceil(coverCols * coverRows / 8));
  let covers = 0;
  for (let j = 0; j < coverRows; j++)
    for (let i = 0; i < coverCols; i++) {
      const x = LX + i * BAKE.coverGrid, z = LZ + j * BAKE.coverGrid, y = ground.at(x, z);
      if (under(x, z, y + BAKE.coverBand[0], y + BAKE.coverBand[1]) < Infinity) {
        const bit = j * coverCols + i;
        cover[bit >> 3] |= 1 << (bit & 7);
        covers++;
      }
    }

  const quantize = (values) => Array.from(values, (value) => SHADE_ALPHABET[Math.round(Math.min(1, Math.max(0, value)) * 63)]).join("");
  const mean = (field) => Float64Array.from(channels[0][field], (value, i) => channels.reduce((sum, channel) => sum + channel[field][i], 0) / channels.length);
  const rests2 = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) if (bank[row * cols + col]) rests2.push([col, row, bank[row * cols + col]]);
  return {
    rests: rests2,
    shade: { sky: quantize(mean("sky")), key: quantize(mean("key")), cut: quantize(cut) },
    cover: { cols: coverCols, rows: coverRows, bits: Buffer.from(cover).toString("base64"), count: covers },
    tiers: channels.map(({ sky, key }, i) => ({ tier: tiers[i], sky: quantize(sky), key: quantize(key) })),
    stats: { rests: rests.length, arches: arches.length, foot: foot.length, banked: rests2.length },
    rect: { x: rx, z: rz },
  };
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }

// The constants as terrain-build.js holds them.
export function formatRootTables(baked) {
  const rows = (text, width) => text.match(new RegExp(`.{1,${width}}`, "g")).map((row) => `    "${row}",`).join("\n");
  const { cols } = ROOT_LATTICE;
  const rests = baked.rests.map(([col, row, lift]) => `[${col},${row},${lift}]`);
  const restLines = [];
  for (let i = 0; i < rests.length; i += 8) restLines.push("  " + rests.slice(i, i + 8).join(", ") + ",");
  return [
    `export const ROOT_RESTS = Object.freeze([\n${restLines.join("\n")}\n]);`,
    `export const ROOT_SHADE = Object.freeze({\n` +
      ["sky", "key", "cut"].map((name) => `  ${name}: [\n${rows(baked.shade[name], cols)}\n  ].join(""),`).join("\n") + `\n});`,
    `export const ROOT_COVER = Object.freeze({ cols: ${baked.cover.cols}, rows: ${baked.cover.rows}, bits: [\n${rows(baked.cover.bits, 76)}\n].join("") });`,
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const started = performance.now(), baked = bakeRootShade();
  console.log(formatRootTables(baked));
  console.error(`// ${JSON.stringify(baked.stats)} in ${Math.round(performance.now() - started)} ms`);
}
