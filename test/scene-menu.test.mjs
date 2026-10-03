import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/ui/scene-menu.js", import.meta.url), "utf8");

function createFixture({ init = () => true } = {}) {
  const entry = { hidden: true };
  const fallback = ["About link", "category copy"].map((kind) => ({
    kind,
    hidden: false,
    children: [{ kind: "ordinary-link-or-selectable-copy" }],
    contains(target) {
      return target === this || this.children.includes(target);
    },
  }));
  const document = {
    activeElement: { kind: "body" },
    querySelector: (selector) => (selector === ".scene-entry" ? entry : null),
    querySelectorAll: (selector) => (selector === "[data-scene-fallback]" ? fallback : []),
  };
  let calls = 0;
  const window = {
    BabelSite: {
      ui: {
        initPanels() {
          calls++;
          return init({ entry, fallback, document });
        },
      },
    },
  };
  vm.runInNewContext(source, { window, document }, { filename: "src/ui/scene-menu.js" });
  return {
    window,
    document,
    entry,
    fallback,
    get calls() {
      return calls;
    },
    initialize() {
      return window.BabelSite.ui.initSceneMenu();
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

test("scene menu registration does not hide fallback before explicit initialization", () => {
  const fixture = createFixture();
  assert.equal(fixture.calls, 0);
  assertFallbackAvailable(fixture);
});

test("scene menu reveals About only after successful binding and leaves focus in place", () => {
  const fixture = createFixture({
    init({ entry, fallback }) {
      assert.equal(entry.hidden, true);
      assert.ok(fallback.every((element) => !element.hidden));
      return true;
    },
  });
  const previousFocus = fixture.document.activeElement;
  assert.equal(fixture.initialize(), true);
  assert.equal(fixture.calls, 1);
  assert.equal(fixture.entry.hidden, false);
  assert.ok(fixture.fallback.every((element) => element.hidden));
  assert.equal(fixture.document.activeElement, previousFocus);
});

test("failed, unavailable, or incomplete panel binding preserves fallback and reports failure", async (t) => {
  const cases = [
    ["false result", () => false],
    ["missing success result", () => undefined],
    ["truthy non-success result", () => 1],
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
      assert.equal(fixture.initialize(), false);
      assert.equal(fixture.calls, 1);
      assertFallbackAvailable(fixture);
    });
  }
  await t.test("missing initializer", () => {
    const fixture = createFixture();
    delete fixture.window.BabelSite.ui.initPanels;
    assert.equal(fixture.initialize(), false);
    assert.equal(fixture.calls, 0);
    assertFallbackAvailable(fixture);
  });
});

test("repeated scene menu initialization keeps the same visible About control and focus", () => {
  const fixture = createFixture();
  assert.equal(fixture.initialize(), true);
  fixture.document.activeElement = fixture.entry;
  assert.equal(fixture.initialize(), true);
  assert.equal(fixture.entry.hidden, false);
  assert.ok(fixture.fallback.every((element) => element.hidden));
  assert.equal(fixture.document.activeElement, fixture.entry);
});

test("delayed scene menu initialization never hides a focused fallback link or section", () => {
  for (const index of [0, 1]) {
    for (const focusRoot of [false, true]) {
      const fixture = createFixture();
      const selected = focusRoot ? fixture.fallback[index] : fixture.fallback[index].children[0];
      fixture.document.activeElement = selected;
      assert.equal(fixture.initialize(), false);
      assert.equal(fixture.calls, 0);
      assertFallbackAvailable(fixture);
      assert.equal(fixture.document.activeElement, selected);
    }
  }
});

test("scene menu can retry after failed binding without replacing the fallback elements", () => {
  let succeeds = false;
  const fixture = createFixture({ init: () => succeeds });
  assert.equal(fixture.initialize(), false);
  assertFallbackAvailable(fixture);
  succeeds = true;
  assert.equal(fixture.initialize(), true);
  assert.equal(fixture.calls, 2);
  assert.equal(fixture.entry.hidden, false);
  assert.ok(fixture.fallback.every((element) => element.hidden));
});

test("incomplete scene menu markup does not attempt panel initialization", () => {
  for (const missing of ["entry", "fallback"]) {
    const fixture = createFixture();
    if (missing === "entry") fixture.document.querySelector = () => null;
    else fixture.document.querySelectorAll = () => [];
    assert.equal(fixture.initialize(), false);
    assert.equal(fixture.calls, 0);
    assertFallbackAvailable(fixture);
  }
});

// A fixture whose About control takes listeners, with the dialog art the
// stylesheet names and optional browser features.
function createWarmFixture({ saveData = false, computedStyle = true, image = true } = {}) {
  const listeners = new Map();
  const entry = {
    hidden: true,
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) || []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((candidate) => candidate !== handler),
      );
    },
    dispatch(type) {
      for (const handler of listeners.get(type) || []) handler({ type });
    },
  };
  const fallback = [{ hidden: false, contains: () => false }];
  const art = {
    ".estate-home-map .estate-map": {
      "::before": {
        "background-image": 'url("https://alexnava.me/images/estate-map-desktop.0123abcd.webp")',
      },
    },
    ".panel-parchment__sheet": {
      "::before": {
        "background-image":
          'linear-gradient(115deg, rgba(255, 252, 240, 0.19), rgba(71, 47, 22, 0.035)), url("https://alexnava.me/images/paper-grain.0123abcd.webp")',
      },
      "::after": {
        "border-image-source": 'url("https://alexnava.me/images/paper-edge.0123abcd.webp")',
      },
    },
  };
  const elements = Object.fromEntries(Object.keys(art).map((selector) => [selector, { selector }]));
  const document = {
    activeElement: { kind: "body" },
    querySelector: (selector) => (selector === ".scene-entry" ? entry : elements[selector] || null),
    querySelectorAll: (selector) => (selector === "[data-scene-fallback]" ? fallback : []),
  };
  const reads = [];
  const requested = [];
  const window = {
    BabelSite: { ui: { initPanels: () => true }, scene: { detectSaveData: () => saveData } },
  };
  if (computedStyle) {
    window.getComputedStyle = (element, pseudo) => {
      reads.push(`${element.selector}${pseudo}`);
      return { getPropertyValue: (property) => art[element.selector][pseudo]?.[property] ?? "" };
    };
  }
  if (image) {
    window.Image = class {
      set src(url) {
        requested.push(url);
      }
    };
  }
  vm.runInNewContext(source, { window, document }, { filename: "src/ui/scene-menu.js" });
  return {
    entry,
    listeners,
    reads,
    requested,
    initialize: () => window.BabelSite.ui.initSceneMenu(),
  };
}

