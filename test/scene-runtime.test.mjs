import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import * as THREE from "three";
import { createDeferredQualityStep } from "../src/scene/runtime.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const qualitySourcePath = path.join(projectRoot, "src", "scene", "quality.js");
const visibilitySourcePath = path.join(projectRoot, "src", "scene", "visibility.js");

function createSceneContext({
  search = "",
  navigatorInfo = { deviceMemory: 8, hardwareConcurrency: 8 },
  innerWidth = 390,
  innerHeight = 844,
  localStorage = createStorageMock(),
} = {}) {
  const window = {
    BabelSite: {},
    location: { search },
    innerWidth,
    innerHeight,
    localStorage,
    navigator: navigatorInfo,
    performance: { now: () => 0 },
  };
  const document = {
    createElement() {
      return {
        getContext() {
          return null;
        },
      };
    },
  };
  return {
    window,
    document,
    localStorage,
    navigator: navigatorInfo,
    performance: window.performance,
  };
}

function createStorageMock(seed = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
  };
}

async function loadSceneScript(scriptPath, context) {
  const source = await readFile(scriptPath, "utf8");
  vm.runInNewContext(
    source,
    {
      window: context.window,
      document: context.document,
      localStorage: context.localStorage,
      navigator: context.navigator,
      performance: context.performance,
      console,
      URLSearchParams,
    },
    { filename: scriptPath },
  );
  return context.window.BabelSite.scene;
}

test("quality controls keep capable auto-tier devices on high and expose current balanced defaults", async () => {
  const context = createSceneContext({ search: "?quality=auto&sceneDebug=1" });
  const scene = await loadSceneScript(qualitySourcePath, context);

  const controls = scene.readSceneQualityControls(context.window.location.search);
  const tier = scene.selectSceneQualityTier({
    controls,
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 6 },
    viewport: { width: 390, height: 844 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
  });
  const balanced = scene.getSceneQualityProfile("balanced");

  assert.equal(controls.debug, true);
  assert.equal(controls.overrideTier, null);
  assert.equal(controls.requestedTier, "auto");
  assert.equal(tier, "high");
  assert.equal(balanced.dprCap, 1.25);
  assert.equal(balanced.textures.groundSize, 768);
  assert.equal(balanced.shadows.mapSize, 0);
});

test("quality overrides and governor transitions are deterministic", async () => {
  const context = createSceneContext({ search: "?quality=low" });
  const scene = await loadSceneScript(qualitySourcePath, context);

  const controls = scene.readSceneQualityControls(context.window.location.search);
  const forced = scene.selectSceneQualityTier({
    controls,
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 390, height: 844 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
  });
  // Disable the warmup window for this legacy deterministic trace.
  const governor = scene.createSceneQualityGovernor({ initialTier: "high", warmupFrames: 0 });

  assert.equal(forced, "low");

  for (let frame = 0; frame < 180; frame += 1) {
    governor.sample(21, frame * 16.67);
  }
  assert.equal(governor.getTier(), "balanced");

  for (let frame = 0; frame < 720; frame += 1) {
    const now = 4000 + frame * 16.67;
    governor.sample(10, now);
  }
  assert.equal(governor.getTier(), "high");
});

