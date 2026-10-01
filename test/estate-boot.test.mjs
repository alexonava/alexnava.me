import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

// The About estate menu boots through main.js, which waits for the parsed
// document and then asks scene-menu.js to enhance it. (The retired
// direct-estate entry, src/estate-main.js, used to own this timing.)
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
