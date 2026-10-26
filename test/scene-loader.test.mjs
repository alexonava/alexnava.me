import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { rule as cssRule } from "./support/css.mjs";
import { LENS_FX } from "../src/scene/postprocess.js";
import { resolveSceneOpening } from "../src/scene/scene-modes.js";

// The title card's loading line (src/ui/scene-loader.js) runs in a fake DOM
// with controllable observers, frames and timers, and Node's own Response and
// ReadableStream for the byte counting.
const source = (
  await readFile(new URL("../src/ui/scene-loader.js", import.meta.url), "utf8")
).replace(/^import \{ resolveSceneOpening \} from .*;\r?\n/m, "");
const SIZES = { high: { tree: 1000 }, balanced: { tree: 400 } };
const TREE = "/images/architecture/tree-high.0123abcd.glb";
// Most ledger fixtures explicitly choose the watch, which has no model.
const TREE_VIEW = "?view=tree";
const settle = () => new Promise((resolve) => setImmediate(resolve));

class FakeClassList {
  #names;
  #onChange;
  constructor(names, onChange) {
    this.#names = new Set(names);
    this.#onChange = onChange;
  }
  contains(name) {
    return this.#names.has(name);
  }
  add(...names) {
    const size = this.#names.size;
    names.forEach((name) => this.#names.add(name));
    if (this.#names.size !== size) this.#onChange();
  }
  remove(...names) {
    let changed = false;
    names.forEach((name) => {
      changed = this.#names.delete(name) || changed;
    });
    if (changed) this.#onChange();
  }
}

function createHarness({
  search = "?view=watch",
  selection,
  sizes = SIZES,
  withLoader = true,
  withStar = true,
  performanceObserver = true,
  hostHidden = false,
} = {}) {
  const events = [];
  const mutationObservers = new Set();
  const timingObservers = new Set();
  const visibilityListeners = new Set();
  const eventListeners = new Map();
  const dispatched = [];
  const frames = [];
  const timers = new Map();
  let nextTimer = 1;
  let now = 0;
  let styleWrites = 0;
  let textWrites = 0;

  function mutate(target, attribute) {
    for (const observer of mutationObservers) {
      if (!observer.targets.get(target)?.attributeFilter.includes(attribute)) continue;
      observer.records.push({ target, attributeName: attribute });
      if (observer.records.length === 1) {
        queueMicrotask(() => {
          const records = observer.records.splice(0);
          if (records.length && mutationObservers.has(observer)) observer.callback(records);
        });
      }
    }
  }

  function element(name, { classes = [], hidden = false, children = [], text: initial = "" } = {}) {
    let isHidden = hidden;
    let transform = "";
    let opacity = "";
    let text = initial;
    const el = {
      name,
      children,
      style: {
        get transform() {
          return transform;
        },
        set transform(value) {
          styleWrites += 1;
          transform = value;
        },
        get opacity() {
          return opacity;
        },
        set opacity(value) {
          styleWrites += 1;
          opacity = value;
        },
      },
      get textContent() {
        return text;
      },
      set textContent(value) {
        textWrites += 1;
        text = String(value);
      },
      get hidden() {
        return isHidden;
      },
      set hidden(value) {
        if (Boolean(value) === isHidden) return;
        isHidden = Boolean(value);
        events.push(`${name}:hidden=${isHidden}`);
        mutate(el, "hidden");
      },
      get offsetWidth() {
        events.push(`${name}:flush`);
        return 240;
      },
      querySelector(selector) {
        for (const child of children) {
          if (child.classList.contains(selector.slice(1))) return child;
          const nested = child.querySelector(selector);
          if (nested) return nested;
        }
        return null;
      },
    };
    el.classList = new FakeClassList(classes, () => {
      events.push(`${name}:class`);
      mutate(el, "class");
    });
    const add = el.classList.add.bind(el.classList);
    el.classList.add = (...names) => {
      names.forEach((token) => events.push(`${name}:+${token}`));
      add(...names);
    };
    return el;
  }

  const fill = element("fill", { classes: ["scene-loader__fill"] });
  const value = element("value", { classes: ["scene-loader__value"], text: "0%" });
  const label = element("label", { classes: ["scene-loader__label"], children: [value] });
  const track = element("track", { classes: ["scene-loader__track"], children: [fill] });
  const loader = element("loader", {
    classes: ["scene-loader"],
    hidden: true,
    children: [label, track],
  });
  // #scene-star: the star's glow and disc, as index.html has them.
  const parts = ["glow", "disc"].map((part, i) =>
    element(`${part}${i}`, { classes: [`scene-star__${part}`] }),
  );
  const star = element("star", { classes: ["scene-star"], hidden: true, children: parts });
  const host = element("host", { classes: ["scene-canvas"], hidden: hostHidden });
  const document = {
    hidden: false,
    getElementById(id) {
      if (id === "scene-loader") return withLoader ? loader : null;
      if (id === "scene-star") return withStar ? star : null;
      if (id === "home-scene") return host;
      return null;
    },
    addEventListener(type, handler) {
      if (type === "visibilitychange") visibilityListeners.add(handler);
    },
    removeEventListener(type, handler) {
      if (type === "visibilitychange") visibilityListeners.delete(handler);
    },
  };

  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
      this.records = [];
    }
    observe(target, options) {
      this.targets.set(target, options);
      mutationObservers.add(this);
    }
    disconnect() {
      this.records = [];
      mutationObservers.delete(this);
    }
  }
  class PerformanceObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(options) {
      this.options = options;
      timingObservers.add(this);
    }
    disconnect() {
      timingObservers.delete(this);
    }
  }

  function schedule(callback, ms, every) {
    const id = nextTimer++;
    timers.set(id, { at: now + ms, callback, every });
    return id;
  }
  const window = {
    BabelSite: selection
      ? { scene: { cinematicSelection: selection.view, cinematicAngle: selection.angle } }
      : {},
    location: { search },
    MutationObserver,
    ...(performanceObserver ? { PerformanceObserver } : {}),
    ReadableStream,
    Response,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    addEventListener(type, handler) {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set());
      eventListeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      eventListeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      eventListeners.get(event.type)?.forEach((handler) => handler(event));
      return true;
    },
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    setTimeout: (callback, ms) => schedule(callback, ms, 0),
    setInterval: (callback, ms) => schedule(callback, ms, ms),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
  };
  const context = { window, document, URLSearchParams, resolveSceneOpening };
  if (sizes) context.__BABEL_ARCHITECTURE_PREFETCH_BYTES__ = sizes;
  vm.runInNewContext(source, context, { filename: "src/ui/scene-loader.js" });

  return {
    loader,
    host,
    star,
    parts,
    fill,
    value,
    document,
    events,
    dispatched,
    preparation(snapshot) {
      window.dispatchEvent(
        new window.CustomEvent("babel:opening-preparation", { detail: snapshot }),
      );
    },
    sceneLoader: window.BabelSite.sceneLoader,
    // The state as plain objects of this realm, for deep comparisons.
    state() {
      return JSON.parse(JSON.stringify(window.BabelSite.sceneLoader.state));
    },
    get styleWrites() {
      return styleWrites;
    },
    get textWrites() {
      return textWrites;
    },
    get pendingFrames() {
      return frames.length;
    },
    get observerCount() {
      return (
        mutationObservers.size +
        timingObservers.size +
        visibilityListeners.size +
        [...eventListeners.values()].reduce((total, listeners) => total + listeners.size, 0)
      );
    },
    get timerCount() {
      return timers.size;
    },
    frame() {
      frames.splice(0).forEach((callback) => callback(now));
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        timer.callback();
      }
      now = end;
    },
    emit(name, entryType = "measure") {
      for (const observer of [...timingObservers]) {
        if (observer.options.entryTypes.includes(entryType)) {
          observer.callback({ getEntries: () => [{ name, entryType }] });
        }
      }
    },
    setHidden(hidden) {
      document.hidden = hidden;
      visibilityListeners.forEach((listener) => listener());
    },
  };
}

