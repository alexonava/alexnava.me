// How main.js boots the page: the scene's load gates and the About estate menu.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const testDir = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(testDir, "..");

const mainSourcePath = path.join(projectRoot, "src", "main.js");

const qualitySourcePath = path.join(projectRoot, "src", "scene", "quality.js");

const webglProbePath = path.join(projectRoot, "src", "shared", "webgl-probe.js");

// The UI bundle names only each tier's tower and tree (build.mjs).
const ARCHITECTURE_URLS = Object.fromEntries(
  ["high", "balanced"].map((tier) => [
    tier,
    Object.fromEntries(
      ["tower", "tree"].map((role) => [role, `/images/architecture/${role}-${tier}.0123abcd.glb`]),
    ),
  ]),
);

// Hardware limits that select the high tier on a desktop-sized viewport.
const CAPABLE = { maxAnisotropy: 16, maxTextureSize: 8192, prefetch: true };

function createScriptElement(onRemove) {
  const listeners = new Map();
  return {
    dataset: {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    dispatch(type, event) {
      listeners.get(type)?.(event);
    },
    remove() {
      onRemove?.(this);
    },
  };
}

function createMutableChangeTarget(initialMatches = false) {
  let matches = Boolean(initialMatches);
  const listeners = new Set();
  return {
    get matches() {
      return matches;
    },
    addEventListener(type, handler) {
      if (type === "change") listeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "change") listeners.delete(handler);
    },
    addListener(handler) {
      listeners.add(handler);
    },
    removeListener(handler) {
      listeners.delete(handler);
    },
    setMatches(value) {
      matches = Boolean(value);
      for (const handler of [...listeners]) handler({ matches });
    },
  };
}

