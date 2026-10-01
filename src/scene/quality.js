(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});

  const TIER_ORDER = ["low", "balanced", "high"];
  const SCENE_COMPOSITION_PROFILES = {
    compact: {
      camera: {
        fov: 48.52,
        heightBase: 21.9,
        heightScrollDelta: 0.9,
        lookAtBase: 11.68,
        lookAtScrollDelta: 2.1,
        orbitBase: 74.8,
        orbitScale: 1.14,
        orbitScrollDelta: 2.4,
        orbitTrim: 0.144,
      },
      name: "compact",
      sceneOffsetY: -7.5,
    },
    desktop: {
      camera: {
        fov: 48.52,
        heightBase: 21.9,
        heightScrollDelta: 0.9,
        lookAtBase: 11.68,
        lookAtScrollDelta: 2.1,
        orbitBase: 65.8,
        orbitScale: 1.14,
        orbitScrollDelta: 2.4,
        orbitTrim: 0.144,
      },
      name: "desktop",
      sceneOffsetY: -7.5,
    },
    portraitPhone: {
      camera: {
        fov: 50.32,
        heightBase: 19.8,
        heightScrollDelta: 0.5,
        lookAtBase: 12.44,
        lookAtScrollDelta: 1.55,
        orbitBase: 72.3,
        orbitScale: 1.08,
        orbitScrollDelta: 1.7,
        orbitTrim: 0.124,
      },
      name: "portraitPhone",
      sceneOffsetY: -6.8,
    },
    // Phone rotated to landscape (~844x390). Viewport is very short, so the
    // camera pulls up and the look-at target lowers to keep the tower in the
    // frame.
    landscapePhone: {
      camera: {
        fov: 55.8,
        heightBase: 22.4,
        heightScrollDelta: 0.4,
        lookAtBase: 10.8,
        lookAtScrollDelta: 1.3,
        orbitBase: 63.2,
        orbitScale: 1.1,
        orbitScrollDelta: 1.9,
        orbitTrim: 0.144,
      },
      name: "landscapePhone",
      sceneOffsetY: -7.2,
    },
    // Tablet in portrait (iPad-class, ~810x1080). Wider than a phone but still
    // touch-primary; framing sits between portraitPhone and compact.
    tabletPortrait: {
      camera: {
        fov: 48.52,
        heightBase: 21.2,
        heightScrollDelta: 0.7,
        lookAtBase: 12.38,
        lookAtScrollDelta: 1.85,
        orbitBase: 71.8,
        orbitScale: 1.12,
        orbitScrollDelta: 2.1,
        orbitTrim: 0.134,
      },
      name: "tabletPortrait",
      sceneOffsetY: -7.2,
    },
  };
  // dprCap bounds the canvas and every composer target, so fragment cost grows
  // with its square; postprocessSamples multisamples those targets on WebGL2.
  const SCENE_QUALITY_PROFILES = {
    high: {
      dprCap: 1.5,
      anisotropy: { min: 1, max: 8 },
      textures: {
        groundSize: 1024,
      },
      geometry: {
        skyWidthSegments: 24,
        skyHeightSegments: 14,
        circleSegments: 88,
      },
      shadows: {
        enabled: true,
        mapSize: 2048,
      },
      postprocessGrading: true,
      postprocessBloom: true,
      postprocessVignette: true,
      postprocessGrain: true,
      postprocessSamples: 4,
      postprocessSettings: {
        bloomStrength: 0.2,
        celMix: 0.24,
        contrast: 1.1,
        grainStrength: 0.018,
        highlightWarmMix: 0.2,
        shadowCoolMix: 0.34,
        vignetteStrength: 0.12,
      },
      lighting: {
        fogNear: 66,
        fogFar: 154,
        ambientIntensity: 0.2,
        hemisphereIntensity: 0.62,
        directionalIntensity: 3.25,
        fillIntensity: 0.46,
        extraDirectional: true,
        practicalIntensityScale: 1.08,
      },
    },
    balanced: {
      dprCap: 1.25,
      anisotropy: { min: 1, max: 6 },
      textures: {
        groundSize: 768,
      },
      geometry: {
        skyWidthSegments: 20,
        skyHeightSegments: 12,
        circleSegments: 72,
      },
      // Mobile and slow-CPU desktops land here. Shadows are a full extra
      // render pass of every shadow-casting object each frame — big win on
      // phones to skip it entirely rather than render a low-res shadow map.
      shadows: {
        enabled: false,
        mapSize: 0,
      },
      postprocessGrading: true,
      postprocessBloom: false,
      postprocessVignette: true,
      postprocessGrain: true,
      postprocessSamples: 0,
      postprocessSettings: {
        bloomStrength: 0,
        celMix: 0.24,
        contrast: 1.08,
        grainStrength: 0.016,
        highlightWarmMix: 0.18,
        shadowCoolMix: 0.3,
        vignetteStrength: 0.1,
      },
      lighting: {
        fogNear: 64,
        fogFar: 150,
        ambientIntensity: 0.22,
        hemisphereIntensity: 0.66,
        directionalIntensity: 2.95,
        fillIntensity: 0.28,
        extraDirectional: true,
        practicalIntensityScale: 0.84,
      },
    },
  };

  function normalizeTier(value, fallback = null) {
    if (typeof value !== "string") return fallback;
    const normalized = value.toLowerCase().trim();
    if (normalized === "auto") return "auto";
    return TIER_ORDER.includes(normalized) ? normalized : fallback;
  }

  // The scene never renders the low tier: main.js and the scene keep the
  // static title card there, and a revealed scene's low step only lowers the
  // pixel ratio (createSceneQualityState). A low request reads balanced.
  function cloneProfile(tier) {
    const name = tier === "low" ? "balanced" : tier;
    const profile = SCENE_QUALITY_PROFILES[name] || SCENE_QUALITY_PROFILES.high;
    return {
      tier: name,
      dprCap: profile.dprCap,
      anisotropy: { ...profile.anisotropy },
      textures: { ...profile.textures },
      geometry: { ...profile.geometry },
      shadows: { ...profile.shadows },
      postprocessGrading: profile.postprocessGrading,
      postprocessBloom: profile.postprocessBloom,
      postprocessVignette: profile.postprocessVignette,
      postprocessGrain: profile.postprocessGrain,
      postprocessSamples: profile.postprocessSamples,
      postprocessSettings: { ...profile.postprocessSettings },
      lighting: { ...profile.lighting },
    };
  }

  function cloneCompositionProfile(name) {
    const profile = SCENE_COMPOSITION_PROFILES[name] || SCENE_COMPOSITION_PROFILES.desktop;
    return {
      camera: { ...profile.camera },
      name: profile.name,
      sceneOffsetY: profile.sceneOffsetY,
    };
  }

  function readSceneQualityControls(search = window.location?.search || "") {
    const params = new URLSearchParams(typeof search === "string" ? search : "");
    const requestedTier = normalizeTier(params.get("quality"), "auto");
    return {
      debug: params.get("sceneDebug") === "1" || params.get("sceneDebug") === "true",
      overrideTier: requestedTier && requestedTier !== "auto" ? requestedTier : null,
      requestedTier,
    };
  }

  function readWebGLQualityCaps({ canvas } = {}) {
    const fallback = { maxAnisotropy: 1, maxTextureSize: 0 };
    const probeCanvas = canvas || document.createElement("canvas");
    if (!probeCanvas || typeof probeCanvas.getContext !== "function") return fallback;

    let gl = null;
    try {
      gl =
        probeCanvas.getContext("webgl", { powerPreference: "default" }) ||
        probeCanvas.getContext("experimental-webgl");
    } catch (_err) {
      gl = null;
    }

    if (!gl) return fallback;

    let maxTextureSize = 0;
    let maxAnisotropy = 1;
    try {
      maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    } catch (_err) {
      maxTextureSize = 0;
    }

    try {
      const ext =
        gl.getExtension("EXT_texture_filter_anisotropic") ||
        gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic") ||
        gl.getExtension("MOZ_EXT_texture_filter_anisotropic");
      if (ext) {
        maxAnisotropy = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1;
      }
    } catch (_err) {
      maxAnisotropy = 1;
    }

    try {
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose && typeof lose.loseContext === "function") {
        lose.loseContext();
      }
    } catch (_err) {
      // Ignore cleanup failures from probe contexts.
    }

    return {
      maxAnisotropy: Math.max(1, Math.round(maxAnisotropy || 1)),
      maxTextureSize,
    };
  }

  // shared/webgl-probe.js reads the same limits from the context it already
  // opened. Returns null when they are unknown, so the caller probes instead.
  function qualityCapsFromProbe(capabilities) {
    const maxTextureSize = Number(capabilities?.maxTextureSize) || 0;
    if (!capabilities?.available || maxTextureSize <= 0) return null;
    return {
      maxAnisotropy: Math.max(1, Math.round(Number(capabilities.maxAnisotropy) || 1)),
      maxTextureSize,
    };
  }

  function selectSceneQualityTier({
    controls,
    navigatorInfo = {},
    viewport = {},
    caps = {},
    touchPrimary = false,
    saveData = false,
  }) {
    if (controls?.overrideTier) return controls.overrideTier;

    // Respect metered connections and explicit data-saver settings before
    // spending on the full asset load.
    if (saveData) return "low";

    const memoryLimited =
      typeof navigatorInfo.deviceMemory === "number" && navigatorInfo.deviceMemory <= 2;
    const cpuLimited = (navigatorInfo.hardwareConcurrency || 8) <= 4;
    const weakCaps = (caps.maxTextureSize || 0) < 4096 || (caps.maxAnisotropy || 1) < 4;
    const shortSide = Math.min(viewport.width || 0, viewport.height || 0);
    const longSide = Math.max(viewport.width || 0, viewport.height || 0);
    const phoneViewport = touchPrimary && shortSide > 0 && shortSide <= 500 && longSide <= 1000;

    if (memoryLimited || weakCaps) return "low";
    if (cpuLimited) return "balanced";
    if (phoneViewport) return "balanced";

    // iOS hides deviceMemory, so touch devices are judged by their viewport and
    // limits: phone-shaped viewports stay balanced for battery and thermals,
    // and larger flagship-class touch devices can reach high.
    const flagshipCaps =
      (caps.maxTextureSize || 0) >= 8192 &&
      (caps.maxAnisotropy || 1) >= 8 &&
      (navigatorInfo.hardwareConcurrency || 0) >= 6;
    if (touchPrimary && !flagshipCaps) return "balanced";

    if (shortSide > 0 && shortSide < 340) return "balanced";

    return "high";
  }

  function detectTouchPrimary() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    try {
      return window.matchMedia("(pointer: coarse)").matches === true;
    } catch (_err) {
      return false;
    }
  }

  function detectSaveData({
    navigatorInfo = typeof navigator !== "undefined" ? navigator : {},
  } = {}) {
    const connection = navigatorInfo && navigatorInfo.connection;
    if (connection && connection.saveData === true) return true;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      try {
        if (window.matchMedia("(prefers-reduced-data: reduce)").matches) return true;
      } catch (_err) {
        // Older engines without the media feature — ignore.
      }
    }
    return false;
  }

  // Every composer target renders at this ratio, so fragment work grows with
  // its square: uncapped, a 3x phone would shade nine pixels per CSS pixel.
  // Apple hides deviceMemory, so phones can't be classified by memory; touch-
  // primary devices stop at 1.25 on every tier instead.
  function resolveEffectiveDprCap(profile, { touchPrimary = false } = {}) {
    const baseCap = profile && typeof profile.dprCap === "number" ? profile.dprCap : 1;
    return touchPrimary ? Math.min(baseCap, 1.25) : baseCap;
  }

  function indexForTier(tier) {
    return Math.max(0, TIER_ORDER.indexOf(normalizeTier(tier, "high")));
  }

  function nextLowerTier(tier) {
    return TIER_ORDER[Math.max(0, indexForTier(tier) - 1)];
  }

  function nextHigherTier(tier, ceilingTier) {
    const current = indexForTier(tier);
    const ceiling = indexForTier(ceilingTier);
    return TIER_ORDER[Math.min(ceiling, current + 1)];
  }

  const ascending = (left, right) => left - right;
  // A 60 Hz display interval plus rAF jitter.
  const DISPLAY_FLOOR_MAX_MS = 17.5;
  // Frames after a resize, resume, context restore, dialog release or asset
  // commit carry uploads and shader compiles, so they are not sampled.
  const SAMPLE_HOLD_MS = 3000;

  function createSceneQualityGovernor({
    initialTier = "high",
    overrideTier = null,
    downsampleFrames = 60,
    warmupFrames = 60,
    recoveryFrames = 300,
    recoveryDelayMs = 10000,
    maxOscillations = 2,
  } = {}) {
    const stableInitialTier = normalizeTier(initialTier, "high");
    const fixedTier = normalizeTier(overrideTier, null);
    let currentTier = fixedTier || stableInitialTier;
    let highFrameStreak = 0;
    let recoveryFrameStreak = 0;
    let lastChangeMs = 0;
    let sampleCount = 0;
    let recovered = false;
    let oscillations = 0;
    const samples = [];
    const sortedSamples = [];
    let sampleSum = 0;

    function resetCounters() {
      highFrameStreak = 0;
      recoveryFrameStreak = 0;
    }

    // Samples are display intervals, not render cost, so a 60 Hz panel never
    // beats a fixed 15 ms. The window's 10th percentile is the display's own
    // interval only while frames keep up with it; under steady load it is the
    // load. Recovery counts only at a 60 Hz or faster floor: a slower one is a
    // capped or GPU-bound rate, which never shows that the heavier tier fits.
    // The threshold stays under the 20 ms downgrade line, so a tier under
    // pressure never climbs.
    function recoveryThreshold() {
      sortedSamples.length = 0;
      for (const value of samples) sortedSamples.push(value);
      sortedSamples.sort(ascending);
      const floor = Math.max(6, sortedSamples[Math.floor((sortedSamples.length - 1) * 0.1)]);
      return floor <= DISPLAY_FLOOR_MAX_MS ? Math.max(15, 1.1 * floor) : 0;
    }

    return {
      getAverageFrameTime() {
        return samples.length ? sampleSum / samples.length : 0;
      },
      getInitialTier() {
        return stableInitialTier;
      },
      getTier() {
        return currentTier;
      },
      isFixed() {
        return Boolean(fixedTier);
      },
      // floorTier bounds downgrades; the scene raises it once revealed.
      sample(frameTimeMs, nowMs = 0, floorTier = "low") {
        if (!(frameTimeMs >= 0)) return null;

        samples.push(frameTimeMs);
        sampleSum += frameTimeMs;
        sampleCount += 1;
        if (samples.length > downsampleFrames) {
          sampleSum -= samples.shift();
        }

        if (fixedTier || samples.length < downsampleFrames) {
          return null;
        }

        // Skip streak accumulation during warmup: three.js startup, texture
        // uploads, and first-frame shader compilation all front-load frame
        // cost. Counting that window against the tier causes a visible
        // cold-start downgrade within the first second on phones.
        if (sampleCount <= downsampleFrames + warmupFrames) {
          return null;
        }

        const average = sampleSum / samples.length;
        // Each recovery that is followed by another downgrade doubles the
        // next recovery's streak and delay; after maxOscillations it stops.
        const backoff = 2 ** oscillations;
        const canRecover = currentTier !== stableInitialTier && oscillations < maxOscillations;

        highFrameStreak = average > 20 ? highFrameStreak + 1 : 0;
        recoveryFrameStreak =
          canRecover && average <= recoveryThreshold() ? recoveryFrameStreak + 1 : 0;

        if (highFrameStreak >= 120 && indexForTier(currentTier) > indexForTier(floorTier)) {
          currentTier = nextLowerTier(currentTier);
          if (recovered) oscillations += 1;
          recovered = false;
          lastChangeMs = nowMs;
          resetCounters();
          return currentTier;
        }

        if (
          recoveryFrameStreak >= recoveryFrames * backoff &&
          nowMs - lastChangeMs >= recoveryDelayMs * backoff
        ) {
          currentTier = nextHigherTier(currentTier, stableInitialTier);
          recovered = true;
          lastChangeMs = nowMs;
          resetCounters();
          return currentTier;
        }

        return null;
      },
    };
  }

  function createSceneQualityState({
    navigatorInfo = navigator,
    search = window.location?.search || "",
    viewport = { width: window.innerWidth, height: window.innerHeight },
    caps = null,
    touchPrimary = detectTouchPrimary(),
    saveData = detectSaveData({ navigatorInfo }),
  } = {}) {
    const controls = readSceneQualityControls(search);
    const resolvedCaps = caps || readWebGLQualityCaps();
    const initialTier = selectSceneQualityTier({
      controls,
      navigatorInfo,
      viewport,
      caps: resolvedCaps,
      touchPrimary,
      saveData,
    });
    const governor = createSceneQualityGovernor({
      initialTier,
      overrideTier: controls.overrideTier,
    });
    // A revealed scene never steps its visuals down to low. The governor's low
    // step keeps the current profile and lowers only the pixel ratio to 1.
    let resolutionRelief = false;
    let sampleResumeAt = null;
    let skippedSamples = 0;

    return {
      caps: resolvedCaps,
      controls,
      governor,
      initialTier,
      navigatorInfo,
      saveData,
      touchPrimary,
      getProfile(tier = governor.getTier()) {
        return cloneProfile(tier);
      },
      getTier() {
        return governor.getTier();
      },
      resolveDprCap(profile) {
        const cap = resolveEffectiveDprCap(profile, { touchPrimary });
        return resolutionRelief ? Math.min(cap, 1) : cap;
      },
      // Skips samples for SAMPLE_HOLD_MS from the next sampled frame.
      holdSampling() {
        sampleResumeAt = null;
      },
      // Drops the next count revealed samples: a tour crossfade's capture, cut
      // and first dissolve frames carry one-off work, not frame pressure.
      skipSamples(count) {
        skippedSamples = Math.max(skippedSamples, Math.floor(count) || 0);
      },
      // Samples the revealed scene. timestamp is the rAF clock the hold runs
      // on; nowMs is the scene clock the governor's delays run on. Returns the
      // profile to apply after a step (the current one for a resolution-only
      // step), else null.
      sampleRevealed({ frameMs, nowMs, timestamp, profile }) {
        sampleResumeAt ??= timestamp + SAMPLE_HOLD_MS;
        if (timestamp < sampleResumeAt) return null;
        if (skippedSamples > 0) {
          skippedSamples -= 1;
          return null;
        }
        const nextTier = governor.sample(frameMs, nowMs, "low");
        if (!nextTier) return null;
        resolutionRelief = nextTier === "low";
        return resolutionRelief ? profile : cloneProfile(nextTier);
      },
    };
  }

  function getSceneCompositionProfile({
    width = window.innerWidth,
    height = window.innerHeight,
  } = {}) {
    const safeWidth = Math.max(1, width || 0);
    const safeHeight = Math.max(1, height || 0);
    const isPortrait = safeHeight > safeWidth;
    const isPortraitPhone = safeWidth <= 760 && isPortrait && safeHeight / safeWidth >= 1.15;
    // Short-height landscape viewports are dominated by rotated phones. Cap
    // at 1000px wide to keep small laptops out of this bucket.
    const isLandscapePhone = !isPortrait && safeHeight <= 500 && safeWidth <= 1000;
    // Tablet portrait: wider than a phone but still narrower than a small
    // laptop, held in portrait. Uses a touch-friendly frame without the
    // compact-desktop camera pullback.
    const isTabletPortrait = isPortrait && safeWidth > 760 && safeWidth <= 1024;

    if (isPortraitPhone) return cloneCompositionProfile("portraitPhone");
    if (isLandscapePhone) return cloneCompositionProfile("landscapePhone");
    if (isTabletPortrait) return cloneCompositionProfile("tabletPortrait");
    if (safeWidth < 1100) return cloneCompositionProfile("compact");
    return cloneCompositionProfile("desktop");
  }

  scene.SCENE_COMPOSITION_PROFILES = SCENE_COMPOSITION_PROFILES;
  scene.SCENE_QUALITY_PROFILES = SCENE_QUALITY_PROFILES;
  scene.createSceneQualityGovernor = createSceneQualityGovernor;
  scene.createSceneQualityState = createSceneQualityState;
  scene.detectSaveData = detectSaveData;
  scene.detectTouchPrimary = detectTouchPrimary;
  scene.getSceneCompositionProfile = getSceneCompositionProfile;
  scene.resolveEffectiveDprCap = resolveEffectiveDprCap;
  scene.getSceneQualityProfile = function getSceneQualityProfile(tier) {
    return cloneProfile(normalizeTier(tier, "high"));
  };
  scene.readSceneQualityControls = readSceneQualityControls;
  scene.qualityCapsFromProbe = qualityCapsFromProbe;
  scene.readWebGLQualityCaps = readWebGLQualityCaps;
  scene.selectSceneQualityTier = selectSceneQualityTier;
})();