// A model body the test feeds chunk by chunk.
function modelResponse({ status = 200, headers = { "x-model": "tree" } } = {}) {
  let controller;
  const record = { cancelled: null };
  const stream = new ReadableStream({
    start(streamController) {
      controller = streamController;
    },
    cancel(reason) {
      record.cancelled = reason ?? true;
    },
  });
  return {
    record,
    response: new Response(stream, { status, statusText: "Fixture", headers }),
    push(length, fill = 7) {
      controller.enqueue(new Uint8Array(length).fill(fill));
    },
    close() {
      controller.close();
    },
    fail(error) {
      controller.error(error);
    },
  };
}

// Every stage and the watch's two build steps (it has no model to download).
function completeWatch(h) {
  h.sceneLoader.stage("bundle");
  h.sceneLoader.stage("init");
  for (const step of ["assembly", "shaders"]) h.emit(`babel:${step}:watch`);
}

test("before a run begins the loading line stays hidden and passes every response through", async () => {
  const h = createHarness({ search: TREE_VIEW });
  const model = modelResponse();
  assert.equal(h.sceneLoader.track(TREE, model.response), model.response);
  h.sceneLoader.stage("bundle");
  h.sceneLoader.end("static");
  assert.equal(h.loader.hidden, true);
  assert.equal(h.state().status, "idle");
  assert.equal(h.state().progress, 0);
  assert.equal(h.styleWrites, 0);
  // A page without the line starts no run.
  const bare = createHarness({ withLoader: false });
  bare.sceneLoader.begin({ tier: "high" });
  assert.equal(bare.state().status, "idle");
  assert.equal(bare.observerCount + bare.timerCount, 0);
});