function createContext({
  hardwareConcurrency,
  height = 720,
  hidden = false,
  initResult = true,
  logger = console,
  maxAnisotropy = 1,
  maxTextureSize = 0,
  modulePreloads,
  prefetch = false,
  // Model requests answer at once instead of staying in flight.
  respond = false,
  reducedMotion = false,
  saveData = false,
  // Records the title card's loading line calls (src/ui/scene-loader.js).
  sceneLoader = false,
  scriptOutcomes = ["load"],
  sceneUrl = "/scripts/scene.js",
  search = "",
  softwareRenderer = "",
  webgl = true,
  width = 1280,
} = {}) {
  const host = { hidden: false };
  const scripts = [];
  const links = [];
  const events = [];
  const fetches = [];
  const domContentLoadedListeners = new Set();
  const visibilityListeners = new Set();
  const pendingScripts = [];
  const idleCallbacks = [];
  const motionQuery = createMutableChangeTarget(reducedMotion);
  const dataQuery = createMutableChangeTarget(saveData);
  const connectionListeners = new Set();
  const connection = {
    saveData,
    addEventListener(type, handler) {
      if (type === "change") connectionListeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "change") connectionListeners.delete(handler);
    },
    setSaveData(value) {
      this.saveData = Boolean(value);
      for (const handler of [...connectionListeners]) handler({ type: "change" });
    },
  };
  let contextLossCount = 0;
  let scriptAppendCount = 0;
  let webglProbeCount = 0;
  const window = {
    // The UI modules app.js boots before main.js; the menu stays native here.
    BabelSite: { ui: { initHeroChrome() {}, initSceneMenu: () => false, initDeepLinks() {} } },
    WebGLRenderingContext: function WebGLRenderingContext() {},
    innerHeight: height,
    innerWidth: width,
    location: { search },
    matchMedia(query) {
      if (query === "(prefers-reduced-data: reduce)") return dataQuery;
      if (query === "(prefers-reduced-motion: reduce)") return motionQuery;
      return createMutableChangeTarget(false);
    },
    requestIdleCallback(callback) {
      idleCallbacks.push(callback);
    },
    requestAnimationFrame() {},
  };
  const navigator = { connection, hardwareConcurrency };
  // Without the recorder main.js runs exactly as before: every call is optional.
  const loaderCalls = [];
  const tracked = new Map();
  if (sceneLoader) {
    window.BabelSite.sceneLoader = {
      begin(options) {
        events.push("loader:begin");
        loaderCalls.push({ method: "begin", tier: options?.tier });
      },
      stage(name) {
        events.push(`loader:${name}`);
        loaderCalls.push({ method: "stage", name });
      },
      end(reason) {
        events.push(`loader:end:${reason}`);
        loaderCalls.push({ method: "end", reason });
      },
      track(url, response) {
        loaderCalls.push({ method: "track", url });
        const copy = { copyOf: response, url };
        tracked.set(url, copy);
        return copy;
      },
    };
  }
  const loadScript = (script) => {
    window.BabelSite.scene.initHomeScene = () => initResult;
    script.dispatch("load");
  };
  const document = {
    hidden,
    readyState: "loading",
    head: {
      appendChild(script) {
        if (script.rel === "modulepreload") {
          links.push(script);
          events.push(`modulepreload:${script.href}`);
          return;
        }
        scriptAppendCount += 1;
        scripts.push(script);
        events.push("script");
        const outcome = scriptOutcomes.shift() || "load";
        if (outcome === "load") {
          loadScript(script);
        } else if (outcome === "pending") {
          pendingScripts.push(script);
        } else {
          script.dispatch("error", new Error("Simulated scene script failure"));
        }
      },
    },
    addEventListener(type, handler) {
      if (type === "DOMContentLoaded") domContentLoadedListeners.add(handler);
      if (type === "visibilitychange") visibilityListeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "visibilitychange") visibilityListeners.delete(handler);
    },
    createElement(tagName) {
      if (tagName === "link") return { tagName: "LINK" };
      if (tagName === "script") {
        return createScriptElement((script) => {
          const index = scripts.indexOf(script);
          if (index !== -1) scripts.splice(index, 1);
        });
      }
      return {
        getContext(type) {
          if (type === "webgl" || type === "experimental-webgl") {
            webglProbeCount += 1;
            if (!webgl) return null;
            return {
              MAX_TEXTURE_SIZE: 0x0d33,
              RENDERER: 0x1f01,
              getExtension(name) {
                if (name === "WEBGL_debug_renderer_info") {
                  return { UNMASKED_RENDERER_WEBGL: 0x9246 };
                }
                if (name === "EXT_texture_filter_anisotropic") {
                  return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff };
                }
                if (name === "WEBGL_lose_context") {
                  return {
                    loseContext() {
                      contextLossCount += 1;
                    },
                  };
                }
                return null;
              },
              getParameter(parameter) {
                if (parameter === 0x9246 || parameter === 0x1f01) {
                  return softwareRenderer || "ANGLE (NVIDIA GeForce)";
                }
                if (parameter === 0x0d33) return maxTextureSize;
                if (parameter === 0x84ff) return maxAnisotropy;
                return null;
              },
            };
          }
          return null;
        },
      };
    },
    getElementById(id) {
      return id === "home-scene" ? host : null;
    },
    querySelector(selector) {
      if (selector === "meta[data-scene-script]") {
        return {
          getAttribute(name) {
            return name === "content" ? sceneUrl : null;
          },
        };
      }
      const preloadMatch = selector.match(/^link\[rel="modulepreload"\]\[href="(.+)"\]$/);
      if (preloadMatch) return links.find((link) => link.href === preloadMatch[1]) || null;
      const dynamicScriptMatch = selector.match(/^script\[data-dynamic-src="(.+)"\]$/);
      if (dynamicScriptMatch) {
        return (
          scripts.find((script) => script.dataset.dynamicSrc === dynamicScriptMatch[1]) || null
        );
      }
      return null;
    },
  };

  const context = {
    window,
    document,
    navigator,
    console: logger,
    URLSearchParams,
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout() {},
  };
  // The build names the scene entry's statically imported chunks in the UI bundle.
  if (modulePreloads) context.__BABEL_SCENE_MODULE_PRELOADS__ = modulePreloads;
  // The build defines the hashed model manifest in the UI bundle; fetch is
  // recorded and left pending, as a download in flight.
  if (prefetch) {
    Object.assign(context, {
      __BABEL_ARCHITECTURE_PREFETCH_URLS__: ARCHITECTURE_URLS,
      AbortController,
      fetch(url, options) {
        events.push(`fetch:${url}`);
        fetches.push({ url, options });
        return respond ? Promise.resolve({ ok: true, url }) : new Promise(() => {});
      },
    });
  }

  return {
    context,
    events,
    fetches,
    loaderCalls,
    tracked,
    host,
    connection,
    dataQuery,
    dispatchDOMContentLoaded() {
      for (const handler of [...domContentLoadedListeners]) handler({ type: "DOMContentLoaded" });
      domContentLoadedListeners.clear();
    },
    async flushIdleCallbacks() {
      await Promise.all(idleCallbacks.splice(0).map((callback) => callback()));
    },
    loadPendingScripts() {
      pendingScripts.splice(0).forEach(loadScript);
    },
    setHidden(value) {
      document.hidden = Boolean(value);
      for (const handler of [...visibilityListeners]) handler({ type: "visibilitychange" });
    },
    get visibilityListenerCount() {
      return visibilityListeners.size;
    },
    motionQuery,
    links,
    scripts,
    getScriptAppendCount: () => scriptAppendCount,
    getContextLossCount: () => contextLossCount,
    getWebglProbeCount: () => webglProbeCount,
  };
}

