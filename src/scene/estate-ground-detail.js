import {
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
} from "three";
import { DEPTH_LAYER, stampDepthLayer } from "./depth-layers.js";
import { ESTATE, estateLantern, estatePathDistance, estatePoint } from "./estate-layout.js";
import { rockKeepouts } from "./rock-scatter.js";
import { SLATE_PUDDLES, SLATE_STREAMS } from "./mud-ground.js";

// The same winding approach stays clear in every camera and quality tier.
// Its centerline joins the tower's entrance side to the tree's lantern clearing.
export { estatePathDistance };

// The estate's grass: sparse clumps of curved, tapering blades. Each blade is
// BLADE_VERTICES vertices, a strip of `rows` pairs narrowing to the tip; the
// first pair straddles its foot (terrain-build.js settleTufts() reads it).
// Kinds: fine olive grass, broader blue-green sedge and dead straw, as
// [share, width / height, lean, base rgb, tip rgb]. The clumps gather where
// water collects (the pond's bank and the puddles' margins: `wet` is the
// acceptance there, `dry` on open slate) and never stand in the water.
export const BLADE_VERTICES = 8;
export const GROWTH = Object.freeze({
  tufts: 540,
  balanced: 0.4,
  blades: Object.freeze([10, 18]),
  size: Object.freeze([0.2, 0.52]),
  rows: Object.freeze([1, 0.86, 0.56, 0.06]),
  kinds: Object.freeze([
    Object.freeze([0.7, 0.075, 0.42, [0.07, 0.086, 0.05], [0.15, 0.17, 0.095]]),
    Object.freeze([0.2, 0.11, 0.3, [0.066, 0.08, 0.064], [0.13, 0.15, 0.115]]),
    Object.freeze([0.1, 0.06, 0.55, [0.09, 0.08, 0.06], [0.21, 0.18, 0.125]]),
  ]),
  dryTips: 0.3,
  wet: 1,
  dry: 0.7,
  // Clumps about the tree outside the tree shots' foreground arc (degrees,
  // atan2(z, x) from the tree) are accepted `behind` as often.
  front: Object.freeze([-175, -55]),
  behind: 0.55,
  bank: 1.6,
  // How far the normal leans to the sky (blades lit as a soft mass, not cards).
  up: 0.55,
  // Wind: sway at the tip (units per unit of blade height) and its speed.
  sway: 0.11,
  speed: 1.6,
});
// The puddle zones (mud-ground.js SLATE_PUDDLES, the pond first): a point's
// distance outside a zone's stretched footprint, in units (negative inside).
const WATER = SLATE_PUDDLES.zones.map(({ anchor, deg, dist, radius, stretch = 1, along = 0 }) => ({
  ...estatePoint(anchor, deg, dist),
  radius,
  stretch,
  c: Math.cos((along * Math.PI) / 180),
  s: Math.sin((along * Math.PI) / 180),
}));
const outside = ({ x: cx, z: cz, radius, stretch, c, s }, x, z) => {
  const u = (c * (x - cx) + s * (z - cz)) / stretch,
    v = -s * (x - cx) + c * (z - cz),
    k = Math.hypot(u, v);
  // Back to world units along the stretched axis.
  return (k - radius) * (k ? Math.hypot((u / k) * stretch, v / k) : 1);
};

// The wind, shared by everything drawn with the growth material: `aGrass` is
// (sway in units at that vertex, sky lean of its normal). Litter and stones
// carry zeros, so they neither sway nor change their shading.
const GRASS_VERTEX = `float grassPhase = grassTime*${GROWTH.speed.toFixed(3)}+dot(position.xz, vec2(.61, .43));
transformed.xz += aGrass.x*(vec2(.8, .5)*sin(grassPhase)+vec2(.25, .4)*sin(grassPhase*2.3+position.z*1.7));`;
// The wind's clock wraps after a whole number of both its waves' cycles
// (speed and 2.3 times it), so it never jumps and its float stays precise.
const WIND_PERIOD = (20 * Math.PI * 10) / GROWTH.speed;
export function grassMaterial() {
  const time = { value: 0 };
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 aGrass;\nuniform float grassTime;\nvarying float vGrassUp;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvGrassUp = aGrass.y;\n${GRASS_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGrassUp;")
      .replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal = normalize(mix(normal, (viewMatrix*vec4(0., 1., 0., 0.)).xyz, vGrassUp));",
      );
  };
  material.customProgramCacheKey = () => "estate-grass-v1";
  material.userData.grassTime = time;
  return stampDepthLayer(material, DEPTH_LAYER.ground);
}

