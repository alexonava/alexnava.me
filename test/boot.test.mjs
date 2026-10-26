// How main.js boots the page: the scene's load gates and the footer's Contact.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createContactDom } from "./support/contact-dom.mjs";
import { resolveSceneOpening } from "../src/scene/scene-modes.js";
import { createOpeningPreparation } from "../src/scene/opening-preparation.js";

const classicSource = (source) =>
  source.replace(
    /^import \{ (?:resolveSceneOpening|createOpeningPreparation) \} from .*;\r?\n/gm,
    "",
  );

const testDir = path.dirname(fileURLToPath(import.meta.url));

const projectRoot = path.resolve(testDir, "..");

const mainSourcePath = path.join(projectRoot, "src", "main.js");

const qualitySourcePath = path.join(projectRoot, "src", "scene", "quality.js");

const webglProbePath = path.join(projectRoot, "src", "shared", "webgl-probe.js");

// A minimal manifest also exercises builds without an optional lantern entry.
const ARCHITECTURE_URLS = Object.fromEntries(
  ["high", "balanced"].map((tier) => [
    tier,
    { tree: `/images/architecture/tree-${tier}.0123abcd.glb` },
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
  forcedColors = false,
  hardwareConcurrency,
  height = 720,
  hidden = false,
  initResult = true,
  logger = console,
  maxAnisotropy = 1,
  maxTextureSize = 0,
  modulePreloads,
  prefetch = false,
  prefetchLantern = false,
  // main.js chooseOpening()'s roll for an address without a view or an angle: below 0.5
  // Lantern study, else The watch; a function is called for each roll.
  random = 0.25,
  selection,
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
  workerProbe = false,
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
  const workers = [];
  const idleCallbacks = [];
  const timers = new Map();
  let now = 0,
    timerId = 0;
  const motionQuery = createMutableChangeTarget(reducedMotion);
  const dataQuery = createMutableChangeTarget(saveData);
  const forcedColorsQuery = createMutableChangeTarget(forcedColors);
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
  let sceneInitCount = 0;
  let webglProbeCount = 0;
  const window = {
    // The UI modules app.js boots before main.js; Contact stays native here.
    BabelSite: {
      ui: { initHeroChrome() {}, initContact() {} },
      ...(selection
        ? { scene: { cinematicSelection: selection.view, cinematicAngle: selection.angle } }
        : {}),
    },
    WebGLRenderingContext: function WebGLRenderingContext() {},
    innerHeight: height,
    innerWidth: width,
    location: { search },
    matchMedia(query) {
      if (query === "(prefers-reduced-data: reduce)") return dataQuery;
      if (query === "(prefers-reduced-motion: reduce)") return motionQuery;
      if (query === "(forced-colors: active)") return forcedColorsQuery;
      return createMutableChangeTarget(false);
    },
    requestIdleCallback(callback) {
      idleCallbacks.push(callback);
    },
    requestAnimationFrame() {},
  };
  const navigator = { connection, hardwareConcurrency };
  if (workerProbe) {
    window.OffscreenCanvas = function OffscreenCanvas() {};
    window.Worker = class Worker {
      constructor(url) {
        this.url = url;
        this.terminated = false;
        workers.push(this);
      }
      terminate() {
        this.terminated = true;
      }
    };
  }
  // Without the recorder main.js runs exactly as before: every call is optional.
  const loaderCalls = [];
  const tracked = new Map();
  let loaderProgress = 0;
  if (sceneLoader) {
    window.BabelSite.sceneLoader = {
      get state() {
        return { progress: loaderProgress };
      },
      begin(options) {
        events.push("loader:begin");
        const scene = window.BabelSite.scene;
        loaderCalls.push({
          method: "begin",
          tier: options?.tier,
          opening: [scene?.cinematicSelection ?? null, scene?.cinematicAngle ?? null],
        });
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
    window.BabelSite.scene.initHomeScene = () => {
      sceneInitCount += 1;
      return typeof initResult === "function" ? initResult(window.BabelSite.scene) : initResult;
    };
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
    Math: Object.assign(Object.create(Math), {
      random: typeof random === "function" ? random : () => random,
    }),
    resolveSceneOpening,
    createOpeningPreparation,
    requestAnimationFrame: window.requestAnimationFrame,
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  window.performance = { now: () => now };
  if (workerProbe) context.__BABEL_WEBGL_PROBE_URL__ = "/scripts/webgl-probe.0123abcd.js";
  // The build names the scene entry's statically imported chunks in the UI bundle.
  if (modulePreloads) context.__BABEL_SCENE_MODULE_PRELOADS__ = modulePreloads;
  // The build defines the hashed model manifest in the UI bundle; fetch is
  // recorded and left pending, as a download in flight.
  if (prefetch) {
    Object.assign(context, {
      __BABEL_ARCHITECTURE_PREFETCH_URLS__: prefetchLantern
        ? Object.fromEntries(
            Object.entries(ARCHITECTURE_URLS).map(([tier, urls]) => [
              tier,
              { ...urls, lantern: `/images/architecture/lantern-${tier}.0123abcd.glb` },
            ]),
          )
        : ARCHITECTURE_URLS,
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
    setLoaderProgress(value) {
      loaderProgress = value;
    },
    host,
    connection,
    dataQuery,
    forcedColorsQuery,
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
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
    },
    get pendingTimers() {
      return timers.size;
    },
    get visibilityListenerCount() {
      return visibilityListeners.size;
    },
    motionQuery,
    links,
    scripts,
    workers,
    getScriptAppendCount: () => scriptAppendCount,
    getSceneInitCount: () => sceneInitCount,
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
  vm.runInNewContext(classicSource(mainSource), context, { filename: mainSourcePath });
}

const WORKER_CAPABILITIES = {
  available: true,
  softwareRenderer: false,
  maxAnisotropy: 16,
  maxTextureSize: 8192,
};

test("UI boot publishes the actual pure opening factory without replacing shared capability helpers", async () => {
  const h = createContext({ ...CAPABLE });
  await loadMainWithQuality(h.context);
  const shared = h.context.window.BabelSite.shared;
  assert.equal(shared.createOpeningPreparation, createOpeningPreparation);
  assert.equal(typeof shared.getWebGLCapabilities, "function");
  assert.equal(h.getScriptAppendCount(), 0, "the bridge exists before any deferred scene request");
  const failures = [],
    gate = shared.createOpeningPreparation({
      stages: ["scene"],
      fail: (reason) => failures.push(reason),
    });
  gate.tick(0, true);
  gate.tick(15000, true);
  assert.deepEqual(failures, ["stalled"], "the bridge carries the real deadline behavior");
});

test("static preferences block the worker before cold GPU probing", async () => {
  for (const options of [{ forcedColors: true }, { reducedMotion: true }, { saveData: true }]) {
    const harness = createContext({ ...CAPABLE, ...options, workerProbe: true });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    await harness.flushIdleCallbacks();
    assert.equal(harness.workers.length, 0);
    assert.equal(harness.getWebglProbeCount(), 0);
    assert.equal(harness.scripts.length, 0);
    assert.equal(harness.fetches.length, 0);
  }
});

test("concurrent cold startup shares one worker and its capability result without a UI context", async () => {
  const harness = createContext({ ...CAPABLE, workerProbe: true, sceneLoader: true });
  await loadMainWithQuality(harness.context);
  const first = harness.context.window.BabelSite.ensureSceneReady();
  const second = harness.context.window.BabelSite.ensureSceneReady();
  assert.equal(harness.workers.length, 1);
  assert.equal(harness.scripts.length, 0, "the live gate waits for capability detection");
  assert.equal(harness.getWebglProbeCount(), 0);
  assert.ok(!harness.events.includes("loader:begin"));
  harness.workers[0].onmessage({ data: WORKER_CAPABILITIES });
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(harness.workers[0].terminated, true);
  assert.equal(harness.scripts.length, 1);
  assert.equal(harness.fetches.length, 1);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.getWebglProbeCount(), 0);
});

test("forced colors changing during worker startup blocks requests and recovers from the cached result", async () => {
  for (const forcedColors of [false, true]) {
    const harness = createContext({
      ...CAPABLE,
      forcedColors,
      workerProbe: true,
      sceneLoader: true,
    });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    if (forcedColors) harness.forcedColorsQuery.setMatches(false);
    const ready = harness.context.window.BabelSite.ensureSceneReady();
    assert.equal(harness.workers.length, 1);
    harness.forcedColorsQuery.setMatches(true);
    harness.workers[0].onmessage({ data: WORKER_CAPABILITIES });
    assert.equal(await ready, false);
    assert.equal(harness.scripts.length, 0);
    assert.equal(harness.fetches.length, 0);
    assert.ok(!harness.events.includes("loader:begin"));

    harness.forcedColorsQuery.setMatches(false);
    assert.equal(
      harness.scripts.length,
      1,
      "the media change itself recovers after an interrupted worker wait",
    );
    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
    await harness.flushIdleCallbacks();
    assert.equal(harness.workers.length, 1, "recovery reuses the frozen worker result");
    assert.equal(harness.getWebglProbeCount(), 0);
    assert.equal(harness.getSceneInitCount(), 1);
    assert.equal(harness.fetches.length, 1);
  }
});

test("forced colors blocks WebGL, scene chunks, models and the loading line even with overrides", async () => {
  for (const search of [
    "",
    "?quality=high",
    "?quality=balanced",
    "?sceneDebug=1",
    "?quality=low&sceneDebug=1",
  ]) {
    const harness = createContext({
      ...CAPABLE,
      forcedColors: true,
      modulePreloads: ["/scripts/scene.shared.0123abcd.js"],
      sceneLoader: true,
      search,
    });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    await harness.flushIdleCallbacks();

    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false, search);
    assert.equal(harness.host.hidden, true);
    assert.equal(harness.getWebglProbeCount(), 0, "forced colors exits before probing WebGL");
    assert.equal(harness.scripts.length, 0);
    assert.equal(harness.links.length, 0);
    assert.equal(harness.fetches.length, 0);
    assert.equal(harness.getSceneInitCount(), 0);
    assert.ok(!harness.events.includes("loader:begin"), "the blocked path starts no loading line");
  }
});

test("forced colors enabled before delayed startup can recover after it clears", async () => {
  const harness = createContext({ ...CAPABLE, sceneLoader: true });
  await loadMainWithQuality(harness.context);
  harness.dispatchDOMContentLoaded();

  // No preference was active when boot initially considered recovery.
  harness.forcedColorsQuery.setMatches(true);
  await harness.flushIdleCallbacks();
  assert.equal(harness.host.hidden, true);
  assert.equal(harness.getWebglProbeCount(), 0);
  assert.equal(harness.scripts.length, 0);
  assert.equal(harness.fetches.length, 0);
  assert.ok(!harness.events.includes("loader:begin"));

  harness.forcedColorsQuery.setMatches(false);
  assert.equal(harness.getScriptAppendCount(), 1, "clearing the preference starts recovery itself");
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(harness.host.hidden, false);
  assert.equal(harness.getScriptAppendCount(), 1);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.fetches.length, 1);
});

test("clearing forced colors shares one pending startup with scheduled boot and concurrent callers", async () => {
  const harness = createContext({
    ...CAPABLE,
    forcedColors: true,
    modulePreloads: ["/scripts/scene.shared.0123abcd.js"],
    sceneLoader: true,
    scriptOutcomes: ["pending"],
  });
  await loadMainWithQuality(harness.context);
  harness.dispatchDOMContentLoaded();

  // The preference clears before the first-paint callback gets its turn.
  harness.forcedColorsQuery.setMatches(false);
  assert.equal(
    harness.getScriptAppendCount(),
    1,
    "recovery starts before the queued idle callback",
  );
  const boot = harness.flushIdleCallbacks();
  const concurrent = harness.context.window.BabelSite.ensureSceneReady();
  harness.forcedColorsQuery.setMatches(false);
  harness.motionQuery.setMatches(false);
  harness.dataQuery.setMatches(false);
  harness.connection.setSaveData(false);

  assert.equal(harness.getScriptAppendCount(), 1);
  assert.equal(harness.links.length, 1);
  assert.equal(harness.fetches.length, 1);
  assert.equal(harness.loaderCalls.filter(({ method }) => method === "begin").length, 1);
  assert.equal(harness.getSceneInitCount(), 0, "initialization waits for the scene bundle");

  harness.loadPendingScripts();
  await boot;
  assert.equal(await concurrent, true);
  assert.equal(harness.host.hidden, false);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.deepEqual(
    harness.loaderCalls.filter(({ method }) => method === "stage").map(({ name }) => name),
    ["bundle", "init"],
  );

  harness.forcedColorsQuery.setMatches(true);
  harness.forcedColorsQuery.setMatches(false);
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(
    harness.getScriptAppendCount(),
    1,
    "later preference changes never reload the scene",
  );
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.fetches.length, 1);
});

test("queued boot preserves a recovered scene when forced colors turns on again before idle", async () => {
  const harness = createContext({ ...CAPABLE, forcedColors: true, sceneLoader: true });
  await loadMainWithQuality(harness.context);
  harness.dispatchDOMContentLoaded();

  harness.forcedColorsQuery.setMatches(false);
  assert.equal(harness.getScriptAppendCount(), 1);
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(harness.host.hidden, false);

  // Recovery has already completed and removed its listeners. A queued boot
  // must leave the initialized host available once CSS shows the scene again.
  harness.forcedColorsQuery.setMatches(true);
  await harness.flushIdleCallbacks();
  harness.forcedColorsQuery.setMatches(false);

  assert.equal(harness.host.hidden, false, "clearing forced colors can show the initialized scene");
  assert.equal(harness.getScriptAppendCount(), 1);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.fetches.length, 1);
  assert.equal(harness.loaderCalls.filter(({ method }) => method === "begin").length, 1);
});

test("forced-colors recovery waits for every unoverridden static preference to clear", async () => {
  for (const order of [
    ["colors", "motion", "data", "connection"],
    ["connection", "data", "motion", "colors"],
  ]) {
    const harness = createContext({
      ...CAPABLE,
      forcedColors: true,
      reducedMotion: true,
      saveData: true,
    });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    await harness.flushIdleCallbacks();
    const clear = {
      colors: () => harness.forcedColorsQuery.setMatches(false),
      motion: () => harness.motionQuery.setMatches(false),
      data: () => harness.dataQuery.setMatches(false),
      connection: () => harness.connection.setSaveData(false),
    };
    for (const preference of order.slice(0, -1)) {
      clear[preference]();
      assert.equal(harness.scripts.length, 0, `${preference}: another static preference remains`);
      assert.equal(harness.getWebglProbeCount(), 0);
      assert.equal(harness.fetches.length, 0);
    }
    clear[order.at(-1)]();
    assert.equal(harness.getScriptAppendCount(), 1, "the last preference change starts recovery");
    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
    assert.equal(harness.scripts.length, 1);
    assert.equal(harness.getSceneInitCount(), 1);
  }
});

test("forced-colors recovery preserves explicit quality and debug preference overrides", async () => {
  for (const options of [
    { reducedMotion: true, saveData: true, search: "?quality=high" },
    { reducedMotion: true, saveData: true, search: "?quality=balanced" },
    { reducedMotion: true, search: "?sceneDebug=1" },
  ]) {
    const harness = createContext({ ...CAPABLE, ...options, forcedColors: true });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    await harness.flushIdleCallbacks();
    assert.equal(harness.scripts.length, 0);

    harness.forcedColorsQuery.setMatches(false);
    assert.equal(harness.getScriptAppendCount(), 1, "the override permits automatic recovery");
    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true, options.search);
    assert.equal(harness.scripts.length, 1);
    assert.equal(harness.getSceneInitCount(), 1);
  }
});

test("clearing forced colors keeps low quality and reduced-data debug visits static", async () => {
  for (const options of [
    { search: "?quality=low" },
    { search: "?quality=low&sceneDebug=1" },
    { maxTextureSize: 2048 },
    { saveData: true, search: "?sceneDebug=1" },
  ]) {
    const harness = createContext({
      ...CAPABLE,
      ...options,
      forcedColors: true,
      sceneLoader: true,
    });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    await harness.flushIdleCallbacks();
    assert.equal(harness.getWebglProbeCount(), 0);

    harness.forcedColorsQuery.setMatches(false);
    assert.equal(
      harness.getWebglProbeCount(),
      1,
      "recovery rechecks capabilities and the low tier",
    );
    assert.equal(
      await harness.context.window.BabelSite.ensureSceneReady(),
      false,
      JSON.stringify(options),
    );
    assert.equal(harness.host.hidden, true);
    assert.equal(harness.scripts.length, 0);
    assert.equal(harness.links.length, 0);
    assert.equal(harness.fetches.length, 0);
    assert.ok(!harness.events.includes("loader:begin"));
  }
});

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

test("preferences interrupting a pending bundle rearm recovery and initialize the cached scene once", async () => {
  for (const preference of ["connection", "data", "motion", "colors"])
    for (const initiallyBlocked of [false, true]) {
      const tiers = [];
      const harness = createContext({
        ...CAPABLE,
        modulePreloads: ["/scripts/scene.shared.0123abcd.js"],
        scriptOutcomes: ["pending"],
        initResult(scene) {
          // The real scene declines the low tier selected by this actual
          // quality helper. navigator.connection alone carries Save-Data.
          const tier = scene.createSceneQualityState({ caps: CAPABLE }).initialTier;
          tiers.push(tier);
          return tier !== "low";
        },
      });
      const change = {
        connection: (value) => harness.connection.setSaveData(value),
        data: (value) => harness.dataQuery.setMatches(value),
        motion: (value) => harness.motionQuery.setMatches(value),
        colors: (value) => harness.forcedColorsQuery.setMatches(value),
      }[preference];
      change(initiallyBlocked);
      await loadMainWithQuality(harness.context);
      harness.dispatchDOMContentLoaded();
      const boot = harness.flushIdleCallbacks();
      if (initiallyBlocked) {
        await boot;
        assert.equal(harness.scripts.length, 0);
        change(false);
      }
      const pending = harness.context.window.BabelSite.ensureSceneReady();
      assert.equal(harness.getScriptAppendCount(), 1);
      change(true);
      harness.loadPendingScripts();
      assert.equal(await pending, false);
      await boot;
      assert.equal(harness.getSceneInitCount(), 0, `${preference}: recheck before initializing`);
      assert.equal(harness.host.hidden, true);
      assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false);
      assert.equal(harness.getSceneInitCount(), 0, "a cached entry still respects the gate");
      assert.ok(
        harness.fetches.every(({ options }) => !options.signal.aborted),
        "retain reusable requests",
      );

      change(false);
      assert.equal(
        harness.getSceneInitCount(),
        1,
        `${preference}: the change handler recovers itself`,
      );
      assert.equal(harness.host.hidden, false);
      assert.deepEqual(tiers, ["high"]);
      for (let i = 0; i < 3; i++) {
        change(false);
        assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
      }
      assert.equal(harness.getSceneInitCount(), 1);
      assert.equal(harness.getScriptAppendCount(), 1);
      assert.equal(harness.links.length, 1);
      assert.equal(harness.fetches.length, 1, "recovery makes no duplicate model requests");
      for (const request of harness.fetches) assert.equal(request.options.signal.aborted, false);
    }
});

