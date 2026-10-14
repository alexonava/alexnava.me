import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The hero's chrome (src/ui/hero.js) in a fake DOM: the tablet intro's text
// scrim follows the scene host's is-ready through the hero's is-over-scene.
const source = await readFile(new URL("../src/ui/hero.js", import.meta.url), "utf8");
const settle = () => new Promise((resolve) => setImmediate(resolve));

function classList(names, onChange = () => {}) {
  const set = new Set(names);
  return {
    contains: (name) => set.has(name),
    add(name) {
      set.add(name);
      onChange();
    },
    remove(name) {
      set.delete(name);
      onChange();
    },
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if (on) set.add(name);
      else set.delete(name);
      onChange();
      return on;
    },
  };
}

function createHarness({ withHost = true, mutationObserver = true, ready = false } = {}) {
  const observers = [];
  const hero = { style: {}, classList: classList([]) };
  const host = {};
  host.classList = classList(ready ? ["scene-canvas", "is-ready"] : ["scene-canvas"], () => {
    for (const observer of observers)
      if (observer.options.attributeFilter.includes("class"))
        queueMicrotask(() => observer.callback([{ target: host, attributeName: "class" }]));
  });
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target, options) {
      assert.equal(target, host);
      this.options = options;
      observers.push(this);
    }
  }
  const document = {
    getElementById: (id) =>
      id === "hero-minimal" ? hero : id === "home-scene" && withHost ? host : null,
  };
  const window = {
    BabelSite: { shared: { reducedMotionQuery: () => null } },
    innerHeight: 1180,
    scrollY: 0,
    addEventListener() {},
    ...(mutationObserver ? { MutationObserver } : {}),
  };
  vm.runInNewContext(source, { window, document, requestAnimationFrame: () => 1 });
  window.BabelSite.ui.initHeroChrome();
  return { hero, host, observers };
}

test("the intro's scrim shows only while the scene host is ready", async () => {
  const { hero, host, observers } = createHarness();
  // The title card: no scene yet, so no scrim.
  assert.equal(hero.classList.contains("is-over-scene"), false);
  assert.equal(observers.length, 1);
  assert.deepEqual([...observers[0].options.attributeFilter], ["class"]);
  // The reveal brings it in with the canvas.
  host.classList.add("is-ready");
  await settle();
  assert.equal(hero.classList.contains("is-over-scene"), true);
  // A lost context or teardown drops is-ready, and the title card returns without it.
  host.classList.remove("is-ready");
  await settle();
  assert.equal(hero.classList.contains("is-over-scene"), false);
});

test("a hero initialised after the reveal takes the scrim at once", () => {
  const { hero } = createHarness({ ready: true });
  assert.equal(hero.classList.contains("is-over-scene"), true);
});

test("without MutationObserver the intro keeps its guard; without a host there is no scene", () => {
  assert.equal(
    createHarness({ mutationObserver: false }).hero.classList.contains("is-over-scene"),
    true,
  );
  assert.equal(createHarness({ withHost: false }).hero.classList.contains("is-over-scene"), false);
});