async function loadMainWithQuality(context) {
  const probeSource = await readFile(webglProbePath, "utf8");
  const qualitySource = await readFile(qualitySourcePath, "utf8");
  const mainSource = await readFile(mainSourcePath, "utf8");
  vm.runInNewContext(probeSource, context, { filename: webglProbePath });
  vm.runInNewContext(qualitySource, context, { filename: qualitySourcePath });
  vm.runInNewContext(mainSource, context, { filename: mainSourcePath });
}

test("scene loader skips the deferred bundle when reduced-data is requested", async () => {
  const { context, host, scripts, getWebglProbeCount } = createContext({ saveData: true });
  await loadMainWithQuality(context);

  const loaded = await context.window.BabelSite.ensureSceneReady();

  assert.equal(loaded, false);
  assert.equal(host.hidden, true);
  assert.equal(scripts.length, 0);
  assert.equal(getWebglProbeCount(), 0, "reduced-data exits before probing WebGL");
});

test("explicit quality override still allows the scene bundle on reduced-data connections", async () => {
  const { context, host, scripts, getWebglProbeCount } = createContext({
    saveData: true,
    search: "?quality=balanced",
  });
  await loadMainWithQuality(context);

  const loaded = await context.window.BabelSite.ensureSceneReady();

  assert.equal(loaded, true);
  assert.equal(host.hidden, false);
  assert.equal(scripts.length, 1);
  assert.equal(getWebglProbeCount(), 1);
});

test("scene loader keeps the title card static when reduced motion is requested", async () => {
  const { context, host, scripts, getWebglProbeCount } = createContext({
    reducedMotion: true,
  });
  await loadMainWithQuality(context);

  const loaded = await context.window.BabelSite.ensureSceneReady();

  assert.equal(loaded, false);
  assert.equal(host.hidden, true);
  assert.equal(scripts.length, 0);
  assert.equal(getWebglProbeCount(), 0, "reduced motion exits before probing WebGL");
});

test("clearing an initial static preference loads and reveals the scene exactly once", async () => {
  const harness = createContext({ reducedMotion: true });
  await loadMainWithQuality(harness.context);

  harness.dispatchDOMContentLoaded();
  await harness.flushIdleCallbacks();

  assert.equal(harness.host.hidden, true);
  assert.equal(harness.scripts.length, 0);

  harness.motionQuery.setMatches(false);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(harness.host.hidden, false);
  assert.equal(harness.scripts.length, 1);

  harness.motionQuery.setMatches(true);
  harness.motionQuery.setMatches(false);
  await Promise.resolve();

  assert.equal(harness.scripts.length, 1, "preference changes after recovery do not reload");
});