test("visibility recovery does not prefetch models under a preference enabled during bundle loading", async () => {
  for (const preference of ["data", "motion", "colors"])
    for (const shownBeforeBundle of [false, true]) {
      const harness = createContext({ ...CAPABLE, hidden: true, scriptOutcomes: ["pending"] });
      await loadMainWithQuality(harness.context);
      const ready = harness.context.window.BabelSite.ensureSceneReady();
      assert.equal(
        harness.visibilityListenerCount,
        2,
        "prefetch and opening budget observe visibility",
      );
      const change = {
        data: (value) => harness.connection.setSaveData(value),
        motion: (value) => harness.motionQuery.setMatches(value),
        colors: (value) => harness.forcedColorsQuery.setMatches(value),
      }[preference];
      change(true);
      if (shownBeforeBundle) harness.setHidden(false);
      harness.loadPendingScripts();
      assert.equal(await ready, false);
      harness.setHidden(false);
      assert.equal(harness.visibilityListenerCount, 0);
      assert.equal(harness.fetches.length, 0);
      change(false);
      assert.equal(harness.getSceneInitCount(), 1);
      assert.equal(harness.getScriptAppendCount(), 1);
    }
});

test("a cached scene's preference-driven low-tier decline can rearm another eligible transition", async () => {
  const tiers = [];
  const harness = createContext({
    ...CAPABLE,
    reducedMotion: true,
    scriptOutcomes: ["pending"],
    initResult(scene) {
      // Exercise a change observed by the actual initializer after main's
      // last gate check; only the first cached initialization declines.
      if (tiers.length === 0) harness.connection.setSaveData(true);
      const tier = scene.createSceneQualityState({ caps: CAPABLE }).initialTier;
      tiers.push(tier);
      return tier !== "low";
    },
  });
  await loadMainWithQuality(harness.context);
  harness.dispatchDOMContentLoaded();
  await harness.flushIdleCallbacks();
  harness.motionQuery.setMatches(false);
  const ready = harness.context.window.BabelSite.ensureSceneReady();
  harness.connection.setSaveData(true);
  harness.loadPendingScripts();
  assert.equal(await ready, false);
  harness.connection.setSaveData(false);
  assert.deepEqual(tiers, ["low"]);
  assert.equal(harness.host.hidden, true);
  harness.connection.setSaveData(false);
  assert.deepEqual(tiers, ["low", "high"]);
  assert.equal(harness.host.hidden, false);
  assert.equal(harness.getScriptAppendCount(), 1);
  assert.equal(harness.fetches.length, 1);
  assert.ok(harness.fetches.every(({ options }) => !options.signal.aborted));
});

