import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");
const qualityPath = path.join(projectRoot, "src", "scene", "quality.js");

function createContext({
  search = "",
  innerWidth = 1440,
  innerHeight = 900,
  navigatorInfo = { deviceMemory: 8, hardwareConcurrency: 8 },
  matchMedia,
  canvas,
} = {}) {
  const window = {
    BabelSite: {},
    location: { search },
    innerWidth,
    innerHeight,
    navigator: navigatorInfo,
    performance: { now: () => 0 },
    matchMedia: matchMedia || (() => ({ matches: false, addEventListener() {} })),
  };
  const document = {
    createElement() {
      return (
        canvas || {
          getContext() {
            return null;
          },
        }
      );
    },
  };
  return { window, document, navigator: navigatorInfo };
}

async function loadQuality(context) {
  const source = await readFile(qualityPath, "utf8");
  vm.runInNewContext(
    source,
    {
      window: context.window,
      document: context.document,
      navigator: context.navigator,
      console,
      URLSearchParams,
    },
    { filename: qualityPath },
  );
  return context.window.BabelSite.scene;
}

test("selectSceneQualityTier resolves the full decision matrix", async () => {
  const scene = await loadQuality(createContext());
  const controls = { overrideTier: null, requestedTier: "auto", debug: false };
  const caps = { maxTextureSize: 8192, maxAnisotropy: 8 };
  const viewport = { width: 1440, height: 900 };

  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { deviceMemory: 2, hardwareConcurrency: 8 },
      viewport,
      caps,
    }),
    "low",
    "low deviceMemory drops to low",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
      viewport,
      caps: { maxTextureSize: 2048, maxAnisotropy: 8 },
    }),
    "low",
    "weak texture cap drops to low",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
      viewport,
      caps: { maxTextureSize: 8192, maxAnisotropy: 2 },
    }),
    "low",
    "weak anisotropy drops to low",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 4 },
      viewport,
      caps,
    }),
    "balanced",
    "low core count lands on balanced",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { hardwareConcurrency: 8 },
      viewport,
      caps,
      touchPrimary: true,
    }),
    "high",
    "larger touch-primary flagship hardware reaches high",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { hardwareConcurrency: 8 },
      viewport: { width: 390, height: 844 },
      caps,
      touchPrimary: true,
    }),
    "balanced",
    "touch-primary phone viewport caps at balanced for mobile thermals",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { hardwareConcurrency: 8 },
      viewport,
      caps: { maxTextureSize: 4096, maxAnisotropy: 4 },
      touchPrimary: true,
    }),
    "balanced",
    "touch-primary devices below flagship caps stay at balanced",
  );
  assert.equal(
    scene.selectSceneQualityTier({
      controls,
      navigatorInfo: { hardwareConcurrency: 8 },
      viewport: { width: 320, height: 640 },
      caps,
    }),
    "balanced",
    "tiny viewport short-side caps at balanced",
  );
  assert.equal(
    scene.selectSceneQualityTier({ controls, navigatorInfo: {}, viewport, caps }),
    "high",
    "unknown navigator + desktop viewport stays high",
  );
});

test("selectSceneQualityTier honors explicit overrides over hardware hints", async () => {
  const scene = await loadQuality(createContext());
  const tier = scene.selectSceneQualityTier({
    controls: { overrideTier: "high", requestedTier: "high", debug: false },
    navigatorInfo: { deviceMemory: 1, hardwareConcurrency: 1 },
    viewport: { width: 320, height: 320 },
    caps: { maxTextureSize: 1024, maxAnisotropy: 1 },
  });
  assert.equal(tier, "high");
});

test("readSceneQualityControls parses tier query strings and debug flag", async () => {
  const scene = await loadQuality(createContext());

  const blank = scene.readSceneQualityControls("");
  assert.equal(blank.debug, false);
  assert.equal(blank.overrideTier, null);
  assert.equal(blank.requestedTier, "auto");

  const forced = scene.readSceneQualityControls("?quality=HIGH&sceneDebug=true");
  assert.equal(forced.overrideTier, "high");
  assert.equal(forced.debug, true);

  const bogus = scene.readSceneQualityControls("?quality=potato&sceneDebug=0");
  assert.equal(bogus.overrideTier, null);
  assert.equal(bogus.requestedTier, "auto");
  assert.equal(bogus.debug, false);
});