test("composition profiles reframe portrait phones toward the tower", async () => {
  const context = createSceneContext();
  const scene = await loadSceneScript(qualitySourcePath, context);

  const portrait = scene.getSceneCompositionProfile({ width: 390, height: 844 });
  const compact = scene.getSceneCompositionProfile({ width: 900, height: 844 });
  const desktop = scene.getSceneCompositionProfile({ width: 1440, height: 900 });

  assert.equal(portrait.name, "portraitPhone");
  assert.equal(compact.name, "compact");
  assert.equal(desktop.name, "desktop");
  assert.ok(portrait.camera.fov >= compact.camera.fov);
  assert.ok(portrait.camera.orbitBase < compact.camera.orbitBase);
  assert.ok(portrait.camera.orbitBase > desktop.camera.orbitBase);
  assert.ok(portrait.camera.lookAtBase > desktop.camera.lookAtBase);
  assert.ok(portrait.sceneOffsetY > compact.sceneOffsetY);
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a deferred quality step lands on the first tour cut after its programs are prepared", async () => {
  const prepares = [];
  const steps = createDeferredQualityStep({
    prepare: (profile) =>
      new Promise((resolve, reject) => prepares.push({ profile, resolve, reject })),
  });
  const balanced = { tier: "balanced" };
  const high = { tier: "high" };
  assert.equal(steps.pending, false);
  assert.equal(steps.take({ cut: true, running: true, nowMs: 0 }), null);

  steps.queue(balanced, 1000);
  assert.equal(steps.pending, true);
  assert.deepEqual(
    prepares.map(({ profile }) => profile),
    [balanced],
    "linking starts at once",
  );
  assert.equal(
    steps.take({ cut: false, running: true, nowMs: 1100 }),
    null,
    "a running tour waits",
  );
  assert.equal(
    steps.take({ cut: true, running: true, nowMs: 1200 }),
    null,
    "a cut waits for the programs",
  );
  prepares[0].resolve(true);
  await flush();
  assert.equal(steps.take({ cut: false, running: true, nowMs: 1300 }), null);
  assert.equal(steps.take({ cut: true, running: true, nowMs: 1400 }), balanced);
  assert.equal(steps.pending, false);
  assert.equal(steps.take({ cut: true, running: true, nowMs: 1500 }), null, "a step applies once");

  steps.queue(balanced, 2000);
  steps.queue(high, 2100);
  prepares[1].resolve(true);
  await flush();
  assert.equal(
    steps.take({ cut: true, running: true, nowMs: 2200 }),
    null,
    "a newer step replaces it",
  );
  prepares[2].reject(new Error("context lost"));
  await flush();
  assert.equal(
    steps.take({ cut: true, running: true, nowMs: 2300 }),
    high,
    "a failed link still lands",
  );

  steps.queue(balanced, 3000);
  assert.equal(
    steps.take({ cut: false, running: false, nowMs: 3001 }),
    balanced,
    "no tour, no wait",
  );

  steps.queue(high, 4000);
  assert.equal(steps.take({ cut: false, running: true, nowMs: 33999 }), null);
  assert.equal(steps.take({ cut: false, running: true, nowMs: 34000 }), high, "30 s at most");

  const throwing = createDeferredQualityStep({
    prepare() {
      throw new Error("compile failed");
    },
  });
  throwing.queue(balanced, 0);
  assert.equal(throwing.take({ cut: true, running: true, nowMs: 1 }), balanced);
});

test("visibility classification prefers front-facing systems and culls backside decor", async () => {
  const context = createSceneContext();
  const scene = await loadSceneScript(visibilitySourcePath, context);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();

  const tracker = scene.createSceneVisibilityTracker({ THREE, camera });
  tracker.updateCameraState();

  const frontBucket = tracker.classifySphere({
    center: new THREE.Vector3(0, 0, 0),
    radius: 2,
    importance: "nearAtmosphere",
  });
  const rearBucket = tracker.classifySphere({
    center: new THREE.Vector3(0, 0, 30),
    radius: 2,
    importance: "backsideDecor",
  });
  const stickyBucket = tracker.classifySphere({
    center: new THREE.Vector3(6, 0, 13),
    radius: 8,
    importance: "midAtmosphere",
    previousBucket: "midAtmosphere",
  });

  assert.equal(frontBucket, "nearAtmosphere");
  assert.equal(rearBucket, "backsideDecor");
  assert.equal(stickyBucket, "midAtmosphere");
  assert.equal(tracker.shouldUpdateBucket("backsideDecor"), false);
  assert.equal(tracker.shouldUpdateBucket("midAtmosphere"), true);
});
