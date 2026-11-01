// The startup tier: the `?quality=` and `sceneDebug` controls, the reduced-data
// preference and the device's limits, from the probe's capabilities.
//
// The UI bundle runs this before main.js decides whether to request the scene.
// The deferred scene reads the same functions from BabelSite.scene (its
// quality.js builds the profiles and governor on them), so both choose alike.
(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  const scene = (site.scene = site.scene || {});

  const TIER_ORDER = Object.freeze(["low", "balanced", "high"]);

  function normalizeTier(value, fallback = null) {
    if (typeof value !== "string") return fallback;
    const normalized = value.toLowerCase().trim();
    if (normalized === "auto") return "auto";
    return TIER_ORDER.includes(normalized) ? normalized : fallback;
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

  // shared/webgl-probe.js reads the same limits from the context it already
  // opened. Returns null when they are unknown, so the caller probes instead.
  function qualityCapsFromProbe(capabilities) {
    const maxTextureSize = Number(capabilities?.maxTextureSize) || 0;
    if (!capabilities?.available || maxTextureSize <= 0) return null;
    return {
      maxAnisotropy: Math.max(1, Math.round(Number(capabilities.maxAnisotropy) || 1)),
      maxTextureSize,
      gpuClass: capabilities.gpuClass ?? "unknown",
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
    if (isLean({ controls, caps, touchPrimary })) return "balanced";

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

  // An integrated GPU on a desktop or laptop (touch devices keep their own path).
  function isLean({ controls, caps = {}, touchPrimary = false }) {
    return !controls?.overrideTier && !touchPrimary && caps?.gpuClass === "integrated";
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

  // This page's startup tier for known limits, with the same inputs and
  // defaults as the scene's quality state (quality.js createSceneQualityState).
  function selectStartupTier({
    caps,
    navigatorInfo = navigator,
    search = window.location?.search || "",
    viewport = { width: window.innerWidth, height: window.innerHeight },
    touchPrimary = detectTouchPrimary(),
    saveData = detectSaveData({ navigatorInfo }),
  }) {
    return selectSceneQualityTier({
      controls: readSceneQualityControls(search),
      navigatorInfo,
      viewport,
      caps,
      touchPrimary,
      saveData,
    });
  }

  scene.SCENE_QUALITY_TIERS = TIER_ORDER;
  scene.detectSaveData = detectSaveData;
  scene.detectTouchPrimary = detectTouchPrimary;
  scene.isLean = isLean;
  scene.normalizeTier = normalizeTier;
  scene.qualityCapsFromProbe = qualityCapsFromProbe;
  scene.readSceneQualityControls = readSceneQualityControls;
  scene.selectSceneQualityTier = selectSceneQualityTier;
  scene.selectStartupTier = selectStartupTier;
})();
