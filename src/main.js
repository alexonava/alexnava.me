(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  let sceneInitialized = false;
  let staticRecoveryInstalled = false;
  let staticRecoveryAttempted = false;
  const staticRecoveryCleanups = [];

  function initUi() {
    const ui = site.ui || {};
    if (typeof ui.initHeroChrome === "function") ui.initHeroChrome();
    if (typeof ui.initSceneMenu === "function") {
      // Deep links drive the enhanced dialogs; the fallback keeps native anchors.
      if (ui.initSceneMenu() === true && typeof ui.initDeepLinks === "function") ui.initDeepLinks();
    } else if (typeof ui.initPanels === "function") ui.initPanels();
    if (typeof ui.initSceneControls === "function") ui.initSceneControls();
  }

  function initScene() {
    if (sceneInitialized) return true;
    const scene = site.scene || {};
    if (typeof scene.initHomeScene === "function") {
      const initialized = scene.initHomeScene();
      if (initialized === false) return false;
      sceneInitialized = true;
      return true;
    }
    return false;
  }

  function getSceneScriptUrl() {
    const metadata = document.querySelector("meta[data-scene-script]");
    const configuredUrl = metadata?.getAttribute?.("content")?.trim();
    return configuredUrl || "/scripts/scene.js";
  }

  // The build names the chunks the scene entry imports statically (the shared
  // Three.js chunk). Unaided, the browser finds that import only after it has
  // downloaded and parsed the entry, one round trip later.
  function getSceneModulePreloads() {
    return typeof __BABEL_SCENE_MODULE_PRELOADS__ !== "undefined"
      ? __BABEL_SCENE_MODULE_PRELOADS__
      : [];
  }

  // src/shared/webgl-probe.js is bundled into both the UI and scene entries so
  // the pre-download gate here and the in-scene check (`scene.supportsWebGL`)
  // share one implementation. Skipping the scene-bundle download on static
  // preference/capability paths is the reason this check happens in the UI
  // bundle.

  // The title card stays. A loading line already shown (ui/scene-loader.js)
  // retires below 100%.
  function disableSceneHost() {
    const host = document.getElementById("home-scene");
    if (host) host.hidden = true;
    site.sceneLoader?.end?.("static");
  }

  function enableSceneHost() {
    const host = document.getElementById("home-scene");
    if (host) host.hidden = false;
  }

  function readSceneQualityControls() {
    const scene = site.scene || {};
    if (typeof scene.readSceneQualityControls === "function") {
      return scene.readSceneQualityControls(window.location?.search || "");
    }

    try {
      const params = new URLSearchParams(window.location?.search || "");
      const quality = (params.get("quality") || "").toLowerCase();
      const VALID_TIERS = ["low", "balanced", "high"];
      return {
        debug: params.get("sceneDebug") === "1" || params.get("sceneDebug") === "true",
        overrideTier: VALID_TIERS.includes(quality) ? quality : null,
      };
    } catch {
      return { debug: false, overrideTier: null };
    }
  }

  function detectsReducedData() {
    const scene = site.scene || {};
    if (typeof scene.detectSaveData === "function") {
      return scene.detectSaveData({
        navigatorInfo: typeof navigator !== "undefined" ? navigator : {},
      });
    }

    const connection = typeof navigator !== "undefined" ? navigator.connection : null;
    if (connection?.saveData === true) return true;

    try {
      return window.matchMedia("(prefers-reduced-data: reduce)").matches === true;
    } catch {
      return false;
    }
  }

  function detectsReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    } catch {
      return false;
    }
  }

  function forcesLiveScene(controls) {
    return Boolean(controls?.overrideTier || controls?.debug);
  }

  function clearStaticPreferenceRecovery() {
    while (staticRecoveryCleanups.length) {
      staticRecoveryCleanups.pop()?.();
    }
    staticRecoveryInstalled = false;
  }

  function addChangeListener(target, handler) {
    if (typeof target?.addEventListener === "function") {
      target.addEventListener("change", handler);
      return () => target.removeEventListener?.("change", handler);
    }
    if (typeof target?.addListener === "function") {
      target.addListener(handler);
      return () => target.removeListener?.(handler);
    }
    return null;
  }

  function installStaticPreferenceRecovery() {
    if (staticRecoveryInstalled || staticRecoveryAttempted) return;
    const controls = readSceneQualityControls();
    if (forcesLiveScene(controls) || (!detectsReducedData() && !detectsReducedMotion())) return;

    const recover = () => {
      if (staticRecoveryAttempted || detectsReducedData() || detectsReducedMotion()) return;
      staticRecoveryAttempted = true;
      clearStaticPreferenceRecovery();
      void site.ensureSceneReady();
    };

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const dataQuery = window.matchMedia?.("(prefers-reduced-data: reduce)");
    const connection = typeof navigator !== "undefined" ? navigator.connection : null;
    [motionQuery, dataQuery, connection].forEach((target) => {
      const cleanup = addChangeListener(target, recover);
      if (cleanup) staticRecoveryCleanups.push(cleanup);
    });
    staticRecoveryInstalled = staticRecoveryCleanups.length > 0;
  }

  function loadScriptOnce(src, modulePreloads = []) {
    const existing = document.querySelector(`script[data-dynamic-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") return Promise.resolve();
      return new Promise((resolve, reject) => {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
      });
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      // The scene entry is an ES module: it imports its shared Three.js chunk.
      // A module script is deferred by nature; error also fires when an
      // imported chunk fails.
      script.type = "module";
      script.src = src;
      script.dataset.dynamicSrc = src;
      script.addEventListener(
        "load",
        () => {
          script.dataset.loaded = "true";
          resolve();
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        (error) => {
          script.remove();
          reject(error);
        },
        { once: true },
      );
      // babel:scene-request starts the span that covers both scene chunks'
      // downloads and Three.js evaluation, which the scene's own
      // babel:scene-entry mark (taken after the shared chunk ran) cannot see.
      try {
        window.performance?.mark?.("babel:scene-request");
      } catch {
        // User Timing is best-effort, as in scene/perf-marks.js.
      }
      // Each preloaded chunk downloads beside the entry, and the entry's import
      // reuses it. A failed preload surfaces as the script's own error. A
      // retry keeps the earlier link rather than adding another.
      for (const href of modulePreloads) {
        if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) continue;
        const link = document.createElement("link");
        link.rel = "modulepreload";
        link.href = href;
        document.head.appendChild(link);
      }
      document.head.appendChild(script);
    });
  }

  // The scene's startup tier, from the probe the capability gate already ran
  // (quality.js is in this bundle), or null when the probe left the limits
  // unknown: the scene then probes and decides itself.
  function readStartupTier(capabilities) {
    const scene = site.scene || {};
    try {
      const caps = scene.qualityCapsFromProbe?.(capabilities);
      if (!caps || typeof scene.createSceneQualityState !== "function") return null;
      return scene.createSceneQualityState({ caps }).initialTier || null;
    } catch {
      return null;
    }
  }

  // The scene used to request its models only after its first frame. Once the
  // live scene is chosen, request the startup tier's tower and tree beside the
  // bundle. architecture-assets.js takes a response whose URL matches once and
  // releases the rest.
  let modelPrefetchStarted = false;
  function prefetchArchitectureModels(tier) {
    if (modelPrefetchStarted) return;
    // A hidden page draws no frame, so the scene would not take the responses,
    // and a background tab may never be viewed.
    if (document.hidden === true) {
      deferPrefetchUntilVisible(tier);
      return;
    }
    modelPrefetchStarted = true;
    const urls =
      typeof __BABEL_ARCHITECTURE_PREFETCH_URLS__ !== "undefined"
        ? __BABEL_ARCHITECTURE_PREFETCH_URLS__
        : null;
    if (!urls || typeof fetch !== "function" || typeof AbortController !== "function") return;
    try {
      const scene = (site.scene = site.scene || {});
      // Unknown limits would make the scene probe again; do not guess its tier.
      const tierUrls = tier ? urls[tier] : null;
      if (!tierUrls) return;
      const prefetched = (scene.prefetched = new Map());
      for (const url of [tierUrls.tower, tierUrls.tree]) {
        if (!url) continue;
        const controller = new AbortController();
        // The loading line counts the body as it arrives, before the scene
        // takes it; the scene receives the copy it returns.
        const response = fetch(url, { priority: "low", signal: controller.signal }).then(
          (received) => site.sceneLoader?.track?.(url, received) ?? received,
        );
        response.catch(() => {});
        prefetched.set(url, { response, abort: () => controller.abort() });
      }
    } catch {
      // The scene requests its own models when an early request cannot start.
    }
  }

  // Shown while the bundle still loads, the page makes the early request then.
  // Once the scene has initialized, its first frame requests the models itself.
  let deferredPrefetch = null;
  function deferPrefetchUntilVisible(tier) {
    if (deferredPrefetch || typeof document.addEventListener !== "function") return;
    deferredPrefetch = () => {
      if (document.hidden === true) return;
      cancelDeferredPrefetch();
      prefetchArchitectureModels(tier);
    };
    document.addEventListener("visibilitychange", deferredPrefetch);
  }

  function cancelDeferredPrefetch() {
    if (!deferredPrefetch) return;
    document.removeEventListener?.("visibilitychange", deferredPrefetch);
    deferredPrefetch = null;
  }

  function releaseArchitecturePrefetch() {
    const prefetched = site.scene?.prefetched;
    prefetched?.forEach((entry) => entry.abort());
    prefetched?.clear();
  }

  async function loadAndInitScene() {
    await site.ensureSceneReady();
  }

  site.ensureSceneReady = async function ensureSceneReady() {
    if (site.scene?.initHomeScene) {
      const initialized = initScene();
      if (initialized) {
        enableSceneHost();
        clearStaticPreferenceRecovery();
      }
      return initialized;
    }

    const controls = readSceneQualityControls();
    const forceLiveScene = forcesLiveScene(controls);
    if (!forceLiveScene && (detectsReducedData() || detectsReducedMotion())) {
      disableSceneHost();
      return false;
    }

    const capabilities = site.shared.getWebGLCapabilities();
    if (!capabilities.available || (!forceLiveScene && capabilities.softwareRenderer)) {
      disableSceneHost();
      return false;
    }

    // The low tier keeps the static title card (?quality=low included): the
    // scene bundle is never requested.
    const startupTier = controls?.overrideTier || readStartupTier(capabilities);
    if (startupTier === "low") {
      disableSceneHost();
      return false;
    }

    // Only the live path shows the title card's loading line.
    site.sceneLoader?.begin?.({ tier: startupTier });
    try {
      const sceneScript = loadScriptOnce(getSceneScriptUrl(), getSceneModulePreloads());
      // Issued after the bundle request, which keeps its head start.
      prefetchArchitectureModels(startupTier);
      await sceneScript;
      site.sceneLoader?.stage?.("bundle");
      cancelDeferredPrefetch();
      enableSceneHost();
      const initialized = initScene();
      if (!initialized) {
        releaseArchitecturePrefetch();
        disableSceneHost();
        return false;
      }
      site.sceneLoader?.stage?.("init");
      clearStaticPreferenceRecovery();
      return true;
    } catch (error) {
      console.warn("Scene bundle failed to load.", error);
      cancelDeferredPrefetch();
      releaseArchitecturePrefetch();
      disableSceneHost();
      return false;
    }
  };

  // Defer the heavier Three.js scene bundle past first paint so the hero LCP
  // and panel controls are interactive before WebGL setup starts.
  function afterFirstPaint(cb) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(cb, { timeout: 500 });
    } else {
      requestAnimationFrame(() => setTimeout(cb, 0));
    }
  }

  function boot() {
    initUi();
    installStaticPreferenceRecovery();
    afterFirstPaint(loadAndInitScene);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