test("quality profiles expose the postprocess tier matrix", async () => {
  const scene = await loadQuality(createContext());
  const high = scene.getSceneQualityProfile("high");
  const balanced = scene.getSceneQualityProfile("balanced");
  const low = scene.getSceneQualityProfile("low");

  assert.deepEqual(
    [
      high.postprocessGrading,
      high.postprocessBloom,
      high.postprocessVignette,
      high.postprocessGrain,
    ],
    [true, true, true, true],
  );
  assert.deepEqual(
    [
      balanced.postprocessGrading,
      balanced.postprocessBloom,
      balanced.postprocessVignette,
      balanced.postprocessGrain,
    ],
    [true, false, true, true],
  );
  assert.deepEqual(
    [low.postprocessGrading, low.postprocessBloom, low.postprocessVignette, low.postprocessGrain],
    [true, false, false, false],
  );
  assert.deepEqual(
    [high.postprocessSamples, balanced.postprocessSamples, low.postprocessSamples],
    [4, 0, 0],
    "only high multisamples the composer targets",
  );
  assert.deepEqual([high.dprCap, balanced.dprCap, low.dprCap], [1.5, 1.25, 1]);
  assert.equal("antialias" in high, false, "the renderer never multisamples the final quad");
  assert.equal(high.lighting.directionalIntensity, 3.25);
  assert.equal(high.lighting.fillIntensity, 0.46);
  assert.equal(high.lighting.practicalIntensityScale, 1.08);
  assert.equal(balanced.lighting.extraDirectional, true);
  assert.equal(balanced.lighting.practicalIntensityScale, 0.84);
  assert.equal(low.lighting.extraDirectional, false);
  assert.equal(low.lighting.practicalIntensityScale, 0.58);
  // The procedural world's particle counts and canvases are gone.
  for (const profile of [high, balanced, low]) {
    assert.equal(profile.counts, undefined);
    assert.deepEqual(Object.keys(profile.textures), ["groundSize"]);
    assert.deepEqual(Object.keys(profile.geometry).sort(), ["circleSegments", "skyHeightSegments", "skyWidthSegments"]);
  }
  assert.equal(high.postprocessSettings.contrast, 1.1);
  assert.equal(balanced.postprocessSettings.vignetteStrength, 0.1);
  assert.equal(low.postprocessSettings.grainStrength, 0);
});

test("readWebGLQualityCaps falls back when probing fails and reports parameters when it succeeds", async () => {
  const offline = await loadQuality(createContext());
  const fallback = offline.readWebGLQualityCaps({
    canvas: {
      getContext() {
        throw new Error("nope");
      },
    },
  });
  assert.equal(fallback.maxAnisotropy, 1);
  assert.equal(fallback.maxTextureSize, 0);

  const losing = {
    loseContext() {
      losing.called = true;
    },
  };
  const aniExt = { MAX_TEXTURE_MAX_ANISOTROPY_EXT: "ANI" };
  const glMock = {
    MAX_TEXTURE_SIZE: "MTS",
    getParameter(name) {
      if (name === "MTS") return 8192;
      if (name === "ANI") return 15.5;
      return 0;
    },
    getExtension(name) {
      if (name === "EXT_texture_filter_anisotropic") return aniExt;
      if (name === "WEBGL_lose_context") return losing;
      return null;
    },
  };
  const online = await loadQuality(createContext());
  const caps = online.readWebGLQualityCaps({
    canvas: {
      getContext() {
        return glMock;
      },
    },
  });
  assert.equal(caps.maxTextureSize, 8192);
  assert.equal(caps.maxAnisotropy, 16, "anisotropy is rounded to an integer");
  assert.equal(losing.called, true, "probe context is released after measurement");
});

test("composition profiles bake the removed default scene zoom", async () => {
  const scene = await loadQuality(createContext());
  const cases = [
    ["compact", { width: 900, height: 844 }, [48.52, 11.68, 74.8, 0.144]],
    ["desktop", { width: 1440, height: 900 }, [48.52, 11.68, 65.8, 0.144]],
    ["portraitPhone", { width: 390, height: 844 }, [50.32, 12.44, 72.3, 0.124]],
    ["landscapePhone", { width: 844, height: 390 }, [55.8, 10.8, 63.2, 0.144]],
    ["tabletPortrait", { width: 810, height: 1080 }, [48.52, 12.38, 71.8, 0.134]],
  ];

  for (const [name, viewport, [fov, lookAtBase, orbitBase, orbitTrim]] of cases) {
    const profile = scene.getSceneCompositionProfile(viewport);
    assert.equal(profile.name, name);
    assert.equal(profile.camera.fov, fov);
    assert.equal(profile.camera.lookAtBase, lookAtBase);
    assert.equal(profile.camera.orbitBase, orbitBase);
    assert.equal(profile.camera.orbitTrim, orbitTrim);
  }
});