test("eligible cached-entry recovery restarts the retired loading line through initialization", async () => {
  let initializedWithVisibleHost = false;
  const harness = createContext({
    ...CAPABLE,
    sceneLoader: true,
    scriptOutcomes: ["pending"],
    initResult() {
      assert.equal(
        harness.host.hidden,
        false,
        "the recovered renderer can measure its visible host",
      );
      initializedWithVisibleHost = true;
      return true;
    },
  });
  harness.connection.setSaveData(true);
  await loadMainWithQuality(harness.context);
  harness.dispatchDOMContentLoaded();
  await harness.flushIdleCallbacks();
  assert.ok(!harness.events.includes("loader:begin"));
  harness.connection.setSaveData(false);
  const pending = harness.context.window.BabelSite.ensureSceneReady();
  harness.connection.setSaveData(true);
  harness.loadPendingScripts();
  assert.equal(await pending, false);
  const firstBegin = harness.events.indexOf("loader:begin");
  assert.deepEqual(
    harness.events.slice(firstBegin).filter((event) => event.startsWith("loader:")),
    ["loader:begin", "loader:bundle", "loader:end:static"],
  );
  harness.connection.setSaveData(false);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(initializedWithVisibleHost, true);
  assert.deepEqual(
    harness.events.slice(firstBegin).filter((event) => event.startsWith("loader:")),
    [
      "loader:begin",
      "loader:bundle",
      "loader:end:static",
      "loader:begin",
      "loader:bundle",
      "loader:init",
    ],
  );
  assert.deepEqual(
    harness.loaderCalls.filter(({ method }) => method === "begin").map(({ tier }) => tier),
    ["high", "high"],
  );
  harness.connection.setSaveData(false);
  assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
  assert.equal(harness.loaderCalls.filter(({ method }) => method === "begin").length, 2);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.getScriptAppendCount(), 1);
  assert.equal(harness.fetches.length, 1);
});