test("begin unhides the line, flushes its style, then fades it in at 0%", () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  assert.equal(h.loader.hidden, false);
  assert.ok(h.loader.classList.contains("is-loading"));
  const order = h.events.filter((event) => event.startsWith("loader:"));
  assert.deepEqual(order.slice(0, 3), [
    "loader:hidden=false",
    "loader:flush",
    "loader:+is-loading",
  ]);
  assert.equal(h.value.textContent, "0%");
  assert.equal(h.fill.style.transform, "scaleX(0)");
  assert.equal(h.star.hidden, true, "no star until the scene reports where");
  const state = h.state();
  assert.equal(state.status, "loading");
  assert.equal(state.tier, "high");
  assert.deepEqual(state.roles, ["watch"]);
  // The watch downloads no model, so it reports no bytes.
  assert.deepEqual(state.bytes, {});
  assert.deepEqual(state.stages, { bundle: false, init: false });
  assert.deepEqual(state.built, { watch: { assembly: false, shaders: false } });
  // A second begin while loading keeps the run.
  h.sceneLoader.stage("bundle");
  h.sceneLoader.begin({ tier: "balanced" });
  assert.equal(h.state().tier, "high");
  assert.equal(h.state().progress, 0.1);
});

test("a tracked body is counted eagerly, before the scene reads its copy", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: "high" });
  assert.deepEqual(h.state().bytes.tree, { received: 0, expected: 1000, done: false });
  const model = modelResponse();
  const copy = h.sceneLoader.track(TREE, model.response);
  assert.notEqual(copy, model.response);
  model.push(300);
  model.push(200);
  await settle();
  assert.deepEqual(h.state().bytes.tree, { received: 500, expected: 1000, done: false });
  assert.equal(h.state().progress, 0.35);
  model.push(500);
  model.close();
  await settle();
  assert.deepEqual(h.state().bytes.tree, { received: 1000, expected: 1000, done: true });
  assert.equal(h.state().progress, 0.7);
  // The copy keeps the bytes, status and headers.
  assert.equal(copy.status, 200);
  assert.equal(copy.statusText, "Fixture");
  assert.equal(copy.ok, true);
  assert.equal(copy.headers.get("x-model"), "tree");
  const bytes = new Uint8Array(await copy.arrayBuffer());
  assert.equal(bytes.length, 1000);
  assert.ok(bytes.every((byte) => byte === 7));
});

