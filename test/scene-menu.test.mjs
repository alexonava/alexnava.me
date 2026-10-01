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
