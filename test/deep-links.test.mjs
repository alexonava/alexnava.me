import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../src/ui/deep-links.js", import.meta.url), "utf8");
const mainSource = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const qualitySource = await readFile(new URL("../src/scene/quality.js", import.meta.url), "utf8");
const CATEGORIES = ["profile", "experience", "contact"];

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
}

function createTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) || []), handler]);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((handler) => handler(event));
      return true;
    },
    count(type) {
      return (listeners.get(type) || []).length;
    },
  };
}

// Stands in for panels.js: the About entry opens the map, a destination opens
// its category over the map, and each close control steps back one level.
function createFixture({ hash = "", entryHidden = false } = {}) {
  const clicks = [];
  const replaced = [];
  const document = createTarget();
  const window = Object.assign(createTarget(), { BabelSite: {} });
  const stack = [];
  const announce = () => {
    const id = stack.at(-1) ?? null;
    document.dispatchEvent(
      new FakeCustomEvent("babel:panelchange", { detail: { id, open: id !== null } }),
    );
  };
  const control = (name, onClick) => ({
    name,
    hidden: false,
    click() {
      clicks.push(name);
      onClick();
    },
  });
  const entry = control("entry", () => {
    if (stack.length) stack.length = 0;
    else stack.push("about");
    announce();
  });
  entry.hidden = entryHidden;
  const destinations = Object.fromEntries(
    CATEGORIES.map((id) => [
      id,
      control(id, () => {
        if (stack.at(-1) !== "about") return;
        stack.push(id);
        announce();
      }),
    ]),
  );
  const closes = Object.fromEntries(
    ["about", ...CATEGORIES].map((id) => [
      id,
      control(`close-${id}`, () => {
        if (stack.at(-1) !== id) return;
        stack.pop();
        announce();
      }),
    ]),
  );
  Object.assign(document, {
    querySelector(selector) {
      if (selector === ".scene-entry") return entry;
      const match = selector.match(/^\.estate-destination\.estate-([a-z]+)$/);
      return match ? destinations[match[1]] || null : null;
    },
    getElementById(id) {
      const name = id.replace(/^panel-/, "");
      if (!closes[name]) return null;
      return { querySelector: (selector) => (selector === ".panel-close" ? closes[name] : null) };
    },
  });
  window.location = { pathname: "/", search: "?view=tower", hash };
  window.history = {
    state: { preserved: true },
    replaceState(state, title, url) {
      replaced.push({ state, url });
      window.location.hash = url.includes("#") ? url.slice(url.indexOf("#")) : "";
    },
  };
  vm.runInNewContext(source, { window, document }, { filename: "src/ui/deep-links.js" });
  return {
    window,
    document,
    clicks,
    replaced,
    stack,
    entry,
    destinations,
    closes,
    get urls() {
      return replaced.map((call) => call.url);
    },
    initialize() {
      return window.BabelSite.ui.initDeepLinks();
    },
    navigateTo(nextHash) {
      window.location.hash = nextHash;
      window.dispatchEvent({ type: "hashchange" });
    },
  };
}

test("each dialog hash opens through the About entry and its map destination", () => {
  const cases = {
    "#about": { clicks: ["entry"], stack: ["about"] },
    "#profile": { clicks: ["entry", "profile"], stack: ["about", "profile"] },
    "#experience": { clicks: ["entry", "experience"], stack: ["about", "experience"] },
    "#contact": { clicks: ["entry", "contact"], stack: ["about", "contact"] },
  };
  for (const [hash, expected] of Object.entries(cases)) {
    const fixture = createFixture({ hash });
    assert.equal(fixture.initialize(), true);
    assert.deepEqual(fixture.clicks, expected.clicks, hash);
    assert.deepEqual(fixture.stack, expected.stack, hash);
    assert.equal(fixture.window.location.hash, hash);
  }
});

test("no-script -text anchors open the same dialogs and settle on the canonical hash", () => {
  for (const id of ["about", ...CATEGORIES]) {
    const fixture = createFixture({ hash: `#${id}-text` });
    fixture.initialize();
    assert.equal(fixture.stack.at(-1), id);
    assert.equal(fixture.window.location.hash, `#${id}`);
    assert.equal(fixture.urls.at(-1), `/?view=tower#${id}`, "path and query are kept");
  }
});

test("an empty or unknown hash opens nothing and leaves the URL alone", () => {
  for (const hash of ["", "#main", "#home", "#panel-about", "#about-textual", "#Profile"]) {
    const fixture = createFixture({ hash });
    assert.equal(fixture.initialize(), true);
    assert.deepEqual(fixture.clicks, [], hash);
    assert.deepEqual(fixture.replaced, [], hash);
    fixture.navigateTo("#main");
    assert.deepEqual(fixture.clicks, [], "the skip link keeps its native behavior");
    assert.deepEqual(fixture.replaced, []);
  }
});

