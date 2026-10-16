import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { rule as cssRule } from "./support/css.mjs";
import { LENS_FX } from "../src/scene/postprocess.js";

// The title card's loading line (src/ui/scene-loader.js) runs in a fake DOM
// with controllable observers, frames and timers, and Node's own Response and
// ReadableStream for the byte counting.
const source = await readFile(new URL("../src/ui/scene-loader.js", import.meta.url), "utf8");
const SIZES = { high: { tower: 1000, tree: 3000 }, balanced: { tower: 400, tree: 600 } };
const TOWER = "/images/architecture/tower-high.0123abcd.glb";
const TREE = "/images/architecture/tree-high.0123abcd.glb";
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
  search = "",
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

  const value = element("value", { classes: ["scene-loader__value"], text: "0%" });
  const label = element("label", { classes: ["scene-loader__label"], children: [value] });
  const loader = element("loader", {
    classes: ["scene-loader"],
    hidden: true,
    children: [label],
  });
  // #scene-star: haze, streak, glow, disc and the lens's five ghosts, as index.html has them.
  const parts = ["haze", "streak", "glow", "disc", ...Array(5).fill("ghost")].map((part, i) =>
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
    BabelSite: {},
    location: { search },
    MutationObserver,
    ...(performanceObserver ? { PerformanceObserver } : {}),
    ReadableStream,
    Response,
    requestAnimationFrame(callback) {
      frames.push(callback);
      return frames.length;
    },
    setTimeout: (callback, ms) => schedule(callback, ms, 0),
    setInterval: (callback, ms) => schedule(callback, ms, ms),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
  };
  const context = { window, document, URLSearchParams };
  if (sizes) context.__BABEL_ARCHITECTURE_PREFETCH_BYTES__ = sizes;
  vm.runInNewContext(source, context, { filename: "src/ui/scene-loader.js" });

  return {
    loader,
    host,
    star,
    parts,
    value,
    document,
    events,
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
      return mutationObservers.size + timingObservers.size + visibilityListeners.size;
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
function modelResponse({ status = 200, headers = { "x-model": "tower" } } = {}) {
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

// Every stage, a required model's bytes and its three build steps.
async function completeTower(h, url = TOWER, length = 1000) {
  h.sceneLoader.stage("bundle");
  h.sceneLoader.stage("init");
  const model = modelResponse();
  h.sceneLoader.track(url, model.response);
  model.push(length);
  model.close();
  await settle();
  for (const step of ["glb-parse", "assembly", "shaders"]) h.emit(`babel:${step}:tower`);
}

test("before a run begins the loading line stays hidden and passes every response through", async () => {
  const h = createHarness();
  const model = modelResponse();
  assert.equal(h.sceneLoader.track(TOWER, model.response), model.response);
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
  assert.equal(h.star.hidden, true, "no star until the scene reports where");
  const state = h.state();
  assert.equal(state.status, "loading");
  assert.equal(state.tier, "high");
  assert.deepEqual(state.roles, ["tower"]);
  assert.deepEqual(state.bytes, { tower: { received: 0, expected: 1000, done: false } });
  assert.deepEqual(state.stages, { bundle: false, init: false });
  // A second begin while loading keeps the run.
  h.sceneLoader.stage("bundle");
  h.sceneLoader.begin({ tier: "balanced" });
  assert.equal(h.state().tier, "high");
  assert.equal(h.state().progress, 0.1);
});

test("a tracked body is counted eagerly, before the scene reads its copy", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  const model = modelResponse();
  const copy = h.sceneLoader.track(TOWER, model.response);
  assert.notEqual(copy, model.response);
  model.push(300);
  model.push(200);
  await settle();
  assert.deepEqual(h.state().bytes.tower, { received: 500, expected: 1000, done: false });
  assert.equal(h.state().progress, 0.35);
  model.push(500);
  model.close();
  await settle();
  assert.deepEqual(h.state().bytes.tower, { received: 1000, expected: 1000, done: true });
  assert.equal(h.state().progress, 0.7);
  // The copy keeps the bytes, status and headers.
  assert.equal(copy.status, 200);
  assert.equal(copy.statusText, "Fixture");
  assert.equal(copy.ok, true);
  assert.equal(copy.headers.get("x-model"), "tower");
  const bytes = new Uint8Array(await copy.arrayBuffer());
  assert.equal(bytes.length, 1000);
  assert.ok(bytes.every((byte) => byte === 7));
});

test("a failed body rejects the copy the scene reads", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  const model = modelResponse();
  const copy = h.sceneLoader.track(TOWER, model.response);
  model.push(100);
  await settle();
  model.fail(new Error("connection reset"));
  await assert.rejects(copy.arrayBuffer(), /connection reset/);
  assert.equal(h.state().bytes.tower.done, false);
});