test("scene loader keeps the title card for software-rendered WebGL and releases the probe", async () => {
  for (const renderer of [
    "Google SwiftShader",
    "llvmpipe (LLVM 18.1)",
    "ANGLE Software Rasterizer",
    "Microsoft Basic Render Driver",
  ]) {
    const { context, host, scripts, getContextLossCount, getWebglProbeCount } = createContext({
      softwareRenderer: renderer,
    });
    await loadMainWithQuality(context);

    const loaded = await context.window.BabelSite.ensureSceneReady();

    assert.equal(loaded, false, renderer);
    assert.equal(host.hidden, true);
    assert.equal(scripts.length, 0);
    assert.equal(getWebglProbeCount(), 1);
    assert.equal(getContextLossCount(), 1);

    assert.equal(await context.window.BabelSite.ensureSceneReady(), false);
    assert.equal(getWebglProbeCount(), 1, "software capability result is cached");
    assert.equal(getContextLossCount(), 1, "the cached probe does not create another context");
  }
});

test("capable phone-shaped viewports retain the live scene path", async () => {
  const { context, host, scripts } = createContext({ height: 844, width: 390 });
  await loadMainWithQuality(context);

  const loaded = await context.window.BabelSite.ensureSceneReady();

  assert.equal(loaded, true);
  assert.equal(host.hidden, false);
  assert.equal(scripts.length, 1);
});

test("explicit quality and debug controls force live software WebGL unless WebGL is unavailable", async () => {
  for (const search of ["?quality=balanced", "?quality=high", "?sceneDebug=1"]) {
    const { context, host, scripts } = createContext({
      reducedMotion: true,
      saveData: true,
      search,
      softwareRenderer: "Microsoft Basic Render Driver",
    });
    await loadMainWithQuality(context);

    const loaded = await context.window.BabelSite.ensureSceneReady();

    assert.equal(loaded, true, `${search} should force the live scene`);
    assert.equal(host.hidden, false);
    assert.equal(scripts.length, 1);
  }

  const unavailable = createContext({ search: "?quality=high", webgl: false });
  await loadMainWithQuality(unavailable.context);
  assert.equal(await unavailable.context.window.BabelSite.ensureSceneReady(), false);
  assert.equal(unavailable.scripts.length, 0);
});

test("scene loader reads the inert metadata content as the deferred bundle URL", async () => {
  const { context, scripts } = createContext({
    sceneUrl: "/scripts/scene.content-hash.js",
  });
  await loadMainWithQuality(context);

  const loaded = await context.window.BabelSite.ensureSceneReady();

  assert.equal(loaded, true);
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, "/scripts/scene.content-hash.js");
  // The split scene entry imports its chunks, so it must load as an ES module
  // (deferred by nature; a classic defer flag would be meaningless).
  assert.equal(scripts[0].type, "module");
  assert.equal(scripts[0].defer, undefined);
});

test("scene loader preloads the entry's static chunks beside the module script, once", async () => {
  const shared = "/scripts/scene.shared.0123abcd.js";
  const harness = createContext({
    logger: { warn() {} },
    modulePreloads: [shared],
    sceneUrl: "/scripts/scene.content-hash.js",
    scriptOutcomes: ["error", "load"],
  });
  await loadMainWithQuality(harness.context);

  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false);
  // The preload starts with the entry request rather than after the entry
  // has downloaded and been parsed.
  assert.deepEqual(harness.events.slice(0, 2), [`modulepreload:${shared}`, "script"]);
  assert.equal(harness.links.length, 1);
  assert.equal(harness.links[0].rel, "modulepreload");
  assert.equal(harness.links[0].href, shared);

  // A retry appends the entry again but reuses the earlier preload link.
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(harness.getScriptAppendCount(), 2);
  assert.equal(harness.links.length, 1);
  assert.equal(harness.scripts[0].type, "module");
});

test("without a build-defined chunk list the scene loader adds no preload", async () => {
  const harness = createContext();
  await loadMainWithQuality(harness.context);
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(harness.links.length, 0);
  assert.equal(harness.scripts.length, 1);
});

