import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Frustum,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Sphere,
  Vector3,
} from "three";

// A finite, world-seeded field around the authored shots. The cache never
// admits tiles outside these envelopes, including while the visitor walks.
export const FOREGROUND = Object.freeze({
  tile: 8,
  seed: 90731,
  counts: Object.freeze({ grit: 320, pebble: 60, clod: 30, leaf: 20, tuft: 12 }),
  balanced: 0.4,
  batches: Object.freeze({ high: 12, balanced: 6 }),
  triangles: Object.freeze({ high: 160000, balanced: 64000 }),
  bytes: Object.freeze({ high: 32 * 1024 * 1024, balanced: 16 * 1024 * 1024 }),
  ranges: Object.freeze(
    [
      [10, 20],
      [30, 56],
      [18, 34],
      [18, 34],
      [30, 56],
    ].map(Object.freeze),
  ),
  kinds: Object.freeze(["grit", "pebble", "clod", "leaf", "tuft"]),
  layouts: Object.freeze(
    [
      [1920, 1080],
      [1440, 900],
      [2560, 1080],
      [1080, 1920],
      [1992, 1020],
      [820, 1180],
      [390, 844],
      [844, 390],
    ].map(Object.freeze),
  ),
  slope: 0.65,
  legacyCore: 10,
});

export function foregroundHash(x, z, salt = 0) {
  let h =
    Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(salt | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const tileKey = (x, z) => `${x}:${z}`;
const randomFor = (x, z, salt) => {
  let seed = (foregroundHash(x, z, salt) * 4294967296) >>> 0;
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
};
const between = (random, a, b) => a + (b - a) * random();
function polygonsOverlap(a, b) {
  for (const polygon of [a, b])
    for (let k = 0; k < polygon.length; k++) {
      const p = polygon[k],
        q = polygon[(k + 1) % polygon.length],
        nx = p[1] - q[1],
        nz = q[0] - p[0];
      const ap = a.map(([x, z]) => x * nx + z * nz),
        bp = b.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...ap) < Math.min(...bp) - 1e-9 || Math.max(...bp) < Math.min(...ap) - 1e-9)
        return false;
    }
  return true;
}

// Classify the emitted cap, rather than assuming its edge is river radius 1.
// Coarse solid triangles can remain wet beyond that analytic bank.
export function foregroundWaterIndex(terrain) {
  const buckets = new Map(),
    p = terrain?.attributes.position,
    ids = terrain?.index?.array;
  if (!p || !ids) return () => [];
  const first = terrain.userData.riverBedIndexCount ?? ids.length;
  for (let k = first; k < ids.length; k += 3) {
    const triangle = [ids[k], ids[k + 1], ids[k + 2]].map((i) => [p.getX(i), -p.getY(i)]);
    const xs = triangle.map(([x]) => x),
      zs = triangle.map(([, z]) => z);
    for (let x = Math.floor(Math.min(...xs) / 8); x <= Math.floor(Math.max(...xs) / 8); x++)
      for (let z = Math.floor(Math.min(...zs) / 8); z <= Math.floor(Math.max(...zs) / 8); z++) {
        const key = tileKey(x, z);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(triangle);
      }
  }
  return (x, z) => buckets.get(tileKey(Math.floor(x / 8), Math.floor(z / 8))) ?? [];
}

function legacyFootprints(geometries) {
  const buckets = new Map();
  const keep = (x0, z0, x1, z1) => {
    const box = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
        const key = tileKey(x, z);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(box);
      }
  };
  for (const geometry of geometries) {
    const p = geometry.attributes.position,
      starts = geometry.userData.finePieces ?? [];
    for (let n = 0; n < starts.length; n++) {
      let x0 = Infinity,
        z0 = Infinity,
        x1 = -Infinity,
        z1 = -Infinity;
      for (let i = starts[n]; i < (starts[n + 1] ?? p.count); i++) {
        x0 = Math.min(x0, p.getX(i));
        z0 = Math.min(z0, p.getZ(i));
        x1 = Math.max(x1, p.getX(i));
        z1 = Math.max(z1, p.getZ(i));
      }
      if (x0 <= x1) keep(x0 - 0.01, z0 - 0.01, x1 + 0.01, z1 + 0.01);
    }
    for (const [x, z, width] of geometry.userData.stones ?? [])
      keep(x - width, z - width, x + width, z + width);
    for (const [x, z] of geometry.userData.litter ?? [])
      keep(x - 0.28, z - 0.28, x + 0.28, z + 0.28);
  }
  return buckets;
}