test("a cancelled copy cancels its source and never counts as complete", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  const model = modelResponse();
  const copy = h.sceneLoader.track(TOWER, model.response);
  model.push(100);
  await settle();
  await copy.body.cancel("stale");
  await settle();
  assert.equal(model.record.cancelled, "stale");
  assert.deepEqual(h.state().bytes.tower, { received: 100, expected: 1000, done: false });
  assert.equal(h.state().progress, 0.07);
});

test("unsuccessful, empty, optional, unrequired and late responses pass through unchanged", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  const unavailable = modelResponse({ status: 503 }).response;
  assert.equal(h.sceneLoader.track(TOWER, unavailable), unavailable);
  const empty = new Response(null, { status: 200 });
  assert.equal(h.sceneLoader.track(TOWER, empty), empty);
  const lantern = modelResponse().response;
  assert.equal(
    h.sceneLoader.track("/images/architecture/lantern-high.0123abcd.glb", lantern),
    lantern,
  );
  // The default view opens on the tower alone.
  const tree = modelResponse().response;
  assert.equal(h.sceneLoader.track(TREE, tree), tree);
  const rock = modelResponse().response;
  assert.equal(
    h.sceneLoader.track("/images/architecture/lichen-rock-high.0123abcd.glb", rock),
    rock,
  );
  assert.equal(h.sceneLoader.track(TOWER, undefined), undefined);
  assert.equal(h.state().progress, 0);
  h.sceneLoader.end("static");
  const late = modelResponse().response;
  assert.equal(h.sceneLoader.track(TOWER, late), late);
});

test("every stage, the tower's bytes and its three build steps hold the line at exactly 96%", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.stage("bundle");
  assert.equal(h.state().progress, 0.1);
  h.sceneLoader.stage("init");
  assert.equal(h.state().progress, 0.14);
  const model = modelResponse();
  h.sceneLoader.track(TOWER, model.response);
  model.push(1000);
  model.close();
  await settle();
  assert.equal(h.state().progress, 0.84);
  h.emit("babel:glb-parse:tower");
  assert.equal(h.state().progress, 0.882);
  h.emit("babel:assembly:tower");
  assert.equal(h.state().progress, 0.912);
  // Other entries and roles are not the opening view's work.
  for (const name of [
    "babel:glb-parse:lantern",
    "babel:shaders:ground",
    "babel:shaders:scene",
    "babel:shaders:lantern",
    "babel:shaders:tree",
    "babel:first-frame",
  ]) {
    h.emit(name);
  }
  h.emit("babel:shaders:tower", "mark");
  assert.equal(h.state().progress, 0.912);
  h.emit("babel:shaders:tower");
  assert.equal(h.state().progress, 0.96);
  assert.deepEqual(h.state().built, {
    tower: { "glb-parse": true, assembly: true, shaders: true },
  });
  h.frame();
  assert.equal(h.value.textContent, "96%");
  assert.equal(h.state().status, "loading", "only the reveal completes the line");
});