test("quality governor drops to low under sustained stress and ignores invalid samples", async () => {
  const scene = await loadQuality(createContext());
  const governor = scene.createSceneQualityGovernor({ initialTier: "high" });

  for (let frame = 0; frame < 360; frame += 1) {
    governor.sample(40, frame * 40);
  }
  assert.equal(
    governor.getTier(),
    "low",
    "sustained >20ms frames walk the governor down two tiers",
  );

  assert.equal(governor.sample(-1, 0), null, "negative frame times are ignored");
  assert.equal(governor.sample(Number.NaN, 0), null, "NaN frame times are ignored");
});

function drive(governor, clock, frameMs, count, floorTier) {
  const changes = [];
  for (let frame = 0; frame < count; frame += 1) {
    clock.now += frameMs;
    const tier = governor.sample(frameMs, clock.now, floorTier);
    if (tier) changes.push({ tier, at: clock.now });
  }
  return changes;
}

test("quality governor recovers to the initial tier at a 60 Hz display floor", async () => {
  const scene = await loadQuality(createContext());
  for (const [displayMs, label] of [[1000 / 60, "60 Hz"], [1000 / 120, "120 Hz"]]) {
    const governor = scene.createSceneQualityGovernor({ initialTier: "high" });
    const clock = { now: 0 };
    const [downgrade] = drive(governor, clock, 40, 240);
    assert.equal(downgrade?.tier, "balanced");
    // 16.7 ms can never beat the former fixed 15 ms recovery threshold.
    const changes = drive(governor, clock, displayMs, 2000);
    assert.deepEqual(
      changes.map(({ tier }) => tier),
      ["high"],
      `${label} frames recover exactly once`,
    );
    assert.ok(changes[0].at - downgrade.at >= 10000, "recovery keeps its 10 s delay");
    assert.equal(governor.getTier(), "high");
  }
});

test("quality governor never recovers while frames stay beyond the display floor", async () => {
  const scene = await loadQuality(createContext());
  const governor = scene.createSceneQualityGovernor({ initialTier: "high" });
  const clock = { now: 0 };
  const changes = drive(governor, clock, 40, 3000, "balanced");
  assert.deepEqual(
    changes.map(({ tier }) => tier),
    ["balanced"],
    "a raised floor holds sustained 40 ms stress at balanced without oscillating",
  );
});

// Frame cost follows the governor's current tier, as it does on a device.
function driveCosts(governor, clock, costs, count, floorTier) {
  const changes = [];
  for (let frame = 0; frame < count; frame += 1) {
    const frameMs = costs[governor.getTier()];
    clock.now += frameMs;
    const tier = governor.sample(frameMs, clock.now, floorTier);
    if (tier) changes.push({ tier, at: clock.now });
  }
  return changes;
}

test("quality governor never reads a capped or GPU-bound steady rate as headroom", async () => {
  const scene = await loadQuality(createContext());
  for (const [costs, floorTier, expected, label] of [
    [{ high: 1000 / 30, balanced: 1000 / 30, low: 1000 / 30 }, "balanced", ["balanced"], "30 Hz cap"],
    [{ high: 1000 / 30, balanced: 1000 / 30, low: 1000 / 30 }, "low", ["balanced", "low"], "30 Hz cap"],
    [{ high: 40, balanced: 28, low: 25 }, "balanced", ["balanced"], "28 ms at balanced"],
    [{ high: 40, balanced: 28, low: 25 }, "low", ["balanced", "low"], "25 ms at low"],
    [{ high: 45, balanced: 28, low: 25 }, "balanced", ["balanced"], "45/28 ms"],
    [{ high: 33, balanced: 25, low: 22 }, "balanced", ["balanced"], "33/25 ms"],
  ]) {
    const governor = scene.createSceneQualityGovernor({ initialTier: "high" });
    const changes = driveCosts(governor, { now: 0 }, costs, 12000, floorTier);
    assert.deepEqual(
      changes.map(({ tier }) => tier),
      expected,
      `${label} with a ${floorTier} floor steps down once per tier and never climbs back`,
    );
  }
});

