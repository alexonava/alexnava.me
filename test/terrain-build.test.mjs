import test from "node:test";
import { modelBytes, parseGlb, readAccessor } from "./support/glb.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compactShaderSource } from "../tools/shader-compact.mjs";
import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  ShaderLib,
  Vector3,
} from "three";
import {
  createEarthGeometry,
  DRIP_RIPPLES,
  dripAt,
  dripClock,
  FINE_WINDOW,
  foothillHeight,
  KEY_LIGHT,
  knollWeight,
  LANTERN_FLAME,
  LANTERN_FOOT,
  LANTERN_IMAGE,
  LITTER,
  mirrorPoint,
  MIRROR_FLAME,
  PIN_KEEP,
  pinKeep,
  nearWater,
  RIVER,
  RIVER_BED,
  RIVER_LINE,
  RIVER_NEAR,
  RIVER_RIPPLE,
  RIVER_STEPS,
  riverAt,
  riverPoint,
  riverBounds,
  riverCarve,
  riverRadius,
  riverBedAt,
  plantRushes,
  PEBBLE_DOME,
  RUSHES,
  STREAMS,
  STREAM_LINES,
  streamDistance,
  POOL_FIELD,
  poolField,
  PUDDLE_MIRROR,
  PUDDLE_ZONES,
  reliefNoise,
  ROOT_COVER,
  ROOT_HOLLOWS,
  ROOT_KNOLL,
  ROOT_LATTICE,
  ROOT_LINES,
  ROOT_RELIEF,
  ROOT_RESTS,
  ROOT_SHADE,
  rootBankLift,
  rootBermExcess,
  rootCovered,
  rootOcclusion,
  rootShade,
  rootSupportHeight,
  rootSupportLifts,
  scatterLitter,
  settleRoots,
  SHADE_ALPHABET,
  SHADING_EARLY,
  shadeSlateGround,
  shadeSlatePuddles,
  shadeSlateRoots,
  SLATE_SOIL,
  SPUR,
  TERRAIN_BASE,
  terrainHeight,
  terrainLift,
  TREE_FOOTING,
  TREE_SINK,
  TRUNK,
  TUFTS,
  zoneDistance,
} from "../src/scene/terrain-build.js";
import {
  bakeRootShade,
  formatRootTables,
  latticeGround,
  latticeGuard,
  pinDistance,
  rootProbe,
  SHADE_PIN,
  shadeGuard,
  treeMesh,
} from "../tools/bake-root-shade.mjs";
import { ESTATE, estateLantern, estatePoint } from "../src/scene/estate-layout.js";
import {
  configureGroundShading,
  DOOR_HEIGHT,
  SLATE_PUDDLES,
  SLATE_STREAMS,
  streamLines,
} from "../src/scene/mud-ground.js";
import { TERRAIN_HORIZON } from "../src/scene/hill-silhouette.js";
import { LANTERN_AUTHORING_HEIGHT } from "../src/scene/lantern.js";
import { createEstateGroundDetail } from "../src/scene/estate-ground-detail.js";
import { createFilmScene } from "../src/scene/film-scene.js";
import { plainDunes } from "./support/terrain.mjs";

test("rain stands where the soil lies below its neighbours, never on the pinned ground", () => {
  // The cavity is the local mean height less the height: a bowl holds water
  // at its middle, a crest sheds it, a plane neither.
  const n = 13,
    far = () => [0, 0]; // well away from the lantern and the puddles
  const grid = (height) =>
    Float32Array.from({ length: n * n }, (_, k) => height(k % n, Math.floor(k / n)));
  const bowl = poolField(
    grid((i, j) => 0.01 * ((i - 6) ** 2 + (j - 6) ** 2)),
    n,
    n,
    far,
  );
  const crest = poolField(
    grid((i, j) => -0.01 * ((i - 6) ** 2 + (j - 6) ** 2)),
    n,
    n,
    far,
  );
  const plane = poolField(
    grid((i, j) => 0.3 * i - 0.2 * j),
    n,
    n,
    far,
  );
  const middle = 6 * n + 6;
  assert.ok(bowl[middle] > 0 && crest[middle] < 0);
  assert.ok(Math.abs(bowl[middle] + crest[middle]) < 1e-6);
  assert.ok(
    plane.every((v) => Math.abs(v) < 1e-5),
    "a slope holds no water",
  );
  // Nothing within the box's reach of the grid's own edge, where the mean is one-sided.
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      if (Math.min(i, j, n - 1 - i, n - 1 - j) < POOL_FIELD.mean) assert.equal(bowl[j * n + i], 0);
  // None on the pinned ground: the lantern clearing.
  const pinned = poolField(
    grid((i, j) => 0.01 * ((i - 6) ** 2 + (j - 6) ** 2)),
    n,
    n,
    () => [LANTERN_FOOT.x, LANTERN_FOOT.z],
  );
  assert.ok(pinned.every((v) => v === 0));
  // On the film terrain: the fine grid's vertices carry it, both signs (the
  // knoll's rim sheds water, its foot holds it), and nothing about the
  // lantern or in a puddle.
  const geometry = createEarthGeometry(groundBase());
  const pool = geometry.attributes.slatePool,
    position = geometry.attributes.position;
  assert.equal(pool.itemSize, 1);
  let wet = 0,
    dry = 0;
  for (let i = 0; i < pool.count; i++) {
    const value = pool.getX(i),
      x = position.getX(i),
      z = -position.getY(i);
    if (!value) continue;
    assert.ok(Math.abs(value) < 1, `${value} at ${x},${z}`);
    assert.ok(
      x > TREE_FOOTING.x + FINE_WINDOW.x[0] - 2 && x < TREE_FOOTING.x + FINE_WINDOW.x[1] + 2,
    );
    assert.ok(Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) > PIN_KEEP.lantern);
    for (const zone of PUDDLE_ZONES) assert.ok(zoneDistance(zone, x, z) > zone.radius * 0.5);
    assert.ok(riverRadius(x, z) > RIVER_BED.reach[1], `a pool on the river's bank at ${x},${z}`);
    if (value > SLATE_SOIL.pool.water[0]) wet++;
    if (value < 0) dry++;
  }
  assert.ok(wet > 20 && dry > 20, `${wet} wet, ${dry} crest vertices`);
  geometry.dispose();
});

test("root supports preserve coarse terrain vertices, map scale and bounded mesh cost", () => {
  const base = (x, z) => Math.sin(x * 0.055) + Math.cos(z * 0.052);
  const original = plainDunes(base),
    hills = createEarthGeometry(base);
  const b = hills.attributes.position;
  // The refined rectangle: every coarse cell whose centre lies in FINE_WINDOW.
  const refined = (x, z) =>
    x - TREE_FOOTING.x > FINE_WINDOW.x[0] - 1.5 &&
    x - TREE_FOOTING.x < FINE_WINDOW.x[1] + 1.5 &&
    z - TREE_FOOTING.z > FINE_WINDOW.z[0] - 1.5 &&
    z - TREE_FOOTING.z < FINE_WINDOW.z[1] + 1.5;
  for (let i = 0; i < b.count; i++) {
    const x = b.getX(i),
      z = -b.getY(i),
      r = Math.hypot(x, z);
    assert.ok(Number.isFinite(b.getZ(i)));
    // Nothing of the knoll reaches a coarse vertex beyond the fine grid.
    if (r < 88 && x % 3 === 0 && z % 3 === 0 && !refined(x, z))
      assert.equal(b.getZ(i), Math.fround(base(x, z)));
    // Past the foothills the terrain lies at the plain's level.
    if (r > 184) assert.equal(b.getZ(i), Math.fround(TERRAIN_BASE));
    assert.ok(Math.abs(hills.attributes.normal.getZ(i)) <= 1);
    assert.ok(Math.abs(hills.attributes.uv.getX(i) - (x / 384 + 0.5)) < 1e-7);
    assert.ok(Math.abs(hills.attributes.uv.getY(i) - (0.5 - z / 384)) < 1e-7);
  }
  for (let azimuth = 0; azimuth < 360; azimuth++) {
    const a = (azimuth * Math.PI) / 180;
    assert.ok(foothillHeight(88 * Math.cos(a), 88 * Math.sin(a)) < 1e-20);
    assert.ok(foothillHeight(88.001 * Math.cos(a), 88.001 * Math.sin(a)) < 0.001);
  }
  assert.ok(hills.boundingBox.max.z < 9 + TERRAIN_BASE);
  assert.ok(foothillHeight(106.8, 106.8) < 1.5, "keep the lantern's north-east horizon low");
  // The root rectangle and the river's sub-grid (each of its 0.75 cells cut
  // RIVER_STEPS x RIVER_STEPS, each cell beside it a fan) and their stitching.
  const [px0, px1, pz0, pz1] = riverBounds(),
    cells = (Math.ceil((px1 - px0) / 0.75) + 1) * (Math.ceil((pz1 - pz0) / 0.75) + 1);
  assert.ok(
    hills.index.count < original.index.count * 1.15 + cells * (RIVER_STEPS * RIVER_STEPS + 1) * 6,
    "only the root rectangle, the river and their stitched boundaries are refined",
  );
  assert.equal(hills.groups.length, 0, "one ground material and draw");
  const repeat = createEarthGeometry(base);
  assert.deepEqual(repeat.attributes.position.array, b.array);
  repeat.dispose();
  original.dispose();
  hills.dispose();
});

test("local refinement joins the coarse mesh without holes, T-junctions or overlapping triangles", () => {
  const geometry = createEarthGeometry(groundBase()),
    p = geometry.attributes.position;
  const indices = geometry.index.array,
    edges = new Map();
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = indices.subarray(i, i + 3);
    const doubled =
      (p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
      (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a));
    assert.ok(doubled > 0, "every triangle is non-degenerate and faces upward");
    area += doubled / 2;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok(Math.abs(area - 384 * 384) < 0.0001);
  for (const [edge, count] of edges) {
    assert.ok(count <= 2);
    if (count === 2) continue;
    const [a, b] = edge.split(":").map(Number);
    assert.ok(
      (Math.abs(p.getX(a)) === 192 && p.getX(a) === p.getX(b)) ||
        (Math.abs(p.getY(a)) === 192 && p.getY(a) === p.getY(b)),
      "only the world boundary has an unshared edge",
    );
  }
  geometry.dispose();
});

function groundBase() {
  const window = {};
  Function(
    "window",
    readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
  )(window);
  return window.BabelSite.scene.groundHeight;
}

function surface(geometry) {
  const mesh = new Mesh(geometry, new MeshStandardMaterial());
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0));
  return {
    at(x, z) {
      ray.ray.origin.set(x, 50, z);
      return ray.intersectObject(mesh)[0];
    },
    dispose() {
      geometry.dispose();
      mesh.material.dispose();
    },
  };
}

test("the river lowers only its channel and banks: the lantern's footing and the pinned ground beyond keep their heights and shading", () => {
  assert.deepEqual(TREE_FOOTING, { x: ESTATE.tree.x, z: ESTATE.tree.z });
  // The sink prop-scale.js seats the tree with, restated for the bake.
  assert.equal(TREE_SINK, ESTATE.tree.sink);
  assert.equal(ESTATE.lantern.offset, 5);
  // The river passes the lantern on the lantern shots' side (they look from
  // -115° to -125°), the lantern standing on its bank clear of its reach.
  const passing = riverAt(LANTERN_FOOT.x, LANTERN_FOOT.z),
    [cx, cz] = riverPoint(RIVER_NEAR);
  assert.ok(Math.abs(passing.s - RIVER_NEAR) < 1e-9);
  const bearing = (Math.atan2(cz - LANTERN_FOOT.z, cx - LANTERN_FOOT.x) * 180) / Math.PI;
  assert.ok(bearing > -135 && bearing < -105, `the river passes at ${bearing}°`);
  assert.ok(
    (passing.r - RIVER_BED.reach[1]) * RIVER.width > 0.6,
    "the lantern's foot (0.47 about) stands clear of the bank",
  );
  const base = groundBase(),
    original = plainDunes(base),
    restored = createEarthGeometry(base);
  // Vertex normals are normalized in the real material's vertex shader.
  // Include that step before interpolating them across the rendered triangles.
  restored.normalizeNormals();
  const a = surface(original),
    b = surface(restored),
    height = terrainHeight(restored);
  const lamp = estateLantern(),
    foot = a.at(lamp.x, lamp.z).point.y,
    water = foot + RIVER_BED.level;
  const sub = riverBounds();
  let footing = 0,
    beyond = 0,
    basin = 0;
  // About where it passes the lantern, well inside the fine grid.
  for (let x = cx - 6; x < cx + 6; x += 0.17)
    for (let z = cz - 6; z < cz + 6; z += 0.17) {
      const r = riverRadius(x, z),
        before = a.at(x, z),
        after = b.at(x, z);
      // The pinned ground a sub-grid cell (0.25, up to 0.35 radii) beyond the river's reach,
      // all the triangles about it pinned too.
      const pinned =
        r > RIVER_BED.reach[1] + 0.35 &&
        [-0.8, 0, 0.8].every((u) => [-0.8, 0, 0.8].every((v) => pinKeep(x + u, z + v) === 0));
      if (Math.hypot(x - lamp.x, z - lamp.z) < 0.6 || pinned) {
        // The lantern's footing, and the pinned ground beyond the river.
        assert.ok(
          Math.abs(before.point.y - after.point.y) < 0.000002,
          `height changed at ${x},${z}`,
        );
        assert.ok(before.normal.angleTo(after.normal) < 0.0001, `shading tilted at ${x},${z}`);
        if (Math.hypot(x - lamp.x, z - lamp.z) < 0.6) footing++;
        else beyond++;
      } else if (
        r < 0.95 &&
        x > sub[0] + 0.3 &&
        x < sub[1] - 0.3 &&
        z > sub[2] + 0.3 &&
        z < sub[3] - 0.3
      ) {
        // In the water, on its sub-grid: the channel's shape (to the sub-grid's linear pieces), below the water.
        // Except across the fold on the inner side of its bend after the lantern (out of
        // every shot's frame), where the nearest stretch of its centreline jumps and
        // the sub-grid's linear pieces cut the crease.
        const here = riverAt(x, z).s,
          fold = [
            [0.3, 0],
            [-0.3, 0],
            [0, 0.3],
            [0, -0.3],
          ].some(([u, v]) => Math.abs(riverAt(x + u, z + v).s - here) > 1);
        const expected = before.point.y + riverCarve(x, z, before.point.y, foot);
        if (!fold) assert.ok(Math.abs(after.point.y - expected) < 0.012, `basin at ${x},${z}`);
        // Where the channel is carved in full (it eases out over 2.5 units inside the fine
        // grid's edge, beyond the lantern shots' frames), its bed lies under its water.
        const inside = Math.min(
          x - TREE_FOOTING.x - FINE_WINDOW.x[0],
          TREE_FOOTING.x + FINE_WINDOW.x[1] - x,
          z - TREE_FOOTING.z - FINE_WINDOW.z[0],
          TREE_FOOTING.z + FINE_WINDOW.z[1] - z,
        );
        if (inside > 2.5)
          assert.ok(after.point.y < water, `the river's bed lies under its water at ${x},${z}`);
        assert.ok(
          Math.abs(height(x, z) - after.point.y) < 1e-5,
          "the height sampler reads the basin",
        );
        basin++;
      }
    }
  assert.ok(footing > 30 && beyond > 150 && basin > 400, `${footing} ${beyond} ${basin}`);
  // Deep down its middle, as deep as the shape says.
  assert.ok(Math.abs(b.at(cx, cz).point.y - (water + riverBedAt(riverRadius(cx, cz)))) < 0.015);
  // Out on the plain, beyond the fine grid, its water lies on the uncarved soil.
  const [wx, wz] = RIVER_LINE[2];
  assert.ok(wx < TREE_FOOTING.x + FINE_WINDOW.x[0] && riverRadius(wx, wz) < 1e-9);
  assert.ok(riverCarve(wx, wz, base(wx, wz), foot) === 0, "no carve on the plain");
  assert.ok(Math.abs(b.at(wx, wz).point.y - a.at(wx, wz).point.y) < 0.000002);
  a.dispose();
  b.dispose();
});