// Distance outside the rain streams (SLATE_STREAMS, at their widest), in units.
const LANTERN = estateLantern();
export function streamDistance(x, z) {
  let best = Infinity;
  for (const path of SLATE_STREAMS.paths)
    for (let k = 1; k < path.length; k++) {
      const ax = LANTERN.x + path[k - 1][0],
        az = LANTERN.z + path[k - 1][1],
        bx = LANTERN.x + path[k][0] - ax,
        bz = LANTERN.z + path[k][1] - az,
        h = Math.min(1, Math.max(0, ((x - ax) * bx + (z - az) * bz) / (bx * bx + bz * bz)));
      best = Math.min(best, Math.hypot(x - ax - bx * h, z - az - bz * h));
    }
  return best - SLATE_STREAMS.width[1] / 2 - SLATE_STREAMS.meander;
}

export function createEstateGroundDetail(groundHeight) {
  let seed = 73421;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  const positions = [],
    colors = [],
    grass = [],
    indices = [],
    ends = [];
  let count = 0;
  // Growth never pokes through a scattered rock or its pebble (rock-scatter.js).
  const rocks = rockKeepouts();
  for (let attempt = 0; attempt < 9000 && count < GROWTH.tufts; attempt++) {
    const tree = attempt % 2,
      angle = random() * Math.PI * 2,
      anchor = tree ? ESTATE.tree : ESTATE.tower;
    const radius = (tree ? 5.9 : 10.5) + Math.pow(random(), 1.7) * (tree ? 10 : 17);
    const x = anchor.x + Math.cos(angle) * radius;
    const z = anchor.z + Math.sin(angle) * radius;
    const water = Math.min(...WATER.map((zone) => outside(zone, x, z)), streamDistance(x, z));
    const wet = water < 0 ? 0 : Math.exp(-Math.pow(water / GROWTH.bank, 2));
    const degrees = (angle * 180) / Math.PI - 360,
      front = !tree || (degrees >= GROWTH.front[0] && degrees <= GROWTH.front[1]),
      keep = (GROWTH.dry + (GROWTH.wet - GROWTH.dry) * wet) * (front ? 1 : GROWTH.behind);
    if (
      water < 0.1 ||
      random() > keep ||
      estatePathDistance(x, z) < ESTATE.path.clear ||
      Math.sin(x * 0.6 + Math.cos(z * 0.37)) < -0.35 ||
      rocks.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.radius)
    )
      continue;
    const size = between(GROWTH.size) * (1 + 0.25 * wet),
      tone = 0.82 + random() * 0.36,
      blades = Math.round(between(GROWTH.blades)),
      y = groundHeight(x, z) - 0.018;
    for (let blade = 0; blade < blades; blade++) {
      let pick = random(),
        kind = GROWTH.kinds[0];
      for (const candidate of GROWTH.kinds)
        if ((pick -= candidate[0]) < 0) {
          kind = candidate;
          break;
        }
      const [, slim, leanMax, base, tip] = kind;
      const height = size * (0.55 + 0.6 * random()),
        width = height * slim * (0.8 + 0.4 * random()),
        yaw = random() * Math.PI * 2,
        lean = height * leanMax * (0.35 + 0.65 * random()),
        dry = kind === GROWTH.kinds[0] && random() < GROWTH.dryTips;
      // The foot sits a little off the clump's centre, leaning outward.
      const lx = Math.cos(yaw),
        lz = Math.sin(yaw),
        foot = size * 0.05 * random(),
        fx = x + lx * foot,
        fz = z + lz * foot,
        twist = (random() - 0.5) * 0.9;
      const start = positions.length / 3;
      GROWTH.rows.forEach((narrow, row) => {
        const t = row / (GROWTH.rows.length - 1),
          bend = lean * Math.pow(t, 1.7),
          // The blade's flat turns a little toward its tip.
          spin = yaw + Math.PI / 2 + twist * t,
          wx = Math.cos(spin) * width * narrow * 0.5,
          wz = Math.sin(spin) * width * narrow * 0.5;
        const cx = fx + lx * bend,
          cz = fz + lz * bend,
          cy = y + height * t - Math.pow(t, 2.4) * lean * 0.25;
        positions.push(cx - wx, cy, cz - wz, cx + wx, cy, cz + wz);
        // Damp and dark at the foot, drying toward the tip.
        const end = dry && t > 0.5 ? GROWTH.kinds[2][4] : tip,
          mixT = Math.pow(t, 0.8);
        const rgb = base.map((b, k) => (b + (end[k] - b) * mixT) * tone);
        colors.push(...rgb, ...rgb.map((value) => value * 0.92));
        const sway = Math.pow(t, 1.8) * height,
          up = GROWTH.up * (0.4 + 0.6 * t);
        grass.push(sway * GROWTH.sway, up, sway * GROWTH.sway, up);
      });
      for (let row = 0; row + 1 < GROWTH.rows.length; row++) {
        const a = start + row * 2;
        indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
    ends.push(indices.length);
    count++;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aGrass", new Float32BufferAttribute(grass, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.userData.bladeVertices = BLADE_VERTICES;
  // Film-only growth dissolves with the ground it stands on.
  const material = grassMaterial();
  const mesh = new Mesh(geometry, material);
  // terrain-build.js settleRoots() finds it by name and raises the blades that
  // stand on the tree's knoll once the film terrain arrives, then hangs the
  // litter and the pond's rushes under it.
  mesh.name = "estate-ground-growth";
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.visible = false;
  let active = false,
    tier = "high",
    disposed = false;
  function apply() {
    mesh.visible = active && tier !== "low";
    const share = tier === "balanced" ? GROWTH.balanced : 1;
    geometry.setDrawRange(0, ends[Math.max(0, Math.ceil(count * share) - 1)] ?? 0);
    // The litter's fine pieces (gravel, clods, leaves) thin out the same way.
    for (const child of mesh.children) {
      // Cut only at a whole piece (finePieces: each piece's first vertex), so
      // no pebble is ever drawn half-built.
      const { fine, finePieces: pieces } = child.geometry?.userData ?? {};
      if (fine) {
        const kept = Math.floor((pieces?.length ?? 0) * share);
        child.geometry.setDrawRange(0, share < 1 && pieces ? (pieces[kept] ?? fine[1]) : fine[1]);
      }
    }
  }
  mesh.userData.retier = apply;
  return {
    mesh,
    setActive(value) {
      if (!disposed) {
        active = Boolean(value);
        apply();
      }
    },
    applyQuality(profile = {}) {
      if (disposed) return false;
      tier = profile.tier || "high";
      apply();
      return true;
    },
    // The wind's clock: it runs with drawn frames (at most 0.1 s a step) and
    // holds under reduced motion, a visitor pause or an open panel.
    update({ deltaSeconds = 0, reducedMotion = false, motionPaused = false } = {}) {
      if (disposed || !active) return false;
      if (!reducedMotion && !motionPaused && Number.isFinite(deltaSeconds))
        material.userData.grassTime.value =
          (material.userData.grassTime.value + Math.max(0, Math.min(0.1, deltaSeconds))) %
          WIND_PERIOD;
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      return true;
    },
  };
}
