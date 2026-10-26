import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { BufferGeometry, Mesh, MeshStandardMaterial, Raycaster, ShaderLib, Vector3 } from "three";
import {
  cliffGeometry,
  coastGeometrySettings,
  coastDistance,
  fallsGeometry,
  fallsNotch,
  FALLS,
  riverFalls,
  riverRunStart,
  SHORE,
} from "../src/scene/ocean.js";
import {
  createEarthGeometry,
  filmHeight,
  LANTERN_FOOT,
  PUDDLE_ZONES,
  RIVER,
  RIVER_CHANNEL,
  RIVER_LINE,
  STREAMS,
  riverAt,
  riverChannel,
  shadeSlateGround,
  shadeSlatePuddles,
  streamRadius,
  terrainHeight,
} from "../src/scene/terrain-build.js";
import { configureGroundShading } from "../src/scene/mud-ground.js";
import { WALK, integrate, land } from "../src/scene/walk.js";
import { compactShaderSource } from "../tools/shader-compact.mjs";

function groundBase() {
  const window = {};
  Function(
    "window",
    readFileSync(new URL("../src/scene/helpers.js", import.meta.url), "utf8"),
  )(window);
  return window.BabelSite.scene.groundHeight;
}
const base = groundBase(),
  terrain = createEarthGeometry(base),
  channel = riverChannel(filmHeight(base, true)),
  height = terrainHeight(terrain),
  prefix = terrain.userData.riverBedIndexCount,
  material = new MeshStandardMaterial();
function part(start, end) {
  const geometry = new BufferGeometry();
  for (const [key, attribute] of Object.entries(terrain.attributes))
    geometry.setAttribute(key, attribute);
  geometry.setIndex(terrain.index.clone());
  geometry.setDrawRange(start, end - start);
  const mesh = new Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}
const bedMesh = part(0, prefix),
  waterMesh = part(prefix, terrain.index.count),
  ray = new Raycaster(new Vector3(), new Vector3(0, -1, 0)),
  hit = (mesh, x, z) => {
    ray.ray.origin.set(x, 60, z);
    return ray.intersectObject(mesh)[0];
  };
const inland = RIVER_LINE.filter(
  ([x, z]) => coastDistance(x, z) >= SHORE.shelf && Math.abs(x) < 191 && Math.abs(z) < 191,
);

test.after(() => {
  bedMesh.geometry.dispose();
  waterMesh.geometry.dispose();
  terrain.dispose();
  material.dispose();
});

test("the complete rendered river has a physical metre bed, a separate same-draw cap, and unchanged walking clearance", () => {
  assert.ok(inland.length > 150, "cover the whole inland course, not only the old root rectangle");
  assert.equal(terrain.groups.length, 0);
  assert.ok(prefix > 0 && prefix < terrain.index.count);
  assert.ok(terrain.userData.riverStats.bedTriangles < 80000);
  assert.ok(
    terrain.userData.riverStats.waterTriangles > 4000 &&
      terrain.userData.riverStats.waterTriangles <= RIVER_CHANNEL.waterTriangles,
  );
  let deep = 0;
  for (const [x, z] of inland) {
    const actual = hit(bedMesh, x, z),
      cap = hit(waterMesh, x, z),
      water = channel.water(x, z),
      keep = channel.keep(x, z);
    assert.ok(actual, `solid bed exists at ${x},${z}`);
    assert.ok(
      Math.abs(actual.point.y - height(x, z)) < 0.00002,
      `walk sampler follows the actual bed triangles ${x},${z}: ${actual.point.y}/${height(x, z)}`,
    );
    if (keep > 0.999) {
      assert.ok(cap, `water cap covers the course at ${x},${z}`);
      assert.ok(Math.abs(cap.point.y - water) < 0.08, `upper datum at ${x},${z}`);
      assert.ok(
        Math.abs(water - actual.point.y - channel.depth(x, z)) < 0.035,
        `physical channel depth at ${x},${z}`,
      );
      assert.ok(
        actual.point.y + WALK.eye - 0.6 - water > 1.3,
        "maximum landing dip leaves the eye above the water",
      );
      const body = { x, y: actual.point.y + 0.3, z, vx: 0, vy: -10, vz: 0, grounded: false };
      for (let tick = 0; tick < 120 && !body.grounded; tick++) {
        integrate(body, { x: 0, z: 0 }, false, 1 / 60);
        land(body, actual.point.y);
        assert.ok(body.y + WALK.eye - 0.6 > water + 1.3, "descending eye clears the water");
      }
      assert.equal(body.y, actual.point.y);
      deep++;
    }
  }
  assert.ok(deep > 150);
});

