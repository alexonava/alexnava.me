import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
  Sphere,
  Vector3,
} from "three";
import { DEPTH_LAYER, stampDepthLayer } from "./depth-layers.js";
import { mistHook } from "./drifting-mist.js";
import { flashHook } from "./film-light.js";
import { ESTATE, estatePathDistance, estatePoint } from "./estate-layout.js";
import { GRASS_MOOD } from "./film-light.js";
import { rockKeepouts } from "./rock-scatter.js";
import { SLATE_PUDDLES, SLATE_STREAMS, riverAt, streamLines } from "./mud-ground.js";

// The same winding approach stays clear in every camera and quality tier.
// Its centerline joins the watch's terrace to the tree's lantern clearing.
export { estatePathDistance };

// The estate's grass: sparse clumps of curved, tapering blades. Each blade is
// BLADE_VERTICES vertices, a strip of `rows` pairs narrowing to the tip; the
// first pair straddles its foot (terrain-build.js settleTufts() reads it).
// Kinds: fine olive grass, broader blue-green sedge and dead straw, as
// [share, width / height, lean, base rgb, tip rgb]. The clumps gather where
// water collects (the river's banks and the puddles' margins: `wet` is the
// acceptance there, `dry` on open slate) and never stand in the water.
export const BLADE_VERTICES = 8;
export const GROWTH = Object.freeze({
  tufts: 580,
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
// The puddle zones (mud-ground.js SLATE_PUDDLES): a point's distance outside a
// zone's footprint, in units (negative inside).
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
// The colour inside the blade. High's film is multisampled, and a blade
// thinner than a pixel can cover a sample but not the pixel's centre, where its
// vertex colour is read past the blade's edges (overshooting toward a pale
// yellow or grey, which the lantern or the moon lights into a one-pixel
// sparkle). A centroid copy is read where the blade covers the pixel; a shot's
// grassInside (film-light.js GRASS_MOOD) takes that share of it, and at 0
// nothing changes. WebGL1 has neither centroid varyings nor the multisampled
// film.
const GRASS_INSIDE = "#if __VERSION__ >= 300\ncentroid varying vec3 vGrassColor;\n#endif";
const GRASS_INSIDE_COLOR = `vec3 grassBase = diffuseColor.rgb;
#include <color_fragment>
#if __VERSION__ >= 300
if (grassInside > 0.0) diffuseColor.rgb = grassBase*mix(vColor, vGrassColor, grassInside);
#endif`;
// Light through the blades: a thin leaf passes `through` of the light that
// falls on its far side, leaning forward (`forward` of it only toward an eye
// looking into the light), so a blade backlit by the lantern or the moon glows
// rather than standing as a dark card. Only the blades (their sky lean, aGrass.y,
// is never 0); the litter and the stones stay opaque.
export const GRASS_THROUGH = Object.freeze({ through: 0.3, forward: 0.6 });
const GRASS_LIGHT = `void RE_Direct_Grass(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight) {
  RE_Direct_Lambert(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  reflectedLight.directDiffuse += step(1e-4, vGrassUp)*saturate(dot(-geometryNormal, directLight.direction))*directLight.color*BRDF_Lambert(material.diffuseColor)*${GRASS_THROUGH.through.toFixed(2)}*(1.-${GRASS_THROUGH.forward.toFixed(2)}*saturate(dot(geometryViewDir, directLight.direction)));
}
#undef RE_Direct
#define RE_Direct RE_Direct_Grass`;
export function grassMaterial() {
  const time = { value: 0 };
  const material = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.grassTime = time;
    shader.uniforms.grassInside = GRASS_MOOD;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nattribute vec2 aGrass;\nuniform float grassTime;\nvarying float vGrassUp;\n${GRASS_INSIDE}`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\nvGrassUp = aGrass.y;\n#if __VERSION__ >= 300\nvGrassColor = vColor;\n#endif\n${GRASS_VERTEX}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\nvarying float vGrassUp;\nuniform float grassInside;\n${GRASS_INSIDE}`,
      )
      .replace("#include <color_fragment>", GRASS_INSIDE_COLOR)
      .replace(
        "#include <lights_lambert_pars_fragment>",
        `#include <lights_lambert_pars_fragment>\n${GRASS_LIGHT}`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        "#include <normal_fragment_begin>\nnormal = normalize(mix(normal, (viewMatrix*vec4(0., 1., 0., 0.)).xyz, vGrassUp));",
      );
  };
  material.customProgramCacheKey = () => "estate-grass-v2";
  material.userData.grassTime = time;
  // A lightning flash after the lights (film-light.js flashHook()) and the drifting
  // mist after the fog (drifting-mist.js): the growth, litter and rushes.
  flashHook(material);
  return stampDepthLayer(mistHook(material), DEPTH_LAYER.ground);
}