export function foregroundPlacement({
  surface,
  terrain = null,
  plunge = null,
  rocks = null,
  legacy = () => [],
  helpers,
}) {
  const {
    ESTATE,
    estatePathDistance,
    coastDistance,
    FALLS,
    SPRAY_FIT,
    LANTERN_FOOT,
    ROOT_LATTICE,
    rootCovered,
    rootOcclusion,
    PUDDLE_ZONES,
    streamRadius,
    zoneDistance,
  } = helpers;
  rocks ??= helpers.rockKeepouts();
  const water = foregroundWaterIndex(terrain);
  const existing = legacyFootprints(typeof legacy === "function" ? legacy() : legacy);
  const pointAllowed = (x, z) => {
    if (coastDistance(x, z) < 2 || estatePathDistance(x, z) < ESTATE.path.clear) return false;
    if (
      Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) < 1.2 ||
      rootCovered(x, z) ||
      rootOcclusion(x, z)[0] > 0.6 ||
      streamRadius(x, z) < 1.04
    )
      return false;
    if (PUDDLE_ZONES.some((zone) => zoneDistance(zone, x, z) < zone.radius + 0.15)) return false;
    if (rocks.some((rock) => Math.hypot(x - rock.x, z - rock.z) < rock.radius)) return false;
    if (
      plunge &&
      Math.hypot(x - plunge[0], z - plunge[1]) < plunge[2] * FALLS.spray[1] * SPRAY_FIT + 2
    )
      return false;
    const y = surface(x, z);
    if (!Number.isFinite(y)) return false;
    const h = 0.1,
      sx = (surface(x + h, z) - surface(x - h, z)) / (2 * h),
      sz = (surface(x, z + h) - surface(x, z - h)) / (2 * h);
    return Number.isFinite(sx + sz) && Math.hypot(sx, sz) <= FOREGROUND.slope;
  };
  const triangleAllowed = (triangle) => {
    const xs = triangle.map(([x]) => x),
      zs = triangle.map(([, z]) => z);
    for (const [x, z] of triangle) if (!pointAllowed(x, z)) return false;
    // The whole emitted footprint, including its interior, clears root cells.
    const x0 = Math.max(ROOT_LATTICE.x, Math.min(...xs) - 0.126),
      x1 = Math.min(ROOT_LATTICE.x + 24, Math.max(...xs) + 0.126);
    const z0 = Math.max(ROOT_LATTICE.z, Math.min(...zs) - 0.126),
      z1 = Math.min(ROOT_LATTICE.z + 23.25, Math.max(...zs) + 0.126);
    for (
      let row = Math.floor((z0 - ROOT_LATTICE.z) / 0.25);
      row <= Math.ceil((z1 - ROOT_LATTICE.z) / 0.25);
      row++
    )
      for (
        let col = Math.floor((x0 - ROOT_LATTICE.x) / 0.25);
        col <= Math.ceil((x1 - ROOT_LATTICE.x) / 0.25);
        col++
      ) {
        const x = ROOT_LATTICE.x + col * 0.25,
          z = ROOT_LATTICE.z + row * 0.25;
        if (
          rootCovered(x, z) &&
          polygonsOverlap(triangle, [
            [x - 0.126, z - 0.126],
            [x + 0.126, z - 0.126],
            [x + 0.126, z + 0.126],
            [x - 0.126, z + 0.126],
          ])
        )
          return false;
      }
    const seen = new Set();
    for (let x = Math.floor(Math.min(...xs)); x <= Math.floor(Math.max(...xs)); x++)
      for (let z = Math.floor(Math.min(...zs)); z <= Math.floor(Math.max(...zs)); z++)
        for (const box of existing.get(tileKey(x, z)) ?? [])
          if (polygonsOverlap(triangle, box)) return false;
    for (let tx = Math.floor(Math.min(...xs) / 8); tx <= Math.floor(Math.max(...xs) / 8); tx++)
      for (let tz = Math.floor(Math.min(...zs) / 8); tz <= Math.floor(Math.max(...zs) / 8); tz++)
        for (const wet of water(tx * 8, tz * 8)) {
          if (seen.has(wet)) continue;
          seen.add(wet);
          if (polygonsOverlap(triangle, wet)) return false;
        }
    // Small edge/interior samples also protect curved path, circular prop and
    // spray boundaries between the mesh vertices.
    for (let k = 0; k < 3; k++) {
      const a = triangle[k],
        b = triangle[(k + 1) % 3],
        steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
      for (let n = 1; n < steps; n++)
        if (!pointAllowed(a[0] + ((b[0] - a[0]) * n) / steps, a[1] + ((b[1] - a[1]) * n) / steps))
          return false;
    }
    return pointAllowed(xs.reduce((a, b) => a + b, 0) / 3, zs.reduce((a, b) => a + b, 0) / 3);
  };
  return { pointAllowed, triangleAllowed };
}

