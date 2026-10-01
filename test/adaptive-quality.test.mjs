import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { Group } from "three";
import { createArchitectureAssetController } from "../src/scene/architecture-assets.js";
import { createEarthDetail } from "../src/scene/filmic-earth.js";
import { createSceneSubsystemRegistry } from "../src/scene/subsystem.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const canvas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage() {} }) });

async function loadQualityState() {
  const source = await readFile(new URL("../src/scene/quality.js", import.meta.url), "utf8");
  const window = { BabelSite: {}, location: { search: "" }, innerWidth: 1440, innerHeight: 900 };
  vm.runInNewContext(source, { window, document: {}, navigator: {}, URLSearchParams, console });
  return window.BabelSite.scene.createSceneQualityState({
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    touchPrimary: false,
    saveData: false,
  });
}

test("adaptive quality steps change cost settings without refetching models or terrain maps", async () => {
  const qualityState = await loadQualityState();
  const requests = [],
    restores = [];
  const load =
    (kind) =>
    (url, { signal }) =>
      new Promise((resolve) => requests.push({ kind, url, signal, resolve }));
  const registry = createSceneSubsystemRegistry();
  const architecture = registry.register(
    createArchitectureAssetController({
      loadAsset: load("model"),
      onTowerReady: () => () => {},
      onTreeReady: () => () => {},
      onRestoreTower: () => restores.push("tower"),
      onRestoreTree: () => restores.push("tree"),
    }),
  );
  // Mirrors the ground textures subsystem: the film slate's maps.
  const initialProfile = qualityState.getProfile();
  const layers = { profile: initialProfile, anisotropy: 4, createCanvas: canvas, publish() {} };
  const slate = createEarthDetail({
    ...layers,
    preset: "slate",
    loadImage: load("slate"),
    restore: () => restores.push("slate"),
  });
  registry.register({
    applyQuality(profile, context) {
      slate.applyQuality(profile, context);
    },
    dispose() {
      slate.dispose();
    },
  });

  // The scene's startup order: initial quality, film ground, first-frame live gate.
  const assetTier = qualityState.initialTier;
  const devicePixelRatio = 2;
  let profile = null;
  let pixelRatio = null;
  const applyProfile = (next) => {
    profile = next;
    pixelRatio = Math.min(devicePixelRatio, qualityState.resolveDprCap(profile));
    registry.applyQuality(profile, { pixelRatio, assetTier });
  };
  applyProfile(initialProfile);
  assert.equal(pixelRatio, 1.5);
  slate.setActive(true);
  architecture.setQuality(profile, true, { assetTier });
  requests.forEach(({ kind, resolve }) =>
    resolve(kind === "model" ? { scene: new Group() } : { width: 1024, height: 1024, close() {} }),
  );
  await flush();
  await flush();
  const settled = requests.length;
  // Models (tower, tree) and the slate (color, normal, detail).
  assert.equal(settled, 2 + 3);
  restores.length = 0;

  // Mirrors updateSceneFrame after the reveal.
  let now = 0;
  const steps = [];
  const frame = (frameMs) => {
    now += frameMs;
    const next = qualityState.sampleRevealed({ frameMs, nowMs: now, timestamp: now, profile });
    if (next) {
      applyProfile(next);
      steps.push(`${profile.tier}@${pixelRatio}`);
    }
  };
  for (let index = 0; index < 900; index += 1) frame(40);
  for (let index = 0; index < 1500; index += 1) frame(1000 / 60);

  assert.deepEqual(
    steps,
    ["balanced@1.25", "balanced@1", "balanced@1.25", "high@1.5"],
    "pressure steps down to balanced, then to 1x shading; headroom recovers both",
  );
  assert.equal(requests.length, settled, "no model or terrain map is downloaded again");
  assert.ok(requests.every(({ signal }) => !signal.aborted));
  assert.deepEqual(restores, [], "live models and bound maps are never restored away");
  registry.dispose();
});

test("scene bootstrap pins the asset tier and samples quality only after reveal", async () => {
  const index = flat(await readFile(new URL("../src/scene/index.js", import.meta.url), "utf8"));
  const textures = flat(
    await readFile(new URL("../src/scene/textures.js", import.meta.url), "utf8"),
  );

  assert.match(index, /const assetTier = qualityState\.initialTier \|\| fallbackProfile\.tier;/);
  assert.match(index, /architectureAssets\.setQuality\(state\.profile, true, \{ assetTier \}\);/);
  assert.doesNotMatch(index, /lowPower/);
  assert.match(index, /const revealed = sceneReadyMarked && cinematic\.ready;/);
  assert.match(
    index,
    /revealed && !reducedMotion && !adaptiveSteps\.pending\s*\?\s*qualityState\.sampleRevealed\?\.\(/,
  );
  assert.match(
    index,
    /if \(adaptiveProfile\) applyActiveQualityProfile\(adaptiveProfile, "adaptive"\);/,
  );
  // A step links its programs when sampled and lands on a tour cut, where the
  // crossfade's kept frame hides it; the one-off transition frames go unsampled.
  assert.match(
    index,
    /const adaptiveSteps = createDeferredQualityStep\(\{ prepare: \(profile\) => rendering\.prepareQuality\(profile\) \}\);/,
  );
  assert.match(index, /if \(sampledProfile\) adaptiveSteps\.queue\(sampledProfile, nowMs\);/);
  assert.match(
    index,
    /const adaptiveProfile = adaptiveSteps\.take\(\{ cut: transition\.cut, running: cameraTour\?\.running === true, nowMs \}\);/,
  );
  assert.match(index, /if \(transition\.capture\) qualityState\.skipSamples\?\.\(3\);/);
  const frame = index.slice(index.indexOf("function updateSceneFrame("));
  const order = [
    "qualityState.sampleRevealed?.(",
    "cameraTour?.update(",
    "const transition = cameraTour?.transition ?? TOUR_IDLE;",
    "adaptiveSteps.take(",
    "applyActiveQualityProfile(adaptiveProfile",
    "qualityState.skipSamples?.(3)",
    "rendering.postprocessPipeline.setTransition?.(transition);",
    "cinematic.apply(",
    "rendering.update();",
  ].map((anchor) => frame.indexOf(anchor));
  assert.ok(
    order.every((at) => at >= 0),
    "each frame step is wired",
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    "tour, step, capture skip, crossfade, camera, draw",
  );
  assert.doesNotMatch(index, /setFade|cameraTour\?\.fade/);
  // Each event that brings uploads or compiles restarts the sampling hold.
  for (const [label, anchor] of [
    ["intersection resume", "if (sceneVisible) {"],
    ["context restore", "onContextRestored() {"],
    ["ground readiness", "onDetailStatus(status) {"],
    ["model readiness", "onStatus(status) {"],
    ["resize", "function applySceneSize("],
    ["document resume", "const onDocumentVisibilityChange = () => {"],
    ["dialog release", "onRelease:"],
  ]) {
    const start = index.indexOf(anchor);
    assert.ok(start >= 0, label);
    assert.ok(index.slice(start, start + 160).includes("qualityState.holdSampling()"), label);
  }
  assert.match(
    textures,
    /applyQuality\(profile, context\) \{ filmMaps\.applyQuality\(profile, context\); \}/,
  );
});

// Formatting-neutral source: comment lines go, whitespace runs become one
// space with none just inside brackets, and trailing commas go, so a check
// reads the same before and after Prettier.
function flat(code) {
  return code
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/,(\s*[)\]}])/g, "$1")
    .replace(/([([]) | ([)\]])/g, "$1$2");
}