test("scene loader removes a failed script so a later call can retry", async () => {
  const harness = createContext({
    logger: { warn() {} },
    scriptOutcomes: ["error", "load"],
  });
  await loadMainWithQuality(harness.context);

  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false);
  assert.equal(harness.host.hidden, true);
  assert.equal(harness.scripts.length, 0, "the failed script is removed from the document");

  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(harness.host.hidden, false);
  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.getScriptAppendCount(), 2);
});

test("invalid quality override does not bypass the data-saver gate", async () => {
  const { context, host, scripts, getWebglProbeCount } = createContext({
    saveData: true,
    search: "?quality=potato",
  });
  await loadMainWithQuality(context);

  const loaded = await context.window.BabelSite.ensureSceneReady();

  assert.equal(loaded, false);
  assert.equal(host.hidden, true);
  assert.equal(scripts.length, 0);
  assert.equal(getWebglProbeCount(), 0, "malformed override must not bypass data-saver");
});

test("the live scene requests its startup tier's tower and tree at low priority after its bundle", async () => {
  for (const [options, tier] of [
    [{}, "high"],
    [{ hardwareConcurrency: 4 }, "balanced"],
    [{ search: "?quality=balanced" }, "balanced"],
    [{ reducedMotion: true, search: "?quality=high" }, "high"],
  ]) {
    const harness = createContext({ ...CAPABLE, ...options });
    await loadMainWithQuality(harness.context);

    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);

    const urls = [ARCHITECTURE_URLS[tier].tower, ARCHITECTURE_URLS[tier].tree];
    assert.deepEqual(harness.events, ["script", ...urls.map((url) => `fetch:${url}`)]);
    for (const { options: init } of harness.fetches) {
      assert.equal(init.priority, "low");
      assert.equal(init.signal.aborted, false);
    }
    const prefetched = harness.context.window.BabelSite.scene.prefetched;
    assert.deepEqual([...prefetched.keys()], urls);
    assert.equal(typeof prefetched.get(urls[0]).abort, "function");
    assert.equal(typeof prefetched.get(urls[0]).response.then, "function");

    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
    assert.equal(harness.fetches.length, 2, "an initialized scene requests nothing again");
  }
});

test("the low tier keeps the title card and never requests the scene bundle", async () => {
  for (const options of [
    // An explicit low tier, with or without known texture limits.
    { ...CAPABLE, search: "?quality=low" },
    {
      search: "?quality=low",
      reducedMotion: true,
      softwareRenderer: "Microsoft Basic Render Driver",
    },
    { ...CAPABLE, search: "?quality=low&sceneDebug=1" },
    // Auto-detected low: weak texture limits.
    { maxTextureSize: 2048, maxAnisotropy: 16 },
    { maxTextureSize: 8192, maxAnisotropy: 2 },
  ]) {
    const harness = createContext(options);
    await loadMainWithQuality(harness.context);

    assert.equal(
      await harness.context.window.BabelSite.ensureSceneReady(),
      false,
      JSON.stringify(options),
    );
    assert.equal(harness.host.hidden, true, "the static title card stays");
    assert.equal(harness.scripts.length, 0, "no scene script is requested");
    assert.equal(harness.fetches.length, 0, "no model is requested");
  }
  // The scene itself declines the low tier (scene-bootstrap.test.mjs), should
  // main.js not have known the tier; main.js then hides the host.
  const unknown = createContext({ maxTextureSize: 0, initResult: false });
  await loadMainWithQuality(unknown.context);
  assert.equal(await unknown.context.window.BabelSite.ensureSceneReady(), false);
  assert.equal(unknown.host.hidden, true, "a declined initialization keeps the title card");
});

test("static title card paths and the low tier make no early model request", async () => {
  for (const options of [
    { reducedMotion: true },
    { saveData: true },
    { softwareRenderer: "Google SwiftShader" },
    { webgl: false },
    { search: "?quality=low" },
    { saveData: true, search: "?sceneDebug=1" },
    { maxTextureSize: 0 },
  ]) {
    const harness = createContext({ ...CAPABLE, ...options });
    await loadMainWithQuality(harness.context);

    await harness.context.window.BabelSite.ensureSceneReady();

    assert.equal(harness.fetches.length, 0, JSON.stringify(options));
    assert.equal(harness.context.window.BabelSite.scene.prefetched, undefined);
  }
});