test("the upper surface has no flipped faces, gaps or overlapping folds through the rerouted bends", () => {
  const p = terrain.attributes.position,
    index = terrain.index.array;
  for (const name of ["position", "normal", "slateRiverSurface"])
    assert.ok(terrain.attributes[name].array.every(Number.isFinite), `${name} stays finite`);
  for (let i = prefix; i < index.length; i += 3) {
    const [a, b, c] = index.slice(i, i + 3),
      area =
        (p.getX(b) - p.getX(a)) * (p.getY(c) - p.getY(a)) -
        (p.getY(b) - p.getY(a)) * (p.getX(c) - p.getX(a));
    assert.ok(area > 0, "every referenced water face faces upward");
  }
  let covered = 0,
    dry = 0;
  for (let k = 1; k < RIVER_LINE.length; k++) {
    const [ax, az] = RIVER_LINE[k - 1],
      [bx, bz, station] = RIVER_LINE[k];
    // The unchanged upstream prefix has its own existing offset-strip
    // coverage. Follow the relocated bend, starting at control 10.
    const from = riverAt(LANTERN_FOOT.x + RIVER.path[10][0], LANTERN_FOOT.z + RIVER.path[10][1]).s;
    if (station < from) continue;
    if (Math.hypot(bx - LANTERN_FOOT.x, bz - LANTERN_FOOT.z) > 24) continue;
    for (const along of [0.371, 0.713]) {
      const cx = ax + (bx - ax) * along,
        cz = az + (bz - az) * along,
        at = riverAt(cx, cz);
      for (let across = -1.273; across <= 1.28; across += 0.173) {
        const x = cx - at.dz * at.w * across,
          z = cz + at.dx * at.w * across;
        ray.ray.origin.set(x, 60, z);
        const hits = ray.intersectObject(waterMesh),
          depth = channel.water(x, z) - height(x, z);
        assert.ok(hits.length <= 1, `no overlapping offset-fold at ${x},${z}`);
        // The branch has its own descending upper datum. Its join is checked
        // separately; this grid follows the broad river and both of its banks.
        if (streamRadius(x, z) < 1.8) continue;
        if (depth > 0.006) {
          assert.equal(hits.length, 1, `wet bed has continuous water at ${x},${z}`);
          covered++;
        }
        if (depth < -0.006) {
          assert.equal(hits.length, 0, "the dry inner bank is not covered by a folded water strip");
          dry++;
        }
      }
    }
  }
  assert.ok(covered > 100, `dense coverage through the new bends: ${covered}`);
  assert.ok(dry > 20, `the samples straddle both actual banks: ${dry}`);
  // Outer-bank triangles beyond the original root window remain wet too.
  // These two observed gaps cover the unchanged prefix and the moved bend.
  for (const [x, z] of [
    [33.347794693510664, 30.596246926957008],
    [42.1988365425765, 26.21808247158344],
  ]) {
    assert.ok(channel.water(x, z) - height(x, z) > 0.006, "the bank fixture is physically wet");
    ray.ray.origin.set(x, 60, z);
    assert.equal(
      ray.intersectObject(waterMesh).length,
      1,
      `continuous outer-bank water at ${x},${z}`,
    );
  }
});

test("the old foreground river is dry ground and the broad water stays six units from the lantern", () => {
  for (const [dx, dz] of [
    [-1.9, -3.9],
    [-0.6, -5.4],
    [-1.5, -7.8],
  ]) {
    const x = LANTERN_FOOT.x + dx,
      z = LANTERN_FOOT.z + dz;
    assert.equal(hit(waterMesh, x, z), undefined, `old foreground water is gone at ${dx},${dz}`);
    assert.ok(
      height(x, z) > channel.water(x, z) + 0.01,
      `dry ground replaces the old bed at ${dx},${dz}`,
    );
  }
  const p = terrain.attributes.position,
    index = terrain.index.array,
    foot = [LANTERN_FOOT.x, LANTERN_FOOT.z],
    edgeDistance = ([ax, az], [bx, bz]) => {
      const dx = bx - ax,
        dz = bz - az,
        t = Math.max(
          0,
          Math.min(1, ((foot[0] - ax) * dx + (foot[1] - az) * dz) / (dx * dx + dz * dz)),
        );
      return Math.hypot(ax + dx * t - foot[0], az + dz * t - foot[1]);
    };
  let checked = 0;
  for (let i = prefix; i < index.length; i += 3) {
    const triangle = [index[i], index[i + 1], index[i + 2]].map((v) => [p.getX(v), -p.getY(v)]);
    if (triangle.every(([x, z]) => streamRadius(x, z) < STREAMS.bed.reach[1])) continue;
    for (let k = 0; k < 3; k++)
      assert.ok(
        edgeDistance(triangle[k], triangle[(k + 1) % 3]) >= 6,
        "the main wet bank stays back from the lantern",
      );
    checked++;
  }
  assert.ok(checked > 1000, "inspect the actual main-river water faces");
  assert.ok(
    riverAt(...foot).d - RIVER.width >= 6,
    "the channel centre also keeps its near-bank clearance",
  );
});