test("the first sign of intent toward About warms the map and paper art once", () => {
  const fixture = createWarmFixture();
  assert.equal(fixture.initialize(), true);
  assert.equal(fixture.initialize(), true, "a repeat initialization binds nothing more");
  for (const type of ["pointerenter", "focusin", "touchstart"])
    assert.equal(fixture.listeners.get(type).length, 1, `one ${type} listener`);
  assert.deepEqual(fixture.requested, [], "nothing loads before intent");

  fixture.entry.dispatch("focusin");
  // The hashed URLs the computed styles name, never a gradient.
  assert.deepEqual(fixture.requested, [
    "https://alexnava.me/images/estate-map-desktop.0123abcd.webp",
    "https://alexnava.me/images/paper-grain.0123abcd.webp",
    "https://alexnava.me/images/paper-edge.0123abcd.webp",
  ]);
  for (const type of ["pointerenter", "focusin", "touchstart"]) {
    fixture.entry.dispatch(type);
    assert.equal(fixture.listeners.get(type).length, 0, `${type} is released`);
  }
  assert.equal(fixture.requested.length, 3, "one shot");
});

test("Save-Data visitors are never sent the dialog art early", () => {
  const fixture = createWarmFixture({ saveData: true });
  assert.equal(fixture.initialize(), true);
  fixture.entry.dispatch("pointerenter");
  assert.deepEqual(fixture.reads, []);
  assert.deepEqual(fixture.requested, []);
});

test("warming the dialog art survives a browser without computed styles or images", () => {
  for (const missing of [{ computedStyle: false }, { image: false }]) {
    const fixture = createWarmFixture(missing);
    assert.equal(fixture.initialize(), true, "About still opens");
    assert.doesNotThrow(() => fixture.entry.dispatch("touchstart"));
    assert.deepEqual(fixture.requested, []);
  }
});