test("bundle-time preference checks preserve explicit quality and debug controls", async () => {
  for (const search of ["?quality=high", "?quality=balanced", "?sceneDebug=1"])
    for (const preference of ["data", "motion", "colors"]) {
      const tiers = [];
      const harness = createContext({
        ...CAPABLE,
        search,
        scriptOutcomes: ["pending"],
        initResult(scene) {
          const tier = scene.createSceneQualityState({ caps: CAPABLE }).initialTier;
          tiers.push(tier);
          return tier !== "low";
        },
      });
      await loadMainWithQuality(harness.context);
      const ready = harness.context.window.BabelSite.ensureSceneReady();
      const change = {
        data: (value) => harness.connection.setSaveData(value),
        motion: (value) => harness.motionQuery.setMatches(value),
        colors: (value) => harness.forcedColorsQuery.setMatches(value),
      }[preference];
      change(true);
      harness.loadPendingScripts();
      const debugData = search === "?sceneDebug=1" && preference === "data";
      assert.equal(await ready, preference !== "colors" && !debugData);
      assert.equal(harness.host.hidden, preference === "colors" || debugData);
      const beforeClear = harness.getSceneInitCount();
      change(false);
      assert.equal(harness.getSceneInitCount(), preference === "colors" ? 1 : beforeClear);
      if (debugData) {
        assert.deepEqual(tiers, ["low"]);
        assert.ok(harness.fetches.every(({ options }) => options.signal.aborted));
      } else {
        assert.deepEqual(tiers, [search === "?quality=balanced" ? "balanced" : "high"]);
        assert.equal(harness.getSceneInitCount(), 1);
      }
      assert.equal(harness.getScriptAppendCount(), 1);
    }
});

