import assert from "node:assert/strict";
import test from "node:test";
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Scene } from "three";
import {
  createCliff,
  coastGeometrySettings,
  cliffGeometry,
  fallsNotch,
  riverFalls,
  stackGeometry,
} from "../src/scene/ocean.js";
import {
  createEarthGeometry,
  dripClock,
  filmHeight,
  RIVER_LINE,
  settleRoots,
} from "../src/scene/terrain-build.js";
import { MIST_PARS, MIST_UNIFORMS } from "../src/scene/drifting-mist.js";
import { FLASH_GROUND } from "../src/scene/film-light.js";
import { RANGE_MIST, SEA_SINK } from "../src/scene/hill-silhouette.js";
import { configureGroundShading, SLATE_TEXT_GUARD } from "../src/scene/mud-ground.js";

const EARTH = { width: 384, subdivisions: 8 },
  base = () => 1.25,
  lib = {
    SLATE_TEXT_GUARD,
    MIST_PARS,
    MIST_UNIFORMS,
    FLASH_GROUND,
    RANGE_MIST,
    SEA_SINK,
  };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const disposalCount = (resource) => {
  let count = 0;
  resource.addEventListener("dispose", () => count++);
  return () => count;
};

function idleQueue() {
  const previous = globalThis.requestIdleCallback,
    queue = [];
  let slices = 0;
  globalThis.requestIdleCallback = (task) => queue.push(task);
  return {
    async flush(pending) {
      let complete = !pending,
        failure,
        rounds = 0;
      if (pending)
        Promise.resolve(pending).then(
          () => {
            complete = true;
          },
          (error) => {
            complete = true;
            failure = error;
          },
        );
      do {
        assert.ok(++rounds < 5000, "lazy scheduling must settle");
        await tick();
        while (queue.length) {
          assert.ok(++slices < 5000, "detached preparation settles without an animation frame");
          queue.shift()({ didTimeout: true, timeRemaining: () => 0 });
          await tick();
        }
      } while (!complete);
      if (failure) throw failure;
    },
    get slices() {
      return slices;
    },
    restore() {
      if (previous) globalThis.requestIdleCallback = previous;
      else delete globalThis.requestIdleCallback;
    },
  };
}

const renderingFor = (tier) => ({
  assetTier: tier,
  tier: tier === "high" ? "balanced" : "high",
  homeScene: new Scene(),
  renderer: { domElement: { parentNode: { classList: { contains: () => true } } } },
  lights: {},
});

for (const tier of ["high", "balanced"])
  test(`${tier} actual idle preparation owns detached coast buffers until consumed or disposed`, async () => {
    const idle = idleQueue(),
      rendering = renderingFor(tier),
      tour = { running: true, transition: { cut: false } };
    let terrain;
    try {
      let resolved = false;
      const pending = createEarthGeometry(base, EARTH, rendering, tour, () => false, true);
      pending.then(() => {
        resolved = true;
      });
      await tick();
      assert.equal(resolved, false, "the producer actually waits for cooperative preparation");
      await idle.flush(pending);
      terrain = await pending;
      assert.ok(idle.slices > 1);
      const record = terrain.userData.coastGeometry,
        cliff = record.cliff,
        stacks = record.stacks,
        cliffFreed = disposalCount(cliff),
        stacksFreed = disposalCount(stacks);
      assert.equal(record.tier, tier, "startup asset tier wins over the adaptive profile");
      assert.ok(cliff.isBufferGeometry && stacks.isBufferGeometry);
      assert.equal(
        stacks.attributes.position.count,
        coastGeometrySettings(tier).stacks.list.length *
          coastGeometrySettings(tier).stacks.sides *
          (coastGeometrySettings(tier).stacks.rings * 6 + 3),
      );
      assert.deepEqual(
        rendering.homeScene.children,
        [],
        "prepared geometry never publishes a shore or material",
      );
      terrain.dispose();
      terrain.dispose();
      assert.equal(cliffFreed(), 1);
      assert.equal(stacksFreed(), 1);
      assert.equal(record.cliff, null);
      assert.equal(record.stacks, null);
      await idle.flush();
      assert.deepEqual(rendering.homeScene.children, []);
    } finally {
      terrain?.dispose();
      idle.restore();
    }
  });