test("a failed body rejects the copy the scene reads", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: "high" });
  const model = modelResponse();
  const copy = h.sceneLoader.track(TREE, model.response);
  model.push(100);
  await settle();
  model.fail(new Error("connection reset"));
  await assert.rejects(copy.arrayBuffer(), /connection reset/);
  assert.equal(h.state().bytes.tree.done, false);
});

test("a cancelled copy cancels its source and never counts as complete", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: "high" });
  const model = modelResponse();
  const copy = h.sceneLoader.track(TREE, model.response);
  model.push(100);
  await settle();
  await copy.body.cancel("stale");
  await settle();
  assert.equal(model.record.cancelled, "stale");
  assert.deepEqual(h.state().bytes.tree, { received: 100, expected: 1000, done: false });
  assert.equal(h.state().progress, 0.07);
});

test("unsuccessful, empty, optional, unrequired and late responses pass through unchanged", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: "high" });
  const unavailable = modelResponse({ status: 503 }).response;
  assert.equal(h.sceneLoader.track(TREE, unavailable), unavailable);
  const empty = new Response(null, { status: 200 });
  assert.equal(h.sceneLoader.track(TREE, empty), empty);
  const lantern = modelResponse().response;
  assert.equal(
    h.sceneLoader.track("/images/architecture/lantern-high.0123abcd.glb", lantern),
    lantern,
  );
  const rock = modelResponse().response;
  assert.equal(
    h.sceneLoader.track("/images/architecture/lichen-rock-high.0123abcd.glb", rock),
    rock,
  );
  assert.equal(h.sceneLoader.track(TREE, undefined), undefined);
  assert.equal(h.state().progress, 0);
  h.sceneLoader.end("static");
  const late = modelResponse().response;
  assert.equal(h.sceneLoader.track(TREE, late), late);
  // The default view opens on the watch alone: the tree's download is not its work.
  const watch = createHarness();
  watch.sceneLoader.begin({ tier: "high" });
  const tree = modelResponse().response;
  assert.equal(watch.sceneLoader.track(TREE, tree), tree);
  assert.equal(watch.state().progress, 0);
});

test("every stage and the watch's two build steps hold the line at exactly 96%", () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.stage("bundle");
  assert.equal(h.state().progress, 0.1);
  h.sceneLoader.stage("init");
  assert.equal(h.state().progress, 0.14);
  // With no model to download, the build takes the bytes' share: 82% over the
  // watch's commit (0.25) and shader warm-up (0.4).
  h.emit("babel:assembly:watch");
  assert.equal(h.state().progress, 0.455385);
  // Other entries and roles are not the opening view's work.
  for (const name of [
    "babel:glb-parse:lantern",
    "babel:glb-parse:tree",
    "babel:assembly:tree",
    "babel:shaders:tree",
    "babel:shaders:ground",
    "babel:shaders:scene",
    "babel:shaders:lantern",
    "babel:first-frame",
  ]) {
    h.emit(name);
  }
  h.emit("babel:shaders:watch", "mark");
  assert.equal(h.state().progress, 0.455385);
  h.emit("babel:shaders:watch");
  assert.equal(h.state().progress, 0.96);
  assert.deepEqual(h.state().built, { watch: { assembly: true, shaders: true } });
  h.frame();
  assert.equal(h.value.textContent, "96%");
  assert.equal(h.fill.style.transform, "scaleX(0.96)");
  assert.equal(h.state().status, "loading", "only the reveal completes the line");
});

test("?view=tree waits for the tree's bytes and build steps as well", async () => {
  const h = createHarness({ search: "?view=tree&angle=2" });
  h.sceneLoader.begin({ tier: "high" });
  assert.deepEqual(h.state().roles, ["watch", "tree"]);
  assert.deepEqual(h.state().built, {
    watch: { assembly: false, shaders: false },
    tree: { "glb-parse": false, assembly: false, shaders: false },
  });
  completeWatch(h);
  // The bytes are all the tree's (70%); the watch's two steps weigh 0.65 of
  // the 1.65 that share the build's 12%.
  assert.equal(h.state().progress, 0.187273);
  const tree = modelResponse();
  h.sceneLoader.track(TREE, tree.response);
  tree.push(1000);
  tree.close();
  await settle();
  assert.equal(h.state().progress, 0.887273);
  h.emit("babel:glb-parse:tree");
  assert.equal(h.state().progress, 0.912727);
  for (const step of ["assembly", "shaders"]) h.emit(`babel:${step}:tree`);
  assert.equal(h.state().progress, 0.96);
  assert.equal(h.state().status, "loading", "only the reveal completes the line");
});

