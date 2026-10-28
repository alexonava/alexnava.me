import { resolveSceneOpening } from "./scene/scene-modes.js";
import { createOpeningPreparation } from "./scene/opening-preparation.js";

(() => {
  const site = (window.BabelSite = window.BabelSite || {});
  (site.shared ||= {}).createOpeningPreparation = createOpeningPreparation;
  let sceneInitialized = false;
  let sceneLoadPromise = null;
  let sceneStartupTier = null;
  let staticRecoveryInstalled = false;
  let staticRecoveryAttempted = false;
  const staticRecoveryCleanups = [];
  let openingBudget = null,
    openingElapsed = 0,
    openingFailed = false;

  function stopOpeningBudget() {
    if (!openingBudget) return;
    const budget = openingBudget;
    openingBudget = null;
    clearTimeout(budget.timer);
    budget.cleanups.forEach((cleanup) => cleanup());
    openingElapsed += budget.gate.state.elapsed;
    budget.gate.dispose();
  }

  function startOpeningBudget() {
    if (openingBudget) return openingBudget;
    let reject;
    const expired = new Promise((resolve, fail) => (reject = fail)),
      budget = { expired, cleanups: [], timer: null, completed: 0 };
    expired.catch(() => {});
    budget.gate = createOpeningPreparation({
      stages: [],
      totalMs: Math.max(0, 30000 - openingElapsed),
      fail(reason) {
        openingFailed = true;
        stopOpeningBudget();
        cancelDeferredPrefetch();
        releaseArchitecturePrefetch();
        disableSceneHost();
        clearStaticPreferenceRecovery();
        reject(new Error(`Opening ${reason}`));
      },
    });
    openingBudget = budget;
    budget.observe = () => {
      if (openingBudget !== budget) return;
      clearTimeout(budget.timer);
      const blocked = staticPreferenceBlocksScene(readSceneQualityControls());
      budget.gate.tick(
        window.performance.now(),
        !document.hidden && !blocked,
        (site.sceneLoader?.state?.progress ?? 0) + budget.completed,
      );
      if (openingBudget !== budget) return;
      if (!blocked && !document.hidden) budget.timer = setTimeout(budget.observe, 200);
    };
    document.addEventListener("visibilitychange", budget.observe);
    budget.cleanups.push(() => document.removeEventListener("visibilitychange", budget.observe));
    for (const target of [
      window.matchMedia?.("(prefers-reduced-motion: reduce)"),
      window.matchMedia?.("(prefers-reduced-data: reduce)"),
      window.matchMedia?.("(forced-colors: active)"),
      typeof navigator !== "undefined" ? navigator.connection : null,
    ]) {
      const cleanup = addChangeListener(target, budget.observe);
      if (cleanup) budget.cleanups.push(cleanup);
    }
    const scene = (site.scene = site.scene || {});
    scene.takeOpeningBudget = () => {
      openingBudget?.observe();
      stopOpeningBudget();
      return Math.max(0, 30000 - openingElapsed);
    };
    budget.observe();
    return budget;
  }

  // The UI modules app.js imports before this one.
  function initUi() {
    const { ui } = site;
    ui.initHeroChrome();
    ui.initContact();
  }

  function initScene() {
    if (openingFailed) return false;
    if (sceneInitialized) return true;
    const scene = site.scene || {};
    if (typeof scene.initHomeScene === "function") {
      const initialized = scene.initHomeScene();
      if (initialized === false || openingFailed) return false;
      sceneInitialized = true;
      return true;
    }
    return false;
  }

  // The film opens on Lantern study or The watch, by chance (the owner's pick of 2026-10-26,
  // "Watch or Lantern by chance"), unless the address names a view or an angle or a script has
  // chosen a subject. Chosen once, before the loading line begins and the models are requested,
  // so the line and its light, the early requests and the scene agree: each resolves the
  // opening through scene-modes.js resolveSceneOpening(), which keeps this choice. Its default,
  // for an address with neither, is Lantern study.
  const WATCH_OPENING = Object.freeze({ view: "watch", angle: 0 });
  // A laptop's integrated GPU (quality.js's lean path) always opens on The watch, the sky
  // alone, which shows in about two seconds; Lantern study's ground takes it far longer to
  // build (the owner's call of 2026-10-27, "Always The watch").
  function chooseOpening(random = Math.random, { lean = false } = {}) {
    const scene = (site.scene = site.scene || {});
    if (scene.cinematicSelection != null) return;
    const query = new URLSearchParams(window.location?.search || "");
    if (query.has("view") || query.has("angle")) return;
    const opening = lean || random() >= 0.5 ? WATCH_OPENING : resolveSceneOpening("");
    scene.cinematicSelection = opening.view;
    scene.cinematicAngle = opening.angle;
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
  // retires below 100%, and the opening's doors (ui/scene-doors.js) part onto it.
  function disableSceneHost() {
    const host = document.getElementById("home-scene");
    if (host) host.hidden = true;
    site.sceneLoader?.end?.("static");
    site.sceneDoors?.open?.("static");
  }

  function enableSceneHost() {
    const host = document.getElementById("home-scene");
    if (host) host.hidden = false;
  }

  // scene/quality.js is in this bundle, ahead of this module.
  function readSceneQualityControls() {
    return site.scene.readSceneQualityControls(window.location?.search || "");
  }

  function detectsReducedData() {
    return site.scene.detectSaveData();
  }

  function detectsReducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    } catch {
      return false;
    }
  }

  function detectsForcedColors() {
    try {
      return window.matchMedia("(forced-colors: active)").matches === true;
    } catch {
      return false;
    }
  }

  function forcesLiveScene(controls) {
    return Boolean(controls?.overrideTier || controls?.debug);
  }

  function staticPreferenceBlocksScene(controls) {
    // Forced colors hides the canvas in CSS, even with a quality/debug override.
    return (
      detectsForcedColors() ||
      (!forcesLiveScene(controls) && (detectsReducedData() || detectsReducedMotion()))
    );
  }

  function clearStaticPreferenceRecovery() {
    while (staticRecoveryCleanups.length) {
      staticRecoveryCleanups.pop()?.();
    }
    staticRecoveryInstalled = false;
  }

  // navigator.connection exists only in Chromium browsers.
  function addChangeListener(target, handler) {
    if (!target) return null;
    target.addEventListener("change", handler);
    return () => target.removeEventListener("change", handler);
  }

  function installStaticPreferenceRecovery() {
    if (staticRecoveryInstalled || staticRecoveryAttempted) return;
    const controls = readSceneQualityControls();
    if (!staticPreferenceBlocksScene(controls)) return;

    const recover = () => {
      if (staticRecoveryAttempted || staticPreferenceBlocksScene(readSceneQualityControls()))
        return;
      staticRecoveryAttempted = true;
      clearStaticPreferenceRecovery();
      void site.ensureSceneReady();
    };

    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const dataQuery = window.matchMedia?.("(prefers-reduced-data: reduce)");
    const forcedColorsQuery = window.matchMedia?.("(forced-colors: active)");
    const connection = typeof navigator !== "undefined" ? navigator.connection : null;
    [motionQuery, dataQuery, forcedColorsQuery, connection].forEach((target) => {
      const cleanup = addChangeListener(target, recover);
      if (cleanup) staticRecoveryCleanups.push(cleanup);
    });
    staticRecoveryInstalled = staticRecoveryCleanups.length > 0;
  }

  // A preference can interrupt the worker or the scene download after an
  // earlier recovery consumed its listener. Keep the loaded bundle and model
  // responses, and rearm only this preference-driven static exit.
  function deferForStaticPreference(controls = readSceneQualityControls()) {
    if (!staticPreferenceBlocksScene(controls)) return false;
    cancelDeferredPrefetch();
    disableSceneHost();
    staticRecoveryAttempted = false;
    installStaticPreferenceRecovery();
    return true;
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

  // The scene's startup tier and whether it takes the lean path, from the probe the
  // capability gate already ran (quality.js is in this bundle); a null tier when the probe
  // left the limits unknown: the scene then probes and decides itself.
  function readStartupQuality(capabilities) {
    const scene = site.scene || {};
    try {
      const caps = scene.qualityCapsFromProbe?.(capabilities);
      if (!caps || typeof scene.createSceneQualityState !== "function") return null;
      const state = scene.createSceneQualityState({ caps });
      return { tier: state.initialTier || null, lean: state.lean === true };
    } catch {
      return null;
    }
  }

  // Once the live scene is chosen, request the startup tier's models beside the
  // bundle rather than after the scene's first frame. architecture-assets.js
  // takes a response whose URL matches once and releases the rest.
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
      if (!tier || !urls[tier]?.tree) return;
      const opening = resolveSceneOpening(window.location?.search || "", {
        view: scene.cinematicSelection,
        angle: scene.cinematicAngle,
      });
      const roles = opening.view === "tree" ? ["tree", "lantern"] : ["tree"];
      const prefetched = (scene.prefetched = new Map());
      for (const role of roles) {
        const url = tier ? urls[tier]?.[role] : null;
        if (!url) continue;
        const controller = new AbortController();
        // The loading line counts tree bytes; the scene's preparation gate
        // reports the optional lantern's actual completion or fallback.
        const response = fetch(url, {
          priority: opening.view === "tree" ? "high" : "low",
          signal: controller.signal,
        }).then((received) => site.sceneLoader?.track?.(url, received) ?? received);
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
      if (staticPreferenceBlocksScene(readSceneQualityControls())) return;
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
    if (openingFailed) return false;
    if (detectsForcedColors()) {
      // CSS hides an initialized scene while forced colors is active. Keep its
      // host available when the preference clears after one-shot recovery.
      if (!sceneInitialized) {
        deferForStaticPreference();
      }
      return false;
    }
    if (sceneLoadPromise) return sceneLoadPromise;

    // The entry may already be downloaded after a preference interrupted it.
    // Its presence does not bypass the startup gates on the next call.
    if (!sceneInitialized && deferForStaticPreference()) return false;

    if (site.scene?.initHomeScene) {
      try {
        const starting = !sceneInitialized;
        if (starting) {
          chooseOpening(Math.random, {
            lean: readStartupQuality(site.shared?.getWebGLCapabilities?.())?.lean,
          });
          startOpeningBudget();
          site.sceneLoader?.begin?.({ tier: sceneStartupTier });
          site.sceneLoader?.stage?.("bundle");
        }
        enableSceneHost();
        const initialized = initScene();
        if (initialized) {
          if (starting) site.sceneLoader?.stage?.("init");
          clearStaticPreferenceRecovery();
        } else if (!deferForStaticPreference()) {
          releaseArchitecturePrefetch();
          disableSceneHost();
          clearStaticPreferenceRecovery();
        }
        return initialized;
      } catch (error) {
        console.warn("Scene bundle failed to load.", error);
        releaseArchitecturePrefetch();
        disableSceneHost();
        clearStaticPreferenceRecovery();
        return false;
      } finally {
        stopOpeningBudget();
      }
    }

    sceneLoadPromise = (async () => {
      const budget = startOpeningBudget();
      try {
        const prepared =
          site.shared.prepareWebGLCapabilities?.() ?? site.shared.getWebGLCapabilities();
        const capabilities =
          typeof prepared?.then === "function"
            ? await Promise.race([prepared, budget.expired])
            : prepared;
        // The asynchronous worker may outlive a preference change. Recheck
        // before any scene request, and keep recovery available for that visit.
        const latestControls = readSceneQualityControls();
        if (deferForStaticPreference(latestControls)) return false;
        const forceLiveScene = forcesLiveScene(latestControls);
        if (!capabilities.available || (!forceLiveScene && capabilities.softwareRenderer)) {
          disableSceneHost();
          return false;
        }

        // The low tier keeps the static title card (?quality=low included): the
        // scene bundle is never requested.
        const startup = readStartupQuality(capabilities);
        const startupTier = latestControls?.overrideTier || startup?.tier || null;
        if (startupTier === "low") {
          disableSceneHost();
          return false;
        }

        // Only the live path shows the title card's loading line.
        sceneStartupTier = startupTier;
        chooseOpening(Math.random, { lean: startup?.lean });
        site.sceneLoader?.begin?.({ tier: startupTier });
        const sceneScript = loadScriptOnce(getSceneScriptUrl(), getSceneModulePreloads());
        // Issued after the bundle request, which keeps its head start.
        prefetchArchitectureModels(startupTier);
        await Promise.race([sceneScript, budget.expired]);
        budget.completed++;
        budget.observe();
        if (openingFailed) return false;
        site.sceneLoader?.stage?.("bundle");
        cancelDeferredPrefetch();
        // Preferences may change during the download too. Wait to initialize
        // until they permit it, reusing this entry and its model requests.
        if (deferForStaticPreference()) return false;
        enableSceneHost();
        const initialized = initScene();
        if (!initialized) {
          if (!deferForStaticPreference()) {
            releaseArchitecturePrefetch();
            disableSceneHost();
            clearStaticPreferenceRecovery();
          }
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
        clearStaticPreferenceRecovery();
        return false;
      } finally {
        stopOpeningBudget();
      }
    })();
    try {
      return await sceneLoadPromise;
    } finally {
      sceneLoadPromise = null;
    }
  };

  // Defer the heavier Three.js scene bundle past first paint so the hero LCP
  // and Contact are interactive before WebGL setup starts.
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