test("createCliff takes the supplied buffers only after its complete owner exists", () => {
  const settings = coastGeometrySettings("balanced"),
    drop = riverFalls(RIVER_LINE),
    height = filmHeight(base, true),
    prepared = {
      tier: "balanced",
      cliff: cliffGeometry(height, settings.cliff, 190, fallsNotch(drop)),
      stacks: stackGeometry(settings.stacks),
    },
    cliff = prepared.cliff,
    stacks = prepared.stacks,
    cliffFreed = disposalCount(cliff),
    stacksFreed = disposalCount(stacks),
    borrowed = new MeshStandardMaterial(),
    borrowedFreed = disposalCount(borrowed);
  let owner;
  try {
    assert.throws(
      () =>
        createCliff({
          prepared,
          clock: dripClock({ value: 0 }),
          lib: {
            get MIST_UNIFORMS() {
              throw new Error("uniform binding failed");
            },
          },
        }),
      /uniform binding failed/,
    );
    assert.equal(prepared.cliff, cliff, "failed construction leaves ownership with the producer");
    assert.equal(prepared.stacks, stacks);
    owner = createCliff({
      lib,
      prepared,
      clock: dripClock({ value: 0 }),
      rendering: renderingFor("high"),
      height,
      groundMaterial: borrowed,
      drop,
    });
    assert.equal(owner.mesh.geometry, cliff);
    assert.equal(owner.mesh.getObjectByName("estate-stacks").geometry, stacks);
    assert.equal(owner.mesh.material[0], borrowed);
    assert.equal(prepared.cliff, null);
    assert.equal(prepared.stacks, null);
    assert.equal(cliffFreed() + stacksFreed(), 0);
    owner.setActive(false);
    owner.setActive(true);
    owner.setActive(false);
    assert.equal(owner.mesh.geometry, cliff, "withdrawal caches the same buffers");
    assert.equal(owner.mesh.getObjectByName("estate-stacks").geometry, stacks);
    owner.dispose();
    owner = null;
    assert.equal(cliffFreed(), 1);
    assert.equal(stacksFreed(), 1);
    assert.equal(borrowedFreed(), 0, "the coast never owns the slate material");
  } finally {
    owner?.dispose();
    if (prepared.cliff) prepared.cliff.dispose();
    if (prepared.stacks) prepared.stacks.dispose();
    borrowed.dispose();
  }
});

test("actual prepared terrain hands buffers to settlement, caches withdrawal and frees the shore once", async () => {
  const idle = idleQueue(),
    oldFrame = globalThis.requestAnimationFrame,
    frames = [],
    rendering = renderingFor("balanced"),
    tour = { running: true, transition: { cut: false } },
    root = new Group(),
    original = new BoxGeometry(),
    material = new MeshStandardMaterial(),
    ground = new Mesh(original, material),
    originalFreed = disposalCount(original),
    materialFreed = disposalCount(material);
  globalThis.requestAnimationFrame = (task) => frames.push(task);
  root.add(ground);
  rendering.homeScene.add(root);
  let terrain;
  const frame = async () => {
    for (const task of frames.splice(0)) task(performance.now());
    await tick();
  };
  try {
    const pending = createEarthGeometry(base, EARTH, rendering, tour, () => false, true);
    await idle.flush(pending);
    terrain = await pending;
    const record = terrain.userData.coastGeometry,
      cliff = record.cliff,
      stacks = record.stacks,
      cliffFreed = disposalCount(cliff),
      stacksFreed = disposalCount(stacks);
    configureGroundShading(material, true, { detail: { isTexture: true } });
    const height = settleRoots(terrain, ground, rendering, base, () => {}, tour, {
      ...lib,
      originalGeometry: original,
    });
    assert.equal(record.cliff, null);
    assert.equal(record.stacks, null);
    assert.equal(ground.geometry, original);
    assert.equal(
      root.getObjectByName("estate-cliff"),
      undefined,
      "handoff alone cannot publish mid-shot",
    );
    tour.transition.cut = true;
    await frame();
    assert.equal(await height.ready, true);
    const shore = root.getObjectByName("estate-cliff");
    assert.equal(shore.geometry, cliff);
    assert.equal(shore.getObjectByName("estate-stacks").geometry, stacks);
    height.setActive(false);
    assert.equal(ground.geometry, original);
    assert.equal(root.getObjectByName("estate-cliff"), undefined);
    assert.equal(cliffFreed() + stacksFreed(), 0);
    height.setActive(true);
    await frame();
    assert.equal(
      root.getObjectByName("estate-cliff"),
      shore,
      "reactivation reuses the same complete shore owner",
    );
    terrain.dispose();
    terrain.dispose();
    await frame();
    assert.equal(
      cliffFreed(),
      1,
      "producer cleanup sees cleared keys; the shore releases its lease once",
    );
    assert.equal(stacksFreed(), 1);
    assert.equal(root.getObjectByName("estate-cliff"), undefined);
    assert.equal(ground.geometry, original);
    assert.equal(originalFreed() + materialFreed(), 0);
  } finally {
    terrain?.dispose();
    idle.restore();
    if (oldFrame) globalThis.requestAnimationFrame = oldFrame;
    else delete globalThis.requestAnimationFrame;
    original.dispose();
    material.dispose();
  }
});

test("synchronous and non-scene producers retain the terrain-only compatibility path", async () => {
  const idle = idleQueue(),
    built = [];
  try {
    built.push(createEarthGeometry(base, EARTH));
    for (const [rendering, prepareOnly] of [
      [{ renderer: {} }, true],
      [renderingFor("balanced"), false],
    ]) {
      const pending = createEarthGeometry(base, EARTH, rendering, null, () => false, prepareOnly);
      await idle.flush(pending);
      built.push(await pending);
    }
    for (const terrain of built) {
      assert.ok(terrain.isBufferGeometry);
      assert.equal(
        terrain.userData.coastGeometry,
        undefined,
        "no unused coastal cache without a real prepared-scene consumer",
      );
    }
  } finally {
    built.forEach((geometry) => geometry.dispose());
    idle.restore();
  }
});