test("a failed scene bundle or initialization releases the early model requests", async () => {
  for (const options of [
    { logger: { warn() {} }, scriptOutcomes: ["error", "load"] },
    { initResult: false },
  ]) {
    const harness = createContext({ ...CAPABLE, ...options });
    await loadMainWithQuality(harness.context);

    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false);

    assert.equal(harness.host.hidden, true);
    assert.equal(harness.fetches.length, 2);
    assert.ok(harness.fetches.every(({ options: init }) => init.signal.aborted));
    assert.equal(harness.context.window.BabelSite.scene.prefetched.size, 0);
  }

  const retry = createContext({
    ...CAPABLE,
    logger: { warn() {} },
    scriptOutcomes: ["error", "load"],
  });
  await loadMainWithQuality(retry.context);
  await retry.context.window.BabelSite.ensureSceneReady();
  assert.equal(await retry.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(retry.fetches.length, 2, "a retried bundle leaves model requests to the scene");
});

test("a hidden page requests models only if it is shown while the bundle still loads", async () => {
  const urls = [ARCHITECTURE_URLS.high.tower, ARCHITECTURE_URLS.high.tree];
  const shown = createContext({ ...CAPABLE, hidden: true, scriptOutcomes: ["pending"] });
  await loadMainWithQuality(shown.context);
  const ready = shown.context.window.BabelSite.ensureSceneReady();
  assert.equal(shown.fetches.length, 0, "a background tab downloads no models");
  shown.setHidden(true);
  assert.equal(shown.fetches.length, 0);
  shown.setHidden(false);
  assert.deepEqual(
    shown.fetches.map(({ url }) => url),
    urls,
    "shown before the scene initializes, the page requests the startup tier's models",
  );
  assert.equal(shown.visibilityListenerCount, 0);
  shown.loadPendingScripts();
  assert.equal(await ready, true);
  assert.deepEqual([...shown.context.window.BabelSite.scene.prefetched.keys()], urls);

  for (const options of [{}, { logger: { warn() {} }, scriptOutcomes: ["error"] }]) {
    const settled = createContext({ ...CAPABLE, ...options, hidden: true });
    await loadMainWithQuality(settled.context);
    await settled.context.window.BabelSite.ensureSceneReady();
    assert.equal(settled.visibilityListenerCount, 0, JSON.stringify(options));
    settled.setHidden(false);
    assert.equal(
      settled.fetches.length,
      0,
      "an initialized scene requests its own models at its first frame; a failed one needs none",
    );
  }
});

test("static title card paths never begin the loading line", async () => {
  for (const options of [
    { reducedMotion: true },
    { saveData: true },
    { softwareRenderer: "Google SwiftShader" },
    { webgl: false },
    { search: "?quality=low" },
    { ...CAPABLE, search: "?quality=low&sceneDebug=1" },
    { maxTextureSize: 2048, maxAnisotropy: 16 },
  ]) {
    const harness = createContext({ ...options, sceneLoader: true });
    await loadMainWithQuality(harness.context);
    assert.equal(
      await harness.context.window.BabelSite.ensureSceneReady(),
      false,
      JSON.stringify(options),
    );
    assert.ok(!harness.events.includes("loader:begin"), JSON.stringify(options));
    assert.equal(harness.scripts.length, 0);
    assert.equal(harness.host.hidden, true);
  }
});