test("?view=tree waits for the tree's bytes and build steps as well", async () => {
  const h = createHarness({ search: "?view=tree&angle=2" });
  h.sceneLoader.begin({ tier: "high" });
  assert.deepEqual(h.state().roles, ["tower", "tree"]);
  await completeTower(h);
  // The tower is a quarter of the bytes and half of the build.
  assert.equal(h.state().progress, 0.375);
  const tree = modelResponse();
  h.sceneLoader.track(TREE, tree.response);
  tree.push(3000);
  tree.close();
  await settle();
  for (const step of ["glb-parse", "assembly", "shaders"]) h.emit(`babel:${step}:tree`);
  assert.equal(h.state().progress, 0.96);
});

test("the reveal completes the line at 100% and retires it with the canvas fade", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  await completeTower(h);
  h.frame();
  assert.ok(h.observerCount > 0 && h.timerCount > 0);
  h.host.classList.add("is-ready");
  await settle();
  const state = h.state();
  assert.equal(state.status, "revealed");
  assert.equal(state.progress, 1);
  assert.equal(h.value.textContent, "100%");
  assert.ok(h.loader.classList.contains("is-done"));
  assert.ok(!h.loader.classList.contains("is-loading"));
  assert.equal(h.observerCount, 0, "observers and listeners disconnect at the reveal");
  h.advance(599);
  assert.equal(h.loader.hidden, false);
  h.advance(1);
  assert.equal(h.loader.hidden, true);
  assert.ok(!h.loader.classList.contains("is-done"));
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
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  const first = modelResponse();
  h.sceneLoader.track(TOWER, first.response);
  first.push(600);
  await settle();
  assert.equal(h.state().progress, 0.42);
  first.fail(new Error("aborted"));
  await settle();
  const second = modelResponse();
  h.sceneLoader.track(TOWER, second.response);
  second.push(100);
  await settle();
  assert.equal(h.state().progress, 0.42);
  assert.deepEqual(h.state().bytes.tower, { received: 600, expected: 1000, done: false });
  second.push(800);
  await settle();
  assert.equal(h.state().progress, 0.63);
  second.push(100);
  second.close();
  await settle();
  assert.equal(h.state().progress, 0.7, "the two requests are not added together");
  assert.deepEqual(h.state().bytes.tower, { received: 1000, expected: 1000, done: true });
});

test("without a known tier the first model URL names it; an unknown size counts at its end", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: null });
  assert.equal(h.state().tier, null);
  const model = modelResponse();
  h.sceneLoader.track("/images/architecture/tower-balanced.89abcdef.glb?v=1", model.response);
  assert.equal(h.state().tier, "balanced");
  model.push(200);
  await settle();
  assert.deepEqual(h.state().bytes.tower, { received: 200, expected: 400, done: false });
  assert.equal(h.state().progress, 0.35);

  const unsized = createHarness({ sizes: null });
  unsized.sceneLoader.begin({ tier: "high" });
  const body = modelResponse();
  unsized.sceneLoader.track(TOWER, body.response);
  body.push(5000);
  await settle();
  assert.equal(unsized.state().progress, 0);
  body.close();
  await settle();
  assert.equal(unsized.state().progress, 0.7);
});