// Distance outside the streams (SLATE_STREAMS: each course's half-width where
// it passes, its meander included), in units.
const STREAM_LINES = streamLines();
// Each course in runs of STREAM_RUN segments, boxed: the half-width at every
// sample, the run's widest, and its box [x0, x1, z0, z1].
const STREAM_RUN = 4;
const STREAM_RUNS = STREAM_LINES.flatMap(({ points, width, length }) => {
  const half = points.map(([, , s]) => (width[0] + ((width[1] - width[0]) * s) / length) / 2),
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
  return best - SLATE_STREAMS.meander;
}

// Both paths consume the same seeded builder. The immediate path remains for
// callers without scene preparation; the live scene prepares during downloads.
export function createEstateGroundDetail(groundHeight) {
  const steps = groundDetailSteps(groundHeight);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

export function prepareEstateGroundDetail(groundHeight, { cancelled = () => false } = {}) {
  const steps = groundDetailSteps(groundHeight),
    idle =
      typeof globalThis.requestIdleCallback === "function"
        ? (task) => globalThis.requestIdleCallback(task, { timeout: 100 })
        : (task) => setTimeout(task, 0);
  return new Promise((resolve, reject) => {
    const slice = (deadline) => {
      try {
        if (cancelled()) {
          steps.return();
          return resolve(null);
        }
        const budget = deadline?.didTimeout
            ? 2
            : deadline
              ? Math.max(1, Math.min(5, deadline.timeRemaining()))
              : 5,
          until = performance.now() + budget;
        for (;;) {
          const next = steps.next();
          if (next.done) return resolve(next.value);
          if (performance.now() >= until) break;
        }
        idle(slice);
      } catch (error) {
        reject(error);
      }
    };
    idle(slice);
  });
}

// r160's indexed normals, with the same Float32 accumulation and final
// normalization. Bounds likewise take the same two passes, in short steps.
function* finishGrassGeometry(geometry) {
  const position = geometry.attributes.position,
    index = geometry.index,
    normal = new BufferAttribute(new Float32Array(position.count * 3), 3),
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    na = new Vector3(),
    nb = new Vector3(),
    nc = new Vector3(),
    cb = new Vector3(),
    ab = new Vector3();
  geometry.setAttribute("normal", normal);
  for (let i = 0; i < index.count; i += 3) {
    const va = index.getX(i),
      vb = index.getX(i + 1),
      vc = index.getX(i + 2);
    a.fromBufferAttribute(position, va);
    b.fromBufferAttribute(position, vb);
    c.fromBufferAttribute(position, vc);
    cb.subVectors(c, b);
    ab.subVectors(a, b);
    cb.cross(ab);
    na.fromBufferAttribute(normal, va).add(cb);
    nb.fromBufferAttribute(normal, vb).add(cb);
    nc.fromBufferAttribute(normal, vc).add(cb);
    normal.setXYZ(va, na.x, na.y, na.z);
    normal.setXYZ(vb, nb.x, nb.y, nb.z);
    normal.setXYZ(vc, nc.x, nc.y, nc.z);
    if (i % 1536 === 0) yield;
  }
  for (let i = 0; i < position.count; i++) {
    a.fromBufferAttribute(normal, i).normalize();
    normal.setXYZ(i, a.x, a.y, a.z);
    if (i % 2048 === 0) yield;
  }
  normal.needsUpdate = true;
  const box = new Box3(),
    sphere = new Sphere();
  for (let i = 0; i < position.count; i++) {
    box.expandByPoint(a.fromBufferAttribute(position, i));
    if (i % 2048 === 0) yield;
  }
  box.getCenter(sphere.center);
  let radiusSq = 0;
  for (let i = 0; i < position.count; i++) {
    a.fromBufferAttribute(position, i);
    radiusSq = Math.max(radiusSq, sphere.center.distanceToSquared(a));
    if (i % 2048 === 0) yield;
  }
  sphere.radius = Math.sqrt(radiusSq);
  geometry.boundingSphere = sphere;
}

function* groundDetailSteps(groundHeight) {
  let seed = 73421;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const between = ([a, b]) => a + random() * (b - a);
  // Bound the scratch buffers by the authored tuft/blade limits. Copy only
  // their used spans into the geometry, retaining the seeded order and exact
  // Float32 values without growing arrays or allocating colours per row.
  const maxBlades = GROWTH.tufts * Math.ceil(Math.max(...GROWTH.blades)),
    maxVertices = maxBlades * BLADE_VERTICES,
    positions = new Float32Array(maxVertices * 3),
    colors = new Float32Array(maxVertices * 3),
    grass = new Float32Array(maxVertices * 2),
    indices = new Uint32Array(maxBlades * (GROWTH.rows.length - 1) * 6),
    ends = [];
  let count = 0,
    vertexCount = 0,
    indexCount = 0;
  // Growth never pokes through a scattered rock or its pebble (rock-scatter.js).
  const rocks = rockKeepouts();
  for (let attempt = 0; attempt < 9000 && count < GROWTH.tufts; attempt++) {
    if (attempt % 8 === 0) yield;
    const tree = attempt % 2,
      angle = random() * Math.PI * 2,
      anchor = tree ? ESTATE.tree : ESTATE.watch;
    const radius = (tree ? 5.9 : 10.5) + Math.pow(random(), 1.7) * (tree ? 10 : 17);
    const x = anchor.x + Math.cos(angle) * radius;
    const z = anchor.z + Math.sin(angle) * radius;
    // The river in units outside its wobbled shore, the puddles and the streams.
    const river = riverAt(x, z),
      water = Math.min(
        (river.r - 1) * river.w,
        ...WATER.map((zone) => outside(zone, x, z)),
        streamDistance(x, z),
      );
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
      const start = vertexCount;
      for (let row = 0; row < GROWTH.rows.length; row++) {
        const narrow = GROWTH.rows[row];
        const t = row / (GROWTH.rows.length - 1),
          bend = lean * Math.pow(t, 1.7),
          // The blade's flat turns a little toward its tip.
          spin = yaw + Math.PI / 2 + twist * t,
          wx = Math.cos(spin) * width * narrow * 0.5,
          wz = Math.sin(spin) * width * narrow * 0.5;
        const cx = fx + lx * bend,
          cz = fz + lz * bend,
          cy = y + height * t - Math.pow(t, 2.4) * lean * 0.25;
        const positionAt = vertexCount * 3;
        positions[positionAt] = cx - wx;
        positions[positionAt + 1] = cy;
        positions[positionAt + 2] = cz - wz;
        positions[positionAt + 3] = cx + wx;
        positions[positionAt + 4] = cy;
        positions[positionAt + 5] = cz + wz;
        // Damp and dark at the foot, drying toward the tip.
        const end = dry && t > 0.5 ? GROWTH.kinds[2][4] : tip,
          mixT = Math.pow(t, 0.8);
        for (let channel = 0; channel < 3; channel++) {
          const value = (base[channel] + (end[channel] - base[channel]) * mixT) * tone;
          colors[positionAt + channel] = value;
          colors[positionAt + channel + 3] = value * 0.92;
        }
        const sway = Math.pow(t, 1.8) * height,
          up = GROWTH.up * (0.4 + 0.6 * t),
          grassAt = vertexCount * 2;
        grass[grassAt] = grass[grassAt + 2] = sway * GROWTH.sway;
        grass[grassAt + 1] = grass[grassAt + 3] = up;
        vertexCount += 2;
      }
      for (let row = 0; row + 1 < GROWTH.rows.length; row++) {
        const a = start + row * 2;
        indices[indexCount++] = a;
        indices[indexCount++] = a + 1;
        indices[indexCount++] = a + 3;
        indices[indexCount++] = a;
        indices[indexCount++] = a + 3;
        indices[indexCount++] = a + 2;
      }
    }
    ends.push(indexCount);
    count++;
  }
  const geometry = new BufferGeometry();
  let material = null,
    finished = false;
  try {
    yield;
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(positions.subarray(0, vertexCount * 3), 3),
    );
    yield;
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(colors.subarray(0, vertexCount * 3), 3),
    );
    yield;
    geometry.setAttribute(
      "aGrass",
      new Float32BufferAttribute(grass.subarray(0, vertexCount * 2), 2),
    );
    const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new BufferAttribute(new IndexArray(indices.subarray(0, indexCount)), 1));
    yield;
    yield* finishGrassGeometry(geometry);
    geometry.userData.bladeVertices = BLADE_VERTICES;
    // Film-only growth dissolves with the ground it stands on.
    material = grassMaterial();
    const mesh = new Mesh(geometry, material);
    // terrain-build.js settleRoots() finds it by name and raises the blades that
    // stand on the tree's knoll once the film terrain arrives, then hangs the
    // litter and the river's rushes under it.
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
    const controller = {
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
      // holds under reduced motion or a visitor pause.
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
    finished = true;
    return controller;
  } finally {
    if (!finished) {
      geometry.dispose();
      material?.dispose();
    }
  }
}