test("bundle and non-preference initialization failures do not create automatic retry loops", async () => {
  for (const failBundle of [false, true]) {
    const harness = createContext({
      ...CAPABLE,
      reducedMotion: true,
      logger: { warn() {} },
      scriptOutcomes: ["pending"],
      initResult: false,
    });
    await loadMainWithQuality(harness.context);
    harness.dispatchDOMContentLoaded();
    await harness.flushIdleCallbacks();
    harness.motionQuery.setMatches(false);
    const pending = harness.context.window.BabelSite.ensureSceneReady();
    if (failBundle) {
      harness.forcedColorsQuery.setMatches(true);
      assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), false);
      harness.scripts[0].dispatch("error", new Error("Simulated pending bundle failure"));
    } else harness.loadPendingScripts();
    assert.equal(await pending, false);
    harness.forcedColorsQuery.setMatches(false);
    const initializations = harness.getSceneInitCount();
    for (let i = 0; i < 3; i++) {
      harness.motionQuery.setMatches(true);
      harness.motionQuery.setMatches(false);
      harness.connection.setSaveData(false);
      harness.forcedColorsQuery.setMatches(false);
    }
    assert.equal(harness.getScriptAppendCount(), 1);
    assert.equal(harness.getSceneInitCount(), initializations);
    assert.equal(harness.host.hidden, true);
    assert.ok(harness.fetches.every(({ options }) => options.signal.aborted));
  }
});