test("the live path begins the loading line before the bundle and reports the bundle and initialization", async () => {
  for (const [options, tier] of [
    [{ maxAnisotropy: 16, maxTextureSize: 8192 }, "high"],
    [{ maxAnisotropy: 16, maxTextureSize: 8192, hardwareConcurrency: 4 }, "balanced"],
    [{ search: "?quality=balanced" }, "balanced"],
    // Unknown texture limits leave the tier to the scene.
    [{}, null],
  ]) {
    const harness = createContext({ ...options, sceneLoader: true });
    await loadMainWithQuality(harness.context);
    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
    assert.deepEqual(harness.events, ["loader:begin", "script", "loader:bundle", "loader:init"]);
    assert.equal(harness.loaderCalls[0].tier, tier, JSON.stringify(options));
    assert.equal(harness.host.hidden, false);
  }
  // The early model requests start after the bundle request, inside the run.
  const prefetching = createContext({ ...CAPABLE, sceneLoader: true });
  await loadMainWithQuality(prefetching.context);
  await prefetching.context.window.BabelSite.ensureSceneReady();
  const urls = [ARCHITECTURE_URLS.high.tower, ARCHITECTURE_URLS.high.tree];
  assert.deepEqual(prefetching.events, [
    "loader:begin",
    "script",
    ...urls.map((url) => `fetch:${url}`),
    "loader:bundle",
    "loader:init",
  ]);
});

test("a failed bundle, a declined initialization or the scene's low-tier decline retires the loading line", async () => {
  for (const [options, expected] of [
    [
      { logger: { warn() {} }, scriptOutcomes: ["error"] },
      ["loader:begin", "script", "loader:end:static"],
    ],
    [{ initResult: false }, ["loader:begin", "script", "loader:bundle", "loader:end:static"]],
    // Unknown limits: the scene finds the low tier itself and declines.
    [
      { maxTextureSize: 0, initResult: false },
      ["loader:begin", "script", "loader:bundle", "loader:end:static"],
    ],
  ]) {
    const harness = createContext({ ...options, sceneLoader: true });
    await loadMainWithQuality(harness.context);
    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false);
    assert.deepEqual(harness.events, expected, JSON.stringify(options));
    assert.equal(harness.host.hidden, true, "the title card stays");
  }
});

test("an early model response resolves to the loading line's counted copy", async () => {
  const harness = createContext({ ...CAPABLE, prefetch: true, respond: true, sceneLoader: true });
  await loadMainWithQuality(harness.context);
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  const prefetched = harness.context.window.BabelSite.scene.prefetched;
  for (const url of [ARCHITECTURE_URLS.high.tower, ARCHITECTURE_URLS.high.tree]) {
    const response = await prefetched.get(url).response;
    assert.equal(response, harness.tracked.get(url), "the scene takes what track() returned");
    assert.equal(response.copyOf.url, url);
  }
  assert.deepEqual(
    harness.loaderCalls.filter(({ method }) => method === "track").map(({ url }) => url),
    [ARCHITECTURE_URLS.high.tower, ARCHITECTURE_URLS.high.tree],
  );
  // Without the line the early response is the network's own.
  const plain = createContext({ ...CAPABLE, prefetch: true, respond: true });
  await loadMainWithQuality(plain.context);
  await plain.context.window.BabelSite.ensureSceneReady();
  const response = await plain.context.window.BabelSite.scene.prefetched.get(
    ARCHITECTURE_URLS.high.tower,
  ).response;
  assert.equal(response.url, ARCHITECTURE_URLS.high.tower);
  assert.equal(response.ok, true);
});

// The About estate menu boots through main.js, which waits for the parsed
// document and then asks scene-menu.js to enhance it.
// scene-menu.test.mjs covers initSceneMenu on its own; these checks cover the
// boot timing around it.
const menuSource = await readFile(new URL("../src/ui/scene-menu.js", import.meta.url), "utf8");

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

const qualitySource = await readFile(new URL("../src/scene/quality.js", import.meta.url), "utf8");