test("the loading ledger resolves ordinary, explicit and scripted openings like the scene", () => {
  for (const [options, roles] of [
    [{ search: "" }, ["watch", "tree"]],
    [{ search: "?quality=high" }, ["watch", "tree"]],
    [{ search: "?view=watch" }, ["watch"]],
    [{ search: "?view=invalid&angle=2" }, ["watch"]],
    [{ search: "?angle=2" }, ["watch"]],
    [{ search: "", selection: { view: "watch" } }, ["watch"]],
    [{ search: "?view=watch", selection: { view: "tree", angle: 1 } }, ["watch", "tree"]],
  ]) {
    const h = createHarness(options);
    h.sceneLoader.begin({ tier: "high" });
    assert.deepEqual(h.state().roles, roles, JSON.stringify(options));
    h.sceneLoader.end("static");
  }
});

test("preparation counts completed work, holds below reveal, and cleans its event bridge", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.preparation({ status: "preparing", completed: 0, total: 4, stage: "maps" });
  completeWatch(h);
  assert.equal(h.state().progress, 0.768);
  h.preparation({ status: "preparing", completed: 2, total: 4, stage: "programs" });
  assert.equal(h.state().progress, 0.864);
  h.advance(14000);
  h.preparation({ status: "preparing", completed: 3, total: 4, stage: "foreground" });
  h.advance(14000);
  assert.equal(h.state().status, "loading", "real preparation restarts idle time");
  h.preparation({ status: "ready", completed: 4, total: 4, stage: "ready" });
  assert.equal(h.state().progress, 0.96);
  assert.equal(h.state().status, "loading", "ready work is not a revealed canvas");
  h.host.classList.add("is-ready");
  await settle();
  assert.equal(h.state().progress, 1);
  assert.equal(h.observerCount, 0);
  h.preparation({ status: "failed", completed: 0, total: 4 });
  assert.equal(h.state().status, "revealed");
});

test("duplicate preparation cannot keep a stalled loader alive and terminal failure retires it", () => {
  const h = createHarness();
  h.sceneLoader.begin();
  const snapshot = { status: "preparing", completed: 0, total: 4, stage: "maps" };
  h.sceneLoader.preparation(snapshot);
  h.advance(12000);
  h.sceneLoader.preparation(snapshot);
  h.advance(4000);
  assert.equal(h.state().status, "stalled");
  assert.equal(h.dispatched.filter((event) => event.type === "babel:opening-timeout").length, 1);
  assert.equal(h.dispatched.at(-1).detail.reason, "idle");
  for (const status of ["fallback", "failed"]) {
    const failed = createHarness();
    failed.sceneLoader.begin();
    failed.sceneLoader.preparation({
      status,
      completed: 1,
      total: 4,
      stage: "maps",
      reason: "timeout",
    });
    assert.equal(failed.state().status, "static");
    assert.equal(failed.state().preparation.reason, "timeout");
    assert.equal(failed.observerCount, 0);
  }
});

test("the reveal completes the line at 100% and retires it with the canvas fade", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  completeWatch(h);
  h.frame();
  assert.ok(h.observerCount > 0 && h.timerCount > 0);
  h.host.classList.add("is-ready");
  await settle();
  const state = h.state();
  assert.equal(state.status, "revealed");
  assert.equal(state.progress, 1);
  assert.equal(h.value.textContent, "100%");
  assert.equal(h.fill.style.transform, "scaleX(1)");
  assert.ok(h.loader.classList.contains("is-done"));
  assert.ok(!h.loader.classList.contains("is-loading"));
  assert.equal(h.observerCount, 0, "observers and listeners disconnect at the reveal");
  h.advance(599);
  assert.equal(h.loader.hidden, false);
  h.advance(1);
  assert.equal(h.loader.hidden, true);
  assert.ok(!h.loader.classList.contains("is-done"));
  assert.equal(h.fill.style.transform, "");
  assert.equal(h.star.hidden, true);
  assert.equal(h.timerCount, 0, "no watchdog outlives the line");
  // Pending frames draw nothing more.
  const writes = h.styleWrites;
  h.frame();
  assert.equal(h.styleWrites, writes);
});