// The authored tree's vertices as the scene seats it: relative to the tree,
// its lowest vertex TREE_SINK below the footing (prop-scale.js).
function authoredRootVertices(tier) {
  const glb = parseGlb(modelBytes("tree", tier));
  const position = readAccessor(glb, glb.json.meshes[0].primitives[0].attributes.POSITION);
  assert.ok(position.array instanceof Int16Array && position.normalized);
  const vertices = [];
  for (let i = 0; i < position.count; i++)
    vertices.push([position.getX(i), position.getY(i), position.getZ(i)]);
  const min = Math.min(...vertices.map((v) => v[1])),
    max = Math.max(...vertices.map((v) => v[1]));
  const scale = (DOOR_HEIGHT * 4.2) / (max - min);
  return vertices.map(([x, y, z]) => [x * scale, (y - min) * scale - TREE_SINK, z * scale]);
}

for (const tier of ["high", "balanced"])
  test(`${tier} actual root ends enter the soil without burying them deeply`, () => {
    const base = groundBase(),
      terrain = surface(createEarthGeometry(base));
    const floor = base(TREE_FOOTING.x, TREE_FOOTING.z),
      vertices = authoredRootVertices(tier);
    for (const [x, z] of [
      [-2.5, 7.2],
      [2, -9],
      [11.5, -1],
      [-3, -1],
      [7, 5],
      [8.8, 3.8],
      [7.3, 6.6],
      [11.9, -1.1],
      [1.4, -9.1],
      [-3.4, 7.4],
    ]) {
      const region = vertices.filter((v) => Math.abs(v[0] - x) < 0.7 && Math.abs(v[2] - z) < 0.7);
      assert.ok(region.length > 0);
      const bottom = Math.min(...region.map((v) => v[1]));
      let overlap = -Infinity;
      for (const v of region.filter((v) => v[1] < bottom + 0.1))
        overlap = Math.max(
          overlap,
          terrain.at(v[0] + TREE_FOOTING.x, v[2] + TREE_FOOTING.z).point.y - floor - v[1],
        );
      // Sunk TREE_SINK, each root end enters the soil, never deeper than 0.2.
      assert.ok(overlap >= 0.05, `${tier} root ${x},${z} enters the soil by only ${overlap}`);
      assert.ok(overlap < 0.2, `${tier} root ${x},${z} buried by ${overlap}`);
    }
    terrain.dispose();
  });

for (const tier of ["high", "balanced"])
  test(`${tier} south-east root spur stays an open aerial root over the knoll`, () => {
    const base = groundBase(),
      terrain = surface(createEarthGeometry(base));
    const floor = base(TREE_FOOTING.x, TREE_FOOTING.z),
      vertices = authoredRootVertices(tier);
    // From where it leaves the trunk's flare to its tip, relative to the tree.
    const [ax, az, bx, bz] = [5.4, -2.8, 8.2, -6.2],
      length = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / length,
      uz = (bz - az) / length;
    let slices = 0;
    for (let s = 0; s <= length; s += 0.25) {
      const cx = ax + ux * s,
        cz = az + uz * s;
      const slice = vertices.filter(
        ([x, y, z]) =>
          y < 3 &&
          Math.abs((x - cx) * ux + (z - cz) * uz) < 0.2 &&
          Math.abs((z - cz) * ux - (x - cx) * uz) < 0.8,
      );
      if (!slice.length) continue;
      const underside = Math.min(...slice.map((v) => v[1]));
      const ground = terrain.at(cx + TREE_FOOTING.x, cz + TREE_FOOTING.z).point.y - floor;
      // Sunk with the tree, it still clears the footing by half a unit or more.
      assert.ok(
        underside > 0.5,
        `${tier} spur underside ${underside} at ${cx},${cz} is not clearly above the footing`,
      );
      assert.ok(
        ground < 0.001,
        `${tier} soil rises above the footing under the spur at ${cx},${cz}`,
      );
      assert.ok(underside - ground > 0.9, `${tier} spur meets the soil at ${cx},${cz}`);
      slices++;
    }
    assert.ok(slices >= 12, `the spur is measured along its whole length (${slices} slices)`);
    terrain.dispose();
  });

// The rendered terrain's steepest triangle where the supports raise any corner.
function steepestLift(geometry) {
  const p = geometry.attributes.position,
    index = geometry.index.array,
    lift = terrainLift(geometry);
  let steepest = 0;
  for (let i = 0; i < index.length; i += 3) {
    const [a, b, c] = [index[i], index[i + 1], index[i + 2]].map((k) => [
      p.getX(k),
      -p.getY(k),
      p.getZ(k),
    ]);
    if (![a, b, c].some(([x, z]) => lift(x, z) > 0.01)) continue;
    const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    const gx = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / det;
    const gz = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / det;
    steepest = Math.max(steepest, Math.hypot(gx, gz));
  }
  return steepest;
}

test("the knoll: soil rises toward the footing where the roots touch down, with relief and crook hollows, never a level plate", () => {
  const base = groundBase(),
    floor = base(TREE_FOOTING.x, TREE_FOOTING.z);
  const trunkX = TREE_FOOTING.x + TRUNK[0],
    trunkZ = TREE_FOOTING.z + TRUNK[1];
  const relief = ROOT_RELIEF.octaves.reduce((sum, [, amplitude]) => sum + amplitude, 0),
    hollow = ROOT_HOLLOWS.reduce((sum, [, , , depth]) => sum + depth, 0);
  let knollArea = 0,
    lipArea = 0,
    slope = 0,
    lipSlope = 0;
  const height = (x, z) => rootSupportHeight(x, z, base);
  const supports = (x, z) => rootSupportHeight(x, z, base, false);
  for (let x = 35; x < 80; x += 0.25)
    for (let z = 15; z < 60; z += 0.25) {
      const [b, knoll, shape, lip, channel] = rootSupportLifts(x, z, base);
      assert.equal(b, base(x, z));
      assert.ok(Math.abs(height(x, z) - (b + knoll + shape + lip + channel)) < 1e-12);
      // The river only lowers, and only within its reach.
      assert.ok(
        channel <= 0 && (channel === 0 || riverRadius(x, z) < RIVER_BED.reach[1]),
        `${x},${z}`,
      );
      // The knoll only fills: up to the footing, a little more toward the
      // trunk collar (its dome), never above.
      assert.ok(knoll >= 0, `${x},${z}`);
      assert.ok(
        b + knoll <= Math.max(b, floor + ROOT_KNOLL.dome[0]) + 1e-9,
        `knoll above the footing at ${x},${z}`,
      );
      // The relief and hollows stay small; a lip is a lip, not a berm.
      assert.ok(Math.abs(shape) <= relief + hollow, `${x},${z}`);
      assert.ok(lip >= -1e-12 && lip <= 0.2, `${x},${z}`);
      if (knoll > 0.01) knollArea += 0.0625;
      if (lip > 0.01) lipArea += 0.0625;
      if (supports(x, z) !== b)
        slope = Math.max(
          slope,
          Math.hypot(
            height(x + 0.25, z) - height(x - 0.25, z),
            height(x, z + 0.25) - height(x, z - 0.25),
          ) / 0.5,
        );
      // Everything falls off C1, never in a hard rim at a support's boundary.
      if (supports(x, z) === b) {
        assert.ok(Math.abs(supports(x + 0.001, z) - base(x + 0.001, z)) < 0.00002);
        assert.ok(Math.abs(supports(x, z + 0.001) - base(x, z + 0.001)) < 0.00002);
      }
      if (lip > 0.01)
        lipSlope = Math.max(
          lipSlope,
          Math.hypot(
            rootBankLift(x + 0.05, z) - rootBankLift(x - 0.05, z),
            rootBankLift(x, z + 0.05) - rootBankLift(x, z - 0.05),
          ) / 0.1,
        );
    }
  assert.ok(knollArea > 100 && knollArea < 600, `knoll area is ${knollArea}`);
  assert.ok(lipArea > 1 && lipArea < 15, `lip area is ${lipArea}: entry lips, not banks`);
  assert.ok(lipSlope <= 1.2, `a lip's own slope reaches ${lipSlope}`);
  assert.ok(slope <= 1.2, `terrain slope reaches ${slope} in the supports`);
  const geometry = createEarthGeometry(base),
    rendered = steepestLift(geometry);
  geometry.dispose();
  assert.ok(rendered <= 1.25, `rendered terrain slope reaches ${rendered} in the supports`);
  // Never a level plate: about the trunk, away from the pinned ground and
  // the roots, the soil undulates.
  const probe = rootProbe(treeMesh("high")),
    open = [];
  for (let r = 2.5; r <= 9; r += 0.5)
    for (let a = 0; a < 360; a += 3) {
      const x = trunkX + r * Math.cos((a * Math.PI) / 180),
        z = trunkZ + r * Math.sin((a * Math.PI) / 180),
        soil = supports(x, z) - floor;
      if (pinKeep(x, z) < 1) continue;
      if (probe(x - TREE_FOOTING.x, z - TREE_FOOTING.z, soil - 0.5, soil + 1.5) < Infinity)
        continue;
      open.push(soil);
    }
  const level = open.filter((soil) => Math.abs(soil) < 0.01).length / open.length;
  assert.ok(
    open.length > 500 && level < 0.35,
    `${(level * 100).toFixed(1)}% of ${open.length} open points level`,
  );
  // The knoll holds where the east and north-east roots touch down and gives
  // way between and beyond them.
  for (const [x, z] of [
    [11, -1.75],
    [8.5, 3.2],
    [7, 4.9],
  ])
    assert.equal(
      knollWeight(x - TRUNK[0], z - TRUNK[1], TREE_FOOTING.x + x, TREE_FOOTING.z + z),
      1,
    );
  for (const [x, z] of [
    [16, 6],
    [21, -2],
    [-9, 3],
  ])
    assert.ok(
      knollWeight(x - TRUNK[0], z - TRUNK[1], TREE_FOOTING.x + x, TREE_FOOTING.z + z) < 0.5,
    );
  // The pinned ground takes nothing of the knoll, the relief or the lips:
  // within PIN_KEEP of the lantern, the river's banks, and beyond each
  // drip-line puddle's radius. Only the river's own channel lowers it.
  for (let a = 0; a < 6.3; a += 0.1)
    for (const r of [0, 1, 2, PIN_KEEP.lantern]) {
      const x = LANTERN_FOOT.x + r * Math.cos(a),
        z = LANTERN_FOOT.z + r * Math.sin(a);
      const [b, knoll, relief, lip, channel] = rootSupportLifts(x, z, base, false);
      assert.ok(
        Math.abs(knoll) + Math.abs(relief) + Math.abs(lip) < 1e-12,
        `lantern clearing raised at ${x},${z}`,
      );
      assert.equal(supports(x, z), b + channel);
    }
  // So does the river's whole bank about where it passes the lantern.
  for (let along = -8; along <= 8; along += 0.5)
    for (const out of [-1, -0.5, 0, 0.5, 1]) {
      const [px, pz, fx, fz] = riverPoint(RIVER_NEAR + along),
        x = px - fz * out * RIVER.width * RIVER_BED.reach[1],
        z = pz + fx * out * RIVER.width * RIVER_BED.reach[1];
      const [, knoll, relief, lip] = rootSupportLifts(x, z, base, false);
      assert.ok(
        Math.abs(knoll) + Math.abs(relief) + Math.abs(lip) < 1e-12,
        `bank raised at ${x},${z}`,
      );
    }
  // The drip-line puddles and Portrait's foreground puddle keep their ground
  // and gain no rim: untouched to half a unit beyond their edge, at most a
  // trace at three quarters. The river's bank never reaches into them (its
  // reach may come near Portrait's), and only the river lowers their margin.
  for (const zone of SLATE_PUDDLES.zones) {
    const p = estatePoint(zone.anchor, zone.deg, zone.dist);
    for (let a = 0; a < 6.3; a += 0.05)
      for (const r of [0, zone.radius / 2, zone.radius, zone.radius + 0.5, zone.radius + 0.75]) {
        const x = p.x + r * Math.cos(a),
          z = p.z + r * Math.sin(a),
          channel = rootSupportLifts(x, z, base)[4];
        assert.ok(channel === 0 || r > zone.radius, `the river reaches into a puddle at ${x},${z}`);
        if (r <= zone.radius + 0.5)
          assert.equal(height(x, z), base(x, z) + channel, `drip-line puddle raised at ${x},${z}`);
        else
          assert.ok(
            Math.abs(height(x, z) - channel - base(x, z)) < 0.005,
            `drip-line puddle rim at ${x},${z}`,
          );
      }
  }
  // Under the south-east spur the knoll keeps SPUR's depth below the footing
  // (where the dune is no lower, the soil stays as it was): never above it.
  const [ax, az, bx, bz, , , depth] = SPUR;
  for (let t = 0; t <= 1; t += 0.05) {
    const x = TREE_FOOTING.x + ax + (bx - ax) * t,
      z = TREE_FOOTING.z + az + (bz - az) * t,
      [b, knoll, shape] = rootSupportLifts(x, z, base);
    assert.ok(supports(x, z) - floor < 0.001, `soil under the spur at ${x},${z}`);
    assert.ok(b + knoll <= Math.max(b, floor - depth) + 1e-9 && shape <= 0, `${x},${z}`);
  }
  // The relief is seeded and deterministic.
  assert.equal(reliefNoise(60.3, 31.7), reliefNoise(60.3, 31.7));
  assert.ok(Math.abs(reliefNoise(60.3, 31.7)) <= relief);
});