test("quality governor backs off and then stops recovering when the heavier tier oscillates", async () => {
  const scene = await loadQuality(createContext());
  const governor = scene.createSceneQualityGovernor({ initialTier: "high" });
  const clock = { now: 0 };
  // Balanced keeps up with a 60 Hz display; high does not.
  const costs = { high: 40, balanced: 1000 / 60, low: 1000 / 60 };
  const changes = driveCosts(governor, clock, costs, 8000, "balanced");
  assert.deepEqual(
    changes.map(({ tier }) => tier),
    ["balanced", "high", "balanced", "high", "balanced"],
  );
  const firstRecovery = changes[1].at - changes[0].at;
  const secondRecovery = changes[3].at - changes[2].at;
  assert.ok(firstRecovery >= 10000 && firstRecovery < 20000);
  assert.ok(secondRecovery >= 2 * firstRecovery - 100, "one oscillation doubles the wait");
  assert.equal(
    drive(governor, clock, 1000 / 60, 6000, "balanced").length,
    0,
    "two oscillations end recovery",
  );
  assert.equal(governor.getTier(), "balanced");
});

test("fixed-tier governor ignores samples entirely", async () => {
  const scene = await loadQuality(createContext());
  const governor = scene.createSceneQualityGovernor({ initialTier: "high", overrideTier: "low" });

  assert.equal(governor.isFixed(), true);
  assert.equal(governor.getTier(), "low");
  for (let frame = 0; frame < 600; frame += 1) {
    governor.sample(5, frame * 16);
  }
  assert.equal(governor.getTier(), "low", "a fixed tier never upgrades");
});

test("governor warmup window skips early over-budget frames before arming the streak", async () => {
  const scene = await loadQuality(createContext());
  const governor = scene.createSceneQualityGovernor({
    initialTier: "high",
    downsampleFrames: 10,
    warmupFrames: 20,
  });

  // First 30 samples (10 downsample + 20 warmup) stay in the warmup window and
  // must not count toward the downgrade streak even though every frame is slow.
  for (let frame = 0; frame < 30; frame += 1) {
    assert.equal(
      governor.sample(40, frame * 40),
      null,
      `warmup frame ${frame} should not trigger a tier change`,
    );
  }
  assert.equal(governor.getTier(), "high", "tier stays pinned to initial during warmup");
});

test("detectSaveData honors Save-Data header and prefers-reduced-data media query", async () => {
  const scene = await loadQuality(createContext());

  assert.equal(scene.detectSaveData({ navigatorInfo: {} }), false);
  assert.equal(
    scene.detectSaveData({ navigatorInfo: { connection: { saveData: true } } }),
    true,
    "connection.saveData === true flips the flag",
  );

  const prefersReduced = await loadQuality(
    createContext({
      matchMedia: (query) => ({
        matches: query === "(prefers-reduced-data: reduce)",
        addEventListener() {},
      }),
    }),
  );
  assert.equal(prefersReduced.detectSaveData({ navigatorInfo: {} }), true);
});

test("selectSceneQualityTier forces low when saveData is set", async () => {
  const scene = await loadQuality(createContext());
  const tier = scene.selectSceneQualityTier({
    controls: { overrideTier: null, requestedTier: "auto", debug: false },
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    saveData: true,
  });
  assert.equal(tier, "low");
});