test("initialization throwing after a bundle-time preference interruption retires without retrying", async () => {
  const warnings = [];
  const harness = createContext({
    ...CAPABLE,
    scriptOutcomes: ["pending"],
    logger: { warn: (...args) => warnings.push(args) },
    initResult() {
      throw new Error("Simulated initialized renderer failure");
    },
  });
  await loadMainWithQuality(harness.context);
  const ready = harness.context.window.BabelSite.ensureSceneReady();
  harness.motionQuery.setMatches(true);
  harness.loadPendingScripts();
  assert.equal(await ready, false);
  harness.motionQuery.setMatches(false);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.host.hidden, true);
  assert.equal(warnings.length, 1);
  assert.ok(harness.fetches.every(({ options }) => options.signal.aborted));
  harness.motionQuery.setMatches(true);
  harness.motionQuery.setMatches(false);
  assert.equal(harness.getSceneInitCount(), 1);
  assert.equal(harness.getScriptAppendCount(), 1);
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

test("the live scene prioritizes its startup tree after requesting the bundle", async () => {
  for (const [options, tier] of [
    [{}, "high"],
    [{ hardwareConcurrency: 4 }, "balanced"],
    [{ search: "?quality=balanced" }, "balanced"],
    [{ reducedMotion: true, search: "?quality=high" }, "high"],
  ]) {
    const harness = createContext({ ...CAPABLE, ...options });
    await loadMainWithQuality(harness.context);

    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);

    const urls = [ARCHITECTURE_URLS[tier].tree];
    assert.deepEqual(harness.events, ["script", ...urls.map((url) => `fetch:${url}`)]);
    for (const { options: init } of harness.fetches) {
      assert.equal(init.priority, "high");
      assert.equal(init.signal.aborted, false);
    }
    const prefetched = harness.context.window.BabelSite.scene.prefetched;
    assert.deepEqual([...prefetched.keys()], urls);
    assert.equal(typeof prefetched.get(urls[0]).abort, "function");
    assert.equal(typeof prefetched.get(urls[0]).response.then, "function");

    assert.equal(await harness.context.window.BabelSite.ensureSceneReady(), true);
    assert.equal(harness.fetches.length, 1, "an initialized scene requests nothing again");
  }
});

test("selected tree openings prefetch tree then lantern, while explicit Watch keeps background priority", async () => {
  for (const [options, roles, priority] of [
    [{ search: "" }, ["tree", "lantern"], "high"],
    [{ search: "?view=tree&angle=2" }, ["tree", "lantern"], "high"],
    [{ search: "?view=watch" }, ["tree"], "low"],
    [{ search: "?view=unknown" }, ["tree"], "low"],
    [{ search: "", selection: { view: "watch" } }, ["tree"], "low"],
    [{ search: "?view=watch", selection: { view: "tree", angle: 1 } }, ["tree", "lantern"], "high"],
  ]) {
    const harness = createContext({ ...CAPABLE, prefetchLantern: true, ...options });
    await loadMainWithQuality(harness.context);
    await harness.context.window.BabelSite.ensureSceneReady();
    assert.deepEqual(
      harness.fetches.map(({ url }) => /\/(tree|lantern)-/.exec(url)[1]),
      roles,
    );
    assert.ok(harness.fetches.every(({ options: init }) => init.priority === priority));
    const entries = harness.context.window.BabelSite.scene.prefetched;
    assert.equal(entries.size, roles.length);
    entries.forEach((entry) => entry.abort());
    assert.ok(harness.fetches.every(({ options: init }) => init.signal.aborted));
  }
});