test("root contact shading is neutral away from the roots and settles the soil about the trunk", () => {
  const base = groundBase(),
    geometry = createEarthGeometry(base),
    shade = geometry.attributes.slateRoot;
  assert.equal(shade.itemSize, 4);
  assert.equal(shade.count, geometry.attributes.position.count);
  const p = geometry.attributes.position,
    lift = terrainLift(geometry);
  let near = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - TREE_FOOTING.x,
      z = -p.getY(i) - TREE_FOOTING.z;
    const [vx, vz, contact, open] = [shade.getX(i), shade.getY(i), shade.getZ(i), shade.getW(i)];
    assert.ok(Number.isFinite(vx + vz + contact + open));
    assert.ok(contact >= 0 && contact <= 1 && open >= 0 && open <= 1);
    if (Math.hypot(x - TRUNK[0], z - TRUNK[1]) > 20) {
      assert.deepEqual([contact, open], [0, 1], "neutral away from the roots");
      // Nothing lifts there; only the river's channel may lower it.
      const at = lift(p.getX(i), -p.getY(i));
      assert.ok(
        at === 0 || (at < 0 && riverRadius(p.getX(i), -p.getY(i)) < RIVER_BED.reach[1]),
        `${at} at ${p.getX(i)},${-p.getY(i)}`,
      );
    }
    if (Math.hypot(x - TRUNK[0], z - TRUNK[1]) < 3) {
      assert.equal(open, 0, "the soil about the trunk is settled");
      near++;
    }
  }
  assert.ok(near > 20);
  // The rendered lift: the terrain above its lift-free surface, at vertices and between them.
  const flat = surface(plainDunes(base)),
    raised = surface(createEarthGeometry(base));
  let lifted = 0;
  for (let x = TREE_FOOTING.x - 8; x < TREE_FOOTING.x + 14.5; x += 0.61)
    for (let z = TREE_FOOTING.z - 12; z < TREE_FOOTING.z + 12; z += 0.53) {
      const expected = raised.at(x, z).point.y - flat.at(x, z).point.y;
      assert.ok(
        Math.abs(lift(x, z) - expected) < 1e-4,
        `lift at ${x},${z}: ${lift(x, z)} vs ${expected}`,
      );
      if (expected > 0.1) lifted++;
    }
  assert.ok(lifted > 200, `${lifted} lifted samples`);
  flat.dispose();
  raised.dispose();
  // A root end in full contact: the line passes through it. Its contact
  // strength follows the real footprint (ROOT_SHADE's cut), which on both
  // variants ends a few tenths short of the centreline's tip: full half a unit
  // in, still strong at the tip.
  const [vx, vz, contact] = rootShade(12.1, -1.1, 0);
  assert.ok(Math.hypot(vx, vz) < 0.01 && contact > 0.6, `${contact}`);
  assert.ok(rootShade(11.6, -1.15, 0)[2] > 0.9);
  // Where a centreline runs over open soil, the contact is cut: the east (L2)
  // root and the spur arch a unit or more above the soil near the trunk (the
  // mesh's footprint lies far from their lines there). Where the sunk south
  // (L0) and east roots come down within half a unit of the soil, only a
  // faint crease shows.
  for (const [x, z] of [
    [6, -1.6],
    [7.3, -1.6],
    [5.4, -2.8],
  ])
    assert.equal(rootShade(x, z, 0)[2], 0, `${x},${z}`);
  for (const [x, z] of [
    [3.1, -5.5],
    [3.3, -4.3],
    [8.5, -1.7],
  ])
    assert.ok(rootShade(x, z, 0)[2] < 0.35, `${x},${z}`);
  // The aerial spur only takes a soft shade, never a contact line.
  assert.ok(rootShade(7.9, -6, 0)[2] < 0.4);
  // The puddles never take settled soil (it would dry them).
  for (const zone of SLATE_PUDDLES.zones) {
    const q = estatePoint(zone.anchor, zone.deg, zone.dist);
    assert.equal(rootShade(q.x - TREE_FOOTING.x, q.z - TREE_FOOTING.z, 0)[3], 1);
  }
  geometry.dispose();
});

const SLATE_CHUNKS = {
  vertexShader: "#include <begin_vertex>",
  fragmentShader: [
    "#include <map_fragment>",
    "#include <roughnessmap_fragment>",
    "#include <normal_fragment_maps>",
    "#include <lights_fragment_end>",
    "#include <fog_fragment>",
  ].join("\n"),
};
// Three's own physical program, as onBeforeCompile receives it.
const PHYSICAL = () => ({
  uniforms: {},
  vertexShader: ShaderLib.physical.vertexShader,
  fragmentShader: ShaderLib.physical.fragmentShader,
});
const count = (text, pattern) => text.split(pattern).length - 1;