test("resolveEffectiveDprCap caps every touch-primary device at 1.25", async () => {
  const scene = await loadQuality(createContext());
  const profile = scene.getSceneQualityProfile("high");

  assert.equal(
    scene.resolveEffectiveDprCap(profile, {
      touchPrimary: true,
      navigatorInfo: { hardwareConcurrency: 8 },
      caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    }),
    1.25,
    "flagship touch hardware is capped at 1.25",
  );
  assert.equal(
    scene.resolveEffectiveDprCap(profile, {
      touchPrimary: true,
      navigatorInfo: { hardwareConcurrency: 4 },
      caps: { maxTextureSize: 4096, maxAnisotropy: 4 },
    }),
    1.25,
    "unknown deviceMemory + weaker touch hardware is capped at 1.25",
  );
  assert.equal(
    scene.resolveEffectiveDprCap(profile, {
      touchPrimary: true,
      navigatorInfo: { deviceMemory: 8 },
    }),
    1.25,
    "known deviceMemory is capped at 1.25 too",
  );
  assert.equal(
    scene.resolveEffectiveDprCap(profile, { touchPrimary: false, navigatorInfo: {} }),
    1.5,
    "desktop devices keep the base cap",
  );
  assert.equal(
    scene.resolveEffectiveDprCap(scene.getSceneQualityProfile("balanced"), { touchPrimary: false }),
    1.25,
  );
  assert.equal(
    scene.resolveEffectiveDprCap({ dprCap: 1 }, { touchPrimary: true, navigatorInfo: {} }),
    1,
    "base cap below 1.25 wins",
  );
});

test("getSceneCompositionProfile picks the right profile across device classes", async () => {
  const scene = await loadQuality(createContext());

  // Phone portrait (iPhone 14): 390x844.
  assert.equal(scene.getSceneCompositionProfile({ width: 390, height: 844 }).name, "portraitPhone");
  // Phone landscape (iPhone 14 rotated): 844x390.
  assert.equal(
    scene.getSceneCompositionProfile({ width: 844, height: 390 }).name,
    "landscapePhone",
  );
  // Tablet portrait (iPad): 810x1080.
  assert.equal(
    scene.getSceneCompositionProfile({ width: 810, height: 1080 }).name,
    "tabletPortrait",
  );
  // Tablet landscape (iPad rotated): 1080x810 — wider than compact threshold only
  // for very large tablets, so this falls into compact framing.
  assert.equal(scene.getSceneCompositionProfile({ width: 1080, height: 810 }).name, "compact");
  // Small laptop: 1280x800.
  assert.equal(scene.getSceneCompositionProfile({ width: 1280, height: 800 }).name, "desktop");
  // Desktop: 1920x1080.
  assert.equal(scene.getSceneCompositionProfile({ width: 1920, height: 1080 }).name, "desktop");
});

test("landscapePhone and tabletPortrait profiles carry touch-friendly framing", async () => {
  const scene = await loadQuality(createContext());
  const landscape = scene.getSceneCompositionProfile({ width: 844, height: 390 });
  const tablet = scene.getSceneCompositionProfile({ width: 810, height: 1080 });

  assert.equal(tablet.name, "tabletPortrait");
  assert.ok(
    landscape.camera.heightBase > 21,
    "short landscape framing raises the camera enough to keep the tower composed",
  );
  assert.ok(
    landscape.camera.orbitBase < 65,
    "short landscape framing moves closer instead of shrinking the tower",
  );
});

test("createSceneQualityState exposes profile, governor, and live sample handoff", async () => {
  const context = createContext({ search: "?quality=auto", innerWidth: 1440, innerHeight: 900 });
  const scene = await loadQuality(context);

  const state = scene.createSceneQualityState({
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    touchPrimary: false,
  });

  assert.equal(state.initialTier, "high");
  assert.equal(state.getTier(), "high");
  assert.equal(state.getProfile().dprCap, 1.5);
  assert.equal(state.getProfile().postprocessSamples, 4);

  // Warmup: first 59 frames return null regardless (streak check gated on a full sample window).
  for (let frame = 0; frame < 59; frame += 1) {
    assert.equal(state.sample(40, frame * 40), null);
  }
  // Streak builds once the window fills — 120 consecutive over-budget frames trigger one step down.
  let downgrade = null;
  for (let frame = 59; frame < 360 && !downgrade; frame += 1) {
    downgrade = state.sample(40, frame * 40);
  }
  assert.ok(downgrade, "governor returns the downgraded profile once the streak is complete");
  assert.equal(state.getTier(), "balanced");
  assert.equal(downgrade.dprCap, 1.25);
  assert.equal(downgrade.postprocessSamples, 0);
});

function driveRevealed(state, clock, frameMs, count, profile) {
  const steps = [];
  let current = profile;
  for (let frame = 0; frame < count; frame += 1) {
    clock.now += frameMs;
    const next = state.sampleRevealed({
      frameMs,
      nowMs: clock.now,
      timestamp: clock.now,
      profile: current,
    });
    if (!next) continue;
    current = next;
    steps.push({ tier: next.tier, dprCap: state.resolveDprCap(next), governor: state.getTier() });
  }
  return { steps, profile: current };
}