for (const tier of ["high", "balanced"])
  test(`${tier} actual coastal bed and closed head continue the inland water without submerging a landing eye`, () => {
    const drop = riverFalls(RIVER_LINE),
      cliff = cliffGeometry(
        terrain.userData.riverCoastHeight,
        coastGeometrySettings(tier).cliff,
        undefined,
        fallsNotch(drop),
      ),
      { geometry: fall } = fallsGeometry(drop, terrain.userData.riverCoastHeight),
      cliffMesh = new Mesh(cliff, material),
      fallMesh = new Mesh(fall, material);
    cliffMesh.updateMatrixWorld(true);
    fallMesh.updateMatrixWorld(true);
    let samples = 0;
    try {
      for (const [x, z] of RIVER_LINE.filter(
        ([x, z]) => coastDistance(x, z) > 0 && coastDistance(x, z) < SHORE.shelf,
      )) {
        const highest = (hits) => hits.filter(Boolean).sort((a, b) => b.point.y - a.point.y)[0],
          solid = highest([hit(cliffMesh, x, z), hit(bedMesh, x, z)]),
          upper = highest([hit(waterMesh, x, z), hit(fallMesh, x, z)]);
        assert.ok(solid && upper, `coastal river has both rock bed and water at ${x},${z}`);
        assert.ok(
          upper.point.y - solid.point.y > 1,
          "the incoming head is a volume above its cut rock bed",
        );
        assert.ok(
          solid.point.y + WALK.eye - 0.6 > upper.point.y + 0.5,
          "actual coastal landing keeps the eye clear",
        );
        samples++;
      }
      assert.ok(samples >= 2);
    } finally {
      cliff.dispose();
      fall.dispose();
    }
  });

test("the cap uses the falls' exact fifteen head vertices and shoals to half a metre", () => {
  const drop = riverFalls(RIVER_LINE),
    { geometry: falls } = fallsGeometry(drop, terrain.userData.riverCoastHeight),
    fp = falls.attributes.position,
    p = terrain.attributes.position,
    surface = terrain.attributes.slateRiverSurface;
  try {
    for (let k = 0; k < 15; k++) {
      const [x, z] = riverRunStart(drop, (k / 14) * 2 - 1),
        top = channel.water(x, z);
      assert.ok(Math.abs(fp.getX(k) - x) < 0.00001 && Math.abs(fp.getZ(k) - z) < 0.00001);
      assert.ok(
        Math.abs(fp.getY(k) - top) < 0.00001,
        "falls head takes the upper datum, never the deep bed",
      );
      let found = false;
      for (let i = 0; i < p.count; i++)
        if (
          surface.getX(i) === 1 &&
          Math.abs(p.getX(i) - x) < 0.00001 &&
          Math.abs(-p.getY(i) - z) < 0.00001
        ) {
          assert.ok(Math.abs(p.getZ(i) - fp.getY(k)) < 0.00001);
          found = true;
          break;
        }
      assert.ok(found, "one exact shared cap/run seam");
    }
    const [x, z] = drop.lip;
    assert.ok(Math.abs(channel.depth(x, z) - 1.64) < 0.001);
    assert.ok(Math.abs(FALLS.depth - 1.64) < 0.001);
  } finally {
    falls.dispose();
  }
});