function pieceGeometry(kind, x, z, random, surface, soil, helpers) {
  const { GROWTH, rootOcclusion } = helpers;
  const positions = [],
    normals = [],
    colors = [],
    grass = [],
    index = [];
  const y = surface(x, z),
    yaw = random() * Math.PI * 2,
    cy = Math.cos(yaw),
    sy = Math.sin(yaw);
  const dim = 1 - 0.5 * rootOcclusion(x, z)[0];
  const add = (u, lift, w, nx, ny, nz, rgb, sway = 0, up = 0) => {
    const px = x + u * cy - w * sy,
      pz = z + u * sy + w * cy,
      ground = surface(px, pz);
    const n = Math.hypot(nx, ny, nz) || 1,
      at = positions.length / 3;
    positions.push(px, (Number.isFinite(ground) ? ground : y) + lift, pz);
    normals.push((nx * cy - nz * sy) / n, ny / n, (nx * sy + nz * cy) / n);
    colors.push(...rgb.map((v) => v * dim));
    grass.push(sway, up);
    return at;
  };
  let size;
  if (kind <= 2) {
    const a =
      kind === 0
        ? between(random, 0.012, 0.04)
        : kind === 1
          ? between(random, 0.045, 0.12)
          : between(random, 0.035, 0.1);
    const b = a * between(random, 0.55, 0.95),
      h = a * between(random, 0.3, 0.65),
      sides = kind === 0 ? (a < 0.02 ? 6 : 9) : 12;
    const grey = soil[0] * 0.2126 + soil[1] * 0.7152 + soil[2] * 0.0722;
    const tone = between(random, kind === 2 ? 0.8 : 0.65, kind === 2 ? 1.25 : 1.6);
    const rgb =
      kind === 2
        ? soil.map((v) => v * tone)
        : [grey * tone * 0.96, grey * tone, grey * tone * 1.04];
    const rings =
      kind === 0
        ? [
            [1, -0.15],
            [0.62, 0.8],
          ]
        : [
            [1, -0.15],
            [0.82, 0.51],
            [0.42, 0.89],
          ];
    const jitter = Array.from({ length: sides }, () => between(random, 0.85, 1.15));
    const buried = kind < 2 ? helpers.loosePebbleBurial(x, z, kind) : 0;
    for (const [radius, rise] of rings)
      for (let k = 0; k < sides; k++) {
        const angle = (k * Math.PI * 2) / sides,
          u = Math.cos(angle) * a * radius * jitter[k],
          w = Math.sin(angle) * b * radius * jitter[k];
        add(
          u,
          h * (rise - buried),
          w,
          u / (a * a),
          (h * rise + h * 0.15) / (h * h),
          w / (b * b),
          rgb,
        );
      }
    const top = add(0, h * (1 - buried), 0, 0, 1, 0, rgb);
    for (let r = 0; r < rings.length - 1; r++)
      for (let k = 0; k < sides; k++) {
        const a0 = r * sides + k,
          b0 = r * sides + ((k + 1) % sides),
          c0 = b0 + sides,
          d0 = a0 + sides;
        index.push(a0, c0, b0, a0, d0, c0);
      }
    const start = (rings.length - 1) * sides;
    for (let k = 0; k < sides; k++) index.push(start + k, top, start + ((k + 1) % sides));
    size = a * 2;
  } else if (kind === 3) {
    const length = between(random, 0.12, 0.29),
      width = length * between(random, 0.45, 0.62),
      cup = width * between(random, 0.08, 0.2);
    const rgb = [0.17, 0.14, 0.1].map((v) => v * between(random, 0.6, 1.05));
    const rows = [
      [0, 0],
      [0.12, 0.3],
      [0.3, 0.46],
      [0.5, 0.48],
      [0.7, 0.4],
      [0.88, 0.24],
      [1, 0],
    ];
    for (const [u, half] of rows)
      for (const side of [-1, 0, 1]) {
        const w = half * width * side,
          lift = 0.008 + cup * Math.abs(side) * half + 0.015 * length * (2 * u - 1) ** 2;
        add(
          (u - 0.5) * length,
          lift,
          w,
          -(u - 0.5) * 0.3,
          1,
          -side * 0.2,
          rgb.map((v) => v * (side ? 0.8 : 1)),
        );
      }
    for (let r = 0; r < rows.length - 1; r++)
      for (let k = 0; k < 2; k++) {
        const a = r * 3 + k;
        if (r !== rows.length - 2) index.push(a, a + 4, a + 3);
        if (r !== 0) index.push(a, a + 1, a + 4);
      }
    size = length;
  } else {
    const blades = Math.round(between(random, ...GROWTH.blades));
    size = between(random, 0.2, 0.5);
    for (let blade = 0; blade < blades; blade++) {
      const turn = random() * Math.PI * 2,
        lx = Math.cos(turn),
        lz = Math.sin(turn),
        height = size * between(random, 0.6, 1.1),
        width = height * between(random, 0.06, 0.095),
        lean = height * between(random, 0.15, 0.45),
        at = positions.length / 3;
      for (let r = 0; r < 4; r++) {
        const t = r / 3,
          bend = lean * t ** 1.7,
          half = (width * GROWTH.rows[r]) / 2;
        const rgb = [0.07 + 0.08 * t, 0.086 + 0.084 * t, 0.05 + 0.045 * t];
        for (const side of [-1, 1])
          add(
            lx * bend - lz * half * side,
            height * t - t ** 2.4 * lean * 0.25 - 0.018,
            lz * bend + lx * half * side,
            -lz,
            0.35,
            lx,
            rgb,
            t ** 1.8 * height * GROWTH.sway,
            GROWTH.up * (0.4 + 0.6 * t),
          );
      }
      for (let r = 0; r < 3; r++) {
        const a = at + r * 2;
        index.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
    }
  }
  return { positions, normals, colors, grass, index, center: [x, y, z], size, kind };
}

export function* foregroundChunkSteps(
  tile,
  { surface, placement, soil = [0.083, 0.071, 0.064], helpers },
) {
  const { coastBedrockWeight, TREE_FOOTING, TRUNK } = helpers;
  const pieces = [];
  for (let kind = 0; kind < FOREGROUND.kinds.length; kind++) {
    const count = FOREGROUND.counts[FOREGROUND.kinds[kind]];
    for (let i = 0; i < count; i++) {
      if (i % 8 === 0) yield;
      const seed = kind * 10000 + i,
        random = randomFor(tile.x, tile.z, seed + FOREGROUND.seed);
      const x = (tile.x + random()) * 8,
        z = (tile.z + random()) * 8;
      const broad =
        0.5 + 0.5 * Math.sin(x * 0.31 + Math.sin(z * 0.23)) * Math.cos(z * 0.27 + x * 0.09);
      if (broad < 0.2 || random() > Math.min(1, 0.35 + broad * 1.25)) continue;
      const angle =
        (Math.atan2(z - TREE_FOOTING.z - TRUNK[1], x - TREE_FOOTING.x - TRUNK[0]) * 180) / Math.PI;
      if (
        Math.hypot(x - TREE_FOOTING.x - TRUNK[0], z - TREE_FOOTING.z - TRUNK[1]) <
          FOREGROUND.legacyCore &&
        angle > -175 &&
        angle < -55 &&
        foregroundHash(tile.x, tile.z, seed + 1019) >= 0.35
      )
        continue;
      const soilShare = (1 - coastBedrockWeight(x, z)) ** 2;
      if ((kind === 2 || kind === 3 || kind === 4) && random() > soilShare) continue;
      if (!placement.pointAllowed(x, z)) continue;
      const piece = pieceGeometry(kind, x, z, random, surface, soil, helpers);
      let clear = true;
      if (kind === 4) {
        // Include the full wind envelope, not only the still blade strips.
        const sway = Math.max(...piece.grass.filter((_, i) => i % 2 === 0)) * 1.5;
        const xs = piece.positions.filter((_, i) => i % 3 === 0),
          zs = piece.positions.filter((_, i) => i % 3 === 2);
        const x0 = Math.min(...xs) - sway,
          x1 = Math.max(...xs) + sway,
          z0 = Math.min(...zs) - sway,
          z1 = Math.max(...zs) + sway;
        clear =
          placement.triangleAllowed([
            [x0, z0],
            [x1, z0],
            [x0, z1],
          ]) &&
          placement.triangleAllowed([
            [x1, z0],
            [x1, z1],
            [x0, z1],
          ]);
      }
      for (let k = 0; k < piece.index.length; k += 3) {
        if (!clear) break;
        const triangle = piece.index
          .slice(k, k + 3)
          .map((n) => [piece.positions[n * 3], piece.positions[n * 3 + 2]]);
        if (!placement.triangleAllowed(triangle)) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      piece.seed = seed;
      piece.quality = foregroundHash(tile.x, tile.z, seed + 881);
      pieces.push(piece);
    }
  }
  pieces.sort((a, b) => Number(a.quality >= 0.4) - Number(b.quality >= 0.4) || a.seed - b.seed);
  const positions = [],
    normals = [],
    colors = [],
    grass = [],
    centers = [],
    ranges = [],
    indices = [],
    records = [];
  let balanced = 0;
  for (const piece of pieces) {
    const at = positions.length / 3,
      first = indices.length;
    positions.push(...piece.positions);
    normals.push(...piece.normals);
    colors.push(...piece.colors);
    grass.push(...piece.grass);
    for (let n = 0; n < piece.positions.length / 3; n++) {
      centers.push(...piece.center, piece.size);
      ranges.push(...FOREGROUND.ranges[piece.kind]);
    }
    for (const i of piece.index) indices.push(at + i);
    if (piece.quality < 0.4) balanced = indices.length;
    records.push({
      seed: piece.seed,
      kind: piece.kind,
      quality: piece.quality,
      center: piece.center,
      first,
      count: piece.index.length,
    });
    yield;
  }
  const geometry = new BufferGeometry();
  let complete = false;
  try {
    for (const [name, values, size] of [
      ["position", positions, 3],
      ["normal", normals, 3],
      ["color", colors, 3],
      ["aGrass", grass, 2],
      ["aForeground", centers, 4],
      ["aForegroundRange", ranges, 2],
    ]) {
      geometry.setAttribute(name, new BufferAttribute(new Float32Array(values), size));
      yield;
    }
    const Index = positions.length / 3 > 65535 ? Uint32Array : Uint16Array;
    geometry.setIndex(new BufferAttribute(new Index(indices), 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    // The shader's wind can move the blade tips beyond their still bounds.
    geometry.boundingBox.expandByScalar(0.1);
    geometry.boundingSphere.radius += 0.1;
    geometry.userData.foreground = {
      key: tileKey(tile.x, tile.z),
      pieces: records,
      balanced,
      highTriangles: indices.length / 3,
      balancedTriangles: balanced / 3,
      bytes: Object.values(geometry.attributes).reduce(
        (n, a) => n + a.array.byteLength,
        geometry.index.array.byteLength,
      ),
    };
    complete = true;
    return geometry;
  } finally {
    if (!complete) geometry.dispose();
  }
}

export function* foregroundCoverageSteps({
  root,
  surface,
  shots = null,
  layouts = FOREGROUND.layouts,
  onlyShot = null,
  tier = "high",
  helpers,
}) {
  const {
    createCinematicCamera,
    cinematicSafeArea,
    DIRECTED_SHOTS,
    coastDistance,
    ESTATE,
    watchMeasure,
    measureShot,
  } = helpers;
  shots ??= DIRECTED_SHOTS.tree;
  const tiles = new Map(),
    sampled = new Map(),
    views = new Map(),
    camera = new PerspectiveCamera(),
    local = new Vector3(),
    world = new Vector3(),
    projection = new Matrix4(),
    coverageFrustum = new Frustum(),
    groundBox = new Box3(),
    near = new Sphere(),
    required = new Set();
  const tree = root.getObjectByName("supplied-meshy-tree");
  if (!tree) return { tiles: [], shots: ["The watch"], poses: 0 };
  const watch = new Object3D(),
    stored = watchMeasure?.("high");
  root.localToWorld(
    watch.position.set(
      ESTATE.watch.x,
      surface(ESTATE.watch.x, ESTATE.watch.z) - 0.22,
      ESTATE.watch.z,
    ),
  );
  watch.updateMatrixWorld(true);
  const preview = createCinematicCamera({
    camera,
    selected: "tree",
    getSafeArea: cinematicSafeArea,
    measure(subject, shot) {
      return subject === watch && stored ? stored(subject, shot) : measureShot(subject, shot);
    },
    getGroundY(x, z) {
      root.worldToLocal(local.set(x, 0, z));
      const y = surface(local.x, local.z);
      return root.localToWorld(world.set(local.x, Number.isFinite(y) ? y : 0, local.z)).y;
    },
  });
  preview.setSubject("watch", watch);
  preview.setSubject("tree", tree);
  preview.setStatus({ kind: "watch", status: "ready" });
  preview.setStatus({ kind: "tree", status: "ready" });
  let poses = 0;
  try {
    const courses = [
      ...(stored
        ? DIRECTED_SHOTS.watch.map((shot, angle) => ({ kind: "watch", shot, angle }))
        : []),
      ...shots.map((shot, angle) => ({ kind: "tree", shot, angle })),
    ];
    for (const [width, height] of layouts)
      for (const { kind, shot, angle } of courses.filter(
        ({ shot }) => !onlyShot || shot.name === onlyShot,
      )) {
        const view = `${width}:${height}:${shot.name}`;
        views.set(view, 0);
        preview.setPreviewShot(kind, angle);
        while (preview.prepare(kind, angle, width, height) === "pending") yield;
        for (const phase of onlyShot
          ? Array.from({ length: 25 }, (_, i) => i / 24)
          : [0, 0.25, 0.5, 0.75, 1]) {
          preview.apply({ width, height, elapsedSeconds: phase * 9, tourPhase: phase });
          camera.updateMatrixWorld(true);
          poses++;
          root.updateWorldMatrix(true, false);
          projection
            .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
            .multiply(root.matrixWorld);
          coverageFrustum.setFromProjectionMatrix(projection);
          camera.getWorldPosition(world);
          root.worldToLocal(local.copy(world));
          const cx = local.x,
            cz = local.z;
          for (let tx = Math.floor((cx - 56) / 8); tx <= Math.floor((cx + 56) / 8); tx++) {
            yield;
            for (let tz = Math.floor((cz - 56) / 8); tz <= Math.floor((cz + 56) / 8); tz++) {
              let nearest = Infinity,
                visible = false,
                low = Infinity,
                high = -Infinity;
              const key = tileKey(tx, tz);
              if (!sampled.has(key)) {
                const points = [];
                for (const u of [0, 0.5, 1])
                  for (const v of [0, 0.5, 1]) {
                    const x = (tx + u) * 8,
                      z = (tz + v) * 8,
                      y = surface(x, z);
                    if (Number.isFinite(y) && coastDistance(x, z) >= 2) points.push([x, y, z]);
                  }
                sampled.set(key, points);
              }
              for (const [x, y, z] of sampled.get(key)) {
                low = Math.min(low, y);
                high = Math.max(high, y);
                const distance = Math.hypot(x - cx, z - cz);
                nearest = Math.min(nearest, distance);
                if (distance > 62) continue;
                world.set(x, y, z).applyMatrix4(projection);
                if (
                  world.z > -1 &&
                  world.z < 1 &&
                  Math.abs(world.x) < 1.2 &&
                  Math.abs(world.y) < 1.2
                ) {
                  visible = true;
                  nearest = Math.min(nearest, distance);
                }
              }
              // A tight near-camera patch can pass between all nine probes.
              // Admit its complete cached ground box conservatively; runtime
              // distance/frustum culling and the resident cache stay bounded.
              groundBox.set(
                local.set(tx * 8 - 0.6, low - 0.1, tz * 8 - 0.6),
                world.set((tx + 1) * 8 + 0.6, high + 0.7, (tz + 1) * 8 + 0.6),
              );
              if (
                !visible &&
                !(
                  Number.isFinite(low) &&
                  nearest <= 62 &&
                  (onlyShot
                    ? coverageFrustum.intersectsSphere(groundBox.getBoundingSphere(near))
                    : coverageFrustum.intersectsBox(groundBox))
                )
              )
                continue;
              views.set(view, views.get(view) + 1);
              if (!tiles.has(key))
                tiles.set(key, {
                  x: tx,
                  z: tz,
                  views: new Map(),
                  box: new Box3(
                    new Vector3(tx * 8 - 0.6, low - 0.1, tz * 8 - 0.6),
                    new Vector3((tx + 1) * 8 + 0.6, high + 0.7, (tz + 1) * 8 + 0.6),
                  ),
                });
              const tile = tiles.get(key);
              tile.views.set(view, Math.min(tile.views.get(view) ?? Infinity, nearest));
            }
          }
          if (onlyShot) {
            // Prepare the batches that can enter during the complete authored
            // hold, plus four neighbouring slots at each sampled pose. Other
            // shots and viewport envelopes remain off this critical path.
            const candidates = [];
            for (const tile of tiles.values()) {
              tile.box.getBoundingSphere(near);
              if (!coverageFrustum.intersectsSphere(near)) continue;
              near.applyMatrix4(root.matrixWorld);
              const distance = Math.max(
                0,
                near.center.distanceTo(world.copy(camera.position)) - near.radius,
              );
              if (distance <= 56 * (tier === "balanced" ? 0.7 : 1))
                candidates.push({ tile, distance });
            }
            candidates.sort(
              (a, b) =>
                a.distance - b.distance ||
                tileKey(a.tile.x, a.tile.z).localeCompare(tileKey(b.tile.x, b.tile.z)),
            );
            for (const { tile } of candidates.slice(
              0,
              FOREGROUND.batches[tier === "balanced" ? "balanced" : "high"] + 4,
            ))
              required.add(tileKey(tile.x, tile.z));
          }
        }
      }
    return {
      tiles: [...tiles.values()].filter(
        (tile) => !onlyShot || required.has(tileKey(tile.x, tile.z)),
      ),
      shots: ["The watch", ...shots.map((shot) => shot.name)],
      poses,
      views: Object.fromEntries(views),
    };
  } finally {
    preview.dispose();
  }
}

function slices(steps, cancelled = () => false, priority = () => false, progress = null) {
  return import("./preparation-tasks.js").then(({ runPreparationSteps }) =>
    runPreparationSteps(steps, {
      priority,
      cancelled,
      progress,
      idleMs: 5,
      minimumMs: 1,
    }),
  );
}

function foregroundMaterial({ grassMaterial }, windTime, shared = {}) {
  const material = grassMaterial(),
    original = material.onBeforeCompile;
  const viewport = shared.viewport ?? { value: 900 },
    scale = shared.scale ?? { value: 1 },
    fade = { value: 1 };
  material.onBeforeCompile = (shader, renderer) => {
    original(shader, renderer);
    if (windTime) shader.uniforms.grassTime = windTime;
    shader.uniforms.foregroundViewport = viewport;
    shader.uniforms.foregroundRangeScale = scale;
    shader.uniforms.foregroundChunkFade = fade;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 aForeground; attribute vec2 aForegroundRange; uniform float foregroundViewport, foregroundRangeScale, foregroundChunkFade;",
      )
      .replace(
        "#include <project_vertex>",
        `vec3 foregroundCentre=(modelViewMatrix*vec4(aForeground.xyz,1.)).xyz;
float foregroundPixels=abs(projectionMatrix[1][1])*foregroundViewport*aForeground.w/max(.1,-foregroundCentre.z);
float foregroundKeep=foregroundChunkFade*(1.-smoothstep(aForegroundRange.x*foregroundRangeScale,aForegroundRange.y*foregroundRangeScale,length(foregroundCentre)))*smoothstep(.75,1.5,foregroundPixels);
transformed=aForeground.xyz+(transformed-aForeground.xyz)*foregroundKeep;
transformed.y-=.02*(1.-foregroundKeep);
#include <project_vertex>`,
      );
  };
  material.customProgramCacheKey = () => "estate-grass-v2+foreground-v1";
  material.userData.foregroundViewport = viewport;
  material.userData.foregroundScale = scale;
  material.userData.foregroundFade = fade;
  return material;
}

function openingKey(frame, root) {
  const tree = root.getObjectByName("supplied-meshy-tree"),
    lantern = tree?.getObjectByName("tree-lantern");
  tree?.updateWorldMatrix(true, false);
  lantern?.updateWorldMatrix(true, true);
  return [
    frame.shot,
    frame.viewport?.width,
    frame.viewport?.height,
    frame.profile?.tier,
    frame.camera?.fov,
    tree?.matrixWorld.elements.join(","),
    lantern?.matrixWorld.elements.join(","),
    lantern?.children.map((child) => child.uuid).join(","),
  ].join("|");
}

export async function prepareForegroundDetail(options) {
  const { root, surface, rendering = null, cancelled = () => false } = options;
  const openingFrame = options.openingFrame,
    initialOpeningSignature = openingFrame ? openingKey(openingFrame, root) : null;
  const hiddenPreparation = () =>
    Boolean(openingFrame) &&
    !rendering?.renderer?.domElement?.parentNode?.classList?.contains("is-ready");
  const progress = () => {
    if (rendering && hiddenPreparation())
      rendering.openingProgress = (rendering.openingProgress ?? 0) + 1;
  };
  const coverage =
    options.coverage ??
    (await slices(
      foregroundCoverageSteps({
        ...options,
        ...(openingFrame
          ? {
              onlyShot: openingFrame.shot,
              tier: openingFrame.profile?.tier,
              layouts: [
                [openingFrame.viewport?.width ?? 1600, openingFrame.viewport?.height ?? 900],
              ],
            }
          : {}),
      }),
      cancelled,
      hiddenPreparation,
      progress,
    ));
  if (!coverage || cancelled()) return null;
  const group = new Group();
  group.name = "estate-foreground-field";
  const material = foregroundMaterial(options.helpers, options.windTime),
    placement = foregroundPlacement(options),
    cache = new Map(),
    queued = new Set();
  const matrix = new Matrix4(),
    frustum = new Frustum(),
    local = new Vector3(),
    world = new Vector3(),
    sphere = new Sphere();
  const tileRecord = (tile) => ({
    ...tile,
    key: tileKey(tile.x, tile.z),
    mesh: null,
    ready: false,
    committed: false,
    warming: false,
    fade: 0,
    used: 0,
    bytes: 0,
  });
  const tiles = coverage.tiles.map(tileRecord),
    openingKeys = new Set(openingFrame ? tiles.map((tile) => tile.key) : []);
  let disposed = false,
    active = true,
    tier = "high",
    frame = null,
    busy = false,
    stamp = 0,
    resident = 0,
    warmed = false,
    opening = null,
    resolveOpening = null,
    openingSignature = null,
    coverageVersion = 0,
    openingCoveragePending = false,
    fullCoverage = !openingFrame;
  const state = {
    tiles: tiles.length,
    poses: coverage.poses,
    shots: coverage.shots,
    views: coverage.views,
    residentBytes: 0,
    visibleBatches: 0,
    visibleTriangles: 0,
    preparedChunks: 0,
    pendingChunks: 0,
    committedChunks: 0,
    failed: false,
    openingStatus: "idle",
  };
  group.userData.foreground = state;
  const budget = () => (tier === "balanced" ? "balanced" : "high");
  function evict(bytes = 0) {
    const limit = FOREGROUND.bytes[budget()];
    for (const tile of [...cache.values()].sort((a, b) => a.used - b.used)) {
      if (resident + bytes <= limit) break;
      if (tile.mesh.visible || tile.warming || (resolveOpening && openingKeys.has(tile.key)))
        continue;
      resident -= tile.bytes;
      tile.mesh.removeFromParent();
      tile.mesh.geometry.dispose();
      tile.mesh.material.dispose();
      cache.delete(tile.key);
      tile.mesh = null;
      tile.ready = false;
      tile.committed = false;
      tile.fade = 0;
      tile.bytes = 0;
    }
    state.residentBytes = resident;
    return resident + bytes <= limit;
  }
  function checkOpening() {
    if (!resolveOpening) return;
    if (openingCoveragePending && !disposed) return;
    if (
      !disposed &&
      !state.failed &&
      tiles.some((tile) => openingKeys.has(tile.key) && !tile.ready && !tile.empty)
    )
      return;
    state.openingStatus = disposed || state.failed ? "fallback" : "ready";
    if (!disposed && !state.failed)
      for (const tile of tiles) if (tile.ready && openingKeys.has(tile.key)) tile.committed = true;
    const resolve = resolveOpening;
    resolveOpening = null;
    resolve(!disposed);
    if (!disposed) options.invalidate?.();
  }
  function mergeCoverage(next) {
    for (const tile of next.tiles) {
      const existing = tiles.find((entry) => entry.key === tileKey(tile.x, tile.z));
      if (existing) for (const [view, distance] of tile.views) existing.views.set(view, distance);
      else tiles.push(tileRecord(tile));
    }
    coverage.shots = next.shots;
    state.tiles = tiles.length;
    state.poses += next.poses;
    state.shots = next.shots;
    state.views = { ...state.views, ...next.views };
  }
  function completeCoverage() {
    if (fullCoverage || disposed) return;
    fullCoverage = true;
    void slices(foregroundCoverageSteps(options), () => disposed || cancelled())
      .then((next) => {
        if (!next || disposed) return;
        mergeCoverage(next);
        options.invalidate?.();
      })
      .catch(() => {});
  }
  async function work() {
    if (busy || disposed || !active || tier === "low" || state.failed) return;
    busy = true;
    try {
      while (queued.size && !disposed && active && tier !== "low") {
        const key = queued.values().next().value;
        queued.delete(key);
        state.pendingChunks = queued.size + 1;
        const tile = tiles.find((tile) => tile.key === key);
        if (!tile || tile.mesh) continue;
        const geometry = await slices(
          foregroundChunkSteps(tile, {
            surface,
            placement,
            soil: options.soil,
            helpers: options.helpers,
          }),
          () => disposed || cancelled(),
          () => Boolean(resolveOpening) && hiddenPreparation(),
          progress,
        );
        if (!geometry) break;
        if (!geometry.index.count) {
          tile.empty = true;
          geometry.dispose();
          options.invalidate?.();
          continue;
        }
        const bytes = geometry.userData.foreground.bytes;
        if (disposed || cancelled() || tier === "low" || !evict(bytes)) {
          geometry.dispose();
          if (resolveOpening && !disposed && tier !== "low") {
            state.failed = true;
            queued.clear();
            group.visible = false;
          }
          continue;
        }
        // Separate small material owners share one retained program and clock;
        // Three uploads each chunk's fade when its material becomes current.
        const chunkMaterial = foregroundMaterial(
          options.helpers,
          options.windTime ?? material.userData.grassTime,
          {
            viewport: material.userData.foregroundViewport,
            scale: material.userData.foregroundScale,
          },
        );
        const mesh = new Mesh(geometry, chunkMaterial);
        mesh.name = `foreground-${key}`;
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.visible = false;
        mesh.onBeforeRender = () => {
          chunkMaterial.userData.foregroundFade.value = tile.fade;
        };
        group.add(mesh);
        tile.mesh = mesh;
        tile.bytes = bytes;
        tile.used = ++stamp;
        cache.set(key, tile);
        resident += bytes;
        state.residentBytes = resident;
        state.preparedChunks++;
        if (!warmed) {
          let compiled = true;
          const renderer = rendering?.renderer;
          if (
            typeof rendering?.compilePrograms === "function" &&
            renderer?.extensions?.has?.("KHR_parallel_shader_compile")
          ) {
            const target = renderer.getRenderTarget?.();
            let pending;
            tile.warming = true;
            try {
              renderer.setRenderTarget?.(rendering.composer?.readBuffer ?? null);
              pending = rendering.compilePrograms(
                renderer,
                mesh,
                rendering.camera,
                rendering.homeScene,
                () => !disposed && !cancelled(),
              );
            } catch {
              compiled = false;
            } finally {
              renderer.setRenderTarget?.(target ?? null);
            }
            try {
              if (pending) compiled = (await pending) === true;
            } catch {
              compiled = false;
            }
            tile.warming = false;
          }
          if (disposed || cancelled()) return;
          if (!compiled) {
            state.failed = true;
            queued.clear();
            group.visible = false;
            options.invalidate?.();
            return;
          }
          warmed = true;
        }
        tile.ready = true;
        options.invalidate?.();
      }
    } catch {
      state.failed = true;
      queued.clear();
      group.visible = false;
    } finally {
      busy = false;
      state.pendingChunks = queued.size;
      checkOpening();
    }
  }
  function queue(tile) {
    if (!tile.mesh && !tile.empty) queued.add(tile.key);
  }
  const controller = {
    group,
    state,
    prepareOpening(next = {}) {
      const signature = openingKey(next, root);
      if (opening && signature === openingSignature) return opening;
      const reuse = !opening && (!openingFrame || signature === initialOpeningSignature),
        version = ++coverageVersion;
      openingSignature = signature;
      state.openingStatus = "preparing";
      if (!resolveOpening) opening = new Promise((resolve) => (resolveOpening = resolve));
      openingCoveragePending = true;
      const admit = (nextCoverage) => {
        if (version !== coverageVersion || disposed) return;
        openingCoveragePending = false;
        if (nextCoverage) {
          mergeCoverage(nextCoverage);
          openingKeys.clear();
          for (const tile of nextCoverage.tiles) openingKeys.add(tileKey(tile.x, tile.z));
        } else if (!openingKeys.size) for (const tile of tiles) openingKeys.add(tile.key);
        queued.clear();
        controller.update({ ...next, preparing: true, revealed: false });
        for (const tile of tiles) if (openingKeys.has(tile.key)) queue(tile);
        checkOpening();
        void work();
      };
      if (reuse) admit(null);
      else
        void slices(
          foregroundCoverageSteps({
            ...options,
            onlyShot: next.shot,
            tier: next.profile?.tier,
            layouts: [[next.viewport?.width ?? 1600, next.viewport?.height ?? 900]],
          }),
          () => disposed || cancelled() || version !== coverageVersion,
          hiddenPreparation,
          progress,
        )
          .then(admit)
          .catch(() => {
            if (version !== coverageVersion) return;
            openingCoveragePending = false;
            state.failed = true;
            group.visible = false;
            checkOpening();
          });
      return opening;
    },
    setActive(value) {
      active = Boolean(value);
      group.visible = active && tier !== "low" && !state.failed;
    },
    applyQuality(profile = {}) {
      tier = profile.tier ?? "high";
      group.visible = active && tier !== "low" && !state.failed;
      material.userData.foregroundScale.value = tier === "balanced" ? 0.7 : 1;
      evict();
    },
    update(next = {}) {
      frame = next;
      if (disposed) return;
      if (frame.profile?.tier && frame.profile.tier !== tier)
        controller.applyQuality(frame.profile);
      if (!active || tier === "low" || !frame.camera || state.failed) return;
      if (frame.preparing && opening && openingKey(frame, root) !== openingSignature)
        void controller.prepareOpening(frame);
      if (frame.revealed) completeCoverage();
      const camera = frame.camera;
      camera.updateMatrixWorld(true);
      group.updateWorldMatrix(true, false);
      matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(matrix);
      camera.getWorldPosition(world);
      root.worldToLocal(local.copy(world));
      const eye = world.clone(),
        publish = frame.cut || frame.still || frame.revealed === false;
      if (publish) for (const tile of cache.values()) if (tile.ready) tile.committed = true;
      const width = frame.viewport?.width ?? 1600,
        height = frame.viewport?.height ?? 900;
      material.userData.foregroundViewport.value =
        height * (rendering?.renderer?.getPixelRatio?.() ?? 1);
      if (
        !options.windTime &&
        !frame.reducedMotion &&
        !frame.motionPaused &&
        Number.isFinite(frame.deltaSeconds)
      )
        material.userData.grassTime.value =
          (material.userData.grassTime.value + Math.max(0, Math.min(0.1, frame.deltaSeconds))) %
          ((20 * Math.PI * 10) / options.helpers.GROWTH.speed);
      const candidates = [];
      for (const tile of tiles) {
        if (tile.empty) continue;
        const box = tile.mesh?.geometry.boundingBox ?? tile.box;
        if (!box) continue;
        box.getBoundingSphere(sphere);
        sphere.applyMatrix4(group.matrixWorld);
        const distance = Math.max(0, sphere.center.distanceTo(eye) - sphere.radius);
        if (distance > 56 * (tier === "balanced" ? 0.7 : 1) || !frustum.intersectsSphere(sphere)) {
          if (tile.mesh) tile.mesh.visible = false;
          tile.fade = 0;
          continue;
        }
        candidates.push({ tile, distance });
      }
      // Four units of retention keep the nearest-batch boundary stable while
      // a moving camera crosses a tile. The retiring batch shrinks whole
      // pieces before its slot is admitted to the next batch.
      candidates.sort(
        (a, b) =>
          a.distance - (a.tile.fade > 0 ? 4 : 0) - (b.distance - (b.tile.fade > 0 ? 4 : 0)) ||
          a.tile.key.localeCompare(b.tile.key),
      );
      const limit = FOREGROUND.batches[budget()],
        triangleLimit = FOREGROUND.triangles[budget()];
      candidates.slice(0, limit + 2).forEach(({ tile }) => {
        if (!tile.mesh) queue(tile);
      });
      const selected = new Set(
        candidates
          .filter(({ tile }) => tile.ready && tile.committed)
          .slice(0, limit)
          .map(({ tile }) => tile),
      );
      const step =
        publish || frame.reducedMotion
          ? 1
          : Math.max(0.01, Math.min(0.1, frame.deltaSeconds ?? 1 / 60)) / 0.3;
      let batches = 0,
        triangles = 0;
      // Retiring chunks consume their existing slots until their fade ends.
      const ordered = [...candidates].sort(
        (a, b) => Number(b.tile.fade > 0) - Number(a.tile.fade > 0),
      );
      for (const { tile } of ordered) {
        if (!tile.mesh) continue;
        const data = tile.mesh.geometry.userData.foreground,
          count = tier === "balanced" ? data.balanced : tile.mesh.geometry.index.count;
        const target = selected.has(tile),
          fits = batches < limit && triangles + count / 3 <= triangleLimit;
        tile.fade =
          !fits || !tile.ready || !tile.committed
            ? 0
            : Math.max(0, Math.min(1, tile.fade + (target ? step : -step)));
        tile.mesh.visible = tile.fade > 0;
        if (tile.mesh.visible) {
          tile.mesh.geometry.setDrawRange(0, count);
          tile.used = ++stamp;
          batches++;
          triangles += count / 3;
        }
      }
      // Prefetch only finite authored envelopes for the following tour shot.
      // No candidate or geometry is generated by this frame callback.
      const nextShot = frame.nextShot;
      const layout = FOREGROUND.layouts.reduce(
        (best, size) =>
          Math.abs(size[0] / size[1] - width / height) <
          Math.abs(best[0] / best[1] - width / height)
            ? size
            : best,
        FOREGROUND.layouts[0],
      );
      const view = `${layout[0]}:${layout[1]}:${nextShot}`;
      if (nextShot && !resolveOpening)
        tiles
          .filter((tile) => tile.views?.has(view))
          .sort((a, b) => a.views.get(view) - b.views.get(view))
          .slice(0, limit + 2)
          .forEach(queue);
      state.visibleBatches = batches;
      state.visibleTriangles = triangles;
      state.pendingChunks = queued.size + Number(busy);
      state.committedChunks = tiles.filter((tile) => tile.committed).length;
      evict();
      void work().catch(() => {});
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      checkOpening();
      group.removeFromParent();
      queued.clear();
      for (const tile of cache.values()) {
        tile.mesh.geometry.dispose();
        tile.mesh.material.dispose();
        tile.mesh.removeFromParent();
      }
      cache.clear();
      resident = 0;
      state.residentBytes = 0;
      material.dispose();
      return true;
    },
  };
  return controller;
}