test("a revealed scene's low step lowers only the pixel ratio, and recovery restores it", async () => {
  const scene = await loadQuality(createContext());
  const options = {
    navigatorInfo: { hardwareConcurrency: 8 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 16 },
    saveData: false,
  };
  const phone = scene.createSceneQualityState({
    ...options,
    viewport: { width: 390, height: 844 },
    touchPrimary: true,
  });
  assert.equal(phone.initialTier, "balanced");
  const clock = { now: 0 };
  const start = phone.getProfile();
  assert.equal(phone.resolveDprCap(start), 1.25);

  const pressure = driveRevealed(phone, clock, 40, 600, start);
  assert.deepEqual(pressure.steps, [{ tier: "balanced", dprCap: 1, governor: "low" }]);
  assert.equal(pressure.profile, start, "the visuals keep the current profile");
  assert.equal(phone.resolveDprCap(phone.getProfile("balanced")), 1, "a resize keeps the relief");

  const recovered = driveRevealed(phone, clock, 1000 / 60, 1200, pressure.profile);
  assert.deepEqual(recovered.steps, [{ tier: "balanced", dprCap: 1.25, governor: "balanced" }]);

  const desktop = scene.createSceneQualityState({
    ...options,
    viewport: { width: 1440, height: 900 },
    touchPrimary: false,
  });
  const sustained = driveRevealed(desktop, { now: 0 }, 40, 900, desktop.getProfile());
  assert.deepEqual(sustained.steps, [
    { tier: "balanced", dprCap: 1.25, governor: "balanced" },
    { tier: "balanced", dprCap: 1, governor: "low" },
  ]);
  assert.equal(sustained.profile.isLow, false, "the revealed visuals never descend to low");
});

test("revealed sampling waits three seconds after the first frame and after each hold", async () => {
  const scene = await loadQuality(createContext());
  const state = scene.createSceneQualityState({
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    touchPrimary: false,
    saveData: false,
  });
  const profile = state.getProfile();
  const firstStep = (from, holdAt = null) => {
    for (let timestamp = from; timestamp < from + 20000; timestamp += 40) {
      if (timestamp === holdAt) state.holdSampling();
      if (state.sampleRevealed({ frameMs: 40, nowMs: timestamp, timestamp, profile })) {
        return timestamp - from;
      }
    }
    return null;
  };
  // 3 s held, then a 60-sample window, 60 warm-up samples and a 120-frame streak.
  const unheld = 240 * 40;
  assert.equal(firstStep(0), 3000 + unheld - 40);

  const held = scene.createSceneQualityState({
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    touchPrimary: false,
    saveData: false,
  });
  let sampled = 0;
  for (let timestamp = 0; timestamp < 6000; timestamp += 40) {
    if (timestamp === 4000) held.holdSampling();
    const before = held.governor.getAverageFrameTime();
    held.sampleRevealed({ frameMs: 40 + timestamp / 1000, nowMs: timestamp, timestamp, profile });
    if (held.governor.getAverageFrameTime() !== before) sampled += 1;
  }
  // Sampled from 3000 ms until the hold at 4000 ms; the next 3 s are skipped.
  assert.equal(sampled, 25);
});

test("skipped samples leave the governor untouched for exactly that many frames", async () => {
  const scene = await loadQuality(createContext());
  const state = scene.createSceneQualityState({
    navigatorInfo: { deviceMemory: 8, hardwareConcurrency: 8 },
    viewport: { width: 1440, height: 900 },
    caps: { maxTextureSize: 8192, maxAnisotropy: 8 },
    touchPrimary: false,
    saveData: false,
  });
  const profile = state.getProfile();
  const skipped = [];
  for (let timestamp = 0; timestamp < 4000; timestamp += 40) {
    // A tour capture drops the intervals its capture, cut and first dissolve frames delay.
    if (timestamp === 3400) state.skipSamples(3);
    const before = state.governor.getAverageFrameTime();
    state.sampleRevealed({ frameMs: 40 + timestamp / 1000, nowMs: timestamp, timestamp, profile });
    const unchanged = state.governor.getAverageFrameTime() === before;
    if (timestamp >= 3000 && unchanged) skipped.push(timestamp);
  }
  assert.deepEqual(skipped, [3400, 3440, 3480]);
});