test("the lantern and puddle supports retain their exact shallow baseline", () => {
  for (const [x, z] of [
    [LANTERN_FOOT.x, LANTERN_FOOT.z],
    ...PUDDLE_ZONES.map(({ x, z }) => [x, z]),
  ]) {
    assert.equal(channel.keep(x, z), 0);
    assert.equal(channel.delta(x, z, filmHeight(base, true)(x, z)), 0);
    assert.equal(hit(waterMesh, x, z), undefined, "no water cap over protected dry support");
  }
  const far = RIVER_LINE.find(
    ([x, z]) =>
      coastDistance(x, z) > 30 &&
      Math.hypot(x - LANTERN_FOOT.x, z - LANTERN_FOOT.z) > 30 &&
      channel.keep(x, z) === 1,
  );
  assert.ok(
    Math.abs(
      filmHeight(base, true)(far[0], far[1]) -
        channel.water(far[0], far[1]) -
        (RIVER_CHANNEL.freeboard + 0.04),
    ) < 1e-8,
    "exposed far banks keep the approved freeboard",
  );
});

test("authored, procedural and compacted ground shaders use the actual surface depth and advect the whole current", () => {
  for (const authored of [false, true])
    for (const compact of [false, true]) {
      const m = new MeshStandardMaterial();
      configureGroundShading(m, true, authored ? { detail: { isTexture: true } } : undefined);
      const shader = {
        vertexShader: ShaderLib.physical.vertexShader,
        fragmentShader: ShaderLib.physical.fragmentShader,
        uniforms: {},
      };
      m.onBeforeCompile(shader);
      if (compact)
        for (const name of ["vertexShader", "fragmentShader"])
          shader[name] = compactShaderSource(shader[name]);
      assert.deepEqual(shadeSlateGround(shader), { puddles: true, shore: true, roots: true });
      assert.match(shader.vertexShader, /vSlateRiverSurface\s*=\s*slateRiverSurface/);
      assert.match(shader.fragmentShader, /slateRiverQ\.y\s*\+\s*slateFlow\s*\*\s*3\.2/);
      // Per channel, red first, as water takes up light by depth.
      assert.match(
        shader.fragmentShader,
        /vec3 riverClear\s*=\s*exp\(-riverDepth\s*\*\s*vec3\(1\.1,\s*0?\.75,\s*0?\.65\)\)/,
      );
      assert.match(shader.fragmentShader, /riverCrest/);
      assert.match(shader.fragmentShader, /riverBank/);
      assert.match(
        shader.fragmentShader,
        /normal\s*=\s*normalize\(mat3\(viewMatrix\)\s*\*\s*vec3\(0\.,1\.,0\.\)\)/,
      );
      const missing = {
        vertexShader: ShaderLib.physical.vertexShader,
        fragmentShader: ShaderLib.physical.fragmentShader,
        uniforms: {},
      };
      m.onBeforeCompile(missing);
      missing.fragmentShader = missing.fragmentShader.replace(
        "#include <clearcoat_normal_fragment_begin>",
        "",
      );
      const before = { ...missing, uniforms: { ...missing.uniforms } };
      assert.equal(shadeSlatePuddles(missing), false);
      assert.deepEqual(
        missing,
        before,
        "a missing cap-normal anchor rolls the entire water hook back",
      );
      m.dispose();
    }
});

test("cancelling actual queued river preparation frees its detached geometry before publication", async () => {
  const previousIdle = globalThis.requestIdleCallback,
    previousIndex = BufferGeometry.prototype.setIndex,
    queue = [];
  let owned = null,
    disposed = 0,
    cancelled = false;
  globalThis.requestIdleCallback = (task) => queue.push(task);
  BufferGeometry.prototype.setIndex = function (...args) {
    if (!owned) {
      owned = this;
      owned.addEventListener("dispose", () => disposed++);
    }
    return previousIndex.apply(this, args);
  };
  try {
    const pending = createEarthGeometry(
      base,
      undefined,
      {
        renderer: { domElement: { parentNode: { classList: { contains: () => true } } } },
        invalidateShadows() {
          assert.fail("cancelled geometry cannot publish");
        },
      },
      null,
      () => cancelled,
      true,
    );
    let slices = 0;
    // The real scheduler is lazy; let its import enqueue the first idle task.
    await import("../src/scene/preparation-tasks.js");
    await new Promise((resolve) => setImmediate(resolve));
    while (!owned) {
      assert.ok(queue.length && ++slices < 2000);
      queue.shift()({ didTimeout: true, timeRemaining: () => 0 });
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(queue.length, "new river work remains detached in cooperative slices");
    cancelled = true;
    while (queue.length) queue.shift()({ didTimeout: true, timeRemaining: () => 0 });
    assert.equal(await pending, undefined);
    assert.equal(disposed, 1);
  } finally {
    BufferGeometry.prototype.setIndex = previousIndex;
    if (previousIdle) globalThis.requestIdleCallback = previousIdle;
    else delete globalThis.requestIdleCallback;
  }
});
