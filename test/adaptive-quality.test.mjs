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