function createFixture({ readyState = "complete", init = () => true } = {}) {
  const entry = { hidden: true };
  const fallback = ["About link", "category copy"].map((kind) => ({
    kind,
    hidden: false,
    children: [{ kind: "ordinary-link-or-selectable-copy" }],
    contains(target) {
      return target === this || this.children.includes(target);
    },
  }));
  const listeners = new Map();
  const document = {
    readyState,
    activeElement: { kind: "body" },
    querySelector: (selector) => (selector === ".scene-entry" ? entry : null),
    querySelectorAll: (selector) => (selector === "[data-scene-fallback]" ? fallback : []),
    getElementById: () => null,
    addEventListener(type, callback, options) {
      const registrations = listeners.get(type) || [];
      registrations.push({ callback, options });
      listeners.set(type, registrations);
    },
    dispatch(type) {
      for (const registration of [...(listeners.get(type) || [])]) {
        if (registration.options?.once) {
          listeners.set(
            type,
            listeners.get(type).filter((item) => item !== registration),
          );
        }
        registration.callback();
      }
    },
  };
  let calls = 0;
  const quietQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  const window = {
    BabelSite: {
      ui: {
        initHeroChrome() {},
        initDeepLinks() {},
        initPanels() {
          calls++;
          return init();
        },
      },
    },
    location: { search: "" },
    matchMedia: () => quietQuery,
    // The deferred scene load is outside these checks.
    requestIdleCallback() {},
  };
  return {
    window,
    document,
    entry,
    fallback,
    listeners,
    get calls() {
      return calls;
    },
    boot() {
      const context = vm.createContext({ window, document, navigator: {}, URLSearchParams });
      vm.runInContext(qualitySource, context, { filename: "src/scene/quality.js" });
      vm.runInContext(menuSource, context, { filename: "src/ui/scene-menu.js" });
      vm.runInContext(mainSource, context, { filename: "src/main.js" });
    },
  };
}

function assertFallbackAvailable(fixture) {
  assert.equal(fixture.entry.hidden, true, "nonfunctional About dialog control stays hidden");
  assert.ok(
    fixture.fallback.every((element) => !element.hidden),
    "ordinary About navigation and category copy remain available",
  );
}

test("a loading document keeps the ordinary About fallback until DOMContentLoaded, then enhances once", () => {
  const fixture = createFixture({ readyState: "loading" });
  fixture.boot();
  assert.equal(fixture.calls, 0);
  assertFallbackAvailable(fixture);
  assert.equal(fixture.listeners.get("DOMContentLoaded").length, 1);
  fixture.document.readyState = "interactive";
  fixture.document.dispatch("DOMContentLoaded");
  assert.equal(fixture.calls, 1);
  assert.equal(fixture.entry.hidden, false);
  assert.ok(fixture.fallback.every((element) => element.hidden));
  fixture.document.dispatch("DOMContentLoaded");
  assert.equal(fixture.calls, 1);
});

test("a delayed boot never hides a fallback link or section the visitor is using", () => {
  for (const index of [0, 1]) {
    for (const focusRoot of [false, true]) {
      const fixture = createFixture({ readyState: "loading" });
      fixture.boot();
      const selected = focusRoot ? fixture.fallback[index] : fixture.fallback[index].children[0];
      fixture.document.activeElement = selected;
      fixture.document.dispatch("DOMContentLoaded");
      assert.equal(fixture.calls, 0, "active fallback use prevents enhancement");
      assertFallbackAvailable(fixture);
      assert.equal(fixture.document.activeElement, selected);
    }
  }
});

test("an already parsed document enhances without waiting for another load event", () => {
  const fixture = createFixture({ readyState: "interactive" });
  const previousFocus = fixture.document.activeElement;
  fixture.boot();
  assert.equal(fixture.calls, 1);
  assert.equal(fixture.entry.hidden, false);
  assert.equal(fixture.listeners.has("DOMContentLoaded"), false);
  assert.equal(fixture.document.activeElement, previousFocus);
});

test("failed or unavailable panel binding at boot preserves the ordinary homepage", async (t) => {
  const cases = [
    ["false result", () => false],
    [
      "thrown error",
      () => {
        throw new Error("binding failed");
      },
    ],
  ];
  for (const [name, init] of cases) {
    await t.test(name, () => {
      const fixture = createFixture({ init });
      assert.doesNotThrow(() => fixture.boot());
      assert.equal(fixture.calls, 1);
      assertFallbackAvailable(fixture);
    });
  }
  await t.test("missing initializer", () => {
    const fixture = createFixture();
    delete fixture.window.BabelSite.ui.initPanels;
    assert.doesNotThrow(() => fixture.boot());
    assert.equal(fixture.calls, 0);
    assertFallbackAvailable(fixture);
  });
});