test("the reveal's mark backs up the class change", () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.emit("babel:reveal", "measure");
  assert.equal(h.state().status, "loading");
  h.emit("babel:reveal", "mark");
  assert.equal(h.state().status, "revealed");
  assert.equal(h.value.textContent, "100%");
});

test("a hidden scene host retires the line below 100%", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.stage("bundle");
  h.frame();
  h.host.hidden = true;
  await settle();
  assert.equal(h.state().status, "static");
  assert.equal(h.state().progress, 0.1);
  assert.equal(h.value.textContent, "10%");
  assert.equal(h.fill.style.transform, "scaleX(0.1)");
  assert.equal(h.star.hidden, true);
  assert.ok(h.loader.classList.contains("is-done"));
  assert.equal(h.observerCount, 0);
  h.advance(600);
  assert.equal(h.loader.hidden, true);
  // A host hidden from an earlier static decision does not retire a new run;
  // only hiding it again does.
  const recovered = createHarness({ hostHidden: true });
  recovered.sceneLoader.begin({ tier: "high" });
  recovered.host.hidden = false;
  await settle();
  assert.equal(recovered.state().status, "loading");
  recovered.sceneLoader.end("static");
  assert.equal(recovered.state().status, "static");
});

test("a run without progress for 15 visible seconds stalls; hidden time is excluded", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.advance(10000);
  assert.equal(h.state().status, "loading");
  h.setHidden(true);
  h.advance(30000);
  h.setHidden(false);
  h.advance(4000);
  assert.equal(h.state().status, "loading", "14 visible seconds without progress");
  h.advance(2000);
  assert.equal(h.state().status, "stalled");
  assert.ok(h.loader.classList.contains("is-done"));
  h.advance(600);
  assert.equal(h.loader.hidden, true);
  assert.equal(h.timerCount, 0);

  // Progress restarts the count at the next check (14 s here).
  const moving = createHarness();
  moving.sceneLoader.begin({ tier: "high" });
  moving.advance(12000);
  moving.sceneLoader.stage("bundle");
  moving.advance(16000);
  assert.equal(moving.state().status, "loading");
  moving.advance(2000);
  assert.equal(moving.state().status, "stalled");
});

test("a retried download never lowers or double counts progress", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: "high" });
  const first = modelResponse();
  h.sceneLoader.track(TREE, first.response);
  first.push(600);
  await settle();
  assert.equal(h.state().progress, 0.42);
  first.fail(new Error("aborted"));
  await settle();
  const second = modelResponse();
  h.sceneLoader.track(TREE, second.response);
  second.push(100);
  await settle();
  assert.equal(h.state().progress, 0.42);
  assert.deepEqual(h.state().bytes.tree, { received: 600, expected: 1000, done: false });
  second.push(800);
  await settle();
  assert.equal(h.state().progress, 0.63);
  second.push(100);
  second.close();
  await settle();
  assert.equal(h.state().progress, 0.7, "the two requests are not added together");
  assert.deepEqual(h.state().bytes.tree, { received: 1000, expected: 1000, done: true });
});