test("many chunks within one frame cost one draw", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  const afterBegin = h.textWrites;
  assert.equal(afterBegin, 1, "begin draws 0% at once");
  const model = modelResponse();
  h.sceneLoader.track(TOWER, model.response);
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
  const [haze, streak, glow, disc] = h.parts;
  assert.equal(h.star.hidden, false);
  assert.deepEqual(translateOf(h.star.style.transform), [500, 300]);
  // Known at 10%: an unseen ember there.
  assert.equal(Number(disc.style.opacity), 0);
  close(scaleOf(disc.style.transform), 0.4 * 0.4, "the ember's disc");
  assert.deepEqual(h.state().star, STAR);
  // Halfway from 10% to the reveal: warmth 0.5.
  const model = modelResponse();
  h.sceneLoader.track(TOWER, model.response);
  model.push(643);
  await settle();
  h.frame();
  close(h.state().progress, 0.1 + 0.7 * 0.643, "progress");
  const warm = (h.state().progress - 0.1) / 0.9;
  close(Number(disc.style.opacity), Math.round(Math.sqrt(warm) * 1000) / 1000, "the disc's light");
  close(scaleOf(streak.style.transform), 14.4 * warm, "the streak");
  close(scaleOf(haze.style.transform), 11.52 * warm, "the haze");
  // At the reveal: the scene's own star, two radii of glow, the frame-wide streak.
  model.push(357);
  model.close();
  await settle();
  h.host.classList.add("is-ready");
  await settle();
  close(scaleOf(disc.style.transform), 0.4, "the disc at full size");
  close(Number(disc.style.opacity), 1, "the disc's full light");
  close(scaleOf(glow.style.transform), 0.8, "the glow");
  close(scaleOf(streak.style.transform), 14.4, "the full streak");
  // A revealed star stays under the canvas's fade-in until the line goes.
  assert.equal(h.star.hidden, false);
  h.advance(600);
  assert.equal(h.star.hidden, true);
});

test("the star's ghosts follow the lens's: place, size, colour and strength", async () => {
  const h = createHarness();
  h.sceneLoader.begin({ tier: "high" });
  h.sceneLoader.star({ ...STAR });
  h.sceneLoader.end("revealed");
  const ghosts = h.parts.slice(4);
  const styles = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.equal(ghosts.length, LENS_FX.flare.ghosts.length);
  LENS_FX.flare.ghosts.forEach(([t, size, red, green, blue, strength], i) => {
    const [x, y] = translateOf(ghosts[i].style.transform);
    close(x, (STAR.width / 2 - STAR.x) * t, `ghost ${i} across`);
    close(y, (STAR.height / 2 - STAR.y) * t, `ghost ${i} down`);
    close(scaleOf(ghosts[i].style.transform), (2 * size * STAR.height) / 100, `ghost ${i} size`);
    assert.equal(Number(ghosts[i].style.opacity), 1);
    const body = cssRule(
      styles,
      i === 0 ? ".scene-star > .scene-star__ghost" : `.scene-star__ghost:nth-of-type(${5 + i})`,
    );
    const [, rgb, alpha] = body.match(/--ghost:\s*([\d, ]+);\s*--strength:\s*([\d.]+);/);
    assert.deepEqual(
      rgb.split(",").map(Number),
      [red, green, blue].map((channel) => Math.round(channel * 255)),
      `ghost ${i} colour`,
    );
    assert.equal(Number(alpha), strength, `ghost ${i} strength`);
  });
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
  await completeTower(h);
  assert.equal(h.state().progress, 0.84);
  h.host.classList.add("is-ready");
  await settle();
  assert.equal(h.state().status, "revealed");
  assert.equal(h.value.textContent, "100%");
});

test("the scene still names the measures and the mark the line follows", async () => {
  const text = async (file) => readFile(new URL(`../src/scene/${file}`, import.meta.url), "utf8");
  const index = await text("index.js");
  const assets = await text("architecture-assets.js");
  const marks = await text("perf-marks.js");
  assert.match(assets, /measureScene\(`glb-parse:\$\{role\}`, parseStart\);/);
  assert.match(index, /measureScene\("assembly:tower", assemblyStart\);/);
  assert.match(index, /measureScene\("assembly:tree", assemblyStart\);/);
  assert.match(index, /measureScene\(`shaders:\$\{label\}`, start\);/);
  assert.match(index, /warmShaders\("tower", replacement\.root\);/);
  assert.match(index, /warmShaders\("tree", replacement\.root\);/);
  assert.match(index, /markScene\("reveal"\);/);
  assert.match(index, /container\?\.classList\.toggle\("is-ready", sceneShown\);/);
  assert.match(marks, /timing\?\.mark\?\.\(`babel:\$\{name\}`/);
  assert.match(marks, /timing\?\.measure\?\.\(`babel:\$\{name\}`/);
});