test("the lazy ground shading extends only the slate's program, under its own key, with the puddle mirror and the root shading", () => {
  const material = new MeshStandardMaterial(),
    detail = { isTexture: true };
  const compile = (...args) => {
    configureGroundShading(material, ...args);
    const shader = PHYSICAL();
    material.onBeforeCompile(shader);
    return { key: material.customProgramCacheKey(), ...shader };
  };
  const cases = [
    [[true, { detail }], "moonlit-slate-v3", true],
    [[true], "moonlit-slate-v3-p", false],
    [[false, { detail }], "ground-baseline", null],
  ];
  for (const [args, key, authored] of cases) {
    const before = compile(...args);
    material.userData.slateRoot = shadeSlateGround;
    const after = compile(...args);
    delete material.userData.slateRoot;
    assert.equal(before.key, key);
    if (authored === null) {
      // Other grounds never take it: same key, same program.
      assert.deepEqual(after, before, key);
      continue;
    }
    assert.equal(after.key, `${key}+root`);
    const vertex = after.vertexShader,
      fragment = after.fragmentShader;
    assert.equal(before.fragmentShader.includes("vSlateRoot"), false);
    // The root attributes: the contact vector, strength and settled soil, the
    // baked occlusion, and the soil's cavity (POOL_FIELD).
    assert.match(
      vertex,
      /^attribute vec4 slateRoot;\nattribute vec2 slateShade;\nattribute float slatePool;\nvarying vec4 vSlateRoot;\nvarying vec2 vSlateShade;\nvarying float vSlatePool;\n/,
    );
    assert.match(
      vertex,
      /vSlateRoot = slateRoot;\nvSlateShade = slateShade;\nvSlatePool = slatePool;/,
    );
    assert.match(
      fragment,
      /^varying vec4 vSlateRoot;\nvarying vec2 vSlateShade;\nvarying float vSlatePool;\nuniform vec3 slateKeyView;\n/,
    );
    // Rain in the soil's low spots: standing water (a puddle, before the lantern
    // puddle is taken), wet mud about it and drier crests, clear of the clearing;
    // the trunk darkens the water's mirror.
    const P = SLATE_SOIL.pool;
    assert.ok(
      fragment.includes(
        `float slatePoolW = smoothstep(${P.water[0]}, ${P.water[1]}, slatePoolDepth)*(1.0-slateDry)*(1.0-slateKeep);`,
      ),
    );
    assert.ok(
      fragment.indexOf("slatePuddle = max(slatePuddle, slatePoolW);") <
        fragment.indexOf("float slateLanternPuddle ="),
    );
    assert.match(fragment, /slateWet = max\(slateWet\*\(1\.0-[\d.]+\*slateCrest\), slateMud\);/);
    assert.match(fragment, /slateWaterVeil = max\(/);
    // The square grit is gone: the close soil's grit map (mud-ground.js SLATE_CLOSE) holds it.
    assert.doesNotMatch(fragment, /slateGrit[N1-9C]/);
    assert.match(
      fragment,
      /roughnessFactor = mix\(roughnessFactor, [\d.]+, slateMud\*\(1\.0-slatePuddle\)\);/,
    );
    // The root contact's damp soil is mud too.
    assert.ok(fragment.includes(`slateMud = max(slateMud, ${SLATE_SOIL.damp.mud}*slateDamp);`));
    // The water's mirror sees only the sky the tree leaves open.
    assert.match(fragment, /slateSkyVis = 1\.0-slateSky;/);
    // In the lantern clearing (1.9-2.4 about the lantern) the earlier terms stay exactly as they were.
    assert.match(
      fragment,
      /float slateKeepAt\(vec2 p\) \{ return 1\.0 - smoothstep\(1\.9, 2\.4, length\(p - vec2\(50\.92,33\.36\)\)\); \}/,
    );
    assert.match(
      fragment,
      /slateDry = max\(slateDry, mix\(0\.15\*slateSettle, 1\.0-vSlateRoot\.w, slateKeep\)\);\s*float slateWet = /,
    );
    assert.match(
      fragment,
      /diffuseColor\.rgb \*= 1\.0 - 0\.35\*vSlateRoot\.z\*\(1\.0-smoothstep\(\.3, 1\.0, slateU\)\)\*slateContactGain\*slateKeep;/,
    );
    // The origin-centred tree contact (slot 0) gives way to the root lines, but in the clearing.
    assert.match(
      fragment,
      /slateContacts\[i\]\.w\*\(i > 0 \? 1\.0 : slateKeep\)\*\(i < 2 \? 1\.0 : slateRockContact\)/,
    );
    // One branch around the root block, after the contacts; a crease along each root line.
    assert.match(
      fragment,
      /diffuseColor\.rgb \*= 1\.0 - slateAo\*slateContactGain;\nif \(vSlateShade\.x \+ vSlateShade\.y \+ vSlateRoot\.z > 0\.0\) \{/,
    );
    assert.match(
      fragment,
      /float slateCrease = vSlateRoot\.z\/\(1\.0\+6\.0\*slateU\*slateU\)\*slateGuard;/,
    );
    // The baked key occlusion only where no shadow map does (contact gain 1: shadows off).
    assert.match(fragment, /\*clamp\(\(slateContactGain-\.6\)\*2\.5, 0\.0, 1\.0\)/);
    // Each direct light is dimmed by the occlusion (the key by direction among the
    // directional lights, so the crown's point light never takes the key's term;
    // the lantern by colour).
    assert.match(
      fragment,
      /if \(slateDirectional && dot\(L, slateKeyView\) > \.9995\) return 1\.0 - slateKeyOcc;/,
    );
    assert.ok(
      fragment.includes(`if (C.b < .7*C.r) return 1.0 - ${SLATE_SOIL.occlusion.lantern}*slateSky;`),
    );
    assert.match(fragment, /#undef RE_Direct\n#define RE_Direct RE_Direct_Slate/);
    assert.ok(
      fragment.indexOf("#define RE_Direct RE_Direct_Slate") >
        fragment.indexOf("#define RE_Direct\t\t\t\tRE_Direct_Physical"),
    );
    // The root occlusion wraps the film ground's own balance of the lights.
    assert.ok(
      fragment.indexOf("#define RE_Direct RE_Direct_Slate") >
        fragment.indexOf("#define RE_Direct RE_Direct_Moonlit"),
    );
    assert.match(fragment, /RE_Direct_Moonlit\(slateLight, geometryPosition,/);
    assert.equal(fragment.includes("slateLight.color *= 1.2;"), false);
    // Occluded sky light and reflections; damp soil in the creases and the cavity only.
    assert.match(
      fragment,
      /reflectedLight\.indirectSpecular \*= \.18;\s*reflectedLight\.indirectSpecular \*= 1\.0-slateSky;/,
    );
    assert.match(
      fragment,
      /reflectedLight\.indirectDiffuse \*= vec3\(1\.14, 1\.19, 1\.25\);\nreflectedLight\.indirectDiffuse \*= 1\.0-0\.75\*slateSky;\n#include <aomap_fragment>/,
    );
    assert.match(fragment, /roughnessFactor = mix\(roughnessFactor, 0\.55, slateDamp\);/);
    // Only the authored maps' soil follows the cracks, with a crumbly grain.
    assert.equal(
      /slateSettle = slateSettleAt\(vSlateRoot\.w, slateDepth\);\nfloat slateGrain/.test(fragment),
      authored,
    );
    assert.equal(
      fragment.includes(
        "*slatePuddle)*(1.-mix(0.15*slateSettle, 0.5*(1.-vSlateRoot.w), slateKeep)), mix(slateNA.z",
      ),
      authored,
    );
    assert.equal(
      fragment.includes("slateDepth = slateH;\nslateKeep = slateKeepAt(vMudWorld.xz);"),
      !authored,
    );
    // Every root term reads the attributes; where they are neutral (x, y, 0, 1 and 0, 0) nothing changes.
    assert.equal(count(fragment, "vSlateRoot"), authored ? 9 : 7);
    assert.equal(count(fragment, "vSlateShade"), 5);
    // The puddle mirror: its own list, independent of the roots.
    assert.match(fragment, /^uniform vec4 slateDrip, slateFlame;\n[\s\S]*\n#define STANDARD/m);
    assert.match(
      fragment,
      /float slateLevel;\nfloat slatePuddle = smoothstep\(-\.04, \.04, slateLevel=/,
    );
    // Inside the puddle zones the grazing sky sheen and the wet sheen give way
    // to the mirror; beyond them (slateZoneW 0) every earlier term stays.
    assert.match(fragment, /slateZoneW = smoothstep\(0\.0, \.04, slateLevel\+slateH\);/);
    assert.match(
      fragment,
      /slateWaterCover \*= 1\.0-slatePuddle\*slateZoneW;\nvec3 slateWaterRefl =/,
      "the water film's and the puddles' mirror give way to the zone's own",
    );
    // The zone's mirror shows the night sky (the environment) at its sharpest,
    // brighter in a lightning flash away from the text (film-light.js
    // FLASH_GROUND), and the old horizon, fog and zenith sky only without it.
    assert.match(
      fragment,
      /#ifdef USE_ENVMAP\s*vec3 slateSkyW = textureCubeUV\(envMap, slateR, 0\.0\)\.rgb\*envMapIntensity\*[\d.]+\*\(babelFlash\.y > 0\.0 \? 1\.0\+babelFlash\.y\*\(1\.0-slateBehindText\(\)\) : 1\.0\);\s*#else\s*vec3 slateSkyW = mix\(/,
    );
    assert.match(fragment, /slatePuddle = mix\(slatePuddle, smoothstep\([^;]*\), slateZoneW\);/);
    assert.match(
      fragment,
      /float slateWater = slatePuddle\*slateZoneW;\nif \(slateWater > 0\.0\) \{/,
    );
    assert.match(
      fragment,
      /reflectedLight\.directSpecular \*= mix\(1\.0, 0\.22, slateLanternPuddle\);/,
      "only the lantern puddle gives up its GGX lobe",
    );
    // The water normal (undulation and drips) is paid only in the water, after the lights.
    assert.ok(
      fragment.indexOf("vec3 slateN = normalize(normal*mat3(viewMatrix));") >
        fragment.indexOf("if (slateWater > 0.0) {"),
    );
    assert.ok(
      fragment.indexOf("if (slateWater > 0.0) {") <
        fragment.indexOf("reflectedLight.indirectDiffuse *= 1.0-0.75*slateSky;"),
    );
    // No 2D texture lookup, light or pass is added (the water reads the film's
    // environment cube, night-environment.js).
    assert.equal(count(fragment, "texture2D("), count(before.fragmentShader, "texture2D("));
    assert.equal(count(vertex, "texture2D("), count(before.vertexShader, "texture2D("));
    // The river's current: ripples drawn out along the flow, drifting downstream
    // at RIVER.flow on the drips' clock (the same uniform, so they hold as the
    // drips do), easing out toward the shore; the finer octave fades out
    // before it aliases.
    assert.match(fragment, /^uniform vec4 slateDrip, slateFlame;\nuniform float slateFlow;\n/m);
    assert.ok(
      fragment.includes(
        `vec2 slateFU = vec2(slateRiverQ.y-slateFlow*${RIVER.flow}, slateRiverQ.z);`,
      ),
    );
    assert.match(
      fragment,
      /slateG \+= \(slateRiverDir\*slateFG\.x\+vec2\(-slateRiverDir\.y, slateRiverDir\.x\)\*slateFG\.y\)\*\(1\.0-smoothstep\(\.8, 1\.1, slateRiverR\)\);/,
    );
    assert.match(fragment, /\*smoothstep\(1\.5, 3\.0, [\d.]+\/slateFP\);/);
    assert.equal(after.uniforms.slateFlow, dripClock().uniform, "the drips' own clock");
    // Gentle: slow, the ripples drawn out along the flow, their tilt below the drips'.
    assert.ok(RIVER.flow > 0 && RIVER.flow <= 0.4);
    assert.ok(
      RIVER_RIPPLE.coarse[0] < RIVER_RIPPLE.coarse[1] &&
        RIVER_RIPPLE.fine[0] < RIVER_RIPPLE.fine[1],
    );
    assert.ok(RIVER_RIPPLE.tilt[0] + RIVER_RIPPLE.tilt[1] <= 0.03);
    // The lazy chunk's own uniforms.
    assert.equal(after.uniforms.slateDrip.value.length, 4);
    assert.equal(after.uniforms.slateFlame.value.length, 4);
    assert.ok(after.uniforms.slateKeyView.value.isVector3);
  }
  assert.deepEqual([SLATE_SOIL.albedo, SLATE_SOIL.flatten, SLATE_SOIL.contact], [0.5, 0.5, 0.35]);
  assert.deepEqual(SLATE_SOIL.keep, [1.9, 2.4]);
  // The cavity stays lit by the lantern more than by the fills (the lantern-lit
  // close-ups would otherwise sink below 0.30 of open ground).
  assert.ok(
    SLATE_SOIL.occlusion.lantern < SLATE_SOIL.occlusion.fill && SLATE_SOIL.occlusion.lantern <= 0.6,
  );
  // A program without its anchors is left unchanged.
  const bare = { uniforms: {}, ...SLATE_CHUNKS };
  assert.equal(shadeSlateRoots(bare), false);
  assert.equal(shadeSlatePuddles(bare), false);
  assert.deepEqual(shadeSlateGround(bare), { puddles: false, roots: false });
  assert.deepEqual(bare, { uniforms: {}, ...SLATE_CHUNKS });
  material.dispose();
});

test("the puddle mirror and the root shading apply without each other", () => {
  const material = new MeshStandardMaterial();
  for (const detail of [{ isTexture: true }, null]) {
    configureGroundShading(material, true, { detail });
    const program = () => {
      const shader = PHYSICAL();
      material.onBeforeCompile(shader);
      return shader;
    };
    // Without a puddle anchor, the roots still apply; the puddle list changes nothing.
    const noWater = program();
    noWater.fragmentShader = noWater.fragmentShader.replace("#define STANDARD", "");
    const water = noWater.fragmentShader;
    assert.deepEqual(shadeSlateGround(noWater), { puddles: false, roots: true });
    assert.equal(noWater.fragmentShader.includes("slateDrip"), false);
    assert.equal(noWater.uniforms.slateDrip, undefined);
    assert.match(noWater.fragmentShader, /vSlateShade/);
    // Without a root anchor, the puddles still apply; the root list changes nothing.
    const noRoots = program();
    noRoots.fragmentShader = noRoots.fragmentShader.replace(
      "#define RE_Direct RE_Direct_Moonlit",
      "",
    );
    assert.deepEqual(shadeSlateGround(noRoots), { puddles: true, roots: false });
    assert.equal(noRoots.fragmentShader.includes("vSlateRoot"), false);
    assert.equal(noRoots.vertexShader.includes("slateShade"), false);
    assert.match(noRoots.fragmentShader, /slateDrip/);
    // The puddle list alone leaves the root terms out, and the root list alone the water.
    const puddlesOnly = program();
    assert.equal(shadeSlatePuddles(puddlesOnly), true);
    assert.equal(puddlesOnly.fragmentShader.includes("vSlateRoot"), false);
    assert.ok(water.length > 0);
  }
  material.dispose();
});

test("the ground shading also finds its anchors in the published, compacted chunks", async () => {
  // Bundle mud-ground.js and terrain-build.js as build.mjs does: their GLSL
  // loses indentation and the spaces beside punctuation.
  const scratchRoot = fileURLToPath(new URL("../.tmp-preview-review/", import.meta.url));
  await mkdir(scratchRoot, { recursive: true });
  const scratch = await mkdtemp(path.join(scratchRoot, "slate-root-"));
  try {
    const shipped = {};
    for (const name of ["mud-ground", "terrain-build"]) {
      const outfile = path.join(scratch, `${name}.mjs`);
      await build({
        entryPoints: [fileURLToPath(new URL(`../src/scene/${name}.js`, import.meta.url))],
        bundle: true,
        format: "esm",
        outfile,
        external: ["three"],
        logLevel: "silent",
        plugins: [
          {
            name: "compact-shaders",
            setup(bundler) {
              bundler.onLoad(
                { filter: /[\\/]src[\\/]scene[\\/][^\\/]+\.js$/ },
                async ({ path: file }) => ({
                  contents: compactShaderSource(await readFile(file, "utf8")),
                  loader: "js",
                }),
              );
            },
          },
        ],
      });
      shipped[name] = await import(pathToFileURL(outfile).href);
    }
    const material = new MeshStandardMaterial();
    for (const [detail, roots] of [
      [{ isTexture: true }, 9],
      [null, 7],
    ]) {
      shipped["mud-ground"].configureGroundShading(material, true, { detail });
      const plain = PHYSICAL();
      material.onBeforeCompile(plain);
      assert.doesNotMatch(
        plain.fragmentShader,
        /slateAo\*slateContactGain; |float slateWet = /,
        "the bundle is compacted",
      );
      assert.match(plain.fragmentShader, /float slateWet=/);
      material.userData.slateRoot = shipped["terrain-build"].shadeSlateGround;
      const shaded = PHYSICAL();
      material.onBeforeCompile(shaded);
      assert.equal(
        material.customProgramCacheKey(),
        detail ? "moonlit-slate-v3+root" : "moonlit-slate-v3-p+root",
      );
      assert.match(shaded.vertexShader, /vSlateRoot = slateRoot;\nvSlateShade = slateShade;/);
      assert.equal(count(shaded.fragmentShader, "vSlateRoot"), roots);
      assert.equal(count(shaded.fragmentShader, "vSlateShade"), 5);
      assert.match(shaded.fragmentShader, /slateLevel=/);
      assert.match(shaded.fragmentShader, /#define RE_Direct RE_Direct_Slate/);
      assert.match(shaded.fragmentShader, /#if NUM_POINT_LIGHTS > 0\n/);
      assert.equal(
        count(shaded.fragmentShader, "texture2D("),
        count(plain.fragmentShader, "texture2D("),
      );
      assert.ok(
        shaded.uniforms.slateDrip && shaded.uniforms.slateFlame && shaded.uniforms.slateKeyView,
      );
      delete material.userData.slateRoot;
    }
    material.dispose();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

// A slate ground in a stand-in scene, with a renderer that links through
// compileAsync (held until finish()) and a container that takes "is-ready".
function linkRig({ revealed = false, parallel = true } = {}) {
  const base = groundBase(),
    terrain = createEarthGeometry(base),
    root = new Group(),
    material = new MeshStandardMaterial();
  configureGroundShading(material, true, { detail: { isTexture: true } });
  const ground = new Mesh(terrain, material),
    tufts = createEstateGroundDetail(base);
  root.add(ground, tufts.mesh);
  const names = new Set(revealed ? ["is-ready"] : []),
    links = [];
  const renderer = {
    domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
    extensions: { has: (name) => parallel && name === "KHR_parallel_shader_compile" },
    getContext: () => ({ isContextLost: () => false }),
    shadowMap: { enabled: false },
    target: null,
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(target) {
      this.target = target;
    },
    compileAsync(object, camera, scene) {
      const link = { object, camera, scene, target: this.target };
      links.push(link);
      return new Promise((resolve) => {
        link.finish = resolve;
      });
    },
  };
  const rendering = {
    renderer,
    homeScene: root,
    camera: { isCamera: true },
    composer: { readBuffer: { isRenderTarget: true } },
  };
  return {
    base,
    terrain,
    root,
    material,
    ground,
    tufts,
    links,
    rendering,
    reveal: () => names.add("is-ready"),
  };
}

// Steps the frames that settleRoots() and the terrain's arrival wait on.
function frames() {
  const queue = [],
    previous = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (task) => queue.push(task);
  return {
    async step(count = 1) {
      for (let i = 0; i < count; i++) {
        for (const task of queue.splice(0)) task(performance.now());
        await new Promise((resolve) => setImmediate(resolve));
      }
    },
    restore() {
      if (previous) globalThis.requestAnimationFrame = previous;
      else delete globalThis.requestAnimationFrame;
    },
  };
}

test("settling the roots seats the tufts at once and never holds the reveal for the shaded ground", async () => {
  const r = linkRig(),
    clock = frames();
  try {
    const { base, terrain, material, ground, tufts, links, rendering } = r,
      lift = terrainLift(terrain);
    const p = tufts.mesh.geometry.attributes.position,
      before = Float32Array.from(p.array);
    const color = tufts.mesh.geometry.attributes.color,
      tone = Float32Array.from(color.array);
    const tour = { running: true, transition: { cut: false } };
    let invalidations = 0;
    const height = settleRoots(terrain, ground, rendering, base, () => invalidations++, tour);
    // The rocks' height is ready at once, with the tufts on the plate or a berm.
    assert.equal(typeof height, "function");
    for (const [x, z] of [
      [TREE_FOOTING.x + 10, TREE_FOOTING.z],
      [0, 0],
      [TREE_FOOTING.x - 6, TREE_FOOTING.z + 4],
    ])
      assert.ok(Math.abs(height(x, z) - base(x, z) - lift(x, z)) < 1e-9);
    // On the level plain the knoll beside the tree is a low base, never a step.
    const knoll =
      height(TREE_FOOTING.x + 10, TREE_FOOTING.z) - base(TREE_FOOTING.x + 10, TREE_FOOTING.z);
    assert.ok(knoll >= 0 && knoll < 0.3, `knoll ${knoll}`);
    // Each blade either rises with the plate, berms and banks (darker in the
    // tree's shade), or, under a root or in the trunk's deep cavity,
    // collapses to a point just under the ground.
    const stride = tufts.mesh.geometry.userData.bladeVertices,
      grass = tufts.mesh.geometry.attributes.aGrass;
    assert.equal(stride, 8);
    let raised = 0,
      culled = 0,
      shaded = 0;
    for (let i = 0; i < p.count; i += stride) {
      const x = (before[i * 3] + before[i * 3 + 3]) / 2,
        z = (before[i * 3 + 2] + before[i * 3 + 5]) / 2,
        dy = lift(x, z);
      const [sky] = rootOcclusion(x, z);
      if (rootCovered(x, z) || sky > TUFTS.cull) {
        for (let k = i; k < i + stride; k++) {
          assert.deepEqual([p.getX(k), p.getZ(k)], [Math.fround(x), Math.fround(z)]);
          // A collapsed blade never sways back out of the ground.
          assert.equal(grass.getX(k), 0);
          assert.ok(
            Math.abs(p.getY(k) - ((before[i * 3 + 1] + before[i * 3 + 4]) / 2 + dy - 0.05)) < 1e-4,
          );
        }
        culled++;
        continue;
      }
      for (let k = i; k < i + stride; k++) {
        assert.ok(Math.abs(p.getY(k) - before[k * 3 + 1] - dy) < 1e-4);
        assert.ok(
          Math.abs(color.getX(k) - tone[k * 3] * (sky > 0.02 ? 1 - TUFTS.shade * sky : 1)) < 1e-6,
        );
      }
      if (dy > 0.05) raised++;
      if (sky > 0.02) shaded++;
    }
    assert.ok(raised > 10, `${raised} blades stand on the raised plate`);
    assert.ok(
      culled > 5 && culled < p.count / stride / 4,
      `${culled} blades collapse under the roots and in the cavity`,
    );
    assert.ok(shaded > 10, `${shaded} blades darken in the tree's shade`);
    // The litter: one draw with the tufts' material, receiving shadows.
    const litter = tufts.mesh.getObjectByName("estate-root-litter");
    assert.equal(litter.parent, tufts.mesh);
    assert.equal(litter.material, tufts.mesh.material);
    assert.deepEqual(
      [litter.receiveShadow, litter.castShadow, litter.matrixAutoUpdate],
      [true, false, false],
    );
    assert.equal(litter.geometry.userData.litter.length, LITTER.count);
    // Nothing links while the canvas is hidden: the reveal's warm-ups never wait on it.
    await clock.step(3);
    assert.equal(links.length, 0);
    assert.equal(material.customProgramCacheKey(), "moonlit-slate-v3");
    // Once the canvas shows, the shaded program links on a detached stand-in,
    // against the composer's target, with the scene's lights.
    r.reveal();
    await clock.step();
    assert.equal(links.length, 1);
    const [link] = links,
      stand = link.object;
    assert.equal(stand.parent, null, "the stand-in never draws");
    assert.equal(stand.geometry, terrain);
    assert.equal(stand.material.customProgramCacheKey(), "moonlit-slate-v3+root");
    const shader = PHYSICAL();
    stand.material.onBeforeCompile(shader);
    assert.match(shader.fragmentShader, /vSlateRoot/);
    assert.match(shader.fragmentShader, /slateDrip/);
    assert.equal(link.scene, r.root);
    assert.equal(link.camera, rendering.camera);
    assert.equal(link.target, rendering.composer.readBuffer);
    assert.equal(rendering.renderer.target, null, "the render target is restored");
    // Linked mid-shot, the ground keeps its program until the next cut.
    link.finish();
    await clock.step(3);
    assert.equal(material.customProgramCacheKey(), "moonlit-slate-v3", "never mid-shot");
    assert.equal(invalidations, 0);
    tour.transition.cut = true;
    await clock.step();
    assert.equal(material.customProgramCacheKey(), "moonlit-slate-v3+root", "switched on the cut");
    assert.equal(invalidations, 1);
    assert.equal(links.length, 1, "no second link");
    // From the switch on, each draw of the ground brings the moon key's view
    // direction up to date and runs the drips' clock, which starts calm.
    const drips = ground.userData.slateDrips;
    assert.equal(drips.uniform.value, DRIP_RIPPLES.start, "the water appears in a calm gap");
    const camera = new PerspectiveCamera();
    camera.position.set(3, 5, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    ground.onBeforeRender(null, r.root, camera);
    ground.onBeforeRender(null, r.root, camera);
    assert.ok(
      shader.uniforms.slateKeyView.value.distanceTo(
        new Vector3(...KEY_LIGHT).transformDirection(camera.matrixWorldInverse),
      ) < 1e-9,
    );
    assert.ok(
      drips.uniform.value >= DRIP_RIPPLES.start && drips.uniform.value <= DRIP_RIPPLES.start + 0.1,
    );
    assert.equal(
      shader.uniforms.slateDrip.value[3],
      0,
      "calm: no drip lives, the rings cost nothing",
    );
    assert.deepEqual(
      shader.uniforms.slateFlame.value,
      [0, 0, 0, 0],
      "no flame module here: the mirror draws no flame",
    );
    // The stand-in holds the linked program until the ground has drawn once.
    let freed = 0;
    stand.material.addEventListener("dispose", () => freed++);
    ground.onAfterRender();
    assert.equal(ground.onAfterRender, Mesh.prototype.onAfterRender);
    await clock.step();
    assert.equal(freed, 1);
    // Disposing the terrain withdraws the shading, the clock and the litter.
    let litterFreed = 0;
    litter.geometry.addEventListener("dispose", () => litterFreed++);
    terrain.dispose();
    assert.equal(material.customProgramCacheKey(), "moonlit-slate-v3");
    assert.equal(ground.onBeforeRender, Mesh.prototype.onBeforeRender);
    assert.equal(ground.userData.slateDrips, undefined);
    assert.equal(litter.parent, null);
    assert.equal(litterFreed, 1);
    assert.equal(tufts.mesh.material.version >= 0, true, "the shared material stays");
    tufts.dispose();
    material.dispose();
  } finally {
    clock.restore();
  }
});

test("the shaded ground switches early in the canvas's fade-in, on a still frame, or links again after a change", async () => {
  const clock = frames(),
    style = globalThis.getComputedStyle;
  try {
    // During the reveal's 480 ms fade-in over the title card, timed from its mark.
    globalThis.getComputedStyle = () => ({ transitionDuration: "0.48s" });
    const fade = linkRig({ revealed: true }),
      tour = { running: true, transition: { cut: false } };
    performance.mark("babel:reveal");
    settleRoots(fade.terrain, fade.ground, fade.rendering, fade.base, () => {}, tour);
    assert.equal(fade.links.length, 1);
    fade.links[0].finish();
    await clock.step(2);
    assert.equal(
      fade.material.customProgramCacheKey(),
      "moonlit-slate-v3+root",
      "switched under the fade",
    );
    // Later in the fade the canvas is mostly opaque (a pop on shots that open
    // at the tree, review 2026-09-28): a link that settles then waits for a cut.
    const slow = linkRig({ revealed: true });
    performance.mark("babel:reveal");
    settleRoots(slow.terrain, slow.ground, slow.rendering, slow.base, () => {}, tour);
    await new Promise((resolve) => setTimeout(resolve, SHADING_EARLY + 30));
    slow.links[0].finish();
    await clock.step(2);
    assert.equal(slow.material.customProgramCacheKey(), "moonlit-slate-v3", "not late in the fade");
    // Where programs cannot link in parallel the switch's draw links them: never
    // in the fade, which the light shafts' own links need.
    const serialFade = linkRig({ revealed: true, parallel: false });
    performance.mark("babel:reveal");
    settleRoots(
      serialFade.terrain,
      serialFade.ground,
      serialFade.rendering,
      serialFade.base,
      () => {},
      tour,
    );
    await clock.step(2);
    assert.equal(
      serialFade.material.customProgramCacheKey(),
      "moonlit-slate-v3",
      "no synchronous link in the fade",
    );
    // After the fade, only a cut; a light that joins the scene since the link
    // (the tree's) changes the program, so it links again before switching.
    delete globalThis.getComputedStyle;
    const late = linkRig({ revealed: true });
    settleRoots(late.terrain, late.ground, late.rendering, late.base, () => {}, tour);
    late.links[0].finish();
    await clock.step();
    late.root.add(new DirectionalLight());
    tour.transition.cut = true;
    await clock.step();
    assert.equal(
      late.material.customProgramCacheKey(),
      "moonlit-slate-v3",
      "not switched onto an unlinked variant",
    );
    await clock.step();
    assert.equal(late.links.length, 2, "linked again with the new light");
    late.links[1].finish();
    await clock.step(2);
    assert.equal(late.material.customProgramCacheKey(), "moonlit-slate-v3+root");
    // A map or quality change (a material update) does the same.
    const changed = linkRig({ revealed: true });
    settleRoots(changed.terrain, changed.ground, changed.rendering, changed.base, () => {}, tour);
    changed.material.needsUpdate = true;
    changed.links[0].finish();
    await clock.step(3);
    assert.equal(changed.links.length, 2);
    // While the tour is not running (reduced motion, a pause, tour=0) any frame is still.
    const still = linkRig({ revealed: true });
    settleRoots(still.terrain, still.ground, still.rendering, still.base, () => {}, null);
    still.links[0].finish();
    await clock.step(2);
    assert.equal(still.material.customProgramCacheKey(), "moonlit-slate-v3+root");
    // Without parallel linking nothing links ahead; the switch still waits for a cut.
    tour.transition.cut = false;
    const serial = linkRig({ revealed: true, parallel: false });
    settleRoots(serial.terrain, serial.ground, serial.rendering, serial.base, () => {}, tour);
    await clock.step(2);
    assert.equal(serial.links.length, 0);
    assert.equal(serial.material.customProgramCacheKey(), "moonlit-slate-v3");
    tour.transition.cut = true;
    await clock.step();
    assert.equal(serial.material.customProgramCacheKey(), "moonlit-slate-v3+root");
    // Disposed while linking: the stand-in is freed only once its link settles.
    const pending = linkRig({ revealed: true });
    settleRoots(pending.terrain, pending.ground, pending.rendering, pending.base, () => {}, tour);
    let freed = 0;
    pending.links[0].object.material.addEventListener("dispose", () => freed++);
    pending.terrain.dispose();
    await clock.step(2);
    assert.equal(freed, 0, "Three still polls the linking program");
    pending.links[0].finish();
    await clock.step(2);
    assert.equal(freed, 1);
    assert.equal(pending.material.customProgramCacheKey(), "moonlit-slate-v3");
    for (const each of [fade, slow, serialFade, late, changed, still, serial])
      each.terrain.dispose();
    for (const each of [fade, slow, serialFade, late, changed, still, serial, pending]) {
      each.tufts.dispose();
      each.material.dispose();
    }
  } finally {
    clock.restore();
    performance.clearMarks("babel:reveal");
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
  }
});

test("the film terrain builds in idle slices and arrives only where it cannot show mid-shot", async () => {
  const clock = frames(),
    idle = globalThis.requestIdleCallback,
    slices = [];
  let outstanding = 0;
  try {
    // A few milliseconds of idle time at a time (a short idle period here).
    globalThis.requestIdleCallback = (task, options) => {
      assert.equal(options.timeout, 100);
      outstanding++;
      setImmediate(() => {
        outstanding--;
        const start = performance.now();
        task({ didTimeout: false, timeRemaining: () => 1 });
        slices.push(performance.now() - start);
      });
    };
    const base = groundBase(),
      names = new Set(["is-ready"]),
      tour = { running: true, transition: { cut: false } };
    let shadows = 0,
      arrived = null;
    const rendering = {
      renderer: {
        domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
      },
      invalidateShadows: () => shadows++,
    };
    createEarthGeometry(base, undefined, rendering, tour).then((geometry) => {
      arrived = geometry;
    });
    do await clock.step();
    while (outstanding);
    await clock.step(3);
    assert.equal(arrived, null, "built, but never lands mid-shot");
    assert.ok(slices.length > 1, `${slices.length} slices`);
    assert.ok(Math.max(...slices) < 50, `no long task (${Math.max(...slices).toFixed(1)} ms)`);
    tour.transition.cut = true;
    await clock.step(2);
    assert.ok(arrived, "arrives on the cut");
    assert.equal(shadows, 1);
    // Exactly the terrain built at once.
    const direct = createEarthGeometry(base);
    for (const name of ["position", "normal", "uv", "slateRoot"])
      assert.deepEqual(arrived.attributes[name].array, direct.attributes[name].array, name);
    assert.deepEqual(arrived.index.array, direct.index.array);
    for (const [x, z] of [
      [62, 36],
      [58.4, 33.3],
      [0, 0],
    ])
      assert.equal(terrainLift(arrived)(x, z), terrainLift(direct)(x, z));
    // Before the reveal it arrives as soon as it is built (in idle slices
    // then: terrainSlicing, below).
    names.clear();
    tour.transition.cut = false;
    const early = await createEarthGeometry(base, undefined, rendering, tour);
    assert.ok(early, "arrives at once while the canvas is hidden");
    for (const geometry of [arrived, direct, early]) geometry.dispose();
  } finally {
    clock.restore();
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
  }
});

test("while the terrain slices it holds the shafts off, idles while the canvas is hidden, rushes while it fades in, and stops when disposed", async () => {
  const idle = globalThis.requestIdleCallback,
    style = globalThis.getComputedStyle;
  let idles = 0;
  try {
    // No idle time at all (a throttled phone): every idle wait times out.
    globalThis.requestIdleCallback = (task, options) => {
      assert.equal(options.timeout, 100);
      idles++;
      setImmediate(() => task({ didTimeout: true, timeRemaining: () => 0 }));
    };
    const base = groundBase(),
      names = new Set(),
      tour = { running: true, transition: { cut: false } };
    const rendering = {
      renderer: {
        domElement: { parentNode: { classList: { contains: (name) => names.has(name) } } },
      },
      invalidateShadows() {},
    };
    // Hidden canvas (the chunk arrives well before a warm load's reveal): the
    // build takes idle time only, so the reveal's own work goes first, and
    // holds the shafts' promise until it is built.
    const hidden = createEarthGeometry(base, undefined, rendering, tour);
    const slicing = rendering.terrainSlicing;
    assert.ok(slicing instanceof Promise, "light-shafts.js sees the build");
    let released = false;
    slicing.then(() => {
      released = true;
    });
    const geometry = await hidden;
    assert.ok(geometry?.attributes.slateRoot, "it lands at once while hidden");
    assert.equal(rendering.terrainSlicing, null);
    await Promise.resolve();
    assert.ok(released, "and lets the shafts go");
    assert.ok(idles > 3, `${idles} idle slices before the reveal, none back to back`);
    // Fading in over the title card: the build rushes, slices back to back.
    names.add("is-ready");
    performance.mark("babel:reveal");
    globalThis.getComputedStyle = () => ({ transitionDuration: "60s" });
    idles = 0;
    const fading = await createEarthGeometry(base, undefined, rendering, tour);
    assert.ok(fading?.attributes.slateRoot, "it lands at once under the fade");
    assert.equal(idles, 1, "only its first slice waited for idle time");
    fading.dispose();
    // Shown and past the fade: idle slices of 2 ms where the wait timed out.
    globalThis.getComputedStyle = () => ({ transitionDuration: "0s" });
    idles = 0;
    const settled = createEarthGeometry(base, undefined, rendering, tour);
    tour.transition.cut = true; // so it lands as soon as it is built
    const later = await settled;
    assert.ok(idles > 3, `${idles} idle slices after the fade`);
    tour.transition.cut = false;
    // Disposed first: the build stops and resolves to nothing; the shafts
    // are let go.
    let gone = false;
    const cancelled = await createEarthGeometry(
      base,
      undefined,
      rendering,
      tour,
      () => gone || !(gone = true),
    );
    assert.equal(cancelled, undefined);
    assert.equal(rendering.terrainSlicing, null);
    for (const each of [geometry, later]) each.dispose();
  } finally {
    if (idle) globalThis.requestIdleCallback = idle;
    else delete globalThis.requestIdleCallback;
    if (style) globalThis.getComputedStyle = style;
    else delete globalThis.getComputedStyle;
    performance.clearMarks("babel:reveal");
  }
});

test("a terrain finished after the film scene is disposed is freed, never kept", async () => {
  let finish, stop;
  const late = new BoxGeometry();
  let freed = 0;
  late.addEventListener("dispose", () => freed++);
  const r = rig(() =>
    Promise.resolve({
      createEarthGeometry(...args) {
        stop = args[4];
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    }),
  );
  const original = r.ground.geometry;
  r.film.setActive(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stop(), false, "the build is told it may go on");
  r.film.dispose();
  assert.equal(stop(), true, "and to stop once the scene is gone");
  finish(late);
  await r.film.ready;
  assert.equal(freed, 1);
  assert.equal(r.ground.geometry, original);
  original.dispose();
  r.ground.material.dispose();
});

test("the root shading keeps full float precision beside a 16-bit index", () => {
  const base = groundBase(),
    geometry = createEarthGeometry(base),
    shade = geometry.attributes.slateRoot;
  const occlusion = geometry.attributes.slateShade;
  // Bytes or shorts move the grade's cel bands on single pixels of settled
  // soil (matched captures: up to 13 levels with bytes, 8 with shorts).
  assert.ok(shade.array instanceof Float32Array && !shade.normalized);
  // The baked occlusion too: a Float32 vec2, exactly as ROOT_SHADE holds it.
  assert.ok(
    occlusion.array instanceof Float32Array && !occlusion.normalized && occlusion.itemSize === 2,
  );
  assert.equal(occlusion.count, geometry.attributes.position.count);
  assert.ok(geometry.index.array instanceof Uint16Array, "the index stays 16-bit");
  const p = geometry.attributes.position,
    [px0, px1, pz0, pz1] = riverBounds(),
    inRiver = (x, z) => x > px0 - 0.75 && x < px1 + 0.75 && z > pz0 - 0.75 && z < pz1 + 0.75;
  let checked = 0,
    occluded = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) - TREE_FOOTING.x,
      z = -p.getY(i) - TREE_FOOTING.z;
    // The river's sub-grid points carry the lattice's occlusion where they lie
    // (as the GPU interpolates it between the fine vertices).
    if ((p.getX(i) % 0.75 || p.getY(i) % 0.75) && inRiver(p.getX(i), -p.getY(i))) {
      const lattice = rootOcclusion(p.getX(i), -p.getY(i));
      assert.ok(Math.abs(occlusion.getX(i) - lattice[0]) < 1e-6, `river ${x},${z}`);
      assert.ok(Math.abs(occlusion.getY(i) - lattice[1]) < 1e-6, `river ${x},${z}`);
      continue;
    }
    // Grid vertices near the roots (stitching fan centres stay open soil).
    if (Math.abs(x - 3) >= 15 || Math.abs(z) >= 15 || p.getX(i) % 0.75 || p.getY(i) % 0.75) {
      assert.deepEqual([occlusion.getX(i), occlusion.getY(i)], [0, 0]);
      continue;
    }
    // The vector and contact exactly as rootShade() gives them.
    const exact = rootShade(x, z, 0);
    assert.deepEqual(
      [shade.getX(i), shade.getY(i), shade.getZ(i)],
      exact.slice(0, 3).map(Math.fround),
      `${x},${z}`,
    );
    assert.deepEqual(
      [occlusion.getX(i), occlusion.getY(i)],
      rootOcclusion(p.getX(i), -p.getY(i)).map(Math.fround),
      `${x},${z}`,
    );
    if (occlusion.getX(i) > 0.5) occluded++;
    checked++;
  }
  assert.ok(checked > 1000, `${checked} root vertices`);
  assert.ok(
    occluded > 40,
    `${occluded} vertices under the trunk and arches are more than half occluded`,
  );
  geometry.dispose();
});

test("the baked root tables match a fresh bake of both tree variants", () => {
  // tools/bake-root-shade.mjs is deterministic; the tables in terrain-build.js are its output.
  const baked = bakeRootShade();
  assert.deepEqual(ROOT_RESTS, baked.rests);
  assert.deepEqual({ ...ROOT_SHADE }, baked.shade);
  assert.deepEqual(
    { cols: ROOT_COVER.cols, rows: ROOT_COVER.rows, bits: ROOT_COVER.bits },
    { cols: baked.cover.cols, rows: baked.cover.rows, bits: baked.cover.bits },
  );
  const source = readFileSync(new URL("../src/scene/terrain-build.js", import.meta.url), "utf8");
  for (const block of formatRootTables(baked).split("\nexport "))
    assert.ok(source.includes(block.replace(/^(?!export )/, "export ")), block.slice(0, 40));
  // The two variants agree closely: one table serves both.
  const [high, balanced] = baked.tiers,
    digits = (text) => Array.from(text, (ch) => SHADE_ALPHABET.indexOf(ch));
  for (const channel of ["sky", "key"]) {
    const a = digits(high[channel]),
      b = digits(balanced[channel]);
    assert.ok(Math.max(...a.map((value, i) => Math.abs(value - b[i]))) <= 8, channel);
  }
});

test("the root tables are neutral beyond the tree and leave the lantern clearing and the puddles as they were", () => {
  const { x: LX, z: LZ, pitch, cols, rows } = ROOT_LATTICE,
    digits = (text) => Array.from(text, (ch) => SHADE_ALPHABET.indexOf(ch));
  const sky = digits(ROOT_SHADE.sky),
    key = digits(ROOT_SHADE.key),
    cut = digits(ROOT_SHADE.cut);
  for (const table of [sky, key, cut]) {
    assert.equal(table.length, cols * rows);
    assert.ok(table.every((value) => value >= 0 && value <= 63));
  }
  const banks = new Map(ROOT_RESTS.map(([col, row, lift]) => [row * cols + col, lift]));
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col,
        x = LX + col * pitch,
        z = LZ + row * pitch;
      // 0 at the lattice's edge, so its values meet the untouched ground seamlessly.
      if (!row || !col || row === rows - 1 || col === cols - 1)
        assert.deepEqual(
          [sky[i], key[i], cut[i], banks.get(i) ?? 0],
          [0, 0, 0, 0],
          `${col},${row}`,
        );
      // Nothing of the banks and the contact cut reaches the pinned clearing
      // and puddles, through any fine-grid triangle; nor does the occlusion
      // reach the clearing or the puddles themselves (its own, closer puddle
      // pins: the shader keeps root occlusion off the water, slateGuard).
      if (latticeGuard(x, z) === 0)
        assert.deepEqual([cut[i], banks.get(i) ?? 0], [0, 0], `${col},${row}`);
      if (!shadeGuard(x, z)) assert.deepEqual([sky[i], key[i]], [0, 0], `${col},${row}`);
    }
  // Beyond the lattice: no occlusion, no bank, no cover.
  for (const [x, z] of [
    [0, 0],
    [LX - 1, LZ + 5],
    [LX + 5, LZ + rows * pitch + 1],
    [TREE_FOOTING.x + 30, TREE_FOOTING.z],
  ]) {
    assert.deepEqual(rootOcclusion(x, z), [0, 0]);
    assert.equal(rootBankLift(x, z), 0);
    assert.equal(rootCovered(x, z), false);
  }
  // The trunk's cavity is deeply occluded, the open plate beyond the crown barely.
  assert.ok(rootOcclusion(TREE_FOOTING.x + TRUNK[0] + 1.5, TREE_FOOTING.z + TRUNK[1])[0] > 0.6);
  assert.ok(rootOcclusion(TREE_FOOTING.x + 14, TREE_FOOTING.z - 10)[0] < 0.05);
  // The entry lips stay under the roots: none in the lantern clearing or
  // within a puddle's pinned margin; a few small ones where a sunk root leaves
  // the soil.
  assert.ok(
    ROOT_RESTS.length >= 3 &&
      ROOT_RESTS.length <= 30 &&
      ROOT_RESTS.every(([, , lift]) => lift > 0 && lift <= 0.2),
  );
  for (const [col, row] of ROOT_RESTS) {
    const x = LX + col * pitch,
      z = LZ + row * pitch;
    assert.ok(Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) > 2, `${col},${row}`);
    PUDDLE_ZONES.forEach((zone) =>
      assert.ok(zoneDistance(zone, x, z) > zone.radius + 0.75, `${col},${row}`),
    );
    assert.ok((riverRadius(x, z) - 1) * RIVER.width > 0.75, `${col},${row} by the river`);
  }
});

test("the occlusion tables ramp: no lattice edge or pinned-ground cliff reads", () => {
  // Review 2026-09-28: a hard re-zero at the pinned ground (0 to .5-.7 across
  // one lattice triangle) and the key's sharp cone drew straight light/dark
  // lattice edges. Neighbours now differ by at most 0.33 a unit (0.25 across a
  // lattice step, 0.35 across its diagonal), plus one 6-bit step.
  const { pitch, cols, rows } = ROOT_LATTICE,
    digits = (text) => Array.from(text, (ch) => SHADE_ALPHABET.indexOf(ch) / 63);
  for (const channel of ["sky", "key"]) {
    const table = digits(ROOT_SHADE[channel]);
    let steepest = 0;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++)
        for (const [a, b] of [
          [1, 0],
          [0, 1],
          [1, -1],
        ]) {
          if (col + a >= cols || row + b < 0 || row + b >= rows) continue;
          const step = Math.abs(table[row * cols + col] - table[(row + b) * cols + col + a]);
          steepest = Math.max(steepest, (step - 1 / 63) / (pitch * Math.hypot(a, b)));
        }
    assert.ok(steepest <= 0.33 + 1e-9, `${channel}: ${steepest.toFixed(3)} a unit`);
  }
  // The occlusion's puddle pins reach no further than the puddles' own zones (plus a hair).
  assert.ok(SHADE_PIN.every((margin) => margin >= 0 && margin <= 0.05));
  // The cavity under the trunk stays deep in both.
  const cavity = rootOcclusion(TREE_FOOTING.x + TRUNK[0], TREE_FOOTING.z + TRUNK[1]);
  assert.ok(cavity[0] > 0.7 && cavity[1] > 0.6, JSON.stringify(cavity));
});

// The sunk tree against the rendered soil (the knoll at the fine grid's
// vertices, linear between them, lips included) on a 0.25 grid: each
// variant's lowest root surface from 0.6 below the soil to 2 above it, as a
// gap over the soil, and its authored height above its own toe (TREE_SINK
// added back), which tells the resting roots (0.42 or less: they hung 0.3
// above the footing before the tree sank) from the arches (0.62 to 1.4).
function rootContacts(tier) {
  const probe = rootProbe(treeMesh(tier)),
    ground = latticeGround(groundBase()),
    { x: LX, z: LZ, pitch, cols, rows } = ROOT_LATTICE;
  const points = [];
  for (let z = LZ + 1; z <= LZ + (rows - 1) * pitch - 1; z += 0.25)
    for (let x = LX + 1; x <= LX + (cols - 1) * pitch - 1; x += 0.25) {
      const soil = ground.at(x, z) + rootBankLift(x, z);
      const under =
        probe(
          x - TREE_FOOTING.x,
          z - TREE_FOOTING.z,
          soil - 0.6 - ground.floor,
          soil + 2 - ground.floor,
        ) + ground.floor;
      if (!Number.isFinite(under)) continue;
      points.push({
        x,
        z,
        gap: under - soil,
        authored: under - ground.floor + TREE_SINK,
        // The lantern clearing and the puddles' margins, where the soil is pinned.
        pinned: pinDistance(x, z) < 0.5,
        // The one low toe the tree used to stand on.
        toe: Math.hypot(x - TREE_FOOTING.x - 1.85, z - TREE_FOOTING.z - 4.5) < 0.9,
      });
    }
  return points;
}

for (const tier of ["high", "balanced"])
  test(`${tier} the sunk tree's resting roots enter the soil and none hovers beyond the pinned ground`, () => {
    // Before the tree sank they hung 0.3 above the footing and soil banks
    // rose to meet them. Now each enters the knoll about 0.11 deep; within
    // the pinned lantern clearing and puddle margins the soil cannot move,
    // so a few hang there, never more than 0.2.
    const points = rootContacts(tier),
      resting = points.filter((p) => p.authored <= 0.42 && !p.toe),
      open = resting.filter((p) => !p.pinned);
    assert.ok(open.length > 100, `${open.length} resting points`);
    const hovering = open.filter((p) => p.gap > 0.03);
    assert.equal(hovering.length, 0, JSON.stringify(hovering.slice(0, 5)));
    const depths = open.map((p) => -p.gap).sort((a, b) => a - b),
      median = depths[Math.floor(depths.length / 2)];
    assert.ok(median >= 0.1 && median <= 0.16, `median entry depth ${median}`);
    assert.ok(
      resting.filter((p) => p.pinned).every((p) => p.gap <= 0.2),
      "a root over the pinned ground hangs 0.2 or more",
    );
  });

for (const tier of ["high", "balanced"])
  test(`${tier} the soil buries no root deeper than 0.2 but the toe, and the arches stay open`, () => {
    // Every tree vertex near the soil. The deepest, but for the toe, is the
    // north-east root's low point by the trunk, authored 0.24 above the toe.
    const { positions } = treeMesh(tier),
      ground = latticeGround(groundBase()),
      { x: LX, z: LZ, pitch, cols, rows } = ROOT_LATTICE;
    let checked = 0,
      lipped = 0,
      deepest = 0,
      toe = 0,
      lowest = Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      lowest = Math.min(lowest, positions[i + 1]);
      const x = positions[i] + TREE_FOOTING.x,
        z = positions[i + 2] + TREE_FOOTING.z;
      if (x < LX || z < LZ || x > LX + (cols - 1) * pitch || z > LZ + (rows - 1) * pitch) continue;
      const soil = ground.at(x, z),
        y = positions[i + 1] + ground.floor,
        lip = rootBankLift(x, z);
      if (y > soil + 1.3) continue;
      checked++;
      if (Math.hypot(x - TREE_FOOTING.x - 1.85, z - TREE_FOOTING.z - 4.5) < 0.9)
        toe = Math.max(toe, soil + lip - y);
      else deepest = Math.max(deepest, soil + lip - y);
      // A lip buries no root by more than 0.2 (or deeper than it already was).
      if (!lip) continue;
      lipped++;
      assert.ok(
        soil + lip - y <= Math.max(0.2, soil - y) + 1e-3,
        `${tier} root at ${x},${z} buried by ${soil + lip - y}`,
      );
    }
    // The tree stands TREE_SINK into the soil below its lowest vertex.
    assert.ok(Math.abs(lowest + TREE_SINK) < 1e-9, `lowest vertex at ${lowest}`);
    assert.ok(checked > 500 && lipped > 5, `${checked} near-soil vertices, ${lipped} over lips`);
    assert.ok(deepest <= 0.21, `${tier} a root is buried ${deepest} deep`);
    assert.ok(toe > 0.3 && toe <= TREE_SINK + 0.01, `${tier} the toe is buried ${toe} deep`);
    // Under every arch the soil stays clear of the root.
    const arches = rootContacts(tier).filter((p) => p.authored > 0.62 && p.authored <= 1.4);
    assert.ok(arches.length > 200, `${arches.length} arch points`);
    assert.ok(
      arches.every((p) => p.gap >= 0.1),
      JSON.stringify(arches.filter((p) => p.gap < 0.1).slice(0, 5)),
    );
  });

test("sparse dark litter and small grey stones lie among the roots, clear of the lantern, the puddles and the roots themselves", () => {
  const base = groundBase(),
    terrain = createEarthGeometry(base),
    surface = terrainHeight(terrain);
  const color = new Color(0x5c5048),
    litter = scatterLitter(surface, color),
    placed = litter.userData.litter;
  const { x: LX, z: LZ, pitch, cols, rows } = ROOT_LATTICE;
  assert.equal(placed.length, LITTER.count);
  const twigs = placed.filter(([, , kind]) => kind === "twig").length;
  assert.ok(twigs >= 3 && twigs <= LITTER.twigs, `${twigs} twigs`);
  assert.ok(placed.filter(([, , kind]) => kind === "pebble").length > 15);
  assert.ok(placed.filter(([, , kind]) => kind === "flake").length > 5);
  // Twigs never thinner than 0.04, so balanced does not alias them away.
  assert.ok(LITTER.minWidth >= 0.04 && LITTER.twigWidth[0] >= 0.04);
  for (const [x, z] of placed) {
    assert.ok(x > LX && z > LZ && x < LX + (cols - 1) * pitch && z < LZ + (rows - 1) * pitch);
    assert.ok(Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) >= LITTER.lantern);
    assert.equal(nearWater(x, z, LITTER.puddle), false, `litter at ${x},${z} by the water`);
    for (const zone of PUDDLE_ZONES)
      assert.ok(zoneDistance(zone, x, z) >= zone.radius + LITTER.puddle);
    assert.ok(riverRadius(x, z) >= 1 + LITTER.puddle / RIVER.width);
    assert.equal(rootCovered(x, z), false, "never under a root");
    const [sky] = rootOcclusion(x, z);
    assert.ok(
      sky >= LITTER.sky[0] && sky <= LITTER.sky[1],
      "in the roots' shade, not on the open plate",
    );
    // Beside a real root: covered soil within 0.85.
    let near = false;
    for (let dx = -0.85; dx <= 0.85 && !near; dx += 0.25)
      for (let dz = -0.85; dz <= 0.85; dz += 0.25)
        if (rootCovered(x + dx, z + dz)) {
          near = true;
          break;
        }
    assert.ok(near, `${x},${z} beside a root`);
  }
  for (let a = 0; a < placed.length; a++)
    for (let b = a + 1; b < placed.length; b++)
      assert.ok(
        Math.hypot(placed[a][0] - placed[b][0], placed[a][1] - placed[b][1]) >= LITTER.spacing,
      );
  // On the rendered ground, and dark: at most half the ground's own albedo.
  const p = litter.attributes.position,
    c = litter.attributes.color,
    litterVertices = litter.userData.litterVertices;
  for (let i = 0; i < litterVertices; i++) {
    assert.ok(
      Math.abs(p.getY(i) - surface(p.getX(i), p.getZ(i))) < 0.16,
      `litter vertex ${i} off the ground`,
    );
    assert.ok(
      c.getX(i) <= color.r * LITTER.albedo * 0.6 && c.getZ(i) <= color.b * LITTER.albedo * 0.6,
    );
  }
  assert.ok(
    litterVertices / 3 > 300 && litterVertices / 3 < 1400,
    `${litterVertices / 3} triangles`,
  );
  // The small stones: among the roots and about the trunk's base, clear of
  // the roots and arches, the lantern and the puddles, sunk part way into the
  // rendered soil, a cool grey lighter than the dark litter (the soil's mean
  // times LITTER.stones.tone).
  const S = LITTER.stones,
    stones = litter.userData.stones;
  assert.equal(stones.length, S.count);
  const mean = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  const [fineStart, fineEnd] = litter.userData.fine;
  assert.equal(fineEnd, p.count);
  const perStone = (fineStart - litterVertices) / stones.length;
  assert.equal(perStone, 240, "a smooth icosphere each");
  stones.forEach(([x, z, width], k) => {
    assert.ok(width >= S.size[0] && width <= S.size[1], `stone ${k} is ${width} wide`);
    assert.ok(x > LX && z > LZ && x < LX + (cols - 1) * pitch && z < LZ + (rows - 1) * pitch);
    assert.ok(Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) >= LITTER.lantern);
    for (const zone of PUDDLE_ZONES)
      assert.ok(zoneDistance(zone, x, z) >= zone.radius + LITTER.puddle);
    assert.ok(riverRadius(x, z) >= 1 + LITTER.puddle / RIVER.width);
    assert.equal(rootCovered(x, z), false, "never under a root or an arch");
    let among = false;
    for (let dx = -S.among; dx <= S.among && !among; dx += 0.25)
      for (let dz = -S.among; dz <= S.among; dz += 0.25)
        if (Math.hypot(dx, dz) <= S.among && rootCovered(x + dx, z + dz)) {
          among = true;
          break;
        }
    assert.ok(among, `stone ${x},${z} among the roots`);
    for (const [ox, oz] of stones.slice(k + 1))
      assert.ok(Math.hypot(ox - x, oz - z) >= S.spacing, "stones keep apart");
    let below = 0,
      above = 0;
    for (let i = litterVertices + k * perStone; i < litterVertices + (k + 1) * perStone; i++) {
      if (p.getY(i) < surface(p.getX(i), p.getZ(i))) below++;
      else above++;
      const grey = 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
      assert.ok(grey <= mean * LITTER.albedo * S.tone[1] * 1.1 && c.getZ(i) >= c.getX(i));
    }
    assert.ok(below > 0 && above > below / 2, `stone ${k} sits part way in the soil`);
  });
  // Nothing in the litter sways or leans its normal (the grass material's aGrass).
  assert.ok(litter.attributes.aGrass.array.every((value) => value === 0));
  assert.equal(litter.attributes.aGrass.count, p.count);
  // Deterministic.
  assert.deepEqual(scatterLitter(surface, color).attributes.position.array, p.array);
  litter.dispose();
  terrain.dispose();
});

test("the fine litter (leaves, clods, grit) lies on the foreground soil, never under a root or in the water", () => {
  const base = groundBase(),
    terrain = createEarthGeometry(base),
    surface = terrainHeight(terrain);
  const color = new Color(0x5c5048),
    litter = scatterLitter(surface, color),
    F = LITTER.fine;
  const [start, end] = litter.userData.fine,
    p = litter.attributes.position,
    c = litter.attributes.color;
  // All of them found room; every piece is a leaf (8 triangles) or a rounded
  // dome (PEBBLE_DOME: 3 triangles a side), smooth-shaded so none reads as a
  // faceted pyramid.
  const pieces = litter.userData.finePieces,
    wanted = F.counts.leaves + F.counts.clods + F.counts.gravel;
  assert.equal(pieces.length, wanted);
  assert.equal(pieces[0], start);
  const lift = Math.max(F.leafSize[1] * 0.4, F.clod[1]) + 0.02,
    n = litter.attributes.normal;
  let domes = 0;
  pieces.forEach((first, k) => {
    const end = pieces[k + 1] ?? litter.userData.fine[1],
      count = end - first;
    assert.ok(count === 24 || count === PEBBLE_DOME.sides * 9, `piece ${k} has ${count} vertices`);
    if (count !== 24) domes++;
    let x = 0,
      z = 0;
    for (let i = first; i < end; i++) {
      x += p.getX(i) / count;
      z += p.getZ(i) / count;
      // Smooth-shaded: unit normals, none pointing into the soil.
      assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-4);
      assert.ok(n.getY(i) >= 0, `vertex ${i} faces into the soil`);
    }
    assert.equal(rootCovered(x, z), false, `piece at ${x},${z} under a root`);
    assert.ok(riverRadius(x, z) > 1, "never in the river");
    for (let i = first; i < end; i++) {
      const y = surface(p.getX(i), p.getZ(i));
      if (Number.isFinite(y)) assert.ok(Math.abs(p.getY(i) - y) < lift, `vertex ${i} off the soil`);
      // Never brighter than a dull, damp brown or a pale grain of grit.
      assert.ok(Math.max(c.getX(i), c.getY(i), c.getZ(i)) < 0.25);
    }
  });
  assert.equal(domes, F.counts.clods + F.counts.gravel);
  litter.dispose();
  terrain.dispose();
});

test("the streams restate the ground shader's: rills off the roots gather into a creek that pours into the river", () => {
  for (const key of ["courses", "step", "meander", "flow", "current", "foam"])
    assert.deepEqual(STREAMS[key], SLATE_STREAMS[key], key);
  assert.deepEqual(STREAM_LINES, streamLines(), "sampled alike");
  const creek = STREAMS.courses.filter(({ path }) => {
    const [mx, mz] = path.at(-1);
    return riverRadius(LANTERN_FOOT.x + mx, LANTERN_FOOT.z + mz) < 1;
  });
  assert.equal(creek.length, 1, "one course pours into the river");
  for (const { path, width } of STREAMS.courses) {
    const [hx, hz] = path[0],
      [mx, mz] = path.at(-1);
    assert.ok(
      riverRadius(LANTERN_FOOT.x + hx, LANTERN_FOOT.z + hz) > 1.5,
      "its head is up by the roots",
    );
    assert.ok(width[1] > width[0], "it widens downstream");
    if (path === creek[0].path) continue;
    // A rill's mouth lies on the creek's head.
    assert.deepEqual([mx, mz], creek[0].path[0], "a rill feeds the creek");
    assert.ok(width[1] < creek[0].width[0], "narrower than the creek it feeds");
  }
  assert.ok(streamDistance(LANTERN_FOOT.x, LANTERN_FOOT.z) > 0.3, "clear of the lantern's foot");
});

test("the river's rushes stand in clumps on its banks near the lantern, clear of its image, and sway from their feet", () => {
  const base = groundBase(),
    terrain = createEarthGeometry(base),
    surface = terrainHeight(terrain);
  const rushes = plantRushes(surface),
    p = rushes.attributes.position,
    grass = rushes.attributes.aGrass;
  assert.equal(rushes.userData.clumps, RUSHES.clumps);
  assert.ok(p.count > RUSHES.clumps * RUSHES.stems[0] * 8);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getZ(i);
    assert.ok(riverRadius(x, z) > 0.98, `rush vertex ${i} stands in the water`);
    assert.ok(Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) > RUSHES.lantern - 0.4);
    assert.ok(p.getY(i) >= surface(x, z) - 0.05 - 1e-6);
    assert.ok(grass.getX(i) >= 0 && grass.getX(i) <= RUSHES.height[1] * RUSHES.sway + 1e-6);
    // On a bank within RUSHES.reach of where the river passes the lantern, but
    // never within RUSHES.clear of it, where the lantern and its image stand
    // between the banks (a clump's spread and lean may carry a stem a little).
    const along = riverAt(x, z).s - RIVER_NEAR;
    assert.ok(Math.abs(along) > RUSHES.clear - 0.6, `rush ${along} along from the lantern`);
    assert.ok(Math.abs(along) < RUSHES.reach + 0.6, `rush ${along} along from the lantern`);
    assert.ok(riverRadius(x, z) < RUSHES.bank[1] + 0.6, "on the bank");
  }
  assert.deepEqual(plantRushes(surface).attributes.position.array, p.array);
  rushes.dispose();
  terrain.dispose();
});

test("the drips' clock advances by bounded frame steps only while the scene animates, and starts calm", () => {
  const uniform = { value: 0 };
  let held = false;
  const clock = dripClock(uniform, () => held);
  clock.reset();
  assert.equal(uniform.value, DRIP_RIPPLES.start);
  clock.tick(1000);
  assert.equal(uniform.value, DRIP_RIPPLES.start, "the first frame only starts the clock");
  clock.tick(1016);
  assert.ok(Math.abs(uniform.value - DRIP_RIPPLES.start - 0.016) < 1e-9);
  clock.tick(1216);
  assert.ok(
    Math.abs(uniform.value - DRIP_RIPPLES.start - 0.116) < 1e-9,
    "a slow frame counts at most 0.1 s",
  );
  clock.tick(6216);
  assert.ok(
    Math.abs(uniform.value - DRIP_RIPPLES.start - 0.116) < 1e-9,
    "a hold just ended or a hidden page adds nothing",
  );
  const frozen = uniform.value;
  held = true;
  for (let t = 6232; t < 9000; t += 16) clock.tick(t);
  assert.equal(uniform.value, frozen, "frozen under reduced motion, a visitor pause or a panel");
  held = false;
  clock.tick(9016);
  assert.ok(uniform.value - frozen <= 0.1 + 1e-9);
  // A drip every 4-9 s: one per cell, landing within +-jitter/2 of its middle;
  // its rings live DRIP_RIPPLES.life. The clock starts after cell 0's rings
  // have died and before cell 1's drip can land.
  const { cell, jitter, life, start } = DRIP_RIPPLES;
  assert.deepEqual([cell - jitter, cell + jitter], [4, 9]);
  assert.ok(0.5 * cell + jitter / 2 + life < start && start < 1.5 * cell - jitter / 2);
  assert.ok(DRIP_RIPPLES.speed === 0.35 && life <= 2.8);
  // Gentler than the prototype's slicing rings (slope .08): the mirrored flame wobbles.
  assert.ok(
    DRIP_RIPPLES.maxTilt <= 0.02 &&
      DRIP_RIPPLES.slope[0] <= 0.02 &&
      DRIP_RIPPLES.slope[1] < DRIP_RIPPLES.slope[0],
  );
});

test("one drip lives at a time, 4-9 s apart, and those into the river fall near the lantern and its image", () => {
  const { cell, life, aim, inside } = DRIP_RIPPLES,
    [west, north] = PUDDLE_ZONES;
  const births = [],
    zones = [0, 0, 0];
  let previous = null;
  for (let t = 0; t < 400 * cell; t += 0.05) {
    const drip = dripAt(t);
    if (!drip) {
      previous = null;
      continue;
    }
    const [x, z, age, n] = drip;
    assert.ok(age >= 0 && age <= life);
    if (previous !== n) {
      births.push(t - age);
      const river = riverAt(x, z),
        i = river.r < 1 ? 0 : zoneDistance(west, x, z) < west.radius ? 1 : 2;
      if (i)
        assert.ok(
          zoneDistance([west, north][i - 1], x, z) < [west, north][i - 1].radius * 0.5,
          `drip ${n} inside its puddle`,
        );
      else
        assert.ok(
          river.r < 0.6 && Math.abs(river.s - RIVER_NEAR) < 4,
          `drip ${n} in the river near the lantern`,
        );
      zones[i]++;
    }
    previous = n;
  }
  const gaps = births.slice(1).map((t, i) => t - births[i]);
  assert.ok(
    Math.min(...gaps) >= 4 - 1e-6 && Math.max(...gaps) <= 9 + 1e-6,
    `${Math.min(...gaps)}-${Math.max(...gaps)} s`,
  );
  assert.ok(Math.min(...gaps) > life, "never two at once");
  assert.ok(
    Math.abs(zones[0] / births.length - 0.6) < 0.1 && zones[1] > 40 && zones[2] > 40,
    JSON.stringify(zones),
  );
  // Deterministic, and calm where the clock starts.
  assert.deepEqual(dripAt(123.4), dripAt(123.4));
  assert.equal(dripAt(DRIP_RIPPLES.start), null);
  // Aimed at the lantern's image when it lies well inside the water.
  const [ix, iz] = riverPoint(RIVER_NEAR),
    image = [ix + 0.3, iz - 0.2];
  assert.ok(riverRadius(...image) < inside);
  let aimed = 0;
  for (let t = 0; t < 200 * cell; t += 0.5) {
    const drip = dripAt(t, () => image),
      plain = dripAt(t);
    if (!drip) continue;
    if (riverRadius(plain[0], plain[1]) < 1) {
      const d = Math.hypot(drip[0] - image[0], drip[1] - image[1]);
      assert.ok(d >= aim[0] - 1e-9 && d <= aim[1] + 1e-9, `${d}`);
      aimed++;
    } else assert.deepEqual(drip, plain, "the drip-line puddles keep their seeded points");
  }
  assert.ok(aimed > 50);
  // An image beyond the water (another shot) leaves the seeded point.
  const outside = [LANTERN_FOOT.x, LANTERN_FOOT.z];
  assert.ok(riverRadius(...outside) > inside);
  for (let t = 0; t < 60 * cell; t += 0.5)
    assert.deepEqual(
      dripAt(t, () => outside),
      dripAt(t),
    );
  // The image: where the eye's ray to the light's mirror image meets the water.
  const light = new Vector3(LANTERN_FOOT.x, 2, LANTERN_FOOT.z),
    eye = new Vector3(LANTERN_FOOT.x - 8, 3, LANTERN_FOOT.z - 6);
  const [mx, mz] = mirrorPoint(eye, light),
    water = light.y - LANTERN_IMAGE.glow * LANTERN_IMAGE.scale + PUDDLE_MIRROR.water;
  const t = (mx - eye.x) / (light.x - eye.x);
  assert.ok(
    Math.abs(eye.y + (2 * water - light.y - eye.y) * t - water) < 1e-9 &&
      Math.abs(eye.z + (light.z - eye.z) * t - mz) < 1e-9,
  );
  assert.equal(
    mirrorPoint(new Vector3(0, water, 0), light),
    null,
    "an eye at the water sees no image",
  );
});

test("the mirrored flame takes the flame module's draught: height and lean, none without it", async () => {
  const r = linkRig({ revealed: true, parallel: false }),
    clock = frames();
  try {
    settleRoots(r.terrain, r.ground, r.rendering, r.base, () => {}, null);
    await clock.step(2);
    const shader = PHYSICAL();
    r.material.onBeforeCompile(shader);
    const camera = new PerspectiveCamera();
    camera.position.set(LANTERN_FOOT.x - 6, 3, LANTERN_FOOT.z - 6);
    camera.updateMatrixWorld();
    r.ground.onBeforeRender(null, r.root, camera);
    assert.deepEqual(shader.uniforms.slateFlame.value, [0, 0, 0, 0], "no lantern: no flame image");
    // The lantern: its light and, beside it, the flame module's root with its flicker.
    const mount = new Group(),
      light = new PointLight(),
      flame = new Group();
    mount.position.set(LANTERN_FOOT.x, 0, LANTERN_FOOT.z);
    light.position.set(0, 1.6, 0);
    flame.rotation.y = Math.PI / 2;
    flame.userData.lanternFlicker = { value: [0.95, 0.8, 0.02, 0] };
    mount.add(light, flame);
    r.root.add(mount);
    r.root.updateMatrixWorld(true);
    await new Promise((resolve) => setTimeout(resolve, 1010)); // it looks again at most once a second
    r.ground.onBeforeRender(null, r.root, camera);
    const [height, , leanX, leanZ] = shader.uniforms.slateFlame.value;
    assert.equal(height, 0.8);
    // The local lean (.02 along x) turned a quarter about y, in lantern units.
    assert.ok(
      Math.abs(leanX) < 1e-9 && Math.abs(leanZ + 0.02 / LANTERN_IMAGE.scale) < 1e-9,
      `${leanX}, ${leanZ}`,
    );
    const fragment = shader.fragmentShader;
    assert.match(
      fragment,
      /float fh = 0\.3\*max\(slateFlame\.x, \.01\)/,
      "the image's height follows the draught",
    );
    assert.match(
      fragment,
      /fx = abs\(slateLX-\(slateFlame\.z\*slateR\.z-slateFlame\.w\*slateR\.x\)\/sqrt\(slateRA\)\*fr\*fr\)/,
      "and its lean grows up the flame",
    );
    assert.match(fragment, /step\(\.01, slateFlame\.x\)/, "no flame module, no flame image");
    // The lantern's image is drawn only for rays within its bounds, and the rings only while a drip lives.
    assert.match(
      fragment,
      /if \(slateAX < \.6\+slateAA\.x && ly > -slateAA\.y && ly < 2\.5\+slateAA\.y\) \{/,
    );
    assert.match(fragment, /if \(slateDrip\.w > 0\.0\) slateG \+= slateRipples\(/);
    flame.userData.lanternFlicker = undefined;
    r.ground.onBeforeRender(null, r.root, camera);
    assert.deepEqual(
      shader.uniforms.slateFlame.value,
      [0, 0, 0, 0],
      "the flame module gone: no flame image",
    );
    r.terrain.dispose();
    r.tufts.dispose();
    r.material.dispose();
  } finally {
    clock.restore();
  }
});

test("the mirrored flame is the flame's own light as the frame shows it, after the knee, at the flame's size", () => {
  const shader = PHYSICAL(),
    material = new MeshStandardMaterial();
  configureGroundShading(material, true, { detail: { isTexture: true } });
  material.onBeforeCompile(shader);
  assert.equal(shadeSlatePuddles(shader), true);
  const fragment = shader.fragmentShader,
    at = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(+v.toFixed(4)));
  // lanternFire's width with no floor, and its fire and glass light with the
  // gain clipped at white (as the grade clamps the real flame), in the ramp's
  // hue and 1 at the core.
  assert.match(
    fragment,
    /float fw = 0\.0682\*sin\(3\.1416\*pow\(fs, \.74\)\)\*\(1\.0-\.22\*fs\), fx = /,
  );
  assert.ok(
    fragment.includes(
      `dot(min(slateFire*${LANTERN_FLAME.gain}, 1.0), vec3(.2126, .7152, .0722))/0.9994;`,
    ),
  );
  assert.match(
    fragment,
    /\*\(1\.0-\.5\*slateCone\)\*\(1\.0-\.6\*smoothstep\(\.62, 1\.0, fu\)\)\*smoothstep\(\.002, \.016, fw\)/,
    "the vapour cone, the tip fade and the thin-width fade",
  );
  // The body, MIRROR_FLAME.width of the flame's, ramps as the flame's (which
  // has no AA): only a falloff narrower than a pixel footprint widens to one.
  assert.ok(
    fragment.includes(
      `smoothstep(${at(0.3 * MIRROR_FLAME.width)}*fw-fa*.6, ${at(MIRROR_FLAME.width)}*fw+fa*.6, fx)`,
    ),
  );
  assert.ok(fragment.includes("fa = max(fp-.7*fw, 1e-4)"));
  // Its ends sit MIRROR_FLAME.inset footprints inside the flame's.
  assert.ok(
    fragment.includes(
      `fu = ((ly-0.49)/fh-${at(MIRROR_FLAME.mid)})*(1.0+${at((2 * MIRROR_FLAME.inset) / MIRROR_FLAME.span)}*fp/fh)+${at(MIRROR_FLAME.mid)}`,
    ),
  );
  // After the knee, at the knee's share of the flame's peak (its core at the lamp's light).
  const knee = fragment.indexOf("slateRefl *= slateKnee/max(slateY, 1e-5);");
  const add = fragment.indexOf(
    "slateRefl += slateFlameW*(0.5*(1.0-exp(-(slateY+slateFlamePk*slateF)/0.5))-slateKnee);",
  );
  assert.ok(
    knee > 0 && add > knee && add < fragment.indexOf("vec3 slateZoneRefl = slateRefl*slateWater;"),
  );
  // Behind the name and intro it passes the ground's text knee (mud-ground.js SLATE_WATER.text).
  assert.ok(
    fragment.includes(
      "reflectedLight.indirectSpecular += slateTextKnee(slateZoneRefl, slateBehind);",
    ),
  );
  const core = LANTERN_FLAME.color.core;
  assert.ok(
    fragment.includes(
      `slateFlamePk = ${at(0.2126 * core[0] + 0.7152 * core[1] + 0.0722 * core[2])}*slateLampY;`,
    ),
  );
  // The glass carries the flame's light with the flame module; without it, the faint glow stays.
  assert.ok(
    fragment.includes("+.02*exp(-3.0*slateGlobe*slateGlobe))*(1.0-step(.01, slateFlame.x));"),
  );
  assert.ok(fragment.includes(`*slateGlassM*step(.01, slateFlame.x)/${LANTERN_FLAME.gain};`));
  // Measured 2026-10-09 (desktop high and balanced, phone balanced, Lantern
  // study and Root and lantern, calm water, both ends of the move): the
  // image's widths at 30% and 50% of its peak are 0.9-1.1x the flame's in the
  // same frame, its peak under 0.75x.
  assert.deepEqual({ ...MIRROR_FLAME }, { width: 1, inset: 0.7, span: 0.65, mid: 0.46 });
  material.dispose();
});

test("the ground shading's clock reads the flame's own holds: reduced motion, a visitor pause and an open panel", async () => {
  const saved = {
    matchMedia: globalThis.matchMedia,
    BabelSite: globalThis.BabelSite,
    document: globalThis.document,
  };
  const state = { reduced: false, paused: false, panel: false };
  globalThis.matchMedia = (query) => ({
    get matches() {
      return query === "(prefers-reduced-motion: reduce)" && state.reduced;
    },
  });
  globalThis.BabelSite = { scene: { isVisitorPaused: () => state.paused } };
  globalThis.document = {
    body: { hasAttribute: (name) => name === "data-panel-open" && state.panel },
  };
  const r = linkRig({ revealed: true, parallel: false }),
    clock = frames();
  try {
    settleRoots(r.terrain, r.ground, r.rendering, r.base, () => {}, null);
    await clock.step(2);
    const drips = r.ground.userData.slateDrips,
      camera = new PerspectiveCamera();
    for (const hold of ["reduced", "paused", "panel"]) {
      state[hold] = true;
      const before = drips.uniform.value;
      for (let i = 0; i < 4; i++) {
        r.ground.onBeforeRender(null, r.root, camera);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.equal(drips.uniform.value, before, hold);
      state[hold] = false;
    }
    const before = drips.uniform.value;
    for (let i = 0; i < 3; i++) {
      r.ground.onBeforeRender(null, r.root, camera);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(drips.uniform.value > before && drips.uniform.value - before <= 0.3, "running again");
    r.terrain.dispose();
    r.tufts.dispose();
    r.material.dispose();
  } finally {
    clock.restore();
    for (const [name, value] of Object.entries(saved))
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
  }
});

test("the puddle mirror's restated constants follow their sources", async () => {
  // The zones (SLATE_PUDDLES as estatePoint() places them) and the lantern.
  assert.deepEqual(LANTERN_FOOT, estateLantern());
  SLATE_PUDDLES.zones.forEach((zone, i) => {
    const point = estatePoint(zone.anchor, zone.deg, zone.dist),
      mine = PUDDLE_ZONES[i];
    assert.ok(Math.abs(mine.x - point.x) < 1e-9 && Math.abs(mine.z - point.z) < 1e-9);
    assert.equal(mine.radius, zone.radius);
    assert.equal(mine.stretch, zone.stretch ?? 1);
    assert.ok(Math.abs((Math.atan2(mine.s, mine.c) * 180) / Math.PI - (zone.along ?? 0)) < 1e-9);
  });
  // The reflected sky: the terrain horizon and the puddles' zenith.
  assert.deepEqual(
    PUDDLE_MIRROR.horizon,
    TERRAIN_HORIZON.match(/[\d.]+/g)
      .slice(1)
      .map(Number),
  );
  assert.deepEqual(PUDDLE_MIRROR.zenith, SLATE_PUDDLES.zenith);
  // The drip-line puddles keep SLATE_PUDDLES' roughness and gain; only the lantern's gives up GGX.
  assert.deepEqual([SLATE_PUDDLES.roughness, SLATE_PUDDLES.specular], [0.12, 4]);
  assert.ok(PUDDLE_MIRROR.ggxKeep < 1 && PUDDLE_MIRROR.f0 === 0.02);
  // The lantern as drawn: 1.98 tall from its 2.48 authoring height; its light
  // at the GLB's luminous centre (both variants).
  assert.equal(LANTERN_IMAGE.scale, 1.98 / LANTERN_AUTHORING_HEIGHT);
  for (const tier of ["high", "balanced"]) {
    const { json } = parseGlb(modelBytes("lantern", tier));
    const { luminousCenter, authoredHeight } = json.scenes[json.scene ?? 0].extras.lantern;
    assert.equal(authoredHeight, LANTERN_AUTHORING_HEIGHT);
    assert.ok(Math.abs(luminousCenter[1] - LANTERN_IMAGE.glow) < 1e-4);
  }
  // The reflected flame matches the flame module's v3 profile: the foot, the
  // height at rest, the widest half-width, the gain and the colours of
  // lantern-flame.js's FLAME export (the v3 flame is integrated, so the export
  // must exist: a missing export fails here rather than falling back to
  // restated numbers), and lanternFire's light held in the glass, read from its
  // source (GLASS and the halo and glare it draws; the chunk exports no more).
  const flame = await import("../src/scene/lantern-flame.js");
  assert.ok(flame.FLAME, "lantern-flame.js exports the v3 FLAME profile");
  const { glass, ...profile } = LANTERN_FLAME;
  assert.deepEqual(profile, {
    base: flame.FLAME.base,
    height: flame.FLAME.height,
    halfWidth: flame.FLAME.halfWidth,
    gain: flame.FLAME.gain,
    color: flame.FLAME.color,
  });
  const flameSource = readFileSync(
    new URL("../src/scene/lantern-flame.js", import.meta.url),
    "utf8",
  );
  const [halo, fill, glare] = flameSource
    .match(/const GLASS = \{\s*halo: ([\d.]+),\s*fill: ([\d.]+),\s*rim: [\d.]+,\s*glare: ([\d.]+),/)
    .slice(1)
    .map(Number);
  const spot = (name, strength) =>
    flameSource
      .match(
        new RegExp(
          `vec2 ${name} = vec2\\(q\\.x / ([\\d.]+), \\(q\\.y - FLAME_BASE - ([\\d.]+) \\* h\\) / \\(([\\d.]+) \\* h\\)\\);\\s*(?:vec3 glass =|glass \\+=) vec3\\(([\\d., ]+)\\) \\* (?:\\()?\\$\\{n\\(GLASS\\.${strength}\\)\\}`,
        ),
      )
      .slice(1)
      .map((v, i) => (i === 3 ? v.split(",").map(Number) : Number(v)));
  const [haloShape, glareShape] = [spot("g", "halo"), spot("b", "glare")];
  assert.deepEqual(
    { ...glass },
    {
      halo: [halo, ...haloShape.slice(0, 3)],
      fill,
      glare: [glare, ...glareShape.slice(0, 3)],
      warm: haloShape[3],
      pale: glareShape[3],
    },
  );
  // The moon key the occlusion is baked along is the scene's key light.
  const index = readFileSync(new URL("../src/scene/index.js", import.meta.url), "utf8");
  const [, x, y, z] = index
    .match(/directionalPosition:\s*\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+),\s*z:\s*([\d.]+)/)
    .map(Number);
  const length = Math.hypot(x, y, z);
  assert.deepEqual(KEY_LIGHT, [x / length, y / length, z / length]);
  // The trunk occluder stands on TREE_FOOTING + TRUNK.
  const shader = PHYSICAL(),
    material = new MeshStandardMaterial();
  configureGroundShading(material, true, { detail: { isTexture: true } });
  material.onBeforeCompile(shader);
  shadeSlatePuddles(shader);
  const at = (v) => {
    const r = +v.toFixed(2);
    return Number.isInteger(r) ? r.toFixed(1) : String(r);
  };
  assert.ok(
    shader.fragmentShader.includes(
      `vec2 slateO = slateP.xz-vec2(${at(TREE_FOOTING.x + TRUNK[0])},${at(TREE_FOOTING.z + TRUNK[1])});`,
    ),
  );
  assert.ok(
    shader.fragmentShader.includes(
      `length(w.xz-vec2(${at(LANTERN_FOOT.x)},${at(LANTERN_FOOT.z)})) < .3`,
    ),
  );
  material.dispose();
});

function rig(loadTerrain) {
  const ground = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  let invalidations = 0;
  const film = createFilmScene({
    ground,
    groundHeight: () => 0,
    loadTerrain,
    skyMaterial: { uniforms: { sunColor: { value: new Color() } } },
    rendering: { setFilmTreatment() {} },
    atmosphere: { setFilmTreatment() {} },
    invalidate() {
      invalidations++;
    },
  });
  return { ground, film, invalidations: () => invalidations };
}

test("late terrain stays detached while film is inactive and restores before disposal", async () => {
  let complete;
  const r = rig(() => new Promise((resolve) => (complete = resolve)));
  const original = r.ground.geometry;
  r.film.setActive(true);
  r.film.setActive(false);
  complete({ createEarthGeometry });
  await r.film.ready;
  assert.equal(r.ground.geometry, original);
  r.film.setActive(true);
  const derived = r.ground.geometry;
  let freed = 0;
  derived.addEventListener("dispose", () => {
    freed++;
    assert.equal(r.ground.geometry, original);
  });
  r.film.dispose();
  r.film.dispose();
  assert.equal(freed, 1);
  assert.equal(r.invalidations(), 1);
  original.dispose();
  r.ground.material.dispose();
});

test("the terrain chunk is requested only when the film activates, once, and a failure keeps the borrowed ground", async () => {
  // No early request with the scene: fetched beside the reveal's own work,
  // the chunk slowed the reveal, while the sliced build still lands inside
  // the canvas's fade when it starts on activation.
  let requests = 0,
    builds = 0;
  const r = rig(() => {
    requests++;
    return Promise.resolve({
      createEarthGeometry() {
        builds++;
        return null;
      },
    });
  });
  assert.equal(requests, 0);
  r.film.setActive(true);
  r.film.setActive(false);
  r.film.setActive(true);
  await r.film.ready;
  assert.deepEqual([requests, builds], [1, 1], "one request and one build across reactivation");
  r.film.dispose();
  const failed = rig(() => Promise.reject(new Error("offline")));
  const original = failed.ground.geometry;
  failed.film.setActive(true);
  await failed.film.ready;
  assert.equal(failed.ground.geometry, original);
  failed.film.dispose();
  for (const each of [r, failed]) {
    each.ground.geometry.dispose();
    each.ground.material.dispose();
  }
  // film-scene.js holds the chunk's only import (scene-bootstrap.test.mjs).
});

test("the film's ready resolves to the root-aware ground once the roots settle", async () => {
  const r = rig(() => import("../src/scene/terrain-build.js"));
  r.film.setActive(true);
  const height = await r.film.ready;
  assert.equal(typeof height, "function");
  assert.equal(r.ground.material.userData.slateRoot, shadeSlateGround);
  assert.equal(r.invalidations(), 2, "the terrain and then its shading invalidate a paused frame");
  // On flat ground the knoll adds only its collar's dome, and the relief, the
  // crook hollows and the lips shape the soil about the tree (at a vertex,
  // exactly as built; between vertices, as rendered); open ground stays at 0.
  assert.ok(Math.abs(height(67.5, 35.25) - rootSupportHeight(67.5, 35.25, () => 0)) < 1e-6);
  for (const [x, z] of [
    [TREE_FOOTING.x + 12.1, TREE_FOOTING.z - 1.1],
    [TREE_FOOTING.x, TREE_FOOTING.z],
    [TREE_FOOTING.x + TRUNK[0], TREE_FOOTING.z + TRUNK[1]],
  ])
    assert.ok(Math.abs(height(x, z) - rootSupportHeight(x, z, () => 0)) < 0.03, `${x},${z}`);
  assert.equal(height(0, 0), 0);
  assert.equal(height(TREE_FOOTING.x + 30, TREE_FOOTING.z), 0);
  const geometry = r.ground.geometry;
  r.film.dispose();
  assert.equal(r.ground.material.userData.slateRoot, undefined, "disposal withdraws the shading");
  assert.notEqual(r.ground.geometry, geometry);
  r.ground.geometry.dispose();
  r.ground.material.dispose();
});

test("failed or disposed optional terrain retains the borrowed fallback without late allocation", async () => {
  const failed = rig(() => Promise.reject(new Error("missing chunk")));
  const original = failed.ground.geometry;
  failed.film.setActive(true);
  await failed.film.ready;
  assert.equal(failed.ground.geometry, original);
  failed.film.dispose();
  let complete,
    builds = 0;
  const late = rig(() => new Promise((resolve) => (complete = resolve)));
  late.film.setActive(true);
  late.film.dispose();
  complete({
    createEarthGeometry() {
      builds++;
    },
  });
  await late.film.ready;
  assert.equal(builds, 0);
  assert.equal(late.invalidations(), 0);
  original.dispose();
  failed.ground.material.dispose();
  late.ground.geometry.dispose();
  late.ground.material.dispose();
});