test("a visit naming no view or angle opens on Lantern study or The watch by chance, rolled once before the loading line begins", async () => {
  // Rolled below 0.5, Lantern study: its tree and lantern come early, ahead of the rest.
  for (const [random, opening, roles, priority] of [
    [0.25, ["tree", 1], ["tree", "lantern"], "high"],
    [0.75, ["watch", 0], ["tree"], "low"],
  ]) {
    const harness = createContext({ ...CAPABLE, prefetchLantern: true, sceneLoader: true, random });
    await loadMainWithQuality(harness.context);
    await harness.context.window.BabelSite.ensureSceneReady();
    const begins = harness.loaderCalls.filter(({ method }) => method === "begin");
    assert.equal(begins.length, 1);
    assert.deepEqual(begins[0].opening, opening, `rolled ${random}`);
    assert.deepEqual(
      harness.fetches.map(({ url }) => /\/(tree|lantern)-/.exec(url)[1]),
      roles,
    );
    assert.ok(harness.fetches.every(({ options: init }) => init.priority === priority));
    const { cinematicSelection, cinematicAngle } = harness.context.window.BabelSite.scene;
    assert.deepEqual([cinematicSelection, cinematicAngle], opening, "the scene keeps it");
  }
  // One roll a visit, however often the scene is asked for.
  let rolls = 0;
  const once = createContext({ ...CAPABLE, sceneLoader: true, random: () => (rolls++, 0.75) });
  await loadMainWithQuality(once.context);
  await once.context.window.BabelSite.ensureSceneReady();
  await once.context.window.BabelSite.ensureSceneReady();
  assert.equal(rolls, 1);
  // An address naming a view or an angle, or a script's selection, is never rolled.
  const never = () => {
    throw new Error("an opening the address or a script names is not rolled");
  };
  for (const options of [
    { search: "?view=tree&angle=2" },
    { search: "?view=watch" },
    { search: "?angle=1" },
    { selection: { view: "tree", angle: 3 } },
  ]) {
    const harness = createContext({ ...CAPABLE, sceneLoader: true, random: never, ...options });
    await loadMainWithQuality(harness.context);
    await harness.context.window.BabelSite.ensureSceneReady();
    const [begin] = harness.loaderCalls.filter(({ method }) => method === "begin");
    assert.deepEqual(
      begin.opening,
      options.selection ? ["tree", 3] : [null, null],
      JSON.stringify(options),
    );
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

test("a failed scene bundle or initialization releases both early opening models", async () => {
  for (const options of [
    { logger: { warn() {} }, scriptOutcomes: ["error", "load"] },
    { initResult: false },
  ]) {
    const harness = createContext({ ...CAPABLE, prefetchLantern: true, ...options });
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
  assert.equal(retry.fetches.length, 1, "a retried bundle leaves model requests to the scene");
});

test("a hidden page requests models only if it is shown while the bundle still loads", async () => {
  const urls = [ARCHITECTURE_URLS.high.tree];
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
    "shown before the scene initializes, the page requests the startup tier's tree",
  );
  assert.equal(
    shown.visibilityListenerCount,
    1,
    "only the pending opening budget still observes visibility",
  );
  shown.loadPendingScripts();
  assert.equal(await ready, true);
  assert.equal(
    shown.visibilityListenerCount,
    0,
    "settling startup releases its remaining observer",
  );
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

test("stalled entry or shared-chunk downloads fail without a loader and cannot initialize late", async () => {
  for (const modulePreloads of [[], ["/scripts/scene.shared.0123abcd.js"]])
    for (const sceneLoader of [false, true]) {
      const warnings = [],
        h = createContext({
          ...CAPABLE,
          prefetchLantern: true,
          sceneLoader,
          modulePreloads,
          scriptOutcomes: ["pending"],
          logger: { warn: (...args) => warnings.push(args) },
        });
      await loadMainWithQuality(h.context);
      let finished = false;
      const ready = h.context.window.BabelSite.ensureSceneReady().then((result) => {
        finished = true;
        return result;
      });
      h.advance(14999);
      await Promise.resolve();
      assert.equal(finished, false);
      h.advance(1);
      assert.equal(await ready, false);
      assert.match(warnings[0][1].message, /Opening stalled/);
      assert.equal(h.host.hidden, true);
      assert.equal(h.pendingTimers, 0);
      assert.equal(h.visibilityListenerCount, 0);
      assert.equal(h.fetches.length, 2);
      assert.ok(h.fetches.every(({ options }) => options.signal.aborted));
      assert.equal(h.context.window.BabelSite.scene.prefetched.size, 0);
      h.loadPendingScripts();
      assert.equal(await h.context.window.BabelSite.ensureSceneReady(), false);
      h.forcedColorsQuery.setMatches(true);
      h.forcedColorsQuery.setMatches(false);
      assert.equal(
        h.getSceneInitCount(),
        0,
        "a late evaluated module cannot revive an expired attempt",
      );
      assert.equal(h.getScriptAppendCount(), 1);
    }
});

test("download progress cannot extend the one total visible opening deadline", async () => {
  const warnings = [],
    h = createContext({
      ...CAPABLE,
      sceneLoader: true,
      scriptOutcomes: ["pending"],
      logger: { warn: (...args) => warnings.push(args) },
    });
  await loadMainWithQuality(h.context);
  const ready = h.context.window.BabelSite.ensureSceneReady();
  for (let second = 5; second <= 25; second += 5) {
    h.advance(5000);
    h.setLoaderProgress(second / 100);
  }
  h.advance(4999);
  assert.equal(h.host.hidden, false);
  h.advance(1);
  assert.equal(await ready, false);
  assert.match(warnings[0][1].message, /Opening deadline/);
  assert.equal(h.pendingTimers, 0);
});

test("the scene inherits only the opening time left after downloads and synchronous setup", async () => {
  let remaining;
  const h = createContext({
    ...CAPABLE,
    sceneLoader: true,
    scriptOutcomes: ["pending"],
    initResult(scene) {
      h.advance(5000);
      remaining = scene.takeOpeningBudget();
      return true;
    },
  });
  await loadMainWithQuality(h.context);
  const ready = h.context.window.BabelSite.ensureSceneReady();
  h.advance(9000);
  h.setLoaderProgress(0.2);
  h.advance(9000);
  h.loadPendingScripts();
  assert.equal(await ready, true);
  assert.equal(remaining, 7000);
  assert.equal(h.pendingTimers, 0);
  assert.equal(h.visibilityListenerCount, 0);
  const failures = [],
    gate = createOpeningPreparation({
      stages: ["shaders"],
      totalMs: remaining,
      fail: (reason) => failures.push(reason),
    });
  gate.tick(0, true);
  gate.tick(6999, true);
  assert.deepEqual(failures, []);
  gate.tick(7000, true);
  assert.deepEqual(failures, ["deadline"], "download and preparation share thirty seconds");
});

test("background and static-preference pauses preserve the consumed opening budget on recovery", async () => {
  let remaining;
  const h = createContext({
    ...CAPABLE,
    scriptOutcomes: ["pending"],
    initResult(scene) {
      remaining = scene.takeOpeningBudget();
      return true;
    },
  });
  await loadMainWithQuality(h.context);
  const ready = h.context.window.BabelSite.ensureSceneReady();
  h.advance(5000);
  h.setHidden(true);
  h.advance(120000);
  assert.equal(h.pendingTimers, 0);
  h.setHidden(false);
  h.advance(2000);
  h.forcedColorsQuery.setMatches(true);
  h.advance(120000);
  assert.equal(h.pendingTimers, 0);
  h.loadPendingScripts();
  assert.equal(await ready, false);
  h.forcedColorsQuery.setMatches(false);
  assert.equal(h.getSceneInitCount(), 1);
  assert.equal(remaining, 23000);
  assert.equal(h.getScriptAppendCount(), 1);
  assert.ok(h.fetches.every(({ options }) => !options.signal.aborted));
  assert.equal(h.pendingTimers, 0);
  assert.equal(h.visibilityListenerCount, 0);
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
  // The early tree request starts after the bundle request, inside the run.
  const prefetching = createContext({ ...CAPABLE, sceneLoader: true });
  await loadMainWithQuality(prefetching.context);
  await prefetching.context.window.BabelSite.ensureSceneReady();
  const urls = [ARCHITECTURE_URLS.high.tree];
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
  const url = ARCHITECTURE_URLS.high.tree;
  assert.deepEqual([...prefetched.keys()], [url]);
  const counted = await prefetched.get(url).response;
  assert.equal(counted, harness.tracked.get(url), "the scene takes what track() returned");
  assert.equal(counted.copyOf.url, url);
  assert.deepEqual(
    harness.loaderCalls.filter(({ method }) => method === "track").map((call) => call.url),
    [url],
  );
  // Without the line the early response is the network's own.
  const plain = createContext({ ...CAPABLE, prefetch: true, respond: true });
  await loadMainWithQuality(plain.context);
  await plain.context.window.BabelSite.ensureSceneReady();
  const response = await plain.context.window.BabelSite.scene.prefetched.get(url).response;
  assert.equal(response.url, url);
  assert.equal(response.ok, true);
});

// Contact boots through main.js, which waits for the parsed document and
// then asks contact.js to enhance the footer. contact.test.mjs covers the
// disclosure itself; these checks cover the boot timing around it.

const contactSource = await readFile(new URL("../src/ui/contact.js", import.meta.url), "utf8");

const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

const qualitySource = await readFile(new URL("../src/scene/quality.js", import.meta.url), "utf8");

function createFixture({ readyState = "complete" } = {}) {
  const dom = createContactDom({ readyState });
  const quietQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  Object.assign(dom.window, {
    matchMedia: () => quietQuery,
    // The deferred scene load is outside these checks.
    requestIdleCallback() {},
  });
  dom.window.BabelSite.ui.initHeroChrome = () => {};
  return {
    ...dom,
    boot() {
      const context = vm.createContext({
        window: dom.window,
        document: dom.document,
        navigator: {},
        URLSearchParams,
        resolveSceneOpening,
        createOpeningPreparation,
      });
      vm.runInContext(qualitySource, context, { filename: "src/scene/quality.js" });
      vm.runInContext(contactSource, context, { filename: "src/ui/contact.js" });
      vm.runInContext(classicSource(mainSource), context, { filename: "src/main.js" });
    },
  };
}

function assertLinksAvailable(fixture) {
  assert.equal(fixture.toggle.hidden, true, "Contact's button stays hidden");
  assert.equal(fixture.links.hidden, false, "the email and LinkedIn stay on show");
}

test("a loading document keeps the no-JS links until DOMContentLoaded, then enhances once", () => {
  const fixture = createFixture({ readyState: "loading" });
  fixture.boot();
  assertLinksAvailable(fixture);
  assert.equal(fixture.document.listenerCount("DOMContentLoaded"), 1);
  fixture.document.readyState = "interactive";
  fixture.document.dispatch("DOMContentLoaded");
  assert.equal(fixture.toggle.hidden, false);
  assert.equal(fixture.links.hidden, true);
  fixture.document.dispatch("DOMContentLoaded");
  assert.equal(fixture.toggle.listenerCount("click"), 1);
});

test("a delayed boot never hides a link the visitor has focused", () => {
  for (const link of ["email", "linkedin"]) {
    const fixture = createFixture({ readyState: "loading" });
    fixture.boot();
    fixture.document.activeElement = fixture[link];
    fixture.document.dispatch("DOMContentLoaded");
    assertLinksAvailable(fixture);
    assert.equal(fixture.document.activeElement, fixture[link]);
  }
});

test("an already parsed document enhances without waiting for another load event", () => {
  const fixture = createFixture({ readyState: "interactive" });
  const previousFocus = fixture.document.activeElement;
  fixture.boot();
  assert.equal(fixture.toggle.hidden, false);
  assert.equal(fixture.links.hidden, true);
  assert.equal(fixture.document.listenerCount("DOMContentLoaded"), 0);
  assert.equal(fixture.document.activeElement, previousFocus);
});