test("the URL follows each open, step back, and close without new history entries", () => {
  const fixture = createFixture();
  fixture.initialize();
  fixture.entry.click();
  assert.deepEqual(fixture.urls, ["/?view=tower#about"]);
  fixture.destinations.experience.click();
  assert.deepEqual(fixture.urls.slice(1), ["/?view=tower#experience"]);
  fixture.closes.experience.click();
  assert.deepEqual(
    fixture.urls.slice(2),
    ["/?view=tower#about"],
    "Back returns the URL to the map",
  );
  fixture.closes.about.click();
  assert.deepEqual(fixture.urls.slice(3), ["/?view=tower"], "closing everything drops the hash");
  assert.equal(fixture.window.location.hash, "");
  assert.ok(fixture.replaced.every((call) => call.state.preserved === true));
});

test("hash changes move between dialogs through the map", () => {
  const fixture = createFixture();
  fixture.initialize();
  fixture.navigateTo("#contact");
  assert.deepEqual(fixture.clicks, ["entry", "contact"]);
  assert.deepEqual(fixture.stack, ["about", "contact"]);

  fixture.navigateTo("#profile-text");
  assert.deepEqual(fixture.clicks.slice(2), ["close-contact", "profile"]);
  assert.deepEqual(fixture.stack, ["about", "profile"]);
  assert.equal(fixture.window.location.hash, "#profile");

  fixture.navigateTo("#profile");
  assert.equal(fixture.clicks.length, 4, "the open dialog is not reopened");

  fixture.navigateTo("#about");
  assert.deepEqual(fixture.clicks.slice(4), ["close-profile"]);
  assert.deepEqual(fixture.stack, ["about"]);

  fixture.navigateTo("#about-text");
  assert.equal(fixture.clicks.length, 5);
  assert.equal(
    fixture.window.location.hash,
    "#about",
    "an alias for the open dialog is canonicalized",
  );

  fixture.navigateTo("#experience");
  assert.deepEqual(fixture.clicks.slice(5), ["experience"]);

  fixture.navigateTo("#unknown");
  assert.deepEqual(fixture.stack, ["about", "experience"], "an unknown hash is ignored");
  assert.equal(fixture.window.location.hash, "#unknown");

  fixture.navigateTo("");
  assert.deepEqual(fixture.clicks.slice(6), ["close-experience", "close-about"]);
  assert.deepEqual(fixture.stack, [], "returning to the bare page closes the dialogs");
});

test("the fallback menu keeps native anchors and binding happens once", () => {
  const fallback = createFixture({ hash: "#profile", entryHidden: true });
  assert.equal(fallback.initialize(), false);
  assert.deepEqual(fallback.clicks, []);
  assert.equal(fallback.window.count("hashchange"), 0);
  assert.equal(fallback.document.count("babel:panelchange"), 0);

  const fixture = createFixture({ hash: "#about" });
  for (let i = 0; i < 3; i++) assert.equal(fixture.initialize(), true);
  assert.deepEqual(fixture.clicks, ["entry"]);
  assert.equal(fixture.window.count("hashchange"), 1);
  assert.equal(fixture.document.count("babel:panelchange"), 1);
});

test("a URL update the document refuses leaves the dialogs working", () => {
  const fixture = createFixture();
  fixture.window.history.replaceState = () => {
    throw new Error("SecurityError");
  };
  fixture.initialize();
  assert.doesNotThrow(() => fixture.navigateTo("#contact"));
  assert.deepEqual(fixture.stack, ["about", "contact"]);
});

function bootMain(ui) {
  const calls = [];
  const wrapped = Object.fromEntries(
    Object.entries(ui).map(([name, result]) => [
      name,
      () => {
        calls.push(name);
        return result;
      },
    ]),
  );
  const quietQuery = { matches: false, addEventListener() {}, removeEventListener() {} };
  const window = {
    BabelSite: { ui: wrapped },
    location: { search: "" },
    matchMedia: () => quietQuery,
    requestIdleCallback() {},
  };
  const document = { readyState: "complete", addEventListener() {} };
  const context = vm.createContext({ window, document, navigator: {}, URLSearchParams });
  vm.runInContext(qualitySource, context, { filename: "src/scene/quality.js" });
  vm.runInContext(mainSource, context, { filename: "src/main.js" });
  return calls;
}

test("main.js binds deep links only after the enhanced menu succeeds", () => {
  assert.deepEqual(
    bootMain({ initHeroChrome: undefined, initSceneMenu: true, initDeepLinks: true }),
    ["initHeroChrome", "initSceneMenu", "initDeepLinks"],
  );
  assert.deepEqual(
    bootMain({ initHeroChrome: undefined, initSceneMenu: false, initDeepLinks: true }),
    ["initHeroChrome", "initSceneMenu"],
  );
});
