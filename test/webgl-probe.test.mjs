import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/shared/webgl-probe.js", import.meta.url), "utf8");
const workerSource = await readFile(
  new URL("../src/webgl-probe-worker.js", import.meta.url),
  "utf8",
);
const capabilities = {
  available: true,
  softwareRenderer: false,
  maxTextureSize: 8192,
  maxAnisotropy: 16,
};

function harness({ workers = true, offscreen = true, throwWorker = false } = {}) {
  const created = [];
  const timers = new Map();
  let probes = 0;
  let released = 0;
  const options = [];
  const gl = {
    MAX_TEXTURE_SIZE: 1,
    RENDERER: 2,
    getParameter: (key) => (key === 1 ? 4096 : key === 2 ? "GPU" : 8),
    getExtension(name) {
      if (name === "WEBGL_lose_context") return { loseContext: () => released++ };
      if (name === "EXT_texture_filter_anisotropic") return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 3 };
      return null;
    },
  };
  const window = { BabelSite: {}, WebGLRenderingContext() {}, WebGL2RenderingContext() {} };
  if (offscreen) window.OffscreenCanvas = function OffscreenCanvas() {};
  if (workers)
    window.Worker = class Worker {
      constructor(url) {
        if (throwWorker) throw new Error("worker blocked");
        this.url = url;
        this.terminations = 0;
        created.push(this);
      }
      terminate() {
        this.terminations++;
      }
    };
  const context = {
    window,
    document: {
      createElement: () => ({
        getContext(kind, attributes) {
          probes++;
          options.push([kind, attributes]);
          return gl;
        },
      }),
    },
    __BABEL_WEBGL_PROBE_URL__: "/scripts/webgl-probe.0123abcd.js",
    setTimeout(callback) {
      const id = timers.size + 1;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(source, context);
  return {
    shared: window.BabelSite.shared,
    created,
    timers,
    options,
    get probes() {
      return probes;
    },
    get released() {
      return released;
    },
  };
}

test("the worker populates the existing frozen capability cache without a document context", async () => {
  const h = harness();
  const first = h.shared.prepareWebGLCapabilities();
  assert.equal(
    h.shared.prepareWebGLCapabilities(),
    first,
    "concurrent preparation shares one worker",
  );
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].url, "/scripts/webgl-probe.0123abcd.js");
  assert.equal(h.probes, 0);
  h.created[0].onmessage({ data: capabilities });
  const result = await first;
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.maxTextureSize, 8192);
  assert.equal(h.shared.getWebGLCapabilities(), result);
  assert.equal(h.shared.prepareWebGLCapabilities(), result);
  assert.equal(h.shared.supportsWebGL(), true);
  assert.equal(h.probes, 0);
  assert.equal(h.created[0].terminations, 1);
  assert.equal(h.timers.size, 0);
  h.created[0].onerror();
  assert.equal(h.created[0].terminations, 1, "late events do not settle or clean up twice");
});

test("unsupported worker features preserve the synchronous document probe and its cache", () => {
  for (const options of [{ workers: false }, { offscreen: false }, { throwWorker: true }]) {
    const h = harness(options);
    const result = h.shared.prepareWebGLCapabilities();
    assert.equal(h.probes, 1);
    assert.equal(h.released, 1);
    assert.equal(h.shared.getWebGLCapabilities().maxTextureSize, 4096);
    assert.equal(h.probes, 1);
    assert.equal(h.timers.size, 0);
    if (!options.throwWorker) assert.equal(result.available, true);
    assert.equal(h.options[0][0], "webgl2");
    assert.equal(h.options[0][1].powerPreference, "default");
  }
});

test("failed, unavailable, malformed and stalled workers fall back once and always terminate", async () => {
  for (const outcome of ["error", "messageerror", "unavailable", "malformed", "timeout"]) {
    const h = harness();
    const ready = h.shared.prepareWebGLCapabilities();
    const worker = h.created[0];
    if (outcome === "error") worker.onerror();
    else if (outcome === "messageerror") worker.onmessageerror();
    else if (outcome === "unavailable") worker.onmessage({ data: { available: false } });
    else if (outcome === "malformed")
      worker.onmessage({ data: { ...capabilities, maxTextureSize: "8192" } });
    else [...h.timers.values()][0]();
    const result = await ready;
    assert.equal(result.maxTextureSize, 4096, outcome);
    assert.equal(h.probes, 1, outcome);
    assert.equal(h.released, 1, outcome);
    assert.equal(worker.terminations, 1, outcome);
    assert.equal(h.timers.size, 0, outcome);
  }
});

test("a synchronous result obtained during preparation remains authoritative", async () => {
  const h = harness();
  const prepared = h.shared.prepareWebGLCapabilities();
  const synchronous = h.shared.getWebGLCapabilities();
  h.created[0].onmessage({ data: capabilities });
  assert.equal(await prepared, synchronous);
  assert.equal(h.shared.getWebGLCapabilities(), synchronous);
});

test("the worker entry probes OffscreenCanvas with the same software and cleanup rules", () => {
  let probes = 0;
  let released = 0;
  let result;
  const worker = {
    WebGLRenderingContext() {},
    OffscreenCanvas: class OffscreenCanvas {
      constructor(width, height) {
        assert.equal(width, 1);
        assert.equal(height, 1);
      }
      getContext(kind, options) {
        probes++;
        assert.equal(kind, "webgl");
        assert.equal(options.powerPreference, "default");
        return {
          MAX_TEXTURE_SIZE: 1,
          RENDERER: 2,
          getParameter: (key) => (key === 1 ? 8192 : "Google SwiftShader"),
          getExtension: (name) =>
            name === "WEBGL_lose_context" ? { loseContext: () => released++ } : null,
        };
      }
    },
    postMessage(value) {
      result = value;
    },
  };
  const context = vm.createContext(worker);
  vm.runInContext(source, context);
  vm.runInContext(workerSource.replace(/^import[^\n]+\n/m, ""), context);
  assert.equal(probes, 1);
  assert.equal(released, 1);
  assert.equal(result.available, true);
  assert.equal(result.softwareRenderer, true);
  assert.equal(result.maxTextureSize, 8192);
});