test("without a known tier the first model URL names it; an unknown size counts at its end", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: null });
  assert.equal(h.state().tier, null);
  const model = modelResponse();
  h.sceneLoader.track("/images/architecture/tree-balanced.89abcdef.glb?v=1", model.response);
  assert.equal(h.state().tier, "balanced");
  model.push(200);
  await settle();
  assert.deepEqual(h.state().bytes.tree, { received: 200, expected: 400, done: false });
  assert.equal(h.state().progress, 0.35);

  const unsized = createHarness({ search: TREE_VIEW, sizes: null });
  unsized.sceneLoader.begin({ tier: "high" });
  const body = modelResponse();
  unsized.sceneLoader.track(TREE, body.response);
  body.push(5000);
  await settle();
  assert.equal(unsized.state().progress, 0);
  body.close();
  await settle();
  assert.equal(unsized.state().progress, 0.7);
});

test("many chunks within one frame cost one draw", async () => {
  const h = createHarness({ search: TREE_VIEW });
  h.sceneLoader.begin({ tier: "high" });
  const afterBegin = h.textWrites;
  assert.equal(afterBegin, 1, "begin draws 0% at once");
  const model = modelResponse();
  h.sceneLoader.track(TREE, model.response);
  for (let chunk = 0; chunk < 20; chunk += 1) model.push(10);
  h.sceneLoader.stage("bundle");
  await settle();
  assert.equal(h.textWrites, afterBegin, "nothing draws between frames");
  assert.equal(h.pendingFrames, 1, "one frame is requested");
  h.frame();
  assert.equal(h.textWrites, afterBegin + 1);
  assert.equal(h.value.textContent, "24%");
  h.frame();
  assert.equal(h.textWrites, afterBegin + 1, "an idle frame draws nothing");
});

// The star as index.js reports it: CSS px from the canvas's top-left.
const STAR = { x: 500, y: 300, radius: 20, width: 1440, height: 900 };
const scaleOf = (transform) => Number(transform.match(/scaleX?\(([-\d.e]+)\)/)[1]);
const translateOf = (transform) =>
  transform
    .match(/translate\(([-\d.e]+)px, ([-\d.e]+)px\)/)
    .slice(1)
    .map(Number);
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} is not ${expected}`);

test("the scene's report places the star, which warms from that progress to the reveal", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.stage("bundle");
  h.sceneLoader.star({ ...STAR });
  h.frame();
  const [glow, disc] = h.parts;
  assert.equal(h.star.hidden, false);
  assert.deepEqual(translateOf(h.star.style.transform), [500, 300]);
  // Known at 10%: an unseen ember there.
  assert.equal(Number(disc.style.opacity), 0);
  close(scaleOf(disc.style.transform), 0.4 * 0.4, "the ember's disc");
  assert.deepEqual(h.state().star, STAR);
  // Part of the way from 10% to the reveal: the scene initialized and the watch committed.
  h.sceneLoader.stage("init");
  h.emit("babel:assembly:watch");
  h.frame();
  close(h.state().progress, 0.14 + (0.82 * 0.25) / 0.65, "progress");
  const warm = (h.state().progress - 0.1) / 0.9;
  close(Number(disc.style.opacity), Math.round(Math.sqrt(warm) * 1000) / 1000, "the disc's light");
  close(Number(glow.style.opacity), Math.round(warm * 1000) / 1000, "the glow's light");
  // At the reveal: the scene's own star and two and a half radii of glow.
  h.emit("babel:shaders:watch");
  h.host.classList.add("is-ready");
  await settle();
  close(scaleOf(disc.style.transform), 0.4, "the disc at full size");
  close(Number(disc.style.opacity), 1, "the disc's full light");
  close(scaleOf(glow.style.transform), 1, "the glow");
  close(Number(glow.style.opacity), 1, "the glow's full light");
  // A revealed star stays under the canvas's fade-in until the line goes.
  assert.equal(h.star.hidden, false);
  h.advance(600);
  assert.equal(h.star.hidden, true);
});

test("the star is the scene's own: its clipped disc and its glow; the lens's ghosts come with the canvas", async () => {
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  // The canvas brings the lens's flare (postprocess.js LENS_FX.flare) in over it as it fades
  // in; the loading line draws no lens of its own.
  assert.ok(LENS_FX.flare.on);
  assert.doesNotMatch(styles, /scene-star__(?:streak|haze|ghost|burst|flare)/);
  // A clipped, white-hot disc a little warm and flat to its limb, and a glow that runs on from
  // it at its own light past the limb (its box's 40%), then falls away through gold to nothing.
  assert.match(
    cssRule(styles, ".scene-star > .scene-star__disc"),
    /background: rgb\(252, 251, 244\);/,
  );
  const glow = cssRule(styles, ".scene-star > .scene-star__glow");
  assert.match(glow, /rgba\(255, 254, 247, 0\.99\) 40%/);
  assert.match(glow, /rgba\(255, 140, 80, 0\) 100%/);
  // With both parts in place, the reported star shows.
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.star({ ...STAR });
  h.frame();
  assert.equal(h.star.hidden, false);
});

test("an unknown, off-frame or malformed star shows nothing, and a late report changes nothing", () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  for (const report of [
    null,
    { ...STAR, x: -1 },
    { ...STAR, y: STAR.height + 1 },
    { ...STAR, radius: 0 },
    { ...STAR, width: Number.NaN },
    { x: 1, y: 1 },
  ]) {
    h.sceneLoader.star(report);
    h.frame();
    assert.equal(h.star.hidden, true, JSON.stringify(report));
    assert.equal(h.state().star, null);
  }
  h.sceneLoader.star({ ...STAR });
  h.frame();
  assert.equal(h.star.hidden, false);
  h.sceneLoader.star(null);
  h.frame();
  assert.equal(h.star.hidden, true, "the scene withdrew it");
  // A retired line takes its star with it at once, and ignores later reports.
  h.sceneLoader.star({ ...STAR });
  h.frame();
  h.sceneLoader.end("static");
  assert.equal(h.star.hidden, true);
  h.sceneLoader.star({ ...STAR, x: 600 });
  assert.deepEqual(translateOf(h.star.style.transform), [500, 300]);
  // A page without the star keeps the line.
  const bare = createHarness({ withStar: false });
  bare.sceneLoader.begin({ tier: "high" });
  bare.sceneLoader.star({ ...STAR });
  bare.frame();
  assert.equal(bare.state().status, "loading");
});

test("without PerformanceObserver the build share waits for the reveal", async () => {
  const h = createHarness({ performanceObserver: false });
  h.sceneLoader.begin({ tier: "high" });
  completeWatch(h);
  assert.equal(h.state().progress, 0.14);
  h.host.classList.add("is-ready");
  await settle();
  assert.equal(h.state().status, "revealed");
  assert.equal(h.value.textContent, "100%");
  // With ?view=tree the tree's bytes still count; its build waits as well.
  const tree = createHarness({ search: TREE_VIEW, performanceObserver: false });
  tree.sceneLoader.begin({ tier: "high" });
  completeWatch(tree);
  const model = modelResponse();
  tree.sceneLoader.track(TREE, model.response);
  model.push(1000);
  model.close();
  await settle();
  for (const step of ["glb-parse", "assembly", "shaders"]) tree.emit(`babel:${step}:tree`);
  assert.equal(tree.state().progress, 0.84);
});

test("the scene still names the measures and the mark the line follows", async () => {
  const text = async (file) => readFile(new URL(`../src/scene/${file}`, import.meta.url), "utf8");
  const index = await text("index.js");
  const assets = await text("architecture-assets.js");
  const marks = await text("perf-marks.js");
  assert.match(assets, /measureScene\(`glb-parse:\$\{role\}`, parseStart\);/);
  assert.match(index, /measureScene\("assembly:watch", assemblyStart\);/);
  assert.match(index, /measureScene\("assembly:tree", assemblyStart\);/);
  assert.match(index, /measureScene\(`shaders:\$\{label\}`, start\);/);
  assert.match(index, /warmShaders\("watch"\);/);
  assert.match(index, /warmShaders\("tree", replacement\.root\);/);
  assert.match(index, /markScene\("reveal"\);/);
  assert.match(index, /container\?\.classList\.toggle\("is-ready", sceneShown\);/);
  assert.match(marks, /timing\?\.mark\?\.\(`babel:\$\{name\}`/);
  assert.match(marks, /timing\?\.measure\?\.\(`babel:\$\{name\}`/);
});
